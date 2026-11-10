import * as THREE from 'three'

/**
 * Aplat mat partagé : roughness 1 et metalness 0 pour le décor de la clairière,
 * conformément à la Direction Artistique (aplats unis, décor sans éclat).
 * @param {string | number} color teinte sRGB issue de `LEVEL_1.palette`
 * @returns {THREE.MeshStandardMaterial}
 */
const matte = (color) =>
  new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0 })

/** Côté de la texture du sol : 128 px en puissance de deux, soit 64 Ko en RGBA. */
const TILE = 128
/** Tuile au sol ≈ 2,6 m pour l'emprise de `bounds ± skirt` du niveau 1 (44 m → 16,9). */
const REPEAT = 16.9
/** Amplitude du grain, en fraction de la luminance sRGB du sol (≤ 3 %). */
const GRAIN = 0.028
/** Motifs du sol : mottes larges discrètes (65 cm) puis crumb de 13 à 4 cm, qui porte le grain. */
const OCTAVES = [
  { size: 4, amplitude: 0.1 },
  { size: 8, amplitude: 0.18 },
  { size: 16, amplitude: 0.26 },
  { size: 32, amplitude: 0.26 },
  { size: 64, amplitude: 0.2 },
]
/**
 * Part du champ laissée rigoureusement plate : le sol garde une teinte dominante exacte
 * (il reste un aplat de la Direction Artistique) et les mottes se lisent autour d'elle.
 */
const FLAT_BAND = 0.35

/** Générateur pseudo-aléatoire déterministe : le même grain à chaque chargement. */
const mulberry32 = (seed) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const smooth = (t) => t * t * t * (t * (t * 6 - 15) + 10)

/** Réseau de valeurs périodique (taille divisible par la fréquence) → motif tuilable. */
const lattice = (size, random) => {
  const values = new Float32Array(size * size)
  for (let i = 0; i < values.length; i += 1) values[i] = random()
  return values
}

/** Échantillonne un réseau périodique en coordonnées `[0, size[`, interpolation douce. */
const sampleLattice = (values, size, x, y) => {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = smooth(x - x0)
  const fy = smooth(y - y0)
  const wrap = (v) => ((v % size) + size) % size
  const xa = wrap(x0)
  const ya = wrap(y0)
  const xb = wrap(x0 + 1)
  const yb = wrap(y0 + 1)
  const top = values[ya * size + xa] * (1 - fx) + values[ya * size + xb] * fx
  const bottom = values[yb * size + xa] * (1 - fx) + values[yb * size + xb] * fx
  return top * (1 - fy) + bottom * fy
}

/**
 * Champ de bruit du sol, centré (moyenne nulle) et normalisé (`max |n| = 1`), calculé une
 * seule fois puis réutilisé par tous les sols : le grain est identique d'une teinte à l'autre.
 * @returns {Float32Array}
 */
let cachedNoise = null
const groundNoise = () => {
  if (cachedNoise) return cachedNoise
  const random = mulberry32(0x5eed)
  const field = new Float32Array(TILE * TILE)
  const grids = OCTAVES.map(({ size, amplitude }) => ({ size, amplitude, values: lattice(size, random) }))
  for (let y = 0; y < TILE; y += 1) {
    for (let x = 0; x < TILE; x += 1) {
      let value = 0
      let total = 0
      for (const { size, amplitude, values } of grids) {
        value += sampleLattice(values, size, (x / TILE) * size, (y / TILE) * size) * amplitude
        total += amplitude
      }
      field[y * TILE + x] = value / total
    }
  }
  const mean = field.reduce((sum, value) => sum + value, 0) / field.length
  let peak = 0
  for (let i = 0; i < field.length; i += 1) {
    field[i] -= mean
    peak = Math.max(peak, Math.abs(field[i]))
  }
  // Courbe douce : les écarts moyens prennent du relief, les extrêmes restent sous le plafond.
  const gain = Math.tanh(1.4)
  let curved = 0
  for (let i = 0; i < field.length; i += 1) {
    field[i] = Math.tanh((1.4 * field[i]) / peak) / gain
    curved += field[i]
  }
  const center = curved / field.length
  // Bande centrale aplatie : la teinte demandée reste la couleur exacte de la majorité des texels.
  const stretch = 1 / (1 - FLAT_BAND)
  let top = 0
  for (let i = 0; i < field.length; i += 1) {
    const value = field[i] - center
    const flat = Math.abs(value) > FLAT_BAND ? (Math.sign(value) * (Math.abs(value) - FLAT_BAND)) * stretch : 0
    field[i] = flat
    top = Math.max(top, Math.abs(flat))
  }
  for (let i = 0; i < field.length; i += 1) field[i] /= top
  cachedNoise = field
  return field
}

/** Teinte demandée en octets sRGB, depuis `#rrggbb` ou un entier 0xrrggbb. */
const toSrgb = (color) => {
  const value = typeof color === 'string' ? Number.parseInt(color.replace('#', ''), 16) : color
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

const clamp8 = (value) => (value < 0 ? 0 : value > 255 ? 255 : value)

/**
 * Texture du sol : grain de luminance doux et tuilable, de moyenne égale à la teinte
 * demandée (grains d'une même luminance, décalés d'autant sur les trois canaux).
 * @param {string | number} color
 * @returns {THREE.CanvasTexture}
 */
const groundTexture = (color) => {
  const [red, green, blue] = toSrgb(color)
  const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue
  const noise = groundNoise()
  const canvas = document.createElement('canvas')
  canvas.width = TILE
  canvas.height = TILE
  const context = canvas.getContext('2d')
  const image = context.createImageData(TILE, TILE)
  const data = image.data
  for (let i = 0; i < noise.length; i += 1) {
    const grain = GRAIN * luminance * noise[i]
    const offset = i * 4
    data[offset] = clamp8(Math.round(red + grain))
    data[offset + 1] = clamp8(Math.round(green + grain))
    data[offset + 2] = clamp8(Math.round(blue + grain))
    data[offset + 3] = 255
  }
  context.putImageData(image, 0, 0)
  const texture = new THREE.CanvasTexture(canvas)
  texture.name = 'ground-grain'
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(REPEAT, REPEAT)
  texture.anisotropy = 4
  return texture
}

/**
 * Matériaux du terrain, créés une fois au chargement puis partagés.
 * Seul le sol reçoit une matière : le grain procédural (aucun fichier binaire) lui donne
 * l'épaisseur de « terre » de près, sans déplacer sa teinte moyenne mesurée. Le chemin et
 * le cœur restent des aplats mats, pour garder leur ΔE76 ≥ 30 et ≥ 15.
 * @param {{ ground?: string | number, path?: string | number, heart?: string | number }} [colors]
 * @returns {{ ground: THREE.MeshStandardMaterial, path: THREE.MeshStandardMaterial, heart: THREE.MeshStandardMaterial }}
 */
export function createTerrainMaterials({
  ground = '#faf3e3',
  path = '#bfa072',
  heart = '#6ec6b5',
} = {}) {
  const texture = groundTexture(ground)
  const groundMaterial = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 1,
    metalness: 0,
  })
  // Une texture par sol (les teintes diffèrent) : elle meurt avec son matériau.
  groundMaterial.addEventListener('dispose', () => texture.dispose())
  return {
    ground: groundMaterial,
    path: matte(path),
    heart: matte(heart),
  }
}

/**
 * Matériaux du décor, créés une fois au chargement puis partagés entre les `InstancedMesh`.
 * @param {{ grass: string, rock: string, tree: string, bush: string }} colors
 * @returns {{ grass: THREE.MeshStandardMaterial, rock: THREE.MeshStandardMaterial, tree: THREE.MeshStandardMaterial, bush: THREE.MeshStandardMaterial }}
 */
export function createDecorMaterials({ grass, rock, tree, bush }) {
  return {
    grass: matte(grass),
    rock: matte(rock),
    tree: matte(tree),
    bush: matte(bush),
  }
}
