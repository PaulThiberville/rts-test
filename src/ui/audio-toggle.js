import { t } from '../i18n/index.js'

const SVG_NS = 'http://www.w3.org/2000/svg'

/**
 * Libellés du bouton : clés `audio.*` de #51, référencées indirectement tant qu'elles ne
 * sont pas dans `fr.json`. `scripts/i18n-check.mjs` ne les voit donc ni utilisées ni
 * présentes : au merge de #51, remplacer cette table par des appels `t` littéraux.
 */
const LABEL = { unmuted: 'audio.mute', muted: 'audio.unmute' }

/**
 * @param {string} name
 * @param {Record<string, string>} attrs
 * @returns {SVGElement}
 */
function svg(name, attrs) {
  const node = document.createElementNS(SVG_NS, name)
  for (const key in attrs) node.setAttribute(key, attrs[key])
  return node
}

/** Volume borné à [0, 1] ; une valeur non numérique retombe sur 1 (son audible). */
function level(value) {
  const n = Number(value)
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1
}

/**
 * Bouton muet du HUD : pastille ronde de 44 × 44 px, icône son en SVG inline.
 * Purement présentation : aucun volume n'est décidé ici, chaque clic remonte par `onToggle`.
 * `update` ignore les champs absents pour accepter un état partiel.
 * @param {HTMLElement} root
 * @param {{ onToggle?: () => void }} [options]
 * @returns {{ update(state?: { muted?: boolean, volume?: number }): void, destroy(): void }}
 */
export function createAudioToggle(root, { onToggle } = {}) {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'audio-toggle'

  const icon = svg('svg', {
    class: 'audio-toggle__icon',
    viewBox: '0 0 24 24',
    width: '26',
    height: '26',
    'aria-hidden': 'true',
    focusable: 'false',
  })
  const speaker = svg('path', {
    class: 'audio-toggle__speaker',
    d: 'M11 5 6.5 9H3v6h3.5L11 19z',
  })
  const inner = svg('path', { class: 'audio-toggle__wave', d: 'M14.4 9.4a3.8 3.8 0 0 1 0 5.2' })
  const outer = svg('path', { class: 'audio-toggle__wave', d: 'M17.2 6.8a7.6 7.6 0 0 1 0 10.4' })
  // Barre peinte sous le cône : le liseré du cône la creuse sans jamais le découper.
  const slash = svg('path', { class: 'audio-toggle__slash', d: 'M2.8 2.8 19.6 19.6' })
  icon.append(slash, speaker, inner, outer)
  button.append(icon)

  let muted = false
  let volume = 1

  // État peint en place (attributs, variables CSS) : pas de re-render du DOM.
  function render() {
    const pressed = String(muted)
    if (button.dataset.muted !== pressed) button.dataset.muted = pressed
    if (button.getAttribute('aria-pressed') !== pressed) button.setAttribute('aria-pressed', pressed)
    const label = t(muted ? LABEL.muted : LABEL.unmuted)
    if (button.getAttribute('aria-label') !== label) button.setAttribute('aria-label', label)
    if (button.title !== label) button.title = label
    const next = String(level(muted ? 0 : volume))
    if (button.style.getPropertyValue('--audio-level') !== next) {
      button.style.setProperty('--audio-level', next)
    }
  }

  // Bouton natif : Entrée et Espace déclenchent `click`, aucun `keydown` maison.
  const handleClick = () => onToggle?.()
  button.addEventListener('click', handleClick)
  root.append(button)
  render()

  return {
    /** @param {{ muted?: boolean, volume?: number }} [state] */
    update(state = {}) {
      if (!state || typeof state !== 'object') return
      let changed = false
      if ('muted' in state) {
        const next = Boolean(state.muted)
        if (next !== muted) {
          muted = next
          changed = true
        }
      }
      if ('volume' in state) {
        const next = level(state.volume)
        if (next !== volume) {
          volume = next
          changed = true
        }
      }
      if (changed) render()
    },
    destroy() {
      button.removeEventListener('click', handleClick)
      button.remove()
    },
  }
}
