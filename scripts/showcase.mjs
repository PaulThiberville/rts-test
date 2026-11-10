// Vitrine d'asset : capture un asset seul, sous plusieurs angles ou tailles, pour juger sa qualité visuelle.
// Usage : npm run showcase src/materials/bois.js [createBoisMaterial]
//         npm run showcase src/entities/caisse.js
//         npm run showcase src/ui/hud.js            (composant d'UI : rendu ordinateur et mobile)
//         npm run showcase public/images/coeur.svg
// Captures : test-results/showcase-<asset>-<vue>.png
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { freePort, launchBrowser, outputDir, startVite } from './lib.mjs'

const [target, exportName] = process.argv.slice(2)
if (!target) throw new Error('Usage : npm run showcase <fichier> [export]')

const path = target.replaceAll('\\', '/').replace(/^\.?\//, '')
const ui = path.startsWith('src/ui/') // pas d'option --ui : npm l'intercepterait
const isImage = /\.(svg|png|jpe?g|webp)$/i.test(path)
const query = isImage
  ? `image=${encodeURIComponent('/' + path.replace(/^public\//, ''))}`
  : `module=${encodeURIComponent('/' + path)}${exportName ? `&export=${exportName}` : ''}${ui ? '&kind=ui' : ''}`
const slug = path.replace(/^(src|public)\//, '').replace(/\.[a-z]+$/i, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase()

const { results, prefix } = outputDir()
await mkdir(results, { recursive: true })
const port = await freePort()
const server = await startVite('dev', port)
const browser = await launchBrowser()
const report = { asset: path, ok: false, kind: null, captures: [], errors: [] }

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  page.on('console', (m) => m.type() === 'error' && report.errors.push(m.text()))
  page.on('pageerror', (e) => report.errors.push(e.message))
  await page.goto(`http://localhost:${port}/showcase.html?${query}`)
  await page.waitForFunction(() => window.__showcase?.ready || window.__showcase?.error, null, { timeout: 60_000 })
  const state = await page.evaluate(() => ({ error: window.__showcase.error, kind: window.__showcase.kind, views: window.__showcase.views }))
  if (state.error) throw new Error(state.error)
  report.kind = state.kind
  for (const view of state.views) {
    if (state.kind === 'ui') await page.setViewportSize(view === 'mobile' ? { width: 390, height: 844 } : { width: 1280, height: 800 })
    await page.evaluate((v) => window.__showcase.show(v), view)
    await page.waitForTimeout(state.kind === 'image' || state.kind === 'ui' ? 500 : 100)
    const file = join(results, `${prefix}showcase-${slug}-${view}.png`)
    await page.screenshot({ path: file })
    report.captures.push(file)
  }
  report.ok = report.errors.length === 0
} catch (e) {
  report.errors.push(e.message)
} finally {
  await browser.close()
  server.kill()
}
console.log(JSON.stringify(report))
process.exitCode = report.ok ? 0 : 1
