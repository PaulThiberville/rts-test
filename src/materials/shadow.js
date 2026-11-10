import * as THREE from 'three'

/**
 * Teinte des ombres : bleu-gris froid, désaturé, qui se détache en ΔE76 sur les
 * deux surfaces de la clairière (Lab CIE D65) :
 *   ombre #3a3f4b / sol #faf3e3 → 71.3 ; ombre / chemin #bfa072 → 54.9
 * Une ombre se lit donc partout sans contour noir ni bord découpé.
 */
const SHADOW_COLOR = '#3a3f4b'

/**
 * Aplat mobile d'une ombre : mat, sans texture ni reflet, facettes assumées.
 * Une instance fraîche par appel, pour que le flash d'impact d'une ombre
 * (émissif, monté par le modèle) ne teinte pas les autres.
 * @param {{ color?: string }} [options] teinte sRGB
 * @returns {THREE.MeshStandardMaterial}
 */
export function createShadowMaterial({ color = SHADOW_COLOR } = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 1,
    metalness: 0,
    flatShading: true,
    emissive: 0x000000,
    emissiveIntensity: 0,
  })
}

/**
 * Libère le matériau ; aucun état partagé ni texture, donc appelable deux fois.
 * @param {THREE.Material} material
 * @returns {void}
 */
export function disposeShadowMaterial(material) {
  if (material) material.dispose()
}
