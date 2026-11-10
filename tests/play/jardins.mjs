// Playtest de l'Epic #112 — six jardins, six visages.
// Un bloc par critère d'acceptation, dans l'ordre de l'Epic : chaque jardin est lancé
// depuis l'accueil (campagne Sèveclaire → jardin → difficulté moyenne), une capture
// 390×844 est prise, puis les critères sont vérifiés dans `window.__game.state`.
// Aucune valeur de `src/data/` n'est lue pour comparer : les seules valeurs attendues
// sont la table du ticket #119 (sols, heures, décor) — `campaigns.js` n'est importé que
// pour le critère de câblage, qui porte sur la structure des cartes, pas sur un réglage.
// Captures : test-results/<préfixe issue-N->jardins-<n>.png (dossier du dépôt principal).
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { CAMPAIGNS } from '../../src/data/campaigns.js'
import { outputDir } from '../../scripts/lib.mjs'

const MOBILE = { width: 390, height: 844 }
const BUDGET = { drawCalls: 300, triangles: 500_000, p95: 16.7, frames: 60 }
const PROGRESS_KEY = 'seveclaire.progress.v1'
/** Table des attendus du ticket #119 — seules valeurs autorisées pour comparer. */
const EXPECTED_GROUND = ['#faf3e3', '#f1ecd6', '#eaefd8', '#f6efdd', '#e4ebd4', '#d7e1c6']
const EXPECTED_DECOR = [156, 165, 180, 195, 210, 230]
const FAMILIES = ['tree', 'bush', 'flower', 'grass']
/** Deux tracés sont « confondus » quand aucune de leurs polylignes ne s'écarte de 0,75 m de l'autre. */
const PATH_CONFUSION_M = 0.75
const SEGMENT_MIN_M = 3
const PATH_GROUND_MIN_DE = 30
const GROUND_STEP_MIN_DE = 3

const { results, prefix } = outputDir()
mkdirSync(results, { recursive: true })

// ---------------------------------------------------------------------------
// Couleur : sRGB → CIE Lab (D65), ΔE76 — mêmes formules que clairiere.mjs.
// ---------------------------------------------------------------------------
function hexToRgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
}

function hexToLab(hex) {
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255)
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const [R, G, B] = [lin(r), lin(g), lin(b)]
  const X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375
  const Y = R * 0.2126729 + G * 0.7151522 + B * 0.072175
  const Z = R * 0.0193339 + G * 0.119192 + B * 0.9503041
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29)
  const [fx, fy, fz] = [X / 0.95047, Y / 1, Z / 1.08883].map(f)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

function deltaE76(a, b) {
  const [l1, a1, b1] = hexToLab(a)
  const [l2, a2, b2] = hexToLab(b)
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}

// ---------------------------------------------------------------------------
// Géométrie : distance point → segment, distance d'un point à une polyligne,
// échantillonnage dense et distance de Hausdorff symétrique entre deux tracés.
// ---------------------------------------------------------------------------
function pointSegmentDistance(x, z, [ax, az], [bx, bz]) {
  const dx = bx - ax
  const dz = bz - az
  const lengthSq = dx * dx + dz * dz
  const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / lengthSq)) : 0
  return Math.hypot(x - (ax + dx * t), z - (az + dz * t))
}

function polylineDistance(x, z, points) {
  let best = Infinity
  for (let i = 1; i < points.length; i++) {
    best = Math.min(best, pointSegmentDistance(x, z, points[i - 1], points[i]))
  }
  return best
}

/** Échantillonne la polyligne tous les `step` mètres (au moins 2 points par segment). */
function samplePolyline(points, step = 0.5) {
  const out = []
  for (let i = 1; i < points.length; i++) {
    const [ax, az] = points[i - 1]
    const [bx, bz] = points[i]
    const count = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / step))
    for (let k = 0; k < count; k++) {
      out.push([ax + ((bx - ax) * k) / count, az + ((bz - az) * k) / count])
    }
  }
  return out
}

function hausdorff(a, b) {
  const directed = (from, to) => {
    let max = 0
    for (const [x, z] of from) max = Math.max(max, polylineDistance(x, z, to))
    return max
  }
  return Math.max(directed(a, b), directed(b, a))
}

function segmentsAtLeast(points, min) {
  let count = 0
  for (let i = 1; i < points.length; i++) {
    if (Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]) >= min) count++
  }
  return count
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

const round = (value, digits = 2) => Number(value.toFixed(digits))

/** Attend le nombre d'images de rendu demandé (aucune attente arbitraire). */
const nextFrames = (page, count = 2) => page.evaluate((n) => new Promise((resolve) => {
  let seen = 0
  const loop = () => (++seen >= n ? resolve() : requestAnimationFrame(loop))
  requestAnimationFrame(loop)
}), count)

export default async function ({ page, load, state }) {
  const failures = []
  const check = (condition, message) => {
    if (!condition) failures.push(message)
  }
  const shot = (label) => page.screenshot({ path: join(results, `${prefix}${label}.png`) })

  const levels = CAMPAIGNS.find((campaign) => campaign.id === 'seveclaire')?.levels ?? []

  // -------------------------------------------------------------------------
  // Parcours — les 6 jardins depuis l'accueil, en difficulté moyenne, capture
  // 390×844 et relevé complet de l'état. La progression est amorcée pour que le
  // jardin visé soit déverrouillé : chaque jardin est ainsi inspecté indépendamment.
  // -------------------------------------------------------------------------
  const gardens = []
  try {
    await load('?lang=fr')
    await page.setViewportSize(MOBILE)
    await nextFrames(page, 2)

    for (const [index, entry] of levels.entries()) {
      await page.evaluate(({ key, completed }) => {
        localStorage.setItem(key, JSON.stringify({ version: 1, completed }))
      }, { key: PROGRESS_KEY, completed: levels.slice(0, index).map((level) => level.id) })
      await load('?lang=fr')

      await page.click('[data-campaign="seveclaire"] .campaign-card__open')
      await page.waitForFunction(() => window.__game.state.screen === 'levels')
      await page.click(`[data-level="${entry.id}"]`)
      await page.click('[data-difficulty="medium"]')
      await page.click('[data-action="start"]')
      await page.waitForFunction(() => window.__game.state.screen === 'game')
      await nextFrames(page, 3)

      const snap = await state()
      const frame = await shot(`jardins-${index + 1}`)
      const png = await page.evaluate(async (base64) => {
        const response = await fetch(`data:image/png;base64,${base64}`)
        const bitmap = await createImageBitmap(await response.blob())
        return { width: bitmap.width, height: bitmap.height }
      }, frame.toString('base64'))

      // Coût CPU par image en 390×844 : update des entités + renderer.render(),
      // mesuré dans la page, file GPU vidée hors mesure.
      const total = await page.evaluate(({ frames }) => {
        const { scene, camera, renderer } = window.__game
        const gl = renderer.getContext()
        const pixel = new Uint8Array(4)
        const entities = scene.children.filter((object) => typeof object.update === 'function')
        for (const entity of entities) entity.update(1 / 60)
        renderer.render(scene, camera)
        const samples = []
        for (let i = 0; i < frames; i++) {
          const start = performance.now()
          for (const entity of entities) entity.update(1 / 60)
          renderer.render(scene, camera)
          samples.push(performance.now() - start)
        }
        renderer.render(scene, camera)
        gl.finish()
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel)
        return samples
      }, { frames: BUDGET.frames })

      // Fin de partie en difficulté moyenne : trois Pousses posées par l'API du jeu
      // (les ressources n'en financent pas quatre), puis la boucle est avancée à pas
      // fixes jusqu'au verdict. Même méthode que le critère 5 d'ambiance.mjs.
      const run = await page.evaluate(({ maxSteps }) => {
        const game = window.__game
        game.state.paused = true
        const entities = game.scene.children.filter((object) => typeof object.update === 'function')
        game.towers.selectType('sprout')
        const placed = game.state.slots.map((slot) => game.towers.place(slot.id))
        const towers = game.state.towers.length
        let steps = 0
        const waves = new Set([game.state.wave.index])
        while (steps < maxSteps && game.state.run.outcome === null) {
          for (const entity of entities) entity.update(1 / 60)
          waves.add(game.state.wave.index)
          steps++
        }
        // Les fondus de fin (updateDying) ont besoin de quelques images de plus.
        for (let i = 0; i < 40; i++) for (const entity of entities) entity.update(1 / 60)
        return {
          placed,
          towers,
          difficulty: game.state.difficulty,
          outcome: game.state.run.outcome,
          wave: game.state.wave.index,
          total: game.state.wave.total,
          core: game.state.core.hp,
          creatures: game.state.creatures.length,
          shots: game.state.towers.reduce((sum, tower) => sum + tower.shots, 0),
          waves: [...waves].sort((a, b) => a - b),
          elapsed: game.state.run.elapsed,
          steps,
        }
      }, { maxSteps: 30_000 })

      gardens.push({
        index,
        entry,
        snap,
        png,
        p95: percentile(total, 95),
        median: median(total),
        run,
      })
    }
    check(gardens.length === 6, `parcours : ${gardens.length} jardin(s) lancé(s) depuis l'accueil au lieu de 6`)
  } catch (error) {
    failures.push(`parcours : ${error.message}`)
  }

  const byIndex = (index) => gardens.find((garden) => garden.index === index)
  const describe = (garden) => garden ? `carte ${garden.index + 1} (${garden.entry?.id})` : 'carte manquante'

  // -------------------------------------------------------------------------
  // Critère 1 — `state.level.mapId` : 6 valeurs distinctes, et `campaigns.js` ne
  // garde qu'un seul jardin sur `map: 'level-1'`, les cinq autres sur leur carte.
  // -------------------------------------------------------------------------
  try {
    const mapIds = gardens.map((garden) => garden.snap.level.mapId)
    check(mapIds.length === 6, `critère 1 : ${mapIds.length} mapId relevé(s) au lieu de 6`)
    check(mapIds.every((id) => typeof id === 'string' && id.length > 0),
      `critère 1 : mapId vide (${JSON.stringify(mapIds)})`)
    check(new Set(mapIds).size === 6,
      `critère 1 : ${new Set(mapIds).size} mapId distinct(s) au lieu de 6 : ${mapIds.join(', ')}`)
    for (const garden of gardens) {
      check(garden.snap.level.id === garden.entry.id,
        `critère 1 : ${describe(garden)} lancée sur state.level.id « ${garden.snap.level.id} »`)
    }

    const maps = levels.map((level) => level.map)
    check(levels.length === 6, `critère 1 : ${levels.length} jardin(s) dans la campagne Sèveclaire au lieu de 6`)
    check(maps.filter((map) => map === 'level-1').length === 1,
      `critère 1 : ${maps.filter((map) => map === 'level-1').length} jardin(s) restent sur map « level-1 » (${maps.join(', ')})`)
    check(new Set(maps).size === maps.length,
      `critère 1 : cartes répétées dans campaigns.js (${maps.join(', ')})`)
    console.log(`[jardins] critère 1 — mapId : ${mapIds.join(', ')}`)
  } catch (error) {
    failures.push(`critère 1 : ${error.message}`)
  }

  // -------------------------------------------------------------------------
  // Critère 2 — tracés : au moins 3 segments de ≥ 3 m par carte, ΔE76 chemin/sol
  // ≥ 30, et aucune paire de polylignes confondue (Hausdorff > 0,75 m).
  // -------------------------------------------------------------------------
  try {
    const polylines = []
    for (const garden of gardens) {
      const points = garden.snap.level.path.points
      const segments = segmentsAtLeast(points, SEGMENT_MIN_M)
      check(segments >= 3,
        `critère 2 : ${describe(garden)} n'a que ${segments} segment(s) de ≥ ${SEGMENT_MIN_M} m`)
      const pathColor = garden.snap.level.palette.path
      const ground = garden.snap.level.palette.ground
      const contrast = deltaE76(pathColor, ground)
      check(contrast >= PATH_GROUND_MIN_DE,
        `critère 2 : ${describe(garden)} ΔE76(chemin ${pathColor}, sol ${ground}) = ${contrast.toFixed(1)} < ${PATH_GROUND_MIN_DE}`)
      polylines.push({ garden, samples: samplePolyline(points) })
      console.log(`[jardins] critère 2 — ${describe(garden)} : ${segments} segments ≥ ${SEGMENT_MIN_M} m, ΔE(chemin/sol) ${contrast.toFixed(1)}`)
    }

    let pairsCompared = 0
    let confused = 0
    for (let i = 0; i < polylines.length; i++) {
      for (let j = i + 1; j < polylines.length; j++) {
        pairsCompared++
        const distance = hausdorff(polylines[i].samples, polylines[j].samples)
        if (distance <= PATH_CONFUSION_M) {
          confused++
          check(false,
            `critère 2 : tracés des cartes ${i + 1} et ${j + 1} confondus (Hausdorff ${distance.toFixed(2)} m ≤ ${PATH_CONFUSION_M} m)`)
        }
      }
    }
    check(pairsCompared === 15, `critère 2 : ${pairsCompared} paire(s) de tracés comparée(s) au lieu de 15`)
    check(polylines.length >= 3 && polylines.length - confused >= 3,
      `critère 2 : ${polylines.length - confused} tracé(s) distinct(s) au lieu de 3`)
    console.log(`[jardins] critère 2 — ${pairsCompared} paires de tracés comparées, ${confused} confondue(s)`)
  } catch (error) {
    failures.push(`critère 2 : ${error.message}`)
  }

  // -------------------------------------------------------------------------
  // Critère 3 — sols et lumières : 6 teintes de sol distinctes (ΔE76 ≥ 3 entre
  // voisins consécutifs) et 6 heures de lumière propres à chaque jardin.
  // -------------------------------------------------------------------------
  try {
    const grounds = gardens.map((garden) => garden.snap.level.palette.ground)
    const hours = gardens.map((garden) => garden.snap.lighting.hour)
    check(grounds.length === 6, `critère 3 : ${grounds.length} teinte(s) relevée(s) au lieu de 6`)
    check(new Set(grounds).size === 6, `critère 3 : ${new Set(grounds).size} teinte(s) de sol distincte(s) : ${grounds.join(', ')}`)
    for (const [index, garden] of gardens.entries()) {
      const expected = EXPECTED_GROUND[index]
      check(garden.snap.level.palette.ground === expected,
        `critère 3 : ${describe(garden)} sol ${garden.snap.level.palette.ground} au lieu de ${expected} (table du ticket)`)
      if (index > 0) {
        const step = deltaE76(grounds[index - 1], grounds[index])
        check(step >= GROUND_STEP_MIN_DE,
          `critère 3 : ΔE76 entre sols ${index} et ${index + 1} = ${step.toFixed(2)} < ${GROUND_STEP_MIN_DE} (${grounds[index - 1]} → ${grounds[index]})`)
      }
    }

    check(hours.length === 6, `critère 3 : ${hours.length} heure(s) relevée(s) au lieu de 6`)
    check(hours.every((hour) => Number.isFinite(hour)), `critère 3 : heure de lumière absente (${JSON.stringify(hours)})`)
    check(new Set(hours).size === 6, `critère 3 : ${new Set(hours).size} heure(s) distincte(s) : ${hours.join(', ')}`)
    console.log(`[jardins] critère 3 — sols ${grounds.join(', ')} ; heures ${hours.join(', ')}`)
  } catch (error) {
    failures.push(`critère 3 : ${error.message}`)
  }

  // -------------------------------------------------------------------------
  // Critère 4 — densité hors graminées par m² de `bounds` : carte 6 ≥ 1,3 × carte 1,
  // aucune baisse > 10 % entre voisins, et les 4 familles présentes sur les 6 cartes.
  // -------------------------------------------------------------------------
  try {
    const densities = []
    let familiesMissing = 0
    for (const garden of gardens) {
      const { density, counts } = garden.snap.decor
      const { bounds } = garden.snap.level
      const area = (bounds.maxX - bounds.minX) * (bounds.maxZ - bounds.minZ)
      check(Math.abs(density.area - area) <= 0.5,
        `critère 4 : ${describe(garden)} densité calculée sur ${density.area} m² au lieu de ${area.toFixed(0)} m² de bounds`)
      const covered = FAMILIES.reduce((sum, id) => sum + (counts[id] ?? 0), 0) - (counts.grass ?? 0)
      const measured = area > 0 ? covered / area : 0
      check(Math.abs(density.total - measured) <= 0.002,
        `critère 4 : ${describe(garden)} densité publiée ${density.total}/m² au lieu de ${measured.toFixed(4)}/m² (arbres + buissons + fleurs)`)
      for (const id of FAMILIES) {
        if ((counts[id] ?? 0) <= 0) {
          familiesMissing++
          check(false, `critère 4 : ${describe(garden)} famille « ${id} » absente (count ${counts[id]})`)
        }
      }
      densities.push(density.total)
    }
    check(gardens.length === 6, `critère 4 : ${gardens.length} densité(s) relevée(s) au lieu de 6`)
    check(densities.length === 6 && densities[5] >= 1.3 * densities[0],
      `critère 4 : carte 6 à ${densities[5]?.toFixed(4)}/m² < 1,3 × carte 1 (${densities[0]?.toFixed(4)}/m²)`)
    for (let i = 1; i < densities.length; i++) {
      check(densities[i] >= densities[i - 1] * 0.9,
        `critère 4 : densité ${densities[i - 1].toFixed(4)} → ${densities[i].toFixed(4)}/m² entre cartes ${i} et ${i + 1} : baisse > 10 %`)
    }
    check(gardens[0] && (gardens[0].snap.decor.counts.tree + gardens[0].snap.decor.counts.bush + gardens[0].snap.decor.counts.flower) === EXPECTED_DECOR[0],
      `critère 4 : carte 1 décor hors graminées ${gardens[0] ? gardens[0].snap.decor.counts.tree + gardens[0].snap.decor.counts.bush + gardens[0].snap.decor.counts.flower : '?'} au lieu de ${EXPECTED_DECOR[0]} (inchangé)`)
    console.log(`[jardins] critère 4 — densités hors graminées : ${densities.map((value) => value.toFixed(4)).join(', ')} /m² ; ratio 6/1 ${(densities[5] / densities[0]).toFixed(2)} ; ${familiesMissing} famille(s) manquante(s)`)
  } catch (error) {
    failures.push(`critère 4 : ${error.message}`)
  }

  // -------------------------------------------------------------------------
  // Critère 5 — cœurs distincts (≥ 3 m d'écart, ≥ 4 m du bord) et 4 emplacements
  // par carte à 2,5–3,2 m de la polyligne, ≥ 4,9 m du cœur, ≥ 2,2 m entre eux.
  // -------------------------------------------------------------------------
  try {
    const hearts = []
    for (const garden of gardens) {
      const { heart, bounds, path, slots } = garden.snap.level
      hearts.push({ x: heart.x, z: heart.z })
      const edge = Math.min(heart.x - bounds.minX, bounds.maxX - heart.x, heart.z - bounds.minZ, bounds.maxZ - heart.z)
      check(edge >= 4,
        `critère 5 : ${describe(garden)} cœur à ${edge.toFixed(2)} m du bord (< 4 m)`)
      check(slots.length === 4, `critère 5 : ${describe(garden)} ${slots.length} emplacement(s) au lieu de 4`)
      const nearestPath = slots.map((slot) => polylineDistance(slot.x, slot.z, path.points))
      for (const [slotIndex, slot] of slots.entries()) {
        const distance = nearestPath[slotIndex]
        check(distance >= 2.5 && distance <= 3.2,
          `critère 5 : ${describe(garden)} ${slot.id} à ${distance.toFixed(2)} m de la polyligne (attendu 2,5–3,2 m)`)
        const toHeart = Math.hypot(slot.x - heart.x, slot.z - heart.z)
        check(toHeart >= 4.9,
          `critère 5 : ${describe(garden)} ${slot.id} à ${toHeart.toFixed(2)} m du cœur (< 4,9 m)`)
      }
      for (let a = 0; a < slots.length; a++) {
        for (let b = a + 1; b < slots.length; b++) {
          const apart = Math.hypot(slots[a].x - slots[b].x, slots[a].z - slots[b].z)
          check(apart >= 2.2,
            `critère 5 : ${describe(garden)} ${slots[a].id} et ${slots[b].id} à ${apart.toFixed(2)} m (< 2,2 m)`)
        }
      }
      console.log(`[jardins] critère 5 — ${describe(garden)} cœur (${heart.x}, ${heart.z}) à ${edge.toFixed(1)} m du bord ; emplacements ${nearestPath.map((value) => value.toFixed(2)).join('/')} m du chemin`)
    }

    let closest = { distance: Infinity, pair: null }
    for (let i = 0; i < hearts.length; i++) {
      for (let j = i + 1; j < hearts.length; j++) {
        const distance = Math.hypot(hearts[i].x - hearts[j].x, hearts[i].z - hearts[j].z)
        if (distance < closest.distance) closest = { distance, pair: `${i + 1}-${j + 1}` }
      }
    }
    check(hearts.length === 6, `critère 5 : ${hearts.length} cœur(s) relevé(s) au lieu de 6`)
    check(closest.distance >= 3,
      `critère 5 : cœurs ${closest.pair} à ${closest.distance?.toFixed(2)} m (< 3 m)`)
    console.log(`[jardins] critère 5 — cœur le plus proche : cartes ${closest.pair} à ${closest.distance.toFixed(2)} m`)
  } catch (error) {
    failures.push(`critère 5 : ${error.message}`)
  }

  // -------------------------------------------------------------------------
  // Critère 6 — budget mobile 390×844 sur les 6 jardins (≤ 300 draw calls,
  // ≤ 500 000 triangles, p95 ≤ 16,7 ms) et fin de partie en difficulté moyenne.
  // -------------------------------------------------------------------------
  try {
    for (const garden of gardens) {
      const { view, render } = garden.snap
      check(view.width === MOBILE.width && view.height === MOBILE.height,
        `critère 6 : ${describe(garden)} viewport ${view.width}×${view.height} au lieu de ${MOBILE.width}×${MOBILE.height}`)
      check(garden.png.width === MOBILE.width && garden.png.height === MOBILE.height,
        `critère 6 : ${describe(garden)} capture ${garden.png.width}×${garden.png.height} au lieu de ${MOBILE.width}×${MOBILE.height}`)
      check(render.drawCalls <= BUDGET.drawCalls,
        `critère 6 : ${describe(garden)} ${render.drawCalls} draw calls > ${BUDGET.drawCalls}`)
      check(render.triangles <= BUDGET.triangles,
        `critère 6 : ${describe(garden)} ${render.triangles} triangles > ${BUDGET.triangles}`)
      check(garden.p95 <= BUDGET.p95,
        `critère 6 : ${describe(garden)} p95 ${garden.p95.toFixed(2)} ms > ${BUDGET.p95} ms (médian ${garden.median.toFixed(2)} ms)`)

      const { run } = garden
      check(run.difficulty === 'medium',
        `critère 6 : ${describe(garden)} difficulté « ${run.difficulty} » au lieu de « medium »`)
      check(run.towers === 3, `critère 6 : ${describe(garden)} ${run.towers} tour(s) posée(s) au lieu de 3`)
      check(run.outcome === 'victory',
        `critère 6 : ${describe(garden)} fin « ${run.outcome} » (vague ${run.wave}/${run.total}, cœur ${run.core}, ${run.creatures} ombre(s)) au lieu de victory`)
      check(run.wave === run.total, `critère 6 : ${describe(garden)} victoire en vague ${run.wave} au lieu de ${run.total}`)
      check(run.waves.length === run.total, `critère 6 : ${describe(garden)} ${run.waves.length} vague(s) jouée(s) au lieu de ${run.total}`)
      check(run.shots > 0, `critère 6 : ${describe(garden)} aucune tour n'a tiré (${run.shots} tirs)`)
      console.log(`[jardins] critère 6 — ${describe(garden)} : ${render.drawCalls} draw calls, ${render.triangles} triangles, p95 ${garden.p95.toFixed(2)} ms (médian ${garden.median.toFixed(2)} ms), victoire en ${run.elapsed.toFixed(0)} s simulées`)
    }
  } catch (error) {
    failures.push(`critère 6 : ${error.message}`)
  }

  // -------------------------------------------------------------------------
  // Critère 7 (visuel) — une capture par jardin, en 390×844 : le tracé, la teinte
  // du sol et la lumière doivent se distinguer d'une carte à l'autre. Le jugement
  // est fait sur les captures ; le contrôle ci-dessous garantit qu'elles existent
  // toutes et que les 6 sols rendus diffèrent d'au moins ΔE76 3.
  // -------------------------------------------------------------------------
  try {
    check(gardens.length === 6, `critère 7 : ${gardens.length} capture(s) au lieu de 6`)
    const grounds = gardens.map((garden) => garden.snap.level.palette.ground)
    for (let i = 1; i < grounds.length; i++) {
      const step = deltaE76(grounds[i - 1], grounds[i])
      check(step >= GROUND_STEP_MIN_DE,
        `critère 7 : sols des cartes ${i} et ${i + 1} indistinguables (ΔE76 ${step.toFixed(2)})`)
    }
    console.log(`[jardins] critère 7 — captures : ${gardens.map((garden) => `${prefix}jardins-${garden.index + 1}.png`).join(', ')}`)
  } catch (error) {
    failures.push(`critère 7 : ${error.message}`)
  }

  if (failures.length) throw new Error(failures.join(' | '))
}
