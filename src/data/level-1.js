/**
 * Niveau 1 — la clairière de Sèveclaire, en données pures (aucun import, aucun calcul exécuté).
 * Unités : mètres pour les positions, radians pour la caméra.
 * ΔE76 calculé en Lab CIE D65 depuis le sRGB (note Direction-Artistique, luminance relative sRGB) :
 *   chemin #bfa072 / sol #faf3e3 → ΔE = 34.97 (≥ 30, chemin lisible sur le sol)
 *   cœur #6ec6b5 / teintes de palette → minimum ΔE = 15.26 (arbre #8fb99a, ≥ 15)
 */
export const LEVEL_1 = {
  id: 'niveau-1-clairiere',
  bounds: { minX: -16, maxX: 16, minZ: -20, maxZ: 12, skirt: 6 },
  arrival: { edge: 'south', x: 0, z: 11 },
  heart: { x: 0, z: -7, radius: 3.4, color: '#6ec6b5' },
  path: { width: 2.6, color: '#bfa072', points: [[0, 11], [2, 6], [-1.6, 1], [1.2, -3.5], [0, -7]] },
  camera: { target: { x: 0, z: -2 }, yaw: [-0.45, 0.45], pitch: [0.72, 1.05], distance: [14, 20], pan: 2.5 },
  palette: { ground: '#faf3e3', path: '#bfa072', heart: '#6ec6b5', grass: '#a9c8a0', rock: '#cfc8bb', tree: '#8fb99a', bush: '#b7d3ac' },
  decor: { seed: 7, grass: 1200, rocks: 18, bushes: 40, trees: 26 },
}
