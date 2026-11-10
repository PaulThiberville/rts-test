import * as THREE from 'three'

/**
 * Teintes végétales par défaut, tirées de la Direction-Artistique : pastel, désaturé,
 * jamais fluo, une teinte dominante par famille. Elles servent de secours quand l'appelant
 * ne fournit pas de palette (vitrine, tests), et de base aux matériaux.
 *
 * ΔE76 (Lab CIE D65, formule de la note Direction-Artistique) des teintes nouvelles :
 *   flower #e9b7c4 ↔ flowerAlt #c9b8dd → 18.2 ; ↔ sol #faf3e3 → 27.6 ; ↔ roche #cfc8bb → 21.1
 *   flowerAlt ↔ sol → 33.9 ; ↔ roche → 27.1
 *   grassTall #cdd79a ↔ grass #a9c8a0 → 14.8 ; ↔ bush #b7d3ac → 13.4 ; ↔ tree → 22.9
 *   stem #7f9a76 ↔ grass → 16.8 ; ↔ tree #8fb99a → 12.3 ; ↔ bush → 20.9
 * `grassTall` et `stem` sont des accents internes à la végétation, plus proches de `grass`
 * que du minimum de 15 : ils se distinguent par leur silhouette et leur place (lame haute
 * qui attrape la lumière, tige fine), pas par un saut de teinte — un contraste franc
 * casserait l'aplat de la clairière.
 */
export const DEFAULT_PALETTE = {
  tree: '#8fb99a',
  bush: '#b7d3ac',
  flower: '#e9b7c4',
  flowerAlt: '#c9b8dd',
  grass: '#a9c8a0',
  grassTall: '#cdd79a',
  stem: '#7f9a76',
  rock: '#cfc8bb',
}

/**
 * Aplat mat commun : aucune texture, aucune brillance, facettes assumées (low-poly).
 * `roughness: 1` et `metalness: 0` viennent de la Direction-Artistique ; `flatShading`
 * n'est activé que là où les facettes servent la silhouette (houppier, buisson, corolle).
 */
const MATTE = { roughness: 1, metalness: 0 }

/** Facettes utiles à la silhouette ; la tige reste lisse pour ne pas casser sa rondeur. */
const FACETED = { tree: true, bush: true, flower: true, grass: true, rock: true, stem: false }

/**
 * Injection qui rend `instanceColor` **relatif** : three multiplie l'aplat par la couleur
 * d'instance, ce qui assombrirait la palette si elle servait aussi de base. On divise donc
 * la couleur d'instance par la teinte de base (les deux en espace linéaire) pour n'en garder
 * que la variation, bornée à ±30 % — l'aplat de `palette` reste la référence.
 * `USE_INSTANCING_COLOR` n'existe que côté vertex : côté fragment, three expose la couleur
 * d'instance via `USE_COLOR` (et les matériaux du décor n'ont pas d'attribut `color`).
 */
const TINT_FRAGMENT = /* glsl */ `
#if defined( USE_COLOR_ALPHA )

	diffuseColor *= vColor;

#elif defined( USE_COLOR )

	diffuseColor.rgb *= clamp( vColor.rgb / max( uBaseTint, vec3( 0.04 ) ), vec3( 0.78 ), vec3( 1.30 ) );

#endif
`

/** Injection de `begin_vertex` : la base (y = 0) reste au sol, le haut s'incline. */
const SWAY_VERTEX = /* glsl */ `
vec3 transformed = vec3( position );

float swayAnchor = max( transformed.y, 0.0 );
float swayBend = uSwayAmplitude * swayAnchor * swayAnchor;

#ifdef USE_INSTANCING

	vec3 swayOrigin = ( modelMatrix * instanceMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;

#else

	vec3 swayOrigin = ( modelMatrix * vec4( 0.0, 0.0, 0.0, 1.0 ) ).xyz;

#endif

float swayPhase = uSwayPhase + swayOrigin.x * 0.37 + swayOrigin.z * 0.31;
float swayWave = sin( uTime * uSwaySpeed + swayPhase );
transformed.x += swayBend * swayWave;
transformed.z += swayBend * 0.45 * sin( uTime * uSwaySpeed * 0.63 + swayPhase * 1.7 );
`

/**
 * Ajoute la teinte d'instance relative à un `MeshStandardMaterial`, sans toucher au reste
 * du pipeline PBR (les ombres portées et reçues gardent leur matériau de profondeur).
 * @param {THREE.MeshStandardMaterial} material
 * @param {string | number} base teinte de palette, base de l'aplat
 * @returns {THREE.MeshStandardMaterial}
 */
function tint(material, base) {
  const baseTint = new THREE.Color(base)
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBaseTint = { value: baseTint }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uBaseTint;')
      .replace('#include <color_fragment>', TINT_FRAGMENT)
  }
  // Le source injecté ne dépend pas de la teinte : les six aplats partagent le programme,
  // chacun avec son propre `uBaseTint`.
  material.customProgramCacheKey = () => 'vegetation-tint'
  return material
}

/**
 * Aplat végétal teinté : `color` sert d'aplat de base, `instanceColor` n'apporte que la
 * variation de teinte d'une instance à l'autre.
 * @param {string | number} color teinte sRGB
 * @param {boolean} flatShading facettes visibles
 * @returns {THREE.MeshStandardMaterial}
 */
const matte = (color, flatShading) =>
  tint(new THREE.MeshStandardMaterial({ color, ...MATTE, flatShading }), color)

/**
 * Les six matériaux du décor végétal, créés une fois au chargement puis partagés par les
 * `InstancedMesh`. Aucune texture, aucun état de rendu partagé ailleurs.
 * `instanceColor` s'exprime comme un décalage HSL de la teinte de `palette` (la variation
 * est ramenée en proportion de l'aplat) : l'instance garde donc la teinte de la famille.
 * @param {object} [palette] palette du niveau ; les clés manquantes retombent sur `DEFAULT_PALETTE`
 * @returns {{ tree: THREE.MeshStandardMaterial, bush: THREE.MeshStandardMaterial, flower: THREE.MeshStandardMaterial, grass: THREE.MeshStandardMaterial, stem: THREE.MeshStandardMaterial, rock: THREE.MeshStandardMaterial }}
 */
export function createVegetationMaterials(palette = DEFAULT_PALETTE) {
  const tones = { ...DEFAULT_PALETTE, ...(palette ?? {}) }
  const veg = (key) => matte(tones[key] ?? DEFAULT_PALETTE[key], FACETED[key])
  return {
    tree: veg('tree'),
    bush: veg('bush'),
    flower: veg('flower'),
    grass: veg('grass'),
    stem: veg('stem'),
    rock: veg('rock'),
  }
}

/**
 * Aplat végétal qui se balance : `MeshStandardMaterial` étendu par `onBeforeCompile`, donc
 * toujours compatible `castShadow` / `receiveShadow`, `fog` et les lumières de la scène.
 * La base du végétal (`y = 0` local) reste ancrée au sol ; l'inclinaison croît avec le carré
 * de la hauteur, ce qui donne un mouvement feutré de feuillage plutôt qu'une rotation rigide.
 * `instanceMatrix` sert de phase : deux instances voisines ne balancent jamais ensemble.
 *
 * Limite assumée : l'ombre portée est dessinée par le `MeshDepthMaterial` de three, qui ne
 * reçoit pas l'injection — elle reste donc droite. À 0,05 m de débattement c'est invisible ;
 * au-delà de 0,3 m il faut déporter le balancement dans un `customDepthMaterial` côté maillage.
 *
 * @param {{ color?: string | number, sway?: { amplitude?: number, speed?: number, phase?: number } }} [options]
 *   `amplitude` : déplacement latéral en mètres à 1 m de haut (0,05 par défaut : ~1 cm sur une
 *   touffe de 0,5 m, discret ; une famille basse qui doit se voir passe 0,15 à 0,2) ;
 *   `speed` : rad/s ; `phase` : décalage en radians
 * @returns {THREE.MeshStandardMaterial} son `userData.update(dt)` avance le balancement
 */
export function createSwayMaterial({ color = DEFAULT_PALETTE.grass, sway = {} } = {}) {
  const { amplitude = 0.05, speed = 1.1, phase = 0 } = sway ?? {}
  const material = matte(color, false)
  const uniforms = {
    uTime: { value: 0 },
    uSwayAmplitude: { value: amplitude },
    uSwaySpeed: { value: speed },
    uSwayPhase: { value: phase },
  }
  let time = 0

  const compileTint = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    compileTint(shader, renderer)
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uTime;\nuniform float uSwayAmplitude;\nuniform float uSwaySpeed;\nuniform float uSwayPhase;',
      )
      .replace('#include <begin_vertex>', SWAY_VERTEX)
  }
  // Source différent des aplats fixes : clé de programme distincte, sinon three réutiliserait
  // le programme sans balancement pour un matériau de mêmes paramètres.
  material.customProgramCacheKey = () => 'vegetation-sway'

  material.userData.sway = { amplitude, speed, phase }
  /** Avance le balancement de `dt` secondes (jamais de temps négatif). */
  material.userData.update = (dt = 0) => {
    time += Math.max(0, Number(dt) || 0)
    uniforms.uTime.value = time
    return time
  }
  material.userData.time = () => time
  return material
}

/**
 * Libère les matériaux d'un décor ; sans effet sur un matériau déjà libéré.
 * @param {object | THREE.Material[] | null} materials
 * @returns {void}
 */
export function disposeVegetationMaterials(materials) {
  if (!materials) return
  const list = Array.isArray(materials) ? materials : Object.values(materials)
  for (const material of list) material?.dispose?.()
}
