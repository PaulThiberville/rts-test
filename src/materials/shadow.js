import * as THREE from 'three'

/**
 * Teinte des ombres : bleu-gris froid, désaturé, qui se détache en ΔE76 sur les
 * deux surfaces de la clairière (Lab CIE D65) :
 *   ombre #3a3f4b / sol #faf3e3 → 71.3 ; ombre / chemin #bfa072 → 54.9
 * Une ombre se lit donc partout sans contour noir ni bord découpé.
 */
const SHADOW_COLOR = '#3a3f4b'

/**
 * Teintes froides et désaturées des trois silhouettes d'ombre : un camaïeu qui va de la
 * plus claire (la ronde, accueillante) à la plus sombre (la haute, la plus menaçante),
 * sans noir pur ni saturation vive.
 *
 * ΔE76 (Lab CIE D65, formule de la Direction-Artistique) sur les deux surfaces de la
 * clairière, puis entre silhouettes :
 *   ronde    #5c7e87 / sol #faf3e3 → 49.4 ; / chemin #bfa072 → 43.3
 *   oreillue #546583 / sol → 60.1 ; / chemin → 53.4
 *   haute    #4b3b54 / sol → 72.8 ; / chemin → 57.6
 *   ronde ↔ oreillue → 17.0 ; ronde ↔ haute → 32.2 ; oreillue ↔ haute → 19.7
 * Chacune tient donc le ΔE76 ≥ 40 exigé sur les deux surfaces, et les trois se
 * distinguent entre elles de 17.0 au minimum (≥ 15) : lisibles côte à côte à 1 m.
 * Le chemin est la surface la plus serrée pour la ronde (43.3, marge de 3.3 points), et
 * sa saturation HSV est ramenée à 32 % : elle reste dans le camaïeu, sans le vif de la
 * palette verte.
 * Elles restent aussi à ≥ 12 de l'aplat d'ombre #3a3f4b, pour qu'une silhouette ne se
 * confonde pas avec l'ombre portée qu'elle pose au sol.
 */
export const SILHOUETTE_TINTS = {
  ronde: '#5c7e87',
  oreillue: '#546583',
  haute: '#4b3b54',
}

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

/** Surfaces de l'étalon : celles sur lesquelles les ΔE ci-dessus sont mesurés. */
const SAMPLE_GROUND = '#faf3e3'
const SAMPLE_PATH = '#bfa072'
/** Ombre de contact de l'étalon : un gris chaud translucide, jamais un noir. */
const SAMPLE_CONTACT = '#7f7466'

/**
 * Surface d'étalon volontairement non éclairée : le sol et le chemin affichent exactement
 * les hex de référence, pour que le ΔE lu à l'écran soit celui du commentaire ci-dessus.
 * Une surface PBR du harnais de vitrine les éclaircirait sous son soleil blanc.
 * @param {string} color teinte sRGB
 * @returns {THREE.MeshBasicMaterial}
 */
const sampleSurface = (color) =>
  new THREE.MeshBasicMaterial({ color, toneMapped: false })

/**
 * Ombre de contact discrète sous une silhouette : l'étalon garde ses figures posées au
 * sol sans dépendre des ombres du harnais. Aplat translucide, comme la marque d'impact.
 * @param {number} radius rayon de l'empreinte
 * @returns {THREE.Mesh}
 */
function sampleContact(radius) {
  const contact = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 20),
    new THREE.MeshBasicMaterial({
      color: SAMPLE_CONTACT,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
      toneMapped: false,
    }),
  )
  contact.rotation.x = -Math.PI / 2
  contact.scale.set(1, 0.68, 1)
  contact.position.y = 0.003
  contact.name = 'sample-contact'
  return contact
}

/**
 * Corps facetté d'une silhouette d'étalon : une sphère écrasée pour la ronde, une sphère
 * et deux oreilles pour l'oreillue, un ovale étiré pour la haute. Formes rondes et
 * lisibles (Direction-Artistique), volontairement approximatives : l'étalon juge la
 * teinte, pas le maillage définitif des ombres.
 * @param {'ronde' | 'oreillue' | 'haute'} id
 * @param {THREE.Material} material
 * @returns {THREE.Group}
 */
function silhouetteForm(id, material) {
  const group = new THREE.Group()
  group.name = `silhouette-${id}`

  if (id === 'haute') {
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), material)
    body.scale.set(0.26, 0.52, 0.26)
    body.position.y = 0.52
    body.name = 'silhouette-body'
    group.add(body)
    return group
  }

  const radius = id === 'oreillue' ? 0.32 : 0.36
  const squash = id === 'oreillue' ? 0.7 : 0.62
  const body = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), material)
  body.scale.y = squash
  body.position.y = radius * squash
  body.name = 'silhouette-body'
  group.add(body)

  if (id === 'oreillue') {
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), material)
      ear.scale.set(0.07, 0.17, 0.06)
      ear.position.set(side * 0.17, 0.43, 0)
      ear.rotation.z = -side * 0.24
      ear.name = side < 0 ? 'silhouette-ear-left' : 'silhouette-ear-right'
      group.add(ear)
    }
  }

  return group
}

/**
 * Étalon de vitrine : les trois silhouettes de `SILHOUETTE_TINTS` côte à côte sur un sol
 * `#faf3e3`, avec une bande de chemin `#bfa072` au premier plan, pour juger les deux ΔE
 * d'un même regard. Les silhouettes sont décalées en quinconce (0,42 m de profondeur
 * d'une à l'autre) : vues de profil, elles restent côte à côte au lieu de s'empiler et
 * de masquer deux des trois teintes. Sert à
 * `npm run showcase src/materials/shadow.js createShadowSample` ; ce n'est pas la scène du jeu.
 *
 * Le sol est une dalle de 2 cm : le harnais de vitrine recale le point bas de l'étalon sur
 * son propre sol (y = 0), une simple nappe s'y superposerait et clignoterait.
 * @returns {THREE.Group}
 */
export function createShadowSample() {
  const group = new THREE.Group()
  group.name = 'shadow-sample'

  const ground = new THREE.Mesh(new THREE.BoxGeometry(2.5, 0.02, 2.2), sampleSurface(SAMPLE_GROUND))
  ground.position.y = 0.01
  ground.name = 'sample-ground'
  group.add(ground)

  const path = new THREE.Mesh(new THREE.PlaneGeometry(2.5, 0.36), sampleSurface(SAMPLE_PATH))
  path.rotation.x = -Math.PI / 2
  path.position.set(0, 0.022, 0.9)
  path.name = 'sample-path'
  group.add(path)

  const footprints = { ronde: 0.42, oreillue: 0.4, haute: 0.3 }
  const ranks = [
    { id: 'ronde', x: -0.85, z: 0.28 },
    { id: 'oreillue', x: 0, z: -0.14 },
    { id: 'haute', x: 0.85, z: -0.56 },
  ]
  ranks.forEach(({ id, x, z }) => {
    const material = createShadowMaterial({ color: SILHOUETTE_TINTS[id] })
    const form = silhouetteForm(id, material)
    form.position.set(x, 0.021, z)
    form.add(sampleContact(footprints[id]))
    group.add(form)
  })

  return group
}
