// Sonde Web Audio partagée (Epic #48) : `state.audio` n'est qu'un snapshot, on écoute le matériel.
// `installProbe` passe par page.addInitScript avant le premier chargement : enveloppe
// AudioNode.prototype.connect, repère le GainNode relié à `destination` (maître de src/audio/engine.js)
// et y branche deux AnalyserNode en série (680 ms nappe / 21 ms enveloppes d'effets) puis un gain 0
// vers `destination` : inaudible, sortie du jeu inchangée. `db()` = RMS en dBFS, `record` échantillonne.
const SAMPLE_MS = 100
export function installProbe() {
  if (!(window.AudioContext || window.webkitAudioContext)) return
  const probe = { master: null, slow: null, fast: null, buffers: {} }
  window.__probe = probe
  const connect = AudioNode.prototype.connect
  AudioNode.prototype.connect = function (destination, ...rest) {
    const result = connect.call(this, destination, ...rest)
    if (probe.master || !(this instanceof GainNode) || !(destination instanceof AudioDestinationNode)) return result
    probe.master = this
    for (const [key, size] of [['slow', 32768], ['fast', 1024]]) {
      probe[key] = this.context.createAnalyser()
      probe[key].fftSize = size
      probe.buffers[key] = new Float32Array(size)
    }
    const silent = this.context.createGain()
    silent.gain.value = 0
    connect.call(this, probe.slow); connect.call(probe.slow, probe.fast)
    connect.call(probe.fast, silent); connect.call(silent, this.context.destination)
    return result
  }
  probe.db = (key = 'slow') => {
    if (!probe[key]) return -Infinity
    probe[key].getFloatTimeDomainData(probe.buffers[key])
    let sum = 0
    for (const value of probe.buffers[key]) sum += value * value
    return sum > 0 ? 10 * Math.log10(sum / probe[key].fftSize) : -Infinity // 0 = silence
  }
  probe.dbFast = () => probe.db('fast')
  probe.record = (durationMs, stepMs = 100) => new Promise((resolve) => {
    const samples = []
    const start = performance.now()
    const id = setInterval(() => {
      const audio = window.__game.state.audio
      const t = performance.now() - start
      samples.push({ t, db: probe.db(), gain: audio.masterGain, effects: audio.effectCount, ambience: audio.ambienceRunning })
      if (t < durationMs) return
      clearInterval(id)
      resolve(samples)
    }, stepMs)
  })
}
// Dépouille les 60 s : coupures puis respiration. Un max−min brut du RMS (fenêtre 680 ms, bruit
// ±0,05 dB) gonfle la plage à ~1,08 dB pour une respiration réelle de 0,98 dB : on projette donc
// sur sin/cos à 0,05 Hz (20 s, AMBIENCE_LFO_HZ), la grille de 500 ms étant alignée sur la période.
// `residual` borne l'écart non modélisé ; les fenêtres où `effectCount` change sont exclues.
export function analyseAmbience(samples) {
  const ambienceGaps = []
  let silence = 0
  let longestSilence = 0
  for (const s of samples) {
    silence = Number.isFinite(s.db) ? 0 : silence + SAMPLE_MS
    longestSilence = Math.max(longestSilence, silence)
    if (!s.ambience) ambienceGaps.push(Math.round(s.t))
  }
  const grid = samples.filter((_, i) => i % 5 === 0) // un échantillon sur cinq = 500 ms
  const stable = grid.filter((s, i) => i > 0 && i + 1 < grid.length && s.effects === grid[i - 1].effects && s.effects === grid[i + 1].effects)
  const dbs = stable.map((s) => s.db)
  const amp = stable.map((s) => 10 ** (s.db / 20))
  const phase = stable.map((s) => (Math.PI * s.t) / 10000) // 2πt / 20 s
  const mean = amp.reduce((sum, y) => sum + y, 0) / amp.length
  let ys = 0; let yc = 0; let ss = 0; let cc = 0
  for (let i = 0; i < amp.length; i++) {
    const sn = Math.sin(phase[i]); const cs = Math.cos(phase[i])
    ys += (amp[i] - mean) * sn; yc += (amp[i] - mean) * cs; ss += sn * sn; cc += cs * cs
  }
  const b = ys / ss; const c = yc / cc
  const depth = Math.hypot(b, c)
  const drift = Math.max(...amp.map((y, i) => Math.abs(y - mean - b * Math.sin(phase[i]) - c * Math.cos(phase[i])) / mean))
  return {
    samples: samples.length, ambienceGaps, longestSilence, stable: stable.length,
    rawSpread: Math.max(...dbs) - Math.min(...dbs),
    low: 20 * Math.log10(mean - depth), high: 20 * Math.log10(mean + depth),
    spread: 20 * Math.log10((mean + depth) / (mean - depth)), residual: 20 * Math.log10(1 + drift),
    gains: [...new Set(stable.map((s) => s.gain))], effects: new Set(samples.map((s) => s.effects)).size,
  }
}
// Déclenche `event` (pose de Pousse pour `plant`, sinon émission sur le bus) en suivant
// l'enveloppe audible : 10 pas de plancher de nappe puis 1,5 s de mesure à 50 ms. `tail` = temps
// du retour sous `floor + 0,5 dB` après le pic ; l'enveloppe de gain s'éteint à 1,00 s (le
// `stop()` planifié de la vague à 1,02 s ne doit pas être mesuré).
export async function measureEffect(page, event, durationMs = 2000, stepMs = 50) {
  const { samples, firedAt } = await page.evaluate(({ name, duration, step }) => new Promise((resolve) => {
    const samples = []
    const start = performance.now()
    let firedAt = null
    const id = setInterval(() => {
      const t = performance.now() - start
      if (firedAt === null && samples.length >= 10) {
        firedAt = t
        if (name === 'plant') {
          window.__game.towers.selectType('sprout'); window.__game.towers.place('slot-1')
        } else window.__game.emit(name)
      }
      samples.push({ t, db: window.__probe.dbFast() })
      if (t < duration) return
      clearInterval(id)
      resolve({ samples, firedAt })
    }, step)
  }), { name: event, duration: durationMs, step: stepMs })
  const floor = Math.max(...samples.slice(0, 10).map((s) => s.db))
  let peak = 10; let loud = 10
  for (let i = 10; i < samples.length; i++) if (samples[i].db > samples[peak].db) peak = i
  for (let i = peak; i < samples.length; i++) if (samples[i].db > floor + 0.5) loud = i
  return { above: samples[peak].db - floor, tail: samples[Math.min(loud + 1, samples.length - 1)].t - firedAt }
}
