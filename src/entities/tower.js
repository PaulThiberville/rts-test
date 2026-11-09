import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import {
  createTowerMaterial,
  createGhostMaterial,
  createSlotMaterial,
  createSelectionMaterial,
} from '../materials/tower.js'

/** Facteur de croissance du niveau 2 : la tour gagne en hauteur sans perdre ses rondeurs. */
const GROWTH = { sprout: 1.36, bloom: 1.4 }

/** Raycast neutralisé : un fantôme ne capte ni ne bloque les clics. */
const IGNORE_RAYCAST = () => {}

/**
 * Profils de révolution (rayon, hauteur) de la tige et du bulbe, en unités du niveau 1.
 * Base au sol, sommet arrondi : une seule masse ronde, sans arête agressive.
 */
const BODY_PROFILES = {
  sprout: [
    [0, 0], [0.18, 0], [0.25, 0.05], [0.3, 0.15], [0.3, 0.27],
    [0.25, 0.37], [0.18, 0.45], [0.12, 0.52], [0.095, 0.62],
    [0.085, 0.75], [0.09, 0.87], [0.07, 0.95], [0.05, 1.0], [0, 1.02],
  ],
  bloom: [
    [0, 0], [0.17, 0], [0.24, 0.05], [0.29, 0.15], [0.29, 0.26],
    [0.24, 0.35], [0.17, 0.42], [0.11, 0.5], [0.08, 0.6],
    [0.072, 0.72], [0.085, 0.8], [0.06, 0.86], [0, 0.88],
  ],
}

/**
 * Pétale ou feuille : ellipsoïde aplati dont la base part du rayon `from` et
 * dont la pointe s'élève de `tilt` radians. La forme est volontairement ronde.
 */
function blade({ length, width, thickness = 0.045, angle = 0, y = 0, tilt = 0.5, from = 0 }) {
  const geometry = new THREE.SphereGeometry(1, 9, 6)
  geometry.scale(width, thickness, length / 2)
  geometry.translate(0, 0, from + length / 2)
  geometry.rotateX(-tilt)
  geometry.rotateY(angle)
  geometry.translate(0, y, 0)
  return geometry
}

/** Couronne de feuilles ou de pétales réparties en cercle. */
function crown({ count, offset = 0, ...shape }) {
  const blades = []
  for (let i = 0; i < count; i++) {
    blades.push(blade({ ...shape, angle: offset + (i / count) * Math.PI * 2 }))
  }
  return blades
}

/** Masse principale (bulbe et tige) du niveau demandé, base posée à y = 0. */
function bodyGeometry(type, level) {
  const growth = level > 1 ? GROWTH[type] : 1
  const spread = level > 1 ? 1.04 : 1
  const points = BODY_PROFILES[type].map(([radius, height]) =>
    new THREE.Vector2(radius * spread, height * growth),
  )
  return new THREE.LatheGeometry(points, 14)
}

/** Feuillage du type et du niveau demandés, ou `null` si la tour n'en porte pas. */
function foliageGeometry(type, level) {
  const blades = []
  if (type === 'sprout') {
    if (level === 1) {
      blades.push(...crown({ count: 3, y: 0.52, length: 0.42, width: 0.12, tilt: 1.05, from: 0.05 }))
    } else {
      blades.push(...crown({ count: 5, y: 0.72, length: 0.5, width: 0.12, tilt: 0.7, from: 0.06 }))
      blades.push(...crown({ count: 3, offset: Math.PI / 3, y: 1.04, length: 0.38, width: 0.1, tilt: 1.1, from: 0.04 }))
    }
  } else if (level === 1) {
    blades.push(...crown({ count: 2, y: 0.5, length: 0.34, width: 0.08, tilt: 1.0, from: 0.02 }))
  } else {
    blades.push(...crown({ count: 2, y: 0.65, length: 0.42, width: 0.09, tilt: 0.95, from: 0.02 }))
  }
  return blades.length ? mergeGeometries(blades, false) : null
}

/** Fleur de la floraison : cœur rond et pétales, de plus en plus ouverts au niveau 2. */
function bloomGeometry(level) {
  const centerRadius = level === 1 ? 0.14 : 0.18
  const centerY = level === 1 ? 0.97 : 1.34
  const parts = [new THREE.SphereGeometry(centerRadius, 12, 8).scale(1, 0.85, 1).translate(0, centerY, 0)]
  if (level === 1) {
    parts.push(...crown({ count: 6, y: centerY, length: 0.28, width: 0.115, thickness: 0.04, tilt: 0.55, from: 0.09 }))
  } else {
    parts.push(...crown({ count: 8, y: centerY, length: 0.36, width: 0.13, thickness: 0.04, tilt: 0.4, from: 0.13 }))
    parts.push(...crown({ count: 6, offset: Math.PI / 8, y: centerY - 0.07, length: 0.26, width: 0.1, thickness: 0.04, tilt: 0.95, from: 0.1 }))
  }
  return mergeGeometries(parts, false)
}

/** Ajoute un maillage au groupe en partageant le matériau de la tour. */
function addPart(group, geometry, material) {
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = `${group.name}-part-${group.children.length + 1}`
  group.add(mesh)
}

/**
 * Construit la tour complète : 2 ou 3 maillages, un seul matériau créé par la fabrique.
 * Rien n'est alloué après la construction.
 */
function buildTower(type, level, material) {
  const group = new THREE.Group()
  group.name = 'tower'
  group.userData = { type, level }

  const parts = [bodyGeometry(type, level)]
  if (type === 'sprout' && level > 1) {
    // Petit bourgeon au sommet : la pousse du niveau 2 se referme sur un bouton tendre.
    parts.push(new THREE.SphereGeometry(0.06, 8, 6).translate(0, 1.4, 0))
  }
  addPart(group, mergeGeometries(parts, false), material)

  const foliage = foliageGeometry(type, level)
  if (foliage) addPart(group, foliage, material)

  if (type === 'bloom') addPart(group, bloomGeometry(level), material)
  return group
}

/**
 * Tour-plante posée : silhouette ronde et compacte, niveau 2 plus haute et plus ouverte.
 * Le matériau appartient à la tour et sera libéré par `disposeTower`.
 * @param {{ type?: 'sprout' | 'bloom', level?: number }} [options]
 * @returns {THREE.Group}
 */
export function createTower({ type = 'sprout', level = 1 } = {}) {
  const kind = type === 'bloom' ? 'bloom' : 'sprout'
  const tier = Math.min(2, Math.max(1, Math.round(level)))
  const material = createTowerMaterial({ type: kind, level: tier })
  material.userData.disposeWithTower = true
  return buildTower(kind, tier, material)
}

/**
 * Aperçu de pose : géométrie du niveau 1, matériau translucide, clics traversants.
 * @param {{ type?: 'sprout' | 'bloom' }} [options]
 * @returns {THREE.Group}
 */
export function createTowerGhost({ type = 'sprout' } = {}) {
  const kind = type === 'bloom' ? 'bloom' : 'sprout'
  const material = createGhostMaterial()
  material.userData.disposeWithTower = true
  const group = buildTower(kind, 1, material)
  group.name = 'tower-ghost'
  // Posé un cheveu au-dessus du sol : le fond translucide ne scintille pas contre la clairière.
  group.position.y = 0.01
  group.userData = { type: kind, ghost: true }
  group.traverse((object) => {
    object.raycast = IGNORE_RAYCAST
    object.castShadow = false
    object.receiveShadow = false
  })
  return group
}

/** Anneau plat posé juste au-dessus du sol, insensible à la profondeur. */
function ringGeometry(inner, outer) {
  return new THREE.RingGeometry(inner, outer, 56).rotateX(-Math.PI / 2)
}

/**
 * Emplacement libre : double anneau doré discret, renforcé au survol.
 * @param {{ radius?: number }} [options]
 * @returns {{ group: THREE.Group, setHighlight(on: boolean): void, dispose(): void }}
 */
export function createSlotMarker({ radius = 1.1 } = {}) {
  const group = new THREE.Group()
  group.name = 'slot-marker'

  const geometry = mergeGeometries([
    ringGeometry(radius * 0.86, radius),
    ringGeometry(radius * 0.6, radius * 0.65),
  ], false)
  const rest = createSlotMaterial()
  const highlight = createSlotMaterial({ highlight: true })
  rest.userData.disposeWithTower = true
  highlight.userData.disposeWithTower = true

  const mesh = new THREE.Mesh(geometry, rest)
  mesh.name = 'slot-marker-ring'
  mesh.position.y = 0.02
  group.add(mesh)

  function setHighlight(on) {
    const material = on ? highlight : rest
    if (mesh.material !== material) mesh.material = material
  }

  function dispose() {
    group.remove(mesh)
    geometry.dispose()
    rest.dispose()
    highlight.dispose()
  }

  return { group, setHighlight, dispose }
}

/**
 * Halo de sélection de la tour active : anneau doré franc, posé au-dessus du sol.
 * @param {{ radius?: number }} [options]
 * @returns {THREE.Group}
 */
export function createSelectionMarker({ radius = 1.0 } = {}) {
  const group = new THREE.Group()
  group.name = 'selection-marker'

  const geometry = ringGeometry(radius * 0.85, radius)
  const material = createSelectionMaterial()
  material.userData.disposeWithTower = true

  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = 'selection-marker-ring'
  mesh.position.y = 0.025
  group.add(mesh)
  return group
}

/**
 * Libère géométries et matériaux possédés par la tour. Un matériau partagé
 * (créé ailleurs, sans marque de propriété) est laissé intact.
 * @param {THREE.Object3D} object
 */
export function disposeTower(object) {
  const geometries = new Set()
  const materials = new Set()
  object.traverse((child) => {
    if (child.geometry) geometries.add(child.geometry)
    if (!child.material) return
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
      materials.add(material)
    }
  })
  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) {
    if (material.userData?.disposeWithTower) material.dispose()
  }
}
