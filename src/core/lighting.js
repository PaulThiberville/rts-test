import * as THREE from 'three'
import { LEVEL_1 } from '../data/level-1.js'

/**
 * Remplissage du dôme : le soleil chaud modèle la scène, l'hémisphérique (ciel crème)
 * garde les teintes de rôle lisibles — le cœur reste turquoise au lieu de virer au vert.
 */
const HEMI_INTENSITY = 2.4

/** Marge d'ombre autour de `bounds ± skirt` : le soleil est de biais, pas à la verticale. */
const FRUSTUM_MARGIN = 1

/**
 * Nom sérialisable du filtre d'ombre réellement rendu.
 * Sous three 0.187, `PCFSoftShadowMap` n'est plus implémenté : `WebGLShadowMap` le remplace
 * par `PCFShadowMap` dès le premier rendu — c'est `shadow.radius` qui adoucit le contour.
 * L'état expose donc ce que le renderer rend vraiment, et non la constante de configuration.
 * @param {THREE.WebGLRenderer | null} renderer
 */
function readShadowMap(renderer) {
  const type = renderer?.shadowMap?.type
  if (type === THREE.BasicShadowMap) return 'BasicShadowMap'
  if (type === THREE.VSMShadowMap) return 'VSMShadowMap'
  return 'PCFShadowMap'
}

/**
 * Lit une teinte et la renvoie sous forme de chaîne sérialisable (`#rrggbb`).
 * @param {unknown} value
 * @param {string} fallback
 */
function toHex(value, fallback) {
  if (typeof value === 'string' && value.length > 0) return value
  if (value?.isColor) return `#${value.getHexString()}`
  return fallback
}

/**
 * Lumière de la clairière : soleil chaud rasant, ombres douces, remplissage ciel/sol.
 * La direction vient de `light.elevation`/`azimuth` (radians), la portée d'ombre de
 * `bounds ± skirt` : le soleil couvre tout le niveau, quel que soit son azimut.
 * @param {THREE.Scene} scene
 * @param {object} [level]
 * @param {THREE.WebGLRenderer | null} [renderer] source du type d'ombre exposé
 * @returns {{
 *   sun: THREE.DirectionalLight,
 *   hemi: THREE.HemisphereLight,
 *   state: { shadowMap: string, radius: number, intensity: number, sun: string, sky: string, ground: string, hour: number|null, elevation: number, azimuth: number },
 *   dispose(): void,
 * }}
 */
export function createLighting(scene, level = LEVEL_1, renderer = null) {
  const { bounds } = level
  const light = level.light ?? {}
  const palette = level.palette ?? {}

  const sunTint = toHex(light.sun ?? palette.sun, '#f6d9a8')
  const skyTint = toHex(palette.lightSky ?? light.sky ?? palette.sky, '#faf3e3')
  const groundTint = toHex(palette.lightGround ?? light.ground, '#b9c4ab')
  const intensity = Number.isFinite(light.intensity) ? light.intensity : 1
  const radius = Number.isFinite(light.shadowRadius) ? light.shadowRadius : 1
  const mapSize = Math.max(1, Math.round(light.shadowMapSize ?? 1024))
  const elevation = Number.isFinite(light.elevation) ? light.elevation : Math.PI / 5
  const azimuth = Number.isFinite(light.azimuth) ? light.azimuth : 0

  const center = new THREE.Vector3(
    (bounds.minX + bounds.maxX) / 2,
    0,
    (bounds.minZ + bounds.maxZ) / 2,
  )
  const width = bounds.maxX - bounds.minX + bounds.skirt * 2
  const depth = bounds.maxZ - bounds.minZ + bounds.skirt * 2
  // Demi-diagonale : la projection du rectangle au sol dans le plan de l'ombre reste couverte
  // pour n'importe quel azimut, sans recalculer la caméra d'ombre image par image.
  const half = Math.hypot(width, depth) / 2 + FRUSTUM_MARGIN
  const distance = half * 2.5

  const horizontal = Math.cos(elevation)
  const sun = new THREE.DirectionalLight(sunTint, intensity)
  sun.name = 'sun'
  sun.position.set(
    center.x + horizontal * Math.cos(azimuth) * distance,
    Math.sin(elevation) * distance,
    center.z + horizontal * Math.sin(azimuth) * distance,
  )
  sun.target.position.copy(center)
  sun.castShadow = true
  sun.shadow.mapSize.set(mapSize, mapSize)
  sun.shadow.radius = radius
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.03
  const shadowCamera = sun.shadow.camera
  shadowCamera.left = -half
  shadowCamera.right = half
  shadowCamera.top = half
  shadowCamera.bottom = -half
  shadowCamera.near = 0.5
  shadowCamera.far = distance + half * 2
  shadowCamera.updateProjectionMatrix()

  const hemi = new THREE.HemisphereLight(skyTint, groundTint, HEMI_INTENSITY)
  hemi.name = 'hemi'

  scene.add(sun)
  scene.add(sun.target)
  scene.add(hemi)

  return {
    sun,
    hemi,
    state: {
      shadowMap: readShadowMap(renderer),
      radius,
      intensity,
      sun: sunTint,
      sky: skyTint,
      ground: groundTint,
      // Heure du jardin : absente d'une carte qui n'en déclare pas, jamais inventée.
      hour: Number.isFinite(light.hour) ? light.hour : null,
      elevation,
      azimuth,
    },
    dispose() {
      scene.remove(sun)
      scene.remove(sun.target)
      scene.remove(hemi)
      sun.shadow.dispose()
      sun.dispose()
      hemi.dispose()
    },
  }
}
