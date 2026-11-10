/**
 * Catalogue des tours-plantes, en données pures (aucun import, aucun calcul exécuté).
 * Coûts en ressources entières ; les libellés vivent uniquement dans la clé i18n de `nameKey`.
 * Économie du niveau 1 : `startingResources` de `LEVEL_1` vaut 3 × `sprout.cost` (120), donc
 * trois poses de sprout, une quatrième refusée, et une amélioration qui passe après deux poses
 * (2 × 40 + 30 = 110 ≤ 120).
 */
export const TOWER_TYPES = ['sprout', 'bloom']
export const TOWERS = {
  sprout: { id: 'sprout', nameKey: 'tower.sprout.name', cost: 40, upgradeCost: 30, maxLevel: 2 },
  bloom: { id: 'bloom', nameKey: 'tower.bloom.name', cost: 60, upgradeCost: 40, maxLevel: 2 },
}
