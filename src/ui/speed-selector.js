import { t } from '../i18n/index.js'

const SPEEDS = [1, 2, 3]
// Pavé numérique : la touche affichée suit Verr. Num, le code physique reste stable.
const NUMPAD = { Numpad1: 1, Numpad2: 2, Numpad3: 3 }

/** Multiplicateur borné à [1, 3] ; une valeur non numérique est ignorée (`null`). */
function normalizeSpeed(value) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(3, Math.max(1, Math.round(n))) : null
}

/**
 * Sélecteur de vitesse ×1/×2/×3 : pastille ronde en haut à droite, trois cibles de
 * 44 × 44 px, l'entrée active pleine (menthe + liseré d'encre), jamais signalée par la
 * seule teinte.
 * Purement présentation : le multiplicateur appliqué au jeu n'est pas décidé ici, chaque
 * choix remonte par `onSelect`. `update({ speed })` ne fait que refléter l'état reçu et
 * n'émet jamais `onSelect`, donc aucun aller-retour avec la boucle.
 * @param {HTMLElement} root
 * @param {{ onSelect?: (speed: number) => void, speed?: number }} [options]
 * @returns {{ update(state?: { speed?: number }): void, destroy(): void }}
 */
export function createSpeedSelector(root, { onSelect, speed = 1 } = {}) {
  let current = normalizeSpeed(speed) ?? 1

  const el = document.createElement('div')
  el.className = 'speed-selector'
  el.setAttribute('role', 'group')
  el.setAttribute('aria-label', t('hud.speed.label'))

  /** @type {Map<number, HTMLButtonElement>} */
  const buttons = new Map()

  for (const value of SPEEDS) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'speed-selector__button'
    button.dataset.speed = String(value)
    // Clés littérales : `scripts/i18n-check.mjs` relie chaque clé à son usage.
    button.textContent = t('hud.speed.value', { value })
    button.setAttribute('aria-label', t('hud.speed.aria', { value }))
    // Infobulle utile au survol : la pastille, transparente aux pointeurs, n'en porte pas.
    button.title = t('hud.speed.title')
    button.setAttribute('aria-pressed', 'false')
    buttons.set(value, button)
    el.append(button)
  }

  /** État peint en place (attributs) : pas de re-render du DOM. */
  function render() {
    for (const [value, button] of buttons) {
      const pressed = String(value === current)
      if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed)
    }
    el.dataset.activeSpeed = String(current)
  }

  /**
   * Choix du joueur : l'entrée se marque tout de suite (retour immédiat, tactile compris),
   * puis l'état réel du jeu peut confirmer par `update` sans nouvelle émission.
   * @param {number} value
   */
  function select(value) {
    const next = normalizeSpeed(value)
    if (next === null) return
    if (next !== current) {
      current = next
      render()
    }
    onSelect?.(next)
  }

  /** @param {Event} event */
  function handlePointerDown(event) {
    const button = event.currentTarget
    if (!(button instanceof HTMLElement)) return
    select(Number(button.dataset.speed))
  }

  // Clavier natif (Entrée / Espace) : le navigateur émet un `click` de détail 0. Les
  // clics pointeur (détail ≥ 1) sont déjà traités par `pointerdown` : aucun doublon,
  // ni souris, ni tactile.
  /** @param {MouseEvent} event */
  function handleClick(event) {
    if (event.detail !== 0) return
    const button = event.currentTarget
    if (!(button instanceof HTMLElement)) return
    select(Number(button.dataset.speed))
  }

  /** Raccourcis 1/2/3, ignorés dès qu'un champ de saisie a le focus. */
  function handleKeyDown(event) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
    const target = event.target
    if (target instanceof HTMLElement
      && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
    const typed = Number(event.key)
    const speed = SPEEDS.includes(typed) ? typed : NUMPAD[event.code]
    if (!SPEEDS.includes(speed)) return
    select(speed)
  }

  for (const button of buttons.values()) {
    button.addEventListener('pointerdown', handlePointerDown)
    button.addEventListener('click', handleClick)
  }
  // Sur `window` (phase de capture) : le choix reste valable quel que soit l'élément actif.
  window.addEventListener('keydown', handleKeyDown, true)

  root.append(el)
  render()

  return {
    /** @param {{ speed?: number }} [state] */
    update(state = {}) {
      if (!state || typeof state !== 'object' || !('speed' in state)) return
      const next = normalizeSpeed(state.speed)
      if (next === null || next === current) return
      current = next
      render()
    },
    destroy() {
      for (const button of buttons.values()) {
        button.removeEventListener('pointerdown', handlePointerDown)
        button.removeEventListener('click', handleClick)
      }
      window.removeEventListener('keydown', handleKeyDown, true)
      el.remove()
    },
  }
}
