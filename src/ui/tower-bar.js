import { createIcon } from '../art/icons.js'
import { TOWERS } from '../data/towers.js'
import { t } from '../i18n/index.js'

/**
 * Barre de tours-plantes : choix du type, prix et amélioration de la tour
 * sélectionnée, toujours visible en bas à gauche. Une seule surface continue :
 * les entrées sont séparées par un filet discret, jamais par un aplat clair.
 * Purement présentation : toute décision de gameplay remonte par les callbacks.
 * `update` ignore les champs absents pour accepter un état partiel.
 * @param {HTMLElement} root
 * @param {{ towers?: object, onSelect?: (id: string) => void, onUpgrade?: (id: number|string) => void }} [options]
 * @returns {{ update(state?: object): void, destroy(): void }}
 */
export function createTowerBar(root, { towers = {}, onSelect, onUpgrade } = {}) {
  // Vitrine : `npm run showcase` passe l'état du jeu comme options, sans catalogue.
  // La barre montre alors le catalogue réel, jamais une rangée vide.
  const catalog = Object.keys(towers).length ? towers : TOWERS
  const span = (className, text) => {
    const node = document.createElement('span')
    node.className = className
    node.textContent = text ?? ''
    return node
  }

  const el = document.createElement('section')
  el.className = 'tower-bar'
  el.dataset.open = 'true'
  el.setAttribute('role', 'group')
  el.setAttribute('aria-label', t('tower.bar.label'))

  const panel = document.createElement('div')
  panel.className = 'tower-bar__panel'

  const list = document.createElement('div')
  list.className = 'tower-bar__list'
  /** @type {Map<string, HTMLButtonElement>} */
  const entries = new Map()

  for (const tower of Object.values(catalog)) {
    if (!tower?.id) continue
    const entry = document.createElement('button')
    entry.type = 'button'
    entry.className = 'tower-bar__entry'
    entry.dataset.tower = tower.id
    entry.dataset.cost = String(tower.cost)
    entry.setAttribute('aria-pressed', 'false')
    // Graine décorative : le nom du type reste le nom accessible de l'entrée.
    entry.append(
      createIcon('seed', { size: 18, className: 'tower-bar__entry-icon' }),
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
  upgrade.append(
    createIcon('upgrade', { size: 16, className: 'tower-bar__upgrade-icon' }),
    span('tower-bar__upgrade-label', t('tower.upgrade')),
  )
  info.append(level, price)

  selection.append(info, upgrade)
  panel.append(list, selection)
  el.append(panel)
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
    const catalogEntry = instance
      ? catalog[instance.type] ?? catalog[instance.id]
      : selectedRef == null ? null : catalog[String(selectedRef)]
    const shown = Boolean(catalogEntry)
    if (selection.hidden !== !shown) selection.hidden = !shown
    // La liste cède la rangée au panneau de sélection : une seule rangée continue.
    if (list.hidden !== shown) list.hidden = shown
    if (!shown) return

    const levelNumber = Math.max(1, Number(instance?.level) || 1)
    setText(level, t('tower.level', { n: levelNumber }))
    setText(price, t('tower.price', { n: catalogEntry.upgradeCost }))
    const disabled = resources < catalogEntry.upgradeCost || levelNumber >= catalogEntry.maxLevel
    if (upgrade.disabled !== disabled) upgrade.disabled = disabled
  }

  upgrade.addEventListener('click', () => {
    if (selectedRef != null) onUpgrade?.(selectedRef)
  })

  return {
    /** @param {object} [state] */
    update(state = {}) {
      const bar = state.towerBar
      if (bar && typeof bar === 'object' && 'selectedType' in bar) setPressed(bar.selectedType)
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
