/**
 * Sauvegarde locale de la progression : module pur, sans Three.js ni DOM.
 * Ne conserve qu'une liste d'ids terminés, dans l'ordre d'arrivée ; l'ordre des
 * niveaux et la règle de déblocage appartiennent à `src/main.js`.
 * Toutes les lectures et écritures sont tolérantes : stockage absent, mode privé,
 * quota ou JSON corrompu valent une liste vide, jamais une exception.
 */

/** Clé `localStorage` du format courant. */
export const STORAGE_KEY = 'seveclaire.progress.v1'

/**
 * Stockage par défaut, ou null : l'accès même à `globalThis.localStorage` peut
 * lever (mode privé), et le module ne doit jamais propager cette erreur.
 * @returns {Storage|null}
 */
function defaultStorage() {
  try {
    return globalThis.localStorage
  } catch {
    return null
  }
}

/** @returns {{ version: 1, completed: string[] }} */
function emptyProgress() {
  return { version: 1, completed: [] }
}

/** Ids uniques, non vides, dans l'ordre d'arrivée ; tout le reste est ignoré. */
function uniqueIds(values) {
  const completed = []
  for (const value of values) {
    if (typeof value !== 'string' || value === '' || completed.includes(value)) continue
    completed.push(value)
  }
  return completed
}

/**
 * Progression enregistrée, ou liste vide si la clé manque, si le JSON est invalide
 * ou mal typé, ou si le stockage lève.
 * @param {Storage} [storage]
 * @returns {{ version: 1, completed: string[] }}
 */
export function readProgress(storage = defaultStorage()) {
  try {
    const raw = storage?.getItem?.(STORAGE_KEY)
    if (typeof raw !== 'string') return emptyProgress()
    const parsed = JSON.parse(raw)
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.completed)) return emptyProgress()
    return { version: 1, completed: uniqueIds(parsed.completed) }
  } catch {
    return emptyProgress()
  }
}

/**
 * Écrit `{ version: 1, completed }` ; renvoie `true` si l'écriture a réussi.
 * @param {{ version?: number, completed?: string[] }} [progress]
 * @param {Storage} [storage]
 * @returns {boolean}
 */
export function writeProgress(progress, storage = defaultStorage()) {
  try {
    const completed = uniqueIds(Array.isArray(progress?.completed) ? progress.completed : [])
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, completed }))
    return true
  } catch {
    return false
  }
}

/**
 * Ajoute `levelId` s'il manque, écrit, et renvoie l'état à jour.
 * Une écriture impossible laisse l'état renvoyé intact, sans exception.
 * @param {string} levelId
 * @param {Storage} [storage]
 * @returns {{ version: 1, completed: string[] }}
 */
export function markCompleted(levelId, storage = defaultStorage()) {
  const progress = readProgress(storage)
  if (typeof levelId !== 'string' || levelId === '' || progress.completed.includes(levelId)) {
    return progress
  }
  progress.completed.push(levelId)
  writeProgress(progress, storage)
  return progress
}

/**
 * Efface la progression enregistrée ; sans effet si le stockage lève.
 * @param {Storage} [storage]
 */
export function resetProgress(storage = defaultStorage()) {
  try {
    storage?.removeItem?.(STORAGE_KEY)
  } catch {
    // Stockage indisponible : il n'y a rien à effacer, aucune erreur visible.
  }
}
