// Playtest de l'Epic #129 — fin de niveau et progression fiables.
// Un bloc par critère d'acceptation, dans l'ordre de l'Epic, sur le parcours complet
// demandé par le ticket #145 : victoire du niveau 1 → « Rejouer » → « Retour aux
// jardins » → carte `niveau-2` déverrouillée → « Commencer » → niveau 2 monté.
// Chaque étape clé relève `window.__game.state` (`screen`, `level.id`, `level.mapId`,
// `progress.completed`, `unlocked`) et `localStorage["seveclaire.progress.v1"]`.
// La victoire est provoquée sans clic, par la même méthode que jardins.mjs : la boucle
// est mise en pause, trois Pousses sont posées par l'API du jeu, puis les entités sont
// avancées à pas fixes jusqu'au verdict. La modale n'est donc jamais « aidée » par un
// clic : la progression doit déjà être écrite quand elle s'affiche.
// Captures : test-results/epic-129-c<n>-<label>.png (copiées dans le test-results/ du
// dépôt principal, préfixées `issue-145-`, quand on tourne dans un worktree).
import { copyFileSync, mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LEVEL_2 } from '../../src/data/level-2.js'
import { outputDir } from '../../scripts/lib.mjs'

const STORAGE_KEY = 'seveclaire.progress.v1'
const MOBILE = { width: 390, height: 844 }
// Bornes larges : la plus longue victoire mesurée (jardins.mjs) tient 10 317 pas,
// une défaite sans tour arrive au premier passage au cœur.
const VICTORY_STEPS = 12_000
const DEFEAT_STEPS = 24_000
const FR_JSON = fileURLToPath(new URL('../../src/i18n/fr.json', import.meta.url))
const EN_JSON = fileURLToPath(new URL('../../src/i18n/en.json', import.meta.url))
const GDD = fileURLToPath(new URL('../../vault/GDD/Mecaniques.md', import.meta.url))
const CAPTURE_DIR = 'test-results'
const { results, prefix } = outputDir()
mkdirSync(CAPTURE_DIR, { recursive: true })
mkdirSync(results, { recursive: true })

/** Carte montée pour le jardin 2 : l'id vit dans `level-2.js`, distinct de la clé `map` de la campagne. */
const NIVEAU_2_MAP = LEVEL_2.id

/** Attend le nombre d'images de rendu demandé (aucune attente arbitraire). */
const nextFrames = (page, count = 2) => page.evaluate((n) => new Promise((resolve) => {
  let seen = 0
  const loop = () => (++seen >= n ? resolve() : requestAnimationFrame(loop))
  requestAnimationFrame(loop)
}), count)

/** Capture `epic-129-c<n>-<label>.png`, copiée en `issue-145-…` dans le dépôt principal. */
async function capture(page, label) {
  const file = join(CAPTURE_DIR, `${label}.png`)
  await page.screenshot({ path: file })
  if (prefix) copyFileSync(file, join(results, `${prefix}${label}.png`))
  return `${prefix}${label}.png`
}

function waitScreen(page, screen) {
  return page.waitForFunction(
    (value) => window.__game?.state.screen === value,
    screen,
    { timeout: 10_000 },
  )
}

/**
 * État relevé à une étape clé : les cinq champs demandés par le ticket, plus la
 * valeur brute du stockage pour comparer à l'identique.
 */
function snapshot(page) {
  return page.evaluate((key) => {
    const s = window.__game.state
    return {
      screen: s.screen,
      campaign: s.campaign,
      levelId: s.level?.id ?? null,
      mapId: s.level?.mapId ?? null,
      completed: [...(s.progress?.completed ?? [])],
      unlocked: [...(s.unlocked ?? [])],
      outcome: s.run?.outcome ?? null,
      wave: s.wave?.index ?? null,
      coreHp: s.core?.hp ?? null,
      towers: s.towers?.length ?? null,
      stored: localStorage.getItem(key),
      search: location.search,
    }
  }, STORAGE_KEY)
}

/** Modale de fin : état, titre et chaque action avec sa géométrie et son clic possible. */
function readEndModal(page) {
  return page.evaluate(() => {
    const end = document.querySelector('.end-screen')
    if (!end) return { present: false }
    const buttons = [...end.querySelectorAll('.end-screen__actions button')].map((button) => {
      const rect = button.getBoundingClientRect()
      const point = rect.width > 0 && rect.height > 0
        ? document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
        : null
      return {
        action: button.dataset.action ?? null,
        label: button.textContent.trim(),
        hidden: button.hidden,
        disabled: button.disabled,
        visible: button.getClientRects().length > 0,
        inViewport: rect.x >= 0 && rect.y >= 0
          && rect.right <= innerWidth + 0.5 && rect.bottom <= innerHeight + 0.5
          && rect.width > 0 && rect.height > 0,
        clickable: Boolean(point) && (point === button || button.contains(point)),
      }
    })
    return {
      present: true,
      hidden: end.hidden,
      visible: end.getClientRects().length > 0,
      outcome: end.dataset.outcome ?? null,
      title: end.querySelector('.end-screen__title')?.textContent.trim() ?? '',
      buttons,
    }
  })
}

/** Carte d'un jardin dans la liste : verrou, état terminé, mention et pastille. */
function readRow(page, levelId) {
  return page.evaluate((id) => {
    const row = document.querySelector(`[data-level="${id}"]`)
    if (!row) return null
    const state = row.querySelector('.level-row__state')
    const badge = row.querySelector('.level-row__badge')
    const style = badge ? getComputedStyle(badge) : null
    return {
      locked: row.classList.contains('is-locked'),
      done: row.classList.contains('is-done'),
      active: row.classList.contains('is-active'),
      ariaDisabled: row.getAttribute('aria-disabled'),
      stateText: state?.textContent.trim() ?? '',
      stateVisible: state ? state.getClientRects().length > 0 : false,
      badgeDisplay: style?.display ?? null,
      badgeBackground: style?.backgroundColor ?? null,
      text: row.textContent.trim(),
    }
  }, levelId)
}

/** Pose trois Pousses et avance la boucle jusqu'au verdict ; relève le stockage avant/après. */
function winLevel(page) {
  return page.evaluate(({ maxSteps, key }) => {
    const game = window.__game
    game.state.paused = true
    const entities = game.scene.children.filter((object) => typeof object.update === 'function')
    game.towers.selectType('sprout')
    const placed = game.state.slots.filter((slot) => game.towers.place(slot.id)).length
    const storedBefore = localStorage.getItem(key)
    let steps = 0
    while (steps < maxSteps && game.state.run.outcome === null) {
      for (const entity of entities) entity.update(1 / 60)
      steps++
    }
    // Les fondus de fin (updateDying) ont besoin de quelques images de plus.
    for (let i = 0; i < 40; i++) for (const entity of entities) entity.update(1 / 60)
    return {
      placed,
      steps,
      storedBefore,
      storedAfter: localStorage.getItem(key),
      outcome: game.state.run.outcome,
      wave: game.state.wave.index,
      total: game.state.wave.total,
      core: game.state.core.hp,
    }
  }, { maxSteps: VICTORY_STEPS, key: STORAGE_KEY })
}

/** Sans tour, cœur à 1 PV : la première ombre qui atteint le cœur termine en défaite. */
function loseLevel(page) {
  return page.evaluate(({ maxSteps }) => {
    const game = window.__game
    game.state.paused = true
    game.state.core.hp = 1
    const entities = game.scene.children.filter((object) => typeof object.update === 'function')
    let steps = 0
    while (steps < maxSteps && game.state.run.outcome === null) {
      for (const entity of entities) entity.update(1 / 60)
      steps++
    }
    for (let i = 0; i < 40; i++) for (const entity of entities) entity.update(1 / 60)
    return {
      outcome: game.state.run.outcome,
      steps,
      core: game.state.core.hp,
      wave: game.state.wave.index,
      towers: game.state.towers.length,
    }
  }, { maxSteps: DEFEAT_STEPS })
}

/** Pastille du jardin 2 au déverrouillage : ni cadenas, ni « Terminé », chevron seul. */
function checkUnlockedRow(check, row, label) {
  check(Boolean(row), `${label} : la carte niveau-2 est absente de la liste`)
  if (!row) return
  check(row.locked === false, `${label} : niveau-2 est verrouillé (.is-locked, aria-disabled=${row.ariaDisabled})`)
  check(row.ariaDisabled === 'false', `${label} : aria-disabled de niveau-2 = ${row.ariaDisabled}`)
  check(row.done === false, `${label} : niveau-2 est marqué terminé (.is-done) sans avoir été joué`)
  check(row.stateText === '',
    `${label} : mention « ${row.stateText} » sur niveau-2 au lieu d'aucune`)
  check(row.badgeDisplay !== 'none', `${label} : la pastille de niveau-2 n'est pas affichée`)
  check(row.badgeBackground === 'rgba(0, 0, 0, 0)',
    `${label} : pastille de niveau-2 colorée (${row.badgeBackground}), donc cadenas ou coche au lieu du chevron`)
}

export default async function ({ page, load }) {
  const failures = []
  const check = (condition, message) => {
    if (!condition) failures.push(message)
  }

  const errors = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))

  const [fr, en] = await Promise.all([
    readFile(FR_JSON, 'utf8').then(JSON.parse),
    readFile(EN_JSON, 'utf8').then(JSON.parse),
  ])
  const endLabels = { next: fr['end.next'], replay: fr['end.replay'], exit: fr['end.exit'] }
  const gdd = await readFile(GDD, 'utf8').catch(() => '')

  // Parcours relevé pour le critère 5 : chaque étape doit avoir réellement eu lieu.
  const journey = { victory: false, replay: false, exit: false, niveau2: false }
  let victory = null
  let victoryRaw = null

  // -------------------------------------------------------------------------
  // Critère 1 — la victoire du niveau 1 écrit `niveau-1` dans
  // `localStorage["seveclaire.progress.v1"]` avant que la modale n'existe, et le
  // premier clic (« Rejouer ») ne change pas cette valeur.
  // Critère 2 (victoire) — la modale affiche 3 boutons visibles et actionnables,
  // aux libellés FR du dictionnaire.
  // -------------------------------------------------------------------------
  try {
    await page.setViewportSize(MOBILE)
    await load('?lang=fr')
    await page.evaluate((key) => localStorage.removeItem(key), STORAGE_KEY)
    await load('?niveau=1&lang=fr')

    const start = await snapshot(page)
    check(start.screen === 'game', `critère 1 : écran « ${start.screen} » au lancement de ?niveau=1`)
    check(start.levelId === 'niveau-1', `critère 1 : jardin « ${start.levelId} » au lancement`)
    check(start.completed.length === 0,
      `critère 1 : progression non purgée (${JSON.stringify(start.completed)})`)

    victory = await winLevel(page)
    check(victory.placed >= 3, `critère 1 : ${victory.placed} Pousse(s) posée(s) au lieu de 3`)
    check(victory.outcome === 'victory',
      `critère 1 : partie terminée en « ${victory.outcome} » (vague ${victory.wave}/${victory.total}, cœur ${victory.core}) au lieu de victory`)
    check(victory.storedBefore === null,
      `critère 1 : progression déjà écrite avant la victoire (${victory.storedBefore})`)

    let stored = null
    try { stored = victory.storedAfter ? JSON.parse(victory.storedAfter) : null } catch { stored = null }
    check(Boolean(stored) && stored.version === 1,
      `critère 1 : localStorage « ${victory.storedAfter} » illisible`)
    check(Array.isArray(stored?.completed) && stored.completed.includes('niveau-1'),
      `critère 1 : « niveau-1 » absent de localStorage après la victoire (${victory.storedAfter})`)

    await nextFrames(page, 2)
    const won = await snapshot(page)
    victoryRaw = won.stored
    check(won.screen === 'game', `critère 1 : écran « ${won.screen} » à la victoire au lieu de « game »`)
    check(won.completed.includes('niveau-1'),
      `critère 1 : state.progress.completed = ${JSON.stringify(won.completed)} à la victoire`)
    check(won.unlocked.includes('niveau-2'),
      `critère 1 : niveau-2 absent des jardins déverrouillés (${JSON.stringify(won.unlocked)})`)
    check(won.search.includes('niveau=1'),
      `critère 1 : l'URL a changé avant tout clic (${won.search})`)

    const modal = await readEndModal(page)
    check(modal.present && modal.hidden === false && modal.visible,
      'critère 2 : la modale de victoire n\'est pas affichée après la victoire')
    check(modal.outcome === 'victory', `critère 2 : modale « ${modal.outcome} » au lieu de victory`)
    check(modal.title === fr['end.victory'],
      `critère 2 : titre de victoire « ${modal.title} » au lieu de « ${fr['end.victory']} »`)

    const visible = (modal.buttons ?? []).filter((button) => button.visible)
    check(visible.length === 3,
      `critère 2 : ${visible.length} bouton(s) visible(s) en victoire au lieu de 3 (${(modal.buttons ?? []).map((b) => b.action).join(', ')})`)
    check(JSON.stringify(visible.map((button) => button.action)) === JSON.stringify(['next', 'replay', 'exit']),
      `critère 2 : actions ${visible.map((button) => button.action).join(', ')} au lieu de next, replay, exit`)
    for (const button of visible) {
      check(button.label === endLabels[button.action],
        `critère 2 : libellé « ${button.label} » au lieu de « ${endLabels[button.action]} » (${button.action})`)
      check(button.disabled === false, `critère 2 : bouton « ${button.action} » désactivé en victoire`)
      check(button.inViewport,
        `critère 2 : bouton « ${button.action} » hors du viewport 390×844`)
      check(button.clickable,
        `critère 2 : bouton « ${button.action} » recouvert, non actionnable au centre`)
    }

    journey.victory = true
    await capture(page, 'epic-129-c1-victoire')
    console.log(`[fin-de-niveau] critère 1 — victoire en ${victory.steps} pas, vague ${victory.wave}/${victory.total}, localStorage ${victory.storedAfter}`)
  } catch (error) {
    failures.push(`critère 1/2 (victoire) : ${error.message}`)
  }

  // -------------------------------------------------------------------------
  // Critère 1 (suite) — « Rejouer » laisse la progression strictement identique.
  // Critère 3 — victoire → « Rejouer » → « Retour aux jardins » : carte niveau-2
  // déverrouillée, « Commencer » actif, et toujours après `location.reload()`.
  // Critère 5 (parcours) — la fin du bloc lance le niveau 2 depuis la carte.
  // -------------------------------------------------------------------------
  try {
    check(victoryRaw !== null, 'critère 1 : aucune valeur de progression de la victoire à comparer')
    await page.click('.end-screen [data-action="replay"]')
    await nextFrames(page, 2)
    const replay = await snapshot(page)
    journey.replay = true
    check(replay.screen === 'game' && replay.levelId === 'niveau-1',
      `critère 1 : après « Rejouer », écran « ${replay.screen} », jardin « ${replay.levelId} »`)
    check(replay.outcome === null, `critère 1 : la partie rejouée est déjà terminée (${replay.outcome})`)
    check(replay.towers === 0, `critère 1 : ${replay.towers} tour(s) encore posée(s) après « Rejouer »`)
    check(replay.coreHp === 12, `critère 1 : cœur à ${replay.coreHp} PV après « Rejouer » au lieu de 12`)
    check(replay.stored === victoryRaw,
      `critère 1 : progression modifiée par « Rejouer » (${replay.stored} au lieu de ${victoryRaw})`)
    check(replay.completed.includes('niveau-1'),
      `critère 1 : progression perdue par « Rejouer » (${JSON.stringify(replay.completed)})`)

    const replayModal = await readEndModal(page)
    check(!replayModal.visible,
      'critère 1 : la modale de fin reste affichée après « Rejouer »')
    await capture(page, 'epic-129-c2-rejoue')

    // Deuxième victoire : la modale doit revenir, progression inchangée.
    const again = await winLevel(page)
    check(again.outcome === 'victory',
      `critère 3 : seconde partie terminée en « ${again.outcome} » au lieu de victory`)
    check(again.storedAfter === victoryRaw,
      `critère 3 : progression modifiée par la seconde victoire (${again.storedAfter} au lieu de ${victoryRaw})`)

    await nextFrames(page, 2)
    await page.click('.end-screen [data-action="exit"]')
    await waitScreen(page, 'levels')
    await nextFrames(page, 3)
    journey.exit = true

    const levels = await snapshot(page)
    check(levels.campaign === 'seveclaire', `critère 3 : campagne « ${levels.campaign} » dans la liste`)
    check(levels.completed.includes('niveau-1'),
      `critère 3 : progression perdue au retour aux jardins (${JSON.stringify(levels.completed)})`)
    check(levels.unlocked.includes('niveau-2'),
      `critère 3 : niveau-2 absent de state.unlocked (${JSON.stringify(levels.unlocked)})`)
    check(levels.search.includes('niveau=1'),
      `critère 3 : la liste des jardins a été atteinte par un rechargement (URL ${levels.search})`)

    checkUnlockedRow(check, await readRow(page, 'niveau-2'), 'critère 3')
    const rows = await page.evaluate(() => [...document.querySelectorAll('.level-row')].map((row) => row.dataset.level))
    check(rows.length === 6, `critère 3 : ${rows.length} jardin(s) dans la liste au lieu de 6`)

    await page.click('[data-level="niveau-2"]')
    await page.click('[data-difficulty="medium"]')
    const startReady = await page.$eval('[data-action="start"]', (button) => ({
      disabled: button.disabled,
      label: button.textContent.trim(),
    }))
    check(startReady.disabled === false,
      'critère 3 : « Commencer » reste désactivé après sélection de niveau-2 en difficulté moyenne')
    check(startReady.label === fr['game.start'],
      `critère 3 : libellé du bouton « ${startReady.label} » au lieu de « ${fr['game.start']} »`)
    await capture(page, 'epic-129-c3-jardins')

    // Rechargement réel : la progression doit survivre, la carte rester ouverte.
    await page.reload()
    await page.waitForFunction(() => window.__game?.state.frames > 0, null, { timeout: 10_000 })
    await nextFrames(page, 2)
    const reloaded = await snapshot(page)
    check(reloaded.completed.includes('niveau-1'),
      `critère 3 : progression perdue par location.reload() (${JSON.stringify(reloaded.completed)})`)
    if (reloaded.screen === 'game') {
      // L'URL `?niveau=1` relance le jardin : « Retour » ramène à l'accueil.
      await page.click('.high-bar [data-action="back"]')
      await waitScreen(page, 'home')
    }
    await page.click('[data-campaign="seveclaire"] .campaign-card__open')
    await waitScreen(page, 'levels')
    await nextFrames(page, 3)

    const afterReload = await snapshot(page)
    check(afterReload.unlocked.includes('niveau-2'),
      `critère 3 : niveau-2 verrouillé après rechargement (${JSON.stringify(afterReload.unlocked)})`)
    checkUnlockedRow(check, await readRow(page, 'niveau-2'), 'critère 3 (après reload)')
    await page.click('[data-level="niveau-2"]')
    await page.click('[data-difficulty="medium"]')
    check((await page.$eval('[data-action="start"]', (button) => button.disabled)) === false,
      'critère 3 : « Commencer » désactivé pour niveau-2 après rechargement')
    await capture(page, 'epic-129-c4-reload')

    // Parcours du ticket : « Commencer » monte le niveau 2.
    await page.click('[data-action="start"]')
    await waitScreen(page, 'game')
    await nextFrames(page, 3)
    const mounted = await snapshot(page)
    journey.niveau2 = true
    check(mounted.levelId === 'niveau-2',
      `critère 5 : jardin monté « ${mounted.levelId} » au lieu de niveau-2`)
    check(mounted.mapId === NIVEAU_2_MAP,
      `critère 5 : carte « ${mounted.mapId} » au lieu de « ${NIVEAU_2_MAP} »`)
    check(mounted.outcome === null, `critère 5 : niveau 2 déjà terminé à l'ouverture (${mounted.outcome})`)
    const hud = await page.evaluate(() => ({
      highBar: Boolean(document.querySelector('.high-bar')),
      waveHud: Boolean(document.querySelector('.wave-hud')?.getClientRects().length),
      level: window.__game.state.level.id,
      ground: window.__game.state.level.palette.ground,
      decor: window.__game.state.decor?.counts ?? null,
    }))
    check(hud.highBar && hud.waveHud,
      `critère 5 : HUD du niveau 2 incomplet (barre haute ${hud.highBar}, bandeau de vague ${hud.waveHud})`)
    check(hud.ground === LEVEL_2.palette.ground,
      `critère 5 : sol du niveau 2 ${hud.ground} au lieu de ${LEVEL_2.palette.ground}`)
    check(Boolean(hud.decor), 'critère 5 : décor du niveau 2 absent de l\'état')
    await page.evaluate(() => { window.__game.state.paused = false })
    await nextFrames(page, 4)
    await capture(page, 'epic-129-c5-niveau-2')
    console.log(`[fin-de-niveau] critère 3 — niveau-2 déverrouillé et lancé : carte ${mounted.mapId}, URL ${mounted.search}`)
  } catch (error) {
    failures.push(`critère 3/5 (rejouer → retour → niveau 2) : ${error.message}`)
  }

  // -------------------------------------------------------------------------
  // Critère 4 — victoire → « Niveau suivant » : le niveau 2 est monté directement
  // (URL `?niveau=niveau-2`, carte et HUD du niveau 2), sans accueil ni rechargement.
  // -------------------------------------------------------------------------
  try {
    await load('?niveau=1&lang=fr')
    const nextRun = await winLevel(page)
    check(nextRun.outcome === 'victory',
      `critère 4 : partie terminée en « ${nextRun.outcome} » au lieu de victory`)
    await nextFrames(page, 2)

    const modal = await readEndModal(page)
    check(modal.outcome === 'victory' && modal.visible,
      'critère 4 : modale de victoire absente avant « Niveau suivant »')

    const originBefore = await page.evaluate(() => performance.timeOrigin)
    // Échantillonne les écrans pendant le clic : l'accueil ne doit jamais apparaître.
    await page.evaluate(() => {
      window.__playScreens = []
      const sample = () => {
        window.__playScreens.push(window.__game?.state?.screen ?? null)
        if (window.__playScreens.length < 900) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })
    await page.click('.end-screen [data-action="next"]')
    await page.waitForFunction(
      () => window.__game.state.screen === 'game' && window.__game.state.level?.id === 'niveau-2',
      null,
      { timeout: 10_000 },
    )
    await nextFrames(page, 3)

    const after = await snapshot(page)
    const originAfter = await page.evaluate(() => performance.timeOrigin)
    const screens = await page.evaluate(() => window.__playScreens ?? [])
    check(originAfter === originBefore, 'critère 4 : la page a été rechargée par « Niveau suivant »')
    check(after.screen === 'game', `critère 4 : écran « ${after.screen} » après « Niveau suivant »`)
    check(after.levelId === 'niveau-2', `critère 4 : jardin « ${after.levelId} » au lieu de niveau-2`)
    check(after.mapId === NIVEAU_2_MAP,
      `critère 4 : carte « ${after.mapId} » au lieu de « ${NIVEAU_2_MAP} »`)
    check(new URLSearchParams(after.search).get('niveau') === 'niveau-2',
      `critère 4 : URL ${after.search} sans « niveau=niveau-2 »`)
    check(!screens.includes('home'),
      `critère 4 : l'accueil est apparu pendant « Niveau suivant » (${[...new Set(screens)].join(', ')})`)
    check(screens.includes('game'),
      `critère 4 : aucun passage par l'écran de jeu pendant « Niveau suivant » (${[...new Set(screens)].join(', ')})`)
    const homeMounted = await page.evaluate(() => Boolean(document.querySelector('.home')))
    check(homeMounted === false, 'critère 4 : l\'accueil est monté après « Niveau suivant »')
    await capture(page, 'epic-129-c6-niveau-suivant')
    console.log(`[fin-de-niveau] critère 4 — niveau 2 monté en direct, écrans vus : ${[...new Set(screens)].join(', ')}`)
  } catch (error) {
    failures.push(`critère 4 (niveau suivant) : ${error.message}`)
  }

  // -------------------------------------------------------------------------
  // Critère 2 (défaite) — 2 boutons seulement (« Rejouer », « Retour aux jardins »),
  // aucun « Niveau suivant » visible ni actionnable.
  // -------------------------------------------------------------------------
  try {
    await load('?niveau=1&lang=fr')
    const lost = await loseLevel(page)
    check(lost.outcome === 'defeat',
      `critère 2 : partie terminée en « ${lost.outcome} » au lieu de defeat (cœur ${lost.core}, vague ${lost.wave})`)
    await nextFrames(page, 2)

    const modal = await readEndModal(page)
    check(modal.present && modal.hidden === false && modal.visible,
      'critère 2 : la modale de défaite n\'est pas affichée')
    check(modal.outcome === 'defeat', `critère 2 : modale « ${modal.outcome} » au lieu de defeat`)
    check(modal.title === fr['end.defeat'],
      `critère 2 : titre de défaite « ${modal.title} » au lieu de « ${fr['end.defeat']} »`)

    const buttons = modal.buttons ?? []
    const visible = buttons.filter((button) => button.visible)
    check(visible.length === 2,
      `critère 2 : ${visible.length} bouton(s) visible(s) en défaite au lieu de 2 (${buttons.map((b) => b.action).join(', ')})`)
    check(JSON.stringify(visible.map((button) => button.action)) === JSON.stringify(['replay', 'exit']),
      `critère 2 : actions visibles en défaite ${visible.map((button) => button.action).join(', ')} au lieu de replay, exit`)
    const next = buttons.find((button) => button.action === 'next')
    check(Boolean(next), 'critère 2 : le bouton « Niveau suivant » a disparu du DOM en défaite')
    check(next?.hidden === true && next?.visible === false,
      'critère 2 : « Niveau suivant » est encore affiché en défaite')
    check(next?.disabled === true, 'critère 2 : « Niveau suivant » est encore actionnable en défaite')
    for (const button of visible) {
      check(button.disabled === false, `critère 2 : bouton « ${button.action} » désactivé en défaite`)
      check(button.inViewport, `critère 2 : bouton « ${button.action} » hors du viewport 390×844`)
      check(button.clickable, `critère 2 : bouton « ${button.action} » recouvert, non actionnable au centre`)
      check(button.label === endLabels[button.action],
        `critère 2 : libellé « ${button.label} » au lieu de « ${endLabels[button.action]} » (${button.action})`)
    }
    await capture(page, 'epic-129-c7-defaite')
    console.log(`[fin-de-niveau] critère 2 — défaite : ${visible.length} boutons (${visible.map((b) => b.label).join(', ')})`)
  } catch (error) {
    failures.push(`critère 2 (défaite) : ${error.message}`)
  }

  // -------------------------------------------------------------------------
  // Critère 6 — les trois libellés de fin existent en FR et en EN, sans clé
  // manquante ni valeur vide ; l'EN est réellement traduit.
  // -------------------------------------------------------------------------
  try {
    for (const [lang, dict] of [['fr', fr], ['en', en]]) {
      for (const key of ['end.next', 'end.replay', 'end.exit']) {
        check(typeof dict[key] === 'string' && dict[key].trim() !== '',
          `critère 6 : clé « ${key} » absente ou vide en ${lang}`)
      }
    }
    for (const key of ['end.next', 'end.replay', 'end.exit']) {
      check(en[key] !== fr[key], `critère 6 : « ${key} » identique en FR et EN (« ${en[key]} »)`)
    }
    const sameKeys = JSON.stringify(Object.keys(fr).sort()) === JSON.stringify(Object.keys(en).sort())
    check(sameKeys, 'critère 6 : fr.json et en.json n\'exposent pas les mêmes clés')
    console.log(`[fin-de-niveau] critère 6 — FR « ${fr['end.next']} / ${fr['end.replay']} / ${fr['end.exit']} », EN « ${en['end.next']} / ${en['end.replay']} / ${en['end.exit']} »`)
  } catch (error) {
    failures.push(`critère 6 (i18n) : ${error.message}`)
  }

  // -------------------------------------------------------------------------
  // Critère 7 — le GDD décrit la fin à trois actions, la progression écrite avant
  // toute relance et le retour à la sélection.
  // -------------------------------------------------------------------------
  try {
    check(gdd.length > 0, `critère 7 : ${GDD} illisible`)
    for (const label of ['Niveau suivant', 'Rejouer', 'Retour aux jardins']) {
      check(gdd.includes(label), `critère 7 : « ${label} » absent du GDD`)
    }
    check(/progression écrite\s+\*\*avant\*\*/i.test(gdd),
      'critère 7 : le GDD ne dit pas que la progression est écrite avant toute relance')
    check(gdd.includes('location.reload()'),
      'critère 7 : le GDD ne couvre pas la survie de la progression à location.reload()')
    console.log('[fin-de-niveau] critère 7 — GDD : 3 actions, progression avant relance, survie au reload')
  } catch (error) {
    failures.push(`critère 7 (GDD) : ${error.message}`)
  }

  // -------------------------------------------------------------------------
  // Critère 5 — le parcours complet du ticket a bien été joué, et aucune erreur
  // console ni exception n'a été levée pendant tout le scénario.
  // -------------------------------------------------------------------------
  try {
    check(journey.victory, 'critère 5 : la victoire du niveau 1 n\'a pas eu lieu')
    check(journey.replay, 'critère 5 : « Rejouer » n\'a pas été cliqué')
    check(journey.exit, 'critère 5 : « Retour aux jardins » n\'a pas été cliqué')
    check(journey.niveau2, 'critère 5 : le niveau 2 n\'a pas été lancé depuis la carte')
    check(errors.length === 0,
      `critère 5 : ${errors.length} erreur(s) console ou exception(s) : ${errors.join(' | ')}`)
    console.log(`[fin-de-niveau] critère 5 — parcours ${Object.entries(journey).filter(([, done]) => done).map(([step]) => step).join(' → ')}, ${errors.length} erreur(s) console`)
  } catch (error) {
    failures.push(`critère 5 (parcours) : ${error.message}`)
  }

  if (failures.length) throw new Error(failures.join(' | '))
}
