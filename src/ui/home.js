import { t } from '../i18n/index.js'
import { CAMPAIGNS } from '../data/campaigns.js'

let homeCount = 0

/**
 * Écran d'accueil : titre, sous-titre et une carte par campagne.
 * Sèveclaire s'ouvre par `onOpen` ; les campagnes verrouillées restent lisibles,
 * affichent « Bientôt disponible » et ne déclenchent jamais de navigation.
 * `update({ progress })` marque d'un état les cartes déjà commencées, sans reconstruire le DOM.
 * @param {HTMLElement} root
 * @param {{ campaigns?: Array<object>, onOpen?: (campaignId: string) => void }} [options]
 * @returns {{ element: HTMLElement, update(state?: object): void, destroy(): void }}
 */
export function createHomeScreen(root, { campaigns = CAMPAIGNS, onOpen } = {}) {
  const count = ++homeCount
  const titleId = `home-title-${count}`
  const controller = new AbortController()
  const { signal } = controller

  const el = document.createElement('section')
  el.className = 'home'
  el.setAttribute('aria-labelledby', titleId)

  const inner = document.createElement('div')
  inner.className = 'home__inner'

  const header = document.createElement('header')
  header.className = 'home__header'

  const mark = document.createElement('span')
  mark.className = 'home__mark'
  mark.setAttribute('aria-hidden', 'true')

  const title = document.createElement('h1')
  title.className = 'home__title'
  title.id = titleId
  title.textContent = t('home.title')

  const subtitle = document.createElement('p')
  subtitle.className = 'home__subtitle'
  subtitle.textContent = t('home.subtitle')

  header.append(mark, title, subtitle)

  const list = document.createElement('div')
  list.className = 'home__list'

  /** @type {Map<string, { card: HTMLElement, campaign: object }>} */
  const cards = new Map()

  for (const campaign of Array.isArray(campaigns) ? campaigns : []) {
    if (!campaign?.id) continue
    const available = campaign.available === true

    const card = document.createElement('article')
    card.className = 'campaign-card'
    card.dataset.campaign = campaign.id
    card.dataset.available = String(available)
    if (!available) {
      card.classList.add('is-soon')
      card.setAttribute('aria-disabled', 'true')
    }

    const name = document.createElement('h2')
    name.className = 'campaign-card__name'
    name.textContent = t(campaign.nameKey)

    const desc = document.createElement('p')
    desc.className = 'campaign-card__desc'
    desc.textContent = t(campaign.descriptionKey)

    const levels = document.createElement('p')
    levels.className = 'campaign-card__levels'
    levels.textContent = t('campaign.levels', { n: campaign.levels?.length ?? 0 })

    const footer = document.createElement('div')
    footer.className = 'campaign-card__footer'

    if (available) {
      const open = document.createElement('button')
      open.type = 'button'
      open.className = 'campaign-card__open'
      open.textContent = t('home.open')
      open.addEventListener('click', () => onOpen?.(campaign.id), { signal })
      footer.append(open)
    } else {
      const badge = document.createElement('span')
      badge.className = 'campaign-card__badge'
      badge.textContent = t('campaign.soon')
      footer.append(badge)
    }

    card.append(name, desc, levels, footer)
    list.append(card)
    cards.set(String(campaign.id), { card, campaign })
  }

  inner.append(header, list)
  el.append(inner)
  root.append(el)

  return {
    element: el,
    update({ progress } = {}) {
      const completed = progress?.completed
      const done = completed instanceof Set
        ? completed
        : new Set(Array.isArray(completed) ? completed : [])
      for (const { card, campaign } of cards.values()) {
        const progressed = (campaign.levels ?? []).some((level) => done.has(level.id))
        card.classList.toggle('is-progressed', progressed)
      }
    },
    destroy() {
      controller.abort()
      el.remove()
    },
  }
}
