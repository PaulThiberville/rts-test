/**
 * Niveau 3 — Le Bosquet clair : matin haut, sol le plus vert des trois cartes livrées.
 * ΔE76 Lab D65 (formule de level-1.js) : chemin #bfa072 / sol #eaefd8 = 33,15 (≥ 30) ; sol 2 / sol 3 = 3,71.
 * Courbe : 180 végétaux hors graminées (+ 9,1 % vs 165), PV totaux 264 (+ 10,9 % vs la carte 2).
 */
export const LEVEL_3 = {
  id: 'niveau-3-bosquet-clair',
  bounds: { minX: -16, maxX: 16, minZ: -20, maxZ: 12, skirt: 6 },
  arrival: { edge: 'south', x: 3, z: 11 },
  heart: { x: -4, z: -9, radius: 3.4, color: '#6ec6b5', hp: 12, damage: 1 },
  // Tracé en long crochet : 5 segments de 5,70 / 6,02 / 5,32 / 4,61 / 3,50 m (total 25,15 m).
  path: { width: 2.6, color: '#bfa072', points: [[3, 11], [6.5, 6.5], [2.5, 2], [-1, -2], [-4, -5.5], [-4, -9]] },
  slots: [
    { id: 'slot-1', x: 7.04, z: 10.53 },
    { id: 'slot-2', x: 6.67, z: 2.32 },
    { id: 'slot-3', x: -1.43, z: 1.91 },
    { id: 'slot-4', x: -4.7, z: -1.86 },
  ],
  startingResources: 120,
  windup: 8,
  combat: { range: 3.8, cadence: 1.0, damage: { sprout: 2, bloom: 4 } },
  shadows: { radius: 0.35, gap: 0.7 },
  // Chemin plus long (25,15 m) que celui de la carte 2 : un PV de plus en fin de parcours
  // garde la même pression, sans dépasser + 20 % entre deux cartes.
  waves: [
    { count: 4, hp: 6, speed: 0.45, gap: 2.4 },
    { count: 5, hp: 7, speed: 0.47, gap: 2.2 },
    { count: 5, hp: 8, speed: 0.49, gap: 2.0 },
    { count: 6, hp: 8, speed: 0.51, gap: 1.8 },
    { count: 6, hp: 9, speed: 0.53, gap: 1.6 },
    { count: 7, hp: 9, speed: 0.55, gap: 1.4 },
  ],
  camera: { target: { x: 0.5, z: -2 }, yaw: [-0.45, 0.45], pitch: [0.72, 1.05], distance: [14, 20], pan: 2.5 },
  // Matin haut : soleil franc et presque au zénith, ombres plus courtes, sous-bois éclairé.
  // ground est le rebond hémisphérique (éclairage), plus sombre que palette.ground qui est le sol.
  light: {
    sun: '#f6e6c2',
    sky: '#eaefd8',
    ground: '#bccbaa',
    intensity: 2.4,
    hour: 10.5,
    elevation: 1.05,
    azimuth: 2.9,
    shadowRadius: 4,
    shadowMapSize: 1024,
  },
  // Bosquet : arbres en nombre et taillis fourni, sous-bois clair semé de fleurs et de graminées.
  decor: {
    seed: 13,
    rocks: 18,
    families: [
      { id: 'tree', count: 30, scale: [0.85, 1.3], height: [0.9, 1.1], spacing: 2.4, tintJitter: 0.06, sway: 0.35 },
      { id: 'bush', count: 50, scale: [0.6, 1.2], height: [0.8, 1.1], spacing: 1.1, tintJitter: 0.08, sway: 0.5 },
      { id: 'flower', count: 100, scale: [0.7, 1.2], height: [0.9, 1.1], spacing: 0.0, tintJitter: 0.12, sway: 0.8 },
      { id: 'grass', count: 1300, scale: [0.7, 1.4], height: [0.7, 1.4], spacing: 0.0, tintJitter: 0.1, sway: 1.0 },
    ],
  },
  ambience: {
    petals: { count: 60, speed: 0.35, drift: 0.8, size: 0.09 },
    fireflies: { count: 24, radius: 0.9, speed: 0.25, size: 0.07 },
  },
  // Les quatre teintes de familles sont identiques à la carte 1 : écart minimal avec les sols
  // des cartes = 17,10 (bush / sol 3), donc ≥ 15.
  palette: {
    ground: '#eaefd8',
    sky: '#eaefd8',
    sun: '#f6e6c2',
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
