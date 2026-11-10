/**
 * Voix synthétisées, aucun asset : nappe continue et trois retours d'action.
 * Toutes les enveloppes utilisent des rampes exponentielles vers 0,0001 (jamais 0)
 * et chaque nœud éphémère est arrêté puis déconnecté : pas d'accumulation.
 */
export const EFFECT_NAMES = ['plant', 'wave', 'repelled']

/** Plancher d'enveloppe : une rampe exponentielle ne peut pas viser 0. */
const MIN_GAIN = 0.0001

/** Niveau intrinsèque de la nappe, avant l'ajout du LFO. */
const AMBIENCE_LEVEL = 0.08
/**
 * Profondeur du LFO de la nappe : le gain oscille de 0,0755 à 0,0845,
 * soit 20·log10(0,0845 / 0,0755) = 0,98 dB ≤ 1 dB (exigence de la direction artistique).
 */
const AMBIENCE_DEPTH = 0.0045
/** Période très lente : 0,05 Hz, soit 20 s, pour une respiration imperceptible. */
const AMBIENCE_LFO_HZ = 0.05
const AMBIENCE_FADE_IN = 1.5
const AMBIENCE_FADE_OUT = 0.7

/**
 * Arrête les sources à `stopAt` puis déconnecte tous les nœuds de la voix.
 * `nodes` doit contenir au moins un nœud muni de `stop()` (un oscillateur).
 */
function release(nodes, stopAt) {
  const sources = nodes.filter((node) => typeof node.stop === 'function')
  for (let i = 0; i < sources.length; i++) sources[i].stop(stopAt)
  const first = sources[0]
  if (first) {
    first.onended = () => {
      for (let i = 0; i < nodes.length; i++) nodes[i].disconnect()
    }
  }
}

/**
 * @param {{ context: AudioContext, destination: AudioNode }} options
 * @returns {{ start(): boolean, stop(): boolean, play(name: string): boolean, readonly ambienceRunning: boolean, dispose(): void }}
 */
export function createVoices({ context, destination }) {
  let pad = null
  let running = false
  let disposed = false

  /** Nappe : deux triangles et une sinusoïde détunés, filtrés, à respiration ≤ 1 dB. */
  function start() {
    if (disposed || running) return running
    const now = context.currentTime

    const gain = context.createGain()
    gain.gain.setValueAtTime(MIN_GAIN, now)
    gain.gain.exponentialRampToValueAtTime(AMBIENCE_LEVEL, now + AMBIENCE_FADE_IN)
    gain.connect(destination)

    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 900
    filter.Q.value = 0.6
    filter.connect(gain)

    const lfo = context.createOscillator()
    lfo.type = 'sine'
    lfo.frequency.value = AMBIENCE_LFO_HZ
    const modulator = context.createGain()
    modulator.gain.value = AMBIENCE_DEPTH
    lfo.connect(modulator)
    modulator.connect(gain.gain)

    const layers = [
      { frequency: 110, type: 'triangle', detune: -4, gain: 0.5 },
      { frequency: 164.81, type: 'triangle', detune: 3, gain: 0.35 },
      { frequency: 220, type: 'sine', detune: -7, gain: 0.15 },
    ]
    const nodes = [filter, lfo, modulator]
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]
      const oscillator = context.createOscillator()
      oscillator.type = layer.type
      oscillator.frequency.value = layer.frequency
      oscillator.detune.value = layer.detune
      const mix = context.createGain()
      mix.gain.value = layer.gain
      oscillator.connect(mix)
      mix.connect(filter)
      oscillator.start(now)
      nodes.push(oscillator, mix)
    }
    lfo.start(now)

    pad = { gain, nodes, modulator }
    running = true
    return true
  }

  /** Coupe la modulation puis éteint la nappe en douceur avant de libérer ses nœuds. */
  function stop() {
    if (!pad) return false
    const now = context.currentTime
    const { gain, nodes, modulator } = pad
    pad = null
    running = false
    modulator.disconnect()
    gain.gain.cancelScheduledValues(now)
    gain.gain.setValueAtTime(Math.max(gain.gain.value, MIN_GAIN), now)
    gain.gain.exponentialRampToValueAtTime(MIN_GAIN, now + AMBIENCE_FADE_OUT)
    release(nodes, now + AMBIENCE_FADE_OUT + 0.1)
    return true
  }

  /** Cloche douce montante, 200 ms, variation de hauteur ±5 % pour éviter la répétition mécanique. */
  function playPlant(now) {
    const variation = 0.95 + Math.random() * 0.1
    const oscillator = context.createOscillator()
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(523.25 * variation, now)
    oscillator.frequency.exponentialRampToValueAtTime(783.99 * variation, now + 0.2)

    const partial = context.createOscillator()
    partial.type = 'sine'
    partial.frequency.setValueAtTime(1046.5 * variation, now)
    partial.frequency.exponentialRampToValueAtTime(1567.98 * variation, now + 0.2)
    const partialGain = context.createGain()
    partialGain.gain.value = 0.18

    const gain = context.createGain()
    gain.gain.setValueAtTime(MIN_GAIN, now)
    gain.gain.exponentialRampToValueAtTime(0.28, now + 0.015)
    gain.gain.exponentialRampToValueAtTime(MIN_GAIN, now + 0.2)

    oscillator.connect(gain)
    partial.connect(partialGain)
    partialGain.connect(gain)
    gain.connect(destination)
    // `stop()` n'est légal qu'après un démarrage : sans ces start(), release()
    // lèverait InvalidStateError et la cloche resterait muette.
    oscillator.start(now)
    partial.start(now)
    release([oscillator, partial, partialGain, gain], now + 0.21)
  }

  /** Nappe descendante discrète de 1 s, sans urgence : annonce la vague d'ombres. */
  function playWave(now) {
    const low = context.createOscillator()
    low.type = 'triangle'
    low.frequency.setValueAtTime(196, now)
    low.frequency.exponentialRampToValueAtTime(146.83, now + 1)

    const lower = context.createOscillator()
    lower.type = 'sine'
    lower.frequency.setValueAtTime(146.83, now)
    lower.frequency.exponentialRampToValueAtTime(110, now + 1)

    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.Q.value = 0.7
    filter.frequency.setValueAtTime(1400, now)
    filter.frequency.exponentialRampToValueAtTime(500, now + 1)

    const gain = context.createGain()
    gain.gain.setValueAtTime(MIN_GAIN, now)
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.18)
    gain.gain.exponentialRampToValueAtTime(MIN_GAIN, now + 1)

    low.connect(filter)
    lower.connect(filter)
    filter.connect(gain)
    gain.connect(destination)
    // Démarrage obligatoire avant l'arrêt planifié par release().
    low.start(now)
    lower.start(now)
    release([low, lower, filter, gain], now + 1.02)
  }

  /** Cloche feutrée « ombre repoussée » : filtre bas, extinction 280 ms (retour d'action), hauteur ±5 %. */
  function playRepelled(now) {
    const variation = 0.95 + Math.random() * 0.1
    const oscillator = context.createOscillator()
    oscillator.type = 'triangle'
    oscillator.frequency.setValueAtTime(392 * variation, now)
    oscillator.frequency.exponentialRampToValueAtTime(329.63 * variation, now + 0.28)

    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 620
    filter.Q.value = 0.8

    const gain = context.createGain()
    gain.gain.setValueAtTime(MIN_GAIN, now)
    gain.gain.exponentialRampToValueAtTime(0.14, now + 0.02)
    gain.gain.exponentialRampToValueAtTime(MIN_GAIN, now + 0.28)

    oscillator.connect(filter)
    filter.connect(gain)
    gain.connect(destination)
    // Démarrage avant l'arrêt planifié : sinon InvalidStateError, effet muet.
    oscillator.start(now)
    release([oscillator, filter, gain], now + 0.3)
  }

  function play(name) {
    if (disposed || !name) return false
    const now = context.currentTime
    if (name === 'plant') playPlant(now)
    else if (name === 'wave') playWave(now)
    else if (name === 'repelled') playRepelled(now)
    else return false
    return true
  }

  function dispose() {
    if (disposed) return
    stop()
    disposed = true
  }

  return {
    start,
    stop,
    play,
    dispose,
    get ambienceRunning() {
      return running
    },
  }
}
