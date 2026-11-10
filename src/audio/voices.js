/**
 * Neuf voix synthétisées, aucun asset : la nappe continue et les retours d'action.
 * Trois familles de timbre — cloche (`bell`), nappe (`pad`), percussion bois (`wood`) —
 * partagent les mêmes garde-fous : enveloppe à attaque ≥ 10 ms et décroissance ≥ 90 ms,
 * rampes exponentielles vers 0,0001 (jamais 0), chaque nœud éphémère arrêté puis
 * déconnecté : aucune coupure sèche, aucune accumulation.
 */
export const EFFECT_NAMES = ['home', 'plant', 'upgrade', 'shoot', 'kill', 'core-hit', 'wave', 'victory', 'defeat']

/** Famille de timbre de chaque effet : la cloche rassure, le bois ponctue, la nappe respire. */
export const VOICE_FAMILIES = {
  home: 'bell',
  plant: 'bell',
  upgrade: 'wood',
  shoot: 'wood',
  kill: 'bell',
  'core-hit': 'pad',
  wave: 'pad',
  victory: 'bell',
  defeat: 'pad',
}

/**
 * Nom de l'Epic #48 encore appelé par `main.js` tant que #140 n'a pas rebranché
 * les neuf déclencheurs : « ombre repoussée » joue la voix `kill`.
 * Ces alias ne font pas partie de `EFFECT_NAMES` et ne créent aucune voix propre.
 */
export const LEGACY_EFFECT_NAMES = { repelled: 'kill' }

/** Plancher d'enveloppe : une rampe exponentielle ne peut pas viser 0. */
const MIN_GAIN = 0.0001

/** Attaque minimale (10 ms) et décroissance minimale (90 ms) : aucun son ne claque. */
const MIN_ATTACK = 0.01
const MIN_DECAY = 0.09

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

/** Durée du bruit de bois partagé par les voix `wood`, en secondes. */
const NOISE_SECONDS = 0.25

/** Variation de hauteur ±5 % : les sons fréquents ne deviennent jamais mécaniques. */
function vary() {
  return 0.95 + Math.random() * 0.1
}

/**
 * Arrête les sources à `stopAt` puis déconnecte tous les nœuds de la voix.
 * `nodes` doit contenir au moins un nœud muni de `stop()` (oscillateur ou buffer).
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
 * Pose une enveloppe douce sur un gain et renvoie l'instant d'extinction.
 * Attaque et décroissance sont bornées aux minima : jamais de rampe instantanée.
 */
function envelope(gain, now, attack, peak, decay) {
  const peakAt = now + Math.max(attack, MIN_ATTACK)
  const endAt = peakAt + Math.max(decay, MIN_DECAY)
  gain.gain.setValueAtTime(MIN_GAIN, now)
  gain.gain.exponentialRampToValueAtTime(peak, peakAt)
  gain.gain.exponentialRampToValueAtTime(MIN_GAIN, endAt)
  return endAt
}

/**
 * @param {{ context: AudioContext, destination: AudioNode }} options
 * @returns {{ start(): boolean, stop(): boolean, play(name: string): boolean, readonly ambienceRunning: boolean, dispose(): void }}
 */
export function createVoices({ context, destination }) {
  let pad = null
  let running = false
  let disposed = false
  /** Bruit blanc court, créé une seule fois par contexte et partagé par les voix bois. */
  let noiseBuffer = null

  function getNoiseBuffer() {
    if (noiseBuffer) return noiseBuffer
    const length = Math.ceil(context.sampleRate * NOISE_SECONDS)
    noiseBuffer = context.createBuffer(1, length, context.sampleRate)
    const data = noiseBuffer.getChannelData(0)
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
    return noiseBuffer
  }

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

  /**
   * Cloche : fondamentale triangle et partiels inharmoniques adoucis par un passe-bas.
   * Le glissando de hauteur reste lent (attaque + décroissance) : jamais de coup de cloche.
   */
  function playBell(now, { frequency, endFrequency = frequency, filterHz, peak, attack = 0.014, decay, partials = [2.01, 2.98] }) {
    const variation = vary()
    const from = frequency * variation
    const to = endFrequency * variation
    const glideAt = now + Math.max(attack, MIN_ATTACK) + Math.max(decay, MIN_DECAY)

    const gain = context.createGain()
    const stopAt = envelope(gain, now, attack, peak, decay)
    gain.connect(destination)

    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = filterHz
    filter.Q.value = 0.7
    filter.connect(gain)

    const nodes = [filter, gain]
    const body = context.createOscillator()
    body.type = 'triangle'
    body.frequency.setValueAtTime(from, now)
    body.frequency.exponentialRampToValueAtTime(to, glideAt)
    body.connect(filter)
    body.start(now)
    nodes.push(body)

    for (let i = 0; i < partials.length; i++) {
      const ratio = partials[i]
      const partial = context.createOscillator()
      partial.type = 'sine'
      partial.frequency.setValueAtTime(from * ratio, now)
      partial.frequency.exponentialRampToValueAtTime(to * ratio, glideAt)
      const mix = context.createGain()
      mix.gain.value = 0.28 / ratio
      partial.connect(mix)
      mix.connect(filter)
      partial.start(now)
      nodes.push(partial, mix)
    }

    release(nodes, stopAt + 0.02)
  }

  /**
   * Nappe : deux ou trois oscillateurs détunés qui glissent ensemble derrière un
   * passe-bas descendant. Attaque longue : le son s'installe, il ne tombe pas sur le joueur.
   */
  function playPad(now, { frequency, endFrequency, filterFrom, filterTo, peak, attack, decay, layers = [
    { ratio: 1, type: 'triangle', gain: 0.7 },
    { ratio: 1.5, type: 'sine', gain: 0.3 },
  ] }) {
    const glideAt = now + Math.max(attack, MIN_ATTACK) + Math.max(decay, MIN_DECAY)

    const gain = context.createGain()
    const stopAt = envelope(gain, now, attack, peak, decay)
    gain.connect(destination)

    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.Q.value = 0.7
    filter.frequency.setValueAtTime(filterFrom, now)
    filter.frequency.exponentialRampToValueAtTime(filterTo, glideAt)
    filter.connect(gain)

    const nodes = [filter, gain]
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]
      const oscillator = context.createOscillator()
      oscillator.type = layer.type
      oscillator.frequency.setValueAtTime(frequency * layer.ratio, now)
      oscillator.frequency.exponentialRampToValueAtTime(endFrequency * layer.ratio, glideAt)
      oscillator.detune.value = i % 2 === 0 ? -5 : 5
      const mix = context.createGain()
      mix.gain.value = layer.gain
      oscillator.connect(mix)
      mix.connect(filter)
      oscillator.start(now)
      nodes.push(oscillator, mix)
    }

    release(nodes, stopAt + 0.02)
  }

  /**
   * Percussion bois : corps triangulaire filtré + souffle de bruit dans un filtre à résonance.
   * L'enveloppe adoucit l'attaque (≥ 10 ms) : c'est un « toc » feutré, pas une caisse claire.
   */
  function playWood(now, { frequency, endFrequency, filterHz, peak, attack = 0.012, decay, noisePeak }) {
    const variation = vary()
    const glideAt = now + Math.max(attack, MIN_ATTACK) + Math.max(decay, MIN_DECAY)

    const gain = context.createGain()
    const stopAt = envelope(gain, now, attack, peak, decay)
    gain.connect(destination)

    const body = context.createOscillator()
    body.type = 'triangle'
    body.frequency.setValueAtTime(frequency * variation, now)
    body.frequency.exponentialRampToValueAtTime(endFrequency * variation, glideAt)
    const bodyFilter = context.createBiquadFilter()
    bodyFilter.type = 'lowpass'
    bodyFilter.frequency.value = filterHz
    bodyFilter.Q.value = 1.1
    body.connect(bodyFilter)
    bodyFilter.connect(gain)
    body.start(now)

    const noise = context.createBufferSource()
    noise.buffer = getNoiseBuffer()
    const band = context.createBiquadFilter()
    band.type = 'bandpass'
    band.frequency.setValueAtTime(filterHz * 1.6 * variation, now)
    band.frequency.exponentialRampToValueAtTime(filterHz * 1.1 * variation, glideAt)
    band.Q.value = 2.2
    const noiseGain = context.createGain()
    envelope(noiseGain, now, attack, noisePeak, decay)
    noise.connect(band)
    band.connect(noiseGain)
    noiseGain.connect(destination)
    noise.start(now)

    release([body, bodyFilter, gain, noise, band, noiseGain], stopAt + 0.02)
  }

  /** Une fonction par effet : mêmes noms que `EFFECT_NAMES`, aucun nom hors contrat. */
  const builders = {
    /** Accueil : cloche claire qui monte doucement, comme une porte qu'on ouvre. */
    home(now) {
      playBell(now, { frequency: 392, endFrequency: 523.25, filterHz: 2200, peak: 0.14, attack: 0.016, decay: 0.44 })
    },
    /** Pose : cloche douce, une note montante, 200 ms (direction artistique). */
    plant(now) {
      playBell(now, { frequency: 523.25, endFrequency: 783.99, filterHz: 3200, peak: 0.24, attack: 0.015, decay: 0.19, partials: [2.01] })
    },
    /** Amélioration : deux « toc » de bois ascendantes, une plante qui grandit d'un cran. */
    upgrade(now) {
      playWood(now, { frequency: 262, endFrequency: 330, filterHz: 780, peak: 0.17, attack: 0.012, decay: 0.13, noisePeak: 0.1 })
      playWood(now + 0.11, { frequency: 330, endFrequency: 392, filterHz: 900, peak: 0.16, attack: 0.012, decay: 0.16, noisePeak: 0.09 })
    },
    /** Tir : « toc » de bois très court, feutré et fréquent (±5 % de hauteur). */
    shoot(now) {
      playWood(now, { frequency: 330, endFrequency: 262, filterHz: 1200, peak: 0.14, attack: 0.01, decay: 0.1, noisePeak: 0.08 })
    },
    /** Élimination : cloche feutrée descendante, ≤ 1 s, aucune urgence. */
    kill(now) {
      playBell(now, { frequency: 392, endFrequency: 329.63, filterHz: 620, peak: 0.15, attack: 0.02, decay: 0.28, partials: [2.0] })
    },
    /** Dégât au cœur : nappe grave qui s'enfonce, jamais percussive. */
    'core-hit'(now) {
      playPad(now, { frequency: 98, endFrequency: 82.41, filterFrom: 520, filterTo: 300, peak: 0.18, attack: 0.09, decay: 0.42 })
    },
    /** Vague : nappe descendante discrète de 1 s, sans urgence. */
    wave(now) {
      playPad(now, {
        frequency: 196,
        endFrequency: 146.83,
        filterFrom: 1400,
        filterTo: 500,
        peak: 0.16,
        attack: 0.18,
        decay: 0.82,
        layers: [
          { ratio: 1, type: 'triangle', gain: 0.7 },
          { ratio: 0.75, type: 'sine', gain: 0.5 },
        ],
      })
    },
    /** Victoire : trois notes de harpe montantes (C5, E5, G5), récompense calme. */
    victory(now) {
      const notes = [523.25, 659.25, 783.99]
      for (let i = 0; i < notes.length; i++) {
        playBell(now + i * 0.12, { frequency: notes[i], filterHz: 3000, peak: 0.14, attack: 0.012, decay: 0.34, partials: [2.0] })
      }
    },
    /** Défaite : nappe descendante résignée, sans dureté ni coupure. */
    defeat(now) {
      playPad(now, {
        frequency: 220,
        endFrequency: 174.61,
        filterFrom: 800,
        filterTo: 360,
        peak: 0.15,
        attack: 0.12,
        decay: 0.9,
        layers: [
          { ratio: 1, type: 'triangle', gain: 0.7 },
          { ratio: 0.75, type: 'sine', gain: 0.45 },
        ],
      })
    },
  }

  function play(name) {
    if (disposed || !name) return false
    const builder = builders[LEGACY_EFFECT_NAMES[name] ?? name]
    if (!builder) return false
    builder(context.currentTime)
    return true
  }

  function dispose() {
    if (disposed) return
    stop()
    disposed = true
    noiseBuffer = null
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
