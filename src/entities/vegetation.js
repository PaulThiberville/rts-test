// Végétation de la clairière : quatre familles procédurales, une géométrie par famille,
// un seul THREE.InstancedMesh par famille (1 draw call), variation d'instance sans paire identique.
//
// Silhouettes (unités : mètres, origine au sol, face avant vers -Z) :
//   tree   0,17 m de tronc + houppier rond en quatre lobes — 2,6 m de haut
//   bush   cinq lobes arrondis étagés, large et bas — 0,95 m
//   flower tige fine, deux feuilles et corolle de cinq pétales facettés — 0,62 m
//   grass  dix lames courbées, plus hautes que les 0,46 m de l'ancienne touffe — 0,45 à 0,7 m
// Formes rondes, facettes douces et aplats mats : Direction-Artistique, formes & style.
//
// Les teintes viennent du matériau (palette du niveau) ; les nuances par pièce (tronc plus sombre,
// lobes ombrés, pointes d'herbe plus claires, cœur de fleur) passent par les couleurs de sommet,
// et la variation par instance par `instanceColor` : un seul matériau partagé par famille suffit.
//
// Placement : chaque famille pose exactement `count` instances. Quand le tirage manque de place,
// trois paliers bornés et déterministes relâchent les contraintes — espacement, puis marge au
// bord, puis dégagement des emplacements de tours —, jamais le chemin ni le cœur ; une grille
// déterministe comble le reliquat. Même graine, mêmes positions.
// `stats.density` mesure les instances par m² de `bounds` (sans `skirt`) : le total ne compte
// que le couvert haut (arbre, buisson, fleur), ni graminées ni rochers.
import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { LEVEL_1 } from '../data/level-1.js'

// Matériaux végétaux livrés en parallèle (#90) : utilisés dès qu'ils sont présents.
// Le repli local garde `npm run check` et la vitrine verts tant que ce module n'est pas fusionné.
const parallelMaterials =
  typeof import.meta.glob === 'function'
    ? import.meta.glob('../materials/vegetation.js', { eager: true })['../materials/vegetation.js']
    : undefined
const createVegetationMaterials = parallelMaterials?.createVegetationMaterials

/** Jeu de secours : mêmes `id` et mêmes bornes que `LEVEL_1.decor.families` (ticket #91). */
const FALLBACK_FAMILIES = [
  { id: 'tree', count: 26, scale: [0.85, 1.3], height: [0.9, 1.1], spacing: 2.4, tintJitter: 0.06, sway: 0.35 },
  { id: 'bush', count: 40, scale: [0.6, 1.2], height: [0.8, 1.1], spacing: 1.1, tintJitter: 0.08, sway: 0.5 },
  { id: 'flower', count: 90, scale: [0.7, 1.2], height: [0.9, 1.1], spacing: 0, tintJitter: 0.12, sway: 0.8 },
  { id: 'grass', count: 1200, scale: [0.7, 1.4], height: [0.7, 1.4], spacing: 0, tintJitter: 0.1, sway: 1.0 },
]

/** Teintes de secours, alignées sur la Direction-Artistique (le niveau les fournit après #91). */
const FALLBACK_PALETTE = {
  grass: '#a9c8a0',
  grassTall: '#c3d8ae',
  tree: '#8fb99a',
  bush: '#b7d3ac',
  flower: '#f0d6de',
  flowerAlt: '#f2c66d',
  stem: '#7fa27a',
}

/** Familles dont `stats.density.perFamily` publie un taux, même absentes du niveau. */
const DENSITY_FAMILIES = ['tree', 'bush', 'flower', 'grass']
/** Couvert haut compté dans `stats.density.total` : ni graminées (sol) ni rochers (autre entité). */
const DENSITY_TOTAL_FAMILIES = ['tree', 'bush', 'flower']

const GOLDEN_STEP = 0.6180339887498949 // φ - 1
const SILVER_STEP = 0.4142135623730951 // √2 - 1
const BRONZE_STEP = 0.7320508075688772 // √3 - 1
const TINT_STEP = 0.2360679774997896 // √5 - 2
const SAT_STEP = 0.3162277660168379 // √10 - 3
const LIGHT_STEP = 0.1231056256176606 // √17 - 4
const TILT_STEP = 0.1414213562373095 // √2 / 10

/** Palette de travail : les teintes du niveau priment, le jeu de secours comble les clés manquantes. */
const DECOR_PALETTE = { ...FALLBACK_PALETTE, ...(LEVEL_1.palette ?? {}) }

const WHITE = new THREE.Color(1, 1, 1)
const grey = (value) => new THREE.Color(value, value, value)

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
const fract = (value) => value - Math.floor(value)
const clamp01 = (value) => Math.min(1, Math.max(0, value))
/** Arrondi à 4 décimales des mesures exposées : même valeur affichée sur toutes les plateformes. */
const round4 = (value) => Math.round(value * 1e4) / 1e4

/** Rapport canal par canal entre deux teintes : dérive une nuance de sommet depuis la palette. */
function tintRatio(fromHex, toHex) {
  const from = new THREE.Color(fromHex)
  const to = new THREE.Color(toHex)
  return new THREE.Color(
    THREE.MathUtils.clamp(to.r / Math.max(from.r, 1e-3), 0.2, 2),
    THREE.MathUtils.clamp(to.g / Math.max(from.g, 1e-3), 0.2, 2),
    THREE.MathUtils.clamp(to.b / Math.max(from.b, 1e-3), 0.2, 2),
  )
}

/**
 * Peint une géométrie en couleurs de sommet : multiplicateur au pied et au sommet,
 * interpolé sur la hauteur locale de la pièce.
 * @param {THREE.BufferGeometry} geometry
 * @param {THREE.Color} [bottom]
 * @param {THREE.Color} [top]
 * @returns {THREE.BufferGeometry} géométrie non indexée, avec attribut `color`
 */
function paint(geometry, bottom = WHITE, top = bottom) {
  const painted = geometry.index ? geometry.toNonIndexed() : geometry
  const position = painted.attributes.position
  const colors = new Float32Array(position.count * 3)
  let minY = Infinity
  let maxY = -Infinity
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i)
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const span = maxY - minY || 1
  const color = new THREE.Color()
  for (let i = 0; i < position.count; i++) {
    const t = clamp01((position.getY(i) - minY) / span)
    color.copy(bottom).lerp(top, t)
    colors[i * 3] = color.r
    colors[i * 3 + 1] = color.g
    colors[i * 3 + 2] = color.b
  }
  painted.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return painted
}

/** Un lobe de feuillage : icosaèdre facetté, éclairci vers le haut, teinte propre au lobe. */
function lobe(radius, x, y, z, brightness, detail = 1) {
  const geometry = new THREE.IcosahedronGeometry(radius, detail).translate(x, y, z)
  return paint(geometry, grey(brightness * 0.84), grey(brightness * 1.12))
}

/** Arbre : tronc sombre et houppier rond en quatre lobes, une silhouette lisible de loin. */
function createTreeGeometry() {
  const trunk = new THREE.CylinderGeometry(0.11, 0.18, 1.25, 6, 1, true)
  trunk.translate(0, 0.62, 0)
  return mergeGeometries([
    paint(trunk, grey(0.48), grey(0.62)),
    lobe(0.88, 0, 1.82, 0, 1),
    lobe(0.6, 0.52, 1.46, 0.16, 0.86),
    lobe(0.56, -0.5, 1.58, -0.14, 0.8),
    lobe(0.5, 0.06, 2.3, -0.04, 1.1),
  ])
}

/** Buisson : cinq lobes arrondis étagés, large et bas, base au sol. */
function createBushGeometry() {
  return mergeGeometries([
    lobe(0.5, 0, 0.44, 0, 0.94),
    lobe(0.38, 0.46, 0.34, 0.18, 1.06, 0),
    lobe(0.36, -0.44, 0.3, -0.12, 0.86, 0),
    lobe(0.3, 0.12, 0.68, -0.16, 1.14, 0),
    lobe(0.26, -0.22, 0.62, 0.22, 0.98, 0),
  ])
}

/** Fleur : tige, deux feuilles et corolle de cinq pétales facettés autour d'un cœur doré. */
function createFlowerGeometry() {
  const palette = DECOR_PALETTE
  const stemTint = tintRatio(palette.flower, palette.stem)
  const heartTint = tintRatio(palette.flower, palette.flowerAlt)
  const parts = []

  const stem = new THREE.CylinderGeometry(0.02, 0.032, 0.54, 4, 1, true)
  stem.translate(0, 0.27, 0)
  parts.push(paint(stem, stemTint, stemTint))

  for (const side of [-1, 1]) {
    const leaf = new THREE.IcosahedronGeometry(0.1, 0)
    leaf.scale(1.7, 0.22, 0.65)
    leaf.rotateY(side * 0.85)
    leaf.translate(side * 0.08, 0.15, 0.03)
    parts.push(paint(leaf, stemTint, stemTint))
  }

  for (let petal = 0; petal < 5; petal++) {
    const angle = (petal / 5) * Math.PI * 2
    const shape = new THREE.IcosahedronGeometry(0.085, 0)
    shape.scale(1.2, 0.36, 0.82)
    shape.rotateY(-angle)
    shape.translate(Math.cos(angle) * 0.11, 0.56, Math.sin(angle) * 0.11)
    parts.push(paint(shape, grey(0.94), WHITE))
  }

  const core = new THREE.IcosahedronGeometry(0.06, 0).translate(0, 0.59, 0)
  parts.push(paint(core, heartTint, heartTint))

  return mergeGeometries(parts)
}

/** Graminée : douze lames courbées en double face et une souche basse, touffe pleine. */
function createGrassGeometry() {
  const palette = DECOR_PALETTE
  const tipTint = tintRatio(palette.grass, palette.grassTall)
  const positions = []
  const bladeCount = 12
  for (let blade = 0; blade < bladeCount; blade++) {
    const angle = (blade / bladeCount) * Math.PI * 2 + 0.45
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const radius = 0.012 + (blade % 4) * 0.018
    const height = 0.4 + ((blade * 5) % 7) * 0.038
    const width = 0.11 - (blade % 3) * 0.02
    const cx = cos * radius
    const cz = sin * radius
    const px = -sin * width
    const pz = cos * width
    const bend = 0.42 + (blade % 3) * 0.18
    const lean = bend * 0.09
    const baseLeft = [cx - px, 0, cz - pz]
    const baseRight = [cx + px, 0, cz + pz]
    const midLeft = [cx - px * 0.62 + cos * lean, height * 0.58, cz - pz * 0.62 + sin * lean]
    const midRight = [cx + px * 0.62 + cos * lean, height * 0.58, cz + pz * 0.62 + sin * lean]
    const tip = [cx + cos * bend * 0.26, height, cz + sin * bend * 0.26]
    const face = [baseLeft, baseRight, midRight, baseLeft, midRight, midLeft, midLeft, midRight, tip]
    for (const vertex of face) positions.push(...vertex)
    for (const vertex of face.slice().reverse()) positions.push(...vertex)
  }
  const blades = new THREE.BufferGeometry()
  blades.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  blades.computeVertexNormals()

  // Souche basse : donne un pied plein à la touffe au lieu de lames isolées.
  const clump = new THREE.IcosahedronGeometry(0.19, 0).scale(1, 0.55, 1).translate(0, 0.07, 0)
  clump.deleteAttribute('uv')

  return mergeGeometries([paint(blades, grey(0.7), tipTint), paint(clump, grey(0.62), grey(0.8))])
}

const FAMILY_GEOMETRIES = {
  tree: createTreeGeometry(),
  bush: createBushGeometry(),
  flower: createFlowerGeometry(),
  grass: createGrassGeometry(),
}

/** Teinte de base lue dans la palette, avec le jeu de secours pour les clés pas encore livrées. */
const tintOf = (palette, key) => palette?.[key] ?? FALLBACK_PALETTE[key] ?? '#a9c8a0'

/** Aplat mat de secours, même contrat que `createVegetationMaterials` (#90). */
function createMatteMaterials(palette) {
  const matte = (color) =>
    new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0, flatShading: true })
  return {
    tree: matte(tintOf(palette, 'tree')),
    bush: matte(tintOf(palette, 'bush')),
    flower: matte(tintOf(palette, 'flower')),
    grass: matte(tintOf(palette, 'grass')),
    stem: matte(tintOf(palette, 'stem')),
  }
}

/** Triangle count d'une géométrie. */
function triangleCount(geometry) {
  const count = geometry.index ? geometry.index.count : geometry.attributes.position.count
  return Math.round(count / 3)
}

/** Distance au carré d'un point au segment [a, b], en XZ. */
function segmentDistanceSq(x, z, [ax, az], [bx, bz]) {
  const dx = bx - ax
  const dz = bz - az
  const lengthSq = dx * dx + dz * dz
  const t = lengthSq ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / lengthSq)) : 0
  return (x - (ax + dx * t)) ** 2 + (z - (az + dz * t)) ** 2
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

/** Encombrement horizontal maximal de la géométrie, en mètres. */
function footprintOf(geometry) {
  geometry.computeBoundingBox()
  const { min, max } = geometry.boundingBox
  return Math.max(Math.abs(min.x), Math.abs(max.x), Math.abs(min.z), Math.abs(max.z), 0.05)
}

/**
 * Teinte multiplicative d'une instance : décalage HSL par rapport à la teinte de palette,
 * ramené à une luminance moyenne de 1 pour que le matériau garde sa teinte de base.
 * Chaque composante vient d'un rang irrationnel distinct : jamais deux fois la même.
 */
function instanceTint(baseHex, hueShift, saturationShift, lightnessShift) {
  const base = new THREE.Color(baseHex)
  const hsl = { h: 0, s: 0, l: 0 }
  base.getHSL(hsl)
  const tinted = new THREE.Color().setHSL(
    fract(hsl.h + hueShift + 1),
    clamp01(hsl.s + saturationShift),
    clamp01(hsl.l + lightnessShift),
  )
  const channels = [
    THREE.MathUtils.clamp(tinted.r / Math.max(base.r, 1e-3), 0.45, 1.8),
    THREE.MathUtils.clamp(tinted.g / Math.max(base.g, 1e-3), 0.45, 1.8),
    THREE.MathUtils.clamp(tinted.b / Math.max(base.b, 1e-3), 0.45, 1.8),
  ]
  const mean = (channels[0] + channels[1] + channels[2]) / 3 || 1
  return new THREE.Color(channels[0] / mean, channels[1] / mean, channels[2] / mean)
}

/**
 * Végétation instanciée de la clairière : une famille = un `THREE.InstancedMesh`.
 * Le groupe est statique, ses compteurs sont exposés dans `userData.stats`.
 * @param {{ level?: object, materials?: object, seed?: number }} [options]
 * @returns {THREE.Group & { userData: { stats: object } }}
 */
export function createVegetation({ level = LEVEL_1, materials, seed = level?.decor?.seed ?? 7 } = {}) {
  const { bounds, path, heart, palette, decor, slots = [] } = level
  const families = decor?.families?.length ? decor.families : FALLBACK_FAMILIES
  const resolved = materials ?? createVegetationMaterials?.(palette) ?? createMatteMaterials(palette)
  const random = mulberry32(seed)

  const group = new THREE.Group()
  group.name = 'vegetation'

  const padded = {
    minX: bounds.minX - (bounds.skirt ?? 0),
    maxX: bounds.maxX + (bounds.skirt ?? 0),
    minZ: bounds.minZ - (bounds.skirt ?? 0),
    maxZ: bounds.maxZ + (bounds.skirt ?? 0),
  }

  // Les emplacements de tours restent dégagés : la végétation ne doit pas traverser une plante-défense.
  const nearSlot = (x, z, clearance) =>
    clearance > 0 && slots.some((slot) => (slot.x - x) ** 2 + (slot.z - z) ** 2 < clearance * clearance)

  /** Aire de référence de la densité : `bounds` seul, le `skirt` de décor n'en fait pas partie. */
  const area = round4((bounds.maxX - bounds.minX) * (bounds.maxZ - bounds.minZ))

  /**
   * Tire `count` positions hors chemin, hors cœur et hors emplacements de tours, espacées.
   * Quatre paliers bornés relâchent tour à tour l'espacement, la marge au bord puis le
   * dégagement des tours ; le chemin et le cœur gardent leur marge nominale à tous les paliers,
   * et un balayage de grille déterministe comble le reliquat. Les positions ne dépendent que
   * de la graine : même graine, mêmes positions, quel que soit le nombre de paliers franchis.
   */
  function placeSpots(count, margin, spacing, clearance) {
    const pathClearance = path.width / 2 + 0.6 + margin
    const heartClearance = heart.radius + margin
    const spots = []

    /** Contraintes dures (chemin, cœur) toujours actives ; paliers pour les contraintes souples. */
    const isFree = (x, z, keepSpacing, keepClearance) => {
      if (polylineDistanceSq(x, z, path.points) < pathClearance * pathClearance) return false
      if ((x - heart.x) ** 2 + (z - heart.z) ** 2 < heartClearance * heartClearance) return false
      if (keepClearance && nearSlot(x, z, clearance)) return false
      if (keepSpacing && spacing && spots.some(([sx, sz]) => (sx - x) ** 2 + (sz - z) ** 2 < spacing * spacing)) {
        return false
      }
      return true
    }

    const spanX = Math.max(padded.maxX - padded.minX, 1e-6)
    const spanZ = Math.max(padded.maxZ - padded.minZ, 1e-6)
    const stages = [
      { spacing: true, edge: true, clearance: true, attempts: count * 240 + 400 },
      { spacing: false, edge: true, clearance: true, attempts: count * 40 + 200 },
      { spacing: false, edge: false, clearance: true, attempts: count * 40 + 200 },
      { spacing: false, edge: false, clearance: false, attempts: count * 40 + 200 },
    ]
    for (const stage of stages) {
      // Une marge plus large que la boîte se ramène à son centre : jamais de tirage hors bornes.
      const edgeX = stage.edge ? Math.min(margin, spanX / 2) : 0
      const edgeZ = stage.edge ? Math.min(margin, spanZ / 2) : 0
      for (let attempt = 0; attempt < stage.attempts && spots.length < count; attempt++) {
        const x = between(random, padded.minX + edgeX, padded.maxX - edgeX)
        const z = between(random, padded.minZ + edgeZ, padded.maxZ - edgeZ)
        if (isFree(x, z, stage.spacing, stage.clearance)) spots.push([x, z])
      }
      if (spots.length >= count) return spots
    }

    // Dernier recours : grille bornée sur la boîte de décor, hors chemin et hors cœur,
    // parcourue dans un ordre fixe et jitteré, échantillonnée à pas régulier sur les cases libres.
    const gridCells = Math.min(4096, Math.max((count - spots.length) * 8, 256))
    const columns = Math.max(1, Math.round(Math.sqrt((gridCells * spanX) / spanZ)))
    const rows = Math.max(1, Math.ceil(gridCells / columns))
    const free = []
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const x = padded.minX + (column + between(random, 0.2, 0.8)) * (spanX / columns)
        const z = padded.minZ + (row + between(random, 0.2, 0.8)) * (spanZ / rows)
        if (isFree(x, z, false, false)) free.push([x, z])
      }
    }
    const missing = count - spots.length
    const stride = free.length > missing ? free.length / missing : 1
    for (let index = 0; index < missing && index < free.length; index++) {
      spots.push(free[Math.floor(index * stride)])
    }
    return spots
  }

  const position = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  const euler = new THREE.Euler()
  const matrix = new THREE.Matrix4()
  const tint = new THREE.Color()
  const entries = []

  for (const family of families) {
    const geometry = FAMILY_GEOMETRIES[family.id]
    if (!geometry) continue
    const material = resolved[family.id] ?? resolved.bush ?? createMatteMaterials(palette).bush
    if (material.vertexColors !== true) {
      material.vertexColors = true
      material.needsUpdate = true
    }

    const [scaleMin, scaleMax] = family.scale ?? [1, 1]
    const [heightMin, heightMax] = family.height ?? [1, 1]
    const jitter = family.tintJitter ?? 0
    const margin = footprintOf(geometry) * scaleMax
    const clearance = family.id === 'tree' || family.id === 'bush' ? 1.1 : 0
    const spots = placeSpots(family.count ?? 0, margin, family.spacing ?? 0, clearance)

    const mesh = new THREE.InstancedMesh(geometry, material, Math.max(spots.length, 1))
    mesh.count = spots.length
    mesh.name = `vegetation-${family.id}`
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.frustumCulled = true

    const baseHex = tintOf(palette, family.id === 'grass' ? 'grass' : family.id)
    spots.forEach(([x, z], index) => {
      const rank = index + 1
      // Variation par rang : six pas irrationnels distincts, aucun tirage ne peut retomber
      // sur la même combinaison (échelle XZ, hauteur, rotation, teinte) qu'une autre instance.
      const sizeStep = fract(rank * SILVER_STEP)
      const heightStep = fract(rank * BRONZE_STEP)
      const rotationStep = fract(rank * GOLDEN_STEP)
      const tintStep = fract(rank * TINT_STEP)
      const saturationStep = fract(rank * SAT_STEP)
      const lightnessStep = fract(rank * LIGHT_STEP)
      const tilt = (fract(rank * TILT_STEP) - 0.5) * 0.14

      const sxz = scaleMin + (scaleMax - scaleMin) * sizeStep
      const sy = heightMin + (heightMax - heightMin) * heightStep
      position.set(x, 0, z)
      euler.set(tilt, rotationStep * Math.PI * 2, -tilt * 0.6, 'YXZ')
      quaternion.setFromEuler(euler)
      scale.set(sxz, sy, sxz)
      mesh.setMatrixAt(index, matrix.compose(position, quaternion, scale))

      tint.copy(
        instanceTint(
          baseHex,
          (tintStep * 2 - 1) * jitter,
          (saturationStep * 2 - 1) * jitter * 0.5,
          (lightnessStep * 2 - 1) * jitter * 0.6,
        ),
      )
      mesh.setColorAt(index, tint)
    })

    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
    group.add(mesh)

    entries.push({
      id: family.id,
      count: spots.length,
      triangles: triangleCount(geometry) * spots.length,
      castShadow: mesh.castShadow,
    })
  }

  const counts = {}
  for (const entry of entries) counts[entry.id] = entry.count
  const densityOf = (ids) =>
    area > 0 ? round4(ids.reduce((sum, id) => sum + (counts[id] ?? 0), 0) / area) : 0
  const perFamily = {}
  for (const id of DENSITY_FAMILIES) perFamily[id] = densityOf([id])

  group.userData.stats = {
    families: entries,
    triangles: entries.reduce((sum, entry) => sum + entry.triangles, 0),
    drawCalls: group.children.length,
    density: {
      area,
      total: densityOf(DENSITY_TOTAL_FAMILIES),
      perFamily,
    },
  }
  return group
}

/**
 * Étalon de vitrine : une instance de chaque famille côte à côte, échelles moyennes.
 * Sert à juger les silhouettes de près (`npm run showcase src/entities/vegetation.js createVegetationSample`) ;
 * ce n'est pas le décor du niveau.
 * @param {{ level?: object, materials?: object }} [options]
 * @returns {THREE.Group}
 */
export function createVegetationSample({ level = LEVEL_1, materials } = {}) {
  const palette = level.palette
  const resolved = materials ?? createVegetationMaterials?.(palette) ?? createMatteMaterials(palette)
  const group = new THREE.Group()
  group.name = 'vegetation-sample'
  const order = ['grass', 'flower', 'bush', 'tree']
  const spacing = [1.5, 1.5, 2.1, 2.4]
  let x = -3.2
  order.forEach((id, index) => {
    if (index) x += spacing[index - 1]
    const material = resolved[id]
    material.vertexColors = true
    material.needsUpdate = true
    const mesh = new THREE.Mesh(FAMILY_GEOMETRIES[id], material)
    mesh.name = `vegetation-${id}`
    mesh.position.set(x, 0, 0)
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  })
  return group
}
