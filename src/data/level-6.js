/**
 * Niveau 6 — Le Cœur de Sève : brume douce du matin, bornes resserrées, sol le plus sombre.
 * ΔE76 Lab D65 (formule de level-1.js) : chemin #b5996c / sol #d7e1c6 = 30,58 (≥ 30) ; sol 5 / sol 6 = 4,55.
 * Courbe : 230 végétaux hors graminées (+ 9,5 % vs 210), PV totaux 307 (+ 6,6 % vs la carte 5).
 */
export const LEVEL_6 = {
  id: 'niveau-6-coeur-de-seve',
  bounds: { minX: -14, maxX: 14, minZ: -18, maxZ: 11, skirt: 6 },
  arrival: { edge: 'south', x: -1, z: 11 },
  heart: { x: -8, z: -12, radius: 3.4, color: '#6ec6b5', hp: 12, damage: 1 },
  // Tracé en crochet ouest : 5 segments de 7,00 / 5,83 / 5,83 / 5,83 / 5,00 m (total 29,49 m).
  // Chemin descendu à #b5996c : plus sombre que #bfa072 pour garder ΔE = 30,58 sur ce sol.
  path: { width: 2.6, color: '#b5996c', points: [[-1, 11], [-1, 4], [-6, 1], [-3, -4], [-8, -7], [-8, -12]] },
  slots: [
    { id: 'slot-1', x: 2, z: 7.5 },
    { id: 'slot-2', x: -5, z: 5.1 },
    { id: 'slot-3', x: -1.9, z: 0 },
    { id: 'slot-4', x: -4, z: -8.1 },
  ],
  startingResources: 120,
  windup: 8,
  combat: { range: 3.8, cadence: 1.0, damage: { sprout: 2, bloom: 4 } },
  shadows: { radius: 0.35, gap: 0.7 },
  // Cœur du jardin : chemin le plus long (29,49 m) et une ombre de plus par vague, + 6,6 % de PV.
  waves: [
    { count: 5, hp: 6, speed: 0.45, gap: 2.4 },
    { count: 5, hp: 7, speed: 0.47, gap: 2.2 },
    { count: 6, hp: 8, speed: 0.49, gap: 2.0 },
    { count: 6, hp: 9, speed: 0.51, gap: 1.8 },
    { count: 6, hp: 10, speed: 0.53, gap: 1.6 },
    { count: 8, hp: 10, speed: 0.55, gap: 1.4 },
  ],
  camera: { target: { x: -3, z: -4 }, yaw: [-0.45, 0.45], pitch: [0.72, 1.05], distance: [14, 20], pan: 2.5 },
  // Brume douce du matin : soleil bas et pâle, lumière diffuse de 1,7, ombres estompées.
  // ground est le rebond hémisphérique (éclairage), plus sombre que palette.ground qui est le sol.
  light: {
    sun: '#f2e4c8',
    sky: '#d7e1c6',
    ground: '#a9b69b',
    intensity: 1.7,
    hour: 7.5,
    elevation: 0.35,
    azimuth: 2.0,
    shadowRadius: 4,
    shadowMapSize: 1024,
  },
  // Cœur de Sève : bornes resserrées et espacements réduits, tout le décor tient dans le cadre.
  decor: {
    seed: 23,
    rocks: 18,
    families: [
      { id: 'tree', count: 30, scale: [0.85, 1.3], height: [0.9, 1.1], spacing: 2.1, tintJitter: 0.06, sway: 0.35 },
      { id: 'bush', count: 62, scale: [0.6, 1.2], height: [0.8, 1.1], spacing: 1.0, tintJitter: 0.08, sway: 0.5 },
      { id: 'flower', count: 138, scale: [0.7, 1.2], height: [0.9, 1.1], spacing: 0.0, tintJitter: 0.12, sway: 0.8 },
      { id: 'grass', count: 1420, scale: [0.7, 1.4], height: [0.7, 1.4], spacing: 0.0, tintJitter: 0.1, sway: 1.0 },
    ],
  },
  ambience: {
    petals: { count: 60, speed: 0.35, drift: 0.8, size: 0.09 },
    fireflies: { count: 24, radius: 0.9, speed: 0.25, size: 0.07 },
  },
  // Seul le buisson est retouché (#a5c495, plus soutenu) : sur ce sol plus sombre il garde
  // ΔE = 18,43 au lieu de 11,44 avec la teinte de la carte 1 ; les accents restent ≥ 22,26.
  palette: {
    ground: '#d7e1c6',
    sky: '#d7e1c6',
    sun: '#f2e4c8',
    path: '#b5996c',
    heart: '#6ec6b5',
    grass: '#a9c8a0',
    grassTall: '#c2c083',
    rock: '#cfc8bb',
    tree: '#8fb99a',
    bush: '#a5c495',
    flower: '#edb8c6',
    flowerAlt: '#e3d4f0',
    stem: '#77906a',
  },
}
