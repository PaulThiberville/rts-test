import { createIcon } from '../art/icons.js'
import { t } from '../i18n/index.js'

let hudCount = 0

/** Secondes → « mm:ss » (minutes non bornées, arrondi vers le bas, jamais négatif). */
function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`
}

/** Nombre fini, sinon repli : l'état peut arriver partiel ou non numérique. */
function finite(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/**
 * Aperçu de vitrine : `npm run showcase` appelle la fabrique avec un état sans champ
 * de jeu (ni `wave`, ni `core`, ni `run`). On montre alors une fin de victoire, seule
 * façon de juger la carte et ses trois actions.
 */
const PREVIEW = Object.freeze({
  wave: Object.freeze({ index: 6, total: 6, countdown: 0, phase: 'wave' }),
  core: Object.freeze({ hp: 7, max: 12 }),
  run: Object.freeze({ elapsed: 252, outcome: 'victory' }),
})

/**
 * HUD de vague : bandeau haut (vague en cours, compte à rebours, vie du cœur) et
 * écran de fin plein cadre (victoire ou défaite, vague atteinte, durée, puis trois
 * actions en victoire — « Niveau suivant », « Rejouer », « Retour aux jardins » — et
 * deux en défaite).
 * Purement présentation : `update` lit l'état, toute décision de jeu remonte par les
 * rappels `onNext`, `onRestart` et `onExit`.
 * @param {HTMLElement} root
 * @param {{ onRestart?: () => void, onNext?: () => void, onExit?: () => void }} [options]
 * @returns {{ update(state?: object): void, destroy(): void }}
 */
export function createWaveHud(root, { onRestart, onNext, onExit } = {}) {
  const count = ++hudCount
  const waveId = `wave-hud-wave-${count}`
  const titleId = `wave-hud-end-title-${count}`

  const el = document.createElement('section')
  el.className = 'wave-hud'
  el.hidden = true // aucune carte vide au démarrage : premier rendu à la première vague
  el.setAttribute('role', 'group')
  el.setAttribute('aria-labelledby', waveId)

  const waveLine = document.createElement('p')
  waveLine.className = 'wave-hud__wave'
  waveLine.id = waveId
  waveLine.setAttribute('role', 'status')

  const windupLine = document.createElement('p')
  windupLine.className = 'wave-hud__windup'
  windupLine.hidden = true

  const coreLine = document.createElement('p')
  coreLine.className = 'wave-hud__core'
  coreLine.setAttribute('role', 'status')
  // Cœur décoratif devant la valeur : le libellé « Cœur 7/12 » reste le texte annoncé.
  const coreText = document.createElement('span')
  coreText.className = 'wave-hud__core-value'
  coreLine.append(createIcon('heart', { size: 16, className: 'wave-hud__core-icon' }), coreText)

  const meter = document.createElement('div')
  meter.className = 'wave-hud__meter'
  meter.setAttribute('aria-hidden', 'true')
  const meterFill = document.createElement('span')
  meterFill.className = 'wave-hud__meter-fill'
  meter.append(meterFill)

  el.append(waveLine, windupLine, coreLine, meter)

  const end = document.createElement('section')
  end.className = 'end-screen'
  end.hidden = true
  end.setAttribute('role', 'dialog')
  end.setAttribute('aria-modal', 'true')
  end.setAttribute('aria-labelledby', titleId)

  const card = document.createElement('div')
  card.className = 'end-screen__card'

  const endTitle = document.createElement('h2')
  endTitle.className = 'end-screen__title'
  endTitle.id = titleId

  const endWave = document.createElement('p')
  endWave.className = 'end-screen__wave'

  const endTime = document.createElement('p')
  endTime.className = 'end-screen__time'

  const actions = document.createElement('div')
  actions.className = 'end-screen__actions'

  /**
   * Une action de fin de niveau : bouton natif, libellé localisé, `data-action` stable
   * pour les tests et le câblage.
   * @param {'next'|'replay'|'exit'} action
   * @param {string} label
   * @param {boolean} primary
   */
  function createAction(action, label, primary) {
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.action = action
    button.className = primary
      ? 'end-screen__button end-screen__button--primary'
      : 'end-screen__button'
    button.textContent = label
    return button
  }

  const next = createAction('next', t('end.next'), true)
  // `end-screen__replay` reste portée par le bouton : les scénarios de playtest le ciblent.
  const replay = createAction('replay', t('end.replay'), false)
  replay.classList.add('end-screen__replay')
  const exit = createAction('exit', t('end.exit'), false)

  actions.append(next, replay, exit)
  card.append(endTitle, endWave, endTime, actions)
  end.append(card)
  root.append(el, end)

  // Écran de fin : c'est une vraie modale. Le reste de `#ui` est rendu `inert` à
  // l'ouverture (plus de focus sur la poignée de la barre sous le voile), restauré à
  // la fermeture — on mémorise l'état d'origine de chaque voisin.
  /** @type {Map<HTMLElement, boolean>} */
  const inertNeighbours = new Map()

  /** @param {boolean} hide */
  function setBackdropInert(hide) {
    if (hide) {
      for (const node of root.children) {
        if (node === end || !(node instanceof HTMLElement) || inertNeighbours.has(node)) continue
        inertNeighbours.set(node, node.inert)
        node.inert = true
      }
      return
    }
    for (const [node, previous] of inertNeighbours) node.inert = previous
    inertNeighbours.clear()
  }

  // Ceinture et bretelles : `Tab`/`Shift+Tab` tournent dans la carte au lieu de
  // rejoindre la barre du navigateur, et la boucle repart de la première action
  // affichée (jamais d'un bouton masqué ou désactivé).
  function handleTab(event) {
    if (event.key !== 'Tab' || end.hidden) return
    const focusables = card.querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')
    if (!focusables.length) return
    const last = focusables[focusables.length - 1]
    const active = document.activeElement
    if (!card.contains(active) || active === (event.shiftKey ? focusables[0] : last)) {
      event.preventDefault()
      ;(event.shiftKey ? last : focusables[0]).focus({ preventScroll: true })
    }
  }

  // Dernières valeurs lues : `update` accepte un état partiel et ne réécrit le DOM
  // que lorsque l'une des valeurs affichées change, jamais à chaque image.
  const wave = { index: 0, total: 0, countdown: 0, phase: null }
  const core = { hp: 0, max: 0 }
  const run = { elapsed: 0, outcome: null }
  const banner = { index: -1, total: -1, countdown: -1, phase: null, hp: -1, max: -1 }
  const ending = { outcome: null, index: -1, total: -1, elapsed: -1 }
  /** Mode d'actions affiché : `'next'` de plus en victoire, absent en défaite. */
  let actionMode = null

  /** @param {HTMLElement} node @param {string} value */
  function setText(node, value) {
    if (node.textContent !== value) node.textContent = value
  }

  let revealed = false

  /** La carte n'apparaît qu'à la première vague reçue : pas de « Vague 0/0 » au boot. */
  function reveal() {
    if (revealed) return
    revealed = true
    el.hidden = false
  }

  function renderBanner() {
    if (banner.index === wave.index && banner.total === wave.total
      && banner.countdown === wave.countdown && banner.phase === wave.phase
      && banner.hp === core.hp && banner.max === core.max) return
    Object.assign(banner, wave, core)

    setText(waveLine, t('wave.label', { n: wave.index, total: wave.total }))
    const counting = wave.phase === 'countdown'
    if (windupLine.hidden === counting) windupLine.hidden = !counting
    if (counting) setText(windupLine, t('wave.windup', { n: wave.index, s: wave.countdown }))
    setText(coreText, t('core.hp', { hp: core.hp, max: core.max }))
    const ratio = core.max > 0 ? Math.min(1, Math.max(0, core.hp / core.max)) : 0
    meterFill.style.width = `${Math.round(ratio * 100)}%`
    el.dataset.phase = wave.phase ?? ''
    el.dataset.core = ratio <= 0.34 ? 'low' : 'ok'
  }

  function renderEnd() {
    if (run.outcome === null) {
      if (!end.hidden) {
        end.hidden = true
        setBackdropInert(false)
      }
      return
    }

    if (ending.outcome === run.outcome && ending.index === wave.index
      && ending.total === wave.total && ending.elapsed === run.elapsed && !end.hidden) return
    Object.assign(ending, { outcome: run.outcome, index: wave.index, total: wave.total, elapsed: run.elapsed })

    const victory = run.outcome === 'victory'
    setText(endTitle, victory ? t('end.victory') : t('end.defeat'))
    end.dataset.outcome = victory ? 'victory' : 'defeat'
    setText(endWave, t('end.wave', { n: wave.index, total: wave.total }))
    setText(endTime, t('end.time', { time: formatDuration(run.elapsed) }))
    // Défaite : « Niveau suivant » ne peut pas exister, il sort de l'affichage, de la
    // boucle de tabulation (`button:not([disabled])`) et de l'arbre d'accessibilité.
    const mode = victory ? 'victory' : 'defeat'
    if (actionMode !== mode) {
      actionMode = mode
      next.hidden = !victory
      next.disabled = !victory
    }
    if (end.hidden) {
      end.hidden = false
      setBackdropInert(true)
      // Repli d'accessibilité : l'action principale prend le focus, jamais le fond.
      ;(victory ? next : replay).focus({ preventScroll: true })
    }
  }

  function handleRestart() {
    onRestart?.()
  }
  function handleNext() {
    onNext?.()
  }
  function handleExit() {
    onExit?.()
  }
  replay.addEventListener('click', handleRestart)
  next.addEventListener('click', handleNext)
  exit.addEventListener('click', handleExit)
  end.addEventListener('keydown', handleTab)

  function clampedInt(value, min) {
    return Math.max(min, Math.trunc(finite(value, min)))
  }

  return {
    /** @param {object} [state] */
    update(state = {}) {
      const live = state && typeof state === 'object' ? state : {}
      // Vitrine : état sans aucun champ de jeu → aperçu de fin de victoire.
      const source = !live.wave && !live.core && !live.run ? PREVIEW : live

      const nextWave = source.wave
      if (nextWave && typeof nextWave === 'object') {
        if ('index' in nextWave || 'total' in nextWave || 'countdown' in nextWave || 'phase' in nextWave) reveal()
        if ('index' in nextWave) wave.index = clampedInt(nextWave.index, 0)
        if ('total' in nextWave) wave.total = clampedInt(nextWave.total, 0)
        if ('countdown' in nextWave) wave.countdown = clampedInt(nextWave.countdown, 0)
        if ('phase' in nextWave) wave.phase = nextWave.phase ?? null
      }

      const nextCore = source.core
      if (nextCore && typeof nextCore === 'object') {
        if ('hp' in nextCore) core.hp = Math.max(0, finite(nextCore.hp))
        if ('max' in nextCore) core.max = Math.max(0, finite(nextCore.max))
      }

      const nextRun = source.run
      if (nextRun && typeof nextRun === 'object') {
        if ('elapsed' in nextRun) run.elapsed = Math.max(0, finite(nextRun.elapsed))
        if ('outcome' in nextRun) run.outcome = nextRun.outcome ?? null
      }

      renderBanner()
      renderEnd()
    },
    destroy() {
      replay.removeEventListener('click', handleRestart)
      next.removeEventListener('click', handleNext)
      exit.removeEventListener('click', handleExit)
      end.removeEventListener('keydown', handleTab)
      setBackdropInert(false)
      el.remove()
      end.remove()
    },
  }
}
