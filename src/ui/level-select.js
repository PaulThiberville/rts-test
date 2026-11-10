import { t } from '../i18n/index.js'
import { CAMPAIGNS } from '../data/campaigns.js'
import { DIFFICULTIES } from '../data/difficulties.js'

let selectCount = 0

/** Liste ou Set → Set d'ids, sans jamais exposer la collection reçue. */
function toIdSet(value) {
  if (value instanceof Set) return new Set(value)
  return new Set(Array.isArray(value) ? value : [])
}

/**
 * Écran de choix du jardin : six lignes, verrous lisibles et trois difficultés.
 * Purement présentation : la progression arrive par `update`, le lancement remonte par `onStart`.
 * `update({ progress, difficulty })` rafraîchit les états sans reconstruire le DOM.
 * @param {HTMLElement} root
 * @param {{
 *   campaign?: object,
 *   difficulties?: Array<{ id: string, nameKey: string }>,
 *   onStart?: (levelId: string, difficultyId: string) => void,
 *   onBack?: () => void,
 * }} [options]
 * @returns {{ element: HTMLElement, update(state?: object): void, destroy(): void }}
 */
export function createLevelSelect(root, {
  campaign = CAMPAIGNS[0],
  difficulties = DIFFICULTIES,
  onStart,
  onBack,
} = {}) {
  const count = ++selectCount
  const titleId = `level-select-title-${count}`
  const paceId = `level-select-pace-${count}`
  const controller = new AbortController()
  const { signal } = controller
  const levels = Array.isArray(campaign?.levels) ? campaign.levels : []
  const profiles = Array.isArray(difficulties) ? difficulties : []

  const el = document.createElement('section')
  el.className = 'level-select'
  el.setAttribute('aria-labelledby', titleId)

  const inner = document.createElement('div')
  inner.className = 'level-select__inner'

  const header = document.createElement('header')
  header.className = 'level-select__header'

  const mark = document.createElement('span')
  mark.className = 'level-select__mark'
  mark.setAttribute('aria-hidden', 'true')

  const eyebrow = document.createElement('p')
  eyebrow.className = 'level-select__eyebrow'
  eyebrow.textContent = campaign?.nameKey ? t(campaign.nameKey) : ''

  const title = document.createElement('h1')
  title.className = 'level-select__title'
  title.id = titleId
  title.textContent = t('levels.title')

  header.append(mark, eyebrow, title)

  const list = document.createElement('div')
  list.className = 'level-select__levels'

  /** @type {Array<{ level: object, index: number, row: HTMLButtonElement, state: HTMLElement }>} */
  const entries = []

  levels.forEach((level, index) => {
    if (!level?.id) return
    const row = document.createElement('button')
    row.type = 'button'
    row.className = 'level-row'
    row.dataset.level = level.id
    row.setAttribute('aria-pressed', 'false')

    const number = document.createElement('span')
    number.className = 'level-row__index'
    number.setAttribute('aria-hidden', 'true')
    number.textContent = String(index + 1)

    const body = document.createElement('span')
    body.className = 'level-row__body'

    const name = document.createElement('span')
    name.className = 'level-row__name'
    name.textContent = t(level.nameKey)

    const state = document.createElement('span')
    state.className = 'level-row__state'
    state.hidden = true

    const badge = document.createElement('span')
    badge.className = 'level-row__badge'
    badge.setAttribute('aria-hidden', 'true')

    body.append(name, state)
    row.append(number, body, badge)
    row.addEventListener('click', () => {
      // Verrouillé : le clic ne sélectionne rien, `onStart` ne pourra jamais partir d'ici.
      if (!unlocked.has(level.id)) return
      selectedId = level.id
      renderRows()
      renderStart()
    }, { signal })
    list.append(row)
    entries.push({ level, index, row, state })
  })

  const pace = document.createElement('section')
  pace.className = 'difficulty'
  pace.setAttribute('aria-labelledby', paceId)

  const paceTitle = document.createElement('h2')
  paceTitle.className = 'difficulty__title'
  paceTitle.id = paceId
  paceTitle.textContent = t('difficulty.title')

  const options = document.createElement('div')
  options.className = 'difficulty__options'
  options.setAttribute('role', 'group')
  options.setAttribute('aria-labelledby', paceId)

  /** @type {Map<string, HTMLButtonElement>} */
  const difficultyButtons = new Map()

  for (const profile of profiles) {
    if (!profile?.id) continue
    const id = String(profile.id)
    const option = document.createElement('button')
    option.type = 'button'
    option.className = 'difficulty__option'
    option.dataset.difficulty = id
    option.setAttribute('aria-pressed', 'false')

    const name = document.createElement('span')
    name.className = 'difficulty__name'
    name.textContent = t(profile.nameKey)

    const descriptionKey = `difficulty.${id}.desc`
    const description = document.createElement('span')
    description.className = 'difficulty__desc'
    const descriptionText = t(descriptionKey)
    description.textContent = descriptionText === descriptionKey ? '' : descriptionText
    if (!description.textContent) description.hidden = true

    option.append(name, description)
    option.addEventListener('click', () => setDifficulty(id), { signal })
    difficultyButtons.set(id, option)
    options.append(option)
  }

  pace.append(paceTitle, options)

  const actions = document.createElement('div')
  actions.className = 'level-select__actions'

  const back = document.createElement('button')
  back.type = 'button'
  back.className = 'level-select__button level-select__button--back'
  back.dataset.action = 'back'
  back.textContent = t('game.back')
  back.addEventListener('click', () => onBack?.(), { signal })

  const start = document.createElement('button')
  start.type = 'button'
  start.className = 'level-select__button level-select__button--start'
  start.dataset.action = 'start'
  start.textContent = t('game.start')
  start.disabled = true
  start.addEventListener('click', () => {
    if (start.disabled || !selectedId || !difficultyId) return
    onStart?.(selectedId, difficultyId)
  }, { signal })

  actions.append(back, start)

  inner.append(header, list, pace, actions)
  el.append(inner)
  root.append(el)

  const firstId = entries[0]?.level.id ?? null
  let unlocked = new Set(firstId ? [firstId] : [])
  let completed = new Set()
  let selectedId = firstId
  let difficultyId = null

  /** @param {HTMLElement} node @param {string} value */
  function setText(node, value) {
    if (node.textContent !== value) node.textContent = value
  }

  function renderRows() {
    for (const entry of entries) {
      const { level, row, state } = entry
      const locked = !unlocked.has(level.id)
      const done = completed.has(level.id)
      const active = !locked && selectedId === level.id
      if (entry.locked !== locked) {
        entry.locked = locked
        row.classList.toggle('is-locked', locked)
        row.setAttribute('aria-disabled', String(locked))
      }
      if (entry.done !== done) {
        entry.done = done
        row.classList.toggle('is-done', done)
      }
      if (entry.active !== active) {
        entry.active = active
        row.classList.toggle('is-active', active)
        row.setAttribute('aria-pressed', String(active))
      }
      const text = locked
        ? t('levels.locked', { n: Math.max(1, entry.index) })
        : done ? t('levels.done') : ''
      setText(state, text)
      if (state.hidden !== (text === '')) state.hidden = text === ''
    }
  }

  function renderStart() {
    if (start.disabled !== (!difficultyId || !selectedId)) {
      start.disabled = !difficultyId || !selectedId
    }
  }

  function renderDifficulty() {
    for (const [id, option] of difficultyButtons) {
      const active = id === difficultyId
      if ((option.getAttribute('aria-pressed') === 'true') !== active) {
        option.classList.toggle('is-active', active)
        option.setAttribute('aria-pressed', String(active))
      }
    }
    renderStart()
  }

  /** @param {string|null|undefined} value */
  function setDifficulty(value) {
    const next = value == null ? null : String(value)
    const wanted = next && difficultyButtons.has(next) ? next : null
    if (wanted === difficultyId) return
    difficultyId = wanted
    renderDifficulty()
  }

  /** Garde une ligne sélectionnée : priorité au premier jardin débloqué non terminé. */
  function ensureSelection() {
    if (selectedId && unlocked.has(selectedId)) return
    const available = entries.filter(({ level }) => unlocked.has(level.id))
    const next = available.find(({ level }) => !completed.has(level.id)) ?? available[0]
    selectedId = next?.level.id ?? null
  }

  renderRows()
  renderDifficulty()

  return {
    element: el,
    /** @param {{ progress?: object, difficulty?: string|null }} [state] */
    update({ progress, difficulty } = {}) {
      if (progress && typeof progress === 'object') {
        if (progress.unlocked != null) unlocked = toIdSet(progress.unlocked)
        if (progress.completed != null) completed = toIdSet(progress.completed)
      }
      if (difficulty !== undefined) setDifficulty(difficulty)
      ensureSelection()
      renderRows()
      renderStart()
    },
    destroy() {
      controller.abort()
      el.remove()
      difficultyButtons.clear()
      entries.length = 0
    },
  }
}
