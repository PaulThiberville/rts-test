// Playtest de l'Epic #48 — ambiance sonore : un bloc par critère, dans l'ordre de l'Epic.
// `state.audio` n'est qu'un snapshot : la sonde Web Audio (lib/audio-probe.mjs) est posée
// avant les chargements pour écouter la nappe et les enveloppes d'effets. Le Web Audio ne
// s'accélère pas : le bloc 2 dure 60 s réelles (~85 s au total).
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { analyseAmbience, installProbe, measureEffect } from './lib/audio-probe.mjs'
// Le runner tourne dans le worktree mais les captures vivent dans test-results/ du dépôt.
const RESULTS = fileURLToPath(new URL('../../../../test-results/', import.meta.url))
const AUDIO_DIR = new URL('../../../../public/audio/', import.meta.url)
const DA = new URL('../../../../vault/GDD/Direction-Artistique.md', import.meta.url)
const AUDIO_EXT = /\.(mp3|ogg|oga|wav|m4a|aac|flac|opus|webm)$/i
const shot = (page, label, options = {}) => page.screenshot({ path: `${RESULTS}epic-48-${label}.png`, ...options })
/** Attend le déverrouillage audio ; l'erreur porte l'état réel. */
async function waitUnlocked(page) {
  try {
    await page.waitForFunction(() => {
      const a = window.__game.state.audio
      return a.contextState === 'running' && a.ambienceRunning === true
    }, null, { timeout: 5000 })
  } catch {
    const a = await page.evaluate(() => JSON.parse(JSON.stringify(window.__game.state.audio)))
    throw new Error(`contexte non démarré (contextState=${a.contextState}, ambienceRunning=${a.ambienceRunning})`)
  }
}
/** Attend `ms` de temps mural (aucune pause arbitraire). */
function waitWallClock(page, ms) {
  return page.evaluate((duration) => new Promise((resolve) => {
    const start = performance.now()
    const id = setInterval(() => {
      if (performance.now() - start < duration) return
      clearInterval(id)
      resolve()
    }, 25)
  }), ms)
}
export default async function ({ page, load, state }) {
  await page.addInitScript(installProbe)
  const failures = []
  const check = (ok, message) => { if (!ok) failures.push(message) }
  const block = async (num, run) => { try { await run() } catch (error) { failures.push(`critère ${num} : ${error.message}`) } }
  // Critère 1 — aucun son avant interaction ; clic d'abord puis touche d'abord, sur deux chargements.
  await block(1, async () => {
    await load()
    const idle = (await state()).audio
    check(idle.contextState === 'suspended', `critère 1 : contextState ${idle.contextState} au chargement, attendu suspended`)
    check(idle.masterGain === 0, `critère 1 : masterGain ${idle.masterGain} au chargement, attendu 0`)
    check(idle.ambienceRunning === false, 'critère 1 : nappe déjà active sans geste')
    await shot(page, 'c1-avant-geste')
    await page.mouse.click(640, 360)
    await waitUnlocked(page)
    check((await state()).audio.masterGain > 0, 'critère 1 : masterGain nul après le clic')
    await shot(page, 'c1-apres-clic')
    // Une touche après le clic ne doit ni recréer ni couper la nappe.
    await page.keyboard.press('KeyA')
    await waitWallClock(page, 200)
    const afterKey = (await state()).audio
    check(afterKey.contextState === 'running' && afterKey.ambienceRunning === true, 'critère 1 : nappe interrompue par la première touche après le clic')
    await load()
    const fresh = (await state()).audio
    check(fresh.contextState === 'suspended' && fresh.masterGain === 0, 'critère 1 : contexte non suspendu au second chargement')
    await page.keyboard.press('Tab')
    await waitUnlocked(page)
    await shot(page, 'c1-apres-touche')
  })
  // Critère 2 — 60 s de jeu : nappe continue, variations ≤ 1 dB, aucune coupure > 200 ms.
  await block(2, async () => {
    await load(); await page.mouse.click(640, 360); await waitUnlocked(page)
    await waitWallClock(page, 1600) // fin du fondu d'entrée de 1,5 s (AMBIENCE_FADE_IN)
    await page.waitForFunction(() => window.__probe.db() > -50, null, { timeout: 5000 })
    // Exception assumée à « aucun réseau » : le serveur de prévisualisation est un enfant du
    // runner et meurt pendant 60 s sans requête. Une requête de maintien sur l'origine de la
    // page (port dérivé de l'URL du runner) le garde en vie, sans effet sur le jeu.
    const origin = new URL(page.url()).origin; const keepAlive = setInterval(() => { fetch(`${origin}/`).catch(() => {}) }, 2000)
    const samples = await page.evaluate(() => window.__probe.record(60000)).finally(() => clearInterval(keepAlive))
    check(samples.length >= 550, `critère 2 : ${samples.length} échantillons seulement`)
    const result = analyseAmbience(samples)
    check(result.ambienceGaps.length === 0, `critère 2 : nappe arrêtée à t=${result.ambienceGaps.slice(0, 3).join(', ')} ms`)
    check(result.longestSilence <= 200, `critère 2 : coupure de ${result.longestSilence} ms > 200 ms`)
    check(result.spread <= 1, `critère 2 : respiration de ${result.spread.toFixed(2)} dB > 1 dB (${result.low.toFixed(2)} → ${result.high.toFixed(2)} dBFS)`)
    check(result.residual <= 0.3, `critère 2 : écart non modélisé de ${result.residual.toFixed(2)} dB > 0,3 dB`)
    check(result.low > -50, `critère 2 : signal affaibli à ${result.low.toFixed(2)} dBFS`)
    check(result.gains.length === 1, `critère 2 : masterGain instable (${result.gains.join(' / ')})`)
    check(result.stable >= 100, `critère 2 : ${result.stable} fenêtres stables seulement`)
    console.log(JSON.stringify({ c2: { coupureMs: result.longestSilence, respirationDb: Number(result.spread.toFixed(3)), brutDb: Number(result.rawSpread.toFixed(3)), residuDb: Number(result.residual.toFixed(3)), gains: result.gains } }))
    await shot(page, 'c2-60s')
  })
  // Critère 3 — un effet distinct et feutré (≤ 1 s) par action, ≤ 3 déclenchements/s.
  await block(3, async () => {
    // L'effet `plant` passe par le système de tours (`measureEffect`) : le niveau doit être monté.
    await load('?niveau=1'); await page.mouse.click(640, 360); await waitUnlocked(page)
    await waitWallClock(page, 1600) // plancher de nappe mesuré après le fondu
    const effects = []
    // Le bus garde `shade-repelled` ; l'élimination joue la voix canonique `kill` (alias `repelled` abandonné).
    for (const [event, name] of [['plant', 'plant'], ['wave-start', 'wave'], ['shade-repelled', 'kill']]) {
      // La tour posée à `plant` tire en continu (`shoot`) : ses effets concurrents empêcheraient le
      // retour au plancher des deux mesures suivantes. On la retire, une fois `plant` mesuré.
      if (name === 'wave') await page.evaluate(() => window.__game.towers.reset())
      const measured = await measureEffect(page, event)
      // Le tir automatique des tours (`tower-shot` → `shoot`, plusieurs fois/s) peut écraser
      // `lastEffect` entre l'émission et la lecture : on interroge le cumul monotone `sound.played`.
      try {
        await page.waitForFunction((expected) => window.__game.state.sound.played.includes(expected), name, { timeout: 2000 })
      } catch {
        const played = await page.evaluate(() => JSON.parse(JSON.stringify(window.__game.state.sound.played)))
        throw new Error(`effet « ${name} » absent de sound.played après 2 s (played=${played.join(', ') || 'aucun'})`)
      }
      effects.push({ name, at: measured.firedAt, tail: measured.tail })
      check(measured.above >= 3, `critère 3 : ${name} inaudible (${measured.above.toFixed(1)} dB au-dessus de la nappe)`)
      check(measured.tail <= 1000, `critère 3 : ${name} dure ${Math.round(measured.tail)} ms > 1 s (enveloppe audible)`)
      await shot(page, `c3-${name}`)
    }
    check(new Set(effects.map((effect) => effect.name)).size === 3, `critère 3 : effets ${effects.map((effect) => effect.name).join(', ')} non distincts`)
    check(effects.every((effect, index) => index === 0 || effect.at > effects[index - 1].at), `critère 3 : horodatages non croissants (${effects.map((effect) => effect.at).join(' ≤ ')})`)
    console.log(JSON.stringify({ c3: effects.map((effect) => `${effect.name}:${Math.round(effect.tail)}ms`) }))
    // Fenêtre glissante de 1 s du limiteur : on attend qu'elle soit vide avant la rafale.
    await waitWallClock(page, 1100)
    const delta = await page.evaluate(() => new Promise((resolve) => {
      const audio = () => window.__game.state.audio
      const start = audio().effectCount
      let calls = 0
      const id = setInterval(() => {
        window.__game.emit('shade-repelled')
        if (++calls < 10) return
        clearInterval(id)
        resolve(audio().effectCount - start)
      }, 100)
    }))
    check(delta === 3, `critère 3 : ${delta} effets pour 10 appels en 1 s, attendu exactement 3 (3/s)`)
    await shot(page, 'c3-limite')
  })
  // Critère 4 — bouton muet au clavier (Entrée puis Espace) : silence, gain rétabli à l'identique.
  await block(4, async () => {
    await load()
    await page.keyboard.press('Tab')
    await waitUnlocked(page)
    const focused = await page.evaluate(() => ({ className: document.activeElement?.className ?? null, focusVisible: document.activeElement?.matches?.(':focus-visible') ?? false }))
    check(focused.className === 'audio-toggle', `critère 4 : premier arrêt de Tab sur « ${focused.className} »`)
    check(focused.focusVisible === true, 'critère 4 : anneau de focus absent (focus-visible)')
    const box = await page.locator('.audio-toggle').boundingBox()
    await shot(page, 'c4-focus', { clip: { x: Math.max(0, box.x - 10), y: Math.max(0, box.y - 10), width: box.width + 20, height: box.height + 20 } })
    const before = (await state()).audio
    check(before.muted === false && before.masterGain > 0, `critère 4 : état initial muted=${before.muted}, gain=${before.masterGain}`)
    for (const key of ['Enter', 'Space']) {
      await page.keyboard.press(key)
      const muted = (await state()).audio
      check(muted.muted === true, `critère 4 : ${key} n'a pas muet le son`)
      check(muted.masterGain === 0, `critère 4 : masterGain ${muted.masterGain} en muet (${key}), attendu 0`)
      const pressed = await page.evaluate(() => document.querySelector('.audio-toggle').getAttribute('aria-pressed'))
      check(pressed === 'true', `critère 4 : aria-pressed « ${pressed} » en muet (${key})`)
      if (key === 'Enter') await shot(page, 'c4-muet')
      await page.keyboard.press(key)
      const restored = (await state()).audio
      check(restored.muted === false, `critère 4 : second ${key} n'a pas rétabli le son`)
      check(restored.masterGain === before.masterGain, `critère 4 : gain restauré ${restored.masterGain} ≠ mesuré ${before.masterGain} (${key}, comparaison stricte)`)
    }
    await shot(page, 'c4-retabli')
  })
  // Critère 5 — 40 % par défaut à la première ouverture ; le volume vient du stockage.
  await block(5, async () => {
    await page.evaluate(() => localStorage.clear()) // pas d'init script qui effacerait à chaque navigation
    await load()
    const first = (await state()).audio
    check(first.volume === 0.4, `critère 5 : volume ${first.volume} à la première ouverture, attendu 0.4`)
    check(first.volume <= 0.5, `critère 5 : volume ${first.volume} > 50 %`)
    await shot(page, 'c5-premiere-ouverture')
    // Persistance réelle : la valeur écrite sous `volumeKey` est relue par engine.js au démarrage.
    await page.evaluate((key) => localStorage.setItem(key, '0.25'), first.volumeKey)
    await load()
    const stored = (await state()).audio; const raw = await page.evaluate((key) => localStorage.getItem(key), stored.volumeKey)
    check(stored.volume === 0.25, `critère 5 : volume stocké 0.25 relu ${stored.volume}`)
    check(raw === '0.25', `critère 5 : stockage « ${stored.volumeKey} » = ${raw}, attendu 0.25`)
    await page.evaluate(() => localStorage.clear())
  })
  // Critère 6 — zéro asset audio : tout est synthétisé.
  await block(6, async () => {
    let entries = []
    try {
      entries = await readdir(AUDIO_DIR, { withFileTypes: true })
    } catch (error) {
      check(error.code === 'ENOENT', `critère 6 : lecture de public/audio impossible (${error.code})`)
    }
    const files = entries.filter((entry) => entry.isFile() && entry.name !== '.gitkeep'); const audioFiles = files.filter((entry) => AUDIO_EXT.test(entry.name))
    check(audioFiles.length === 0, `critère 6 : ${audioFiles.length} fichier(s) audio (${audioFiles.map((entry) => entry.name).join(', ')})`)
    check(files.length === 0, `critère 6 : ${files.length} fichier(s) inattendu(s) dans public/audio (${files.map((entry) => entry.name).join(', ')})`)
    await load()
    await shot(page, 'c6-sans-asset')
  })
  // Critère 7 — la section Son de la direction artistique est à jour.
  await block(7, async () => {
    const note = await readFile(DA, 'utf8')
    check(note.includes('ombre repoussée'), 'critère 7 : « ombre repoussée » absente de la section Son')
    check(note.includes('40 %'), 'critère 7 : « 40 % » absent de la section Son')
    await shot(page, 'c7-note-son')
  })
  if (failures.length) throw new Error(failures.join(' | '))
}
