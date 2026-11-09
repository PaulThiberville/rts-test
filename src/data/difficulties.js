/**
 * Profils de difficulté, en données pures (aucun import, aucun calcul exécuté).
 * `multiplier` est un facteur numérique appliqué par le code de jeu aux paramètres de vague
 * (jamais une chaîne, aucune couleur ni position recopiée ici).
 * Les libellés vivent uniquement dans la clé i18n de `nameKey`.
 */
export const DIFFICULTIES = [
  { id: 'easy', nameKey: 'difficulty.easy.name', multiplier: 0.75 },
  { id: 'medium', nameKey: 'difficulty.medium.name', multiplier: 1 },
  { id: 'hard', nameKey: 'difficulty.hard.name', multiplier: 1.5 },
]

/** Difficulté dont l'id correspond, ou null. */
export function findDifficulty(id) {
  return DIFFICULTIES.find((difficulty) => difficulty.id === id) ?? null
}
