import { t } from '../i18n/index.js'

/**
 * HUD du niveau 1 : nom de la clairière et aide à la caméra, en DOM au-dessus du canvas.
 * Aucune donnée de gameplay n'est affichée pour l'instant : `update` reste sans effet.
 * @param {HTMLElement} root
 * @param {{ level?: { id?: string } }} [options]
 * @returns {{ update(state?: object): void, destroy(): void }}
 */
export function createLevelHud(root, { level } = {}) {
  const el = document.createElement('div')
  el.className = 'level-hud'
  if (level?.id) el.dataset.level = level.id

  const title = document.createElement('h1')
  title.className = 'level-hud__title'
  title.textContent = t('level.1.name')

  const hint = document.createElement('p')
  hint.className = 'level-hud__hint'
  hint.textContent = t('level.1.hint')

  el.append(title, hint)
  root.append(el)

  return {
    update() {},
    destroy() {
      el.remove()
    },
  }
}
