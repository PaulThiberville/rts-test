import * as THREE from 'three'
import { createImpactMarkMaterial, disposeProjectileMaterial } from '../materials/projectile.js'

/**
 * Juice des événements : un `THREE.Points` unique (24 points au plus) pour les gerbes et
 * un seul maillage pour la marque d'impact, qui porte le matériau de #138.
 * Draw calls ajoutés : **2** pour une gerbe avec sa marque, **1** pour la marque seule.
 * Tous les tampons sont alloués une fois : `update(dt)` ne crée aucun objet.
 */

/** Capacité fixe du pool de particules : le budget du ticket. */
const CAPACITY = 24

/** Marque d'impact au sol : durée de vie, rayon, fondu d'apparition et plateau. */
const MARK_LIFE = 0.5
const MARK_RADIUS = 0.72
const MARK_FADE_IN = 0.075
/** Plateau à pleine opacité avant l'effacement : la marque « reste visible puis s'efface ». */
const MARK_HOLD = 0.45

/**
 * Secousse : enveloppe unique, jamais cumulée ; durée sous le plafond de 180 ms.
 * Facteurs 0,42 et 0,8 : la norme du décalage culmine à 0,05 × 0,9 = 0,045 < 0,06.
 */
const SHAKE_AMPLITUDE = 0.05
const SHAKE_DURATION = 0.18

/** Hauteur par défaut d'un point d'impact quand l'appelant n'en fournit pas. */
const DEFAULT_IMPACT_Y = 0.35

/** Décalage de la marque au-dessus du sol : jamais de conflit de profondeur avec le chemin. */
const MARK_Y = 0.04

/**
 * Réglages par événement, tirés de la direction artistique : teintes pastel, gerbe courte,
 * aucun mouvement agressif. `life` ≤ 0,15 s pour toutes les familles.
 */
const EVENTS = {
  towerPlaced: {
    particles: 9,
    life: 0.15,
    speed: [0.9, 4.6],
    lift: [1.2, 3.4],
    spread: 0.7,
    gravity: 6.5,
    drag: 3.2,
    size: [0.3, 0.17],
    bounce: false,
    tints: ['#6ec6b5', '#a9e0d2', '#faf3e3'],
    mark: { scale: 0.9, fade: 0.8 },
  },
  shot: {
    particles: 1,
    life: 0.15,
    speed: [0, 0],
    lift: [0.5, 0.9],
    spread: 0,
    gravity: 2.5,
    drag: 0,
    size: [0.3, 0.3],
    bounce: true,
    tints: ['#f3dce6', '#e8907f'],
    mark: { scale: 0.5, fade: 0.5 },
  },
  kill: {
    particles: 14,
    life: 0.15,
    speed: [1.2, 8],
    lift: [1, 4.5],
    spread: 0.95,
    gravity: 8.5,
    drag: 2.5,
    size: [0.36, 0.2],
    bounce: false,
    tints: ['#e8907f', '#f0d6de', '#e6bacb'],
    mark: { scale: 1.1, fade: 1 },
  },
  heartDamage: {
    particles: 1,
    life: 0.15,
    speed: [0, 0],
    lift: [1.1, 1.1],
    spread: 0,
    gravity: 3.5,
    drag: 0,
    size: [0.8, 0.8],
    bounce: true,
    tints: ['#e8907f'],
    mark: { scale: 1.35, fade: 1 },
  },
  victory: {
    particles: 18,
    life: 0.15,
    speed: [1.2, 7],
    lift: [1.4, 5],
    spread: 0.75,
    gravity: 8,
    drag: 2.6,
    size: [0.36, 0.22],
    bounce: false,
    tints: ['#f2c66d', '#faf3e3', '#f0d6de'],
    // Célébration : gerbe dorée seule, aucune marque d'impact au sol.
    mark: null,
  },
}

/** RNG déterministe mulberry32 : même gerbe, mêmes captures. */
function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const smoothstep = (t) => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t
  return x * x * (3 - 2 * x)
}

/** Sprite de particule : cœur net, halo très court, jamais de carré visible. */
function createSparkTexture() {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  const center = size / 2
  const gradient = context.createRadialGradient(center, center, 0, center, center, center)
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)')
  gradient.addColorStop(0.34, 'rgba(255, 255, 255, 0.88)')
  gradient.addColorStop(0.68, 'rgba(255, 255, 255, 0.34)')
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/**
 * Sprite de marque : tache ronde et douce, six lobes discrets, aucun bord net.
 * Le blanc ne sert que de masque, la teinte vient de la couleur du matériau.
 */
function createMarkTexture() {
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  const center = size / 2
  const core = context.createRadialGradient(center, center, 0, center, center, center * 0.96)
  core.addColorStop(0, 'rgba(255, 255, 255, 1)')
  core.addColorStop(0.4, 'rgba(255, 255, 255, 0.72)')
  core.addColorStop(0.78, 'rgba(255, 255, 255, 0.24)')
  core.addColorStop(1, 'rgba(255, 255, 255, 0)')
  context.fillStyle = core
  context.beginPath()
  context.arc(center, center, center * 0.96, 0, Math.PI * 2)
  context.fill()

  // Six lobes à peine plus denses : la tache respire, elle n'est pas un disque parfait.
  const lobes = [0.15, 1.2, 2.25, 3.3, 4.35, 5.4]
  for (const angle of lobes) {
    const x = center + Math.cos(angle) * center * 0.42
    const y = center + Math.sin(angle) * center * 0.42
    const lobe = context.createRadialGradient(x, y, 0, x, y, center * 0.32)
    lobe.addColorStop(0, 'rgba(255, 255, 255, 0.22)')
    lobe.addColorStop(1, 'rgba(255, 255, 255, 0)')
    context.fillStyle = lobe
    context.beginPath()
    context.arc(x, y, center * 0.32, 0, Math.PI * 2)
    context.fill()
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/**
 * Points de juice : taille en mètres via `aSize`, opacité par particule via `aAlpha`,
 * couleur par particule via l'attribut `color`. Un seul matériau, un seul draw call.
 * Pas d'`AdditiveBlending` : sur le sol crème de la clairière (#faf3e3) il délave les
 * roses ; le mélange normal garde les pastels lisibles.
 * @param {THREE.Texture} map
 */
function createPointsMaterial(map) {
  const material = new THREE.PointsMaterial({
    size: 1,
    map,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    sizeAttenuation: true,
    toneMapped: false,
  })
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSize;\nattribute float aAlpha;\nvarying float vAlpha;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAlpha = aAlpha;')
      // `projectionMatrix[1][1]` = 1/tan(fov/2) : `aSize` reste une taille en mètres,
      // identique à celle d'un maillage, quelle que soit la caméra.
      .replace('gl_PointSize = size;', 'gl_PointSize = size * aSize * projectionMatrix[1][1];')
      .replace(
        'gl_PointSize *= ( scale / - mvPosition.z );',
        'gl_PointSize = max( gl_PointSize * ( scale / - mvPosition.z ), 2.0 );',
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vAlpha;')
      .replace('#include <map_particle_fragment>', '#include <map_particle_fragment>\ndiffuseColor.a *= vAlpha;')
  }
  material.customProgramCacheKey = () => 'juice-points-size'
  return material
}

/**
 * Effets de juice de la clairière. Sans allocation par frame ; tous les objets sont
 * recyclés et `dispose()` libère matériaux, géométries et textures.
 *
 * @param {{ scene?: THREE.Object3D, seed?: number }} [options] `scene` ajoute le groupe
 *   (facultatif : `group` est aussi renvoyé pour que l'appelant le monte lui-même).
 * @returns {{
 *   spawn(event: string, position?: THREE.Vector3 | { x: number, y?: number, z: number }): void,
 *   update(dt: number): void,
 *   shake(): { x: number, y: number, z: number },
 *   counters: { towerPlaced: number, shot: number, kill: number, heartDamage: number, victory: number, lastImpact: { event: string, x: number, z: number, age: number } | null },
 *   group: THREE.Group,
 *   dispose(): void,
 * }}
 */
export function createJuiceFx({ scene, seed = 11 } = {}) {
  const random = mulberry32(seed)

  // --- Particules : tampons fixes, un seul Points ---------------------------
  const positions = new Float32Array(CAPACITY * 3)
  const colors = new Float32Array(CAPACITY * 3)
  const sizes = new Float32Array(CAPACITY)
  const alphas = new Float32Array(CAPACITY)
  const velocities = new Float32Array(CAPACITY * 3)
  const ages = new Float32Array(CAPACITY)
  const lives = new Float32Array(CAPACITY)
  const startSizes = new Float32Array(CAPACITY)
  const endSizes = new Float32Array(CAPACITY)
  const gravities = new Float32Array(CAPACITY)
  const drags = new Float32Array(CAPACITY)
  const bounces = new Uint8Array(CAPACITY)
  let cursor = 0

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1))

  const sparkTexture = createSparkTexture()
  const pointsMaterial = createPointsMaterial(sparkTexture)
  const points = new THREE.Points(geometry, pointsMaterial)
  points.name = 'juice-sparks'
  points.frustumCulled = false
  points.renderOrder = 4
  points.raycast = () => {}
  points.visible = false

  // --- Marque d'impact : un seul maillage recyclé --------------------------
  // Matériau de #138 (MeshBasicMaterial translucide) : `opacity` pilote la disparition,
  // `color` reste sa teinte danger. La tache douce vient de notre masque, posé en `map`.
  const markMaterial = createImpactMarkMaterial()
  const markMap = createMarkTexture()
  markMaterial.map = markMap
  markMaterial.needsUpdate = true
  /** Plafond propre au juice : l'opacité de départ du matériau de #138 (0,55). */
  const markPeak = markMaterial.opacity
  const markGeometry = new THREE.CircleGeometry(MARK_RADIUS, 40)
  markGeometry.rotateX(-Math.PI / 2)
  const mark = new THREE.Mesh(markGeometry, markMaterial)
  mark.name = 'juice-mark'
  mark.renderOrder = 3
  mark.position.y = MARK_Y
  mark.visible = false
  mark.raycast = () => {}

  let markAge = MARK_LIFE
  let markScale = 1
  let markFade = 1
  /** Valeurs absolues reprises d'un impact précédent : le fondu repart de là, sans saut. */
  let markEntryOpacity = 0
  let markEntryScale = 0

  // --- Secousse : une seule enveloppe, remplacée à chaque déclenchement -----
  let shakeAge = SHAKE_DURATION
  const shakeOffset = { x: 0, y: 0, z: 0 }

  const tint = new THREE.Color()

  const counters = {
    towerPlaced: 0,
    shot: 0,
    kill: 0,
    heartDamage: 0,
    victory: 0,
    lastImpact: null,
  }

  let disposed = false

  /** Écrit une particule dans le pool, en écrasant la plus ancienne quand il est plein. */
  function emitParticle(spec, x, y, z) {
    const i = cursor
    cursor = (cursor + 1) % CAPACITY
    const i3 = i * 3

    positions[i3] = x
    positions[i3 + 1] = y
    positions[i3 + 2] = z

    if (spec.bounce) {
      // Rebond d'échelle : le point naît petit, gonfle à mi-vie, retombe.
      velocities[i3] = 0
      velocities[i3 + 1] = spec.lift[0] + random() * (spec.lift[1] - spec.lift[0])
      velocities[i3 + 2] = 0
    } else {
      const angle = random() * Math.PI * 2
      const speed = spec.speed[0] + random() * (spec.speed[1] - spec.speed[0])
      velocities[i3] = Math.cos(angle) * speed * spec.spread
      velocities[i3 + 1] = spec.lift[0] + random() * (spec.lift[1] - spec.lift[0])
      velocities[i3 + 2] = Math.sin(angle) * speed * spec.spread
    }

    tint.set(spec.tints[i % spec.tints.length]).multiplyScalar(0.94 + random() * 0.12)
    colors[i3] = tint.r
    colors[i3 + 1] = tint.g
    colors[i3 + 2] = tint.b

    ages[i] = 0
    // Durée légèrement dispersée : la gerbe se dissipe, elle ne s'éteint pas d'un coup.
    lives[i] = spec.life * (0.82 + random() * 0.18)
    startSizes[i] = spec.size[0] * (0.82 + random() * 0.36)
    endSizes[i] = spec.size[1] * (0.82 + random() * 0.36)
    gravities[i] = spec.gravity
    drags[i] = spec.drag
    bounces[i] = spec.bounce ? 1 : 0
    sizes[i] = spec.bounce ? startSizes[i] * 0.5 : startSizes[i]
    alphas[i] = 1
  }

  /**
   * Déclenche le retour visuel d'un événement.
   * @param {'towerPlaced' | 'shot' | 'kill' | 'heartDamage' | 'victory'} event
   * @param {THREE.Vector3 | { x: number, y?: number, z: number }} [position]
   */
  function spawn(event, position) {
    if (disposed) return
    const spec = EVENTS[event]
    if (!spec) return

    const x = Number.isFinite(position?.x) ? position.x : 0
    const y = Number.isFinite(position?.y) ? position.y : DEFAULT_IMPACT_Y
    const z = Number.isFinite(position?.z) ? position.z : 0

    counters[event] += 1

    // `lastImpact` est réutilisé : seul `age` bouge, aucun objet n'est recréé.
    const lastImpact = counters.lastImpact
    if (lastImpact) {
      lastImpact.event = event
      lastImpact.x = x
      lastImpact.z = z
      lastImpact.age = 0
    } else {
      counters.lastImpact = { event, x, z, age: 0 }
    }

    for (let n = 0; n < spec.particles; n++) emitParticle(spec, x, y, z)
    points.visible = true
    geometry.attributes.color.needsUpdate = true
    geometry.attributes.aSize.needsUpdate = true
    geometry.attributes.aAlpha.needsUpdate = true

    if (spec.mark) {
      // Un impact rapproché repart de l'état courant de la marque : repositionnée et
      // redimensionnée, mais ni éteinte ni rétrécie d'un coup.
      markEntryOpacity = mark.visible ? markMaterial.opacity : 0
      markEntryScale = mark.visible ? mark.scale.x : MARK_RADIUS * 0.55
      markAge = 0
      markScale = spec.mark.scale
      markFade = spec.mark.fade
      mark.position.x = x
      mark.position.z = z
      mark.visible = true
    }

    // Enveloppe repartie de zéro : deux impacts rapprochés ne s'additionnent jamais.
    if (event === 'heartDamage') shakeAge = 0
  }

  /** Avance particules, marque, secousse et âge du dernier impact, sans rien allouer. */
  function update(dt) {
    if (disposed || !Number.isFinite(dt) || dt <= 0) return

    if (shakeAge < SHAKE_DURATION) shakeAge = Math.min(SHAKE_DURATION, shakeAge + dt)

    if (counters.lastImpact) counters.lastImpact.age += dt

    if (mark.visible) {
      markAge += dt
      const u = markAge / MARK_LIFE
      if (u >= 1) {
        mark.visible = false
        markMaterial.opacity = 0
      } else {
        // Héritage d'un impact précédent : le plancher reste constant jusqu'au plateau de
        // la nouvelle enveloppe, puis s'efface en 120 ms. La courbe ne redescend jamais
        // pendant qu'elle monte : aucun clignotement sur deux impacts rapprochés.
        const hold = 1 - smoothstep((markAge - MARK_FADE_IN) / 0.12)
        const grow = 0.55 + 0.45 * (1 - (1 - Math.min(1, markAge / 0.12)) ** 3)
        mark.scale.setScalar(Math.max(markScale * grow, markEntryScale * hold))
        const fadeIn = Math.min(1, markAge / MARK_FADE_IN)
        const fadeOut = 1 - smoothstep((u - MARK_HOLD) / (1 - MARK_HOLD))
        markMaterial.opacity = Math.max(
          markPeak * markFade * fadeIn * fadeOut,
          markEntryOpacity * hold,
        )
      }
    }

    let activeCount = 0
    for (let i = 0; i < CAPACITY; i++) {
      if (lives[i] <= 0) continue
      const i3 = i * 3
      ages[i] += dt
      const u = ages[i] / lives[i]
      if (u >= 1) {
        lives[i] = 0
        sizes[i] = 0
        alphas[i] = 0
        continue
      }

      const drag = drags[i] > 0 ? Math.exp(-drags[i] * dt) : 1
      velocities[i3] *= drag
      velocities[i3 + 2] *= drag
      velocities[i3 + 1] -= gravities[i] * dt
      positions[i3] += velocities[i3] * dt
      positions[i3 + 1] += velocities[i3 + 1] * dt
      positions[i3 + 2] += velocities[i3 + 2] * dt

      if (bounces[i]) {
        // Profil de rebond : 0,5× au départ, 1,8× à mi-vie, 0,5× à la fin.
        sizes[i] = startSizes[i] * (0.5 + 1.3 * Math.sin(Math.PI * u))
        alphas[i] = u < 0.5 ? 1 : 1 - smoothstep((u - 0.5) / 0.5)
      } else {
        sizes[i] = startSizes[i] + (endSizes[i] - startSizes[i]) * u
        alphas[i] = u < 0.5 ? 1 : 1 - smoothstep((u - 0.5) / 0.5)
      }
      activeCount++
    }

    if (activeCount > 0) {
      geometry.attributes.position.needsUpdate = true
      geometry.attributes.aSize.needsUpdate = true
      geometry.attributes.aAlpha.needsUpdate = true
    } else {
      points.visible = false
    }
  }

  /**
   * Décalage de caméra de l'image courante, `{ x, y, z }` d'amplitude ≤ 0,06 et de durée
   * ≤ 180 ms. Objet réutilisé : à lire dans l'image, sans le conserver.
   * @returns {{ x: number, y: number, z: number }}
   */
  function shake() {
    if (shakeAge >= SHAKE_DURATION) {
      shakeOffset.x = 0
      shakeOffset.y = 0
      shakeOffset.z = 0
      return shakeOffset
    }
    const t = shakeAge / SHAKE_DURATION
    const envelope = Math.sin(Math.PI * t)
    const phase = t * 22
    // Deux axes seulement : le sol ne tremble pas vers l'avant, la clairière reste posée.
    shakeOffset.x = SHAKE_AMPLITUDE * 0.42 * envelope * Math.cos(phase)
    shakeOffset.y = SHAKE_AMPLITUDE * 0.8 * envelope * Math.sin(phase)
    shakeOffset.z = 0
    return shakeOffset
  }

  const group = new THREE.Group()
  group.name = 'juice'
  group.add(points, mark)
  group.userData.stats = {
    capacity: CAPACITY,
    // Gerbe et marque : 2 draw calls ; marque seule : 1.
    drawCalls: 2,
    drawCallsMarkOnly: 1,
    events: Object.keys(EVENTS),
  }

  if (scene) scene.add(group)

  /** Libère matériaux, géométries et textures, puis détache le groupe. */
  function dispose() {
    if (disposed) return
    disposed = true
    group.removeFromParent()
    group.clear()
    geometry.dispose()
    pointsMaterial.dispose()
    sparkTexture.dispose()
    markGeometry.dispose()
    markMap.dispose()
    disposeProjectileMaterial(markMaterial)
  }

  return { spawn, update, shake, counters, group, dispose }
}

/**
 * Aperçu de vitrine : un groupe autonome qui expose `burst(position)` et `update(dt)`
 * pour `npm run showcase src/vfx/juice.js createJuicePreview`.
 *
 * Décalage de vitrine : le premier `burst` part 80 ms dans le temps pour que la capture
 * « 0,15 s » (en réalité 0,07 s réelles) montre la gerbe en vol, « 0,4 s » la marque seule
 * et « 0,8 s » le retour au calme. Les durées de jeu restent 150 ms (gerbe) et 500 ms (marque).
 * @returns {THREE.Group & { burst(position?: THREE.Vector3, event?: string): void, update(dt: number): void }}
 */
export function createJuicePreview() {
  const fx = createJuiceFx({ seed: 5 })
  const group = fx.group
  group.name = 'juice-preview'
  let lead = 0

  group.burst = (position, event = 'kill') => {
    fx.spawn(event, position)
    lead = 0.08
  }
  group.update = (dt) => {
    if (!Number.isFinite(dt) || dt <= 0) return
    if (lead > 0) {
      const step = Math.min(lead, dt)
      lead -= step
      dt -= step
    }
    if (dt > 0) fx.update(dt)
  }
  return group
}
