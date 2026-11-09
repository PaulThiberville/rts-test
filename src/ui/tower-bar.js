import { t } from '../i18n/index.js'

let barCount = 0

/**
 * Barre de tours-plantes : choix du type, prix et amélioration de la tour sélectionnée.
 * Purement présentation : toute décision de gameplay remonte par les callbacks.
 * `update` ignore les champs absents pour accepter un état partiel.
 * @param {HTMLElement} root
 * @param {{ towers?: object, onSelect?: (id: string) => void, onUpgrade?: (id: number|string) => void, onToggle?: () => void }} [options]
 * @returns {{ update(state?: object): void, destroy(): void }}
 */
export function createTowerBar(root, { towers = {}, onSelect, onUpgrade, onToggle } = {}) {
  const panelId = `tower-bar-panel-${++barCount}`
  const span = (className, text) => {
    const node = document.createElement('span')
    node.className = className
    node.textContent = text ?? ''
    return node
  }

  const el = document.createElement('section')
  el.className = 'tower-bar'
  el.dataset.open = 'false'
  el.setAttribute('role', 'group')
  el.setAttribute('aria-label', t('tower.bar.label'))

  const panel = document.createElement('div')
  panel.className = 'tower-bar__panel'
  panel.id = panelId
  panel.inert = true
  panel.setAttribute('aria-hidden', 'true')

  const list = document.createElement('div')
  list.className = 'tower-bar__list'
  /** @type {Map<string, HTMLButtonElement>} */
  const entries = new Map()

  for (const tower of Object.values(towers)) {
    if (!tower?.id) continue
    const entry = document.createElement('button')
    entry.type = 'button'
    entry.className = 'tower-bar__entry'
    entry.dataset.tower = tower.id
    entry.dataset.cost = String(tower.cost)
    entry.setAttribute('aria-pressed', 'false')
    entry.append(
      span('tower-bar__entry-name', t(tower.nameKey)),
      span('tower-bar__entry-cost', t('tower.price', { n: tower.cost })),
    )
    entry.addEventListener('click', () => onSelect?.(tower.id))
    entries.set(String(tower.id), entry)
    list.append(entry)
  }

  const selection = document.createElement('div')
  selection.className = 'tower-bar__selection'
  selection.hidden = true
  const info = document.createElement('div')
  info.className = 'tower-bar__info'
  const level = span('tower-bar__level')
  const price = span('tower-bar__price')
  const upgrade = document.createElement('button')
  upgrade.type = 'button'
  upgrade.className = 'tower-bar__upgrade'
  upgrade.textContent = t('tower.upgrade')
  info.append(level, price)

  const handle = document.createElement('button')
  handle.type = 'button'
  handle.className = 'tower-bar__handle'
  handle.id = `${panelId}-handle`
  // Poignée 60×44 : libellé visible puis chevron (dessiné en CSS) qui indique le sens d'ouverture.
  handle.append(span('tower-bar__handle-label', t('tower.bar.toggle')))
  handle.title = t('tower.bar.toggle')
  handle.setAttribute('aria-controls', panelId)
  handle.setAttribute('aria-expanded', 'false')
  panel.setAttribute('aria-labelledby', handle.id)

  selection.append(info, upgrade)
  panel.append(list, selection)
  el.append(panel, handle)
  root.append(el)

  let lastType
  let selectedRef = null
  /** @type {Array<object>} */
  let towerList = []
  let resources = 0

  /** @param {HTMLElement} node @param {string} value */
  function setText(node, value) {
    if (node.textContent !== value) node.textContent = value
  }

  /** @param {boolean} next */
  function setOpen(next) {
    const value = Boolean(next)
    if (value === (el.dataset.open === 'true')) return
    el.dataset.open = String(value)
    handle.setAttribute('aria-expanded', String(value))
    panel.inert = !value
    if (value) panel.removeAttribute('aria-hidden')
    else {
      panel.setAttribute('aria-hidden', 'true')
      if (panel.contains(document.activeElement)) handle.focus()
    }
  }

  /** @param {string|null|undefined} next */
  function setPressed(next) {
    const type = next == null ? null : String(next)
    if (type === lastType) return
    lastType = type
    for (const [id, entry] of entries) entry.setAttribute('aria-pressed', String(id === type))
  }

  function renderSelection() {
    // `selectedTower` est soit une instance (état des tours posées), soit l'id du
    // catalogue (contrat de `onUpgrade`) : dans ce dernier cas, on replie sur le catalogue.
    const instance = selectedRef && typeof selectedRef === 'object'
      ? selectedRef
      : towerList.find((item) => item && String(item.id) === String(selectedRef)) ?? null
    const catalog = instance
      ? towers[instance.type] ?? towers[instance.id]
      : selectedRef == null ? null : towers[String(selectedRef)]
    const shown = Boolean(catalog)
    if (selection.hidden !== !shown) selection.hidden = !shown
    // La liste cède la rangée au panneau de sélection : une seule rangée de 44 px.
    if (list.hidden !== shown) list.hidden = shown
    if (!shown) return

    const levelNumber = Math.max(1, Number(instance?.level) || 1)
    setText(level, t('tower.level', { n: levelNumber }))
    setText(price, t('tower.price', { n: catalog.upgradeCost }))
    const disabled = resources < catalog.upgradeCost || levelNumber >= catalog.maxLevel
    if (upgrade.disabled !== disabled) upgrade.disabled = disabled
  }

  upgrade.addEventListener('click', () => {
    if (selectedRef != null) onUpgrade?.(selectedRef)
  })
  handle.addEventListener('click', () => onToggle?.())

  return {
    /** @param {object} [state] */
    update(state = {}) {
      const bar = state.towerBar
      if (bar && typeof bar === 'object') {
        if ('open' in bar) setOpen(bar.open)
        if ('selectedType' in bar) setPressed(bar.selectedType)
      }
      if ('towers' in state) towerList = Array.isArray(state.towers) ? state.towers : []
      if ('selectedTower' in state) selectedRef = state.selectedTower
      if ('resources' in state) {
        const value = Number(state.resources)
        resources = Number.isFinite(value) ? value : 0
      }
      if ('selectedTower' in state || 'resources' in state || 'towers' in state) renderSelection()
    },
    destroy() {
      el.remove()
      entries.clear()
    },
  }
}
