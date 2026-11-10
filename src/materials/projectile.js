import * as THREE from 'three'

/**
 * Teinte de projectile par défaut : le corail « danger » de la Direction-Artistique,
 * la même famille que le flash d'impact des ombres.
 */
const PROJECTILE_TINT = '#e8907f'

/** Opacité de départ de la marque d'impact : présente au sol, jamais opaque. */
const IMPACT_OPACITY = 0.55

/** Sol de l'étalon, celui sur lequel la lisibilité du projectile est jugée. */
const SAMPLE_GROUND = '#faf3e3'
/** Ombre de contact de l'étalon : un gris chaud translucide, jamais un noir. */
const SAMPLE_CONTACT = '#7f7466'

/**
 * Aplat lumineux d'un projectile. `MeshBasicMaterial` n'a pas d'émissif : la teinte est
 * portée par `color` seule. `toneMapped: false` garde exactement le corail de la DA,
 * sans halo blanc brûlé au passage du tone mapping. Instance fraîche à chaque appel :
 * deux projectiles peuvent régler opacité ou teinte sans se contaminer.
 * @param {{ tint?: string }} [options] teinte sRGB
 * @returns {THREE.MeshBasicMaterial}
 */
export function createProjectileMaterial({ tint = PROJECTILE_TINT } = {}) {
  return new THREE.MeshBasicMaterial({ color: tint, toneMapped: false })
}

/**
 * Marque d'impact posée au sol : même corail, translucide et sans écriture de profondeur,
 * pour se mêler au sol clair sans bord noir. `toneMapped: false` également, afin que la
 * marque et le projectile affichent la même teinte. Instance fraîche à chaque appel :
 * l'appelant peut faire varier `opacity` au fil de la disparition.
 * @param {{ tint?: string }} [options] teinte sRGB
 * @returns {THREE.MeshBasicMaterial}
 */
export function createImpactMarkMaterial({ tint = PROJECTILE_TINT } = {}) {
  return new THREE.MeshBasicMaterial({
    color: tint,
    transparent: true,
    opacity: IMPACT_OPACITY,
    depthWrite: false,
    toneMapped: false,
  })
}

/**
 * Libère le matériau ; aucun état partagé ni texture, donc appelable deux fois.
 * @param {THREE.Material} material
 * @returns {void}
 */
export function disposeProjectileMaterial(material) {
  if (material) material.dispose()
}

/**
 * Étalon de vitrine : le projectile posé sur un sol `#faf3e3` et sa marque d'impact à
 * côté, pour juger la teinte, l'absence de halo brûlé et la lisibilité à 1 m.
 * Sert à `npm run showcase src/materials/projectile.js createProjectileSample` ;
 * ce n'est pas la scène du jeu.
 *
 * Le sol est une dalle de 2 cm : le harnais de vitrine recale le point bas de l'étalon sur
 * son propre sol (y = 0), une simple nappe s'y superposerait et clignoterait.
 * @returns {THREE.Group}
 */
export function createProjectileSample() {
  const group = new THREE.Group()
  group.name = 'projectile-sample'

  // Sol non éclairé : il affiche exactement `#faf3e3`, surface de référence des ΔE.
  const ground = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.02, 1.1),
    new THREE.MeshBasicMaterial({ color: SAMPLE_GROUND, toneMapped: false }),
  )
  ground.position.y = 0.01
  ground.name = 'sample-ground'
  group.add(ground)

  const contact = new THREE.Mesh(
    new THREE.CircleGeometry(0.19, 20),
    new THREE.MeshBasicMaterial({
      color: SAMPLE_CONTACT,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      toneMapped: false,
    }),
  )
  contact.rotation.x = -Math.PI / 2
  contact.scale.set(1, 0.8, 1)
  contact.position.set(-0.34, 0.022, 0.05)
  contact.name = 'sample-contact'
  group.add(contact)

  const projectile = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.2, 1),
    createProjectileMaterial(),
  )
  projectile.position.set(-0.34, 0.22, 0.05)
  projectile.name = 'sample-projectile'
  group.add(projectile)

  // Une marque d'impact = une flaque et trois gouttes, toutes sur le même matériau.
  const markMaterial = createImpactMarkMaterial()
  const splash = [
    { radius: 0.3, x: 0.34, z: 0.05 },
    { radius: 0.07, x: 0.62, z: -0.14 },
    { radius: 0.05, x: 0.6, z: 0.26 },
    { radius: 0.04, x: 0.14, z: 0.3 },
  ]
  splash.forEach(({ radius, x, z }, index) => {
    const mark = new THREE.Mesh(new THREE.CircleGeometry(radius, 20), markMaterial)
    mark.rotation.x = -Math.PI / 2
    mark.position.set(x, 0.022, z)
    mark.name = index === 0 ? 'sample-impact-mark' : `sample-impact-drop-${index}`
    group.add(mark)
  })

  return group
}
