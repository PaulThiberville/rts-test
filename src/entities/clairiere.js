import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { LEVEL_1 } from '../data/level-1.js'
import { createTerrainMaterials, createDecorMaterials } from '../materials/terrain.js'

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

/** Touffe d'herbe : trois lames triangulaires croisées, double face par sommet dupliqué. */
function createGrassGeometry() {
  const positions = []
  for (const angle of [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3]) {
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const rotate = (x, y) => [x * cos, y, -x * sin]
    const left = rotate(-0.06, 0)
    const right = rotate(0.06, 0)
    const tip = rotate(0.11, 0.46)
    positions.push(...left, ...right, ...tip)
    positions.push(...left, ...tip, ...right)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return geometry
}

/** Rocher : icosaèdre facetté posé sur le sol, écrasable par instance. */
const ROCK_GEOMETRY = new THREE.IcosahedronGeometry(1, 0).translate(0, 1, 0)

/** Buisson : deux blobs arrondis fusionnés, base au sol. */
const BUSH_GEOMETRY = mergeGeometries([
  new THREE.IcosahedronGeometry(0.55, 1).translate(0, 0.55, 0),
  new THREE.IcosahedronGeometry(0.4, 0).translate(0.42, 0.38, 0.1),
])

/** Arbre : petit tronc et houppier rond, une seule silhouette lisible de loin. */
const TREE_GEOMETRY = mergeGeometries([
  new THREE.CylinderGeometry(0.08, 0.13, 0.9, 5, 1, true).toNonIndexed().translate(0, 0.45, 0),
  new THREE.IcosahedronGeometry(1.1, 1).translate(0, 1.5, 0),
])

const GRASS_GEOMETRY = createGrassGeometry()

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
 * Clairière complète : sol, chemin, cœur et décor instancié hors du chemin et du cœur.
 * Le groupe est statique (aucun update) et ses compteurs sont exposés dans `userData.stats`.
 * @param {{ level?: object, seed?: number }} [options]
 * @returns {THREE.Group}
 */
export function createClairiere({ level = LEVEL_1, seed = level.decor.seed } = {}) {
  const { bounds, path, heart, palette, decor } = level
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
  group.add(ground)

  const { geometry: pathGeometry, center: pathCenter } = createPathGeometry(path.points, path.width)
  const pathMesh = new THREE.Mesh(pathGeometry, terrainMaterials.path)
  pathMesh.name = 'path'
  pathMesh.position.y = 0.02
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

  const pathPoints = path.points
  const isOnPath = (x, z, clearance) =>
    polylineDistanceSq(x, z, pathPoints) < clearance * clearance ||
    polylineDistanceSq(x, z, pathCenter) < clearance * clearance
  const isOnHeart = (x, z, clearance) =>
    (x - heart.x) ** 2 + (z - heart.z) ** 2 < clearance * clearance

  /**
   * Tire `count` positions hors chemin et hors cœur, avec une marge qui garde
   * tous les sommets de l'instance dans `bounds ± skirt`.
   */
  function scatter(count, margin, spacing = 0) {
    const clearance = path.width / 2 + 0.6 + margin
    const heartClearance = heart.radius + margin
    const spots = []
    const maxAttempts = count * 400
    for (let attempt = 0; attempt < maxAttempts && spots.length < count; attempt++) {
      const x = between(random, padded.minX + margin, padded.maxX - margin)
      const z = between(random, padded.minZ + margin, padded.maxZ - margin)
      if (isOnPath(x, z, clearance) || isOnHeart(x, z, heartClearance)) continue
      if (spacing && spots.some(([sx, sz]) => (sx - x) ** 2 + (sz - z) ** 2 < spacing * spacing)) continue
      spots.push([x, z])
    }
    return spots
  }

  /** Remplit un InstancedMesh en consommant le RNG dans un ordre fixe. */
  function populate(name, spots, geometry, material, transform) {
    const mesh = new THREE.InstancedMesh(geometry, material, spots.length)
    mesh.name = name
    mesh.castShadow = false
    mesh.receiveShadow = false
    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    const matrix = new THREE.Matrix4()
    spots.forEach(([x, z], index) => {
      const { rotation, scale: [sx, sy, sz] } = transform()
      position.set(x, 0, z)
      quaternion.setFromAxisAngle(UP, rotation)
      scale.set(sx, sy, sz)
      mesh.setMatrixAt(index, matrix.compose(position, quaternion, scale))
    })
    decorGroup.add(mesh)
    return mesh
  }

  const grassSpots = scatter(decor.grass, 0.2)
  const rockSpots = scatter(decor.rocks, 1.4)
  const bushSpots = scatter(decor.bushes, 1.1)
  const treeSpots = scatter(decor.trees, 1.6, 2.4)

  populate('grass', grassSpots, GRASS_GEOMETRY, decorMaterials.grass, () => ({
    rotation: between(random, 0, Math.PI * 2),
    scale: [between(random, 0.7, 1.4), between(random, 0.7, 1.4), between(random, 0.7, 1.4)],
  }))
  populate('rocks', rockSpots, ROCK_GEOMETRY, decorMaterials.rock, () => {
    const x = between(random, 0.4, 1)
    return {
      rotation: between(random, 0, Math.PI * 2),
      scale: [x, between(random, 0.3, 0.65), x * between(random, 0.7, 1.3)],
    }
  })
  populate('bushes', bushSpots, BUSH_GEOMETRY, decorMaterials.bush, () => {
    const s = between(random, 0.6, 1.2)
    return {
      rotation: between(random, 0, Math.PI * 2),
      scale: [s, s * between(random, 0.8, 1.1), s],
    }
  })
  populate('trees', treeSpots, TREE_GEOMETRY, decorMaterials.tree, () => {
    const s = between(random, 0.85, 1.3)
    return {
      rotation: between(random, 0, Math.PI * 2),
      scale: [s, s * between(random, 0.9, 1.1), s],
    }
  })

  const decorTriangles =
    triangleCount(GRASS_GEOMETRY) * grassSpots.length +
    triangleCount(ROCK_GEOMETRY) * rockSpots.length +
    triangleCount(BUSH_GEOMETRY) * bushSpots.length +
    triangleCount(TREE_GEOMETRY) * treeSpots.length
  const triangles =
    triangleCount(ground.geometry) +
    triangleCount(pathGeometry) +
    triangleCount(heartMesh.geometry) +
    decorTriangles

  group.userData.stats = {
    props: grassSpots.length + rockSpots.length + bushSpots.length + treeSpots.length,
    triangles,
    drawCalls: 3 + decorGroup.children.length,
  }
  return group
}
