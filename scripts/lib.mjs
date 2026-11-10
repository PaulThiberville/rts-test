// Outils partagés par les scripts de test (play, showcase) : port libre, dossier de captures, serveur Vite, navigateur.
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

/** Port TCP libre : plusieurs vérifications peuvent tourner en même temps (mode parallèle). */
export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer().once('error', reject)
    srv.listen(0, () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

/** test-results/ du dépôt principal ; préfixe `issue-N-` quand on tourne dans un worktree (mode parallèle). */
export function outputDir() {
  try {
    const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    const top = git('rev-parse', '--show-toplevel')
    const main = dirname(git('rev-parse', '--path-format=absolute', '--git-common-dir'))
    return top === main ? { results: 'test-results', prefix: '' } : { results: join(main, 'test-results'), prefix: `${basename(top)}-` }
  } catch {
    return { results: 'test-results', prefix: '' }
  }
}

/** Lance Vite via Node (pas `npx`, qui est un .cmd sur Windows et exige un shell). `mode` : 'preview' ou 'dev'. */
export async function startVite(mode, port) {
  const vite = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url))
  const args = mode === 'dev' ? ['--port', String(port), '--strictPort'] : ['preview', '--port', String(port), '--strictPort']
  const server = spawn(process.execPath, [vite, ...args], { stdio: 'ignore' })
  await waitFor(`http://localhost:${port}/`)
  return server
}

export function launchBrowser() {
  return chromium.launch({
    executablePath: process.env.CHROMIUM_PATH, // optionnel : navigateur déjà installé
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  })
}

async function waitFor(url, tries = 100) {
  for (let i = 0; i < tries; i++) {
    try { if ((await fetch(url)).ok) return } catch {}
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`Serveur injoignable : ${url}`)
}
