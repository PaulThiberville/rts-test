import * as THREE from 'three'

/**
 * Aplat mat partagé : roughness 1 et metalness 0 pour le décor de la clairière,
 * conformément à la Direction Artistique (aplats unis, décor sans éclat).
 * @param {string | number} color teinte sRGB issue de `LEVEL_1.palette`
 * @returns {THREE.MeshStandardMaterial}
 */
const matte = (color) =>
  new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0 })

/**
 * Matériaux du terrain, créés une fois au chargement puis partagés.
 * @param {{ ground: string, path: string, heart?: string }} colors
 * @returns {{ ground: THREE.MeshStandardMaterial, path: THREE.MeshStandardMaterial, heart: THREE.MeshStandardMaterial }}
 */
export function createTerrainMaterials({ ground, path, heart = '#6ec6b5' }) {
  return {
    ground: matte(ground),
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
