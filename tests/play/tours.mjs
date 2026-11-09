// Playtest de l'Epic #30 — tours-plantes : barre, fantôme, refus, pose et amélioration.
// Un bloc par critère d'acceptation, dans l'ordre de l'Epic. Chaque capture est produite
// puis décodée dans la page (createImageBitmap sur le PNG renvoyé par Playwright) : les
// pixels comparés sont ceux réellement affichés. Les états lus sont ceux de
// `window.__game.state` (src/core/towers.js) ; aucun fichier du jeu n'est modifié.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { LEVEL_1 } from '../../src/data/level-1.js'
import { TOWERS } from '../../src/data/towers.js'

const RESULTS = 'test-results'
const DESKTOP = { width: 1280, height: 720 } // viewport du runner
const MOBILE = { width: 390, height: 844 }
/** Le glissement vaut 0,004 rad/px dans src/core/camera-rig.js. */
const RADIANS_PER_PIXEL = 0.004
const SLOT_RADIUS = 1.1 // rayon de saisie d'un emplacement dans src/core/towers.js
const MECANIQUES = fileURLToPath(new URL('../../vault/GDD/Mecaniques.md', import.meta.url))
const FR_JSON = fileURLToPath(new URL('../../src/i18n/fr.json', import.meta.url))
const EN_JSON = fileURLToPath(new URL('../../src/i18n/en.json', import.meta.url))

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

/** Capture nommée tours-<label>.png (le runner préfixe déjà par le scénario). */
function capture(page, label) {
  return page.screenshot({ path: `${RESULTS}/tours-${label}.png` })
}

/** Décode une capture dans la page et la range sous `key` (ImageData, pixels affichés). */
async function decode(page, buffer, key) {
  const base64 = buffer.toString('base64')
  return page.evaluate(async ({ data, key }) => {
    const response = await fetch(`data:image/png;base64,${data}`)
    const bitmap = await createImageBitmap(await response.blob())
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    context.drawImage(bitmap, 0, 0)
    const image = context.getImageData(0, 0, bitmap.width, bitmap.height)
    window.__shots = window.__shots ?? {}
    window.__shots[key] = { width: image.width, height: image.height, data: image.data }
    return { width: image.width, height: image.height }
  }, { data: base64, key })
}

/** Nombre de pixels où un canal sRGB diffère de plus de `threshold` entre deux captures. */
function diffPixels(page, before, after, rect, threshold = 10) {
  return page.evaluate(({ before, after, rect, threshold }) => {
    const A = window.__shots[before]
    const B = window.__shots[after]
    if (!A || !B || A.width !== B.width || A.height !== B.height) return -1
    const x0 = Math.max(0, Math.floor(rect.x))
    const y0 = Math.max(0, Math.floor(rect.y))
    const x1 = Math.min(A.width, Math.ceil(rect.x + rect.width))
    const y1 = Math.min(A.height, Math.ceil(rect.y + rect.height))
    let count = 0
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * A.width + x) * 4
        const delta = Math.max(
          Math.abs(A.data[i] - B.data[i]),
          Math.abs(A.data[i + 1] - B.data[i + 1]),
          Math.abs(A.data[i + 2] - B.data[i + 2]),
        )
        if (delta > threshold) count++
      }
    }
    return count
  }, { before, after, rect, threshold })
}

/** Point monde → pixels CSS, avec test de saisie réelle (canvas sous le pointeur). */
function screenPoint(page, x, y, z) {
  return page.evaluate(({ x, y, z }) => {
    const { camera } = window.__game
    const projected = camera.position.clone().set(x, y, z).project(camera)
    const px = (projected.x * 0.5 + 0.5) * innerWidth
    const py = (-projected.y * 0.5 + 0.5) * innerHeight
    const element = document.elementFromPoint(px, py)
    return {
      x: px,
      y: py,
      inFront: projected.z < 1,
      inside: px >= 0 && py >= 0 && px < innerWidth && py < innerHeight,
      canvas: element?.tagName === 'CANVAS',
    }
  }, { x, y, z })
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

/** Clic de pose : appui et relâchement au même pixel (jamais un glissement). */
async function clickCanvas(page, point) {
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.up()
}

async function tapCanvas(page, point) {
  const client = await page.context().newCDPSession(page)
  await client.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: point.x, y: point.y }],
  })
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await client.detach()
  await nextFrames(page, 2)
}

/** Glissement depuis le centre du canvas (même geste que src/core/camera-rig.js). */
async function drag(page, dx, dy, steps = 6) {
  const { width, height } = page.viewportSize()
  const x = Math.round(width / 2)
  const y = Math.round(height / 2)
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(x + (dx * i) / steps, y + (dy * i) / steps)
  }
  await page.mouse.up()
  await nextFrames(page, 2)
}

async function openBar(page) {
  const open = await page.evaluate(() =>
    document.querySelector('.tower-bar')?.dataset.open === 'true')
  if (!open) await page.click('.tower-bar__handle')
  await page.waitForFunction(() =>
    document.querySelector('.tower-bar')?.dataset.open === 'true')
  // Fin de la transition d'opacité : la capture montre la barre entièrement ouverte.
  await page.waitForFunction(() => {
    const panel = document.querySelector('.tower-bar__panel')
    return panel !== null && getComputedStyle(panel).opacity === '1'
  })
}

async function selectSeed(page, type) {
  await page.click(`.tower-bar__entry[data-tower="${type}"]`)
  await page.waitForFunction((id) => window.__game.state.towerBar.selectedType === id, type)
  // Laisse la transition CSS (160 ms) rendre l'état sélectionné avant la capture.
  await page.waitForFunction((id) => {
    const entry = document.querySelector(`.tower-bar__entry[data-tower="${id}"]`)
    return entry !== null && getComputedStyle(entry).backgroundColor === 'rgb(110, 198, 181)'
  }, type)
}

/** Photographie DOM de la barre : entrées, prix rendus, sélection et état ARIA. */
function readBar(page) {
  return page.evaluate(() => {
    const bar = document.querySelector('.tower-bar')
    const box = (element) => {
      const rect = element.getBoundingClientRect()
      return {
        x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        right: rect.right, bottom: rect.bottom,
      }
    }
    const entries = [...bar.querySelectorAll('.tower-bar__entry')].map((entry) => {
      const name = entry.querySelector('.tower-bar__entry-name')
      const cost = entry.querySelector('.tower-bar__entry-cost')
      return {
        tower: entry.dataset.tower,
        cost: Number(entry.dataset.cost),
        name: name.textContent.trim(),
        price: cost.textContent.trim(),
        nameClipped: name.scrollWidth > name.clientWidth + 1,
        priceClipped: cost.scrollWidth > cost.clientWidth + 1,
        pressed: entry.getAttribute('aria-pressed'),
        rect: box(entry),
      }
    })
    const panel = bar.querySelector('.tower-bar__panel')
    const selection = bar.querySelector('.tower-bar__selection')
    const upgrade = bar.querySelector('.tower-bar__upgrade')
    const panelStyle = getComputedStyle(panel)
    return {
      rect: box(bar),
      handleRect: box(bar.querySelector('.tower-bar__handle')),
      open: bar.dataset.open === 'true',
      expanded: bar.querySelector('.tower-bar__handle').getAttribute('aria-expanded'),
      panelVisible: panelStyle.visibility !== 'hidden' && panelStyle.opacity === '1',
      entries,
      listHidden: bar.querySelector('.tower-bar__list').hidden,
      selectionVisible: !selection.hidden && selection.getBoundingClientRect().width > 0,
      level: bar.querySelector('.tower-bar__level').textContent.trim(),
      price: bar.querySelector('.tower-bar__price').textContent.trim(),
      upgradeText: upgrade.textContent.trim(),
      upgradeDisabled: upgrade.disabled,
    }
  })
}

/** Textes feuilles de l'interface, pour la chasse au texte en dur. */
function uiTexts(page) {
  return page.evaluate(() => {
    const root = document.getElementById('ui')
    return [...root.querySelectorAll('*')]
      .filter((element) => element.children.length === 0 && element.textContent.trim())
      .map((element) => element.textContent.trim())
  })
}

/** Textes qui ne viennent ni d'une valeur ni d'un gabarit du dictionnaire de la langue. */
function hardcodedTexts(texts, dict) {
  const values = new Set(Object.values(dict))
  const escape = (part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const NUMBER = '-?\\d+(?:[.,]\\d+)?'
  const templates = [...values]
    .filter((value) => /\{[^{}]*\}/.test(value))
    .map((value) => new RegExp(`^${value.split(/\{[^{}]*\}/g).map(escape).join(NUMBER)}$`))
  return texts.filter((text) =>
    !values.has(text) && !templates.some((template) => template.test(text)))
}

/** Opacité du matériau d'un anneau d'emplacement (0,25 au repos, 0,65 illuminé). */
function ringOpacity(page, x, z) {
  return page.evaluate(({ x, z }) => {
    const towers = window.__game.scene.getObjectByName('towers')
    const marker = towers.children.find((child) =>
      child.name === 'slot-marker'
      && Math.abs(child.position.x - x) < 0.01
      && Math.abs(child.position.z - z) < 0.01)
    const ring = marker?.getObjectByName('slot-marker-ring')
    return ring ? { opacity: ring.material.opacity, color: `#${ring.material.color.getHexString()}` } : null
  }, { x, z })
}

/** Fantôme affiché dans la scène (le vrai objet 3D, pas seulement l'état). */
function ghostScene(page, type) {
  return page.evaluate((type) => {
    const towers = window.__game.scene.getObjectByName('towers')
    const ghost = towers?.children.find((child) =>
      child.name === 'tower-ghost' && child.userData.type === type)
    if (!ghost) return null
    return {
      visible: ghost.visible,
      x: ghost.position.x,
      z: ghost.position.z,
      y: ghost.position.y,
    }
  }, type)
}

function selectionMarker(page) {
  return page.evaluate(() => {
    const marker = window.__game.scene.getObjectByName('selection-marker')
    return marker
      ? { visible: marker.visible, x: marker.position.x, z: marker.position.z }
      : null
  })
}

/** Empreinte du décor 3D : enfants, triangles, somme des positions de premier niveau. */
function decorSignature(page) {
  return page.evaluate(() => {
    const clairiere = window.__game.scene.getObjectByName('clairiere')
    const decor = clairiere?.getObjectByName('decor')
    if (!decor) return null
    let triangles = 0
    let sumX = 0
    let sumZ = 0
    let meshes = 0
    decor.traverse((object) => {
      if (!object.isMesh) return
      meshes++
      const geometry = object.geometry
      triangles += geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3
      if (object.parent === decor) {
        sumX += object.position.x
        sumZ += object.position.z
      }
    })
    return {
      children: decor.children.length,
      meshes,
      triangles: Math.round(triangles),
      sumX: Number(sumX.toFixed(3)),
      sumZ: Number(sumZ.toFixed(3)),
    }
  })
}

/** Boîte écran englobant une tour (base et sommet de niveau 2), avec 2 px de marge. */
function towerZone(page, tower) {
  return page.evaluate(({ x, z }) => {
    const { camera } = window.__game
    const projected = camera.position.clone()
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const dx of [-0.9, 0.9]) {
      for (const y of [0, 2.3]) {
        for (const dz of [-0.9, 0.9]) {
          projected.set(x + dx, y, z + dz).project(camera)
          const px = (projected.x * 0.5 + 0.5) * innerWidth
          const py = (-projected.y * 0.5 + 0.5) * innerHeight
          if (px < minX) minX = px
          if (px > maxX) maxX = px
          if (py < minY) minY = py
          if (py > maxY) maxY = py
        }
      }
    }
    return { x: minX - 2, y: minY - 2, width: maxX - minX + 4, height: maxY - minY + 4 }
  }, { x: tower.x, z: tower.z })
}

/** Point voisin d'un emplacement, dans son rayon de saisie mais hors de la tour. */
async function ringPoint(page, slot) {
  for (const [dx, dz] of [[0, 0.9], [0, -0.9], [0.9, 0], [-0.9, 0]]) {
    const point = await screenPoint(page, slot.worldX + dx, 0, slot.worldZ + dz)
    if (point.inFront && point.inside && point.canvas) return point
  }
  return null
}

/** Clic de refus « hors emplacement » : point de sol loin de tout emplacement. */
async function outsidePoint(page, slots) {
  const candidates = [[10, -10], [-10, -10], [10, 6], [-10, 6], [8, 0], [-8, 0], [12, 3], [-12, 3]]
  for (const [x, z] of candidates) {
    const far = slots.every((slot) => Math.hypot(x - slot.worldX, z - slot.worldZ) > SLOT_RADIUS + 0.5)
    if (!far) continue
    const point = await screenPoint(page, x, 0, z)
    if (point.inFront && point.inside && point.canvas) return point
  }
  return null
}

export default async function ({ page, load, state }) {
  // Un état attendu qui n'arrive pas échoue le critère en 5 s au lieu de bloquer le scénario.
  page.setDefaultTimeout(5000)
  const failures = []
  const check = (condition, message) => {
    if (!condition) failures.push(message)
  }

  const [fr, en] = await Promise.all([
    readFile(FR_JSON, 'utf8').then(JSON.parse),
    readFile(EN_JSON, 'utf8').then(JSON.parse),
  ])

  // -------------------------------------------------------------------------
  // Critère 1 — barre de tours-plantes : la poignée l'ouvre, au moins deux
  // entrées visibles avec leur prix lisible, aria-pressed renseigné, en FR puis
  // en EN (?lang=en), mêmes montants.
  // -------------------------------------------------------------------------
  try {
    const amounts = {}
    for (const [lang, dict, label, seed] of [
      ['fr', fr, 'c1-bar-fr', 'sprout'],
      ['en', en, 'c1-bar-en', 'bloom'],
    ]) {
      await load(`?lang=${lang}`)
      await setViewport(page, DESKTOP)
      const closed = await readBar(page)
      check(closed.open === false, `critère 1 [${lang}] : la barre est ouverte au chargement`)
      check(closed.panelVisible === false, `critère 1 [${lang}] : le panneau est visible avant l'ouverture`)
      check((await state()).towerBar.open === false,
        `critère 1 [${lang}] : state.towerBar.open n'est pas false au chargement`)

      await openBar(page)
      const bar = await readBar(page)
      check(bar.open === true, `critère 1 [${lang}] : la poignée n'ouvre pas la barre`)
      check(bar.expanded === 'true', `critère 1 [${lang}] : aria-expanded de la poignée n'est pas « true »`)
      check(bar.panelVisible === true, `critère 1 [${lang}] : le panneau ouvert n'est pas visible`)
      check(bar.entries.length >= 2,
        `critère 1 [${lang}] : ${bar.entries.length} entrée(s) au lieu d'au moins 2`)

      const expected = [
        { id: 'sprout', name: dict['tower.sprout.name'], cost: TOWERS.sprout.cost },
        { id: 'bloom', name: dict['tower.bloom.name'], cost: TOWERS.bloom.cost },
      ]
      for (const tower of expected) {
        const entry = bar.entries.find((item) => item.tower === tower.id)
        check(Boolean(entry), `critère 1 [${lang}] : entrée ${tower.id} absente`)
        if (!entry) continue
        check(entry.name === tower.name,
          `critère 1 [${lang}] : nom ${tower.id} « ${entry.name} » ≠ « ${tower.name} »`)
        const price = dict['tower.price'].replace('{n}', String(tower.cost))
        check(entry.price === price,
          `critère 1 [${lang}] : prix ${tower.id} « ${entry.price} » ≠ « ${price} »`)
        check(entry.rect.width > 0 && entry.rect.height > 0,
          `critère 1 [${lang}] : entrée ${tower.id} non visible (${entry.rect.width}×${entry.rect.height})`)
        check(entry.nameClipped === false && entry.priceClipped === false,
          `critère 1 [${lang}] : libellé ou prix de ${tower.id} tronqué à l'écran`)
        check(entry.pressed === 'false',
          `critère 1 [${lang}] : aria-pressed de ${tower.id} vaut ${entry.pressed} avant sélection`)
      }
      amounts[lang] = bar.entries.map((entry) => entry.cost).sort((a, b) => a - b)

      await selectSeed(page, seed)
      const selected = await readBar(page)
      const pressed = selected.entries.find((entry) => entry.tower === seed)
      const other = selected.entries.find((entry) => entry.tower !== seed)
      check(pressed?.pressed === 'true',
        `critère 1 [${lang}] : aria-pressed de ${seed} n'est pas « true » après sélection`)
      check(other?.pressed === 'false',
        `critère 1 [${lang}] : aria-pressed de ${other?.tower} reste « true »`)

      const texts = await uiTexts(page)
      const hardcoded = hardcodedTexts(texts, dict)
      check(hardcoded.length === 0,
        `critère 1 [${lang}] : texte en dur dans l'interface : ${hardcoded.join(' / ')}`)

      await capture(page, label)
    }
    check(JSON.stringify(amounts.fr) === JSON.stringify(amounts.en),
      `critère 1 : montants FR ${amounts.fr} ≠ EN ${amounts.en}`)
  } catch (error) {
    failures.push(`critère 1 : ${error.message}`)
  }

  // -------------------------------------------------------------------------
  // Critère 2 — survol : graine sélectionnée, vrai pointermove sur un
  // emplacement libre → state.hoveredSlot, ghost.visible, fantôme 3D affiché,
  // anneau illuminé (opacité 0,25 → 0,65), capture de l'emplacement et du fantôme.
  // -------------------------------------------------------------------------
  try {
    await load('?lang=fr')
    await setViewport(page, DESKTOP)
    await openBar(page)
    await selectSeed(page, 'sprout')

    const slots = await slotPoints(page)
    const target = slots.find((slot) => slot.inFront && slot.inside && slot.canvas)
    check(Boolean(target), 'critère 2 : aucun emplacement libre cliquable dans le champ')

    const before = await ringOpacity(page, target.worldX, target.worldZ)
    const ghostBefore = await ghostScene(page, 'sprout')
    check(before?.opacity === 0.25,
      `critère 2 : anneau au repos à ${before?.opacity} au lieu de 0,25`)
    check(ghostBefore?.visible === false,
      'critère 2 : le fantôme est déjà visible avant le survol')

    await page.mouse.move(target.x, target.y)
    await page.waitForFunction((id) => window.__game.state.hoveredSlot === id, target.id)
    await page.waitForFunction(() => window.__game.state.ghost.visible === true)
    await nextFrames(page, 2)

    const hovered = await state()
    const ghost = await ghostScene(page, 'sprout')
    const ring = await ringOpacity(page, target.worldX, target.worldZ)
    check(hovered.hoveredSlot === target.id,
      `critère 2 : hoveredSlot ${hovered.hoveredSlot} au lieu de ${target.id}`)
    check(hovered.ghost.visible === true, 'critère 2 : state.ghost.visible reste false')
    check(hovered.ghost.slotId === target.id,
      `critère 2 : ghost.slotId ${hovered.ghost.slotId} au lieu de ${target.id}`)
    check(hovered.ghost.type === 'sprout',
      `critère 2 : ghost.type ${hovered.ghost.type} au lieu de sprout`)
    check(ghost?.visible === true, 'critère 2 : le fantôme 3D n\'est pas affiché')
    check(Math.abs((ghost?.x ?? NaN) - target.worldX) < 0.01
      && Math.abs((ghost?.z ?? NaN) - target.worldZ) < 0.01,
      `critère 2 : fantôme en (${ghost?.x}, ${ghost?.z}) au lieu de (${target.worldX}, ${target.worldZ})`)
    check(ring?.opacity === 0.65,
      `critère 2 : anneau illuminé à ${ring?.opacity} au lieu de 0,65`)

    await capture(page, 'c2-hover')
  } catch (error) {
    failures.push(`critère 2 : ${error.message}`)
  }

  // -------------------------------------------------------------------------
  // Critère 3 — refus : emplacement occupé, clic hors emplacement, ressources
  // insuffisantes (après 3 pousses). Dans les trois cas lastRefusal correct,
  // state.resources strictement inchangé et aucune tour ajoutée.
  // -------------------------------------------------------------------------
  try {
    await load('?lang=fr')
    await setViewport(page, DESKTOP)
    await openBar(page)
    await selectSeed(page, 'sprout')

    const slots = await slotPoints(page)
    const usable = slots.filter((slot) => slot.inFront && slot.inside && slot.canvas)
    check(usable.length >= 4,
      `critère 3 : seulement ${usable.length}/4 emplacements cliquables`)

    // Pose d'ouverture, puis refus « occupé » à côté de la tour (rayon de saisie).
    const first = usable[0]
    const cost = TOWERS.sprout.cost
    const startResources = (await state()).resources
    await clickCanvas(page, first)
    await page.waitForFunction((n) => window.__game.state.towers.length === n, 1)
    check((await state()).resources === startResources - cost,
      `critère 3 : première pose facturée ${startResources - (await state()).resources} au lieu de ${cost}`)

    const occupiedPoint = await ringPoint(page, first)
    check(Boolean(occupiedPoint), 'critère 3 : aucun point voisin cliquable autour de l\'emplacement occupé')
    if (occupiedPoint) {
      const before = await state()
      await clickCanvas(page, occupiedPoint)
      await page.waitForFunction(() => window.__game.state.lastRefusal === 'occupied')
      const after = await state()
      check(after.lastAction === 'refused', `critère 3 : lastAction ${after.lastAction} au lieu de refused`)
      check(after.resources === before.resources,
        `critère 3 (occupé) : ressources ${after.resources} au lieu de ${before.resources}`)
      check(after.towers.length === before.towers.length,
        `critère 3 (occupé) : ${after.towers.length} tour(s) au lieu de ${before.towers.length}`)
    }

    // Refus « hors emplacement ».
    const outside = await outsidePoint(page, slots)
    check(Boolean(outside), 'critère 3 : aucun point de sol hors emplacement n\'est cliquable')
    if (outside) {
      const before = await state()
      await clickCanvas(page, outside)
      await page.waitForFunction(() => window.__game.state.lastRefusal === 'outside')
      const after = await state()
      check(after.lastAction === 'refused', `critère 3 : lastAction ${after.lastAction} au lieu de refused`)
      check(after.resources === before.resources,
        `critère 3 (hors emplacement) : ressources ${after.resources} au lieu de ${before.resources}`)
      check(after.towers.length === before.towers.length,
        `critère 3 (hors emplacement) : ${after.towers.length} tour(s) au lieu de ${before.towers.length}`)
    }

    // Deux poses de plus : 120 − 3 × 40 = 0, la quatrième est refusée faute de sève.
    for (const slot of usable.slice(1, 3)) {
      await clickCanvas(page, slot)
      await page.waitForFunction((n) => window.__game.state.towers.length === n, 2 + usable.slice(1, 3).indexOf(slot))
    }
    const empty = await state()
    check(empty.resources === 0, `critère 3 : ${empty.resources} sève(s) après trois pousses au lieu de 0`)
    check(empty.towers.length === 3,
      `critère 3 : ${empty.towers.length} tour(s) après trois poses au lieu de 3`)

    const fourth = usable[3]
    if (fourth) {
      const before = await state()
      await clickCanvas(page, fourth)
      await page.waitForFunction(() => window.__game.state.lastRefusal === 'funds')
      const after = await state()
      check(after.lastAction === 'refused', `critère 3 : lastAction ${after.lastAction} au lieu de refused`)
      check(after.resources === before.resources,
        `critère 3 (fonds) : ressources ${after.resources} au lieu de ${before.resources}`)
      check(after.towers.length === before.towers.length,
        `critère 3 (fonds) : ${after.towers.length} tour(s) au lieu de ${before.towers.length}`)
      check(after.slots.find((slot) => slot.id === fourth.id)?.occupied === false,
        `critère 3 (fonds) : l'emplacement ${fourth.id} est marqué occupé malgré le refus`)
    }

    await capture(page, 'c3-refus')
  } catch (error) {
    failures.push(`critère 3 : ${error.message}`)
  }

  // -------------------------------------------------------------------------
  // Critère 4 — pose : clic sur un emplacement libre → tour dans state.towers,
  // ressources − data-cost lu dans le DOM, puis clic sur la tour →
  // state.selectedTower renseigné et marqueur de sélection visible.
  // -------------------------------------------------------------------------
  let posed = null
  try {
    await load('?lang=fr')
    await setViewport(page, DESKTOP)
    await openBar(page)
    await selectSeed(page, 'sprout')

    const slots = await slotPoints(page)
    const target = slots.find((slot) => slot.inFront && slot.inside && slot.canvas)
    check(Boolean(target), 'critère 4 : aucun emplacement libre cliquable')

    const bar = await readBar(page)
    const domCost = bar.entries.find((entry) => entry.tower === 'sprout')?.cost
    check(domCost === TOWERS.sprout.cost,
      `critère 4 : data-cost du DOM ${domCost} ≠ ${TOWERS.sprout.cost}`)

    const before = await state()
    check(before.resources === LEVEL_1.startingResources,
      `critère 4 : ressources initiales ${before.resources} au lieu de ${LEVEL_1.startingResources}`)

    await clickCanvas(page, target)
    await page.waitForFunction(() => window.__game.state.towers.length === 1)
    const after = await state()
    const tower = after.towers[0]
    posed = tower
    check(after.resources === before.resources - domCost,
      `critère 4 : ressources ${after.resources} au lieu de ${before.resources - domCost}`)
    check(after.lastAction === 'placed', `critère 4 : lastAction ${after.lastAction} au lieu de placed`)
    check(tower?.type === 'sprout' && tower?.level === 1,
      `critère 4 : tour ${tower?.type} niveau ${tower?.level} au lieu de sprout niveau 1`)
    check(tower?.slotId === target.id,
      `critère 4 : tour posée sur ${tower?.slotId} au lieu de ${target.id}`)
    check(after.selectedTower === null,
      `critère 4 : la pose auto-sélectionne la tour (${after.selectedTower})`)
    check(after.slots.find((slot) => slot.id === target.id)?.occupied === true,
      `critère 4 : l'emplacement ${target.id} n'est pas marqué occupé`)

    // Clic sur la tour : point au corps (y = 0,5), pas au sol.
    const body = await screenPoint(page, tower.x, 0.5, tower.z)
    check(body.inFront && body.inside && body.canvas,
      'critère 4 : la tour posée n\'est pas cliquable à l\'écran')
    await clickCanvas(page, body)
    await page.waitForFunction(() => window.__game.state.selectedTower !== null)
    const selected = await state()
    const marker = await selectionMarker(page)
    check(selected.selectedTower === tower.id,
      `critère 4 : selectedTower ${selected.selectedTower} au lieu de ${tower.id}`)
    check(selected.lastAction === 'selected',
      `critère 4 : lastAction ${selected.lastAction} au lieu de selected`)
    check(marker?.visible === true, 'critère 4 : marqueur de sélection invisible')
    check(Math.abs((marker?.x ?? NaN) - tower.x) < 0.01
      && Math.abs((marker?.z ?? NaN) - tower.z) < 0.01,
      `critère 4 : marqueur en (${marker?.x}, ${marker?.z}) au lieu de (${tower.x}, ${tower.z})`)

    const withSelection = await readBar(page)
    check(withSelection.selectionVisible === true,
      'critère 4 : la barre n\'affiche pas la tour sélectionnée')
    check(withSelection.listHidden === true,
      'critère 4 : les graines restent affichées pendant la sélection')
    check(withSelection.level === fr['tower.level'].replace('{n}', '1'),
      `critère 4 : niveau affiché « ${withSelection.level} »`)
    check(withSelection.price === fr['tower.price'].replace('{n}', String(TOWERS.sprout.upgradeCost)),
      `critère 4 : prix d'amélioration affiché « ${withSelection.price} »`)
    check(withSelection.upgradeText === fr['tower.upgrade'],
      `critère 4 : bouton « ${withSelection.upgradeText} » au lieu de « ${fr['tower.upgrade']} »`)
    check(withSelection.upgradeDisabled === false,
      'critère 4 : le bouton d\'amélioration est inactif avec 80 sève')

    await capture(page, 'c4-pose')
  } catch (error) {
    failures.push(`critère 4 : ${error.message}`)
  }

  // -------------------------------------------------------------------------
  // Critère 5 — amélioration : tour sélectionnée, clic sur t('tower.upgrade') →
  // niveau 2, ressources − prix affiché exactement, capture avant/après avec
  // au moins 150 pixels différents dans la zone projetée de la tour.
  // -------------------------------------------------------------------------
  try {
    check(Boolean(posed), 'critère 5 : aucune tour posée par le critère 4')
    if (!posed) throw new Error('préparation absente')

    const before = await state()
    const tower = before.towers.find((item) => item.id === posed.id)
    const bar = await readBar(page)
    const priceText = bar.price
    const upgradePrice = Number((priceText.match(/\d+/) ?? [NaN])[0])
    check(upgradePrice === TOWERS.sprout.upgradeCost,
      `critère 5 : prix d'amélioration affiché « ${priceText} » au lieu de ${TOWERS.sprout.upgradeCost} sève`)
    check(bar.upgradeDisabled === false,
      `critère 5 : bouton actif attendu (${before.resources} sève, niveau ${tower?.level})`)

    const zone = await towerZone(page, tower)
    await decode(page, await capture(page, 'c5-before'), 'c5-before')

    await page.click('.tower-bar__upgrade')
    await page.waitForFunction((id) => {
      const record = window.__game.state.towers.find((item) => item.id === id)
      return record?.level === 2
    }, tower.id)
    // Laisse la transition CSS (160 ms) rendre le bouton inactif avant la capture.
    await page.waitForFunction(() => {
      const button = document.querySelector('.tower-bar__upgrade')
      return button.disabled && getComputedStyle(button).backgroundColor === 'rgb(233, 226, 210)'
    })
    await nextFrames(page, 2)

    const after = await state()
    const upgraded = after.towers.find((item) => item.id === tower.id)
    check(upgraded?.level === 2, `critère 5 : niveau ${upgraded?.level} au lieu de 2`)
    check(after.resources === before.resources - upgradePrice,
      `critère 5 : ressources ${after.resources} au lieu de ${before.resources - upgradePrice}`)
    check(after.lastAction === 'upgraded',
      `critère 5 : lastAction ${after.lastAction} au lieu de upgraded`)
    check(after.selectedTower === tower.id,
      `critère 5 : selectedTower ${after.selectedTower} perdu après l'amélioration`)

    const afterBar = await readBar(page)
    check(afterBar.level === fr['tower.level'].replace('{n}', '2'),
      `critère 5 : niveau affiché « ${afterBar.level} » au lieu de « Niveau 2 »`)
    check(afterBar.upgradeDisabled === true,
      'critère 5 : le bouton reste actif après le niveau 2')
    const marker = await selectionMarker(page)
    check(marker?.visible === true, 'critère 5 : marqueur de sélection perdu après l\'amélioration')

    const buffer = await capture(page, 'c5-after')
    await decode(page, buffer, 'c5-after')
    const changed = await diffPixels(page, 'c5-before', 'c5-after', zone)
    check(changed >= 150,
      `critère 5 : ${changed} pixel(s) changés dans la zone de la tour (< 150)`)
    console.log(`[tours] critère 5 — ${changed} pixels changés dans la zone projetée de la tour`)

    // La barre de sélection affiche encore « Niveau 2 » : à nouveau sans texte en dur.
    const texts = await uiTexts(page)
    const hardcoded = hardcodedTexts(texts, fr)
    check(hardcoded.length === 0,
      `critère 5 : texte en dur dans l'interface : ${hardcoded.join(' / ')}`)
  } catch (error) {
    failures.push(`critère 5 : ${error.message}`)
  }

  // -------------------------------------------------------------------------
  // Critère 6 — non-régression : état du niveau et décor 3D inchangés après
  // pose + sélection + amélioration, caméra bornée (yaw, pitch, distance, pan),
  // Mecaniques.md à jour, 390×844 utilisable, aucun texte en dur.
  // -------------------------------------------------------------------------
  try {
    await load('?lang=fr')
    await setViewport(page, DESKTOP)
    const levelBefore = await page.evaluate(() => JSON.stringify(window.__game.state.level))
    const decorBefore = await decorSignature(page)
    const decorExposed = await page.evaluate(() => 'decor' in window.__game.state.level)
    check(decorBefore !== null, 'critère 6 : groupe « decor » introuvable dans la scène')

    // Parcours complet : une pose, une sélection, une amélioration.
    await openBar(page)
    await selectSeed(page, 'sprout')
    const slots = await slotPoints(page)
    const target = slots.find((slot) => slot.inFront && slot.inside && slot.canvas)
    check(Boolean(target), 'critère 6 : aucun emplacement cliquable pour le parcours')
    if (target) {
      await clickCanvas(page, target)
      await page.waitForFunction(() => window.__game.state.towers.length === 1)
      const record = (await state()).towers[0]
      const body = await screenPoint(page, record.x, 0.5, record.z)
      await clickCanvas(page, body)
      await page.waitForFunction(() => window.__game.state.selectedTower !== null)
      await page.click('.tower-bar__upgrade')
      await page.waitForFunction(() => window.__game.state.towers[0]?.level === 2)
    }

    const levelAfter = await page.evaluate(() => JSON.stringify(window.__game.state.level))
    const decorAfter = await decorSignature(page)
    check(levelBefore === levelAfter, 'critère 6 : state.level a changé après les actions sur les tours')
    check(JSON.stringify(LEVEL_1.camera)
      === await page.evaluate(() => JSON.stringify(window.__game.state.level.camera)),
      'critère 6 : state.level.camera ne correspond plus à LEVEL_1.camera')
    check(JSON.stringify(decorBefore) === JSON.stringify(decorAfter),
      `critère 6 : décor modifié (${JSON.stringify(decorBefore)} → ${JSON.stringify(decorAfter)})`)
    check(decorBefore?.children > 0 && decorBefore?.triangles > 0,
      'critère 6 : décor vide, non-régression invérifiable')
    if (!decorExposed) {
      // game.state n'expose pas de level.decor : le décor est vérifié sur le graphe 3D.
      console.log('[tours] critère 6 — state.level.decor non exposé ; décor vérifié sur le groupe « decor » de la scène')
    }

    // Caméra : glissement toujours obéissant et borné aux valeurs de LEVEL_1.camera.
    const cameraConfig = LEVEL_1.camera
    const camBefore = await page.evaluate(() => ({ ...window.__game.state.camera }))
    const corners = [
      [cameraConfig.yaw[1], cameraConfig.pitch[0]],
      [cameraConfig.yaw[0], cameraConfig.pitch[1]],
      [cameraConfig.yaw[1], cameraConfig.pitch[1]],
      [cameraConfig.yaw[0], cameraConfig.pitch[0]],
    ]
    for (const [index, [yaw, pitch]] of corners.entries()) {
      const current = await page.evaluate(() => window.__game.state.camera)
      await drag(page, -(yaw - current.yaw) / RADIANS_PER_PIXEL, -(pitch - current.pitch) / RADIANS_PER_PIXEL)
      const camera = await page.evaluate(() => window.__game.state.camera)
      check(Math.abs(camera.yaw - yaw) <= 0.01,
        `critère 6 : glissement ${index + 1}, yaw ${camera.yaw.toFixed(3)} au lieu de ${yaw}`)
      check(Math.abs(camera.pitch - pitch) <= 0.01,
        `critère 6 : glissement ${index + 1}, pitch ${camera.pitch.toFixed(3)} au lieu de ${pitch}`)
      check(camera.inBounds === true,
        `critère 6 : glissement ${index + 1} sort des bornes (inBounds=false)`)
    }

    // Dépassement volontaire : les bornes tiennent bon malgré un geste de 600 px.
    const current = await page.evaluate(() => window.__game.state.camera)
    await drag(page, -(2 - current.yaw) / RADIANS_PER_PIXEL, -(-1 - current.pitch) / RADIANS_PER_PIXEL)
    const clamped = await page.evaluate(() => window.__game.state.camera)
    check(clamped.yaw <= cameraConfig.yaw[1] + 1e-6 && clamped.yaw >= cameraConfig.yaw[0] - 1e-6,
      `critère 6 : yaw ${clamped.yaw.toFixed(3)} hors de [${cameraConfig.yaw[0]}, ${cameraConfig.yaw[1]}]`)
    check(clamped.pitch <= cameraConfig.pitch[1] + 1e-6 && clamped.pitch >= cameraConfig.pitch[0] - 1e-6,
      `critère 6 : pitch ${clamped.pitch.toFixed(3)} hors de [${cameraConfig.pitch[0]}, ${cameraConfig.pitch[1]}]`)
    check(clamped.distance === camBefore.distance
      && clamped.distance >= cameraConfig.distance[0]
      && clamped.distance <= cameraConfig.distance[1],
      `critère 6 : distance ${clamped.distance} hors de [${cameraConfig.distance[0]}, ${cameraConfig.distance[1]}]`)
    check(Math.abs(clamped.targetX - cameraConfig.target.x) <= cameraConfig.pan
      && Math.abs(clamped.targetZ - cameraConfig.target.z) <= cameraConfig.pan,
      `critère 6 : cible (${clamped.targetX}, ${clamped.targetZ}) hors du pan de ${cameraConfig.pan}`)
    await capture(page, 'c6-camera')

    // Mecaniques.md : pose, prix, amélioration, contrôles, bornes caméra.
    const md = await readFile(MECANIQUES, 'utf8')
    const normalized = md.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    check(/poser une tour/.test(normalized), 'critère 6 : la pose d\'une tour n\'est pas documentée')
    check(/prix/.test(normalized), 'critère 6 : les prix ne sont pas documentés')
    check(/amelior/.test(normalized), 'critère 6 : l\'amélioration n\'est pas documentée')
    check(/controles/.test(normalized) && /souris/.test(normalized) && /tactile/.test(normalized),
      'critère 6 : les contrôles souris et tactile ne sont pas documentés')
    const lines = md.split(/\r?\n/)
    const rowOf = (label) => lines.find((line) => line.startsWith('|') && line.includes(label))
    const sproutRow = rowOf('Pousse')
    const bloomRow = rowOf('Floraison')
    check(Boolean(sproutRow) && sproutRow.includes(String(TOWERS.sprout.cost))
      && sproutRow.includes(String(TOWERS.sprout.upgradeCost)),
      `critère 6 : ligne Pousse absente ou prix désynchronisés (${sproutRow})`)
    check(Boolean(bloomRow) && bloomRow.includes(String(TOWERS.bloom.cost))
      && bloomRow.includes(String(TOWERS.bloom.upgradeCost)),
      `critère 6 : ligne Floraison absente ou prix désynchronisés (${bloomRow})`)
    check(normalized.includes(String(LEVEL_1.startingResources)),
      `critère 6 : réserve initiale ${LEVEL_1.startingResources} sève non documentée`)
    const french = (value) => String(value).replace('.', ',')
    const bounds = [
      ['yaw', cameraConfig.yaw[0], cameraConfig.yaw[1]],
      ['pitch', cameraConfig.pitch[0], cameraConfig.pitch[1]],
      ['distance', cameraConfig.distance[0], cameraConfig.distance[1]],
      ['pan', cameraConfig.pan],
    ]
    for (const [name, low, high] of bounds) {
      const line = lines.find((item) => item.includes(`\`${name}\``))
      const documented = line !== undefined
        && line.includes(french(low))
        && (high === undefined || line.includes(french(high)))
      check(documented,
        `critère 6 : borne « ${name} » absente ou désynchronisée de level-1.js (${low}${high === undefined ? '' : ` à ${high}`})`)
    }

    // 390×844 : barre entièrement dans le viewport, entrées lisibles, pose tactile.
    await setViewport(page, MOBILE)
    await load('?lang=fr')
    await openBar(page)
    const mobileBar = await readBar(page)
    const inViewport = (rect) => rect.x >= 0 && rect.y >= 0
      && rect.right <= page.viewportSize().width + 0.5
      && rect.bottom <= page.viewportSize().height + 0.5
    check(mobileBar.open === true, 'critère 6 : la barre ne s\'ouvre pas sur 390×844')
    check(inViewport(mobileBar.rect) && inViewport(mobileBar.handleRect),
      `critère 6 : barre (${JSON.stringify(mobileBar.rect)}) ou poignée hors du viewport 390×844`)
    check(mobileBar.entries.length >= 2 && mobileBar.entries.every((entry) =>
      inViewport(entry.rect) && entry.priceClipped === false),
      'critère 6 : entrées ou prix illisibles sur 390×844')

    await selectSeed(page, 'sprout')
    const mobileTexts = await uiTexts(page)
    const hardcoded = hardcodedTexts(mobileTexts, fr)
    check(hardcoded.length === 0,
      `critère 6 : texte en dur à 390×844 : ${hardcoded.join(' / ')}`)

    // En portrait, le cadrage resserré ne montre pas les emplacements latéraux au
    // yaw 0 : un glissement de caméra (comme en jeu) amène le premier dans le champ.
    const mobileCamera = await page.evaluate(() => window.__game.state.camera)
    await drag(page, -(0.45 - mobileCamera.yaw) / RADIANS_PER_PIXEL, -(1.05 - mobileCamera.pitch) / RADIANS_PER_PIXEL)
    await page.waitForFunction(() => Math.abs(window.__game.state.camera.yaw - 0.45) <= 0.01)
    const mobileSlots = await slotPoints(page)
    const mobileTarget = mobileSlots.find((slot) => slot.inFront && slot.inside && slot.canvas)
    if (mobileTarget) {
      await tapCanvas(page, mobileTarget)
      await page.waitForFunction(() => window.__game.state.towers.length === 1)
      const mobile = await state()
      check(mobile.resources === LEVEL_1.startingResources - TOWERS.sprout.cost,
        `critère 6 : pose tactile à 390×844 facturée ${LEVEL_1.startingResources - mobile.resources} sève`)
    } else {
      failures.push('critère 6 : aucun emplacement cliquable à 390×844')
    }
    await capture(page, 'c6-mobile')
  } catch (error) {
    failures.push(`critère 6 : ${error.message}`)
  }

  if (failures.length) throw new Error(failures.join(' | '))
}
