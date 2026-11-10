/**
 * Niveau 4 — La Fontaine tiède : après-midi tiède, sol chaud, buissons et graminées serrés.
 * ΔE76 Lab D65 (formule de level-1.js) : chemin #bfa072 / sol #f6efdd = 33,29 (≥ 30) ; sol 3 / sol 4 = 5,17.
 * Courbe : 195 végétaux hors graminées (+ 8,3 % vs 180), PV totaux 279 (+ 5,7 % vs la carte 3).
 */
export const LEVEL_4 = {
  id: 'niveau-4-fontaine-tiede',
  bounds: { minX: -16, maxX: 16, minZ: -20, maxZ: 12, skirt: 6 },
  arrival: { edge: 'south', x: 1, z: 11 },
  heart: { x: -2, z: -12, radius: 3.4, color: '#6ec6b5', hp: 12, damage: 1 },
  // Tracé en zigzag large : 4 segments de 6,40 / 7,07 / 6,40 / 8,00 m (total 27,88 m).
  path: { width: 2.6, color: '#bfa072', points: [[1, 11], [-3, 6], [2, 1], [-2, -4], [-2, -12]] },
  slots: [
    { id: 'slot-1', x: 1.3, z: 6.6 },
    { id: 'slot-2', x: -2.6, z: 1.4 },
    { id: 'slot-3', x: 2.3, z: -3.4 },
    { id: 'slot-4', x: 1, z: -8 },
  ],
  startingResources: 120,
  windup: 8,
  combat: { range: 3.8, cadence: 1.0, damage: { sprout: 2, bloom: 4 } },
  shadows: { radius: 0.35, gap: 0.7 },
  // Chemin plus long que la carte 3 (27,88 contre 25,15 m) : une ombre de plus en vague 6.
  waves: [
    { count: 4, hp: 6, speed: 0.45, gap: 2.4 },
    { count: 5, hp: 7, speed: 0.47, gap: 2.2 },
    { count: 5, hp: 8, speed: 0.49, gap: 2.0 },
    { count: 6, hp: 9, speed: 0.51, gap: 1.8 },
    { count: 6, hp: 9, speed: 0.53, gap: 1.6 },
    { count: 8, hp: 9, speed: 0.55, gap: 1.4 },
  ],
  camera: { target: { x: 0, z: -4 }, yaw: [-0.45, 0.45], pitch: [0.72, 1.05], distance: [14, 20], pan: 2.5 },
  // Après-midi tiède : soleil encore haut et chaud, ombres moyennes, moins rasantes que la carte 1.
  // ground est le rebond hémisphérique (éclairage), plus sombre que palette.ground qui est le sol.
  light: {
    sun: '#f7dcaf',
    sky: '#f6efdd',
    ground: '#bdc8ad',
    intensity: 2.2,
    hour: 15.5,
    elevation: 0.7,
    azimuth: 1.35,
    shadowRadius: 4,
    shadowMapSize: 1024,
  },
  // Fontaine tiède : buissons et graminées en masse autour du bassin, arbres en couronne.
  decor: {
    seed: 17,
    rocks: 18,
    families: [
      { id: 'tree', count: 28, scale: [0.85, 1.3], height: [0.9, 1.1], spacing: 2.4, tintJitter: 0.06, sway: 0.35 },
      { id: 'bush', count: 47, scale: [0.6, 1.2], height: [0.8, 1.1], spacing: 1.1, tintJitter: 0.08, sway: 0.5 },
      { id: 'flower', count: 120, scale: [0.7, 1.2], height: [0.9, 1.1], spacing: 0.0, tintJitter: 0.12, sway: 0.8 },
      { id: 'grass', count: 1340, scale: [0.7, 1.4], height: [0.7, 1.4], spacing: 0.0, tintJitter: 0.1, sway: 1.0 },
    ],
  },
  ambience: {
    petals: { count: 60, speed: 0.35, drift: 0.8, size: 0.09 },
    fireflies: { count: 24, radius: 0.9, speed: 0.25, size: 0.07 },
  },
  // Les quatre teintes de familles sont identiques à la carte 1 : avec ce sol, les accents
  // gardent ΔE ≥ 25,19 (flowerAlt) et le buisson 21,52, donc ≥ 15 comme sur les cartes 1 à 3.
  palette: {
    ground: '#f6efdd',
    sky: '#f6efdd',
    sun: '#f7dcaf',
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
