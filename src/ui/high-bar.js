import { createIcon } from '../art/icons.js'
import { t } from '../i18n/index.js'

/**
 * Sève de départ du niveau 1 (`LEVEL_1.startingResources`, 3 × 40) : valeur lue par
 * `createHighBar` quand le montage ne fournit pas d'état — cas de la vitrine, qui
 * monte le composant seul. En jeu, la valeur initiale vient de `state.resources`.
 */
const STARTING_RESOURCES = 120

/**
 * Sève utilisable d'une valeur d'état : entier positif ou nul, `null` si absente ou illisible.
 * @param {unknown} value
 * @returns {number|null}
 */
function readResources(value) {
  if (value == null || value === '') return null
  const amount = Number(value)
  return Number.isFinite(amount) ? Math.max(0, Math.trunc(amount)) : null
}

/**
 * Barre haute du niveau : le retour aux jardins à gauche, le compteur de sève à
 * droite, sur une bande ancrée en haut de l'écran. Le retour vit uniquement ici :
 * le HUD du niveau ne porte aucun bouton flottant.
 * Purement présentation : la décision de sortie remonte par `onBack`.
 * `state` porte l'état du jeu au montage : la sève initiale sort de `state.resources`,
 * à défaut de quoi la barre affiche la sève de départ du niveau 1.
 * `update` ignore les champs absents et ne réécrit le compteur que s'il change.
 * @param {HTMLElement} root
 * @param {{ onBack?: () => void, state?: { resources?: number } }} [options]
 * @returns {{ update(state?: object): void, destroy(): void }}
 */
export function createHighBar(root, { onBack, state } = {}) {
  const el = document.createElement('header')
  el.className = 'high-bar'

  const back = document.createElement('button')
  back.type = 'button'
  back.className = 'high-bar__back'
  back.dataset.action = 'back'
  // L'icône est décorative : c'est le libellé localisé qui nomme le bouton.
  const backLabel = document.createElement('span')
  backLabel.className = 'high-bar__back-label'
  backLabel.textContent = t('game.back')
  back.append(createIcon('back', { size: 20, className: 'high-bar__back-icon' }), backLabel)

  const sap = document.createElement('span')
  sap.className = 'high-bar__sap'
  sap.setAttribute('aria-live', 'polite')
  // Infobulle discrète : le compteur reste « 120 sève », le nom accessible inchangé.
  sap.title = t('hud.sap.label')
  const sapValue = document.createElement('span')
  sapValue.className = 'high-bar__sap-value'

  /** Sève affichée : celle de l'état de montage, sinon celle du départ du niveau 1. */
  let resources = readResources(state?.resources) ?? STARTING_RESOURCES
  sapValue.textContent = t('hud.sap', { n: resources })
  sap.append(createIcon('sap', { size: 20, className: 'high-bar__sap-icon' }), sapValue)

  el.append(back, sap)
  root.append(el)

  /** @param {HTMLElement} node @param {string} value */
  function setText(node, value) {
    if (node.textContent !== value) node.textContent = value
  }

  function handleBack() {
    onBack?.()
  }
  back.addEventListener('click', handleBack)

  return {
    /** @param {object} [state] */
    update(state = {}) {
      if (!state || typeof state !== 'object' || !('resources' in state)) return
      const next = readResources(state.resources)
      if (next === null || next === resources) return
      resources = next
      setText(sapValue, t('hud.sap', { n: next }))
    },
    destroy() {
      back.removeEventListener('click', handleBack)
      el.remove()
    },
  }
}
