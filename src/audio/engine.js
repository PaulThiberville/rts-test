/**
 * Moteur audio : AudioContext paresseux, gain maître, mute et persistance du volume.
 * Aucun nœud n'existe avant `unlock()` : les règles d'autoplay sont respectées et
 * `getSnapshot()` renvoie `suspended` / gain 0 tant que le joueur n'a pas agi.
 */
const MIN_VOLUME = 0
const MAX_VOLUME = 1

/** Écart maximal toléré entre le gain mesuré avant mute et celui restauré. */
const UNMUTE_TOLERANCE = 1e-6

/** Ramène un volume quelconque dans [0, 1]. */
function clampVolume(value) {
  return Math.min(MAX_VOLUME, Math.max(MIN_VOLUME, value))
}

/**
 * Applique un mute à un gain maître et renvoie le gain de restauration.
 * `gain` est un `AudioParam`, ou un objet `{ value }` factice pour l'autotest
 * headless : le moteur et le test partagent ainsi exactement le même code.
 */
function muteGain(gain, muted, level, restore) {
  if (!muted) {
    if (gain) gain.value = restore
    return restore
  }
  const measured = gain ? gain.value : level
  if (gain) gain.value = 0
  return measured
}

/**
 * Autotest de la checklist QA : mute puis démutage restaure le gain exact.
 * Ne crée aucun AudioContext : un harness headless peut l'appeler sans navigateur.
 * @param {{ volume?: number, tolerance?: number }} [options]
 * @returns {{ before: number, muted: number, after: number, delta: number }}
 */
export function assertUnmuteRestore({ volume = 0.4, tolerance = UNMUTE_TOLERANCE } = {}) {
  const level = clampVolume(volume)
  const gain = { value: level }
  let restore = level
  restore = muteGain(gain, true, level, restore)
  const muted = gain.value
  muteGain(gain, false, level, restore)
  const delta = Math.abs(gain.value - level)
  if (delta > tolerance) {
    throw new Error(`assertUnmuteRestore : gain restauré ${gain.value} au lieu de ${level} (Δ ${delta} > ${tolerance})`)
  }
  return { before: level, muted, after: gain.value, delta }
}

/** Volume enregistré, ou `null` si absent/illisible (stockage privé, JSON invalide). */
function readStoredVolume(storageKey) {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey)
    if (raw === null || raw === undefined) return null
    const value = Number.parseFloat(raw)
    return Number.isFinite(value) ? clampVolume(value) : null
  } catch {
    return null
  }
}

/** Persiste le volume sans jamais faire échouer l'appelant. */
function storeVolume(storageKey, value) {
  try {
    globalThis.localStorage?.setItem(storageKey, String(value))
  } catch {
    // Stockage indisponible : le volume reste valable pour la session.
  }
}

/**
 * @param {{ volume?: number, storageKey?: string }} [options]
 * @returns {{ unlock(): Promise<boolean>, setMuted(next: unknown): boolean, toggleMute(): boolean, setVolume(next: unknown): number, get context(): AudioContext | null, get master(): GainNode | null, get state(): AudioContextState | 'suspended', get masterGain(): number, get volume(): number, get muted(): boolean }}
 */
export function createEngine({ volume = 0.4, storageKey = 'clairiere.audio.volume' } = {}) {
  const stored = readStoredVolume(storageKey)
  let level = stored === null ? clampVolume(volume) : stored
  let muted = false
  /** Gain mesuré juste avant le mute, restauré à l'identique au démutage. */
  let unmuteGain = level
  let context = null
  let master = null

  function applyGain() {
    if (!master) return
    master.gain.value = muted ? 0 : level
  }

  function createContext() {
    const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext
    if (!Ctor) return null
    try {
      return new Ctor()
    } catch {
      return null
    }
  }

  /** Crée le contexte (une seule fois) puis le reprend après un geste joueur. */
  function unlock() {
    if (!context) {
      context = createContext()
      if (!context) return Promise.resolve(false)
      master = context.createGain()
      master.gain.value = muted ? 0 : level
      master.connect(context.destination)
    }
    return context
      .resume()
      .then(() => {
        applyGain()
        return context.state === 'running'
      })
      .catch(() => false)
  }

  function setMuted(next) {
    const value = Boolean(next)
    if (value === muted) return muted
    unmuteGain = muteGain(master ? master.gain : null, value, level, unmuteGain)
    muted = value
    return muted
  }

  function toggleMute() {
    return setMuted(!muted)
  }

  function setVolume(next) {
    const parsed = Number(next)
    if (!Number.isFinite(parsed)) return level
    level = clampVolume(parsed)
    unmuteGain = level
    if (!muted) applyGain()
    else if (master) master.gain.value = 0
    storeVolume(storageKey, level)
    return level
  }

  return {
    unlock,
    setMuted,
    toggleMute,
    setVolume,
    get context() {
      return context
    },
    get master() {
      return master
    },
    get state() {
      return context ? context.state : 'suspended'
    },
    get masterGain() {
      return master ? master.gain.value : 0
    },
    get volume() {
      return level
    },
    get muted() {
      return muted
    },
  }
}
