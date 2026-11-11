// Playtest de l'Epic #130 — « aucun son sur mobile », un bloc par critère, dans l'ordre.
// Le contexte est un vrai contexte tactile : 390 × 844, `hasTouch`, UA Safari/iOS, et
// le premier geste du critère 1 est un `tap` sur le canvas du jardin. La sonde Web Audio (#48) branche des
// analyseurs ; la sonde de voix (lib/audio-probe.mjs) relève les sources réellement
// démarrées et les enveloppes programmées, pour distinguer les neuf moments sans se
// contenter de `state.sound.played`. Une voix = les sources lancées au même instant ;
// deux moments ne doivent jamais produire la même voix. La partie est mise en pause
// (`state.paused`) pour que le tir automatique d'une tour ne salisse pas une mesure.
// Captures : test-results/<prefix>epic-130-c<n>-*.png (préfixe `issue-N-` en worktree).
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { outputDir } from '../../scripts/lib.mjs'
import { EFFECT_NAMES, VOICE_FAMILIES } from '../../src/audio/voices.js'
import { installProbe, installVoiceProbe } from './lib/audio-probe.mjs'

// En worktree parallèle, outputDir() vise le test-results/ du dépôt principal.
const { results, prefix } = outputDir()
const RESULTS = results
const AUDIO_DIR = new URL('../../public/audio/', import.meta.url)
const DA = new URL('../../vault/GDD/Direction-Artistique.md', import.meta.url)
const MOBILE = { width: 390, height: 844 }
const SAFARI_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const AUDIO_EXT = /\.(mp3|ogg|oga|wav|m4a|aac|flac|opus|webm)$/i
const MAX_BYTES = 100 * 1024
/** Point de canvas libre des commandes : le geste ne déclenche que le déverrouillage audio. */
const TAP = { x: 195, y: 12 }
const shot = (page, label) => page.screenshot({ path: join(RESULTS, `${prefix}epic-130-${label}.png`) })

/** Une voix = les sources démarrées au même instant, avec l'enveloppe la plus forte. */
function voicesOf(dump, family) {
  const taken = new Set()
  const voices = []
  for (const source of dump.sources) {
    if (source.startAt === null || taken.has(source)) continue
    const group = { family, oscillators: [], noise: false, startAt: source.startAt }
    for (const other of dump.sources) {
      if (other.startAt === null || taken.has(other)) continue
      if (Math.abs(other.startAt - source.startAt) > 0.005) continue
      taken.add(other)
      if (other.kind === 'noise') group.noise = true
      else group.oscillators.push(other)
    }
    let envelope = null
    for (const gain of dump.gains) {
      const events = [...gain.events].sort((a, b) => a.time - b.time)
      if (events.length < 2) continue
      const t0 = events[0].time
      if (Math.abs(t0 - group.startAt) > 0.01) continue
      const peak = events.reduce((best, event) => (event.value > best.value ? event : best), events[0])
      const last = events[events.length - 1]
      if (!(peak.time > t0) || !(last.time > peak.time)) continue
      const candidate = { attackMs: (peak.time - t0) * 1000, decayMs: (last.time - peak.time) * 1000, peak: peak.value }
      if (!envelope || candidate.peak > envelope.peak) envelope = candidate
    }
    const body = group.oscillators[0]
    const ramp = body?.freq?.length ? body.freq : []
    const hzStart = ramp.length ? ramp[0].value : null
    const hzEnd = ramp.length ? ramp[ramp.length - 1].value : null
    const glide = hzStart && hzEnd
      ? (hzEnd / hzStart > 1.02 ? 'up' : hzEnd / hzStart < 0.98 ? 'down' : 'flat')
      : null
    voices.push({
      family,
      oscillators: group.oscillators.length,
      noise: group.noise,
      hzStart,
      glide,
      attackMs: envelope ? envelope.attackMs : null,
      decayMs: envelope ? envelope.decayMs : null,
    })
  }
  return voices
}

/** Même voix : même famille, même nombre de sources, même geste de hauteur, mêmes enveloppes. */
function sameVoice(a, b) {
  if (a.family !== b.family || a.oscillators !== b.oscillators || a.noise !== b.noise || a.glide !== b.glide) return false
  if (a.attackMs === null || b.attackMs === null) return false
  if (Math.abs(a.attackMs - b.attackMs) > 20 || Math.abs(a.decayMs - b.decayMs) > 30) return false
  // Hauteur : ±5 % de variation aléatoire par voix, on compare donc en log.
  return Math.abs(Math.log2(a.hzStart / b.hzStart)) <= 0.09
}

export default async function ({ page }) {
  const browser = page.context().browser()
  const BASE = new URL(page.url()).origin + '/'
  const context = await browser.newContext({
    viewport: MOBILE,
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
    userAgent: SAFARI_IOS,
    locale: 'fr-FR',
  })
  const mobile = await context.newPage()
  const errors = []
  const media = []
  mobile.on('console', (message) => message.type() === 'error' && errors.push(message.text()))
  mobile.on('pageerror', (error) => errors.push(error.message))
  mobile.on('request', (request) => {
    if (request.resourceType() === 'media' || AUDIO_EXT.test(new URL(request.url()).pathname)) media.push(request.url())
  })
  await mobile.addInitScript(installProbe)
  await mobile.addInitScript(installVoiceProbe)

  const failures = []
  const check = (ok, message) => { if (!ok) failures.push(message) }
  const block = async (num, run) => { try { await run() } catch (error) { failures.push(`critère ${num} : ${error.message}`) } }
  const state = () => mobile.evaluate(() => JSON.parse(JSON.stringify(window.__game.state)))
  const resetVoices = () => mobile.evaluate(() => window.__voiceProbe.reset())
  const dumpVoices = () => mobile.evaluate(() => window.__voiceProbe.dump())
  const wall = (ms) => mobile.evaluate((duration) => new Promise((resolve) => {
    const start = performance.now()
    const id = setInterval(() => {
      if (performance.now() - start < duration) return
      clearInterval(id)
      resolve()
    }, 20)
  }), ms)
  /** Deux images de rendu : laisse le temps au butin d'être programmé sans pause arbitraire. */
  const frames = (count = 2) => mobile.evaluate((wanted) => new Promise((resolve) => {
    let seen = 0
    const loop = () => (++seen >= wanted ? resolve() : requestAnimationFrame(loop))
    requestAnimationFrame(loop)
  }), count)
  async function loadMobile(query = '') {
    await mobile.goto(BASE + query)
    await mobile.waitForFunction(() => window.__game?.state.frames > 0, null, { timeout: 15_000 })
    const webgl = await mobile.evaluate(() => window.__game.renderer.getContext() instanceof WebGL2RenderingContext)
    check(webgl, 'contexte WebGL2 absent dans le contexte mobile')
  }
  const tapCanvas = () => mobile.touchscreen.tap(TAP.x, TAP.y)
  async function waitRunning() {
    try {
      await mobile.waitForFunction(() => window.__game.state.audio.contextState === 'running', null, { timeout: 5000 })
    } catch {
      const audio = (await state()).audio
      throw new Error(`contexte non démarré (contextState=${audio.contextState}, masterGain=${audio.masterGain})`)
    }
  }
  /** Déverrouille par le premier tap, puis met la scène en pause pour des mesures isolées. */
  async function unlockAndPause() {
    await tapCanvas()
    await waitRunning()
    await mobile.evaluate(() => { window.__game.state.paused = true })
    await frames(2)
  }
  /** Mesure un moment : aucune autre voix ne peut être programmée pendant la fenêtre. */
  async function moment(name, label, action) {
    await resetVoices()
    const before = (await state()).sound.effectCount
    await action()
    await frames(2)
    const dump = await dumpVoices()
    const after = (await state()).sound
    const voices = voicesOf(dump, VOICE_FAMILIES[name])
    check(after.played.includes(name), `moment ${label} : « ${name} » absent de sound.played (${after.played.join(', ') || 'aucun'})`)
    check(after.lastEffect?.name === name, `moment ${label} : dernière voix « ${after.lastEffect?.name} », attendu ${name}`)
    check(after.effectCount - before === 1, `moment ${label} : ${after.effectCount - before} voix jouées, attendu exactement 1`)
    check(voices.length >= 1, `moment ${label} : aucune source démarrée (sonde de voix)`)
    check(voices.every((voice) => voice.attackMs > 0 && voice.decayMs > 0), `moment ${label} : enveloppe incomplète (attaque ${voices.map((v) => v.attackMs).join(', ')} ms)`)
    // Deux images hors pause : le ghost de pose se range, le décor se stabilise. La mesure
    // est déjà faite, ces sources-là ne comptent pas dans la fenêtre du moment.
    await mobile.evaluate(() => { window.__game.state.paused = false })
    await frames(2)
    await mobile.evaluate(() => { window.__game.state.paused = true })
    await frames(1)
    await shot(mobile, `c3-${name}`)
    return { name, label, voices }
  }

  // Critère 1 — premier appui tactile sur le canvas : contexte running, source en lecture.
  await block(1, async () => {
    await loadMobile('?niveau=1')
    const idle = (await state()).audio
    check(idle.contextState === 'suspended', `critère 1 : contexte ${idle.contextState} au chargement, attendu suspended`)
    check(idle.masterGain === 0, `critère 1 : gain ${idle.masterGain} au chargement, attendu 0`)
    await shot(mobile, 'c1-avant-tap')
    await resetVoices()
    // Le canvas seul : aucun bouton du HUD sous le doigt, le geste ne fait que déverrouiller.
    await mobile.touchscreen.tap(195, 420)
    await waitRunning()
    await mobile.waitForFunction(() => window.__game.state.sound.played.includes('home'), null, { timeout: 3000 })
    const after = (await state()).audio
    check(after.contextState === 'running', `critère 1 : contexte ${after.contextState} après le tap`)
    check(after.masterGain > 0, 'critère 1 : gain master nul après le tap')
    const dump = await dumpVoices()
    const started = dump.sources.filter((source) => source.startAt !== null)
    check(started.length >= 1, `critère 1 : aucune source démarrée par la sonde (${dump.sources.length} créées)`)
    // Niveau mesuré par les analyseurs de la sonde #48 : le tap produit du signal, pas seulement un gain.
    const maxDb = await mobile.evaluate(() => new Promise((resolve) => {
      let loudest = -Infinity
      const start = performance.now()
      const id = setInterval(() => {
        loudest = Math.max(loudest, window.__probe.dbFast())
        if (performance.now() - start < 700) return
        clearInterval(id)
        resolve(loudest)
      }, 20)
    }))
    check(Number.isFinite(maxDb) && maxDb > -60, `critère 1 : signal ${maxDb.toFixed(1)} dBFS après le tap (attendu > -60)`)
    await shot(mobile, 'c1-apres-tap')
    check(errors.length === 0, `critère 1 : erreurs console (${errors.join(' | ')})`)
  })

  // Critère 2 — onglet caché puis revenu : reprise auto ≤ 1 s, dernière voix rejouable.
  await block(2, async () => {
    await loadMobile()
    await tapCanvas()
    await waitRunning()
    await mobile.evaluate(() => window.__game.emit('tower-shot'))
    await frames(2)
    const beforeHide = (await state()).sound
    const resumeBefore = beforeHide.resumeCount
    check(beforeHide.lastEffect?.name === 'shoot', `critère 2 : dernière voix « ${beforeHide.lastEffect?.name} », attendu shoot`)
    await mobile.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await wall(400)
    const hidden = (await state()).audio
    check(hidden.contextState === 'running', `critère 2 : contexte ${hidden.contextState} pendant le masquage`)
    await shot(mobile, 'c2-onglet-cache')
    await resetVoices()
    const startedAt = Date.now()
    await mobile.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await mobile.waitForFunction((count) => window.__game.state.sound.resumeCount > count, resumeBefore, { timeout: 1000, polling: 10 })
    const elapsed = Date.now() - startedAt
    check(elapsed <= 1000, `critère 2 : reprise en ${elapsed} ms > 1 s`)
    const visible = (await state()).audio
    check(visible.contextState === 'running', `critère 2 : contexte ${visible.contextState} au retour`)
    // Dernière voix rejouable sans nouvel appui : le même déclencheur rejoue.
    const beforeReplay = (await state()).sound.effectCount
    await mobile.evaluate(() => window.__game.emit('tower-shot'))
    await frames(2)
    const replay = (await state()).sound
    const dump = await dumpVoices()
    check(replay.effectCount > beforeReplay, 'critère 2 : la dernière voix ne se rejoue pas au retour')
    check(dump.sources.filter((source) => source.startAt !== null).length >= 1, 'critère 2 : aucune source rejouée par la sonde')
    check(replay.resumeCount > resumeBefore, 'critère 2 : resumeCount inchangé')
    await shot(mobile, 'c2-retour')
  })

  // Critère 3 — les neuf moments : une voix chacun, ensembles deux à deux disjoints.
  const moments = []
  await block(3, async () => {
    // Accueil mesuré au retour depuis un jardin : le premier tap (nappe comprise) est
    // couvert par le critère 1, ici seule la cloche d'accueil doit sonner.
    await loadMobile('?niveau=1')
    await unlockAndPause()
    moments.push(await moment('home', 'accueil', () => mobile.locator('.high-bar__back').tap()))
    // Le reste de la partie : jardin 1, scène en pause pour isoler chaque déclencheur.
    await loadMobile('?niveau=1')
    await unlockAndPause()
    moments.push(await moment('plant', 'pose', async () => {
      await mobile.evaluate(() => {
        window.__game.towers.selectType('sprout')
        window.__game.towers.place('slot-1')
        // La tour est posée : on relâche la sélection pour que la capture ne montre que la scène.
        window.__game.towers.selectType(null)
      })
    }))
    moments.push(await moment('upgrade', 'amélioration', async () => {
      const placed = await mobile.evaluate(() => window.__game.state.towers[0]?.id ?? null)
      check(placed !== null, 'critère 3 : aucune tour posée à améliorer')
      await mobile.evaluate((id) => window.__game.towers.upgrade(id), placed)
    }))
    moments.push(await moment('shoot', 'tir', () => mobile.evaluate(() => window.__game.emit('tower-shot'))))
    moments.push(await moment('kill', 'élimination', () => mobile.evaluate(() => window.__game.emit('shade-repelled'))))
    moments.push(await moment('core-hit', 'dégât au cœur', () => mobile.evaluate(() => window.__game.emit('heart-hit', { hp: 2, damage: 1 }))))
    moments.push(await moment('wave', 'début de vague', () => mobile.evaluate(() => window.__game.emit('wave-start', { index: 1 }))))
    moments.push(await moment('victory', 'victoire', () => mobile.evaluate(() => window.__game.emit('victory', { elapsed: 60 }))))
    moments.push(await moment('defeat', 'défaite', () => mobile.evaluate(() => window.__game.emit('defeat', { elapsed: 60 }))))
    check(moments.length === 9, `critère 3 : ${moments.length} moments mesurés, attendu 9`)
    check(EFFECT_NAMES.every((name) => moments.some((entry) => entry.name === name && entry.voices.length > 0)), 'critère 3 : un des neuf noms de #136 n’a pas de voix')
    for (let i = 0; i < moments.length; i++) {
      for (let j = i + 1; j < moments.length; j++) {
        for (const a of moments[i].voices) {
          for (const b of moments[j].voices) {
            check(!sameVoice(a, b), `critère 3 : voix partagée entre « ${moments[i].label} » et « ${moments[j].label} » (${a.family}, ${a.oscillators} sources, ${a.glide}, attaque ${Math.round(a.attackMs)} ms, décroissance ${Math.round(a.decayMs)} ms)`)
          }
        }
      }
    }
  })

  // Critère 4 — timbre : ≥ 9 voix distinctes, ≥ 3 familles, attaque et décroissance non nulles.
  await block(4, async () => {
    const families = VOICE_FAMILIES
    check(new Set(Object.values(families)).size >= 3, `critère 4 : ${new Set(Object.values(families)).size} familles, attendu ≥ 3`)
    const all = moments.flatMap((entry) => entry.voices)
    check(all.length >= 9, `critère 4 : ${all.length} voix relevées, attendu ≥ 9`)
    const clusters = []
    for (const voice of all) {
      const found = clusters.find((cluster) => sameVoice(cluster[0], voice))
      if (found) found.push(voice)
      else clusters.push([voice])
    }
    check(clusters.length >= 9, `critère 4 : ${clusters.length} voix distinctes, attendu ≥ 9`)
    check(all.every((voice) => voice.attackMs > 0 && voice.decayMs > 0), 'critère 4 : attaque ou décroissance nulle sur une enveloppe')
    // Aucun effet réduit à un bip sinusoïdal : au moins deux sources, ou un souffle de bois.
    for (const entry of moments) {
      check(entry.voices.some((voice) => voice.oscillators >= 2 || voice.noise), `critère 4 : « ${entry.label} » réduit à un bip unique`)
    }
    const stateNow = (await state()).sound
    check(new Set(Object.values(stateNow.families)).size >= 3, `critère 4 : state.sound.families ne porte que ${new Set(Object.values(stateNow.families)).size} familles`)
    await shot(mobile, 'c4-timbre')
  })

  // Critère 5 — volume par défaut, muet par tap, rétabli à ±0,01, atteignable au clavier.
  await block(5, async () => {
    await loadMobile()
    await tapCanvas()
    await waitRunning()
    const audio = (await state()).audio
    check(audio.defaultVolume >= 0.35 && audio.defaultVolume <= 0.5, `critère 5 : defaultVolume ${audio.defaultVolume} hors de [0,35 ; 0,50]`)
    const before = (await state()).audio
    check(before.muted === false && before.masterGain > 0, `critère 5 : état initial muted=${before.muted}, gain=${before.masterGain}`)
    await shot(mobile, 'c5-avant-muet')
    await mobile.locator('.audio-toggle').tap()
    await wall(150)
    const muted = (await state()).audio
    check(muted.muted === true, 'critère 5 : le tap sur la pastille ne coupe pas le son')
    check(Math.abs(muted.masterGain) < 0.001, `critère 5 : gain ${muted.masterGain} en muet, attendu 0`)
    await shot(mobile, 'c5-muet')
    await mobile.locator('.audio-toggle').tap()
    await wall(150)
    const restored = (await state()).audio
    check(restored.muted === false, 'critère 5 : second tap ne rétablit pas le son')
    check(Math.abs(restored.masterGain - before.masterGain) <= 0.01, `critère 5 : gain rétabli ${restored.masterGain} ≠ ${before.masterGain} (±0,01)`)
    await shot(mobile, 'c5-retabli')
    // Clavier sur une page neuve : le déverrouillage passe par une touche, aucun tap ne
    // déplace le point de départ de Tab ; le premier arrêt doit être la pastille.
    await loadMobile()
    await mobile.keyboard.press('Shift')
    await waitRunning()
    await mobile.keyboard.press('Tab')
    const focus = await mobile.evaluate(() => ({
      className: document.activeElement?.className ?? null,
      label: document.activeElement?.getAttribute?.('aria-label') ?? '',
    }))
    check(String(focus.className).includes('audio-toggle'), `critère 5 : Tab atteint « ${focus.className} », pas la pastille`)
    check(focus.label.trim().length > 0 && !focus.label.startsWith('audio.'), `critère 5 : aria-label non localisé « ${focus.label} »`)
    const beforeKey = (await state()).audio
    await mobile.keyboard.press('Enter')
    await wall(150)
    const byKey = (await state()).audio
    check(byKey.muted !== beforeKey.muted, 'critère 5 : Entrée n’active pas la pastille')
    await shot(mobile, 'c5-clavier')
    await mobile.keyboard.press('Enter')
    await wall(150)
  })

  // Critère 6 — aucun média > 100 Ko, aucune requête média, captures écrites.
  await block(6, async () => {
    let entries = []
    try {
      entries = await readdir(AUDIO_DIR, { withFileTypes: true })
    } catch (error) {
      check(error.code === 'ENOENT', `critère 6 : lecture de public/audio impossible (${error.code})`)
    }
    const files = entries.filter((entry) => entry.isFile() && entry.name !== '.gitkeep')
    for (const file of files) {
      const { size } = await stat(new URL(file.name, AUDIO_DIR))
      check(size <= MAX_BYTES, `critère 6 : ${file.name} pèse ${Math.round(size / 1024)} Ko > 100 Ko`)
    }
    check(media.length === 0, `critère 6 : ${media.length} requête(s) média (${media.slice(0, 3).join(', ')})`)
    const players = await mobile.evaluate(() => document.querySelectorAll('audio, video').length)
    check(players === 0, `critère 6 : ${players} élément(s) média dans le document`)
    check(errors.length === 0, `critère 6 : erreurs console (${errors.join(' | ')})`)
    await shot(mobile, 'c6-sans-media')
  })

  // Critère 7 — la section Son du Vault liste les neuf effets et le gain par défaut.
  await block(7, async () => {
    const note = await readFile(DA, 'utf8')
    const start = note.indexOf('## Son')
    const end = note.indexOf('\n## ', start + 3)
    const section = start === -1 ? '' : note.slice(start, end === -1 ? note.length : end)
    check(section.length > 0, 'critère 7 : section « Son » absente de la direction artistique')
    for (const name of EFFECT_NAMES) check(section.includes(`\`${name}\``), `critère 7 : effet « ${name} » absent de la section Son`)
    check(/40\s*%/.test(section), 'critère 7 : gain par défaut « 40 % » absent de la section Son')
    await shot(mobile, 'c7-note-son')
  })

  await context.close()
  if (failures.length) throw new Error(failures.join(' | '))
}
