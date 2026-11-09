import { t } from '../i18n/index.js'

export function createHud(root) {
  const el = document.createElement('div')
  el.className = 'hud'
  el.textContent = t('game.title')
  root.append(el)
  return { update() {}, destroy: () => el.remove() }
}
