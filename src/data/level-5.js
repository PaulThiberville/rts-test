/**
 * Niveau 5 — Les Haies vives : fin d'après-midi voilé, haies de buissons le long du chemin.
 * ΔE76 Lab D65 (formule de level-1.js) : chemin #bfa072 / sol #e4ebd4 = 32,30 (≥ 30) ; sol 4 / sol 5 = 6,28.
 * Courbe : 210 végétaux hors graminées (+ 7,7 % vs 195), PV totaux 288 (+ 3,2 % vs la carte 4).
 */
export const LEVEL_5 = {
  id: 'niveau-5-haies-vives',
  bounds: { minX: -16, maxX: 16, minZ: -20, maxZ: 12, skirt: 6 },
  arrival: { edge: 'south', x: -6, z: 11 },
  heart: { x: 8, z: -10, radius: 3.4, color: '#6ec6b5', hp: 12, damage: 1 },
  // Tracé en longue diagonale vers l'est : 5 segments de 6,00 / 5,83 / 5,66 / 5,66 / 4,12 m (27,27 m).
  path: { width: 2.6, color: '#bfa072', points: [[-6, 11], [-6, 5], [-1, 2], [3, -2], [7, -6], [8, -10]] },
  slots: [
    { id: 'slot-1', x: -3, z: 8 },
    { id: 'slot-2', x: -5, z: 0.9 },
    { id: 'slot-3', x: 3.1, z: 2.1 },
    { id: 'slot-4', x: 2.9, z: -6.1 },
  ],
  startingResources: 120,
  windup: 8,
  combat: { range: 3.8, cadence: 1.0, damage: { sprout: 2, bloom: 4 } },
  shadows: { radius: 0.35, gap: 0.7 },
  // Haies qui allongent le trajet (27,27 m) : une ombre de plus en vagues 5 et 6, sans changer le rythme.
  waves: [
    { count: 4, hp: 6, speed: 0.45, gap: 2.4 },
    { count: 5, hp: 7, speed: 0.47, gap: 2.2 },
    { count: 5, hp: 8, speed: 0.49, gap: 2.0 },
    { count: 6, hp: 9, speed: 0.51, gap: 1.8 },
    { count: 7, hp: 9, speed: 0.53, gap: 1.6 },
    { count: 8, hp: 9, speed: 0.55, gap: 1.4 },
  ],
  camera: { target: { x: 1, z: -4 }, yaw: [-0.45, 0.45], pitch: [0.72, 1.05], distance: [14, 20], pan: 2.5 },
  // Fin d'après-midi voilé : soleil bas derrière un voile clair, ombres longues et très douces.
  // ground est le rebond hémisphérique (éclairage), plus sombre que palette.ground qui est le sol.
  light: {
    sun: '#f1dcba',
    sky: '#e4ebd4',
    ground: '#b5c1a5',
    intensity: 1.95,
    hour: 16.5,
    elevation: 0.5,
    azimuth: 0.6,
    shadowRadius: 4,
    shadowMapSize: 1024,
  },
  // Haies vives : buissons alignés en bord de chemin (espacement réduit), arbres en fond de parcelle.
  decor: {
    seed: 19,
    rocks: 18,
    families: [
      { id: 'tree', count: 28, scale: [0.85, 1.3], height: [0.9, 1.1], spacing: 2.4, tintJitter: 0.06, sway: 0.35 },
      { id: 'bush', count: 62, scale: [0.6, 1.2], height: [0.8, 1.1], spacing: 0.9, tintJitter: 0.08, sway: 0.5 },
      { id: 'flower', count: 120, scale: [0.7, 1.2], height: [0.9, 1.1], spacing: 0.0, tintJitter: 0.12, sway: 0.8 },
      { id: 'grass', count: 1380, scale: [0.7, 1.4], height: [0.7, 1.4], spacing: 0.0, tintJitter: 0.1, sway: 1.0 },
    ],
  },
  ambience: {
    petals: { count: 60, speed: 0.35, drift: 0.8, size: 0.09 },
    fireflies: { count: 24, radius: 0.9, speed: 0.25, size: 0.07 },
  },
  // Les quatre teintes de familles sont identiques à la carte 1 : avec ce sol, les accents
  // gardent ΔE ≥ 25,93 (grassTall) et le buisson 15,67, donc ≥ 15 comme sur les cartes 1 à 3.
  palette: {
    ground: '#e4ebd4',
    sky: '#e4ebd4',
    sun: '#f1dcba',
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
