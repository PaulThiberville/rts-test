import * as THREE from 'three'
import {
  createShadowMaterial,
  disposeShadowMaterial,
  SILHOUETTE_TINTS,
} from '../materials/shadow.js'

/** Hauteur du corps de la ronde rapportée à son rayon : une ombre basse, posée au sol. */
const BODY_HEIGHT = 0.58

/** Durées et amplitudes du rebond d'impact, réglées pour rester feutrées. */
const HIT_DURATION = 0.12
const HIT_SQUASH = 0.22
const HIT_WIDEN = 0.09
const HIT_GLOW = 0.6

/** Fondu de mort : disparition complète en moins de 0,3 s. */
const DEATH_DURATION = 0.28

/** Teinte du flash d'impact : le rose danger de la DA, en émissif doux. */
const HIT_GLOW_COLOR = '#e8907f'

/** Yeux clairs : blanc chaud, sans éclairage, lisibles même sur petit écran. */
const EYE_COLOR = '#fdf6e3'

/** Inclinaison de repos des longues oreilles, en radians, vers l'extérieur. */
const EAR_TILT = 0.2

/**
 * Maillages unitaires, créés une fois au chargement du module et partagés par toutes les
 * ombres : l'échelle et la place de chaque pièce vivent sur le maillage, jamais sur la
 * géométrie. Les oreilles et les pattes ont leur pivot à la base, pour se balancer sans
 * sortir de leur axe.
 */
const BODY_GEOMETRY = new THREE.SphereGeometry(1, 14, 8)
const EYE_GEOMETRY = new THREE.SphereGeometry(1, 6, 4)
const EAR_GEOMETRY = new THREE.SphereGeometry(1, 8, 6).translate(0, 1, 0)
const LEG_GEOMETRY = new THREE.SphereGeometry(1, 8, 6).translate(0, -1, 0)

/**
 * Profils des trois silhouettes, en rayons : largeur et hauteur totales de la boîte
 * englobante au repos. Chaque paire diffère de plus de 15 % sur au moins une mesure, donc
 * les trois se distinguent côte à côte à un mètre :
 *   ronde    2,00 × 1,16 — basse et large, la plus accueillante
 *   oreillue 1,55 × 2,22 — oreilles hautes sur un corps large
 *   haute    1,00 × 2,89 — fine et longiligne, la plus menaçante
 *   ronde ↔ oreillue −22 % de largeur ; ronde ↔ haute −50 % ; oreillue ↔ haute −35 %
 */
const PROFILES = {
  ronde: { width: 2, height: 1.16 },
  oreillue: { width: 1.55, height: 2.22 },
  haute: { width: 1, height: 2.89 },
}

/**
 * Marche : un seul élément animé par variante, et une période propre à chacune (0,6 à
 * 1,2 s) pour que trois silhouettes côte à côte ne battent jamais ensemble.
 * - `offset` : phase de départ en fraction de période ; celle de la ronde est calée pour
 *   que la vitrine surprenne un clignement à 0,4 s.
 * - Déplacements des oreilles et des pattes ≤ 0,1 × rayon. `shut` est la hauteur restante
 *   des yeux au milieu du clignement : une proportion, pas un déplacement.
 */
const WALK = {
  ronde: { period: 0.9, offset: 0.62, close: 0.12, shut: 0.28 },
  oreillue: { period: 1.2, offset: 0.55, sway: 0.06 },
  haute: { period: 0.6, offset: 0.15, stride: 0.09, lift: 0.09 },
}

/**
 * Anime l'élément de marche propre à la variante. Aucune allocation : seules les
 * transformations des pièces déjà construites changent.
 * @param {'ronde' | 'oreillue' | 'haute'} kind
 * @param {{ eyes: Array, ears: Array, legs: Array }} parts
 * @param {number} time secondes depuis le premier pas
 * @param {number} size rayon de l'ombre
 */
function animateWalk(kind, parts, time, size) {
  const walk = WALK[kind]

  if (kind === 'ronde') {
    const cycle = time % walk.period
    const shut = cycle < walk.close ? Math.sin((Math.PI * cycle) / walk.close) : 0
    const height = 1 - (1 - walk.shut) * shut
    for (const eye of parts.eyes) eye.mesh.scale.y = eye.height * height
    return
  }

  if (kind === 'oreillue') {
    const sway = Math.sin((Math.PI * 2 * time) / walk.period) * walk.sway
    for (const ear of parts.ears) ear.mesh.rotation.z = ear.tilt + ear.side * sway
    return
  }

  // Pattes : ellipse de marche, jambe gauche et jambe droite décalées d'une demi-période.
  const phase = (Math.PI * 2 * time) / walk.period
  for (const leg of parts.legs) {
    const step = phase + (leg.side < 0 ? 0 : Math.PI)
    leg.mesh.position.z = Math.cos(step) * walk.stride * size
    leg.mesh.position.y = leg.hip + (walk.lift * size * (1 + Math.sin(step))) / 2
  }
}

/**
 * Ombre hostile : masse ronde et basse, deux yeux clairs à l'avant (-Z), déclinée en trois
 * silhouettes (`ronde`, `oreillue`, `haute`) qui partagent la même teinte froide de la
 * Direction-Artistique. Le groupe est posé à l'origine au sol ; l'appelant pilote
 * `position` et l'orientation. Rien n'est alloué après la construction.
 * @param {{ radius?: number, variant?: 'ronde' | 'oreillue' | 'haute' }} [options]
 * @returns {{
 *   group: THREE.Group,
 *   playHit(): void,
 *   playDeath(): void,
 *   update(dt: number): void,
 *   dispose(): void,
 *   resetWalk(): void,
 * }}
 */
export function createShadow({ radius = 0.35, variant = 'ronde' } = {}) {
  const size = Number.isFinite(radius) && radius > 0 ? radius : 0.35
  const kind = variant === 'oreillue' || variant === 'haute' ? variant : 'ronde'

  const group = new THREE.Group()
  group.name = 'shadow'
  group.userData = { radius: size, silhouette: kind }

  const material = createShadowMaterial({ color: SILHOUETTE_TINTS[kind] })
  material.emissive.set(HIT_GLOW_COLOR)

  const parts = { eyes: [], ears: [], legs: [] }

  const eyeMaterial = new THREE.MeshBasicMaterial({ color: EYE_COLOR, toneMapped: false })

  /** Ajoute une pièce au groupe ; une ombre ne projette ni ne reçoit d'ombre portée. */
  function addMesh(geometry, name, customMaterial = material) {
    const mesh = new THREE.Mesh(geometry, customMaterial)
    mesh.name = name
    mesh.castShadow = false
    mesh.receiveShadow = false
    group.add(mesh)
    return mesh
  }

  /** Paire d'yeux clairs à l'avant (-Z), dimensions exprimées en rayons. */
  function addEyes({ x, y, z, width, height, depth }) {
    for (const side of [-1, 1]) {
      const eye = addMesh(EYE_GEOMETRY, side < 0 ? 'shadow-eye-left' : 'shadow-eye-right', eyeMaterial)
      const eyeHeight = size * height
      eye.scale.set(size * width, eyeHeight, size * depth)
      eye.position.set(side * size * x, size * y, -size * z)
      parts.eyes.push({ mesh: eye, height: eyeHeight })
    }
  }

  if (kind === 'ronde') {
    const body = addMesh(BODY_GEOMETRY, 'shadow-body')
    body.scale.set(size, size * BODY_HEIGHT, size)
    body.position.y = size * BODY_HEIGHT
    addEyes({ x: 0.3, y: 0.72, z: 0.92, width: 0.14, height: 0.18, depth: 0.07 })
  } else if (kind === 'oreillue') {
    const body = addMesh(BODY_GEOMETRY, 'shadow-body')
    body.scale.set(size * 0.66, size * 0.5, size * 0.62)
    body.position.y = size * 0.5
    addEyes({ x: 0.22, y: 0.6, z: 0.57, width: 0.13, height: 0.17, depth: 0.07 })

    // Deux longues oreilles de 1,6 rayon, pivot à leur base pour le balancement.
    for (const side of [-1, 1]) {
      const ear = addMesh(EAR_GEOMETRY, side < 0 ? 'shadow-ear-left' : 'shadow-ear-right')
      ear.scale.set(size * 0.16, size * 0.8, size * 0.14)
      ear.position.set(side * size * 0.3, size * 0.62, 0)
      const tilt = -side * EAR_TILT
      ear.rotation.z = tilt
      parts.ears.push({ mesh: ear, tilt, side })
    }
  } else {
    // Haute : corps longiligne posé sur deux petites pattes, tête ronde au sommet.
    const body = addMesh(BODY_GEOMETRY, 'shadow-body')
    body.scale.set(size * 0.5, size * 0.85, size * 0.45)
    body.position.y = size * 1.5

    const head = addMesh(BODY_GEOMETRY, 'shadow-head')
    head.scale.set(size * 0.38, size * 0.34, size * 0.36)
    head.position.y = size * 2.55
    addEyes({ x: 0.15, y: 2.58, z: 0.33, width: 0.11, height: 0.14, depth: 0.06 })

    const hip = size * 0.76
    for (const side of [-1, 1]) {
      const leg = addMesh(LEG_GEOMETRY, side < 0 ? 'shadow-leg-left' : 'shadow-leg-right')
      leg.scale.set(size * 0.13, size * 0.38, size * 0.12)
      leg.position.set(side * size * 0.22, hip, 0)
      parts.legs.push({ mesh: leg, hip, side })
    }
  }

  let walkTime = WALK[kind].offset * WALK[kind].period
  let hitTime = -1
  let deathTime = -1
  let dead = false
  let disposed = false

  /** Rebond d'impact : écrasement bref et flash émissif, relançable à zéro. */
  function playHit() {
    if (dead || deathTime >= 0) return
    hitTime = 0
  }

  /** Réduction d'échelle jusqu'à disparition ; l'état mort ne se réanime pas. */
  function playDeath() {
    if (dead) return
    hitTime = -1
    deathTime = 0
    group.scale.set(1, 1, 1)
    material.emissiveIntensity = 0
    group.visible = true
  }

  /** Remet la marche à son premier pas, phase de la variante comprise. */
  function resetWalk() {
    walkTime = WALK[kind].offset * WALK[kind].period
  }

  /** Anime la marche, puis l'impact ou la mort ; l'échelle du groupe reste à l'impact. */
  function update(dt) {
    if (dead || dt <= 0) return

    if (deathTime >= 0) {
      deathTime += dt
      const progress = deathTime >= DEATH_DURATION ? 1 : deathTime / DEATH_DURATION
      const remaining = 1 - progress * progress
      group.scale.set(remaining, remaining, remaining)
      if (progress >= 1) {
        group.visible = false
        dead = true
      }
      return
    }

    walkTime += dt
    animateWalk(kind, parts, walkTime, size)

    if (hitTime < 0) return
    hitTime += dt
    const progress = hitTime >= HIT_DURATION ? 1 : hitTime / HIT_DURATION
    const wave = Math.sin(Math.PI * progress)
    group.scale.set(1 + HIT_WIDEN * wave, 1 - HIT_SQUASH * wave, 1 + HIT_WIDEN * wave)
    material.emissiveIntensity = HIT_GLOW * wave
    if (progress >= 1) {
      hitTime = -1
      group.scale.set(1, 1, 1)
      material.emissiveIntensity = 0
    }
  }

  /**
   * Libère les matériaux possédés ; idempotent. Les maillages sont communs au module et
   * restent en mémoire : une ombre ne possède que ses deux matériaux.
   */
  function dispose() {
    if (disposed) return
    disposed = true
    disposeShadowMaterial(material)
    eyeMaterial.dispose()
  }

  return { group, playHit, playDeath, update, dispose, resetWalk }
}

/** Rayon de l'étalon : les silhouettes du jeu grossies d'un tiers, pour juger de près. */
const SAMPLE_RADIUS = 0.55

/** Sol de l'étalon : la clairière, sur laquelle les teintes froides se lisent comme en jeu. */
const SAMPLE_GROUND = '#faf3e3'

/**
 * Rangée de l'étalon : ordre de lecture et quinconce en profondeur. Décaler chaque
 * silhouette d'un tiers de mètre évite que la vue de profil n'en empile deux derrière la
 * troisième (leçon de l'étalon de `src/materials/shadow.js`).
 */
const SAMPLE_ROW = [
  { id: 'ronde', z: 0.44 },
  { id: 'oreillue', z: 0 },
  { id: 'haute', z: -0.44 },
]

/**
 * Range les trois silhouettes côte à côte sur une dalle de clairière, faces tournées vers
 * la caméra de vitrine (+Z, le jeu regarde -Z). L'espacement suit la largeur mesurée de
 * chaque profil : aucune silhouette n'en masque une autre.
 * @returns {{ group: THREE.Group, shadows: Array<ReturnType<typeof createShadow>> }}
 */
function buildSilhouetteRow() {
  const widths = SAMPLE_ROW.map(({ id }) => PROFILES[id].width * SAMPLE_RADIUS)
  const gap = 0.18
  const total = widths.reduce((sum, width) => sum + width, 0) + gap * (SAMPLE_ROW.length - 1)

  const group = new THREE.Group()
  group.name = 'shadow-sample'

  const ground = new THREE.Mesh(
    new THREE.BoxGeometry(total + 0.5, 0.02, 1.8),
    new THREE.MeshBasicMaterial({ color: SAMPLE_GROUND, toneMapped: false }),
  )
  ground.position.y = 0.01
  ground.name = 'sample-ground'
  group.add(ground)

  const shadows = []
  let x = -total / 2
  SAMPLE_ROW.forEach(({ id, z }, index) => {
    x += widths[index] / 2
    const shadow = createShadow({ radius: SAMPLE_RADIUS, variant: id })
    shadow.group.position.set(x, 0.021, z)
    shadow.group.rotation.y = Math.PI
    group.add(shadow.group)
    shadows.push(shadow)
    x += widths[index] / 2 + gap
  })

  return { group, shadows }
}

/**
 * Étalon de vitrine : les trois silhouettes côte à côte, pour juger proportions, teintes et
 * rondeur sous quatre angles. Sert à
 * `npm run showcase src/entities/shadow.js createShadowSample` ; ce n'est pas la scène du jeu.
 * @returns {THREE.Group}
 */
export function createShadowSample() {
  return buildSilhouetteRow().group
}

/**
 * Étalon animé : la même rangée, sur le chemin « effet » de la vitrine, qui capture à
 * 0,15 / 0,4 / 0,8 s. `burst()` remet les trois marches au premier pas ; un instant tombe
 * au milieu du clignement de la ronde, un autre sur le balancement des oreilles.
 * Sert à `npm run showcase src/entities/shadow.js createShadowWalkSample` ; ce n'est pas la scène du jeu.
 * @returns {THREE.Group}
 */
export function createShadowWalkSample() {
  const { group, shadows } = buildSilhouetteRow()

  group.burst = () => {
    for (const shadow of shadows) shadow.resetWalk()
  }
  group.update = (dt) => {
    for (const shadow of shadows) shadow.update(dt)
  }

  return group
}
