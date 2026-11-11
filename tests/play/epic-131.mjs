// Playtest de l'Epic #131 — projectiles visibles, trois silhouettes d'ombres, juice
// des événements et sélecteur de vitesse ×1/×2/×3. Un bloc par critère d'acceptation,
// dans l'ordre de l'Epic.
//
// La partie est simulée à pas fixe dans la page (`state.paused`, puis `window.__sim.step`),
// comme dans `ombres.mjs` : les captures et les mesures de gameplay sont déterministes.
// Seul le critère 5 (facteurs de vitesse) laisse tourner la vraie boucle rAF, et le
// critère 6 (budget mobile) rend réellement chaque image mesurée.
// Captures : `test-results/epic-131-<label>.png` par le runner, recopiées en
// `issue-158-epic-131-<label>.png` dans le `test-results/` du dépôt principal
// (mode worktree parallèle, même convention que jardins.mjs).
import { copyFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LEVEL_1 } from '../../src/data/level-1.js'
import { outputDir } from '../../scripts/lib.mjs'

const DESKTOP = { width: 1280, height: 720 } // viewport du runner
const MOBILE = { width: 390, height: 844 }
/** Pas de simulation : la boucle du jeu tourne à 60 images/s. */
const DT = 1 / 60
/** Durées exigées par l'Epic, en secondes. */
const FLIGHT_MAX = 0.4
const MARK_MAX = 0.5
const SHAKE_MAX = 0.06
const SHAKE_MAX_TIME = 0.18
const FR_JSON = fileURLToPath(new URL('../../src/i18n/fr.json', import.meta.url))
/** test-results/ du dépôt principal ; préfixe `issue-N-` en worktree parallèle. */
const { results, prefix } = outputDir()

/** Remplit un gabarit i18n « {value} », comme `t()`. */
const fill = (template, vars = {}) =>
  template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? `{${key}}`))

/** Attend le nombre de frames de rendu demandé (aucune attente arbitraire). */
const nextFrames = (page, count = 2) => page.evaluate((n) => new Promise((resolve) => {
  let seen = 0
  const loop = () => (++seen >= n ? resolve() : requestAnimationFrame(loop))
  requestAnimationFrame(loop)
}), count)

async function setViewport(page, { width, height }) {
  await page.setViewportSize({ width, height })
  await nextFrames(page, 2)
}

/** Percentile par rang le plus proche, comme `ambiance.mjs`. */
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

/**
 * Coupe la boucle rAF et installe `window.__sim.step(dt)` : chaque appel avance tous
 * les groupes de la scène, exactement comme une image de `game.js`, mais à pas fixe.
 */
function installClock(page) {
  return page.evaluate(() => {
    const game = window.__game
    game.state.paused = true
    const entities = game.scene.children.filter((object) => typeof object.update === 'function')
    window.__sim = {
      step(dt = 1 / 60) {
        for (const entity of entities) entity.update?.(dt)
      },
    }
  })
}

/** Le jeu tourne de nouveau en temps réel : la boucle applique `state.speed` elle-même. */
const resume = (page) => page.evaluate(() => {
  window.__game.state.paused = false
})

/** Clic de pose : appui et relâchement au même pixel (jamais un glissement). */
async function clickCanvas(page, point) {
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.up()
}

/**
 * Attend la barre des tours, permanente depuis #148 : visible dès le montage
 * (data-open="true", panneau opaque non vide) et sans poignée de repli.
 */
async function openBar(page) {
  await page.waitForFunction(() => {
    const bar = document.querySelector('.tower-bar')
    const panel = bar?.querySelector('.tower-bar__panel')
    if (!bar || !panel) return false
    const rect = panel.getBoundingClientRect()
    const style = getComputedStyle(panel)
    return bar.dataset.open === 'true'
      && style.visibility !== 'hidden'
      && style.opacity === '1'
      && rect.width > 0 && rect.height > 0
  })
  await page.waitForFunction(() =>
    document.querySelector('.tower-bar__handle') === null
    && document.querySelector('button[data-action="toggle-towers"]') === null)
}

async function selectSeed(page, type) {
  await page.click(`.tower-bar__entry[data-tower="${type}"]`)
  await page.waitForFunction((id) => window.__game.state.towerBar.selectedType === id, type)
}

/** Emplacements du niveau projetés à l'écran, avec l'élément réellement pointé. */
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
        worldX: slot.x,
        worldZ: slot.z,
        x,
        y,
        inFront: projected.z < 1,
        inside: x >= 0 && y >= 0 && x < innerWidth && y < innerHeight,
        canvas: element?.tagName === 'CANVAS',
      }
    })
  })
}

/** Emplacement libre le plus proche du cœur : l'ombre de tête y reste dans le champ. */
async function pickSlot(page) {
  const slots = await slotPoints(page)
  return slots
    .filter((slot) => slot.inFront && slot.inside && slot.canvas)
    .sort((a, b) => (a.worldZ - b.worldZ) || (Math.abs(a.worldX) - Math.abs(b.worldX)))[0] ?? null
}

/** Pose réelle d'une Pousse par un clic du joueur, au retour de l'emplacement cliqué. */
async function placeSproutByClick(page) {
  await openBar(page)
  await selectSeed(page, 'sprout')
  const target = await pickSlot(page)
  if (!target) throw new Error('aucun emplacement libre cliquable')
  await clickCanvas(page, target)
  await page.waitForFunction(() => window.__game.state.towers.length === 1)
  return target
}

/** L'écran de fin a fini son animation d'entrée : capture non translucide. */
async function waitEndScreen(page) {
  await page.waitForFunction(() => {
    const end = document.querySelector('.end-screen')
    return end !== null && !end.hidden && getComputedStyle(end).opacity === '1'
  })
}

export default async function ({ page, load, state, shot }) {
  page.setDefaultTimeout(10_000)

  const failures = []
  const check = (condition, message) => {
    if (!condition) failures.push(message)
  }
  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))

  const fr = JSON.parse(await readFile(FR_JSON, 'utf8'))

  /**
   * Capture du critère par le helper du runner, puis copie préfixée `issue-158-`
   * dans le `test-results/` du dépôt principal (mode parallèle, comme jardins.mjs).
   */
  const capture = async (label) => {
    await shot(label)
    if (!prefix) return
    copyFileSync(join('test-results', `epic-131-${label}.png`),
      join(results, `${prefix}epic-131-${label}.png`))
  }

  /**
   * Le sélecteur de vitesse a fini sa transition (fond de l'entrée active, animation
   * d'entrée à opacité 1) : la capture montre l'entrée réellement active, pas l'image
   * précédente du compositeur (SwiftShader retarde les peintures DOM).
   */
  const settleSelector = async (value) => {
    // Loin du sélecteur : le survol d'une entrée active remplace sa teinte pleine.
    await page.mouse.move(4, 4)
    await page.waitForFunction((speed) => {
      const el = document.querySelector('.speed-selector')
      if (!el || el.dataset.activeSpeed !== String(speed)) return false
      if (getComputedStyle(el).opacity !== '1') return false
      const button = el.querySelector(`.speed-selector__button[data-speed="${speed}"]`)
      return button !== null
        && button.getAttribute('aria-pressed') === 'true'
        && getComputedStyle(button).backgroundColor === 'rgb(110, 198, 181)'
    }, value)
    await nextFrames(page, 4)
  }

  const block = async (label, fn) => {
    try {
      await fn()
    } catch (error) {
      failures.push(`${label} : ${error.message}`)
    }
  }

  // -------------------------------------------------------------------------
  // Critère 1 — une tour tire : une baie naît au sommet, porte la teinte de la
  // tour, vole ≤ 0,4 s et disparaît à l'impact sur l'ombre ; `state.projectiles
  // .active` > 0 pendant le vol, l'impact renseigne `state.fx.lastImpact` et
  // laisse une marque lisible ≤ 0,5 s.
  // -------------------------------------------------------------------------
  await block('critère 1', async () => {
    const label = 'critère 1'
    await load('?lang=fr&niveau=1')
    await setViewport(page, DESKTOP)
    await installClock(page)

    await placeSproutByClick(page)
    const placed = (await state()).towers[0]
    check(placed?.type === 'sprout', `${label} : tour posée « ${placed?.type} » au lieu de sprout`)
    check(typeof placed?.tint === 'string' && /^#[0-9a-f]{6}$/i.test(placed.tint),
      `${label} : teinte de la tour non exposée (${placed?.tint})`)
    check(Number.isFinite(placed?.topY) && placed.topY > 0,
      `${label} : topY de la tour invalide (${placed?.topY})`)

    // Vol jusqu'au premier départ de baie.
    const launch = await page.evaluate(({ maxSteps }) => {
      const s = window.__game.state
      const sim = window.__sim
      const waves = window.__game.scene.getObjectByName('waves')
      let steps = 0
      while (steps < maxSteps && s.projectiles.active === 0) {
        sim.step(1 / 60)
        steps++
      }
      const meshes = waves.children.filter((child) => child.name === 'projectile')
      const mesh = meshes[0] ?? null
      return {
        steps,
        elapsed: s.run.elapsed,
        active: s.projectiles.active,
        meshes: meshes.length,
        shot: mesh && {
          tint: mesh.userData?.tint ?? null,
          x: mesh.position.x,
          y: mesh.position.y,
          z: mesh.position.z,
          visible: mesh.visible,
        },
        tower: s.towers[0] ? { x: s.towers[0].x, z: s.towers[0].z, topY: s.towers[0].topY, tint: s.towers[0].tint } : null,
        target: s.creatures.length > 0 ? { ...s.creatures[0] } : null,
        fx: JSON.parse(JSON.stringify(s.fx)),
      }
    }, { maxSteps: Math.ceil(120 / DT) })

    check(launch.active > 0, `${label} : aucun projectile en vol après 2 min simulées`)
    check(launch.meshes >= 1, `${label} : ${launch.meshes} projectile(s) dans la scène alors que active = ${launch.active}`)
    check(launch.shot?.visible === true, `${label} : le projectile en vol est invisible`)
    check(launch.shot?.tint === placed.tint,
      `${label} : projectile teinté ${launch.shot?.tint} au lieu de la tour ${placed.tint}`)
    check(launch.tower && Math.abs(launch.shot.x - launch.tower.x) < 1e-6
      && Math.abs(launch.shot.z - launch.tower.z) < 1e-6,
    `${label} : la baie naît en (${launch.shot?.x}, ${launch.shot?.z}) au lieu du sommet de la tour (${launch.tower?.x}, ${launch.tower?.z})`)
    check(launch.tower && Math.abs(launch.shot.y - launch.tower.topY) < 1e-3,
      `${label} : la baie naît à y = ${launch.shot?.y} au lieu du sommet ${launch.tower?.topY}`)

    // La baie est visible à l'écran au moment de la capture : trois pas après
    // l'envol, elle a quitté le feuillage de la tour (teinte menthe sur le chemin).
    const mid = await page.evaluate(() => {
      const s = window.__game.state
      const sim = window.__sim
      let advanced = 0
      while (advanced < 3 && s.projectiles.active > 0) {
        sim.step(1 / 60)
        advanced++
      }
      const { camera } = window.__game
      const waves = window.__game.scene.getObjectByName('waves')
      const mesh = waves.children.find((child) => child.name === 'projectile')
      if (!mesh) return { advanced, active: s.projectiles.active, screen: null }
      const projected = mesh.position.clone().project(camera)
      const x = (projected.x * 0.5 + 0.5) * innerWidth
      const y = (-projected.y * 0.5 + 0.5) * innerHeight
      return {
        advanced,
        active: s.projectiles.active,
        screen: {
          x, y, inFront: projected.z < 1,
          inside: x >= 0 && y >= 0 && x < innerWidth && y < innerHeight,
        },
      }
    })
    check(mid.active > 0, `${label} : le projectile disparaît trop tôt pour être capturé en vol`)
    check(mid.screen?.inFront === true && mid.screen?.inside === true,
      `${label} : projectile hors champ en vol (${JSON.stringify(mid.screen)})`)
    await nextFrames(page, 2)
    await capture('c1-tir-en-vol')

    // Vol complet, puis impact : durée ≤ 0,4 s, marque et `lastImpact` renseignés.
    const active = launch.active
    const impact = await page.evaluate(({ active }) => {
      const s = window.__game.state
      const sim = window.__sim
      const waves = window.__game.scene.getObjectByName('waves')
      let steps = 0
      while (steps < 120 && s.projectiles.active >= active) {
        sim.step(1 / 60)
        steps++
      }
      return {
        steps,
        active: s.projectiles.active,
        remaining: waves.children.filter((child) => child.name === 'projectile').length,
        fx: JSON.parse(JSON.stringify(s.fx)),
        target: s.creatures.length > 0 ? { ...s.creatures[0] } : null,
        core: s.core.hp,
      }
    }, { active })

    const flight = (mid.advanced + impact.steps) * DT
    check(impact.active < active, `${label} : le projectile ne disparaît pas à l'impact`)
    check(impact.remaining === 0, `${label} : ${impact.remaining} projectile(s) restent dans la scène après l'impact`)
    check(flight <= FLIGHT_MAX,
      `${label} : vol de ${flight.toFixed(3)} s > ${FLIGHT_MAX} s`)
    check(impact.fx.shot >= 1,
      `${label} : impact non compté (fx.shot = ${impact.fx.shot})`)
    check(impact.fx.lastImpact !== null,
      `${label} : state.fx.lastImpact vide après l'impact`)
    if (impact.fx.lastImpact) {
      check(['shot', 'kill'].includes(impact.fx.lastImpact.event),
        `${label} : lastImpact.event « ${impact.fx.lastImpact.event} » au lieu de shot/kill`)
      check(Number.isFinite(impact.fx.lastImpact.x) && Number.isFinite(impact.fx.lastImpact.z),
        `${label} : lastImpact sans coordonnées (${JSON.stringify(impact.fx.lastImpact)})`)
      check(impact.fx.lastImpact.age <= MARK_MAX,
        `${label} : lastImpact âgé de ${impact.fx.lastImpact.age.toFixed(3)} s > ${MARK_MAX} s`)
    }

    // Une image de juice : la marque s'allume, les étincelles apparaissent.
    const mark = await page.evaluate(() => {
      let advanced = 0
      // La marque culmine vers 0,08 s : la capture montre sa teinte, pas son apparition.
      while (advanced < 5) {
        window.__sim.step(1 / 60)
        advanced++
      }
      const juice = window.__game.scene.getObjectByName('juice')
      const marker = juice.getObjectByName('juice-mark')
      const sparks = juice.getObjectByName('juice-sparks')
      const s = window.__game.state
      return {
        advanced,
        visible: marker?.visible ?? false,
        opacity: marker?.material?.opacity ?? 0,
        sparks: sparks?.visible ?? false,
        fx: JSON.parse(JSON.stringify(s.fx)),
      }
    })
    check(mark.visible, `${label} : aucune marque d'impact au sol après le tir`)
    check(mark.opacity > 0, `${label} : marque d'impact transparente (opacité ${mark.opacity})`)
    check(mark.sparks, `${label} : aucune particule à l'impact`)
    check(mark.fx.lastImpact !== null && mark.fx.lastImpact.age <= MARK_MAX,
      `${label} : lastImpact expiré dès l'image suivante`)
    await nextFrames(page, 2)
    await capture('c1-impact')

    // La marque s'efface en ≤ 0,5 s et `lastImpact` se vide.
    const fade = await page.evaluate(() => {
      const s = window.__game.state
      const sim = window.__sim
      const marker = window.__game.scene.getObjectByName('juice').getObjectByName('juice-mark')
      let steps = 0
      while (steps < 120 && marker.visible) {
        sim.step(1 / 60)
        steps++
      }
      return { steps, visible: marker.visible, lastImpact: s.fx.lastImpact }
    })
    // La marque naît à l'image d'impact (celle de la détection) : on ne compte que
    // les images où elle reste affichée ensuite, sans l'image de détection ni la
    // dernière (celle de l'extinction, lue par `fade`). MARK_LIFE = 0,5 s → 30 images.
    const markFrames = mark.advanced + fade.steps - 1
    const markDuration = markFrames * DT
    check(!fade.visible, `${label} : la marque ne s'efface pas`)
    check(markFrames <= Math.round(MARK_MAX / DT),
      `${label} : marque affichée ${markFrames} images > ${Math.round(MARK_MAX / DT)} (${MARK_MAX} s)`)
    check(fade.lastImpact === null,
      `${label} : state.fx.lastImpact reste renseigné après ${MARK_MAX} s`)
    console.log(`[epic-131] critère 1 — vol ${flight.toFixed(3)} s, marque ${markFrames} images = ${markDuration.toFixed(3)} s, teinte ${launch.shot?.tint}`)
  })

  // -------------------------------------------------------------------------
  // Critère 2 — une vague fait cohabiter ≥ 3 silhouettes distinctes
  // (`state.enemies.silhouettes` ≥ 3), aux proportions différentes de plus de
  // 15 %, chacune avec un élément animé pendant la marche.
  // -------------------------------------------------------------------------
  await block('critère 2', async () => {
    const label = 'critère 2'
    await load('?lang=fr&niveau=1')
    await setViewport(page, DESKTOP)
    await installClock(page)

    const spawned = await page.evaluate(({ maxSteps }) => {
      const s = window.__game.state
      const sim = window.__sim
      let steps = 0
      while (steps < maxSteps && s.enemies.silhouettes < 3) {
        sim.step(1 / 60)
        steps++
      }
      return {
        steps,
        silhouettes: s.enemies.silhouettes,
        creatures: s.creatures.map((creature) => ({ id: creature.id, variant: creature.variant })),
        elapsed: s.run.elapsed,
      }
    }, { maxSteps: Math.ceil(30 / DT) })

    check(spawned.silhouettes >= 3,
      `${label} : state.enemies.silhouettes = ${spawned.silhouettes} après 30 s simulées (< 3)`)
    const variants = new Set(spawned.creatures.map((creature) => creature.variant))
    check(variants.size === 3,
      `${label} : ${variants.size} variante(s) parmi ${JSON.stringify(spawned.creatures)} au lieu de 3`)
    check(spawned.creatures.every((creature) => ['ronde', 'oreillue', 'haute'].includes(creature.variant)),
      `${label} : variante inconnue dans ${JSON.stringify(spawned.creatures)}`)

    // Proportions mesurées sur les maillages réellement montés, et éléments animés
    // échantillonnés sur 40 images de marche.
    const profiles = await page.evaluate(({ steps }) => {
      const sim = window.__sim
      const waves = window.__game.scene.getObjectByName('waves')
      const groups = () => waves.children.filter((child) => child.name === 'shadow' && child.visible)
      const byVariant = {}
      for (const group of groups()) byVariant[group.userData.silhouette] = group

      /** Boîte englobante locale du groupe, sans rotation (aucune pièce n'est inclinée de plus de 0,2 rad). */
      const boxOf = (group) => {
        let minX = Infinity; let minY = Infinity; let minZ = Infinity
        let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity
        group.traverse((mesh) => {
          if (!mesh.isMesh) return
          mesh.geometry.computeBoundingBox()
          const bb = mesh.geometry.boundingBox
          const sx = mesh.scale.x; const sy = mesh.scale.y; const sz = mesh.scale.z
          const px = mesh.position.x; const py = mesh.position.y; const pz = mesh.position.z
          minX = Math.min(minX, px + bb.min.x * sx); maxX = Math.max(maxX, px + bb.max.x * sx)
          minY = Math.min(minY, py + bb.min.y * sy); maxY = Math.max(maxY, py + bb.max.y * sy)
          minZ = Math.min(minZ, pz + bb.min.z * sz); maxZ = Math.max(maxZ, pz + bb.max.z * sz)
        })
        return { width: maxX - minX, height: maxY - minY, depth: maxZ - minZ }
      }

      /** Valeur qui bouge à chaque pas, propre à chaque silhouette. */
      const signature = (variant, group) => {
        if (!group) return null
        if (variant === 'ronde') {
          const eye = group.getObjectByName('shadow-eye-left')
          return eye ? eye.scale.y : null
        }
        if (variant === 'oreillue') {
          const ear = group.getObjectByName('shadow-ear-left')
          return ear ? ear.rotation.z : null
        }
        const leg = group.getObjectByName('shadow-leg-left')
        return leg ? leg.position.z + leg.position.y * 0.001 : null
      }

      const variants = ['ronde', 'oreillue', 'haute']
      const boxes = {}
      for (const variant of variants) boxes[variant] = byVariant[variant] ? boxOf(byVariant[variant]) : null
      const tints = {}
      for (const variant of variants) {
        const body = byVariant[variant]?.getObjectByName('shadow-body')
        tints[variant] = body?.material?.color ? `#${body.material.color.getHexString()}` : null
      }

      const ranges = {}
      for (const variant of variants) ranges[variant] = { min: Infinity, max: -Infinity }
      for (let i = 0; i < steps; i++) {
        for (const variant of variants) {
          const value = signature(variant, byVariant[variant])
          if (value === null || !Number.isFinite(value)) continue
          ranges[variant].min = Math.min(ranges[variant].min, value)
          ranges[variant].max = Math.max(ranges[variant].max, value)
        }
        sim.step(1 / 60)
      }
      const amplitudes = {}
      for (const variant of variants) {
        amplitudes[variant] = ranges[variant].max - ranges[variant].min
      }
      return { boxes, tints, amplitudes, present: Object.keys(byVariant), variants }
    }, { steps: 40 })

    check(profiles.present.length === 3,
      `${label} : ${profiles.present.length} silhouette(s) montée(s) (${profiles.present.join(', ')}) au lieu de 3`)
    for (const variant of profiles.variants) {
      const box = profiles.boxes[variant]
      check(Boolean(box), `${label} : silhouette « ${variant} » absente de la scène`)
      check(typeof profiles.tints[variant] === 'string' && profiles.tints[variant] !== '#000000',
        `${label} : teinte de « ${variant} » absente ou noire (${profiles.tints[variant]})`)
    }
    // Chaque paire doit différer de > 15 % sur au moins une dimension.
    const pairs = [['ronde', 'oreillue'], ['ronde', 'haute'], ['oreillue', 'haute']]
    for (const [a, b] of pairs) {
      if (!profiles.boxes[a] || !profiles.boxes[b]) continue
      const diffs = ['width', 'height', 'depth'].map((axis) => {
        const one = profiles.boxes[a][axis]
        const two = profiles.boxes[b][axis]
        return Math.abs(one - two) / Math.max(one, two)
      })
      check(Math.max(...diffs) > 0.15,
        `${label} : ${a} et ${b} se ressemblent (largeurs ${profiles.boxes[a].width.toFixed(2)} / ${profiles.boxes[b].width.toFixed(2)}, hauteurs ${profiles.boxes[a].height.toFixed(2)} / ${profiles.boxes[b].height.toFixed(2)})`)
    }
    // Un élément animé par silhouette pendant la marche.
    for (const variant of profiles.variants) {
      check(profiles.amplitudes[variant] > 0.005,
        `${label} : « ${variant} » n'a aucun élément animé (amplitude ${profiles.amplitudes[variant]?.toFixed(4)})`)
    }

    // Trois silhouettes ensemble à l'écran : capture non ambiguë.
    const framing = await page.evaluate(({ maxSteps }) => {
      const { camera } = window.__game
      const sim = window.__sim
      const waves = window.__game.scene.getObjectByName('waves')
      const view = camera.position.clone()
      const sample = () => {
        const groups = waves.children.filter((child) => child.name === 'shadow' && child.visible)
        const shown = new Map()
        const screen = []
        for (const group of groups) {
          view.set(group.position.x, group.userData.radius * 1.2, group.position.z).project(camera)
          const x = (view.x * 0.5 + 0.5) * innerWidth
          const y = (-view.y * 0.5 + 0.5) * innerHeight
          const visible = view.z < 1 && x >= 0 && y >= 0 && x < innerWidth && y < innerHeight
          shown.set(group.userData.silhouette, visible)
          screen.push({ variant: group.userData.silhouette, x: Math.round(x), y: Math.round(y), visible })
        }
        const complete = ['ronde', 'oreillue', 'haute'].every((variant) => shown.get(variant) === true)
        return complete ? screen : null
      }
      let steps = 0
      while (steps < maxSteps) {
        const screen = sample()
        if (screen) return { steps, screen }
        sim.step(1 / 60)
        steps++
      }
      return { steps, screen: null, last: sample() }
    }, { maxSteps: Math.ceil(25 / DT) })
    check(framing.screen !== null,
      `${label} : les trois silhouettes ne sont jamais réunies à l'écran (${JSON.stringify(framing)})`)
    await nextFrames(page, 2)
    await capture('c2-trois-silhouettes')
    console.log(`[epic-131] critère 2 — ${spawned.silhouettes} silhouettes, amplitudes ${JSON.stringify(profiles.amplitudes)}, cadrage ${framing.steps} pas`)
  })

  // -------------------------------------------------------------------------
  // Critère 3 — chaque événement a un retour visuel dans les 150 ms, compté
  // séparément dans `state.fx` (towerPlaced, shot, kill, heartDamage, victory) ;
  // micro-secousse caméra ≤ 0,06 unité et ≤ 180 ms, sans cumul.
  // -------------------------------------------------------------------------
  await block('critère 3', async () => {
    const label = 'critère 3'
    await load('?lang=fr&niveau=1')
    await setViewport(page, DESKTOP)
    await installClock(page)

    const before = await state()
    check(before.fx.towerPlaced === 0 && before.fx.shot === 0 && before.fx.kill === 0
      && before.fx.heartDamage === 0 && before.fx.victory === 0,
    `${label} : compteurs de fx non nuls au lancement (${JSON.stringify(before.fx)})`)

    // Pose : +1 towerPlaced, particules dédiées.
    await placeSproutByClick(page)
    const posed = await page.evaluate(() => {
      window.__sim.step(1 / 60)
      const juice = window.__game.scene.getObjectByName('juice')
      return {
        fx: JSON.parse(JSON.stringify(window.__game.state.fx)),
        sparks: juice.getObjectByName('juice-sparks')?.visible ?? false,
      }
    })
    check(posed.fx.towerPlaced === 1,
      `${label} : towerPlaced = ${posed.fx.towerPlaced} après une pose au lieu de 1`)
    check(posed.fx.shot === 0 && posed.fx.kill === 0 && posed.fx.heartDamage === 0 && posed.fx.victory === 0,
      `${label} : un autre compteur bouge à la pose (${JSON.stringify(posed.fx)})`)
    check(posed.sparks, `${label} : aucune particule à la pose d'une tour`)

    // Tir : +1 shot, sans toucher aux autres compteurs.
    const fired = await page.evaluate(({ maxSteps }) => {
      const s = window.__game.state
      const sim = window.__sim
      const juice = window.__game.scene.getObjectByName('juice')
      let steps = 0
      const previous = s.fx.shot
      while (steps < maxSteps && s.fx.shot === previous) {
        sim.step(1 / 60)
        steps++
      }
      const sparks = juice.getObjectByName('juice-sparks')
      return {
        steps,
        fx: JSON.parse(JSON.stringify(s.fx)),
        sparks: sparks?.visible ?? false,
      }
    }, { maxSteps: Math.ceil(120 / DT) })
    check(fired.fx.shot === 1,
      `${label} : shot = ${fired.fx.shot} après le premier impact au lieu de 1`)
    check(fired.fx.towerPlaced === 1 && fired.fx.kill === 0 && fired.fx.heartDamage === 0,
      `${label} : le tir modifie les autres compteurs (${JSON.stringify(fired.fx)})`)
    check(fired.sparks, `${label} : aucune particule au tir`)

    // Mort : +1 kill quand le tir emporte l'ombre, avec sa gerbe propre.
    const killed = await page.evaluate(({ maxSteps }) => {
      const s = window.__game.state
      const sim = window.__sim
      const juice = window.__game.scene.getObjectByName('juice')
      const sparks = juice.getObjectByName('juice-sparks')
      const liveParticles = () => {
        const alphas = sparks.geometry.attributes.aAlpha.array
        let count = 0
        for (let i = 0; i < alphas.length; i++) if (alphas[i] > 0.1) count++
        return count
      }
      let steps = 0
      const previous = s.fx.kill
      while (steps < maxSteps && s.fx.kill === previous) {
        sim.step(1 / 60)
        steps++
      }
      return {
        steps,
        fx: JSON.parse(JSON.stringify(s.fx)),
        sparks: sparks.visible,
        particles: liveParticles(),
      }
    }, { maxSteps: Math.ceil(180 / DT) })
    check(killed.fx.kill === 1,
      `${label} : kill = ${killed.fx.kill} après la première ombre emportée au lieu de 1`)
    check(killed.fx.shot >= 2,
      `${label} : le tir mortel n'est pas compté dans shot (${killed.fx.shot})`)
    check(killed.fx.heartDamage === 0 && killed.fx.victory === 0,
      `${label} : la mort d'une ombre modifie un autre compteur (${JSON.stringify(killed.fx)})`)
    check(killed.sparks && killed.particles >= 14,
      `${label} : gerbe de mort absente (${killed.particles} particule(s) vivante(s))`)

    // Cœur : +1 heartDamage par atteinte, secousse bornée et non cumulée.
    await load('?lang=fr&niveau=1')
    await setViewport(page, DESKTOP)
    await installClock(page)
    const breach = await page.evaluate(({ maxSteps }) => {
      const s = window.__game.state
      const sim = window.__sim
      const camera = window.__game.camera
      const base = { x: camera.position.x, y: camera.position.y, z: camera.position.z }
      let steps = 0
      while (steps < maxSteps && s.fx.heartDamage === 0) {
        sim.step(1 / 60)
        steps++
      }
      const offsets = []
      for (let i = 0; i < 24; i++) {
        sim.step(1 / 60)
        offsets.push({
          x: camera.position.x - base.x,
          y: camera.position.y - base.y,
          z: camera.position.z - base.z,
        })
      }
      const peak = offsets.reduce((best, o) => Math.max(best, Math.hypot(o.x, o.y, o.z)), 0)
      return {
        steps,
        fx: JSON.parse(JSON.stringify(s.fx)),
        core: s.core.hp,
        base,
        offsets,
        peak,
      }
    }, { maxSteps: Math.ceil(240 / DT) })
    check(breach.fx.heartDamage === 1,
      `${label} : heartDamage = ${breach.fx.heartDamage} après une atteinte au cœur au lieu de 1`)
    check(breach.fx.shot === 0 && breach.fx.kill === 0 && breach.fx.towerPlaced === 0,
      `${label} : l'atteinte au cœur modifie les autres compteurs (${JSON.stringify(breach.fx)})`)
    check(breach.peak > 0, `${label} : aucune secousse caméra sur un dégât au cœur`)
    check(breach.peak <= SHAKE_MAX,
      `${label} : secousse de ${breach.peak.toFixed(4)} unité > ${SHAKE_MAX}`)
    const still = breach.offsets.slice(Math.ceil(SHAKE_MAX_TIME / DT) + 1)
    check(still.every((o) => Math.hypot(o.x, o.y, o.z) < 1e-6),
      `${label} : secousse encore active après ${SHAKE_MAX_TIME} s (${JSON.stringify(still[0])})`)

    // Deux atteintes à 40 ms : les enveloppes ne s'additionnent pas.
    const doubled = await page.evaluate(({ heart }) => {
      const s = window.__game.state
      const sim = window.__sim
      const game = window.__game
      const camera = game.camera
      // Attendu par la main.js : `core-hit` déclenche le juice du cœur.
      const impact = { hp: s.core.hp, damage: 1, x: heart.x, z: heart.z }
      game.emit('core-hit', impact)
      const base = { x: camera.position.x, y: camera.position.y, z: camera.position.z }
      for (let i = 0; i < 2; i++) sim.step(1 / 60)
      game.emit('core-hit', impact)
      const offsets = []
      for (let i = 0; i < 24; i++) {
        sim.step(1 / 60)
        offsets.push({
          x: camera.position.x - base.x,
          y: camera.position.y - base.y,
          z: camera.position.z - base.z,
        })
      }
      const peak = offsets.reduce((best, o) => Math.max(best, Math.hypot(o.x, o.y, o.z)), 0)
      return { peak, fx: JSON.parse(JSON.stringify(s.fx)) }
    }, { heart: LEVEL_1.heart })
    check(doubled.fx.heartDamage === 3,
      `${label} : heartDamage = ${doubled.fx.heartDamage} après trois atteintes au lieu de 3`)
    check(doubled.peak <= SHAKE_MAX,
      `${label} : deux secousses rapprochées culminent à ${doubled.peak.toFixed(4)} > ${SHAKE_MAX}`)

    // Victoire : +1 victory et gerbe dédiée.
    await load('?lang=fr&niveau=1')
    await setViewport(page, DESKTOP)
    await page.evaluate(() => {
      const game = window.__game
      game.state.paused = true
      game.towers.selectType('sprout')
      for (const id of ['slot-1', 'slot-2', 'slot-3']) game.towers.place(id)
    })
    await installClock(page)
    const victory = await page.evaluate(({ maxSteps }) => {
      const s = window.__game.state
      const sim = window.__sim
      let steps = 0
      while (steps < maxSteps && s.run.outcome === null) {
        sim.step(1 / 60)
        steps++
      }
      const juice = window.__game.scene.getObjectByName('juice')
      const sparks = juice.getObjectByName('juice-sparks')
      // Particules vivantes au moment de la victoire et teinte dorée #f2c66d :
      // la gerbe de célébration se distingue d'un reste de gerbe de tir ou de mort.
      const GOLD = [0.5445, 0.3481, 0.1074] // #f2c66d en linéaire, normalisé
      let live = 0
      let golden = 0
      if (sparks) {
        const alphas = sparks.geometry.attributes.aAlpha.array
        const colors = sparks.geometry.attributes.color.array
        for (let i = 0; i < alphas.length; i++) {
          if (!(alphas[i] > 0.1)) continue
          live++
          const r = colors[i * 3]
          const g = colors[i * 3 + 1]
          const b = colors[i * 3 + 2]
          const sum = r + g + b
          if (sum <= 0) continue
          const distance = Math.abs(r / sum - GOLD[0]) + Math.abs(g / sum - GOLD[1]) + Math.abs(b / sum - GOLD[2])
          if (distance < 0.06) golden++
        }
      }
      return {
        steps,
        outcome: s.run.outcome,
        fx: JSON.parse(JSON.stringify(s.fx)),
        sparks: sparks?.visible ?? false,
        particles: { live, golden },
        elapsed: s.run.elapsed,
      }
    }, { maxSteps: Math.ceil(900 / DT) })
    check(victory.outcome === 'victory',
      `${label} : issue « ${victory.outcome} » (${victory.elapsed.toFixed(1)} s simulées) au lieu de victory`)
    check(victory.fx.victory === 1,
      `${label} : victory = ${victory.fx.victory} après la victoire au lieu de 1`)
    check(victory.fx.towerPlaced === 3,
      `${label} : towerPlaced = ${victory.fx.towerPlaced} après trois poses au lieu de 3`)
    check(victory.sparks && victory.particles.live >= 18,
      `${label} : gerbe de victoire absente (${victory.particles.live} particule(s) vivante(s) au lieu de 18)`)
    check(victory.particles.golden >= 6,
      `${label} : ${victory.particles.golden} particule(s) dorée(s) #f2c66d au lieu de 6 (gerbe de kill réutilisée ?)`)

    await waitEndScreen(page)
    await capture('c3-victoire')
    console.log(`[epic-131] critère 3 — pose ${posed.fx.towerPlaced}, tir ${fired.fx.shot}, mort ${killed.fx.kill}, cœur ${breach.fx.heartDamage}, victoire ${victory.fx.victory} ; gerbe ${victory.particles.live} dont ${victory.particles.golden} dorées ; secousses ${breach.peak.toFixed(3)} / ${doubled.peak.toFixed(3)}`)
  })

  // -------------------------------------------------------------------------
  // Critère 4 — sélecteur ×1/×2/×3 visible dans le HUD, cliquable (souris et
  // tactile), atteignable aux touches 1/2/3 ; entrée active marquée et
  // `state.speed` = 1, 2 ou 3 ; cible tactile ≥ 44 px.
  // -------------------------------------------------------------------------
  await block('critère 4', async () => {
    const label = 'critère 4'
    await load('?lang=fr&niveau=1')
    await setViewport(page, DESKTOP)

    const readSelector = () => page.evaluate(() => {
      const el = document.querySelector('.speed-selector')
      const rect = (node) => {
        if (!node) return null
        const box = node.getBoundingClientRect()
        return { x: box.x, y: box.y, width: box.width, height: box.height, right: box.right, bottom: box.bottom }
      }
      return {
        present: Boolean(el),
        visible: el ? getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).opacity !== '0' : false,
        rect: rect(el),
        activeSpeed: el?.dataset.activeSpeed ?? null,
        ariaLabel: el?.getAttribute('aria-label') ?? null,
        buttons: [...document.querySelectorAll('.speed-selector__button')].map((button) => ({
          speed: Number(button.dataset.speed),
          text: button.textContent.trim(),
          aria: button.getAttribute('aria-label'),
          pressed: button.getAttribute('aria-pressed'),
          rect: rect(button),
        })),
        viewport: { width: innerWidth, height: innerHeight },
        waveRect: rect(document.querySelector('.wave-hud')),
        highRect: rect(document.querySelector('.high-bar')),
        state: JSON.parse(JSON.stringify(window.__game.state)),
      }
    })

    const initial = await readSelector()
    check(initial.present && initial.visible, `${label} : sélecteur de vitesse absent ou masqué`)
    check(initial.buttons.length === 3, `${label} : ${initial.buttons.length} entrée(s) au lieu de 3`)
    check(initial.ariaLabel === fr['hud.speed.label'],
      `${label} : aria-label « ${initial.ariaLabel} » au lieu de « ${fr['hud.speed.label']} »`)
    for (const button of initial.buttons) {
      check(button.text === fill(fr['hud.speed.value'], { value: button.speed }),
        `${label} : libellé ×${button.speed} « ${button.text} » au lieu de « ${fill(fr['hud.speed.value'], { value: button.speed })} »`)
      check(button.aria === fill(fr['hud.speed.aria'], { value: button.speed }),
        `${label} : aria-label ×${button.speed} « ${button.aria} »`)
      check(button.rect.width >= 44 && button.rect.height >= 44,
        `${label} : cible ×${button.speed} de ${button.rect.width}×${button.rect.height} px (< 44)`)
    }
    check(initial.state.speed === 1, `${label} : state.speed = ${initial.state.speed} au lancement au lieu de 1`)
    check(initial.activeSpeed === '1', `${label} : entrée active « ${initial.activeSpeed} » au lancement au lieu de 1`)
    check(initial.buttons.filter((button) => button.pressed === 'true').map((button) => button.speed).join(',') === '1',
      `${label} : marquage initial ${JSON.stringify(initial.buttons.map((button) => [button.speed, button.pressed]))}`)
    check(initial.rect.x >= 0 && initial.rect.y >= 0
      && initial.rect.right <= initial.viewport.width && initial.rect.bottom <= initial.viewport.height,
    `${label} : sélecteur hors du viewport (${JSON.stringify(initial.rect)})`)

    // Clic souris sur ×2 : l'état suit immédiatement, l'entrée se marque au rendu suivant.
    await page.click('.speed-selector__button[data-speed="2"]')
    const click2 = await readSelector()
    check(click2.state.speed === 2, `${label} : state.speed = ${click2.state.speed} après clic sur ×2`)
    await nextFrames(page, 2)
    const marked2 = await readSelector()
    check(marked2.activeSpeed === '2', `${label} : entrée active « ${marked2.activeSpeed} » après clic sur ×2`)
    check(marked2.buttons.filter((button) => button.pressed === 'true').map((button) => button.speed).join(',') === '2',
      `${label} : marquage ×2 ${JSON.stringify(marked2.buttons.map((button) => [button.speed, button.pressed]))}`)
    await settleSelector(2)
    await capture('c4-x2-actif')

    // Touches 1, 2, 3 (rangée du haut).
    for (const digit of [3, 2, 1]) {
      await page.keyboard.press(`Digit${digit}`)
      const after = await readSelector()
      check(after.state.speed === digit,
        `${label} : state.speed = ${after.state.speed} après la touche ${digit}`)
    }
    // Pavé numérique : mêmes facteurs.
    for (const digit of [2, 3]) {
      await page.keyboard.press(`Numpad${digit}`)
      const after = await readSelector()
      check(after.state.speed === digit,
        `${label} : state.speed = ${after.state.speed} après la touche pavé ${digit}`)
    }
    await page.keyboard.press('Digit1')

    // Tactile réel (CDP) sur ×3 puis ×2.
    const client = await page.context().newCDPSession(page)
    const tap = async (value) => {
      const box = await page.locator(`.speed-selector__button[data-speed="${value}"]`).boundingBox()
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
      await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    }
    await tap(3)
    const touch3 = await readSelector()
    check(touch3.state.speed === 3, `${label} : state.speed = ${touch3.state.speed} après un tap sur ×3`)
    await tap(2)
    const touch2 = await readSelector()
    check(touch2.state.speed === 2, `${label} : state.speed = ${touch2.state.speed} après un tap sur ×2`)

    // Mobile 390×844 : sélecteur dans l'écran, sans chevaucher le HUD, cibles ≥ 44 px.
    await setViewport(page, MOBILE)
    await nextFrames(page, 2)
    const mobile = await readSelector()
    check(mobile.viewport.width === MOBILE.width && mobile.viewport.height === MOBILE.height,
      `${label} [mobile] : viewport ${mobile.viewport.width}×${mobile.viewport.height} au lieu de 390×844`)
    check(mobile.visible, `${label} [mobile] : sélecteur masqué`)
    check(mobile.rect.x >= 0 && mobile.rect.y >= 0
      && mobile.rect.right <= mobile.viewport.width && mobile.rect.bottom <= mobile.viewport.height,
    `${label} [mobile] : sélecteur hors du viewport (${JSON.stringify(mobile.rect)})`)
    const overlaps = (a, b) => a && b
      && Math.min(a.right, b.right) - Math.max(a.x, b.x) > 0.5
      && Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 0.5
    check(!overlaps(mobile.rect, mobile.waveRect),
      `${label} [mobile] : le sélecteur chevauche le HUD de vague`)
    check(!overlaps(mobile.rect, mobile.highRect),
      `${label} [mobile] : le sélecteur chevauche la barre haute`)
    for (const button of mobile.buttons) {
      check(button.rect.width >= 44 && button.rect.height >= 44,
        `${label} [mobile] : cible ×${button.speed} de ${button.rect.width}×${button.rect.height} px (< 44)`)
    }
    await settleSelector(2)
    await capture('c4-mobile-tactile')
    console.log(`[epic-131] critère 4 — état ${mobile.state.speed}, cibles ${mobile.buttons.map((b) => `${b.rect.width}×${b.rect.height}`).join(' ')}`)
  })

  // -------------------------------------------------------------------------
  // Critère 5 — sur 2 s réelles, une ombre parcourt ≈ 2× la distance mesurée à
  // ×1 (± 10 %) et la cadence de tir suit le même facteur ; la vitesse revient
  // à ×1 à chaque « Rejouer » et à chaque nouveau niveau.
  //
  // La mesure tourne en 320×240 : le rendu SwiftShader du runner plafonne à
  // ~5 images/s en 1280×720 et ~20 images/s en 390×844, où le bornage de 0,1 s
  // de `game.js` (anti-saut d'onglet) ronge le temps réel à ×2. À 320×240 la
  // boucle tient ~25 images/s, assez pour mesurer le facteur lui-même ; ni la
  // vitesse des ombres ni la cadence ne dépendent du viewport.
  // -------------------------------------------------------------------------
  await block('critère 5', async () => {
    const label = 'critère 5'
    await load('?lang=fr&niveau=1')
    await setViewport(page, { width: 320, height: 240 })

    // Compteurs de vagues : le compte à rebours du HUD tombe d'une unité par
    // seconde de jeu. Dans la vraie boucle, l'intervalle réel entre deux décréments
    // doit doubler à ×1 par rapport à ×2 (rapport ± 10 %, comme la cadence).
    const countdown = (speed, ticks) => page.evaluate(({ speed, ticks }) => new Promise((resolve) => {
      const game = window.__game
      game.setSpeed(speed)
      if (game.state.wave.phase !== 'countdown') {
        resolve({ error: `phase ${game.state.wave.phase}` })
        return
      }
      const events = []
      let last = game.state.wave.countdown
      const start = performance.now()
      const loop = (now) => {
        const value = game.state.wave.countdown
        if (value !== last) {
          events.push({ t: now, value })
          last = value
        }
        if (events.length >= ticks || now - start > 9000) {
          const gaps = events.slice(1).map((event, index) => event.t - events[index].t)
          resolve({
            speed,
            events: events.length,
            from: game.state.wave.countdown,
            gaps: gaps.map((gap) => Math.round(gap)),
            mean: gaps.length > 0 ? gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length : NaN,
            phase: game.state.wave.phase,
          })
          return
        }
        requestAnimationFrame(loop)
      }
      requestAnimationFrame(loop)
    }), { speed, ticks })

    // ×2 d'abord : le répit de 8 s laisse ensuite assez de temps au ×1.
    const fastWave = await countdown(2, 3)
    const slowWave = await countdown(1, 3)
    check(!fastWave.error && fastWave.events >= 3,
      `${label} : ${fastWave.error ?? `${fastWave.events} décrément(s)`} du compte à rebours à ×2 (phase ${fastWave.phase})`)
    check(!slowWave.error && slowWave.events >= 3,
      `${label} : ${slowWave.error ?? `${slowWave.events} décrément(s)`} du compte à rebours à ×1 (phase ${slowWave.phase})`)
    if (Number.isFinite(slowWave.mean) && Number.isFinite(fastWave.mean)) {
      const waveRatio = slowWave.mean / fastWave.mean
      check(Math.abs(waveRatio - 2) <= 0.2,
        `${label} : compteurs de vagues à ×2 = ${waveRatio.toFixed(3)} × ceux à ×1 (${slowWave.mean.toFixed(0)} / ${fastWave.mean.toFixed(0)} ms) au lieu de 2 (± 10 %)`)
      console.log(`[epic-131] critère 5 — compte à rebours ×${waveRatio.toFixed(3)} (${slowWave.gaps.join(' / ')} ms à ×1, ${fastWave.gaps.join(' / ')} ms à ×2)`)
    }

    await installClock(page)

    // Avance jusqu'à deux ombres en marche, puis laisse la vraie boucle jouer.
    await page.evaluate(({ maxSteps }) => {
      const s = window.__game.state
      const sim = window.__sim
      let steps = 0
      while (steps < maxSteps && (s.wave.phase !== 'marching' || s.creatures.length < 2)) {
        sim.step(1 / 60)
        steps++
      }
      s.paused = false
    }, { maxSteps: Math.ceil(40 / DT) })
    await page.waitForTimeout(800)

    const measure = (speed, ms) => page.evaluate(({ speed, ms }) => new Promise((resolve) => {
      const game = window.__game
      game.setSpeed(speed)
      const head = game.state.creatures.slice().sort((a, b) => b.progress - a.progress)[0]
      if (!head) {
        resolve({ error: 'aucune ombre en marche' })
        return
      }
      const start = performance.now()
      const p0 = head.progress
      const e0 = game.state.run.elapsed
      const loop = (now) => {
        if (now - start < ms) return requestAnimationFrame(loop)
        resolve({
          speed,
          ms: now - start,
          progress: head.progress - p0,
          elapsed: game.state.run.elapsed - e0,
        })
      }
      requestAnimationFrame(loop)
    }), { speed, ms })

    const one = await measure(1, 2000)
    const two = await measure(2, 2000)
    check(!one.error && !two.error, `${label} : ${one.error ?? two.error}`)
    let distanceRatio = null
    if (!one.error && !two.error) {
      distanceRatio = two.progress / one.progress
      const clockRatio = two.elapsed / one.elapsed
      check(Math.abs(distanceRatio - 2) <= 0.2,
        `${label} : distance à ×2 = ${distanceRatio.toFixed(3)} × celle à ×1 au lieu de 2 (± 10 %)`)
      check(Math.abs(clockRatio - 2) <= 0.2,
        `${label} : horloge de partie à ×2 = ${clockRatio.toFixed(3)} × celle à ×1 au lieu de 2 (± 10 %)`)
      console.log(`[epic-131] critère 5 — distance ×${distanceRatio.toFixed(3)}, horloge ×${clockRatio.toFixed(3)} sur ${Math.round(one.ms)} / ${Math.round(two.ms)} ms`)

      // Cadence : trois Pousses, tir continu sur les ombres à portée. Chaque tir
      // d'une même tour est daté (réel) ; seuls les intervalles d'une cadence
      // (≈ `combat.cadence` en temps de jeu) comptent, pour ignorer les trous
      // entre deux vagues où la tour n'a aucune cible.
      await page.evaluate(() => {
        const game = window.__game
        const sim = window.__sim
        game.state.paused = true
        game.towers.selectType('sprout')
        for (const id of ['slot-1', 'slot-2', 'slot-3']) game.towers.place(id)
        const s = game.state
        let steps = 0
        while (steps < 60 * 60 && !s.towers.some((tower) => tower.shots > 0)) {
          sim.step(1 / 60)
          steps++
        }
        s.paused = false
      })
      const sample = (speed, count) => page.evaluate(({ speed, count, cadence }) => new Promise((resolve) => {
        const game = window.__game
        game.setSpeed(speed)
        const towers = game.state.towers
        const last = towers.map((tower) => tower.shots)
        const events = []
        const start = performance.now()
        const loop = (now) => {
          towers.forEach((tower, index) => {
            if (tower.shots > last[index]) {
              for (let n = 0; n < tower.shots - last[index]; n++) {
                events.push({ t: now, game: game.state.run.elapsed, id: tower.id })
              }
              last[index] = tower.shots
            }
          })
          if (events.length >= count || now - start > 9000) {
            const byTower = new Map()
            for (const event of events) {
              if (!byTower.has(event.id)) byTower.set(event.id, [])
              byTower.get(event.id).push(event)
            }
            const intervals = []
            for (const list of byTower.values()) {
              for (let i = 1; i < list.length; i++) {
                const dGame = list[i].game - list[i - 1].game
                if (dGame < cadence * 0.85 || dGame > cadence * 1.15) continue
                intervals.push({ dGame, dReal: list[i].t - list[i - 1].t })
              }
            }
            const mean = intervals.length > 0
              ? intervals.reduce((sum, item) => sum + item.dReal, 0) / intervals.length
              : NaN
            resolve({ speed, ms: Math.round(now - start), events: events.length, intervals: intervals.length, mean })
            return
          }
          requestAnimationFrame(loop)
        }
        requestAnimationFrame(loop)
      }), { speed, count, cadence: LEVEL_1.combat.cadence })

      const slow = await sample(1, 5)
      const fast = await sample(2, 5)
      check(slow.intervals >= 2 && Number.isFinite(slow.mean),
        `${label} : ${slow.intervals} intervalle(s) de cadence mesuré(s) à ×1 (${slow.events} tir(s))`)
      check(fast.intervals >= 2 && Number.isFinite(fast.mean),
        `${label} : ${fast.intervals} intervalle(s) de cadence mesuré(s) à ×2 (${fast.events} tir(s))`)
      if (Number.isFinite(slow.mean) && Number.isFinite(fast.mean)) {
        const cadenceRatio = slow.mean / fast.mean
        check(Math.abs(cadenceRatio - 2) <= 0.2,
          `${label} : cadence à ×2 = ${cadenceRatio.toFixed(3)} × celle à ×1 (${slow.mean.toFixed(0)} ms / ${fast.mean.toFixed(0)} ms) au lieu de 2 (± 10 %)`)
        check(Math.abs(cadenceRatio - distanceRatio) <= 0.1 * distanceRatio + 0.05,
          `${label} : cadence (×${cadenceRatio.toFixed(2)}) et distance (×${distanceRatio.toFixed(2)}) ne suivent pas le même facteur`)
        console.log(`[epic-131] critère 5 — cadence ×${cadenceRatio.toFixed(3)} (${slow.mean.toFixed(0)} / ${fast.mean.toFixed(0)} ms, ${slow.intervals}/${fast.intervals} intervalles)`)
      }
    }

    // « Rejouer » : retour à ×1, la partie simulée touche à sa fin.
    await page.evaluate(() => {
      const game = window.__game
      game.state.paused = true
      const entities = game.scene.children.filter((object) => typeof object.update === 'function')
      window.__sim = { step(dt = 1 / 60) { for (const entity of entities) entity.update?.(dt) } }
      const s = game.state
      let steps = 0
      while (steps < 60000 && s.run.outcome === null) {
        window.__sim.step(1 / 60)
        steps++
      }
    })
    await setViewport(page, MOBILE)
    await page.keyboard.press('Digit3')
    check((await state()).speed === 3, `${label} : ×3 non pris avant « Rejouer »`)
    await waitEndScreen(page)
    await page.click('.end-screen__replay')
    const replayed = await state()
    check(replayed.speed === 1, `${label} : state.speed = ${replayed.speed} après « Rejouer » au lieu de 1`)
    check(replayed.run.outcome === null, `${label} : la partie n'est pas réinitialisée après « Rejouer »`)
    await nextFrames(page, 2)
    const replayMark = await page.evaluate(() => document.querySelector('.speed-selector')?.dataset.activeSpeed ?? null)
    check(replayMark === '1', `${label} : sélecteur sur « ${replayMark} » après « Rejouer » au lieu de 1`)
    await settleSelector(1)
    await capture('c5-apres-rejouer')

    // Nouveau niveau : victoire simulée, puis « Niveau suivant » depuis l'écran de fin.
    await page.keyboard.press('Digit3')
    await page.evaluate(() => {
      const game = window.__game
      game.state.paused = true
      game.towers.selectType('sprout')
      for (const id of ['slot-1', 'slot-2', 'slot-3']) game.towers.place(id)
      const entities = game.scene.children.filter((object) => typeof object.update === 'function')
      window.__sim = { step(dt = 1 / 60) { for (const entity of entities) entity.update?.(dt) } }
      const s = game.state
      let steps = 0
      while (steps < 60000 && s.run.outcome === null) {
        window.__sim.step(1 / 60)
        steps++
      }
    })
    check((await state()).run.outcome === 'victory',
      `${label} : aucune victoire simulée pour ouvrir le niveau suivant`)
    await waitEndScreen(page)
    await page.click('.end-screen__button[data-action="next"]')
    const nextLevel = await state()
    check(nextLevel.speed === 1,
      `${label} : state.speed = ${nextLevel.speed} au lancement du niveau suivant au lieu de 1`)
    check(nextLevel.level?.id === 'niveau-2',
      `${label} : niveau ouvert « ${nextLevel.level?.id} » au lieu de niveau-2`)
    await nextFrames(page, 2)
    const nextMark = await page.evaluate(() => document.querySelector('.speed-selector')?.dataset.activeSpeed ?? null)
    check(nextMark === '1', `${label} : sélecteur sur « ${nextMark} » au nouveau niveau au lieu de 1`)
    await settleSelector(1)
    await capture('c5-nouveau-niveau')
  })

  // -------------------------------------------------------------------------
  // Critère 6 — en 390×844 : ≤ 300 draw calls, ≤ 500 000 triangles et p95 du
  // coût par image ≤ 16,7 ms sur 300 images, une Pousse posée et des ombres en
  // marche. Aucune erreur console sur tout le scénario.
  // -------------------------------------------------------------------------
  await block('critère 6', async () => {
    const label = 'critère 6'
    await load('?lang=fr&niveau=1')
    await setViewport(page, MOBILE)
    await installClock(page)
    // Le cadrage portrait par défaut laisse le combat hors champ : on décale la cible
    // caméra vers le bord du pan autorisé pour que tours, ombres et projectiles soient
    // réellement rendus pendant la mesure (même méthode que l'Epic #49).
    const view = (await state()).level.camera
    await page.evaluate((targetX) => {
      window.__game.state.camera.targetX = targetX
      window.__sim.step(0)
    }, view.target.x - view.pan)
    const visibleSlots = (await slotPoints(page))
      .filter((slot) => slot.inFront && slot.inside && slot.canvas)
    check(visibleSlots.length >= 1,
      `${label} : aucun emplacement visible en 390×844 pour la mesure`)
    const poses = await page.evaluate((ids) => {
      const game = window.__game
      game.towers.selectType('sprout')
      const placed = ids.map((id) => game.towers.place(id))
      return { placed, towers: game.state.towers.length }
    }, visibleSlots.slice(0, 2).map((slot) => slot.id))
    check(poses.placed.every(Boolean) && poses.towers >= 1,
      `${label} : ${poses.towers} tour(s) posée(s) pour la mesure`)
    await page.evaluate(({ maxSteps }) => {
      const s = window.__game.state
      const sim = window.__sim
      let steps = 0
      while (steps < maxSteps && (s.creatures.length < 3 || s.fx.shot < 1)) {
        sim.step(1 / 60)
        steps++
      }
    }, { maxSteps: Math.ceil(90 / DT) })

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
    }, { frames: 300 })

    const p95 = percentile(timing.total, 95)
    check(timing.total.length >= 300,
      `${label} : ${timing.total.length} image(s) mesurée(s) au lieu de 300`)
    check(p95 <= 16.7,
      `${label} : coût par image p95 ${p95.toFixed(2)} ms > 16,7 ms (médian ${median(timing.total).toFixed(2)} ms, update p95 ${percentile(timing.loop, 95).toFixed(2)} ms)`)
    check(timing.draws.calls <= 300,
      `${label} : ${timing.draws.calls} draw calls en 390×844 (> 300)`)
    check(timing.draws.triangles <= 500_000,
      `${label} : ${timing.draws.triangles} triangles en 390×844 (> 500 000)`)

    const live = await state()
    check(live.render.drawCalls <= 300,
      `${label} : state.render.drawCalls ${live.render.drawCalls} > 300`)
    check(live.render.triangles <= 500_000,
      `${label} : state.render.triangles ${live.render.triangles} > 500 000`)
    check(live.projectiles !== undefined && live.enemies !== undefined && live.fx !== undefined,
      `${label} : états projectiles/enemies/fx absents`)

    await nextFrames(page, 2)
    await capture('c6-mobile-budget')
    console.log(`[epic-131] critère 6 — ${timing.draws.calls} draw calls, ${timing.draws.triangles} triangles, p95 ${p95.toFixed(2)} ms (médian ${median(timing.total).toFixed(2)} ms)`)
  })

  // Aucune régression des scénarios existants n'est réécrite ici : ce bloc ne
  // vérifie que la donnée de référence et les erreurs console du parcours.
  await block('console', async () => {
    check(consoleErrors.length === 0,
      `erreurs console : ${consoleErrors.slice(0, 3).join(' | ')}`)
    check(LEVEL_1.combat.range > 0 && LEVEL_1.shadows.radius > 0,
      'level-1.js : valeurs de combat/ombre absentes')
  })

  if (failures.length > 0) {
    throw new Error(`${failures.length} écart(s) :\n- ${failures.join('\n- ')}`)
  }
}
