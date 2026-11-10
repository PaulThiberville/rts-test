// Playtest de l'Epic #89 — l'habillage visuel de la clairière, un bloc par critère.
// Le niveau 1 est chargé explicitement (`?niveau=1`) : le scénario reste valable quand
// l'accueil de campagne s'affichera (#69). Les captures sont préfixées `epic-89-` et
// déposées dans le test-results/ du dépôt principal, même en mode parallèle (worktree).
// Le scénario de l'Epic #48 (ambiance sonore) gardait ce nom : il devient
// `ambiance-sonore.mjs`, sans changement de comportement.
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Racine du dépôt principal : en mode parallèle, `.git` est un fichier dans le worktree. */
function repositoryRoot() {
  let dir = dirname(fileURLToPath(import.meta.url))
  while (dir !== dirname(dir)) {
    const git = join(dir, '.git')
    if (existsSync(git) && statSync(git).isDirectory()) return dir
    dir = dirname(dir)
  }
  return process.cwd()
}

const ROOT = repositoryRoot()
const RESULTS = join(ROOT, 'test-results')
const DA = fileURLToPath(new URL('../../vault/GDD/Direction-Artistique.md', import.meta.url))
const GAME_JS = fileURLToPath(new URL('../../src/core/game.js', import.meta.url))

const EXPECTED_FAMILIES = ['tree', 'bush', 'flower', 'grass']
const MOBILE = { width: 390, height: 844 }
const DESKTOP = { width: 1280, height: 720 }
const BUDGET = { drawCalls: 300, triangles: 500_000, p95: 16.7, frames: 120 }
/** Teinte de rebond de l'hémisphérique, documentée par la Direction-Artistique. */
const LIGHT_GROUND = '#b9c4ab'

const shot = (page, label) => page.screenshot({ path: join(RESULTS, `epic-89-${label}.png`) })

/** Attend le nombre d'images de rendu demandé (aucune attente arbitraire). */
const nextFrames = (page, count = 2) => page.evaluate((n) => new Promise((resolve) => {
  let seen = 0
  const loop = () => (++seen >= n ? resolve() : requestAnimationFrame(loop))
  requestAnimationFrame(loop)
}), count)

async function setViewport(page, { width, height }) {
  await page.setViewportSize({ width, height })
  await nextFrames(page, 2)
}

/** Percentile par rang le plus proche : p95 = index ⌈0,95 n⌉ − 1 (même règle que clairiere.mjs). */
function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 0) return NaN
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))]
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 0) return NaN
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

/** Luminance relative sRGB, formule de la Direction-Artistique. */
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/** Les quatre emplacements du niveau, projetés à l'écran, avec l'élément réellement pointé. */
function slotPoints(page) {
  return page.evaluate(() => {
    const { camera, state } = window.__game
    const projected = camera.position.clone()
    return state.slots.map((slot) => {
      projected.set(slot.x, 0, slot.z).project(camera)
      const x = (projected.x * 0.5 + 0.5) * innerWidth
      const y = (-projected.y * 0.5 + 0.5) * innerHeight
      const element = document.elementFromPoint(x, y)
      return {
        id: slot.id,
        x,
        y,
        occupied: slot.occupied,
        inFront: projected.z < 1,
        inside: x >= 0 && y >= 0 && x < innerWidth && y < innerHeight,
        canvas: element?.tagName === 'CANVAS',
        // Ce que le joueur touche vraiment à cet endroit : un pétale ou une luciole
        // dessinés en WebGL ne sont pas des éléments DOM, donc jamais un bloqueur.
        element: element ? `${element.tagName}.${element.className || ''}` : null,
      }
    })
  })
}

async function clickCanvas(page, point) {
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.up()
}

/** Ouvre la barre de tours si besoin, puis attend la fin de la transition. */
async function openBar(page) {
  const open = await page.evaluate(() => document.querySelector('.tower-bar')?.dataset.open === 'true')
  if (!open) await page.click('.tower-bar__handle')
  await page.waitForFunction(() => document.querySelector('.tower-bar')?.dataset.open === 'true')
  await page.waitForFunction(() => {
    const panel = document.querySelector('.tower-bar__panel')
    return panel !== null && getComputedStyle(panel).opacity === '1'
  })
}

async function selectSeed(page, type) {
  await page.click(`.tower-bar__entry[data-tower="${type}"]`)
  await page.waitForFunction((id) => window.__game.state.towerBar.selectedType === id, type)
}

export default async function ({ page, load, state }) {
  page.setDefaultTimeout(10_000)
  mkdirSync(RESULTS, { recursive: true })

  const failures = []
  const check = (condition, message) => { if (!condition) failures.push(message) }
  const block = async (num, run) => {
    try {
      await run()
    } catch (error) {
      failures.push(`critère ${num} : ${error.message}`)
    }
  }

  // Le runner écoute déjà les erreurs console ; le scénario tient sa propre liste pour
  // pouvoir la détailler dans le message d'échec.
  const consoleErrors = []
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('pageerror', (error) => consoleErrors.push(error.message))

  const [da, gameSource] = await Promise.all([
    readFile(DA, 'utf8'),
    readFile(GAME_JS, 'utf8'),
  ])

  // -------------------------------------------------------------------------
  // Critère 1 — au chargement du niveau 1, au moins 4 familles de végétaux
  // distinctes, chacune avec des instances dans la scène. Capture 390×844.
  // -------------------------------------------------------------------------
  await block(1, async () => {
    const label = 'critère 1'
    await load('?niveau=1')
    await setViewport(page, MOBILE)
    const decor = (await state()).decor
    const families = Array.isArray(decor?.families) ? decor.families : []
    const counts = decor?.counts ?? {}
    check(new Set(families).size >= 4,
      `${label} : ${new Set(families).size} famille(s) distincte(s) dans state.decor.families (${families.join(', ')}) au lieu de 4`)
    for (const id of EXPECTED_FAMILIES) {
      check(families.includes(id), `${label} : famille « ${id} » absente de state.decor.families`)
      check((counts[id] ?? 0) > 0, `${label} : famille « ${id} » sans instance (count ${counts[id]})`)
    }
    // La scène doit porter un InstancedMesh par famille, avec le même effectif : un
    // compteur d'état sans maillage derrière ne prouverait rien.
    const meshes = await page.evaluate(() => {
      const out = []
      window.__game.scene.traverse((object) => {
        if (!object.isInstancedMesh || !object.name.startsWith('vegetation-')) return
        out.push({ id: object.name.slice('vegetation-'.length), count: object.count, castShadow: object.castShadow })
      })
      return out
    })
    check(meshes.length >= 4, `${label} : ${meshes.length} InstancedMesh « vegetation-* » dans la scène`)
    for (const id of EXPECTED_FAMILIES) {
      const mesh = meshes.find((item) => item.id === id)
      check(Boolean(mesh), `${label} : aucun InstancedMesh vegetation-${id} dans la scène`)
      if (mesh) {
        check(mesh.count === counts[id],
          `${label} : vegetation-${id} compte ${mesh.count} instance(s), state.decor.counts dit ${counts[id]}`)
      }
    }
    console.log(`[ambiance] critère 1 — ${families.length} familles : ${families.map((id) => `${id}×${counts[id]}`).join(', ')}`)
    // Capture de référence en 390×844 (cadrage mobile), puis vue large des quatre
    // silhouettes : en portrait, les arbres et buissons sortent du cadre.
    await shot(page, 'familles')
    await setViewport(page, DESKTOP)
    await shot(page, 'familles-desktop')
  })

  // -------------------------------------------------------------------------
  // Critère 2 — aucune répétition : comparaison deux à deux des instances d'une
  // même famille sur (échelle XZ, échelle Y, rotation, teinte). Le nombre de
  // paires comparées est relevé pour que « 0 doublon » veuille dire quelque chose.
  // -------------------------------------------------------------------------
  await block(2, async () => {
    const label = 'critère 2'
    const report = await page.evaluate(() => {
      const meshes = []
      window.__game.scene.traverse((object) => {
        if (object.isInstancedMesh && object.name.startsWith('vegetation-')) meshes.push(object)
      })
      if (!meshes.length) return { families: [], pairs: 0 }
      // Un seul jeu de brouillons, réutilisé pour toutes les instances (aucune allocation par instance).
      const matrix = meshes[0].matrix.clone()
      const position = meshes[0].position.clone()
      const quaternion = meshes[0].quaternion.clone()
      const scale = meshes[0].scale.clone()
      const families = []
      let pairs = 0
      for (const mesh of meshes) {
        const colors = mesh.instanceColor ? mesh.instanceColor.array : null
        const seen = new Map()
        const count = mesh.count
        for (let index = 0; index < count; index++) {
          mesh.getMatrixAt(index, matrix)
          matrix.decompose(position, quaternion, scale)
          // Clé = (échelle XZ, échelle Y, rotation, teinte). La position n'entre pas :
          // deux instances peuvent partager une taille et une teinte sans être le même buisson.
          const key = [
            scale.x.toFixed(9), scale.z.toFixed(9), scale.y.toFixed(9),
            quaternion.x.toFixed(9), quaternion.y.toFixed(9), quaternion.z.toFixed(9), quaternion.w.toFixed(9),
            colors ? colors[index * 3].toFixed(9) : '-',
            colors ? colors[index * 3 + 1].toFixed(9) : '-',
            colors ? colors[index * 3 + 2].toFixed(9) : '-',
          ].join('|')
          seen.set(key, (seen.get(key) ?? 0) + 1)
        }
        let duplicates = 0
        for (const occurrences of seen.values()) if (occurrences > 1) duplicates += (occurrences * (occurrences - 1)) / 2
        pairs += (count * (count - 1)) / 2
        families.push({ id: mesh.name.slice('vegetation-'.length), instances: count, duplicates, tinted: colors !== null })
      }
      return { families, pairs }
    })

    check(report.families.length >= 4, `${label} : ${report.families.length} famille(s) inspectée(s), au lieu de 4`)
    check(report.pairs > 700_000,
      `${label} : ${report.pairs} paire(s) comparée(s), trop peu pour conclure (1200 graminées en attendent ~719 000 à elles seules)`)
    for (const family of report.families) {
      check(family.instances > 0, `${label} : famille ${family.id} sans instance`)
      check(family.tinted, `${label} : ${family.id} n'a pas de teinte d'instance (instanceColor absent)`)
      check(family.duplicates === 0,
        `${label} : ${family.duplicates} paire(s) strictement identique(s) dans ${family.id} (échelle XZ, échelle Y, rotation, teinte)`)
    }
    console.log(`[ambiance] critère 2 — ${report.pairs} paires comparées, ${report.families.reduce((sum, family) => sum + family.duplicates, 0)} doublon(s) : ${report.families.map((family) => `${family.id}×${family.instances}`).join(', ')}`)
    await shot(page, 'variation')
  })

  // -------------------------------------------------------------------------
  // Critère 3 — lumière chaude et ombres douces : valeurs de l'état confrontées
  // au DirectionalLight réellement dans la scène, teintes dans la palette,
  // ≥ 80 % de végétaux qui projettent une ombre.
  // -------------------------------------------------------------------------
  await block(3, async () => {
    const label = 'critère 3'
    await load('?niveau=1')
    await setViewport(page, MOBILE)
    const snap = await state()
    const lighting = snap.lighting ?? {}
    const palette = snap.level?.palette ?? {}
    const live = await page.evaluate(() => {
      const sun = window.__game.scene.getObjectByName('sun')
      const hemi = window.__game.scene.getObjectByName('hemi')
      let castShadow = 0
      let total = 0
      window.__game.scene.traverse((object) => {
        if (!object.isInstancedMesh || !object.name.startsWith('vegetation-')) return
        castShadow += object.castShadow ? object.count : 0
        total += object.count
      })
      return {
        shadowType: window.__game.renderer.shadowMap.type,
        mapEnabled: window.__game.renderer.shadowMap.enabled,
        sun: sun ? {
          isDirectional: sun.isDirectionalLight === true,
          castShadow: sun.castShadow,
          intensity: sun.intensity,
          color: `#${sun.color.getHexString()}`,
          radius: sun.shadow.radius,
          mapSize: sun.shadow.mapSize.x,
        } : null,
        hemi: hemi ? { sky: `#${hemi.color.getHexString()}`, ground: `#${hemi.groundColor.getHexString()}` } : null,
        castShadow,
        total,
      }
    })

    check(Boolean(live.sun?.isDirectional), `${label} : aucune DirectionalLight « sun » dans la scène`)
    check(live.mapEnabled === true, `${label} : shadowMap désactivée sur le renderer`)
    // `PCFSoftShadowMap` n'existe plus sous three 0.187 : le renderer bascule sur
    // `PCFShadowMap` au premier rendu d'ombre (avertissement du moteur), et la douceur
    // vient de `shadow.radius`. On exige donc une ombre douce, jamais Basic, et la
    // valeur de référence câblée dans core/game.js.
    check(lighting.shadowMap !== 'BasicShadowMap' && live.shadowType !== 0,
      `${label} : ombre dure (shadowMap ${lighting.shadowMap}, type ${live.shadowType})`)
    check(lighting.shadowMap === 'PCFSoftShadowMap' || lighting.shadowMap === 'PCFShadowMap',
      `${label} : shadowMap « ${lighting.shadowMap} » au lieu d'un filtre PCF doux`)
    check(/renderer\.shadowMap\.type\s*=\s*THREE\.PCFSoftShadowMap/.test(gameSource),
      `${label} : core/game.js ne câble plus PCFSoftShadowMap sur le renderer`)
    check(lighting.radius > 0 && live.sun.radius > 0,
      `${label} : shadow.radius ${lighting.radius} (état) / ${live.sun?.radius} (scène) : aucune pénombre`)
    check(lighting.radius === live.sun?.radius,
      `${label} : radius d'état ${lighting.radius} ≠ radius de la scène ${live.sun?.radius}`)
    check(lighting.intensity > 0 && Math.abs(lighting.intensity - live.sun.intensity) < 1e-6,
      `${label} : intensité d'état ${lighting.intensity} ≠ intensité de la scène ${live.sun?.intensity}`)
    check(lighting.sun === live.sun.color,
      `${label} : teinte du soleil ${lighting.sun} ≠ ${live.sun.color}`)

    const paletteValues = Object.values(palette)
    check(paletteValues.includes(lighting.sun), `${label} : teinte soleil ${lighting.sun} absente de state.level.palette`)
    check(paletteValues.includes(lighting.sky), `${label} : teinte ciel ${lighting.sky} absente de state.level.palette`)
    check(lighting.sky === live.hemi?.sky, `${label} : ciel d'état ${lighting.sky} ≠ ${live.hemi?.sky}`)
    // La Direction-Artistique documente le rebond du sol comme un éclairage, volontairement
    // plus sombre que `palette.ground` : c'est cette valeur de référence qui est vérifiée.
    check(lighting.ground === LIGHT_GROUND,
      `${label} : teinte sol ${lighting.ground} au lieu de ${LIGHT_GROUND} (référence Direction-Artistique)`)
    check(da.includes(LIGHT_GROUND), `${label} : ${LIGHT_GROUND} n'est pas documenté dans Direction-Artistique.md`)
    check(luminance(lighting.ground) < luminance(palette.ground ?? '#ffffff'),
      `${label} : le rebond du sol (${lighting.ground}) n'est pas plus sombre que le sol (${palette.ground})`)
    check(live.castShadow / Math.max(live.total, 1) >= 0.8,
      `${label} : ${live.castShadow}/${live.total} végétaux projettent une ombre (< 80 %)`)
    check(snap.lighting.vegetalsCastShadow / Math.max(snap.lighting.vegetalsTotal, 1) >= 0.8,
      `${label} : state.lighting ${snap.lighting.vegetalsCastShadow}/${snap.lighting.vegetalsTotal} en castShadow (< 80 %)`)
    console.log(`[ambiance] critère 3 — ombre ${lighting.shadowMap} (radius ${lighting.radius}, map ${live.sun.mapSize}), soleil ${lighting.sun} ${lighting.intensity}, ciel ${lighting.sky}, sol ${lighting.ground}, ${live.castShadow}/${live.total} castShadow`)
    await shot(page, 'lumiere')
  })

  // -------------------------------------------------------------------------
  // Critère 4 — mouvement discret : deux captures à 3 s, positions réelles des
  // familles mobiles relevées avant/après (un déplacement d'image ne se devine
  // pas) ; puis 10 s de jeu réel avec pose de tour et pause/reprise.
  // -------------------------------------------------------------------------
  await block(4, async () => {
    const label = 'critère 4'
    await load('?niveau=1')
    await setViewport(page, MOBILE)

    const probe = () => page.evaluate(() => {
      const game = window.__game
      const positions = (name) => {
        const object = game.scene.getObjectByName(name)
        return object ? Array.from(object.geometry.attributes.position.array) : null
      }
      const sway = {}
      game.scene.traverse((object) => {
        if (!object.isInstancedMesh || !object.name.startsWith('vegetation-')) return
        const time = object.material?.userData?.time
        sway[object.name.slice('vegetation-'.length)] = typeof time === 'function' ? time() : null
      })
      return {
        petals: positions('ambience-petals'),
        fireflies: positions('ambience-fireflies'),
        sway,
        moving: game.state.ambience.moving,
        paused: game.state.paused,
        frames: game.state.frames,
      }
    })

    const displacement = (before, after) => {
      if (!before || !after || before.length !== after.length) return null
      let sum = 0
      for (let i = 0; i < before.length; i += 3) {
        sum += Math.hypot(after[i] - before[i], after[i + 1] - before[i + 1], after[i + 2] - before[i + 2])
      }
      return sum / (before.length / 3)
    }

    const first = await probe()
    await shot(page, 'ambiance-t0')
    await page.waitForTimeout(3000)
    const second = await probe()
    await shot(page, 'ambiance-t3')

    const moved = {
      petals: displacement(first.petals, second.petals),
      fireflies: displacement(first.fireflies, second.fireflies),
    }
    Object.assign(moved, {
      grass: first.sway.grass !== null && second.sway.grass !== null
        ? second.sway.grass - first.sway.grass
        : null,
    })
    const movingFamilies = []
    if (moved.petals !== null && moved.petals > 0.05) movingFamilies.push('petals')
    if (moved.fireflies !== null && moved.fireflies > 0.02) movingFamilies.push('fireflies')
    if (moved.grass !== null && moved.grass > 0.5) movingFamilies.push('grass')
    check(first.petals !== null && first.fireflies !== null,
      `${label} : les deux familles d'ambiance (pétales, lucioles) sont absentes de la scène`)
    check(second.moving === true, `${label} : state.ambience.moving est faux alors que le jeu tourne`)
    check(movingFamilies.length >= 2,
      `${label} : ${movingFamilies.length} famille(s) en mouvement sur 3 s (${Object.entries(moved).map(([key, value]) => `${key} ${value === null ? 'immobile' : value.toFixed(3)}`).join(', ')}) au lieu d'au moins 2`)
    console.log(`[ambiance] critère 4 — familles mobiles : ${movingFamilies.join(', ') || 'aucune'} (déplacements moyens pétales ${moved.petals?.toFixed(3)}, lucioles ${moved.fireflies?.toFixed(3)}, balancement herbe ${moved.grass === null ? 'non câblé' : moved.grass.toFixed(2)})`)

    // --- 10 s de jeu réel : pose d'une tour au clic, puis pause et reprise.
    const started = Date.now()
    await setViewport(page, DESKTOP)
    await openBar(page)
    await selectSeed(page, 'sprout')
    const slots = await slotPoints(page)
    const target = slots.find((slot) => slot.inFront && slot.inside && slot.canvas && !slot.occupied)
    check(Boolean(target), `${label} : aucun emplacement cliquable dans le champ du joueur`)
    if (target) {
      const resources = (await state()).resources
      await clickCanvas(page, target)
      await page.waitForFunction(() => window.__game.state.towers.length === 1)
      const placed = await state()
      check(placed.towers.length === 1, `${label} : ${placed.towers.length} tour(s) posée(s) après le clic sur ${target.id}`)
      check(placed.towers[0]?.slotId === target.id,
        `${label} : tour posée sur ${placed.towers[0]?.slotId} au lieu de ${target.id}`)
      check(placed.resources < resources, `${label} : sève inchangée (${placed.resources}) après la pose`)
      await nextFrames(page, 2)
      await shot(page, 'pose-tour')

      // Pause : la boucle continue de rendre, l'ambiance et les tours se figent.
      await page.evaluate(() => { window.__game.state.paused = true })
      const paused = await probe()
      check(paused.paused === true, `${label} : state.paused n'a pas basculé en pause`)
      check(paused.moving === false, `${label} : state.ambience.moving reste vrai en pause`)
      const hitPaused = (await slotPoints(page)).find((slot) => slot.id === target.id)
      check(hitPaused?.canvas === true,
        `${label} : en pause, ${hitPaused?.x?.toFixed(0)}×${hitPaused?.y?.toFixed(0)} est couvert par ${JSON.stringify(hitPaused?.element)} au lieu du canvas`)
      await page.waitForTimeout(400)
      const stillPaused = await probe()
      check(stillPaused.frames > paused.frames,
        `${label} : la boucle de rendu s'arrête en pause (${paused.frames} → ${stillPaused.frames} images)`)
      check(JSON.stringify(stillPaused.petals) === JSON.stringify(paused.petals),
        `${label} : les pétales continuent de bouger en pause`)
      await shot(page, 'pause')

      // Reprise : le mouvement revient et une entrée joueur passe encore.
      await page.evaluate(() => { window.__game.state.paused = false })
      await page.waitForTimeout(400)
      const resumed = await probe()
      check(resumed.paused === false, `${label} : state.paused ne revient pas à false après la reprise`)
      check(resumed.moving === true, `${label} : state.ambience.moving reste faux après la reprise`)
      check(JSON.stringify(resumed.petals) !== JSON.stringify(stillPaused.petals),
        `${label} : les pétales restent figés après la reprise`)
      const hitResumed = (await slotPoints(page)).find((slot) => slot.id === target.id)
      check(hitResumed?.canvas === true,
        `${label} : après reprise, l'emplacement ${target.id} n'est plus dans le canvas (${JSON.stringify(hitResumed?.element)})`)
    }

    // Les 10 s sont du temps mural réel : on les complète sans rien simuler.
    while (Date.now() - started < 10_000) await page.waitForTimeout(200)
    const after = await state()
    check(after.frames > 0, `${label} : aucune image rendue pendant les 10 s de jeu`)
    console.log(`[ambiance] critère 4 — 10 s de jeu réel (${((Date.now() - started) / 1000).toFixed(1)} s), pose ${target?.id ?? '—'}, pause/reprise OK`)
  })

  // -------------------------------------------------------------------------
  // Critère 5 — budget et boucle en 390×844 : draw calls, triangles, p95 du coût
  // par image sur 120 images, 0 erreur console, puis traversée complète du niveau
  // (vagues, pose de tours, fin de niveau) sans régression.
  // -------------------------------------------------------------------------
  await block(5, async () => {
    const label = 'critère 5'
    await load('?niveau=1')
    await setViewport(page, MOBILE)
    const timing = await page.evaluate(({ frames }) => {
      const { scene, camera, renderer } = window.__game
      const gl = renderer.getContext()
      const entities = scene.children.filter((object) => typeof object.update === 'function')
      if (!entities.length) throw new Error('aucune entité avec update dans la scène')
      const pixel = new Uint8Array(4)
      // Préchauffe hors mesure : programmes compilés, caméra stabilisée.
      for (const entity of entities) entity.update(1 / 60)
      renderer.render(scene, camera)
      const loop = []
      const total = []
      for (let i = 0; i < frames; i++) {
        const start = performance.now()
        for (const entity of entities) entity.update(1 / 60)
        const updated = performance.now()
        renderer.render(scene, camera)
        const end = performance.now()
        loop.push(updated - start)
        total.push(end - start)
      }
      const draws = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles }
      // Hors mesure : vide la file du raster logiciel avant de poursuivre.
      renderer.render(scene, camera)
      gl.finish()
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
      return { loop, total, draws }
    }, { frames: BUDGET.frames })

    const p95 = percentile(timing.total, 95)
    check(timing.total.length >= BUDGET.frames, `${label} : ${timing.total.length} image(s) mesurée(s) au lieu de ${BUDGET.frames}`)
    check(p95 <= BUDGET.p95,
      `${label} : coût par image p95 ${p95.toFixed(2)} ms > ${BUDGET.p95} ms (médian ${median(timing.total).toFixed(2)} ms, update p95 ${percentile(timing.loop, 95).toFixed(2)} ms)`)
    check(median(timing.total) <= BUDGET.p95 / 2,
      `${label} : coût médian ${median(timing.total).toFixed(2)} ms > ${BUDGET.p95 / 2} ms`)
    check(timing.draws.calls <= BUDGET.drawCalls,
      `${label} : ${timing.draws.calls} draw calls en 390×844 (> ${BUDGET.drawCalls})`)
    check(timing.draws.triangles <= BUDGET.triangles,
      `${label} : ${timing.draws.triangles} triangles en 390×844 (> ${BUDGET.triangles})`)

    await nextFrames(page, 2)
    const render = (await state()).render
    check(render.drawCalls <= BUDGET.drawCalls,
      `${label} : state.render.drawCalls ${render.drawCalls} > ${BUDGET.drawCalls}`)
    check(render.triangles <= BUDGET.triangles,
      `${label} : state.render.triangles ${render.triangles} > ${BUDGET.triangles}`)
    await shot(page, 'budget')
    console.log(`[ambiance] critère 5 — 390×844 : ${render.drawCalls} draw calls, ${render.triangles} triangles, coût p95 ${p95.toFixed(2)} ms (médian ${median(timing.total).toFixed(2)} ms)`)

    check(consoleErrors.length === 0,
      `${label} : ${consoleErrors.length} erreur(s) console (${consoleErrors.slice(0, 3).join(' | ')})`)

    // Vagues, pose de tours et fin de niveau : la boucle de gameplay complète est
    // rejouée ici sur le même build. Les scénarios dédiés (clairiere.mjs, ombres.mjs,
    // tours.mjs) font partie de la même `npm run check` : scripts/play.mjs impose le
    // port 4173, partagé par les worktrees en mode parallèle, donc un scénario ne peut
    // pas en relancer un autre sans risquer de tester le build d'un autre ticket.
    await load('?niveau=1')
    await setViewport(page, MOBILE)
    const run = await page.evaluate(({ maxSteps }) => {
      const game = window.__game
      game.state.paused = true
      const entities = game.scene.children.filter((object) => typeof object.update === 'function')
      // Trois Pousses par l'API du jeu : même code de pose que le clic du critère 4.
      game.towers.selectType('sprout')
      const placed = ['slot-1', 'slot-2', 'slot-3'].map((id) => game.towers.place(id))
      const towers = game.state.towers.length
      const sim = {
        step(dt = 1 / 60) {
          for (const entity of entities) entity.update?.(dt)
        },
      }
      let steps = 0
      let waves = new Set([game.state.wave.index])
      while (steps < maxSteps && game.state.run.outcome === null) {
        sim.step(1 / 60)
        waves.add(game.state.wave.index)
        steps++
      }
      // Les fondus de fin (updateDying) ont besoin de quelques images de plus.
      for (let i = 0; i < 40; i++) sim.step(1 / 60)
      return {
        placed,
        towers,
        outcome: game.state.run.outcome,
        wave: game.state.wave.index,
        total: game.state.wave.total,
        core: game.state.core.hp,
        creatures: game.state.creatures.length,
        shots: game.state.towers.reduce((sum, tower) => sum + tower.shots, 0),
        waves: [...waves].sort((a, b) => a - b),
        elapsed: game.state.run.elapsed,
      }
    }, { maxSteps: 25_200 }) // 420 s de jeu simulées à 1/60 s

    check(run.placed.every(Boolean) && run.towers === 3,
      `${label} : ${run.towers} tour(s) posée(s) par l'API au lieu de 3`)
    check(run.waves.length >= 2, `${label} : les vagues n'avancent pas (${run.waves.join(', ')})`)
    check(run.shots > 0, `${label} : aucune tour n'a tiré pendant la partie (${run.shots} tirs)`)
    check(run.outcome === 'victory',
      `${label} : fin de niveau « ${run.outcome} » (vague ${run.wave}/${run.total}, cœur ${run.core}, ${run.creatures} ombres) au lieu de victory`)
    check(run.wave === run.total, `${label} : victoire en vague ${run.wave} au lieu de ${run.total}`)
    await page.waitForFunction(() => {
      const end = document.querySelector('.end-screen')
      return end !== null && !end.hidden
    }, null, { timeout: 10_000 })
    const endScreen = await page.evaluate(() => ({
      title: document.querySelector('.end-screen__title')?.textContent ?? null,
      wave: document.querySelector('.end-screen__wave')?.textContent ?? null,
      replay: Boolean(document.querySelector('.end-screen__replay')),
    }))
    check(Boolean(endScreen.title), `${label} : écran de fin sans titre`)
    check(Boolean(endScreen.wave), `${label} : écran de fin sans compte de vagues`)
    check(endScreen.replay, `${label} : écran de fin sans bouton « Rejouer »`)
    console.log(`[ambiance] critère 5 — boucle de jeu : ${run.waves.length} vagues jusqu'à ${run.outcome} (${run.shots} tirs, ${run.elapsed.toFixed(0)} s simulées), écran de fin « ${endScreen.title} »`)
    await shot(page, 'fin-de-niveau')
  })

  // -------------------------------------------------------------------------
  // Critère 6 — la note de direction artistique décrit les quatre familles, les
  // valeurs de lumière et l'ambiance, pour que les décors suivants en héritent.
  // -------------------------------------------------------------------------
  await block(6, async () => {
    const label = 'critère 6'
    const note = da.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    for (const id of EXPECTED_FAMILIES) {
      check(da.includes(`(\`${id}\`)`), `${label} : famille « ${id} » absente du tableau des familles`)
    }
    check(/Arbre|Buisson|Fleur|Graminee/.test(note), `${label} : les silhouettes des familles ne sont pas décrites`)
    check(da.includes('PCFSoftShadowMap'), `${label} : type d'ombre « PCFSoftShadowMap » absent`)
    check(/`shadowRadius`\s*\|\s*4/.test(da), `${label} : valeur de shadowRadius absente`)
    check(/`intensity`\s*\|\s*2,1/.test(da), `${label} : intensité 2,1 absente`)
    for (const hex of ['#f6d9a8', '#faf3e3', LIGHT_GROUND]) {
      check(da.includes(hex), `${label} : teinte de lumière ${hex} absente`)
    }
    check(/^### Ambiance$/m.test(da), `${label} : section « Ambiance » absente`)
    check(/P[ée]tales/.test(da) && /Lucioles/.test(da), `${label} : familles d'ambiance (pétales, lucioles) non documentées`)
    check(/390\u00d7844|300 draw calls/.test(da), `${label} : budget d'ambiance non documenté`)
    console.log('[ambiance] critère 6 — Direction-Artistique.md : 4 familles, lumière et ambiance documentées')
  })

  if (failures.length) throw new Error(failures.join(' | '))
}
