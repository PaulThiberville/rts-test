// Ajouter une langue = déposer un fichier <code>.json ici. Aucune modification de code.
const locales = import.meta.glob('./*.json', { eager: true, import: 'default' })
const dict = (code) => locales[`./${code}.json`]

export const SOURCE = 'fr'
export const languages = Object.keys(locales).map((p) => p.slice(2, -5))

const wanted = new URLSearchParams(location.search).get('lang') ?? navigator.language.slice(0, 2)
export const lang = dict(wanted) ? wanted : SOURCE
document.documentElement.lang = lang

/** t('hud.score', { n: 3 }) → "Score : 3". Repli : langue courante → langue source → clé. */
export function t(key, vars = {}) {
  const text = dict(lang)[key] ?? dict(SOURCE)[key] ?? key
  return text.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`)
}
