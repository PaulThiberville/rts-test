import * as THREE from 'three'
import { LEVEL_1 } from '../data/level-1.js'
import { createClairiere } from '../entities/clairiere.js'
import { createAmbience } from '../vfx/ambience.js'
import { createJuiceFx } from '../vfx/juice.js'
import { createCameraRig } from './camera-rig.js'
import { createLighting } from './lighting.js'

/** Altitude du disque du cœur, identique à celle posée par la clairière. */
const HEART_Y = 0.03
/** Fenêtre de `state.fx.lastImpact` : la marque du juice s'efface en 0,5 s. */
const FX_IMPACT_WINDOW = 0.5
/** Points du disque projetés à l'écran pour en déduire la boîte englobante. */
const HEART_SAMPLES = 32

/** Familles d'ambiance attendues quand `userData.stats` n'en déclare pas. */
const AMBIENCE_FAMILIES = ['petals', 'fireflies']

/**
 * Bloc de densité du végétal (#114) : instances par m² de `bounds`, total et par famille.
 * Un décor sans densité donne des zéros, jamais une erreur.
 * @param {object} [density]
 */
function readDensity(density) {
  const perFamily = {}
  const source = density?.perFamily
  if (source && typeof source === 'object') {
    for (const [id, value] of Object.entries(source)) {
      if (Number.isFinite(value)) perFamily[id] = value
    }
  }
  return {
    area: Number.isFinite(density?.area) ? density.area : 0,
    total: Number.isFinite(density?.total) ? density.total : 0,
    perFamily,
  }
}

/**
 * Compteurs de décor lisibles par le playtest : familles, effectifs par famille,
 * triangles et draw calls. Un décor sans `families` donne un tableau vide, jamais une erreur.
 * @param {object} [stats]
 * @param {object} [vegetationStats] compteurs de `createVegetation`, source de la densité
 */
function readDecorStats(stats = {}, vegetationStats = {}) {
  const entries = Array.isArray(stats.families) ? stats.families : []
  const families = []
  const counts = {}
  let vegetalsTotal = 0
  let vegetalsCastShadow = 0
  for (const entry of entries) {
    const id = typeof entry === 'string' ? entry : entry?.id
    if (typeof id !== 'string' || Object.hasOwn(counts, id)) continue
    const count = Number.isFinite(entry?.count) ? entry.count : 0
    families.push(id)
    counts[id] = count
    vegetalsTotal += count
    if (entry?.castShadow) vegetalsCastShadow += count
  }
  return {
    families,
    counts,
    vegetalsTotal,
    vegetalsCastShadow,
    triangles: Number.isFinite(stats.triangles) ? stats.triangles : 0,
    drawCalls: Number.isFinite(stats.drawCalls) ? stats.drawCalls : 0,
    density: readDensity(vegetationStats.density),
  }
}

/**
 * Sonde de mouvement : relève la première particule de l'ambiance à chaque image.
 * `true` signifie que sa position a réellement changé depuis la lecture précédente,
 * donc que l'ambiance a bougé sur la dernière image animée.
 * @param {THREE.Object3D} root
 * @returns {() => boolean}
 */
function createMotionProbe(root) {
  let position = null
  root.traverse((object) => {
    if (position || !object.isPoints) return
    const attribute = object.geometry?.attributes?.position
    if (attribute && attribute.count > 0) position = attribute
  })
  let x = 0
  let y = 0
  let z = 0
  let primed = false
  return () => {
    if (!position) return false
    const nx = position.getX(0)
    const ny = position.getY(0)
    const nz = position.getZ(0)
    const moved = primed && (nx !== x || ny !== y || nz !== z)
    x = nx
    y = ny
    z = nz
    primed = true
    return moved
  }
}

/**
 * Libère géométries, matériaux et textures d'un sous-arbre, sans toucher aux lumières.
 * @param {THREE.Object3D} root
 */
function disposeObject(root) {
  root.traverse((object) => {
    object.geometry?.dispose()
    if (!object.material) return
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      for (const value of Object.values(material)) {
        if (value?.isTexture) value.dispose()
      }
      material.dispose()
    }
  })
}

/**
 * Niveau 1 assemblé : clairière, caméra orbitale, juice des événements et état observable.
 * Le groupe porte `update(dt)` (appelé par la boucle du jeu) qui avance la caméra
 * et recalcule la projection du cœur ; le juice avance dans sa propre entité.
 * `state.fx` recopie ses compteurs et `state` reste une copie sérialisable.
 * @param {{ scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer, state: object, add(entity: THREE.Object3D): THREE.Object3D, remove(entity: THREE.Object3D): void }} game
 * @param {{ level?: object }} [options]
 * @returns {{ group: THREE.Group, rig: ReturnType<typeof createCameraRig>, juice: ReturnType<typeof createJuiceFx>, dispose(): void }}
 */
export function createLevel(game, { level = LEVEL_1 } = {}) {
  const { camera, renderer, state } = game
  const domElement = renderer.domElement

  // Le juice est monté avant le rig : la caméra ajoute sa secousse dès la première image.
  const juice = createJuiceFx({ scene: game.scene })
  const rig = createCameraRig({ camera, domElement, level, juice })
  const group = createClairiere({ level })
  game.add(group)

  const lighting = createLighting(game.scene, level, renderer)
  const ambience = createAmbience({ level })
  game.add(ambience)
  const ambienceMoved = createMotionProbe(ambience)

  const decorStats = readDecorStats(
    group.userData.stats,
    group.getObjectByName('vegetation')?.userData.stats,
  )
  const ambienceStats = ambience.userData.stats
  // Mouvement observé sur la dernière image animée ; faux en pause, où `update(dt)` ne tourne plus.
  let ambienceMoving = false
  state.lighting = {
    ...lighting.state,
    vegetalsCastShadow: decorStats.vegetalsCastShadow,
    vegetalsTotal: decorStats.vegetalsTotal,
  }
  state.decor = {
    families: decorStats.families,
    counts: decorStats.counts,
    triangles: decorStats.triangles,
    drawCalls: decorStats.drawCalls,
    density: decorStats.density,
  }
  state.ambience = {
    families: Array.isArray(ambienceStats?.families) && ambienceStats.families.length > 0
      ? [...ambienceStats.families]
      : [...AMBIENCE_FAMILIES],
    get moving() {
      return ambienceMoving && !state.paused
    },
  }

  game.scene.background = new THREE.Color(level.palette.ground)

  state.level = JSON.parse(JSON.stringify({
    id: level.id,
    bounds: level.bounds,
    arrival: level.arrival,
    path: level.path,
    slots: level.slots,
    heart: level.heart,
    camera: level.camera,
    palette: level.palette,
    light: level.light,
    decor: { families: level.decor?.families },
  }))
  state.camera = rig.state

  // Compteurs de juice recopiés dans l'état : chaque événement est compté séparément,
  // et le dernier impact reste exposé le temps que sa marque s'efface (0,5 s).
  const fx = {
    towerPlaced: 0,
    shot: 0,
    kill: 0,
    heartDamage: 0,
    victory: 0,
    lastImpact: null,
  }
  state.fx = fx

  /** Recopie `juice.counters` sans recréer l'objet d'état à chaque image. */
  function syncFx() {
    const counters = juice.counters
    fx.towerPlaced = counters.towerPlaced
    fx.shot = counters.shot
    fx.kill = counters.kill
    fx.heartDamage = counters.heartDamage
    fx.victory = counters.victory
    const last = counters.lastImpact
    if (!last || last.age > FX_IMPACT_WINDOW) {
      fx.lastImpact = null
      return
    }
    if (fx.lastImpact === null) fx.lastImpact = { event: '', x: 0, z: 0, age: 0 }
    fx.lastImpact.event = last.event
    fx.lastImpact.x = last.x
    fx.lastImpact.z = last.z
    fx.lastImpact.age = last.age
  }

  // Chaque déclenchement recopie les compteurs dans la même image : `state.fx` réagit
  // sans attendre la frame suivante, et `lastImpact.age` avance ensuite dans la boucle.
  const spawnJuice = juice.spawn
  juice.spawn = (event, position) => {
    spawnJuice(event, position)
    syncFx()
  }

  // Le juice suit la convention d'entité : un `update(dt)` appelé par la boucle unique.
  juice.group.update = (dt) => {
    juice.update(dt)
    syncFx()
  }
  game.add(juice.group)

  const heartScreen = { x: 0, y: 0, w: 0, h: 0 }
  state.view = { width: 0, height: 0, heartScreen, heartScreenShare: 0 }

  // Positions monde du périmètre du cœur : le disque est statique, calculées une seule fois.
  const heartPoints = []
  for (let i = 0; i < HEART_SAMPLES; i++) {
    const angle = (i / HEART_SAMPLES) * Math.PI * 2
    heartPoints.push(new THREE.Vector3(
      level.heart.x + Math.cos(angle) * level.heart.radius,
      HEART_Y,
      level.heart.z + Math.sin(angle) * level.heart.radius,
    ))
  }
  const projected = new THREE.Vector3()

  /** Projette le disque du cœur et met à jour `state.view` (viewport en pixels CSS). */
  function updateView() {
    const width = domElement.clientWidth || innerWidth
    const height = domElement.clientHeight || innerHeight
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const point of heartPoints) {
      projected.copy(point).project(camera)
      const x = (projected.x * 0.5 + 0.5) * width
      const y = (-projected.y * 0.5 + 0.5) * height
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    heartScreen.x = minX
    heartScreen.y = minY
    heartScreen.w = maxX - minX
    heartScreen.h = maxY - minY
    state.view.width = width
    state.view.height = height
    state.view.heartScreenShare = width > 0 ? heartScreen.w / width : 0
  }

  function update(dt) {
    rig.update(dt)
    updateView()
    ambienceMoving = ambienceMoved()
  }

  function onResize() {
    // Le redimensionnement du renderer est traité avant ce listener : l'aspect est déjà à jour.
    rig.update(0)
    updateView()
  }

  group.update = update
  addEventListener('resize', onResize)
  update(0)

  function dispose() {
    removeEventListener('resize', onResize)
    delete group.update
    delete juice.group.update
    game.remove(group)
    game.remove(ambience)
    game.remove(juice.group)
    lighting.dispose()
    rig.dispose()
    juice.dispose()
    disposeObject(group)
    disposeObject(ambience)
    group.clear()
    ambience.clear()
  }

  return { group, rig, juice, dispose }
}
