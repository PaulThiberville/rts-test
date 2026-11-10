/**
 * Niveau 1 — la clairière de Sèveclaire, en données pures (aucun import, aucun calcul exécuté).
 * Unités : mètres pour les positions, secondes pour les durées, m/s pour les vitesses.
 *
 * ΔE76 calculé en Lab CIE D65 depuis le sRGB (note Direction-Artistique, luminance relative sRGB) :
 *   chemin #bfa072 / sol #faf3e3 → ΔE = 34.97 (≥ 30, chemin lisible sur le sol)
 *   cœur #6ec6b5 / teintes de palette → minimum ΔE = 15.26 (arbre #8fb99a, ≥ 15)
 *   teintes de décor des 4 familles : chacune garde ΔE ≥ 15 avec toutes les teintes de la
 *   palette, existantes comme ajoutées. Minimums calculés depuis le sRGB :
 *     flower    #edb8c6 → 17.83 (vs flowerAlt), 22.20 (vs rock), 28.16 (vs ground)
 *     flowerAlt #e3d4f0 → 17.83 (vs flower), 22.49 (vs rock), 24.70 (vs ground)
 *     grassTall #c2c083 → 16.66 (vs path), 16.72 (vs sun), 17.13 (vs grass)
 *     stem      #77906a → 16.23 (vs tree), 20.54 (vs grass), 24.68 (vs bush)
 *   Minimum global des ajouts : ΔE = 16.23 (stem ↔ tree), au-dessus du seuil de 15 qui
 *   garde les quatre familles reconnaissables d'un coup d'œil. Mesures Lab de ces teintes :
 *   L* 57,0 à 86,9 et chroma 15,6 à 32,3 ; aucune teinte fluo, la plus chromatique
 *   (grassTall, C* 32,3) restant au niveau de heart (C* 30,6) et du reste de la palette.
 *
 * Budget de décor estimé, 4 familles instanciées (géométries low-poly, un draw call chacune) :
 *   tree 26 × ~90 tris ≈ 2 340 · bush 40 × ~100 ≈ 4 000 · flower 90 × ~20 ≈ 1 800
 *   grass 1 200 × ~6 ≈ 7 200 · rocks 18 × 20 ≈ 360 → ≈ 15 700 triangles, soit ~3 % du
 *   plafond de 500 000 du budget mobile.
 *   Draw calls : 4 (familles) + 1 (rochers) + 2 (pétales, lucioles) = 7, et ≤ 20 avec le sol,
 *   le chemin et le cœur : très en dessous des 300 autorisés en 390×844.
 *   L'ambiance est purement visuelle : elle ne pèse pas sur la boucle de jeu.
 *
 * Emplacements de pose : tous dans les bornes, à 2,5–3,2 m de la polyligne, donc dans les
 * 3,8 m de portée de combat (une Pousse couvre un tronçon du chemin et ses ombres), à
 * ≥ 4,9 m du centre du cœur (rayon + 1,5) et à ≥ 2,2 m l'un de l'autre.
 *
 * Équilibrage — calculs de référence, aucun code exécuté :
 * - Chemin : 4 segments = 20,55 m ; une ombre le parcourt en 20,55 / vitesse secondes.
 * - Vague 1 : 4 ombres × 6 PV = 24 PV. Une Pousse seule tire 2 PV par seconde
 *   (cadence 1,0 s, dégâts sprout 2) pendant 45,7 s de traversée, soit 91 PV : marge ×3,8
 *   (×4,4 en ajoutant les 3 × 2,4 s d'apparition de la vague). L'ombre de tête meurt en
 *   3 s de tir, alors que le pire emplacement la garde 7,9 s dans sa portée (15,9 PV tirés,
 *   marge ×2,6) : elle n'atteint jamais le cœur.
 * - Économie mobile : 120 sève de départ = 3 Pousses (120) ou 2 Pousses + 1 amélioration
 *   (110). Vague 6 : 7 × 8 = 56 PV ; 3 Pousses offrent 6 PV/s × 37,4 s de traversée
 *   = 224 PV, marge ×4,0 même si la moitié des tirs se perd. 2 Pousses + amélioration
 *   restent gagnantes (4 PV/s sans l'amélioration : marge ×2,7).
 * - Courbe des PV totaux : 24 → 28 → 35 → 40 → 48 → 56 (+16,7 %, +25 %, +14,3 %,
 *   +20 %, +16,7 %), vitesse 0,45 → 0,55 m/s et gap 2,4 → 1,4 s : pression croissante,
 *   palier de respiration en vague 4.
 * - Durée : 8 s de répit initial (windup), puis ~52,9 + 50,3 + 49,9 + 47,5 + 46,8
 *   + 45,8 s ≈ 4 min 53, dans la cible d'une session mobile.
 * - Cœur : 12 PV (heart.hp), 1 dégât par fuite ; 12 fuites sur 31 ombres perdent.
 */
export const LEVEL_1 = {
  id: 'niveau-1-clairiere',
  bounds: { minX: -16, maxX: 16, minZ: -20, maxZ: 12, skirt: 6 },
  arrival: { edge: 'south', x: 0, z: 11 },
  heart: { x: 0, z: -7, radius: 3.4, color: '#6ec6b5', hp: 12, damage: 1 },
  path: { width: 2.6, color: '#bfa072', points: [[0, 11], [2, 6], [-1.6, 1], [1.2, -3.5], [0, -7]] },
  slots: [
    { id: 'slot-1', x: 3.3, z: 2.95 },
    { id: 'slot-2', x: -3.9, z: 1.9 },
    { id: 'slot-3', x: 3.7, z: -2.2 },
    { id: 'slot-4', x: -3.4, z: -2.1 },
  ],
  startingResources: 120,
  windup: 8,
  combat: { range: 3.8, cadence: 1.0, damage: { sprout: 2, bloom: 4 } },
  shadows: { radius: 0.35, gap: 0.7 },
  waves: [
    { count: 4, hp: 6, speed: 0.45, gap: 2.4 },
    { count: 4, hp: 7, speed: 0.47, gap: 2.2 },
    { count: 5, hp: 7, speed: 0.49, gap: 2.0 },
    { count: 5, hp: 8, speed: 0.51, gap: 1.8 },
    { count: 6, hp: 8, speed: 0.53, gap: 1.6 },
    { count: 7, hp: 8, speed: 0.55, gap: 1.4 },
  ],
  camera: { target: { x: 0, z: -2 }, yaw: [-0.45, 0.45], pitch: [0.72, 1.05], distance: [14, 20], pan: 2.5 },
  // Lumière de fin d'après-midi : soleil chaud et rasant, ombres larges et peu contrastées.
  // sun et sky se retrouvent aussi dans palette ; ground est la teinte de rebond propre à
  // la lumière (hémisphérique, bas), plus sombre que palette.ground qui est le sol.
  light: {
    sun: '#f6d9a8',
    sky: '#faf3e3',
    ground: '#b9c4ab',
    intensity: 2.1,
    elevation: 0.62,
    azimuth: 0.85,
    shadowRadius: 4,
    shadowMapSize: 1024,
  },
  // Décor procédural : 4 familles de végétaux instanciées + rochers. Par famille,
  // count = nombre d'instances, scale = échelle au sol, height = multiplicateur vertical,
  // spacing = distance minimale entre deux instances (0 = pas de contrainte),
  // tintJitter = variation de teinte par instance, sway = amplitude du balancement.
  // Aucune paire d'instances ne doit être strictement identique (échelle, rotation, teinte).
  decor: {
    seed: 7,
    rocks: 18,
    families: [
      { id: 'tree', count: 26, scale: [0.85, 1.3], height: [0.9, 1.1], spacing: 2.4, tintJitter: 0.06, sway: 0.35 },
      { id: 'bush', count: 40, scale: [0.6, 1.2], height: [0.8, 1.1], spacing: 1.1, tintJitter: 0.08, sway: 0.5 },
      { id: 'flower', count: 90, scale: [0.7, 1.2], height: [0.9, 1.1], spacing: 0.0, tintJitter: 0.12, sway: 0.8 },
      { id: 'grass', count: 1200, scale: [0.7, 1.4], height: [0.7, 1.4], spacing: 0.0, tintJitter: 0.1, sway: 1.0 },
    ],
  },
  // Ambiance : pétales qui dérivent lentement et lucioles en cercle. Mouvements feutrés,
  // jamais au-dessus de la lisibilité du jeu (Direction-Artistique, Animation).
  ambience: {
    petals: { count: 60, speed: 0.35, drift: 0.8, size: 0.09 },
    fireflies: { count: 24, radius: 0.9, speed: 0.25, size: 0.07 },
  },
  palette: {
    ground: '#faf3e3',
    sky: '#faf3e3',
    sun: '#f6d9a8',
    path: '#bfa072',
    heart: '#6ec6b5',
    grass: '#a9c8a0',
    grassTall: '#c2c083',
    rock: '#cfc8bb',
    tree: '#8fb99a',
    bush: '#b7d3ac',
    flower: '#edb8c6',
    flowerAlt: '#e3d4f0',
    stem: '#77906a',
  },
}
