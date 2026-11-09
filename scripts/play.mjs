// Runner de playtest : sert le build, joue chaque scénario de tests/play/ dans Chromium headless.
// Contrôles communs à tout scénario : WebGL actif, boucle qui tourne, zéro erreur console, budget de rendu.
// Usage : npm run play [<nom-de-scénario>]   Captures : test-results/<scénario>-<nom>.png
import { spawn } from 'node:child_process'
import { mkdir, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const BASE = 'http://localhost:4173/'
const BUDGET = { drawCalls: 300, triangles: 500_000 }
const dir = new URL('../tests/play/', import.meta.url)
const only = process.argv[2]

const names = (await readdir(dir)).filter((f) => f.endsWith('.mjs')).map((f) => f.slice(0, -4))
  .filter((n) => !only || n === only)
if (!names.length) throw new Error(`Aucun scénario${only ? ` "${only}"` : ''} dans tests/play/`)
await mkdir('test-results', { recursive: true })

// Vite lancé via Node (pas `npx`, qui est un .cmd sur Windows et exige un shell).
const vite = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url))
const server = spawn(process.execPath, [vite, 'preview', '--port', '4173', '--strictPort'], { stdio: 'ignore' })
let failed = 0

try {
  await waitFor(BASE)
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH, // optionnel : navigateur déjà installé
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
  for (const name of names) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    const errors = []
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
    page.on('pageerror', (e) => errors.push(e.message))
    const api = helpers(page, name)
    const report = { scenario: name, ok: true }
    try {
      await api.load()
      const { default: scenario } = await import(new URL(`${name}.mjs`, dir))
      await scenario(api)
      Object.assign(report, await page.evaluate(() => ({
        drawCalls: window.__game.renderer.info.render.calls,
        triangles: window.__game.renderer.info.render.triangles,
      })))
      api.assert(report.drawCalls <= BUDGET.drawCalls, `draw calls ${report.drawCalls} > ${BUDGET.drawCalls}`)
      api.assert(report.triangles <= BUDGET.triangles, `triangles ${report.triangles} > ${BUDGET.triangles}`)
      api.assert(!errors.length, `erreurs console : ${errors.join(' | ')}`)
    } catch (e) {
      Object.assign(report, { ok: false, error: e.message })
      await api.shot('failure').catch(() => {})
      failed++
    }
    console.log(JSON.stringify(report))
    await page.close()
  }
  await browser.close()
} finally {
  server.kill()
}
process.exitCode = failed ? 1 : 0

function helpers(page, scenario) {
  const api = {
    page,
    /** (Re)charge le jeu, ex. load('?lang=en'), et vérifie que la boucle tourne. */
    async load(query = '') {
      await page.goto(BASE + query)
      await page.waitForFunction(() => window.__game?.state.frames > 0, null, { timeout: 10_000 })
      const webgl = await page.evaluate(() => window.__game.renderer.getContext() instanceof WebGL2RenderingContext)
      api.assert(webgl, 'contexte WebGL2 absent')
      const before = await page.evaluate(() => window.__game.state.frames)
      await page.waitForTimeout(300)
      api.assert((await page.evaluate(() => window.__game.state.frames)) > before, 'boucle de jeu figée')
    },
    /** Copie sérialisable de window.__game.state. */
    state: () => page.evaluate(() => JSON.parse(JSON.stringify(window.__game.state))),
    /** Maintient une touche (KeyboardEvent.code, ex. 'KeyW', 'Space') pendant ms. */
    async press(code, ms = 100) {
      await page.keyboard.down(code)
      await page.waitForTimeout(ms)
      await page.keyboard.up(code)
    },
    click: (selector) => page.click(selector),
    wait: (ms) => page.waitForTimeout(ms),
    shot: (label) => page.screenshot({ path: `test-results/${scenario}-${label}.png` }),
    assert(condition, message) {
      if (!condition) throw new Error(message)
    },
  }
  return api
}

async function waitFor(url, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try { if ((await fetch(url)).ok) return } catch {}
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`Serveur preview injoignable : ${url}`)
}
