// Playtest de l'Epic #49 — les petites ombres : vagues, trajet, tir automatique, cœur
// et écran de fin. Un bloc par critère d'acceptation, dans l'ordre de l'Epic.
//
// La partie est simulée à pas fixe dans la page : `state.paused` coupe la boucle
// rAF puis les groupes de la scène (clairière + tours + vagues) reçoivent le même
// `update(dt)` que dans `src/core/game.js`, à 1/60 s. Aucune valeur de gameplay
// n'est écrite ici : tout est lu dans `src/data/level-1.js` et dans `state()`.
// Les captures sont nommées `test-results/epic-49-c<n>-*.png` (ticket #62).
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { LEVEL_1 } from '../../src/data/level-1.js'

const RESULTS = 'test-results'
const DESKTOP = { width: 1280, height: 720 } // viewport du runner
const MOBILE = { width: 390, height: 844 }
/** Pas de simulation : la boucle du jeu tourne à 60 images/s. */
const DT = 1 / 60
const FR_JSON = fileURLToPath(new URL('../../src/i18n/fr.json', import.meta.url))
const EN_JSON = fileURLToPath(new URL('../../src/i18n/en.json', import.meta.url))
const WAVES_JS = fileURLToPath(new URL('../../src/core/waves.js', import.meta.url))
const LEVEL_JS = fileURLToPath(new URL('../../src/data/level-1.js', import.meta.url))
const MECANIQUES = fileURLToPath(new URL('../../vault/GDD/Mecaniques.md', import.meta.url))

const escapeRegExp = (part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const NUMBER = '-?\\d+(?:[.,]\\d+)?'

/** Substitue les gabarits « {n} » d'une valeur i18n, comme `t()`. */
function fill(template, vars = {}) {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? `{${key}}`))
}

/** Gabarit i18n → RegExp de libellé rendu (« 40 sève », « Temps : 02:39 »). */
function labelPattern(template) {
  const parts = template.split(/(\{[^{}]*\})/)
  let pattern = '^'
  for (const part of parts) {
    const token = /^\{(\w+)\}$/.exec(part)
    if (token) pattern += token[1] === 'time' ? '\\d{2,}:\\d{2}' : NUMBER
    else pattern += escapeRegExp(part)
  }
  return new RegExp(`${pattern}$`)
}

/** Un texte affiché vient-il du dictionnaire de la langue (valeur ou gabarit) ? */
function textAllowed(text, dict) {
  const values = Object.values(dict)
  return values.includes(text) || values.some((value) => labelPattern(value).test(text))
}

/** Clé i18n brute restée à l'écran (« end.victory », « wave.label »). */
function looksLikeKey(text, dict) {
  return Object.hasOwn(dict, text) || /^[a-z][\w]*(\.[\w]+)+$/.test(text)
}

/** Même mise en forme que `wave-hud.js` : secondes entières, minutes non bornées. */
function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** Attend le nombre de frames de rendu demandé (aucune attente arbitraire). */
const nextFrames = (page, count = 2) => page.evaluate((n) => new Promise((resolve) => {
  let seen = 0
  const loop = () => (++seen >= n ? resolve() : requestAnimationFrame(loop))
  requestAnimationFrame(loop)
}), count)

async function setViewport(page, { width, height }) {
  await page.setViewportSize({ width, height })
  await nextFrames(page, 2)
}

/** Capture au chemin imposé par le ticket #62. */
const shot = (page, label) => page.screenshot({ path: `${RESULTS}/${label}.png` })

/**
 * Coupe la boucle rAF et installe `window.__sim.step(dt)` : chaque appel avance
 * tous les groupes de la scène, exactement comme une image de `game.js`, mais à
 * pas fixe — la partie simulée est ainsi déterministe et rapide.
 */
function installClock(page) {
  return page.evaluate(() => {
    const game = window.__game
    game.state.paused = true
    const entities = game.scene.children.filter((object) => typeof object.update === 'function')
    window.__sim = {
      step(dt = 1 / 60) {
        for (const entity of entities) entity.update?.(dt)
      },
    }
  })
}

/** Lecture groupée : état sérialisable + rects et textes du HUD et de l'écran de fin. */
function readGame(page) {
  return page.evaluate(() => {
    const rect = (node) => {
      if (!node) return null
      const box = node.getBoundingClientRect()
      return {
        x: box.x, y: box.y, width: box.width, height: box.height,
        right: box.right, bottom: box.bottom,
      }
    }
    const text = (selector) => document.querySelector(selector)?.textContent.trim() ?? null
    const end = document.querySelector('.end-screen')
    const windup = document.querySelector('.wave-hud__windup')
    return {
      lang: document.documentElement.lang,
      waveHidden: document.querySelector('.wave-hud')?.hidden ?? true,
      waveText: text('.wave-hud__wave'),
      windupHidden: windup?.hidden ?? true,
      windupText: text('.wave-hud__windup'),
      coreText: text('.wave-hud__core'),
      phase: document.querySelector('.wave-hud')?.dataset.phase ?? null,
      coreTone: document.querySelector('.wave-hud')?.dataset.core ?? null,
      endHidden: end?.hidden ?? true,
      endOutcome: end?.dataset.outcome ?? null,
      endTitle: text('.end-screen__title'),
      endWaveText: text('.end-screen__wave'),
      endTimeText: text('.end-screen__time'),
      replayText: text('.end-screen__replay'),
      rects: {
        level: rect(document.querySelector('.level-hud')),
        waveHud: rect(document.querySelector('.wave-hud')),
        wave: rect(document.querySelector('.wave-hud__wave')),
        windup: rect(document.querySelector('.wave-hud__windup')),
        core: rect(document.querySelector('.wave-hud__core')),
        meter: rect(document.querySelector('.wave-hud__meter')),
        bar: rect(document.querySelector('.tower-bar')),
        end: rect(end),
        card: rect(document.querySelector('.end-screen__card')),
        title: rect(document.querySelector('.end-screen__title')),
        endWave: rect(document.querySelector('.end-screen__wave')),
        endTime: rect(document.querySelector('.end-screen__time')),
        replay: rect(document.querySelector('.end-screen__replay')),
      },
      uiTexts: [...document.getElementById('ui').querySelectorAll('*')]
        .filter((element) => element.children.length === 0 && element.textContent.trim())
        .map((element) => element.textContent.trim()),
      viewport: { width: innerWidth, height: innerHeight },
      state: JSON.parse(JSON.stringify(window.__game.state)),
    }
  })
}

/** Empreinte du décor 3D : enfants, maillages, triangles, somme des positions. */
function decorSignature(page) {
  return page.evaluate(() => {
    const clairiere = window.__game.scene.getObjectByName('clairiere')
    const decor = clairiere?.getObjectByName('decor')
    if (!decor) return null
    let triangles = 0
    let meshes = 0
    let sumX = 0
    let sumZ = 0
    decor.traverse((object) => {
      if (!object.isMesh) return
      meshes++
      const geometry = object.geometry
      triangles += geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3
      if (object.parent === decor) {
        sumX += object.position.x
        sumZ += object.position.z
      }
    })
    return {
      children: decor.children.length,
      meshes,
      triangles: Math.round(triangles),
      sumX: Number(sumX.toFixed(3)),
      sumZ: Number(sumZ.toFixed(3)),
    }
  })
}

/** Emplacements du niveau projetés à l'écran, avec l'élément réellement pointé. */
function slotPoints(page) {
  return page.evaluate(() => {
    const { camera, state } = window.__game
    const projected = camera.position.clone()
    return state.slots.map((slot) => {
      projected.set(slot.x, 0, slot.z).project(camera)
      const x = (projected.x * 0.5 + 0.5) * innerWidth
      const y = (-projected.y * 0.5 + 0.5) * innerHeight
      const element = document.elementFromPoint(x, y)
      return {
        id: slot.id,
        worldX: slot.x,
        worldZ: slot.z,
        x,
        y,
        inFront: projected.z < 1,
        inside: x >= 0 && y >= 0 && x < innerWidth && y < innerHeight,
        canvas: element?.tagName === 'CANVAS',
      }
    })
  })
}

/** Clic de pose : appui et relâchement au même pixel (jamais un glissement). */
async function clickCanvas(page, point) {
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.up()
}

/**
 * Attend la barre des tours, permanente depuis #148 : visible dès le montage
 * (data-open="true", panneau opaque non vide) et sans poignée de repli.
 * Aucun clic : l'ouverture ne dépend plus d'une interaction.
 */
async function openBar(page) {
  await page.waitForFunction(() => {
    const bar = document.querySelector('.tower-bar')
    const panel = bar?.querySelector('.tower-bar__panel')
    if (!bar || !panel) return false
    const rect = panel.getBoundingClientRect()
    const style = getComputedStyle(panel)
    return bar.dataset.open === 'true'
      && style.visibility !== 'hidden'
      && style.opacity === '1'
      && rect.width > 0 && rect.height > 0
  })
  await page.waitForFunction(() =>
    document.querySelector('.tower-bar__handle') === null
    && document.querySelector('button[data-action="toggle-towers"]') === null)
}

/** L'écran de fin a fini son animation d'entrée : capture non translucide. */
async function waitEndScreen(page) {
  await page.waitForFunction(() => {
    const end = document.querySelector('.end-screen')
    return end !== null && !end.hidden && getComputedStyle(end).opacity === '1'
  })
}

/** Laisse les fondus de mort se terminer après la fin (updateDying continue). */
function finishFades(page, frames = 40) {
  return page.evaluate((count) => {
    for (let i = 0; i < count; i++) window.__sim.step(1 / 60)
  }, frames)
}

async function selectSeed(page, type) {
  await page.click(`.tower-bar__entry[data-tower="${type}"]`)
  await page.waitForFunction((id) => window.__game.state.towerBar.selectedType === id, type)
}

/** Deux rectangles se chevauchent-ils (tolérance 0,5 px) ? */
function overlaps(a, b) {
  if (!a || !b) return false
  return Math.min(a.right, b.right) - Math.max(a.x, b.x) > 0.5
    && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 0.5
}

function insideViewport(rect, viewport, margin = 0) {
  return Boolean(rect)
    && rect.x >= margin - 0.5
    && rect.y >= margin - 0.5
    && rect.right <= viewport.width - margin + 0.5
    && rect.bottom <= viewport.height - margin + 0.5
}

export default async function ({ page, load, state }) {
  page.setDefaultTimeout(10_000)

  const failures = []
  const check = (condition, message) => {
    if (!condition) failures.push(message)
  }
  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))

  const [fr, en] = await Promise.all([
    readFile(FR_JSON, 'utf8').then(JSON.parse),
    readFile(EN_JSON, 'utf8').then(JSON.parse),
  ])

  const expectedEnd = (snap, dict, outcome, label) => {
    const title = outcome === 'victory' ? dict['end.victory'] : dict['end.defeat']
    check(snap.endHidden === false, `${label} : l'écran de fin est masqué`)
    check(snap.endOutcome === outcome,
      `${label} : data-outcome « ${snap.endOutcome} » au lieu de ${outcome}`)
    check(snap.endTitle === title,
      `${label} : titre « ${snap.endTitle} » au lieu de « ${title} »`)
    check(snap.endWaveText === fill(dict['end.wave'], {
      n: snap.state.wave.index, total: snap.state.wave.total,
    }), `${label} : vague affichée « ${snap.endWaveText} » au lieu de « ${fill(dict['end.wave'], {
      n: snap.state.wave.index, total: snap.state.wave.total,
    })} »`)
    const duration = formatDuration(snap.state.run.elapsed)
    check(/^\d{2,}:\d{2}$/.test(duration), `${label} : durée d'état invalide « ${duration} »`)
    check(snap.endTimeText === fill(dict['end.time'], { time: duration }),
      `${label} : durée affichée « ${snap.endTimeText} » au lieu de « ${fill(dict['end.time'], { time: duration })} »`)
    check(snap.replayText === dict['end.replay'],
      `${label} : bouton « ${snap.replayText} » au lieu de « ${dict['end.replay']} »`)
    const rawKeys = snap.uiTexts.filter((text) => looksLikeKey(text, dict))
    check(rawKeys.length === 0, `${label} : clé i18n brute à l'écran : ${rawKeys.join(' / ')}`)
    const hardcoded = snap.uiTexts.filter((text) => !textAllowed(text, dict))
    check(hardcoded.length === 0, `${label} : texte en dur à l'écran : ${hardcoded.join(' / ')}`)
  }

  // -------------------------------------------------------------------------
  // Critère 1 — au lancement : « Vague 1/6 » + compte à rebours de 8 s ; à 0,
  // les ombres apparaissent une à une depuis l'arrivée (`state.level.arrival`).
  // -------------------------------------------------------------------------
  let launchDecor = null
  try {
    await load('?lang=fr&niveau=1')
    await setViewport(page, DESKTOP)
    await installClock(page)

    const snap = await readGame(page)
    const s = snap.state
    const label = 'critère 1'
    check(snap.lang === 'fr', `${label} : documentElement.lang « ${snap.lang} » au lieu de fr`)
    check(snap.waveHidden === false, `${label} : le HUD de vague est masqué au lancement`)
    check(snap.waveText === fill(fr['wave.label'], { n: 1, total: LEVEL_1.waves.length }),
      `${label} : « ${snap.waveText} » au lieu de « ${fill(fr['wave.label'], { n: 1, total: LEVEL_1.waves.length })} »`)
    check(s.wave.index === 1 && s.wave.total === LEVEL_1.waves.length,
      `${label} : state.wave ${s.wave.index}/${s.wave.total} au lieu de 1/${LEVEL_1.waves.length}`)
    check(s.wave.phase === 'countdown', `${label} : phase « ${s.wave.phase} » au lancement`)
    // Le décompte affiché est arrondi au supérieur (waves.js) : entre `load()` et la
    // pause, la boucle a déjà consommé quelques dixièmes de seconde. On compare donc
    // au compte attendu pour le temps réellement écoulé, pas à la valeur brute.
    const expectedCountdown = Math.max(0, Math.ceil(LEVEL_1.windup - s.run.elapsed))
    check(s.wave.countdown === expectedCountdown,
      `${label} : compte à rebours ${s.wave.countdown} s au lancement au lieu de ${expectedCountdown} s (${s.run.elapsed.toFixed(2)} s écoulées)`)
    check(snap.windupHidden === false, `${label} : compte à rebours masqué dans le HUD`)
    check(snap.windupText === fill(fr['wave.windup'], { n: 1, s: s.wave.countdown }),
      `${label} : « ${snap.windupText} » au lieu de « ${fill(fr['wave.windup'], { n: 1, s: s.wave.countdown })} »`)
    // L'arrivée lue dans `state.level` doit refléter la donnée du niveau.
    const arrival = s.level?.arrival
    check(arrival?.x === LEVEL_1.arrival.x && arrival?.z === LEVEL_1.arrival.z,
      `${label} : state.level.arrival ${JSON.stringify(arrival)} ≠ level-1.js ${JSON.stringify(LEVEL_1.arrival)}`)
    check(snap.coreText === fill(fr['core.hp'], { hp: LEVEL_1.heart.hp, max: LEVEL_1.heart.hp }),
      `${label} : vie affichée « ${snap.coreText} »`)
    check(s.creatures.length === 0, `${label} : ${s.creatures.length} ombre(s) avant la fin du répit`)
    await shot(page, 'epic-49-c1-desktop-compte-a-rebours')

    // Départ du répit : à 0, les ombres apparaissent une à une, sur l'arrivée.
    const spawn = await page.evaluate(({ maxSteps }) => {
      const waveState = window.__game.state
      const sim = window.__sim
      const spawns = []
      let steps = 0
      while (spawns.length < 2 && steps < maxSteps) {
        const before = waveState.creatures.length
        sim.step(1 / 60)
        steps++
        if (waveState.creatures.length > before) {
          const record = waveState.creatures[waveState.creatures.length - 1]
          spawns.push({
            delta: waveState.creatures.length - before,
            elapsed: waveState.run.elapsed,
            countdown: waveState.wave.countdown,
            phase: waveState.wave.phase,
            id: record.id,
            x: record.x,
            z: record.z,
            hp: record.hp,
          })
        }
      }
      return {
        spawns,
        phase: waveState.wave.phase,
        countdown: waveState.wave.countdown,
        creatures: waveState.creatures.length,
        wave: waveState.wave.index,
        elapsed: waveState.run.elapsed,
      }
    }, { maxSteps: Math.ceil(30 / DT) })

    check(spawn.spawns.length === 2,
      `${label} : ${spawn.spawns.length} apparition(s) détectée(s) au lieu de 2`)
    check(spawn.wave === 1, `${label} : apparitions en vague ${spawn.wave} au lieu de 1`)
    check(spawn.creatures === 2, `${label} : ${spawn.creatures} ombre(s) après 2 apparitions`)
    for (const [index, item] of spawn.spawns.entries()) {
      check(item.delta === 1,
        `${label} : ${item.delta} ombres apparaissent d'un coup (apparition ${index + 1})`)
      check(item.phase === 'spawning' && item.countdown === 0,
        `${label} : apparition ${index + 1} à la phase ${item.phase} / compte ${item.countdown}`)
      const start = Math.hypot(item.x - arrival.x, item.z - arrival.z)
      check(start <= 0.05,
        `${label} : apparition ${index + 1} à ${start.toFixed(3)} m de l'arrivée (${item.x}, ${item.z})`)
      check(item.hp === LEVEL_1.waves[0].hp,
        `${label} : apparition ${index + 1} à ${item.hp} PV au lieu de ${LEVEL_1.waves[0].hp}`)
    }
    if (spawn.spawns.length === 2) {
      const gap = spawn.spawns[1].elapsed - spawn.spawns[0].elapsed
      check(gap >= LEVEL_1.waves[0].gap - 0.02 && gap <= LEVEL_1.waves[0].gap + 0.1,
        `${label} : ${gap.toFixed(2)} s entre deux apparitions au lieu de ${LEVEL_1.waves[0].gap} s`)
    }
    // Les ombres quittent le bord sud hors champ : on avance jusqu'à ce que la
    // première entre dans le cadre pour la capture, sans changer l'état du jeu.
    await page.evaluate(({ maxSteps }) => {
      const waveState = window.__game.state
      const sim = window.__sim
      let steps = 0
      while (steps < maxSteps) {
        const head = waveState.creatures.reduce((best, c) => Math.max(best, c.progress), 0)
        if (head >= 0.48) break
        sim.step(1 / 60)
        steps++
      }
    }, { maxSteps: Math.ceil(60 / DT) })
    await nextFrames(page, 2)
    await shot(page, 'epic-49-c1-desktop-apparition')

    launchDecor = await decorSignature(page)
    check(launchDecor !== null, `${label} : groupe « decor » introuvable dans la scène`)
  } catch (error) {
    failures.push(`critère 1 : ${error.message}`)
  }

  // -------------------------------------------------------------------------
  // Critère 2 — chaque ombre reste à ≤ path.width / 2 de la polyligne pendant
  // toute sa traversée, échantillonnée toutes les 100 ms jusqu'à l'atteinte du
  // cœur (aucune tour posée : toutes les ombres vont au bout du chemin).
  // -------------------------------------------------------------------------
  try {
    await load('?lang=fr&niveau=1')
    await setViewport(page, DESKTOP)
    await installClock(page)

    // Le trajet et sa largeur sont lus dans l'état exposé, puis confrontés à la
    // donnée : une divergence entre level-1.js et state.level doit faire échouer.
    const level = (await state()).level
    check(level?.path?.width === LEVEL_1.path.width,
      `critère 2 : state.level.path.width ${level?.path?.width} ≠ level-1.js ${LEVEL_1.path.width}`)
    check(JSON.stringify(level?.path?.points) === JSON.stringify(LEVEL_1.path.points),
      'critère 2 : state.level.path.points diffère de level-1.js')
    const halfWidth = level.path.width / 2

    // Première moitié de la traversée : la capture montre les ombres sur le chemin.
    const mid = await page.evaluate(({ points, maxSteps }) => {
      const distance = (x, z) => {
        let best = Infinity
        for (let i = 1; i < points.length; i++) {
          const [ax, az] = points[i - 1]
          const [bx, bz] = points[i]
          const dx = bx - ax
          const dz = bz - az
          const length = dx * dx + dz * dz
          let t = length > 0 ? ((x - ax) * dx + (z - az) * dz) / length : 0
          t = Math.max(0, Math.min(1, t))
          const px = ax + dx * t
          const pz = az + dz * t
          const d = Math.hypot(x - px, z - pz)
          if (d < best) best = d
        }
        return best
      }
      const stats = { samples: 0, maxDistance: 0, worst: null, maxProgress: {} }
      window.__pathStats = stats
      const sample = () => {
        stats.samples++
        for (const creature of window.__game.state.creatures) {
          const d = distance(creature.x, creature.z)
          if (d > stats.maxDistance) {
            stats.maxDistance = d
            stats.worst = { id: creature.id, x: creature.x, z: creature.z, progress: creature.progress }
          }
          const previous = stats.maxProgress[creature.id] ?? 0
          if (creature.progress > previous) stats.maxProgress[creature.id] = creature.progress
        }
      }
      const waveState = window.__game.state
      const sim = window.__sim
      let steps = 0
      while (steps < maxSteps) {
        sim.step(1 / 60)
        steps++
        if (steps % 6 === 0) sample()
        const head = waveState.creatures.reduce((best, c) => Math.max(best, c.progress), 0)
        if (head >= 0.5) break
      }
      return { ...stats, creatures: waveState.creatures.length }
    }, { points: level.path.points, maxSteps: Math.ceil(120 / DT) })
    check(mid.samples > 100, `critère 2 : ${mid.samples} échantillon(s) sur la première moitié, trop peu`)
    await nextFrames(page, 2)
    await shot(page, 'epic-49-c2-desktop-traversee')

    // Seconde moitié : jusqu'à la première ombre qui atteint le cœur.
    const end = await page.evaluate(({ points, maxSteps }) => {
      const distance = (x, z) => {
        let best = Infinity
        for (let i = 1; i < points.length; i++) {
          const [ax, az] = points[i - 1]
          const [bx, bz] = points[i]
          const dx = bx - ax
          const dz = bz - az
          const length = dx * dx + dz * dz
          let t = length > 0 ? ((x - ax) * dx + (z - az) * dz) / length : 0
          t = Math.max(0, Math.min(1, t))
          const px = ax + dx * t
          const pz = az + dz * t
          const d = Math.hypot(x - px, z - pz)
          if (d < best) best = d
        }
        return best
      }
      const stats = window.__pathStats
      const sample = () => {
        stats.samples++
        for (const creature of window.__game.state.creatures) {
          const d = distance(creature.x, creature.z)
          if (d > stats.maxDistance) {
            stats.maxDistance = d
            stats.worst = { id: creature.id, x: creature.x, z: creature.z, progress: creature.progress }
          }
          const previous = stats.maxProgress[creature.id] ?? 0
          if (creature.progress > previous) stats.maxProgress[creature.id] = creature.progress
        }
      }
      const waveState = window.__game.state
      const sim = window.__sim
      let steps = 0
      let breach = null
      // Toute la vague 1 : chaque ombre va au bout du chemin, jusqu'à l'ouverture
      // de la vague 2 (wave.index passe à 2 quand la dernière est retirée).
      while (steps < maxSteps && waveState.wave.index === 1) {
        const ids = new Map(waveState.creatures.map((c) => [c.id, c.progress]))
        const hp = waveState.core.hp
        sim.step(1 / 60)
        steps++
        if (steps % 6 === 0) sample()
        if (waveState.core.hp !== hp) {
          const alive = new Set(waveState.creatures.map((c) => c.id))
          const gone = [...ids.keys()].filter((id) => !alive.has(id))
          const snapshot = {
            from: hp,
            to: waveState.core.hp,
            gone,
            progress: gone.map((id) => ids.get(id)),
            event: waveState.lastEvent,
          }
          if (!breach) breach = snapshot
        }
      }
      return {
        ...stats,
        breach,
        steps,
        core: waveState.core.hp,
        wave: waveState.wave.index,
        elapsed: waveState.run.elapsed,
      }
    }, { points: level.path.points, maxSteps: Math.ceil(180 / DT) })

    check(end.breach !== null, 'critère 2 : aucune ombre n\'a atteint le cœur, traversée non conclue')
    check(end.wave === 2,
      `critère 2 : la vague 1 n'est pas allée au bout (vague ${end.wave} après 3 min simulées)`)
    check(end.samples > 500,
      `critère 2 : ${end.samples} échantillons à 100 ms (< 500), traversée trop peu échantillonnée`)
    check(end.maxDistance <= halfWidth,
      `critère 2 : écart maximal du chemin ${end.maxDistance.toFixed(3)} m > ${halfWidth} m (${JSON.stringify(end.worst)})`)
    const completed = Object.values(end.maxProgress).filter((progress) => progress >= 0.9)
    check(completed.length === LEVEL_1.waves[0].count,
      `critère 2 : ${completed.length}/${LEVEL_1.waves[0].count} ombre(s) de la vague 1 ont traversé le chemin jusqu'au bout`)
    const expectedLoss = LEVEL_1.waves[0].count * LEVEL_1.heart.damage
    check(end.core === LEVEL_1.heart.hp - expectedLoss,
      `critère 2 : cœur à ${end.core} PV après la vague 1 au lieu de ${LEVEL_1.heart.hp - expectedLoss}`)
    check(end.breach.gone.length === 1,
      `critère 2 : ${end.breach.gone.length} ombre(s) retirée(s) à la première atteinte`)
    check(end.breach.progress.every((progress) => progress >= 0.99),
      `critère 2 : ombre retirée à ${end.breach.progress.map((p) => (p * 100).toFixed(1)).join(', ')} % du chemin`)
    check(end.breach.to === end.breach.from - LEVEL_1.heart.damage,
      `critère 2 : cœur ${end.breach.from} → ${end.breach.to} au lieu de −${LEVEL_1.heart.damage}`)
    check(end.breach.event === 'breach',
      `critère 2 : lastEvent « ${end.breach.event} » à l'atteinte du cœur`)
    console.log(`[ombres] critère 2 — ${end.samples} échantillons, écart max ${end.maxDistance.toFixed(3)} m (limite ${halfWidth} m), ${completed.length} ombres au bout du chemin`)
  } catch (error) {
    failures.push(`critère 2 : ${error.message}`)
  }

  // -------------------------------------------------------------------------
  // Critère 3 — sans aucun clic après la pose, la tour tire : `shots` croît,
  // l'ombre de tête perd exactement `combat.damage[type]` PV (lastEvent 'hit'),
  // et à 0 PV l'ombre quitte `state.creatures`.
  // -------------------------------------------------------------------------
  try {
    await load('?lang=fr&niveau=1')
    await setViewport(page, DESKTOP)
    await installClock(page)

    // Pose réelle d'une Pousse par un clic du joueur (aucun réglage du tir).
    // L'emplacement le plus proche du cœur est choisi : les ombres y sont encore
    // dans le champ au premier tir, ce qui rend le combat visible sur la capture.
    await openBar(page)
    await selectSeed(page, 'sprout')
    const slots = await slotPoints(page)
    const usable = slots
      .filter((slot) => slot.inFront && slot.inside && slot.canvas)
      .sort((a, b) => (a.worldZ - b.worldZ) || (Math.abs(a.worldX) - Math.abs(b.worldX)))
    const target = usable[0]
    check(Boolean(target), 'critère 3 : aucun emplacement libre cliquable')
    if (target) {
      await clickCanvas(page, target)
      await page.waitForFunction(() => window.__game.state.towers.length === 1)
    }
    // La barre est permanente : aucune poignée ne la replie après la pose.
    await openBar(page)

    const placed = (await state()).towers[0]
    const type = placed?.type ?? 'sprout'
    const damage = LEVEL_1.combat.damage[type]
    check(placed?.type === 'sprout', `critère 3 : tour posée ${placed?.type} au lieu de sprout`)
    check(Number.isFinite(damage), `critère 3 : combat.damage.${type} absent de level-1.js`)

    const combat = await page.evaluate(({ damage, maxSteps }) => {
      const waveState = window.__game.state
      const sim = window.__sim
      const tower = waveState.towers[0]
      const headId = () => {
        let best = null
        let progress = -1
        for (const creature of waveState.creatures) {
          if (creature.progress > progress) {
            progress = creature.progress
            best = creature.id
          }
        }
        return best
      }
      let steps = 0
      let firstHit = null
      while (steps < maxSteps && firstHit === null) {
        const shotsBefore = tower.shots
        const coreBefore = waveState.core.hp
        const hpBefore = new Map(waveState.creatures.map((c) => [c.id, c.hp]))
        sim.step(1 / 60)
        steps++
        if (tower.shots > shotsBefore) {
          const changes = []
          let killed = null
          for (const creature of waveState.creatures) {
            const previous = hpBefore.get(creature.id)
            if (previous !== undefined && creature.hp !== previous) {
              changes.push({ id: creature.id, from: previous, to: creature.hp })
            }
          }
          for (const [id, hp] of hpBefore) {
            if (!waveState.creatures.some((c) => c.id === id)) {
              killed = { id, from: hp, to: hp - damage }
            }
          }
          let headScreen = null
          let headRecord = null
          for (const creature of waveState.creatures) {
            if (headRecord === null || creature.progress > headRecord.progress) headRecord = creature
          }
          if (headRecord) {
            const { camera } = window.__game
            const projected = camera.position.clone().set(headRecord.x, 0.2, headRecord.z).project(camera)
            headScreen = {
              x: (projected.x * 0.5 + 0.5) * innerWidth,
              y: (-projected.y * 0.5 + 0.5) * innerHeight,
              visible: projected.z < 1
                && projected.x >= -1 && projected.x <= 1
                && projected.y >= -1 && projected.y <= 1,
            }
          }
          firstHit = {
            shots: tower.shots - shotsBefore,
            elapsed: waveState.run.elapsed,
            event: waveState.lastEvent,
            changes,
            killed,
            head: headId(),
            headScreen,
            coreUnchanged: waveState.core.hp === coreBefore,
          }
        }
      }
      return { firstHit, steps, shots: tower.shots, creatures: waveState.creatures.length }
    }, { damage, maxSteps: Math.ceil(120 / DT) })

    check(combat.firstHit !== null, 'critère 3 : aucune ombre touchée en 2 min simulées')
    if (combat.firstHit) {
      const hit = combat.firstHit
      console.log(`[ombres] critère 3 — premier tir à ${hit.elapsed.toFixed(1)} s, ombre de tête à l'écran ${JSON.stringify(hit.headScreen)}`)
      check(hit.shots === 1, `critère 3 : ${hit.shots} tirs sur la même image`)
      check(hit.event === 'hit', `critère 3 : lastEvent « ${hit.event} » au lieu de hit`)
      check(hit.coreUnchanged, 'critère 3 : l\'atteinte du cœur a bougé pendant le tir')
      check(hit.changes.length === 1,
        `critère 3 : ${hit.changes.length} ombre(s) touchée(s) par un tir au lieu d'1`)
      if (hit.changes.length === 1) {
        const change = hit.changes[0]
        check(change.id === hit.head,
          `critère 3 : ombre touchée ${change.id} au lieu de la tête ${hit.head}`)
        check(change.from - change.to === damage,
          `critère 3 : ${change.from} → ${change.to} PV au lieu de −${damage}`)
      }
      check(hit.headScreen?.visible === true,
        `critère 3 : au premier tir, l'ombre de tête est hors champ (${JSON.stringify(hit.headScreen)}) : combat invisible à 1280×720`)
    }

    // Rebond d'impact : l'image suivante applique l'écrasement et le flash émissif
    // posés par `playHit()` sur le modèle de l'ombre touchée.
    const rebound = await page.evaluate(() => {
      window.__sim.step(1 / 60)
      const wavesGroup = window.__game.scene.getObjectByName('waves')
      let squash = null
      let glow = 0
      for (const child of wavesGroup?.children ?? []) {
        if (child.name !== 'shadow' || !child.visible) continue
        if (child.scale.x > 1.001 || child.scale.y < 0.999) {
          squash = { x: child.scale.x, y: child.scale.y, z: child.scale.z }
        }
        const body = child.getObjectByName('shadow-body')
        if ((body?.material?.emissiveIntensity ?? 0) > 0) {
          glow = body.material.emissiveIntensity
        }
      }
      return { squash, glow }
    })
    check(rebound.squash !== null,
      'critère 3 : aucun rebond d\'impact (échelle intacte) après un tir')
    check(rebound.glow > 0,
      `critère 3 : aucun flash d'impact (emissiveIntensity ${rebound.glow}) après un tir`)
    await nextFrames(page, 2)
    await shot(page, 'epic-49-c3-desktop-combat')

    const death = await page.evaluate(({ damage, maxSteps }) => {
      const waveState = window.__game.state
      const sim = window.__sim
      const tower = waveState.towers[0]
      let steps = 0
      let killed = null
      while (steps < maxSteps && killed === null) {
        const shotsBefore = tower.shots
        const coreBefore = waveState.core.hp
        const hpBefore = new Map(waveState.creatures.map((c) => [c.id, c.hp]))
        sim.step(1 / 60)
        steps++
        if (tower.shots > shotsBefore && waveState.core.hp === coreBefore) {
          for (const [id, hp] of hpBefore) {
            if (waveState.creatures.some((c) => c.id === id)) continue
            if (hp - damage === 0) killed = { id, from: hp, to: 0 }
          }
        }
      }
      return {
        killed,
        steps,
        elapsed: waveState.run.elapsed,
        shots: tower.shots,
        creatures: waveState.creatures.length,
        ids: waveState.creatures.map((c) => c.id),
      }
    }, { damage, maxSteps: Math.ceil(180 / DT) })

    check(death.killed !== null, 'critère 3 : aucune ombre retirée à 0 PV en 3 min simulées')
    if (death.killed) {
      check(death.killed.from - death.killed.to === damage,
        `critère 3 : ${death.killed.from} → ${death.killed.to} PV avant retrait au lieu de −${damage}`)
      check(!death.ids.includes(death.killed.id),
        `critère 3 : l'ombre ${death.killed.id} reste dans state.creatures à 0 PV`)
    }
    check(death.shots > (combat.firstHit?.shots ?? 0),
      `critère 3 : shots reste à ${death.shots} après la première ombre`)
  } catch (error) {
    failures.push(`critère 3 : ${error.message}`)
  }

  // -------------------------------------------------------------------------
  // Critère 4 — une ombre qui atteint le cœur retire exactement `core.damage`
  // à `core.hp` et quitte `state.creatures` ; hp 0 → `run.outcome === 'defeat'`
  // et écran de défaite. Captures desktop (FR) et EN.
  // -------------------------------------------------------------------------
  try {
    const runDefeat = async (lang, dict, label) => {
      await load(`?lang=${lang}&niveau=1`)
      await setViewport(page, DESKTOP)
      await installClock(page)
      const result = await page.evaluate(({ maxSteps }) => {
        const waveState = window.__game.state
        const sim = window.__sim
        let steps = 0
        let firstBreach = null
        let previousHp = waveState.core.hp
        while (steps < maxSteps && waveState.run.outcome === null) {
          const ids = new Map(waveState.creatures.map((c) => [c.id, c.progress]))
          sim.step(1 / 60)
          steps++
          if (waveState.core.hp !== previousHp) {
            const alive = new Set(waveState.creatures.map((c) => c.id))
            const gone = [...ids.keys()].filter((id) => !alive.has(id))
            const snapshot = {
              from: previousHp,
              to: waveState.core.hp,
              gone,
              progress: gone.map((id) => ids.get(id)),
              event: waveState.lastEvent,
              wave: waveState.wave.index,
              elapsed: waveState.run.elapsed,
            }
            if (!firstBreach) firstBreach = snapshot
            previousHp = waveState.core.hp
          }
        }
        return {
          firstBreach,
          outcome: waveState.run.outcome,
          hp: waveState.core.hp,
          max: waveState.core.max,
          damage: waveState.core.damage,
          wave: waveState.wave.index,
          total: waveState.wave.total,
          elapsed: waveState.run.elapsed,
          creatures: waveState.creatures.length,
          steps,
        }
      }, { maxSteps: Math.ceil(420 / DT) })

      check(result.firstBreach !== null, `${label} : aucune ombre n'a atteint le cœur`)
      if (result.firstBreach) {
        const breach = result.firstBreach
        check(breach.from - breach.to === result.damage,
          `${label} : cœur ${breach.from} → ${breach.to} au lieu de −${result.damage}`)
        check(breach.gone.length === 1,
          `${label} : ${breach.gone.length} ombre(s) retirée(s) à l'atteinte du cœur`)
        check(breach.progress.every((progress) => progress >= 0.99),
          `${label} : ombre retirée à ${breach.progress.map((p) => (p * 100).toFixed(1)).join(', ')} % du chemin`)
        check(breach.event === 'breach',
          `${label} : lastEvent « ${breach.event} » à l'atteinte du cœur`)
      }
      check(result.outcome === 'defeat',
        `${label} : issue « ${result.outcome} » (vague ${result.wave}, cœur ${result.hp}/${result.max}) au lieu de defeat`)
      check(result.hp === 0, `${label} : cœur à ${result.hp} PV au lieu de 0`)
      check(result.elapsed <= 180,
        `${label} : partie simulée de ${formatDuration(result.elapsed)} (> 3 min)`)

      await finishFades(page)
      await waitEndScreen(page)
      const snap = await readGame(page)
      expectedEnd(snap, dict, 'defeat', label)
      await shot(page, `epic-49-c4-${lang}-defaite`)
      return snap
    }

    await runDefeat('fr', fr, 'critère 4 [fr]')
    await runDefeat('en', en, 'critère 4 [en]')
  } catch (error) {
    failures.push(`critère 4 : ${error.message}`)
  }

  // -------------------------------------------------------------------------
  // Critère 5 — après la dernière ombre de la vague 6 abattue, victoire :
  // `run.outcome === 'victory'`, écran de fin avec vague atteinte et durée,
  // en FR puis en EN, sans clé i18n brute ni texte en dur.
  // -------------------------------------------------------------------------
  let victoryFr = null
  let victoryDecor = null
  try {
    const runVictory = async (lang, dict, label) => {
      await load(`?lang=${lang}&niveau=1`)
      await setViewport(page, DESKTOP)
      // Trois Pousses (120 sève) par l'API du jeu : même code de pose que le clic.
      const poses = await page.evaluate(() => {
        const game = window.__game
        game.state.paused = true
        game.towers.selectType('sprout')
        const placed = ['slot-1', 'slot-2', 'slot-3'].map((id) => game.towers.place(id))
        return {
          placed,
          towers: game.state.towers.length,
          resources: game.state.resources,
        }
      })
      check(poses.placed.every(Boolean) && poses.towers === 3,
        `${label} : ${poses.towers} tour(s) posée(s) au lieu de 3`)
      await installClock(page)

      const decorBefore = await decorSignature(page)
      const result = await page.evaluate(({ maxSteps }) => {
        const waveState = window.__game.state
        const sim = window.__sim
        let steps = 0
        while (steps < maxSteps && waveState.run.outcome === null) {
          sim.step(1 / 60)
          steps++
        }
        return {
          outcome: waveState.run.outcome,
          wave: waveState.wave.index,
          total: waveState.wave.total,
          elapsed: waveState.run.elapsed,
          hp: waveState.core.hp,
          creatures: waveState.creatures.length,
          steps,
          shots: waveState.towers.reduce((sum, tower) => sum + tower.shots, 0),
        }
      }, { maxSteps: Math.ceil(900 / DT) })

      check(result.outcome === 'victory',
        `${label} : issue « ${result.outcome} » (vague ${result.wave}/${result.total}, cœur ${result.hp}, ${result.creatures} ombres) au lieu de victory`)
      check(result.wave === LEVEL_1.waves.length,
        `${label} : victoire déclarée en vague ${result.wave} au lieu de ${LEVEL_1.waves.length}`)
      check(result.creatures === 0, `${label} : ${result.creatures} ombre(s) encore présentes à la victoire`)
      check(result.shots > 0, `${label} : aucune tour n'a tiré (${result.shots} tirs)`)
      check(result.elapsed <= 180,
        `${label} : partie simulée de ${formatDuration(result.elapsed)} (> 3 min)`)
      console.log(`[ombres] ${label} — victoire en ${formatDuration(result.elapsed)} (${result.shots} tirs, ${result.steps} pas)`)

      await finishFades(page)
      await waitEndScreen(page)
      const snap = await readGame(page)
      expectedEnd(snap, dict, 'victory', label)
      await shot(page, `epic-49-c5-${lang}-victoire`)
      return { snap, decorBefore, result }
    }

    await runVictory('en', en, 'critère 5 [en]')
    victoryFr = await runVictory('fr', fr, 'critère 5 [fr]')
    victoryDecor = victoryFr.decorBefore
  } catch (error) {
    failures.push(`critère 5 : ${error.message}`)
  }

  // -------------------------------------------------------------------------
  // Critère 6 — « Rejouer » : sève 120, emplacements libres, aucune tour, cœur
  // plein, vague 1, outcome null, décor identique, en un rendu (aucune attente
  // de simulation). Vérifié sur la victoire FR déjà affichée.
  // -------------------------------------------------------------------------
  try {
    check(Boolean(victoryFr), 'critère 6 : aucune victoire FR posée par le critère 5')
    if (!victoryFr) throw new Error('préparation absente')

    const label = 'critère 6'
    const before = await readGame(page)
    check(before.endHidden === false, `${label} : pas d'écran de fin avant « Rejouer »`)
    const decorBefore = await decorSignature(page)
    await shot(page, 'epic-49-c6-desktop-avant-rejouer')

    // Clic réel sur « Rejouer » : la remise à zéro est synchrone, un seul rendu.
    await page.click('.end-screen__replay')
    const after = await readGame(page)
    const s = after.state

    check(after.endHidden === true, `${label} : l'écran de fin reste affiché`)
    check(s.run.outcome === null, `${label} : run.outcome « ${s.run.outcome} » au lieu de null`)
    check(s.resources === LEVEL_1.startingResources,
      `${label} : ${s.resources} sève au lieu de ${LEVEL_1.startingResources}`)
    check(s.slots.every((slot) => !slot.occupied && slot.towerId === null),
      `${label} : ${s.slots.filter((slot) => slot.occupied).length} emplacement(s) encore occupé(s)`)
    check(s.towers.length === 0, `${label} : ${s.towers.length} tour(s) encore posée(s)`)
    check(s.core.hp === s.core.max && s.core.max === LEVEL_1.heart.hp,
      `${label} : cœur ${s.core.hp}/${s.core.max} au lieu de ${LEVEL_1.heart.hp}/${LEVEL_1.heart.hp}`)
    check(s.wave.index === 1, `${label} : vague ${s.wave.index} au lieu de 1`)
    check(s.wave.phase === 'countdown', `${label} : phase « ${s.wave.phase} » au lieu de countdown`)
    check(s.wave.countdown === LEVEL_1.windup,
      `${label} : compte à rebours ${s.wave.countdown} au lieu de ${LEVEL_1.windup}`)
    check(after.waveText === fill(fr['wave.label'], { n: 1, total: LEVEL_1.waves.length }),
      `${label} : HUD « ${after.waveText} » au lieu de « ${fill(fr['wave.label'], { n: 1, total: LEVEL_1.waves.length })} »`)
    check(after.coreText === fill(fr['core.hp'], { hp: LEVEL_1.heart.hp, max: LEVEL_1.heart.hp }),
      `${label} : HUD cœur « ${after.coreText} »`)

    const decorAfter = await decorSignature(page)
    check(decorAfter !== null, `${label} : groupe « decor » introuvable après « Rejouer »`)
    check(JSON.stringify(decorBefore) === JSON.stringify(decorAfter),
      `${label} : décor modifié (${JSON.stringify(decorBefore)} → ${JSON.stringify(decorAfter)})`)
    check(JSON.stringify(decorBefore) === JSON.stringify(launchDecor),
      `${label} : décor différent du décor de lancement (${JSON.stringify(decorBefore)} vs ${JSON.stringify(launchDecor)})`)
    check(victoryDecor !== null && JSON.stringify(victoryDecor) === JSON.stringify(decorAfter),
      `${label} : décor d'avant la partie différent de celui d'après « Rejouer »`)

    await nextFrames(page, 2)
    await shot(page, 'epic-49-c6-desktop-apres-rejouer')
  } catch (error) {
    failures.push(`critère 6 : ${error.message}`)
  }

  // -------------------------------------------------------------------------
  // Critère 7 — toutes les valeurs de gameplay vivent dans src/data/level-1.js ;
  // src/core/waves.js n'écrit aucun littéral de gameplay (seuls −1, 0 et 1,
  // indices et bornes de boucle, y apparaissent).
  // -------------------------------------------------------------------------
  try {
    const label = 'critère 7'
    const [wavesSource, levelSource] = await Promise.all([
      readFile(WAVES_JS, 'utf8'),
      readFile(LEVEL_JS, 'utf8'),
    ])

    // Toutes les valeurs nécessaires sont présentes dans la donnée du niveau.
    const required = {
      'waves': Array.isArray(LEVEL_1.waves) && LEVEL_1.waves.length >= 6,
      'waves[].count': LEVEL_1.waves.every((wave) => Number.isFinite(wave.count) && wave.count > 0),
      'waves[].hp': LEVEL_1.waves.every((wave) => Number.isFinite(wave.hp) && wave.hp > 0),
      'waves[].speed': LEVEL_1.waves.every((wave) => Number.isFinite(wave.speed) && wave.speed > 0),
      'waves[].gap': LEVEL_1.waves.every((wave) => Number.isFinite(wave.gap) && wave.gap > 0),
      'windup': Number.isFinite(LEVEL_1.windup) && LEVEL_1.windup > 0,
      'heart.hp': Number.isFinite(LEVEL_1.heart?.hp),
      'heart.damage': Number.isFinite(LEVEL_1.heart?.damage),
      'combat.range': Number.isFinite(LEVEL_1.combat?.range),
      'combat.cadence': Number.isFinite(LEVEL_1.combat?.cadence),
      'combat.damage': Object.values(LEVEL_1.combat?.damage ?? {}).every(Number.isFinite),
      'shadows.radius': Number.isFinite(LEVEL_1.shadows?.radius),
      'shadows.gap': Number.isFinite(LEVEL_1.shadows?.gap),
      'path.width': Number.isFinite(LEVEL_1.path?.width),
      'path.points': Array.isArray(LEVEL_1.path?.points) && LEVEL_1.path.points.length >= 2,
    }
    const missing = Object.entries(required).filter(([, ok]) => !ok).map(([name]) => name)
    check(missing.length === 0, `${label} : valeurs absentes de level-1.js : ${missing.join(', ')}`)

    check(!/(^|\n)\s*import\b/.test(levelSource),
      `${label} : level-1.js n'est plus une donnée pure (import présent)`)
    check(/import\s*\{\s*LEVEL_1\s*\}\s*from\s*'\.\.\/data\/level-1\.js'/.test(wavesSource),
      `${label} : waves.js n'importe plus LEVEL_1`)

    // Littéraux numériques du code de waves.js, hors commentaires et chaînes.
    const code = wavesSource
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '')
      .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    const literals = [...code.matchAll(/(?<![\w.$])-?\d+(?:\.\d+)?/g)].map((match) => Number(match[0]))
    const suspicious = [...new Set(literals.filter((value) => ![-1, 0, 1].includes(value)))]
    check(suspicious.length === 0,
      `${label} : littéral(aux) de gameplay dans src/core/waves.js : ${suspicious.join(', ')}`)

    // Les valeurs effectives du state viennent bien de la donnée.
    const snap = await readGame(page)
    const s = snap.state
    check(s.wave.total === LEVEL_1.waves.length,
      `${label} : wave.total ${s.wave.total} ≠ ${LEVEL_1.waves.length} vagues de level-1.js`)
    check(s.core.max === LEVEL_1.heart.hp && s.core.damage === LEVEL_1.heart.damage,
      `${label} : cœur ${s.core.max}/${s.core.damage} ≠ ${LEVEL_1.heart.hp}/${LEVEL_1.heart.damage}`)

    // Mecaniques.md décrit les vagues, la vie du cœur, le tir automatique et
    // l'écran de fin, avec les valeurs de level-1.js (critère 7 de l'Epic).
    const doc = (await readFile(MECANIQUES, 'utf8'))
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/œ/g, 'oe').replace(/æ/g, 'ae').toLowerCase()
    check(/vague/.test(doc) && doc.includes(`${LEVEL_1.windup} s de repit`),
      `${label} : Mecaniques.md ne décrit pas le répit de ${LEVEL_1.windup} s et les vagues`)
    check(/coeur/.test(doc) && doc.includes(`${LEVEL_1.heart.hp} pv`),
      `${label} : Mecaniques.md ne décrit pas la vie du cœur (${LEVEL_1.heart.hp} PV)`)
    check(/tir automatique/.test(doc) && /aucun clic|zero clic/.test(doc),
      `${label} : Mecaniques.md ne décrit pas le tir automatique sans clic`)
    check(/ecran de fin/.test(doc) && /rejouer/.test(doc),
      `${label} : Mecaniques.md ne décrit pas l'écran de fin ni « Rejouer »`)
    console.log(`[ombres] critère 7 — littéraux numériques de waves.js : ${[...new Set(literals)].sort((a, b) => a - b).join(', ')}`)
  } catch (error) {
    failures.push(`critère 7 : ${error.message}`)
  }

  // -------------------------------------------------------------------------
  // Critère 8 — 390×844 : HUD et écran de fin sans chevauchement, draw calls
  // ≤ 300, triangles ≤ 500 000, 0 erreur console. Captures mobile de chaque état.
  // -------------------------------------------------------------------------
  try {
    const label = 'critère 8'
    await load('?lang=fr&niveau=1')
    await setViewport(page, MOBILE)
    await installClock(page)

    const hudCheck = (snap, tag) => {
      const r = snap.rects
      const viewport = snap.viewport
      check(viewport.width === MOBILE.width && viewport.height === MOBILE.height,
        `${label} [${tag}] : viewport ${viewport.width}×${viewport.height} au lieu de 390×844`)
      for (const [name, rect] of [['level', r.level], ['wave-hud', r.waveHud], ['barre', r.bar]]) {
        check(insideViewport(rect, viewport),
          `${label} [${tag}] : ${name} hors du viewport (${JSON.stringify(rect)})`)
      }
      check(!overlaps(r.level, r.waveHud),
        `${label} [${tag}] : le panneau du niveau chevauche le HUD de vague`)
      check(!overlaps(r.level, r.bar) && !overlaps(r.waveHud, r.bar),
        `${label} [${tag}] : la barre de tours chevauche un panneau du HUD`)
      const hudParts = [['vague', r.wave], ['compte', r.windup], ['cœur', r.core], ['jauge', r.meter]]
      for (let i = 0; i < hudParts.length; i++) {
        for (let j = i + 1; j < hudParts.length; j++) {
          const [nameA, rectA] = hudParts[i]
          const [nameB, rectB] = hudParts[j]
          if (nameA === 'compte' && snap.windupHidden) continue
          check(!overlaps(rectA, rectB),
            `${label} [${tag}] : ${nameA} et ${nameB} se chevauchent (${JSON.stringify(rectA)} / ${JSON.stringify(rectB)})`)
        }
      }
    }

    // Compte à rebours mobile (aucune tour posée).
    const countdown = await readGame(page)
    check(countdown.waveText === fill(fr['wave.label'], { n: 1, total: LEVEL_1.waves.length }),
      `${label} : HUD mobile « ${countdown.waveText} » au lieu de « Vague 1/6 »`)
    check(countdown.windupText === fill(fr['wave.windup'], { n: 1, s: countdown.state.wave.countdown }),
      `${label} : compte à rebours mobile « ${countdown.windupText} »`)
    hudCheck(countdown, 'répit')
    await shot(page, 'epic-49-c8-mobile-compte-a-rebours')

    // Défaite mobile : l'écran de fin doit tenir entièrement dans 390×844.
    const defeat = await page.evaluate(({ maxSteps }) => {
      const waveState = window.__game.state
      const sim = window.__sim
      let steps = 0
      while (steps < maxSteps && waveState.run.outcome === null) {
        sim.step(1 / 60)
        steps++
      }
      return {
        outcome: waveState.run.outcome,
        hp: waveState.core.hp,
        wave: waveState.wave.index,
        elapsed: waveState.run.elapsed,
      }
    }, { maxSteps: Math.ceil(420 / DT) })
    check(defeat.outcome === 'defeat',
      `${label} : mobile, issue « ${defeat.outcome} » (vague ${defeat.wave}, cœur ${defeat.hp}) au lieu de defeat`)
    await finishFades(page)
    await waitEndScreen(page)
    const defeatScreen = await readGame(page)
    expectedEnd(defeatScreen, fr, 'defeat', `${label} [défaite mobile]`)
    const mobileRect = defeatScreen.rects
    check(insideViewport(mobileRect.end, defeatScreen.viewport),
      `${label} : l'écran de fin déborde du viewport mobile (${JSON.stringify(mobileRect.end)})`)
    check(insideViewport(mobileRect.card, defeatScreen.viewport, 8),
      `${label} : la carte de fin n'est pas entièrement visible à 390×844 (${JSON.stringify(mobileRect.card)})`)
    for (const [name, rect] of [
      ['titre', mobileRect.title], ['vague', mobileRect.endWave],
      ['durée', mobileRect.endTime], ['bouton', mobileRect.replay],
    ]) {
      check(insideViewport(rect, defeatScreen.viewport),
        `${label} : ${name} de l'écran de fin hors viewport (${JSON.stringify(rect)})`)
    }
    const endParts = [['titre', mobileRect.title], ['vague', mobileRect.endWave], ['durée', mobileRect.endTime], ['bouton', mobileRect.replay]]
    for (let i = 0; i < endParts.length; i++) {
      for (let j = i + 1; j < endParts.length; j++) {
        check(!overlaps(endParts[i][1], endParts[j][1]),
          `${label} : ${endParts[i][0]} et ${endParts[j][0]} se chevauchent sur l'écran de fin`)
      }
    }
    check((mobileRect.replay?.width ?? 0) >= 44 && (mobileRect.replay?.height ?? 0) >= 44,
      `${label} : bouton « Rejouer » ${mobileRect.replay?.width}×${mobileRect.replay?.height} < 44×44`)
    await shot(page, 'epic-49-c8-mobile-defaite')

    // Victoire mobile : trois Pousses, même configuration que le desktop (2:45).
    await load('?lang=fr&niveau=1')
    await setViewport(page, MOBILE)
    const poses = await page.evaluate(() => {
      const game = window.__game
      game.state.paused = true
      game.towers.selectType('sprout')
      const placed = ['slot-1', 'slot-2', 'slot-3'].map((id) => game.towers.place(id))
      return { placed, towers: game.state.towers.length }
    })
    check(poses.placed.every(Boolean) && poses.towers === 3,
      `${label} : ${poses.towers} tour(s) posée(s) sur mobile au lieu de 3`)
    await installClock(page)

    const victory = await page.evaluate(({ maxSteps }) => {
      const waveState = window.__game.state
      const sim = window.__sim
      let steps = 0
      while (steps < maxSteps && waveState.run.outcome === null) {
        sim.step(1 / 60)
        steps++
      }
      return {
        outcome: waveState.run.outcome,
        wave: waveState.wave.index,
        elapsed: waveState.run.elapsed,
        hp: waveState.core.hp,
      }
    }, { maxSteps: Math.ceil(180 / DT) })
    check(victory.outcome === 'victory',
      `${label} : mobile, issue « ${victory.outcome} » (vague ${victory.wave}, cœur ${victory.hp}) au lieu de victory`)
    check(victory.elapsed <= 180,
      `${label} : partie mobile simulée de ${formatDuration(victory.elapsed)} (> 3 min)`)
    await finishFades(page)
    await waitEndScreen(page)
    const victoryScreen = await readGame(page)
    expectedEnd(victoryScreen, fr, 'victory', `${label} [victoire mobile]`)
    check(insideViewport(victoryScreen.rects.card, victoryScreen.viewport, 8),
      `${label} : carte de victoire hors viewport mobile (${JSON.stringify(victoryScreen.rects.card)})`)
    await shot(page, 'epic-49-c8-mobile-victoire')

    // « Rejouer » mobile : mêmes garanties qu'au critère 6.
    await page.click('.end-screen__replay')
    const replay = await readGame(page)
    check(replay.state.resources === LEVEL_1.startingResources,
      `${label} : ${replay.state.resources} sève après « Rejouer » mobile`)
    check(replay.state.slots.every((slot) => !slot.occupied) && replay.state.towers.length === 0,
      `${label} : emplacements ou tours non réinitialisés après « Rejouer » mobile`)
    check(replay.state.core.hp === replay.state.core.max && replay.state.wave.index === 1,
      `${label} : cœur ou vague non réinitialisés après « Rejouer » mobile`)
    check(replay.state.run.outcome === null, `${label} : run.outcome « ${replay.state.run.outcome} » après « Rejouer » mobile`)
    hudCheck(replay, 'après-rejouer')
    await nextFrames(page, 2)
    await shot(page, 'epic-49-c8-mobile-apres-rejouer')

    // Budgets de rendu sur 390×844, après un rendu réel.
    await nextFrames(page, 2)
    const budgets = await page.evaluate(() => ({
      drawCalls: window.__game.renderer.info.render.calls,
      triangles: window.__game.renderer.info.render.triangles,
    }))
    check(budgets.drawCalls <= 300,
      `${label} : ${budgets.drawCalls} draw calls sur mobile (> 300)`)
    check(budgets.triangles <= 500_000,
      `${label} : ${budgets.triangles} triangles sur mobile (> 500 000)`)
    console.log(`[ombres] critère 8 — mobile 390×844 : ${budgets.drawCalls} draw calls, ${budgets.triangles} triangles`)

    // Combat mobile lisible : le cadrage portrait par défaut laisse les centres des
    // emplacements hors champ. On décale la cible caméra vers le bord gauche du pan
    // autorisé (valeurs de level-1.js) pour amener le chemin au centre du cadre, puis
    // on pose les Pousses sur des emplacements dont la projection est dans 390×844.
    await load('?lang=fr&niveau=1')
    await setViewport(page, MOBILE)
    await installClock(page)
    const view = (await state()).level.camera
    await page.evaluate((targetX) => {
      window.__game.state.camera.targetX = targetX
      window.__sim.step(0)
    }, view.target.x - view.pan)
    const mobileSlots = await slotPoints(page)
    const combatIds = mobileSlots
      .filter((slot) => slot.inFront && slot.inside && slot.canvas)
      .slice(0, 2)
      .map((slot) => slot.id)
    check(combatIds.length === 2,
      `${label} : ${combatIds.length} emplacement(s) visible(s) sur mobile au lieu de 2 (${JSON.stringify(mobileSlots)})`)
    const combatPoses = await page.evaluate((ids) => {
      const game = window.__game
      game.towers.selectType('sprout')
      const placed = ids.map((id) => game.towers.place(id))
      return { placed, towers: game.state.towers.length, resources: game.state.resources }
    }, combatIds)
    check(combatPoses.placed.every(Boolean) && combatPoses.towers === 2,
      `${label} : ${combatPoses.towers} tour(s) posée(s) pour la capture de combat au lieu de 2`)

    const combat = await page.evaluate(({ maxSteps }) => {
      const waveState = window.__game.state
      const sim = window.__sim
      const screenOf = (point, margin = 0) => {
        const { camera } = window.__game
        const projected = camera.position.clone().set(point.x, 0.2, point.z).project(camera)
        const x = (projected.x * 0.5 + 0.5) * innerWidth
        const y = (-projected.y * 0.5 + 0.5) * innerHeight
        return {
          x, y,
          visible: projected.z < 1 && x >= margin && x < innerWidth - margin
            && y >= margin && y < innerHeight - margin,
        }
      }
      let steps = 0
      let visible = 0
      // Marge de 40 px : l'ombre de la capture doit être franchement dans le cadre,
      // pas un simple croissant au bord de l'écran.
      const SHADOW_MARGIN = 40
      while (steps < maxSteps) {
        sim.step(1 / 60)
        steps++
        visible = waveState.creatures.filter((c) => screenOf(c, SHADOW_MARGIN).visible).length
        if (visible >= 1 && waveState.creatures.length >= 2
          && waveState.towers.some((tower) => tower.shots >= 2)) break
      }
      return {
        creatures: waveState.creatures.length,
        head: waveState.creatures.reduce((best, c) => Math.max(best, c.progress), 0),
        shots: waveState.towers.reduce((sum, tower) => sum + tower.shots, 0),
        wave: waveState.wave.index,
        visible,
        elapsed: waveState.run.elapsed,
        screens: waveState.creatures.map(screenOf),
        towers: waveState.towers.map((tower) => ({ id: tower.id, ...screenOf(tower) })),
      }
    }, { maxSteps: Math.ceil(150 / DT) })
    check(combat.creatures >= 2 && combat.shots >= 2 && combat.visible >= 1,
      `${label} : combat mobile illisible (${combat.creatures} ombres, ${combat.visible} à l'écran, tête à ${(combat.head * 100).toFixed(0)} %, ${combat.shots} tirs ; ${JSON.stringify(combat.screens)})`)
    // Une capture de combat sans tour dans le cadre ne prouve rien : la position
    // projetée d'au moins une Pousse doit tomber dans le viewport mobile.
    const visibleTowers = combat.towers.filter((tower) => tower.visible)
    check(visibleTowers.length >= 1,
      `${label} : aucune Pousse dans le viewport 390×844 à la capture (${JSON.stringify(combat.towers)})`)
    check(combat.elapsed <= 180,
      `${label} : capture de combat mobile après ${formatDuration(combat.elapsed)} de partie simulée (> 3 min)`)
    await nextFrames(page, 2)
    await shot(page, 'epic-49-c8-mobile-combat')
  } catch (error) {
    failures.push(`critère 8 : ${error.message}`)
  }

  // Aucune erreur console sur l'ensemble du scénario (le runner le vérifie aussi).
  check(consoleErrors.length === 0,
    `erreur(s) console pendant le scénario : ${consoleErrors.slice(0, 3).join(' | ')}`)

  if (failures.length) throw new Error(failures.join(' | '))
}
