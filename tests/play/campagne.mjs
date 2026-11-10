// Playtest de l'Epic #47 — accueil de campagne, six jardins, difficultés, progression.
// Un bloc par critère d'acceptation, dans l'ordre de l'Epic : accueil et ses trois
// campagnes, campagne « bientôt disponible » inerte, liste des six jardins, difficultés
// et multiplicateur de vagues, progression sauvegardée, retour sans rechargement et
// absence de texte en dur en FR comme en EN. La progression vit dans
// `localStorage['seveclaire.progress.v1']` : elle est purgée au début de chaque bloc qui
// teste le premier lancement, puis relue par un `load()` explicite. `?lang=fr` fixe la
// langue des libellés attendus (le navigateur headless peut être en en-US), `?niveau=1`
// repart directement en jeu comme dans #68. Captures : test-results/epic-47-c<n>-<label>.png.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const RESULTS = 'test-results'
const STORAGE_KEY = 'seveclaire.progress.v1'
const MOBILE = { width: 390, height: 844 }
const DESKTOP = { width: 1280, height: 720 }
const BUDGET = { drawCalls: 300, triangles: 500_000 }
const FR_JSON = fileURLToPath(new URL('../../src/i18n/fr.json', import.meta.url))
const EN_JSON = fileURLToPath(new URL('../../src/i18n/en.json', import.meta.url))

/** Attend le nombre de frames de rendu demandé (aucune attente arbitraire). */
const nextFrames = (page, count = 2) => page.evaluate((n) => new Promise((resolve) => {
  let seen = 0
  const loop = () => (++seen >= n ? resolve() : requestAnimationFrame(loop))
  requestAnimationFrame(loop)
}), count)

async function setViewport(page, { width, height }) {
  await page.setViewportSize({ width, height })
  await nextFrames(page, 3)
}

/** Capture nommée epic-47-c<n>-<label>.png dans test-results/. */
function shot(page, label) {
  return page.screenshot({ path: `${RESULTS}/${label}.png` })
}

/** Efface la progression enregistrée : retour au tout premier lancement. */
function purgeProgress(page) {
  return page.evaluate((key) => {
    try { localStorage.removeItem(key) } catch { /* stockage indisponible : rien à purger */ }
  }, STORAGE_KEY)
}

/** Attend l'écran demandé, exposé par window.__game.state.screen. */
function waitScreen(page, screen) {
  return page.waitForFunction(
    (value) => window.__game?.state.screen === value,
    screen,
    { timeout: 10_000 },
  )
}

/** Ouvre la campagne principale depuis l'accueil et attend la liste des jardins. */
async function openCampaign(page) {
  await page.click('[data-campaign="seveclaire"] .campaign-card__open')
  await waitScreen(page, 'levels')
  await nextFrames(page, 2)
}

/** Lignes de la liste des jardins : id, verrou, état terminé, nom, mention d'état. */
function readRows(page) {
  return page.evaluate(() => [...document.querySelectorAll('.level-row')].map((row) => ({
    id: row.dataset.level ?? null,
    locked: row.classList.contains('is-locked'),
    done: row.classList.contains('is-done'),
    name: row.querySelector('.level-row__name')?.textContent.trim() ?? '',
    state: row.querySelector('.level-row__state')?.textContent.trim() ?? '',
  })))
}

/** Cartes de campagne de l'accueil : ids, état, géométrie et mentions affichées. */
function readHome(page) {
  return page.evaluate(() => {
    const cards = [...document.querySelectorAll('[data-campaign]')]
    const home = document.querySelector('.home')
    return {
      cards: cards.map((card) => {
        const rect = card.getBoundingClientRect()
        return {
          id: card.dataset.campaign ?? null,
          available: card.dataset.available ?? null,
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        }
      }),
      badges: cards.map((card) => {
        const badge = card.querySelector('.campaign-card__badge')
        if (!badge) return null
        return {
          text: badge.textContent.trim(),
          visible: badge.getClientRects().length > 0,
          card: card.dataset.campaign ?? null,
        }
      }).filter(Boolean),
      viewport: innerWidth,
      docScrollWidth: document.documentElement.scrollWidth,
      homeScrollWidth: home ? home.scrollWidth : 0,
      rows: document.querySelectorAll('.level-row').length,
      selects: document.querySelectorAll('.level-select').length,
    }
  })
}

/**
 * Textes réellement affichés dans #ui : feuilles de texte et libellés ARIA.
 * Les sous-arbres `aria-hidden` (rang des jardins, pousse dessinée) ne sont pas
 * annoncés au joueur et sont écartés du contrôle.
 */
function readTexts(page) {
  return page.evaluate(() => {
    const root = document.getElementById('ui')
    const visible = (element) => !element.closest('[aria-hidden="true"]')
    const texts = [...root.querySelectorAll('*')]
      .filter((element) => element.children.length === 0 && element.textContent.trim() && visible(element))
      .map((element) => element.textContent.trim())
    const labels = [...root.querySelectorAll('[aria-label]')]
      .filter(visible)
      .map((element) => element.getAttribute('aria-label').trim())
      .filter(Boolean)
    return [...new Set([...texts, ...labels])]
  })
}

/**
 * Textes qui ne viennent pas du dictionnaire : aucune valeur littérale, aucun
 * gabarit de valeur (`{n} jardins`) une fois les nombres substitués.
 */
function hardcodedTexts(texts, dict) {
  const values = new Set(Object.values(dict))
  const escape = (part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const NUMBER = '-?\\d+(?:[.,]\\d+)?'
  const templates = [...values]
    .filter((value) => /\{[^{}]*\}/.test(value))
    .map((value) => new RegExp(`^${value.split(/\{[^{}]*\}/g).map(escape).join(NUMBER)}$`))
  return texts.filter((text) => !values.has(text) && !templates.some((template) => template.test(text)))
}

export default async function ({ page, load, state }) {
  const failures = []
  const check = (condition, message) => {
    if (!condition) failures.push(message)
  }

  const [fr, en] = await Promise.all([
    readFile(FR_JSON, 'utf8').then(JSON.parse),
    readFile(EN_JSON, 'utf8').then(JSON.parse),
  ])

  // -------------------------------------------------------------------------
  // Critère 1 — au lancement, l'accueil s'affiche avant la clairière : trois
  // campagnes, deux mentions « bientôt disponible ». En 390×844 les trois cartes
  // sont empilées en une colonne, sans défilement horizontal.
  // -------------------------------------------------------------------------
  try {
    await load('?lang=fr')
    await purgeProgress(page)
    await load('?lang=fr')
    await setViewport(page, MOBILE)
    const current = await state()
    check(current.screen === 'home',
      `critère 1 : écran « ${current.screen} » au lancement au lieu de « home »`)
    check(!('level' in current), 'critère 1 : state.level existe déjà à l\'accueil')

    const home = await readHome(page)
    check(home.cards.length === 3, `critère 1 : ${home.cards.length} carte(s) de campagne au lieu de 3`)
    check(home.cards.filter((card) => card.available === 'true').length === 1,
      'critère 1 : la campagne principale n\'est pas la seule ouvrable')
    check(home.badges.length === 2,
      `critère 1 : ${home.badges.length} mention(s) « bientôt disponible » au lieu de 2`)
    check(home.badges.every((badge) => badge.text === fr['campaign.soon']),
      `critère 1 : mentions ${home.badges.map((badge) => `« ${badge.text} »`).join(', ')} au lieu de « ${fr['campaign.soon']} »`)
    check(home.badges.every((badge) => badge.visible),
      'critère 1 : une mention « bientôt disponible » n\'est pas affichée')

    const [first, ...rest] = home.cards
    check(Boolean(first) && rest.every((card) => Math.abs(card.x - first.x) <= 1),
      `critère 1 : cartes non alignées en colonne (x = ${home.cards.map((card) => card.x.toFixed(0)).join(', ')})`)
    check(rest.every((card, index) => card.y > home.cards[index].y),
      `critère 1 : cartes non empilées dans l'ordre (y = ${home.cards.map((card) => card.y.toFixed(0)).join(', ')})`)
    check(home.cards.every((card) => card.x >= 0 && card.x + card.width <= home.viewport + 0.5),
      `critère 1 : une carte dépasse la largeur de l'écran (${home.viewport} px)`)
    check(home.docScrollWidth <= home.viewport,
      `critère 1 : défilement horizontal à l'accueil (${home.docScrollWidth} > ${home.viewport})`)
    check(home.homeScrollWidth <= home.viewport,
      `critère 1 : l'accueil déborde en largeur (${home.homeScrollWidth} > ${home.viewport})`)

    await shot(page, 'epic-47-c1-home')
  } catch (error) {
    failures.push(error.message)
  }

  // -------------------------------------------------------------------------
  // Critère 2 — un clic sur une campagne « bientôt disponible » ne change ni
  // l'écran ni l'état du jeu : la boucle continue, rien ne se lance, le badge reste.
  // -------------------------------------------------------------------------
  try {
    await load('?lang=fr')
    await purgeProgress(page)
    await load('?lang=fr')
    await setViewport(page, MOBILE)
    const before = await state()
    await shot(page, 'epic-47-c2-avant')

    const locked = page.locator('[data-campaign][data-available="false"]')
    const count = await locked.count()
    check(count === 2, `critère 2 : ${count} campagne(s) verrouillée(s) à cliquer au lieu de 2`)
    for (let index = 0; index < count; index++) {
      await locked.nth(index).click()
    }
    await nextFrames(page, 3)
    const after = await state()
    await shot(page, 'epic-47-c2-apres')

    check(after.screen === before.screen && after.screen === 'home',
      `critère 2 : l'écran est passé à « ${after.screen} »`)
    check(!('level' in after), 'critère 2 : state.level est apparu après le clic')
    check(after.frames > before.frames,
      `critère 2 : la boucle de jeu s'est arrêtée (${after.frames} frames après ${before.frames})`)

    const home = await readHome(page)
    check(home.selects === 0, 'critère 2 : la liste des jardins s\'est ouverte depuis une campagne verrouillée')
    check(home.cards.length === 3, `critère 2 : ${home.cards.length} carte(s) après le clic au lieu de 3`)
    check(home.badges.length === 2 && home.badges.every((badge) => badge.visible && badge.text === fr['campaign.soon']),
      'critère 2 : la mention « bientôt disponible » n\'est plus affichée après le clic')
  } catch (error) {
    failures.push(error.message)
  }

  // -------------------------------------------------------------------------
  // Critère 3 — la campagne principale ouvre sa liste : six jardins nommés,
  // seul le premier accessible au premier lancement.
  // -------------------------------------------------------------------------
  try {
    await load('?lang=fr')
    await purgeProgress(page)
    await load('?lang=fr')
    await setViewport(page, MOBILE)
    await openCampaign(page)
    await page.waitForTimeout(400) // fin de l'apparition des six lignes (300 ms)

    const current = await state()
    check(current.screen === 'levels', `critère 3 : écran « ${current.screen} » au lieu de « levels »`)
    check(current.campaign === 'seveclaire', `critère 3 : campagne « ${current.campaign} » au lieu de seveclaire`)

    const rows = await readRows(page)
    const expected = [1, 2, 3, 4, 5, 6].map((n) => `niveau-${n}`)
    check(rows.length === 6, `critère 3 : ${rows.length} ligne(s) de jardin au lieu de 6`)
    check(JSON.stringify(rows.map((row) => row.id)) === JSON.stringify(expected),
      `critère 3 : jardins ${rows.map((row) => row.id).join(', ')} au lieu de ${expected.join(', ')}`)
    check(rows.every((row, index) => row.name === fr[`campaign.seveclaire.level.${index + 1}.name`]),
      `critère 3 : noms ${rows.map((row) => `« ${row.name} »`).join(', ')}`)
    const unlocked = rows.filter((row) => !row.locked)
    check(unlocked.length === 1 && unlocked[0].id === 'niveau-1',
      `critère 3 : jardins accessibles au premier lancement = ${unlocked.map((row) => row.id).join(', ') || 'aucun'}`)

    await shot(page, 'epic-47-c3-liste')
  } catch (error) {
    failures.push(error.message)
  }

  // -------------------------------------------------------------------------
  // Critère 4 — la difficulté choisie avant le lancement devient l'état de la
  // partie : `easy`/0.75 puis, pour le même jardin, `hard`/1.5.
  // -------------------------------------------------------------------------
  try {
    await load('?lang=fr')
    await purgeProgress(page)
    await load('?lang=fr')
    await setViewport(page, MOBILE)

    await openCampaign(page)
    await page.click('[data-level="niveau-1"]')
    await page.click('[data-difficulty="easy"]')
    await page.click('[data-action="start"]')
    await waitScreen(page, 'game')
    await nextFrames(page, 3)
    const easy = await state()
    check(easy.difficulty === 'easy', `critère 4 : difficulty « ${easy.difficulty} » au lieu de « easy »`)
    check(easy.waveMultiplier === 0.75,
      `critère 4 : waveMultiplier ${easy.waveMultiplier} au lieu de 0.75`)
    check(easy.level?.id === 'niveau-1', `critère 4 : jardin « ${easy.level?.id} » au lieu de niveau-1`)
    await shot(page, 'epic-47-c4-easy')

    await page.click('[data-action="back"]')
    await waitScreen(page, 'home')
    await openCampaign(page)
    await page.click('[data-level="niveau-1"]')
    await page.click('[data-difficulty="hard"]')
    await page.click('[data-action="start"]')
    await waitScreen(page, 'game')
    await nextFrames(page, 3)
    const hard = await state()
    check(hard.difficulty === 'hard', `critère 4 : difficulty « ${hard.difficulty} » au lieu de « hard »`)
    check(hard.waveMultiplier === 1.5,
      `critère 4 : waveMultiplier ${hard.waveMultiplier} au lieu de 1.5`)
    check(hard.level?.id === 'niveau-1', `critère 4 : jardin « ${hard.level?.id} » au lieu de niveau-1`)
    await shot(page, 'epic-47-c4-hard')
  } catch (error) {
    failures.push(error.message)
  }

  // -------------------------------------------------------------------------
  // Critère 5 — terminer le jardin 1 écrit la progression dans localStorage :
  // après retour à l'accueil puis rechargement, le jardin 2 est débloqué et le
  // jardin 1 reste marqué terminé.
  // -------------------------------------------------------------------------
  try {
    await load('?lang=fr')
    await purgeProgress(page)
    await load('?niveau=1&lang=fr')
    check((await state()).screen === 'game', 'critère 5 : le lancement direct ?niveau=1 n\'ouvre pas le jeu')

    const saved = await page.evaluate(() => window.__game.completeLevel())
    check(Array.isArray(saved?.completed) && saved.completed.includes('niveau-1'),
      `critère 5 : completeLevel() renvoie ${JSON.stringify(saved?.completed)}`)

    const stored = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY)
    let parsed = null
    try { parsed = stored ? JSON.parse(stored) : null } catch { parsed = null }
    check(parsed?.version === 1 && Array.isArray(parsed.completed) && parsed.completed.includes('niveau-1'),
      `critère 5 : localStorage « ${STORAGE_KEY} » = ${stored}`)

    await page.click('[data-action="back"]')
    await waitScreen(page, 'home')
    await nextFrames(page, 2)
    const home = await state()
    check(home.progress.completed.includes('niveau-1'),
      `critère 5 : progression perdue au retour à l'accueil (${JSON.stringify(home.progress.completed)})`)

    await load('?lang=fr')
    await nextFrames(page, 2)
    const reloaded = await state()
    check(reloaded.screen === 'home', `critère 5 : écran « ${reloaded.screen} » après rechargement`)
    check(reloaded.progress.completed.includes('niveau-1'),
      `critère 5 : progression absente après rechargement (${JSON.stringify(reloaded.progress.completed)})`)

    await openCampaign(page)
    await page.waitForTimeout(400)
    const rows = await readRows(page)
    const first = rows.find((row) => row.id === 'niveau-1')
    const second = rows.find((row) => row.id === 'niveau-2')
    check(Boolean(first) && first.done, 'critère 5 : niveau-1 n\'est pas marqué terminé (.is-done)')
    check(Boolean(first) && !first.locked, 'critère 5 : niveau-1 est verrouillé après sa réussite')
    check(Boolean(second) && !second.locked, 'critère 5 : niveau-2 n\'est pas débloqué après le niveau 1')
    check(rows.filter((row) => !row.locked).length === 2,
      `critère 5 : ${rows.filter((row) => !row.locked).length} jardin(s) accessible(s) au lieu de 2`)
    check(second?.state === fr['levels.done'] || second?.state === '',
      `critère 5 : mention inattendue sur niveau-2 « ${second?.state} »`)

    await shot(page, 'epic-47-c5-reprise')
  } catch (error) {
    failures.push(error.message)
  }

  // -------------------------------------------------------------------------
  // Critère 6 — en jeu, « Retour » ramène à l'accueil sans rechargement et sans
  // perdre la progression ; en FR comme en EN, aucun texte d'interface en dur,
  // et les deux dictionnaires exposent exactement les mêmes clés.
  // -------------------------------------------------------------------------
  try {
    const sameKeys = JSON.stringify(Object.keys(fr).sort()) === JSON.stringify(Object.keys(en).sort())
    check(sameKeys, 'critère 6 : fr.json et en.json n\'ont pas les mêmes clés')

    for (const [lang, dict] of [['fr', fr], ['en', en]]) {
      await load(`?lang=${lang}`)
      await nextFrames(page, 2)
      const documentLang = await page.evaluate(() => document.documentElement.lang)
      check(documentLang === lang, `critère 6 : <html lang> = « ${documentLang} » au lieu de « ${lang} »`)

      const title = await page.evaluate(() => document.querySelector('.home__title')?.textContent.trim() ?? '')
      const subtitle = await page.evaluate(() => document.querySelector('.home__subtitle')?.textContent.trim() ?? '')
      check(title === dict['home.title'], `critère 6 : titre d'accueil ${lang} « ${title} »`)
      check(subtitle === dict['home.subtitle'], `critère 6 : sous-titre d'accueil ${lang} « ${subtitle} »`)

      const homeTexts = await readTexts(page)
      check(homeTexts.length >= 5,
        `critère 6 : seulement ${homeTexts.length} texte(s) relevé(s) à l'accueil en ${lang}, contrôle inexploitable`)
      check(homeTexts.includes(dict['campaign.seveclaire.name']) && homeTexts.includes(dict['campaign.soon']),
        `critère 6 : les noms de campagne et le badge ne sont pas en ${lang}`)
      const homeHardcoded = hardcodedTexts(homeTexts, dict)
      check(homeHardcoded.length === 0,
        `critère 6 : texte en dur à l'accueil en ${lang} : ${homeHardcoded.join(' / ')}`)

      await openCampaign(page)
      await page.waitForTimeout(400)
      const levelTexts = await readTexts(page)
      check(levelTexts.length >= 10,
        `critère 6 : seulement ${levelTexts.length} texte(s) relevé(s) dans la liste en ${lang}, contrôle inexploitable`)
      check(levelTexts.includes(dict['levels.title']) && levelTexts.includes(dict['difficulty.easy.name']),
        `critère 6 : la liste et les difficultés ne sont pas en ${lang}`)
      const levelHardcoded = hardcodedTexts(levelTexts, dict)
      check(levelHardcoded.length === 0,
        `critère 6 : texte en dur dans la liste en ${lang} : ${levelHardcoded.join(' / ')}`)
      const difficultyNames = await page.evaluate(() => [...document.querySelectorAll('.difficulty__option')]
        .map((option) => option.dataset.difficulty))
      check(JSON.stringify(difficultyNames) === JSON.stringify(['easy', 'medium', 'hard']),
        `critère 6 : difficultés ${difficultyNames.join(', ')} dans la liste`)

      if (lang === 'en') await shot(page, 'epic-47-c6-en')
    }

    // Retour en jeu : aucun rechargement (événement load et timeOrigin inchangés),
    // la boucle continue et la progression enregistrée reste intacte.
    await load('?lang=fr')
    await purgeProgress(page)
    await load('?niveau=1&lang=fr')
    const before = await state()
    check(before.screen === 'game', `critère 6 : écran « ${before.screen} » avant le retour`)
    await page.evaluate(() => window.__game.completeLevel())
    const originBefore = await page.evaluate(() => performance.timeOrigin)

    let reloads = 0
    const onLoad = () => { reloads++ }
    page.on('load', onLoad)
    await page.click('[data-action="back"]')
    await waitScreen(page, 'home')
    await nextFrames(page, 3)
    page.off('load', onLoad)

    const after = await state()
    const originAfter = await page.evaluate(() => performance.timeOrigin)
    check(reloads === 0, `critère 6 : ${reloads} rechargement(s) de page pendant « Retour »`)
    check(originAfter === originBefore, 'critère 6 : timeOrigin a changé, la page a été rechargée')
    check(after.screen === 'home', `critère 6 : écran « ${after.screen} » après « Retour »`)
    check(after.frames > before.frames,
      `critère 6 : la boucle s'est arrêtée après « Retour » (${after.frames} frames après ${before.frames})`)
    check(after.progress.completed.includes('niveau-1'),
      `critère 6 : progression perdue après « Retour » (${JSON.stringify(after.progress.completed)})`)
  } catch (error) {
    failures.push(error.message)
  }

  // -------------------------------------------------------------------------
  // Budget de rendu — 1280×720 et 390×844 : draw calls et triangles sous le
  // budget, scène non vide. Les erreurs console sont vérifiées par le runner.
  // -------------------------------------------------------------------------
  try {
    await load('?niveau=1&lang=fr')
    await setViewport(page, DESKTOP)
    await nextFrames(page, 5)
    const desktop = await state()
    check(desktop.render.drawCalls > 0 && desktop.render.triangles > 0,
      'budget : scène vide, mesure de rendu inexploitable')
    check(desktop.render.drawCalls <= BUDGET.drawCalls,
      `budget 1280×720 : ${desktop.render.drawCalls} draw calls > ${BUDGET.drawCalls}`)
    check(desktop.render.triangles <= BUDGET.triangles,
      `budget 1280×720 : ${desktop.render.triangles} triangles > ${BUDGET.triangles}`)
    await shot(page, 'epic-47-c7-budget-desktop')

    await setViewport(page, MOBILE)
    await nextFrames(page, 5)
    const mobile = await state()
    check(mobile.render.drawCalls > 0 && mobile.render.triangles > 0,
      'budget : scène vide en 390×844, mesure inexploitable')
    check(mobile.render.drawCalls <= BUDGET.drawCalls,
      `budget 390×844 : ${mobile.render.drawCalls} draw calls > ${BUDGET.drawCalls}`)
    check(mobile.render.triangles <= BUDGET.triangles,
      `budget 390×844 : ${mobile.render.triangles} triangles > ${BUDGET.triangles}`)
    await shot(page, 'epic-47-c7-budget-mobile')
  } catch (error) {
    failures.push(error.message)
  }

  if (failures.length) throw new Error(failures.join(' | '))
}
