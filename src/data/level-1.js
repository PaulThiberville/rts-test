/**
 * Niveau 1 — la clairière de Sèveclaire, en données pures (aucun import, aucun calcul exécuté).
 * Unités : mètres pour les positions, secondes pour les durées, m/s pour les vitesses.
 * ΔE76 calculé en Lab CIE D65 depuis le sRGB (note Direction-Artistique, luminance relative sRGB) :
 *   chemin #bfa072 / sol #faf3e3 → ΔE = 34.97 (≥ 30, chemin lisible sur le sol)
 *   cœur #6ec6b5 / teintes de palette → minimum ΔE = 15.26 (arbre #8fb99a, ≥ 15)
 *
 * Emplacements de pose : tous dans `bounds`, à 2,5–3,2 m de la polyligne, donc dans les
 * 3,8 m de `combat.range` (une Pousse couvre un tronçon du chemin et ses ombres), à
 * ≥ 4,9 m du centre du cœur (`heart.radius + 1,5`) et à ≥ 2,2 m l'un de l'autre.
 *
 * Équilibrage — calculs de référence, aucun code exécuté :
 * - Chemin : 4 segments = 20,55 m ; une ombre le parcourt en 20,55 / `speed` secondes.
 * - Vague 1 : 4 ombres × 6 PV = 24 PV. Une Pousse seule tire 2 PV par seconde
 *   (`combat.cadence` 1,0 s, `combat.damage.sprout` 2) pendant 45,7 s de traversée,
 *   soit 91 PV : marge ×3,8 (×4,4 en ajoutant les 3 × 2,4 s d'apparition de la vague).
 *   L'ombre de tête meurt en 3 s de tir, alors que le pire emplacement la garde
 *   7,9 s dans sa portée (15,9 PV tirés, marge ×2,6) : elle n'atteint jamais le cœur.
 * - Économie mobile : 120 sève de départ = 3 Pousses (120) ou 2 Pousses + 1 amélioration
 *   (110). Vague 6 : 7 × 8 = 56 PV ; 3 Pousses offrent 6 PV/s × 37,4 s de traversée
 *   = 224 PV, marge ×4,0 même si la moitié des tirs se perd. 2 Pousses + amélioration
 *   restent gagnantes (4 PV/s sans l'amélioration : marge ×2,7).
 * - Courbe des PV totaux : 24 → 28 → 35 → 40 → 48 → 56 (+16,7 %, +25 %, +14,3 %,
 *   +20 %, +16,7 %), vitesse 0,45 → 0,55 m/s et gap 2,4 → 1,4 s : pression croissante,
 *   palier de respiration en vague 4.
 * - Durée : 8 s de répit initial (`windup`), puis ~52,9 + 50,3 + 49,9 + 47,5 + 46,8
 *   + 45,8 s ≈ 4 min 53, dans la cible d'une session mobile.
 * - Cœur : 12 PV (`heart.hp`), 1 dégât par fuite ; 12 fuites sur 31 ombres perdent.
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
  palette: { ground: '#faf3e3', path: '#bfa072', heart: '#6ec6b5', grass: '#a9c8a0', rock: '#cfc8bb', tree: '#8fb99a', bush: '#b7d3ac' },
  decor: { seed: 7, grass: 1200, rocks: 18, bushes: 40, trees: 26 },
}
