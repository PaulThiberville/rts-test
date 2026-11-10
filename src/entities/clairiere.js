// Clairière : sol, chemin, cœur, rochers et végétation.
// Le décor végétal vient de `entities/vegetation.js` (quatre familles instanciées, #93) ;
// cette entité garde le terrain et la famille non végétale (rochers), puis additionne
// les compteurs des deux dans `userData.stats`.
import * as THREE from 'three'
import { LEVEL_1 } from '../data/level-1.js'
import { createTerrainMaterials, createDecorMaterials } from '../materials/terrain.js'
import { createVegetationMaterials } from '../materials/vegetation.js'
import { createVegetation } from './vegetation.js'

const UP = new THREE.Vector3(0, 1, 0)
const PATH_SEGMENTS = 96
const HEART_SEGMENTS = 48

/** RNG déterministe mulberry32 : même graine, mêmes positions. */
function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const between = (random, min, max) => min + random() * (max - min)

/** Rocher : icosaèdre facetté posé sur le sol, écrasable par instance. */
const ROCK_GEOMETRY = new THREE.IcosahedronGeometry(1, 0).translate(0, 1, 0)

/** Distance au carré d'un point au segment [a, b], en XZ. */
function segmentDistanceSq(x, z, [ax, az], [bx, bz]) {
  const dx = bx - ax
  const dz = bz - az
  const lengthSq = dx * dx + dz * dz
  const t = lengthSq ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / lengthSq)) : 0
  const cx = ax + dx * t
  const cz = az + dz * t
  return (x - cx) ** 2 + (z - cz) ** 2
}

/** Distance au carré d'un point à une polyligne XZ. */
function polylineDistanceSq(x, z, points) {
  let min = Infinity
  for (let i = 1; i < points.length; i++) {
    const d = segmentDistanceSq(x, z, points[i - 1], points[i])
    if (d < min) min = d
  }
  return min
}

function triangleCount(geometry) {
  const count = geometry.index ? geometry.index.count : geometry.attributes.position.count
  return count / 3
}

/**
 * Bande de chemin lissée le long des points du niveau.
 * @returns {{ geometry: THREE.BufferGeometry, center: Array<[number, number]> }}
 */
function createPathGeometry(points, width) {
  const curve = new THREE.CatmullRomCurve3(
    points.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    false,
    'centripetal',
  )
  const halfWidth = width / 2
  const positions = []
  const center = []
  for (let i = 0; i <= PATH_SEGMENTS; i++) {
    const t = i / PATH_SEGMENTS
    const point = curve.getPointAt(t)
    const tangent = curve.getTangentAt(t)
    const sideX = tangent.z
    const sideZ = -tangent.x
    positions.push(point.x - sideX * halfWidth, 0, point.z - sideZ * halfWidth)
    positions.push(point.x + sideX * halfWidth, 0, point.z + sideZ * halfWidth)
    center.push([point.x, point.z])
  }
  const indices = []
  for (let i = 0; i < PATH_SEGMENTS; i++) {
    const left = i * 2
    const right = left + 1
    const nextLeft = left + 2
    const nextRight = left + 3
    indices.push(left, nextLeft, right, right, nextLeft, nextRight)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return { geometry, center }
}

/**
 * Clairière complète : sol, chemin, cœur, rochers instanciés et végétation des quatre
 * familles déléguée à `createVegetation`. Le groupe est statique (son `update` est posé
 * par `core/level.js`) et ses compteurs sont exposés dans `userData.stats`.
 * @param {{ level?: object, seed?: number }} [options]
 * @returns {THREE.Group}
 */
export function createClairiere({ level = LEVEL_1, seed = level.decor.seed } = {}) {
  const { bounds, path, heart, palette, decor, slots = [] } = level
  const random = mulberry32(seed)
  const group = new THREE.Group()
  group.name = 'clairiere'

  const terrainMaterials = createTerrainMaterials(palette)
  const decorMaterials = createDecorMaterials(palette)

  const padded = {
    minX: bounds.minX - bounds.skirt,
    maxX: bounds.maxX + bounds.skirt,
    minZ: bounds.minZ - bounds.skirt,
    maxZ: bounds.maxZ + bounds.skirt,
  }
  const width = padded.maxX - padded.minX
  const depth = padded.maxZ - padded.minZ

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(width, depth).rotateX(-Math.PI / 2),
    terrainMaterials.ground,
  )
  ground.name = 'ground'
  ground.position.set((bounds.minX + bounds.maxX) / 2, 0, (bounds.minZ + bounds.maxZ) / 2)
  ground.receiveShadow = true
  group.add(ground)

  const { geometry: pathGeometry, center: pathCenter } = createPathGeometry(path.points, path.width)
  const pathMesh = new THREE.Mesh(pathGeometry, terrainMaterials.path)
  pathMesh.name = 'path'
  pathMesh.position.y = 0.02
  pathMesh.receiveShadow = true
  group.add(pathMesh)

  const heartMesh = new THREE.Mesh(
    new THREE.CircleGeometry(heart.radius, HEART_SEGMENTS).rotateX(-Math.PI / 2),
    terrainMaterials.heart,
  )
  heartMesh.name = 'heart'
  heartMesh.position.set(heart.x, 0.03, heart.z)
  group.add(heartMesh)

  const decorGroup = new THREE.Group()
  decorGroup.name = 'decor'
  group.add(decorGroup)

  /**
   * Tire `count` positions de rocher hors chemin, hors cœur et hors emplacements de tours,
   * avec une marge qui garde tous les sommets de l'instance dans `bounds ± skirt`.
   */
  function scatterRocks(count, margin) {
    const clearance = path.width / 2 + 0.6 + margin
    const heartClearance = heart.radius + margin
    const slotClearance = 1 + margin
    const spots = []
    const maxAttempts = count * 400
    for (let attempt = 0; attempt < maxAttempts && spots.length < count; attempt++) {
      const x = between(random, padded.minX + margin, padded.maxX - margin)
      const z = between(random, padded.minZ + margin, padded.maxZ - margin)
      if (polylineDistanceSq(x, z, path.points) < clearance * clearance) continue
      if (polylineDistanceSq(x, z, pathCenter) < clearance * clearance) continue
      if ((x - heart.x) ** 2 + (z - heart.z) ** 2 < heartClearance * heartClearance) continue
      if (slots.some((slot) => (slot.x - x) ** 2 + (slot.z - z) ** 2 < slotClearance * slotClearance)) continue
      spots.push([x, z])
    }
    return spots
  }

  // Rochers : famille non végétale, une seule géométrie partagée, un InstancedMesh.
  const rockSpots = scatterRocks(decor.rocks, 1.4)
  const rocks = new THREE.InstancedMesh(ROCK_GEOMETRY, decorMaterials.rock, Math.max(rockSpots.length, 1))
  rocks.count = rockSpots.length
  rocks.name = 'rocks'
  rocks.castShadow = false
  rocks.receiveShadow = false
  const position = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  const matrix = new THREE.Matrix4()
  rockSpots.forEach(([x, z], index) => {
    const size = between(random, 0.4, 1)
    position.set(x, 0, z)
    quaternion.setFromAxisAngle(UP, between(random, 0, Math.PI * 2))
    scale.set(size, between(random, 0.3, 0.65), size * between(random, 0.7, 1.3))
    rocks.setMatrixAt(index, matrix.compose(position, quaternion, scale))
  })
  rocks.instanceMatrix.needsUpdate = true
  rocks.computeBoundingSphere()
  decorGroup.add(rocks)

  // Végétation des quatre familles (#93) : un InstancedMesh par famille, ombres portées.
  const vegetation = createVegetation({
    level,
    materials: createVegetationMaterials(palette),
    seed,
  })
  decorGroup.add(vegetation)

  const vegetationStats = vegetation.userData.stats
  const rockTriangles = triangleCount(ROCK_GEOMETRY) * rockSpots.length
  let drawCalls = 0
  group.traverse((object) => {
    if (object.isMesh) drawCalls++
  })

  group.userData.stats = {
    props: rockSpots.length + vegetationStats.families.reduce((sum, family) => sum + family.count, 0),
    families: vegetationStats.families,
    triangles:
      triangleCount(ground.geometry) +
      triangleCount(pathGeometry) +
      triangleCount(heartMesh.geometry) +
      rockTriangles +
      vegetationStats.triangles,
    drawCalls,
  }
  return group
}
