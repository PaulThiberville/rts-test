/**
 * Niveau 2 — Les Premiers Semis : matin clair, sol plus vert que la clairière du seuil.
 * ΔE76 Lab D65 (formule de level-1.js) : chemin #bfa072 / sol #f1ecd6 = 31,56 (≥ 30) ; sol 1 / sol 2 = 4,20.
 * Courbe : 165 végétaux hors graminées (+ 5,8 % vs 156), mêmes PV et vitesses que la carte 1.
 */
export const LEVEL_2 = {
  id: 'niveau-2-premiers-semis',
  bounds: { minX: -16, maxX: 16, minZ: -20, maxZ: 12, skirt: 6 },
  arrival: { edge: 'south', x: -2, z: 11 },
  heart: { x: 4.5, z: -5.5, radius: 3.4, color: '#6ec6b5', hp: 12, damage: 1 },
  // Tracé en S ouvert vers l'ouest puis l'est : 4 segments de 5,70 / 5,41 / 5,00 / 5,41 m.
  path: { width: 2.6, color: '#bfa072', points: [[-2, 11], [-5.5, 6.5], [-2.5, 2], [1.5, -1], [4.5, -5.5]] },
  slots: [
    { id: 'slot-1', x: -1.46, z: 6.97 },
    { id: 'slot-2', x: -6.41, z: 2.64 },
    { id: 'slot-3', x: 1.24, z: 2.82 },
    { id: 'slot-4', x: 4.2, z: -0.18 },
  ],
  startingResources: 120,
  windup: 8,
  combat: { range: 3.8, cadence: 1.0, damage: { sprout: 2, bloom: 4 } },
  shadows: { radius: 0.35, gap: 0.7 },
  // Même profil que la carte 1, une ombre de plus en vague 2 : +3,0 % de PV (238 vs 231).
  waves: [
    { count: 4, hp: 6, speed: 0.45, gap: 2.4 },
    { count: 5, hp: 7, speed: 0.47, gap: 2.2 },
    { count: 5, hp: 7, speed: 0.49, gap: 2.0 },
    { count: 5, hp: 8, speed: 0.51, gap: 1.8 },
    { count: 6, hp: 8, speed: 0.53, gap: 1.6 },
    { count: 7, hp: 8, speed: 0.55, gap: 1.4 },
  ],
  camera: { target: { x: 0, z: -2 }, yaw: [-0.45, 0.45], pitch: [0.72, 1.05], distance: [14, 20], pan: 2.5 },
  // Matin clair : soleil déjà haut et de biais, moins chaud que la fin d'après-midi du seuil.
  // ground est le rebond hémisphérique (éclairage), plus sombre que palette.ground qui est le sol.
  light: {
    sun: '#f4e2bc',
    sky: '#f1ecd6',
    ground: '#c3cdb4',
    intensity: 2.3,
    hour: 9.5,
    elevation: 0.95,
    azimuth: 2.4,
    shadowRadius: 4,
    shadowMapSize: 1024,
  },
  // Semis : moins d'arbres que la clairière, davantage de fleurs écloses entre les planches.
  decor: {
    seed: 11,
    rocks: 18,
    families: [
      { id: 'tree', count: 22, scale: [0.85, 1.3], height: [0.9, 1.1], spacing: 2.4, tintJitter: 0.06, sway: 0.35 },
      { id: 'bush', count: 43, scale: [0.6, 1.2], height: [0.8, 1.1], spacing: 1.1, tintJitter: 0.08, sway: 0.5 },
      { id: 'flower', count: 100, scale: [0.7, 1.2], height: [0.9, 1.1], spacing: 0.0, tintJitter: 0.12, sway: 0.8 },
      { id: 'grass', count: 1240, scale: [0.7, 1.4], height: [0.7, 1.4], spacing: 0.0, tintJitter: 0.1, sway: 1.0 },
    ],
  },
  ambience: {
    petals: { count: 60, speed: 0.35, drift: 0.8, size: 0.09 },
    fireflies: { count: 24, radius: 0.9, speed: 0.25, size: 0.07 },
  },
  // Les quatre teintes de familles sont identiques à la carte 1 : écart minimal avec les sols
  // des cartes = 17,10 (bush / sol 3), donc ≥ 15.
  palette: {
    ground: '#f1ecd6',
    sky: '#f1ecd6',
    sun: '#f4e2bc',
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
