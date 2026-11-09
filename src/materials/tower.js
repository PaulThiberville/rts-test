import * as THREE from 'three'

/**
 * Teintes sRGB des plantes-défenses : niveau 1, puis niveau 2 éclairci dans la même famille.
 * ΔE76 en Lab CIE D65, formule de la Direction-Artistique (luminance relative sRGB) :
 *   sprout #6ec6b5 / sol #faf3e3 → 38.2 ; bloom #c9a7d8 / sol → 42.7 ; sprout / bloom → 55.7
 *   sprout 2 #8bdccc / sprout 1 → 8.5 ; bloom 2 #d6bce1 / bloom 1 → 9.9
 *   sprout 2 / sol → 32.3 ; bloom 2 / sol → 33.1
 */
const TONES = {
  sprout: ['#6ec6b5', '#8bdccc'],
  bloom: ['#c9a7d8', '#d6bce1'],
}

/** Teinte de récompense, réservée aux retours d'interface (butin, gains). */
const REWARD = '#f2c66d'

/**
 * Aplat PBR d'une tour : mat et sans reflet, l'auto-émission de même teinte relève
 * doucement le côté ombré sans ajouter de texture ni casser l'aplat de la DA.
 * La teinte est un hex sRGB, converti par `ColorManagement` de three.
 * @param {string} color teinte sRGB
 * @returns {THREE.MeshStandardMaterial}
 */
const towerMaterial = (color) =>
  new THREE.MeshStandardMaterial({
    color,
    roughness: 0.85,
    metalness: 0,
    emissive: color,
    emissiveIntensity: 0.06,
  })

/**
 * Matériau d'une plante-défense, créé à l'appel et libéré par l'appelant.
 * @param {{ type?: 'sprout' | 'bloom', level?: number }} [options]
 * @returns {THREE.MeshStandardMaterial}
 */
export function createTowerMaterial({ type = 'sprout', level = 1 } = {}) {
  const tones = Object.hasOwn(TONES, type) ? TONES[type] : TONES.sprout
  const tier = THREE.MathUtils.clamp(Math.round(level), 1, tones.length) - 1
  return towerMaterial(tones[tier])
}

/**
 * Fantôme de placement : translucide, visible des deux faces, n'écrit pas la profondeur.
 * @returns {THREE.MeshBasicMaterial}
 */
export const createGhostMaterial = () =>
  new THREE.MeshBasicMaterial({
    color: TONES.sprout[0],
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    side: THREE.DoubleSide,
  })

/**
 * Emplacement de pose : anneau doré discret, renforcé quand l'emplacement est survolé.
 * @param {{ highlight?: boolean }} [options]
 * @returns {THREE.MeshBasicMaterial}
 */
export const createSlotMaterial = ({ highlight = false } = {}) =>
  new THREE.MeshBasicMaterial({
    color: REWARD,
    transparent: true,
    opacity: highlight ? 0.65 : 0.25,
    depthWrite: false,
  })

/**
 * Surbrillance de la tour sélectionnée.
 * @returns {THREE.MeshBasicMaterial}
 */
export const createSelectionMaterial = () =>
  new THREE.MeshBasicMaterial({
    color: REWARD,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  })
