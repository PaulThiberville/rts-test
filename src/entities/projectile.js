import * as THREE from 'three'
import { createProjectileMaterial, disposeProjectileMaterial } from '../materials/projectile.js'

/** Rayon par défaut : une baie de 6 cm, lisible en vol sans masquer le chemin. */
const PROJECTILE_RADIUS = 0.06

/** Baie légèrement aplatie : une sphère parfaite paraîtrait une bille, pas un fruit. */
const PROJECTILE_SQUASH = 0.92

/**
 * Baie facettée : sphère à quatre longitudes et trois latitudes, soit seize triangles — le
 * maximum du budget. C'est la seule maille qui garde un contour octogonal (pôles, anneaux
 * à mi-hauteur, équateur) : une bipyramide à seize faces, elle, se découperait en losange.
 * La géométrie appartient au projectile : `disposeProjectile` la libère, un tir ne laissant
 * aucun exemplaire à réutiliser.
 * @param {number} size rayon
 * @returns {THREE.SphereGeometry}
 */
function projectileGeometry(size) {
  return new THREE.SphereGeometry(size, 4, 3).scale(1, PROJECTILE_SQUASH, 1)
}

/**
 * Projectile de tour : petite baie ronde, un seul maillage, ni ombre portée ni réceptrice.
 * Le matériau est créé ici par la fabrique de `src/materials/projectile.js` ; il appartient
 * au projectile et sera libéré par `disposeProjectile`.
 * @param {{ tint?: string, radius?: number }} [options]
 * @returns {THREE.Mesh}
 */
export function createProjectile({ tint = '#e8907f', radius = PROJECTILE_RADIUS } = {}) {
  const size = Number.isFinite(radius) && radius > 0 ? radius : PROJECTILE_RADIUS
  const mesh = new THREE.Mesh(projectileGeometry(size), createProjectileMaterial({ tint }))
  mesh.name = 'projectile'
  mesh.userData = { tint, radius: size }
  mesh.castShadow = false
  mesh.receiveShadow = false
  return mesh
}

/**
 * Libère la géométrie et le matériau du projectile ; appelable deux fois, sans effet sur
 * un objet absent.
 * @param {THREE.Mesh | null | undefined} object
 * @returns {void}
 */
export function disposeProjectile(object) {
  if (!object) return
  if (object.geometry) object.geometry.dispose()
  const materials = Array.isArray(object.material) ? object.material : [object.material]
  for (const material of materials) disposeProjectileMaterial(material)
}
