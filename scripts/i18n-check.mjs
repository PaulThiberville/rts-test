// Traductions : toute clé t('...') utilisée doit exister dans la langue source (erreur) ;
// traductions manquantes et clés inutilisées sont signalées (avertissements).
import { readdir, readFile } from 'node:fs/promises'

const SOURCE = (await readFile('src/i18n/index.js', 'utf8')).match(/SOURCE = '(\w+)'/)[1]
const used = new Set()
for (const f of (await readdir('src', { recursive: true })).filter((f) => f.endsWith('.js') && !f.startsWith('i18n'))) {
  for (const [, key] of (await readFile(`src/${f}`, 'utf8')).matchAll(/\bt\(\s*['"`]([\w.-]+)['"`]/g)) used.add(key)
}

const locales = {}
for (const f of (await readdir('src/i18n')).filter((f) => f.endsWith('.json'))) {
  locales[f.slice(0, -5)] = JSON.parse(await readFile(`src/i18n/${f}`, 'utf8'))
}
const keys = Object.keys(locales[SOURCE])
const report = {
  source: SOURCE,
  errors: [...used].filter((k) => !(k in locales[SOURCE])).map((k) => `clé absente de ${SOURCE}.json : ${k}`),
  warnings: [
    ...keys.filter((k) => !used.has(k)).map((k) => `clé inutilisée : ${k}`),
    ...Object.entries(locales).flatMap(([code, d]) =>
      code === SOURCE ? [] : keys.filter((k) => !(k in d)).map((k) => `${code}.json : traduction manquante : ${k}`)),
  ],
}
console.log(JSON.stringify(report))
if (report.errors.length) process.exitCode = 1
