import * as THREE from 'three'
import { LEVEL_1 } from '../data/level-1.js'

/** Comptes par défaut, remplacés par `level.ambience` quand le niveau les fournit. */
const DEFAULT_PETALS = 240
const DEFAULT_FIREFLIES = 80

/** Teintes pâles des pétales : famille de `#f0d6de`, jamais plus vives que le cœur. */
const PETAL_TINTS = ['#f0d6de', '#e6bacb', '#f3dce6']
/** Lucioles dorées : `#f2c66d` servant de base au dégradé blanc du halo. */
const FIREFLY_TINT = '#f2c66d'

const PETAL_MIN_Y = 0.15
const PETAL_TOP_Y = 4.6
const PETAL_SPAN = PETAL_TOP_Y - PETAL_MIN_Y
const FIREFLY_MIN_Y = 0.6
const FIREFLY_MAX_Y = 1.8

/** Marge intérieure : un point, dérive comprise, ne sort jamais de `bounds ± skirt`. */
const EDGE_MARGIN = 1.6

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
const clamp = (value, min, max) => (value < min ? min : value > max ? max : value)

/**
 * Lit un compte tolérant : `petals: 80` ou `petals: { count: 80 }`, sinon le défaut.
 * @param {unknown} option
 * @param {number} fallback
 */
function readCount(option, fallback) {
  const value = typeof option === 'object' && option !== null ? option.count : option
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : fallback
}

/** Sprite de pétale : ellipse verticale au bord tendre, dessinée une seule fois. */
function createPetalTexture() {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  const center = size / 2
  const gradient = context.createRadialGradient(center, center, 0, center, center, center)
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)')
  gradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.92)')
  gradient.addColorStop(0.78, 'rgba(255, 255, 255, 0.5)')
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
  context.save()
  context.translate(center, center)
  context.scale(0.6, 0.94)
  context.translate(-center, -center)
  context.fillStyle = gradient
  context.fillRect(0, 0, size, size)
  context.restore()
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** Sprite de luciole : cœur net et halo court, pour un point doré sans nappe lumineuse. */
function createFireflyTexture() {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  const center = size / 2
  const gradient = context.createRadialGradient(center, center, 0, center, center, center)
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)')
  gradient.addColorStop(0.18, 'rgba(255, 255, 255, 1)')
  gradient.addColorStop(0.34, 'rgba(255, 255, 255, 0.55)')
  gradient.addColorStop(0.62, 'rgba(255, 255, 255, 0.14)')
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)')
  context.fillStyle = gradient
  context.fillRect(0, 0, size, size)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/**
 * Matériau de points : la taille vient de l'attribut `aSize` (en mètres), donc elle suit
 * la perspective, le pixel ratio et la hauteur de la fenêtre comme le reste de la scène.
 * @param {THREE.Texture} map
 * @param {number} opacity
 */
function createPointsMaterial(map, opacity) {
  const material = new THREE.PointsMaterial({
    size: 1,
    map,
    vertexColors: true,
    transparent: true,
    opacity,
    depthWrite: false,
    sizeAttenuation: true,
  })
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSize;')
      .replace('gl_PointSize = size;', 'gl_PointSize = size * aSize;')
      // Garde-fou de 3 px : un point plus fin scintille en se déplaçant et disparaît de loin.
      .replace(
        'gl_PointSize *= ( scale / - mvPosition.z );',
        'gl_PointSize = max( gl_PointSize * ( scale / - mvPosition.z ), 3.0 );',
      )
  }
  material.customProgramCacheKey = () => 'ambience-points-size'
  return material
}

/**
 * Géométrie à capacité fixe : positions mutables, taille et couleur figées au tirage.
 * L'attribut de couleur doit s'appeler `color` : c'est celui que `PointsMaterial` lit.
 * @param {Float32Array} positions
 * @param {Float32Array} sizes
 * @param {Float32Array} colors
 * @param {THREE.Sphere} sphere sphère large : les dérives ne provoquent aucun recalcul de frustum
 */
function createPointsGeometry(positions, sizes, colors, sphere) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.boundingSphere = sphere
  return geometry
}

/**
 * Ambiance de la clairière : pétales qui dérivent et lucioles qui flottent.
 * Deux familles, un `THREE.Points` chacune, donc deux draw calls ; aucun écouteur,
 * aucun raycast, aucune allocation dans `update(dt)`.
 * @param {{ level?: object, seed?: number }} [options]
 * @returns {THREE.Group & { update(dt: number): void }}
 */
export function createAmbience({ level = LEVEL_1, seed = 7 } = {}) {
  const { bounds, heart } = level
  const palette = level.palette ?? {}
  const ambience = level.ambience ?? {}
  const petalCount = readCount(ambience.petals, DEFAULT_PETALS)
  const fireflyCount = readCount(ambience.fireflies, DEFAULT_FIREFLIES)
  const random = mulberry32(seed)

  const padded = {
    minX: bounds.minX - bounds.skirt,
    maxX: bounds.maxX + bounds.skirt,
    minZ: bounds.minZ - bounds.skirt,
    maxZ: bounds.maxZ + bounds.skirt,
  }
  const heartClearance = heart.radius + 1.6

  /** Point XZ dans `bounds ± skirt`, jamais collé au cœur. */
  function spawn() {
    let x = 0
    let z = 0
    for (let attempt = 0; attempt < 64; attempt++) {
      x = between(random, padded.minX + EDGE_MARGIN, padded.maxX - EDGE_MARGIN)
      z = between(random, padded.minZ + EDGE_MARGIN, padded.maxZ - EDGE_MARGIN)
      if ((x - heart.x) ** 2 + (z - heart.z) ** 2 >= heartClearance * heartClearance) break
    }
    return [x, z]
  }

  const sphere = new THREE.Sphere(
    new THREE.Vector3((bounds.minX + bounds.maxX) / 2, 2.4, (bounds.minZ + bounds.maxZ) / 2),
    Math.hypot(padded.maxX - padded.minX, padded.maxZ - padded.minZ) / 2 + 4,
  )

  // --- Pétales : chute lente et dérive latérale sinusoïdale -------------------
  const petalPositions = new Float32Array(petalCount * 3)
  const petalSizes = new Float32Array(petalCount)
  const petalColors = new Float32Array(petalCount * 3)
  const petalBaseX = new Float32Array(petalCount)
  const petalBaseZ = new Float32Array(petalCount)
  const petalFall = new Float32Array(petalCount)
  const petalDrift = new Float32Array(petalCount)
  const petalFreq = new Float32Array(petalCount)
  const petalPhase = new Float32Array(petalCount)
  const tint = new THREE.Color()

  for (let i = 0; i < petalCount; i++) {
    const [x, z] = spawn()
    const i3 = i * 3
    petalBaseX[i] = x
    petalBaseZ[i] = z
    petalPositions[i3] = x
    petalPositions[i3 + 1] = between(random, PETAL_MIN_Y + 0.05, PETAL_TOP_Y)
    petalPositions[i3 + 2] = z
    petalFall[i] = between(random, 0.1, 0.24)
    petalDrift[i] = between(random, 0.3, 0.85)
    petalFreq[i] = between(random, 0.22, 0.55)
    petalPhase[i] = between(random, 0, Math.PI * 2)
    petalSizes[i] = between(random, 0.28, 0.5)
    tint
      .set(palette.petal ?? PETAL_TINTS[i % PETAL_TINTS.length])
      .multiplyScalar(between(random, 0.93, 1.03))
    petalColors[i3] = tint.r
    petalColors[i3 + 1] = tint.g
    petalColors[i3 + 2] = tint.b
  }

  const petalMaterial = createPointsMaterial(createPetalTexture(), 0.88)
  const petals = new THREE.Points(
    createPointsGeometry(petalPositions, petalSizes, petalColors, sphere),
    petalMaterial,
  )
  petals.name = 'ambience-petals'
  petals.renderOrder = 1
  petals.raycast = () => {}

  // --- Lucioles : orbite douce autour d'un point fixe ------------------------
  const fireflyPositions = new Float32Array(fireflyCount * 3)
  const fireflySizes = new Float32Array(fireflyCount)
  const fireflyColors = new Float32Array(fireflyCount * 3)
  const fireflyAnchorX = new Float32Array(fireflyCount)
  const fireflyAnchorY = new Float32Array(fireflyCount)
  const fireflyAnchorZ = new Float32Array(fireflyCount)
  const fireflyRadius = new Float32Array(fireflyCount)
  const fireflyBob = new Float32Array(fireflyCount)
  const fireflyFreq = new Float32Array(fireflyCount)
  const fireflyPhase = new Float32Array(fireflyCount)

  for (let i = 0; i < fireflyCount; i++) {
    const [x, z] = spawn()
    const i3 = i * 3
    fireflyAnchorX[i] = x
    fireflyAnchorY[i] = between(random, 0.85, 1.55)
    fireflyAnchorZ[i] = z
    fireflyRadius[i] = between(random, 0.3, 0.9)
    fireflyBob[i] = between(random, 0.08, 0.16)
    fireflyFreq[i] = between(random, 0.12, 0.3)
    fireflyPhase[i] = between(random, 0, Math.PI * 2)
    fireflySizes[i] = between(random, 0.34, 0.58)
    tint
      .set(palette.firefly ?? FIREFLY_TINT)
      .multiplyScalar(between(random, 0.82, 1.04))
    fireflyColors[i3] = tint.r
    fireflyColors[i3 + 1] = tint.g
    fireflyColors[i3 + 2] = tint.b
    fireflyPositions[i3] = x
    fireflyPositions[i3 + 1] = fireflyAnchorY[i]
    fireflyPositions[i3 + 2] = z
  }

  const fireflyMaterial = createPointsMaterial(createFireflyTexture(), 0.95)
  const fireflies = new THREE.Points(
    createPointsGeometry(fireflyPositions, fireflySizes, fireflyColors, sphere),
    fireflyMaterial,
  )
  fireflies.name = 'ambience-fireflies'
  fireflies.renderOrder = 2
  fireflies.raycast = () => {}

  const petalAttribute = petals.geometry.attributes.position
  const fireflyAttribute = fireflies.geometry.attributes.position
  let time = 0

  /** Avance le temps accumulé et déplace les points en place, sans rien allouer. */
  function update(dt) {
    if (!Number.isFinite(dt) || dt <= 0) return
    time += dt

    for (let i = 0; i < petalCount; i++) {
      const i3 = i * 3
      let y = petalPositions[i3 + 1] - petalFall[i] * dt
      while (y < PETAL_MIN_Y) y += PETAL_SPAN
      petalPositions[i3 + 1] = y
      const swing = time * petalFreq[i] + petalPhase[i]
      petalPositions[i3] = petalBaseX[i] + petalDrift[i] * Math.sin(swing)
      petalPositions[i3 + 2] = petalBaseZ[i] + petalDrift[i] * 0.7 * Math.cos(swing * 0.83)
    }
    petalAttribute.needsUpdate = true

    for (let i = 0; i < fireflyCount; i++) {
      const i3 = i * 3
      const angle = time * fireflyFreq[i] + fireflyPhase[i]
      fireflyPositions[i3] = fireflyAnchorX[i] + fireflyRadius[i] * Math.cos(angle)
      fireflyPositions[i3 + 1] = clamp(
        fireflyAnchorY[i] + fireflyBob[i] * Math.sin(angle * 1.3),
        FIREFLY_MIN_Y,
        FIREFLY_MAX_Y,
      )
      fireflyPositions[i3 + 2] = fireflyAnchorZ[i] + fireflyRadius[i] * Math.sin(angle)
    }
    fireflyAttribute.needsUpdate = true

    // Respiration très lente et commune (≈ 11 s) : présente, jamais scintillante.
    fireflyMaterial.opacity = 0.85 + 0.1 * Math.sin(time * 0.55)
  }

  const group = new THREE.Group()
  group.name = 'ambience'
  group.add(petals, fireflies)
  group.update = update
  group.userData.stats = {
    families: ['petals', 'fireflies'],
    petals: petalCount,
    fireflies: fireflyCount,
    drawCalls: 2,
  }
  return group
}
