import { createEngine } from './engine.js'
import { createVoices, EFFECT_NAMES } from './voices.js'

/** Nombre maximal de déclenchements d'un même effet par fenêtre glissante. */
const RATE_LIMIT = 3
const RATE_WINDOW_MS = 1000

/** Horloge murale : indépendante du temps AudioContext, qui gèle en arrière-plan. */
function nowMs() {
  return globalThis.performance ? globalThis.performance.now() : Date.now()
}

/**
 * Point d'entrée audio du jeu, sans asset : tout est synthétisé.
 * `createAudio()` ne touche pas au matériel ; `unlock()` doit être branché par
 * `main.js` sur le premier `pointerdown`/`keydown`, puis `startAmbience()`.
 * @param {{ volume?: number, storageKey?: string }} [options]
 * @returns {{ unlock(): Promise<boolean>, startAmbience(): boolean, stopAmbience(): boolean, play(name: string): boolean, setMuted(next: unknown): boolean, toggleMute(): boolean, setVolume(v: unknown): number, getSnapshot(): { contextState: AudioContextState | 'suspended', masterGain: number, volume: number, muted: boolean, ambienceRunning: boolean, lastEffect: { name: string, at: number } | null, effectCount: number } }}
 */
export function createAudio({ volume = 0.4, storageKey = 'clairiere.audio.volume' } = {}) {
  const engine = createEngine({ volume, storageKey })
  /** Déclenchements acceptés par effet, pour la fenêtre glissante de 1 s. */
  const triggers = new Map()
  let voices = null
  let lastEffect = null
  let effectCount = 0

  /** Voix créées à la première utilisation, après `unlock()` uniquement. */
  function ensureVoices() {
    if (voices) return voices
    if (!engine.context) return null
    voices = createVoices({ context: engine.context, destination: engine.master })
    return voices
  }

  /** Réserve un créneau : au-delà de 3 appels par seconde et par effet, refuse sans créer de nœud. */
  function accept(name) {
    const stamp = nowMs()
    let recent = triggers.get(name)
    if (!recent) {
      recent = []
      triggers.set(name, recent)
    }
    while (recent.length > 0 && stamp - recent[0] >= RATE_WINDOW_MS) recent.shift()
    if (recent.length >= RATE_LIMIT) return false
    recent.push(stamp)
    return true
  }

  function unlock() {
    return engine.unlock()
  }

  function startAmbience() {
    const instance = ensureVoices()
    return instance ? instance.start() : false
  }

  function stopAmbience() {
    return voices ? voices.stop() : false
  }

  function play(name) {
    if (typeof name !== 'string' || !EFFECT_NAMES.includes(name)) return false
    const instance = ensureVoices()
    if (!instance) return false
    if (!accept(name)) return false
    // Le contrat public renvoie un booléen et ne lève jamais : une erreur Web Audio
    // doit être absorbée ici plutôt que de casser la frame de jeu de l'appelant.
    let played = false
    try {
      played = instance.play(name) === true
    } catch {
      played = false
    }
    if (!played) return false
    effectCount += 1
    lastEffect = { name, at: Date.now() }
    return true
  }

  function setMuted(next) {
    return engine.setMuted(next)
  }

  function toggleMute() {
    return engine.toggleMute()
  }

  function setVolume(next) {
    return engine.setVolume(next)
  }

  function getSnapshot() {
    return {
      contextState: engine.state,
      masterGain: engine.masterGain,
      volume: engine.volume,
      muted: engine.muted,
      ambienceRunning: voices ? voices.ambienceRunning : false,
      lastEffect: lastEffect ? { name: lastEffect.name, at: lastEffect.at } : null,
      effectCount,
    }
  }

  return {
    unlock,
    startAmbience,
    stopAmbience,
    play,
    setMuted,
    toggleMute,
    setVolume,
    getSnapshot,
  }
}
