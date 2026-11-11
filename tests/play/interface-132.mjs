// Playtest de l'Epic #132 — interface lisible et ergonomique.
// Un bloc par critère d'acceptation, dans l'ordre de l'Epic :
//   1. sève visible en permanence, 120 au départ, texte = `state.resources` après chaque dépense ;
//   2. « Retour » seul contrôle d'une barre dédiée ancrée en haut, cible ≥ 44×44, aucun bouton
//      `position: absolute` à mi-hauteur ;
//   3. icônes SVG inline (sève, cœur, graines, amélioration, son/muet), trait #3e4a43,
//      accent de palette, `aria-hidden`, aucun `<img>` ni emoji ;
//   4. barre des tours permanente dès le lancement, sans poignée de repli, encore visible 10 s
//      plus tard sans interaction ;
//   5. `measureUi()` sans chevauchement et texte dans le cadre à 390×844 et 1280×720 ;
//   6. FR → EN : clés identiques dans les deux dictionnaires, aucune clé brute, aucun débordement.
// Toutes les valeurs lues viennent de `window.__game.state`, `window.__game.measureUi()`, du DOM
// calculé (`getComputedStyle`) ou des dictionnaires du jeu ; aucun fichier du jeu n'est modifié.
// Captures demandées par le ticket #156 : `interface-132-390x844.png` et `interface-132-1280x720.png`
// en début de niveau, plus `interface-132-fr.png` / `interface-132-en.png` (une par langue).
// En worktree parallèle, chaque capture est aussi copiée dans le test-results/ du dépôt principal,
// préfixée `issue-N-`, comme le veut la convention du studio (cf. tests/play/jardins.mjs).
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TOWERS } from '../../src/data/towers.js'
import { outputDir } from '../../scripts/lib.mjs'

const MOBILE = { width: 390, height: 844 }
const DESKTOP = { width: 1280, height: 720 }
/** Palette de vault/GDD/Direction-Artistique.md — seules couleurs admises dans une icône. */
const PALETTE = {
  paper: '#faf3e3',
  primary: '#6ec6b5',
  danger: '#e8907f',
  reward: '#f2c66d',
  ink: '#3e4a43',
}
const ICON_ACCENTS = [PALETTE.paper, PALETTE.primary, PALETTE.danger, PALETTE.reward]
const ICON_COLORS = [PALETTE.ink, ...ICON_ACCENTS]
/** Clés exigées par l'Epic dans les deux langues (barre haute, sève, barre des tours). */
const REQUIRED_KEYS = [
  'game.back',
  'hud.sap',
  'hud.sap.label',
  'tower.bar.label',
  'tower.sprout.name',
  'tower.bloom.name',
  'tower.price',
  'tower.level',
  'tower.upgrade',
  'audio.mute',
  'audio.unmute',
]
/**
 * Icônes au dessin purement linéaire dans `src/art/icons.js` (#143) : `back` et `sound` /
 * `sound-muted` n'ont pas de `fill` d'accent, seulement le trait d'encre. Le contrôle
 * d'accent ne s'applique donc pas à elles ; toutes leurs couleurs doivent rester dans la
 * palette, et le trait reste exigé.
 */
const LINE_ONLY_ICONS = new Set(['son/muet'])
const ICON_HOSTS = [
  ['sève', '.high-bar__sap'],
  ['cœur/PV', '.wave-hud__core'],
  ['graine Pousse', '.tower-bar__entry[data-tower="sprout"]'],
  ['graine Floraison', '.tower-bar__entry[data-tower="bloom"]'],
  ['amélioration', '.tower-bar__upgrade'],
  ['son/muet', '.audio-toggle'],
]
const SVG_NS = 'http://www.w3.org/2000/svg'

const FR = JSON.parse(readFileSync(fileURLToPath(new URL('../../src/i18n/fr.json', import.meta.url)), 'utf8'))
const EN = JSON.parse(readFileSync(fileURLToPath(new URL('../../src/i18n/en.json', import.meta.url)), 'utf8'))
const DICTS = { fr: FR, en: EN }

const { results, prefix } = outputDir()
mkdirSync('test-results', { recursive: true })
mkdirSync(results, { recursive: true })

/** Dimensions d'un PNG d'après son en-tête IHDR (octets 16–23), sans dépendance. */
function pngSize(path) {
  const header = readFileSync(path).subarray(0, 24)
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) }
}

/** Attend le nombre d'images de rendu demandé (aucune attente arbitraire). */
const nextFrames = (page, count = 2) => page.evaluate((n) => new Promise((resolve) => {
  let seen = 0
  const loop = () => (++seen >= n ? resolve() : requestAnimationFrame(loop))
  requestAnimationFrame(loop)
}), count)

/** Attend le montage complet du niveau : 4 rectangles de `measureUi()` non nuls. */
function ready(page) {
  return page.waitForFunction(() => {
    const measure = window.__game?.measureUi?.()
    return window.__game?.state.screen === 'game'
      && ['highBar', 'waveHud', 'core', 'towerBar'].every((key) =>
        measure?.[key] && measure[key].width > 0 && measure[key].height > 0)
  })
}

/** Rectangles px CSS des quatre blocs, copiés tels quels. */
const measure = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__game.measureUi())))

/** Aire d'intersection de deux rectangles px CSS (0 s'ils ne se chevauchent pas). */
function overlapArea(a, b) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  return width > 0 && height > 0 ? width * height : 0
}

/** Vrai si `inner` est contenu dans `outer` à la tolérance près. */
function contains(outer, inner, tolerance = 0.5) {
  return inner.x >= outer.x - tolerance
    && inner.y >= outer.y - tolerance
    && inner.x + inner.width <= outer.x + outer.width + tolerance
    && inner.y + inner.height <= outer.y + outer.height + tolerance
}

const box = (rect) => rect ? `${Math.round(rect.x)}×${Math.round(rect.y)} ${rect.width.toFixed(1)}×${rect.height.toFixed(1)}` : 'absent'

/** Barre haute : géométrie, unique contrôle, cible du retour, sève. */
function readHighBar(page) {
  return page.evaluate(() => {
    const element = document.querySelector('.high-bar')
    if (!element) return null
    const rectOf = (node) => {
      if (!node) return null
      const rect = node.getBoundingClientRect()
      return {
        x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        right: rect.right, bottom: rect.bottom,
      }
    }
    const style = getComputedStyle(element)
    const buttons = [...element.querySelectorAll('button')]
    const back = element.querySelector('.high-bar__back')
    const sap = element.querySelector('.high-bar__sap')
    const sapValue = element.querySelector('.high-bar__sap-value')
    const backIcon = back?.querySelector('svg')
    const sapIcon = sap?.querySelector(':scope > svg')
    return {
      tag: element.tagName,
      rect: rectOf(element),
      position: style.position,
      display: style.display,
      visibility: style.visibility,
      children: [...element.children].map((child) => ({
        tag: child.tagName,
        className: typeof child.className === 'string' ? child.className : child.className.baseVal,
        action: child.dataset?.action ?? null,
      })),
      buttonCount: buttons.length,
      buttonActions: buttons.map((button) => button.dataset.action ?? null),
      inWaveHud: element.closest('.wave-hud') !== null,
      inCanvas: element.closest('canvas') !== null,
      back: back ? {
        rect: rectOf(back),
        position: getComputedStyle(back).position,
        text: back.textContent.trim(),
        ariaLabel: back.getAttribute('aria-label'),
        iconTag: backIcon?.tagName.toLowerCase() ?? null,
        iconHidden: backIcon?.getAttribute('aria-hidden') ?? null,
      } : null,
      sap: sap ? {
        tag: sap.tagName,
        rect: rectOf(sap),
        text: sapValue?.textContent.trim() ?? null,
        title: sap.getAttribute('title'),
        ariaLive: sap.getAttribute('aria-live'),
        tabIndex: sap.getAttribute('tabindex'),
        iconTag: sapIcon?.tagName.toLowerCase() ?? null,
        iconHidden: sapIcon?.getAttribute('aria-hidden') ?? null,
        visible: getComputedStyle(sap).visibility !== 'hidden'
          && getComputedStyle(sap).display !== 'none'
          && rectOf(sap).width > 0 && rectOf(sap).height > 0,
      } : null,
    }
  })
}

/** Boutons visibles de l'interface, avec leur position calculée et leur centre vertical. */
function buttons(page) {
  return page.evaluate(() => [...document.querySelectorAll('#ui button')]
    .filter((button) => {
      const style = getComputedStyle(button)
      const rect = button.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden'
        && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0
    })
    .map((button) => {
      const style = getComputedStyle(button)
      const rect = button.getBoundingClientRect()
      const centerY = rect.y + rect.height / 2
      return {
        className: typeof button.className === 'string' ? button.className : button.className.baseVal,
        action: button.dataset.action ?? null,
        position: style.position,
        rect: {
          x: rect.x, y: rect.y, width: rect.width, height: rect.height,
          right: rect.right, bottom: rect.bottom,
        },
        centerY,
        midHeight: centerY >= innerHeight * 0.25 && centerY <= innerHeight * 0.75,
      }
    }))
}

/** Barre des tours : visibilité, entrées (nom, prix, icône), poignée et bouton de repli. */
function readTowerBar(page) {
  return page.evaluate(() => {
    const bar = document.querySelector('.tower-bar')
    const panel = bar?.querySelector('.tower-bar__panel')
    if (!bar || !panel || !window.__game?.state?.towerBar) return null
    const rectOf = (node) => {
      if (!node) return null
      const rect = node.getBoundingClientRect()
      return {
        x: rect.x, y: rect.y, width: rect.width, height: rect.height,
        right: rect.right, bottom: rect.bottom,
      }
    }
    const style = getComputedStyle(panel)
    return {
      open: bar.dataset.open === 'true',
      stateOpen: window.__game.state.towerBar.open === true,
      panel: rectOf(panel),
      visible: style.display !== 'none' && style.visibility !== 'hidden'
        && Number(style.opacity) === 1 && rectOf(panel).width > 0 && rectOf(panel).height > 0,
      handle: document.querySelector('.tower-bar__handle') !== null,
      toggle: document.querySelector('button[data-action="toggle-towers"]') !== null,
      entries: [...bar.querySelectorAll('.tower-bar__entry')].map((entry) => {
        const name = entry.querySelector('.tower-bar__entry-name')
        const price = entry.querySelector('.tower-bar__entry-cost')
        const icon = entry.querySelector(':scope > svg')
        return {
          tower: entry.dataset.tower,
          cost: Number(entry.dataset.cost),
          name: name?.textContent.trim() ?? null,
          price: price?.textContent.trim() ?? null,
          nameClipped: name ? name.scrollWidth > name.clientWidth + 1 : true,
          priceClipped: price ? price.scrollWidth > price.clientWidth + 1 : true,
          rect: rectOf(entry),
          icon: icon ? {
            tag: icon.tagName.toLowerCase(),
            hidden: icon.getAttribute('aria-hidden'),
            width: icon.getBoundingClientRect().width,
            height: icon.getBoundingClientRect().height,
          } : null,
        }
      }),
    }
  })
}

/** Textes feuilles visibles et contrôles nommés : le libellé localisé doit rester le nom accessible. */
function readLabels(page) {
  return page.evaluate(() => {
    const icon = (selector) => {
      const svg = document.querySelector(`${selector} > svg`)
      return svg ? { tag: svg.tagName.toLowerCase(), hidden: svg.getAttribute('aria-hidden') } : null
    }
    return {
      back: { text: document.querySelector('.high-bar__back')?.textContent.trim() ?? null, icon: icon('.high-bar__back') },
      sap: { text: document.querySelector('.high-bar__sap-value')?.textContent.trim() ?? null, icon: icon('.high-bar__sap') },
      upgrade: {
        text: document.querySelector('.tower-bar__upgrade')?.textContent.trim() ?? null,
        ariaLabel: document.querySelector('.tower-bar__upgrade')?.getAttribute('aria-label') ?? null,
        icon: icon('.tower-bar__upgrade'),
      },
      audio: {
        label: document.querySelector('.audio-toggle')?.getAttribute('aria-label') ?? null,
        title: document.querySelector('.audio-toggle')?.getAttribute('title') ?? null,
        icon: icon('.audio-toggle'),
      },
      entries: [...document.querySelectorAll('.tower-bar__entry')].map((entry) => ({
        tower: entry.dataset.tower,
        text: entry.textContent.trim(),
        icon: icon(`.tower-bar__entry[data-tower="${entry.dataset.tower}"]`),
      })),
    }
  })
}

/** Couleurs peintes et attributs de l'icône de chaque bloc ; `img` compte les bitmaps. */
function readIcons(page, names) {
  return page.evaluate(({ hosts, palette, svgNamespace }) => {
    // `getComputedStyle` rend « rgb(r, g, b) » ou « rgba(...) » : normalisé en hex minuscule.
    const hex = (value) => {
      if (typeof value !== 'string' || value === 'none' || value.startsWith('url(')) return null
      const match = /^rgba?\(([^)]+)\)$/.exec(value)
      if (!match) return null
      const channels = match[1].split(/[ ,/]+/).filter(Boolean).map(Number)
      if (channels.length < 3 || channels.slice(0, 3).some((channel) => !Number.isFinite(channel))) return null
      if (channels.length > 3 && channels[3] === 0) return null
      return `#${channels.slice(0, 3).map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`
    }
    return hosts.map(([name, selector]) => {
      const host = document.querySelector(selector)
      if (!host) return { name, selector, error: 'bloc absent du DOM' }
      const svg = host.querySelector(':scope > svg')
      if (!svg) return { name, selector, error: 'aucun <svg> enfant direct' }
      const rect = svg.getBoundingClientRect()
      const strokes = new Set()
      const fills = new Set()
      // Seules les formes peignent : le `fill` par défaut (noir) du conteneur `<svg>` ou
      // d'un `<g>` n'apparaît jamais à l'écran, il ne doit pas être compté comme couleur.
      // Une forme masquée (`display: none`, `opacity: 0`) ne peint rien non plus.
      const shapes = svg.querySelectorAll('path, circle, ellipse, rect, line, polyline, polygon')
      for (const node of shapes) {
        const style = getComputedStyle(node)
        if (style.display === 'none' || Number(style.opacity) === 0) continue
        const stroke = hex(style.stroke)
        const fill = hex(style.fill)
        if (stroke) strokes.add(stroke)
        if (fill) fills.add(fill)
      }
      const colors = [...new Set([...strokes, ...fills])]
      return {
        name,
        selector,
        tag: svg.tagName.toLowerCase(),
        namespace: svg.namespaceURI,
        ariaHidden: svg.getAttribute('aria-hidden'),
        focusable: svg.getAttribute('focusable'),
        width: rect.width,
        height: rect.height,
        img: host.querySelectorAll('img, svg image, image').length,
        strokes: [...strokes],
        fills: [...fills],
        colors,
        ink: strokes.has(palette.ink),
        accent: colors.some((color) => palette.accents.includes(color)),
        offPalette: colors.filter((color) => !palette.all.includes(color)),
        hostVisible: getComputedStyle(host).display !== 'none'
          && getComputedStyle(host).visibility !== 'hidden',
        hostText: host.textContent.trim(),
        isSvgNamespace: svg.namespaceURI === svgNamespace,
      }
    })
  }, {
    hosts: ICON_HOSTS.filter(([name]) => names.includes(name)),
    palette: { ink: PALETTE.ink, accents: ICON_ACCENTS, all: ICON_COLORS },
    svgNamespace: SVG_NS,
  })
}

/** Tous les textes feuilles et attributs porteurs de texte de `#ui`, visibles ou non. */
function readTexts(page) {
  return page.evaluate(() => {
    const root = document.getElementById('ui')
    const leaves = [...root.querySelectorAll('*')]
      .filter((element) => element.children.length === 0 && element.textContent.trim() !== '')
      .map((element) => ({
        text: element.textContent.trim(),
        where: `${element.tagName}${element.className ? `.${typeof element.className === 'string' ? element.className : element.className.baseVal}` : ''}`,
      }))
    const attributes = []
    for (const element of root.querySelectorAll('[title], [aria-label], [placeholder]')) {
      const where = `${element.tagName}${element.className ? `.${typeof element.className === 'string' ? element.className : element.className.baseVal}` : ''}`
      for (const name of ['title', 'aria-label', 'placeholder']) {
        const value = element.getAttribute(name)
        // Les noms d'icônes ne sont pas du texte affiché : seuls les attributs lisibles comptent.
        if (value && name !== 'placeholder') attributes.push({ text: value, where: `${where}@${name}` })
      }
    }
    return { leaves, attributes, imgs: root.querySelectorAll('img').length, svgImages: root.querySelectorAll('svg image, image').length }
  })
}

/** Texte hors cadre et débordement interne, sur les feuilles visibles (rect + scroll ↔ bornes). */
function readLayout(page) {
  return page.evaluate(() => {
    const root = document.getElementById('ui')
    const visible = (element) => {
      const style = getComputedStyle(element)
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false
      const rect = element.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    }
    const texts = [...root.querySelectorAll('*')]
      .filter((element) => element.children.length === 0 && element.textContent.trim() !== '')
      .filter(visible)
      .map((element) => {
        const rect = element.getBoundingClientRect()
        return {
          text: element.textContent.trim(),
          where: `${element.tagName}${element.className ? `.${typeof element.className === 'string' ? element.className : element.className.baseVal}` : ''}`,
          rect: {
            x: rect.x, y: rect.y, width: rect.width, height: rect.height,
            right: rect.right, bottom: rect.bottom,
          },
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
        }
      })
    return {
      viewport: { width: innerWidth, height: innerHeight },
      texts,
      outside: texts.filter((item) => item.rect.x < -0.5 || item.rect.y < -0.5
        || item.rect.right > innerWidth + 0.5 || item.rect.bottom > innerHeight + 0.5),
      clipped: texts.filter((item) =>
        (item.clientWidth > 0 && item.scrollWidth > item.clientWidth + 1)
        || (item.clientHeight > 0 && item.scrollHeight > item.clientHeight + 1)),
    }
  })
}

/** Projection d'un point monde en pixels CSS, avec contrôle de la cible réellement pointée. */
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

/** Les quatre emplacements du niveau, projetés, avec l'élément réellement pointé. */
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

export default async function ({ page, load, state, shot }) {
  // Un état attendu qui n'arrive pas échoue le critère en 6 s au lieu de bloquer le scénario.
  page.setDefaultTimeout(6000)
  const failures = []
  const check = (condition, message) => {
    if (!condition) failures.push(message)
  }

  /** Capture nommée interface-132-<label>.png, copiée dans le test-results/ principal en worktree. */
  async function capture(label) {
    await shot(label)
    const path = join('test-results', `interface-132-${label}.png`)
    if (prefix) copyFileSync(path, join(results, `${prefix}interface-132-${label}.png`))
    return pngSize(path)
  }

  const sapText = (dict, amount) => dict['hud.sap'].replace('{n}', String(amount))

  /** Vérifie une liste d'icônes (attributs, trait d'encre, palette, bitmap). */
  function verifyIcons(icons, where) {
    for (const icon of icons) {
      const tag = `${where} · icône ${icon.name}`
      if (icon.error) {
        check(false, `${tag} : ${icon.error}`)
        continue
      }
      check(icon.tag === 'svg' && icon.isSvgNamespace,
        `${tag} : pas un <svg> inline (${icon.tag}, namespace ${icon.namespace})`)
      check(icon.ariaHidden === 'true',
        `${tag} : aria-hidden="${icon.ariaHidden}" au lieu de "true"`)
      check(icon.focusable === 'false', `${tag} : focusable="${icon.focusable}" au lieu de "false"`)
      check(icon.width > 0 && icon.height > 0,
        `${tag} : icône non mesurable (${icon.width}×${icon.height})`)
      check(icon.img === 0, `${tag} : contient une image bitmap`)
      check(icon.ink, `${tag} : aucun trait ${PALETTE.ink} (traits : ${icon.strokes.join(', ') || 'aucun'})`)
      check(icon.offPalette.length === 0,
        `${tag} : couleurs hors palette ${icon.offPalette.join(', ')}`)
      if (!LINE_ONLY_ICONS.has(icon.name)) {
        check(icon.accent,
          `${tag} : aucun accent de palette ${ICON_ACCENTS.join(', ')} (couleurs : ${icon.colors.join(', ') || 'aucune'})`)
      }
    }
    console.log(`[interface-132] ${where} — icônes : ${icons.map((icon) =>
      `${icon.name} [trait ${icon.strokes.join('/')}; ${icon.colors.join('/')}${LINE_ONLY_ICONS.has(icon.name) ? ' ; trait seul' : ''}]`).join(' · ')}`)
  }

  /** Vérifie la géométrie (4 rects non nuls, containment du cœur, blocs racine disjoints). */
  function verifyLayout(rects, where) {
    for (const key of ['highBar', 'waveHud', 'core', 'towerBar']) {
      const rect = rects?.[key]
      check(rect !== null && rect !== undefined, `${where} : measureUi().${key} = null`)
      if (!rect) continue
      check(rect.width > 0 && rect.height > 0,
        `${where} : measureUi().${key} vide (${rect.width}×${rect.height})`)
    }
    if (!rects) return
    // `core` est un enfant de `waveHud` (paire parent/enfant, amendement #150) : containment.
    check(contains(rects.waveHud, rects.core),
      `${where} : .wave-hud__core ${box(rects.core)} hors de .wave-hud ${box(rects.waveHud)}`)
    const pairs = [
      ['highBar', 'waveHud'], ['highBar', 'core'], ['highBar', 'towerBar'],
      ['waveHud', 'towerBar'], ['core', 'towerBar'],
    ]
    for (const [a, b] of pairs) {
      const area = overlapArea(rects[a], rects[b])
      check(area === 0,
        `${where} : ${a} ${box(rects[a])} ∩ ${b} ${box(rects[b])} = ${area.toFixed(2)} px²`)
    }
    console.log(`[interface-132] ${where} — measureUi : highBar ${box(rects.highBar)} · waveHud ${box(rects.waveHud)}`
      + ` · core ${box(rects.core)} · towerBar ${box(rects.towerBar)}`)
  }

  /** Texte dans le cadre et sans débordement interne. */
  function verifyText(layout, where) {
    check(layout.outside.length === 0,
      `${where} : texte hors cadre ${layout.outside.map((item) => `« ${item.text} » (${box(item.rect)})`).join(', ')}`)
    check(layout.clipped.length === 0,
      `${where} : texte tronqué ${layout.clipped.map((item) => `« ${item.text} » (${item.scrollWidth}px > ${item.clientWidth}px)`).join(', ')}`)
    console.log(`[interface-132] ${where} — ${layout.texts.length} textes visibles,`
      + ` ${layout.outside.length} hors cadre, ${layout.clipped.length} tronqués`)
  }

  // ===========================================================================
  // Critère 1 (départ) + critère 2 + critère 3 + critère 4 + critère 5, sur un
  // chargement mobile SANS AUCUNE interaction : le départ réel du joueur, 390×844.
  // ===========================================================================
  let mobileLayout = null
  let mobileRects = null
  try {
    await page.setViewportSize(MOBILE)
    await load('?lang=fr&niveau=1')
    await ready(page)

    const snap = await state()
    check(snap.screen === 'game', `critère 1 : écran « ${snap.screen} » au lieu de « game »`)
    check(snap.level?.id, 'critère 1 : state.level.id absent')
    check(snap.resources === 120, `critère 1 : state.resources ${snap.resources} au départ au lieu de 120`)

    // Capture demandée par le ticket #156, en début de niveau, avant tout clic.
    const mobilePng = await capture('390x844')
    check(mobilePng.width === MOBILE.width && mobilePng.height === MOBILE.height,
      `capture 390x844 : ${mobilePng.width}×${mobilePng.height}`)

    // --- Critère 1 : sève visible sans interaction, 120 au départ. ---
    const bar = await readHighBar(page)
    check(bar !== null, 'critère 1 : .high-bar absente')
    if (bar) {
      check(bar.sap !== null, 'critère 1 : .high-bar__sap absente')
      check(bar.sap?.visible === true, 'critère 1 : le compteur de sève n\'est pas visible au chargement')
      check(bar.sap?.text === sapText(FR, 120),
        `critère 1 : compteur « ${bar.sap?.text} » au départ au lieu de « ${sapText(FR, 120)} »`)
      check(bar.sap?.iconTag === 'svg' && bar.sap?.iconHidden === 'true',
        'critère 1 : l\'icône du compteur de sève n\'est pas un SVG aria-hidden')
      check(bar.children.length === 2,
        `critère 1 : .high-bar porte ${bar.children.length} blocs (${bar.children.map((child) => child.className).join(', ')}) au lieu de retour + sève`)
      check(bar.sap?.tag === 'SPAN' && bar.sap?.tabIndex === null,
        `critère 1 : le compteur de sève n'est pas un affichage passif (${bar.sap?.tag}, tabindex ${bar.sap?.tabIndex})`)
      console.log(`[interface-132] critère 1 — sève « ${bar.sap?.text} » visible, state.resources ${snap.resources}`)
    }

    // --- Critère 2 : barre dédiée en haut, « Retour » seul contrôle, cible ≥ 44×44. ---
    if (bar) {
      check(['fixed', 'absolute', 'sticky'].includes(bar.position),
        `critère 2 : .high-bar en position ${bar.position} au lieu d'ancrée en haut`)
      check(bar.rect.y <= 1, `critère 2 : .high-bar à y=${bar.rect.y} au lieu de 0`)
      check(bar.rect.width >= MOBILE.width - 1,
        `critère 2 : .high-bar large de ${bar.rect.width} px au lieu de ${MOBILE.width}`)
      check(bar.inWaveHud === false, 'critère 2 : .high-bar est incluse dans le HUD de vague')
      check(bar.inCanvas === false, 'critère 2 : .high-bar est dans le décor (canvas)')
      check(bar.buttonCount === 1,
        `critère 2 : ${bar.buttonCount} bouton(s) dans .high-bar (${bar.buttonActions.join(', ')}) au lieu du seul Retour`)
      check(bar.buttonActions[0] === 'back',
        `critère 2 : le bouton de .high-bar a data-action « ${bar.buttonActions[0]} » au lieu de « back »`)
      check(bar.back !== null, 'critère 2 : .high-bar__back absent')
      if (bar.back) {
        check(bar.back.rect.width >= 44 && bar.back.rect.height >= 44,
          `critère 2 : cible Retour ${bar.back.rect.width.toFixed(1)}×${bar.back.rect.height.toFixed(1)} px CSS (< 44×44)`)
        check(bar.back.text === FR['game.back'],
          `critère 2 : libellé du Retour « ${bar.back.text} » au lieu de « ${FR['game.back']} »`)
        check(bar.back.ariaLabel === null || bar.back.ariaLabel === FR['game.back'],
          `critère 2 : nom accessible du Retour « ${bar.back.ariaLabel} » au lieu du libellé localisé`)
        check(bar.back.iconTag === 'svg' && bar.back.iconHidden === 'true',
          'critère 2 : l\'icône du Retour n\'est pas un SVG aria-hidden')
      }
    }
    const mobileButtons = await buttons(page)
    const floating = mobileButtons.filter((button) => ['absolute', 'fixed'].includes(button.position) && button.midHeight)
    check(floating.length === 0,
      `critère 2 : bouton(s) en position ${floating.map((button) => button.position).join('/')} à mi-hauteur : ${floating.map((button) => `.${button.className}`).join(', ')}`)
    console.log(`[interface-132] critère 2 — ${mobileButtons.length} boutons visibles, ${floating.length} à mi-hauteur ; retour ${bar?.back ? `${bar.back.rect.width.toFixed(0)}×${bar.back.rect.height.toFixed(0)} px` : '?'}`)
    await capture('c2-barre')

    // --- Critère 3 : icônes SVG (sève, cœur, graines, son) + libellés accessibles. ---
    const icons = await readIcons(page, ['sève', 'cœur/PV', 'graine Pousse', 'graine Floraison', 'son/muet'])
    verifyIcons(icons, 'critère 3 [390×844]')
    const labels = await readLabels(page)
    check(labels.back.text === FR['game.back'],
      `critère 3 : libellé du Retour « ${labels.back.text} » au lieu de « ${FR['game.back']} »`)
    check(labels.sap.text === sapText(FR, 120),
      `critère 3 : libellé de la sève « ${labels.sap.text} » au lieu de « ${sapText(FR, 120)} »`)
    check(labels.audio.label === FR['audio.mute'],
      `critère 3 : nom accessible du son « ${labels.audio.label} » au lieu de « ${FR['audio.mute']} »`)
    check(labels.audio.icon?.hidden === 'true', 'critère 3 : icône du son non aria-hidden')
    for (const [id, nameKey, cost] of [['sprout', 'tower.sprout.name', TOWERS.sprout.cost], ['bloom', 'tower.bloom.name', TOWERS.bloom.cost]]) {
      const entry = labels.entries.find((item) => item.tower === id)
      check(Boolean(entry), `critère 3 : entrée ${id} absente de la barre des tours`)
      if (!entry) continue
      check(entry.text.includes(FR[nameKey]), `critère 3 : libellé ${id} « ${entry.text} » sans « ${FR[nameKey]} »`)
      check(entry.text.includes(FR['tower.price'].replace('{n}', String(cost))),
        `critère 3 : prix ${id} « ${entry.text} » sans « ${FR['tower.price'].replace('{n}', String(cost))} »`)
      check(entry.icon?.hidden === 'true', `critère 3 : icône de ${id} non aria-hidden`)
    }
    const texts = await readTexts(page)
    check(texts.imgs === 0, `critère 3 : ${texts.imgs} <img> dans l'interface`)
    check(texts.svgImages === 0, `critère 3 : ${texts.svgImages} <image> SVG (bitmap) dans l'interface`)
    const emoji = /\p{Extended_Pictographic}/u
    const emojis = texts.leaves.filter((item) => emoji.test(item.text))
    check(emojis.length === 0,
      `critère 3 : emoji dans l'interface : ${emojis.map((item) => `${item.where} « ${item.text} »`).join(', ')}`)
    await capture('c3-icones')

    // --- Critère 4 : barre des tours permanente dès le lancement, sans interaction. ---
    const towerBar = await readTowerBar(page)
    check(towerBar !== null, 'critère 4 : .tower-bar absente du DOM')
    if (towerBar) {
      check(towerBar.open === true, 'critère 4 : data-open n\'est pas « true » au chargement')
      check(towerBar.stateOpen === true, 'critère 4 : state.towerBar.open n\'est pas true au chargement')
      check(towerBar.visible === true, 'critère 4 : le panneau des tours n\'est pas visible sans interaction')
      check(towerBar.handle === false, 'critère 4 : .tower-bar__handle existe encore')
      check(towerBar.toggle === false, 'critère 4 : button[data-action="toggle-towers"] existe encore')
      check(towerBar.entries.length === 2,
        `critère 4 : ${towerBar.entries.length} entrée(s) au lieu des deux graines`)
      const expected = [
        ['sprout', 'tower.sprout.name', TOWERS.sprout.cost],
        ['bloom', 'tower.bloom.name', TOWERS.bloom.cost],
      ]
      for (const [id, nameKey, cost] of expected) {
        const entry = towerBar.entries.find((item) => item.tower === id)
        check(Boolean(entry), `critère 4 : graine ${id} absente`)
        if (!entry) continue
        check(entry.name === FR[nameKey],
          `critère 4 : nom ${id} « ${entry.name} » au lieu de « ${FR[nameKey]} »`)
        check(entry.price === FR['tower.price'].replace('{n}', String(cost)),
          `critère 4 : prix ${id} « ${entry.price} » au lieu de « ${FR['tower.price'].replace('{n}', String(cost))} »`)
        check(entry.rect.x >= 0 && entry.rect.y >= 0
          && entry.rect.right <= MOBILE.width + 0.5 && entry.rect.bottom <= MOBILE.height + 0.5,
          `critère 4 : entrée ${id} hors du cadre (${box(entry.rect)})`)
        check(entry.nameClipped === false && entry.priceClipped === false,
          `critère 4 : libellé ou prix de ${id} tronqué`)
        check(entry.icon?.tag === 'svg' && entry.icon?.hidden === 'true',
          `critère 4 : icône de ${id} absente ou non aria-hidden`)
      }
      console.log(`[interface-132] critère 4 — barre ${box(towerBar.panel)}, ${towerBar.entries.map((entry) => `${entry.name} ${entry.price}`).join(' · ')}`)
    }

    // --- Critère 5 (mobile) : 4 rectangles non nuls, aucun chevauchement, texte dans le cadre. ---
    mobileRects = await measure(page)
    mobileLayout = await readLayout(page)
    verifyLayout(mobileRects, 'critère 5 [390×844]')
    verifyText(mobileLayout, 'critère 5 [390×844]')
    check(mobileLayout.viewport.width === MOBILE.width && mobileLayout.viewport.height === MOBILE.height,
      `critère 5 : viewport ${mobileLayout.viewport.width}×${mobileLayout.viewport.height} au lieu de 390×844`)

    // --- Critère 4 (suite) : 10 s sans aucune interaction, la barre reste visible. ---
    await page.waitForTimeout(10_000)
    const later = await readTowerBar(page)
    const laterState = await state()
    check(later?.open === true && later?.visible === true,
      'critère 4 : la barre des tours n\'est plus visible après 10 s sans interaction')
    check(later?.entries.length === 2,
      `critère 4 : ${later?.entries.length} entrée(s) après 10 s au lieu de 2`)
    check(laterState.towerBar?.open === true,
      'critère 4 : state.towerBar.open n\'est plus true après 10 s')
    check(laterState.resources === 120,
      `critère 4 : ${laterState.resources} sève après 10 s sans interaction (aucune dépense attendue)`)
    const lateBar = await readHighBar(page)
    check(lateBar?.sap?.visible === true, 'critère 1 : le compteur de sève n\'est plus visible après 10 s')
    const latePng = await capture('c4-tours-10s')
    check(latePng.width === MOBILE.width && latePng.height === MOBILE.height,
      `capture c4-tours-10s : ${latePng.width}×${latePng.height}`)
  } catch (error) {
    failures.push(`critères 1–5 [390×844] : ${error.message}`)
  }

  // ===========================================================================
  // Critère 5 (desktop) + critère 1 (dépenses) : chargement 1280×720, capture de
  // début de niveau, puis pose d'une Pousse (120 → 80) et amélioration (80 → 50).
  // ===========================================================================
  try {
    await page.setViewportSize(DESKTOP)
    await load('?lang=fr&niveau=1')
    await ready(page)

    const start = await state()
    check(start.screen === 'game', `critère 1 [1280×720] : écran « ${start.screen} »`)
    check(start.resources === 120, `critère 1 [1280×720] : ${start.resources} sève au départ au lieu de 120`)
    const desktopPng = await capture('1280x720')
    check(desktopPng.width === DESKTOP.width && desktopPng.height === DESKTOP.height,
      `capture 1280x720 : ${desktopPng.width}×${desktopPng.height}`)

    // Critère 5 (desktop) : mêmes contrôles qu'en mobile.
    const rects = await measure(page)
    const layout = await readLayout(page)
    verifyLayout(rects, 'critère 5 [1280×720]')
    verifyText(layout, 'critère 5 [1280×720]')

    // Critère 2 (desktop) : aucun bouton en absolute/fixed à mi-hauteur.
    const desktopButtons = await buttons(page)
    const floating = desktopButtons.filter((button) => ['absolute', 'fixed'].includes(button.position) && button.midHeight)
    check(floating.length === 0,
      `critère 2 [1280×720] : bouton(s) en position ${floating.map((button) => button.position).join('/')} à mi-hauteur : ${floating.map((button) => `.${button.className}`).join(', ')}`)
    const desktopBar = await readHighBar(page)
    check(desktopBar?.rect.width >= DESKTOP.width - 1,
      `critère 2 [1280×720] : .high-bar large de ${desktopBar?.rect.width} px`)
    check(desktopBar?.back?.rect.width >= 44 && desktopBar?.back?.rect.height >= 44,
      `critère 2 [1280×720] : cible Retour ${desktopBar?.back?.rect.width}×${desktopBar?.back?.rect.height} px`)
    console.log(`[interface-132] critère 2 [1280×720] — ${desktopButtons.length} boutons visibles, ${floating.length} à mi-hauteur`)

    // Critère 1 : compteur = état à l'image suivante de la pose d'une Pousse (120 → 80).
    await page.click('.tower-bar__entry[data-tower="sprout"]')
    await page.waitForFunction(() => window.__game.state.towerBar.selectedType === 'sprout')
    const slots = await slotPoints(page)
    const target = slots.find((slot) => slot.inFront && slot.inside && slot.canvas)
    check(Boolean(target), 'critère 1 : aucun emplacement cliquable pour poser la Pousse')
    if (target) {
      await clickCanvas(page, target)
      await page.waitForFunction(() => window.__game.state.towers.length === 1
        && window.__game.state.resources === 80)
      await nextFrames(page, 1)
      const afterPlace = await state()
      const placedBar = await readHighBar(page)
      check(afterPlace.resources === 80,
        `critère 1 : ${afterPlace.resources} sève après une Pousse au lieu de 80`)
      check(placedBar?.sap?.text === sapText(FR, 80),
        `critère 1 : compteur « ${placedBar?.sap?.text} » après une Pousse (state 80) au lieu de « ${sapText(FR, 80)} »`)

      // Icône d'amélioration : visible seulement une fois une tour sélectionnée.
      const tower = afterPlace.towers[0]
      const body = await screenPoint(page, tower.x, 0.5, tower.z)
      check(body.inFront && body.inside && body.canvas,
        'critère 3 : la tour posée n\'est pas cliquable à l\'écran')
      if (body.canvas) {
        await clickCanvas(page, body)
        await page.waitForFunction(() => window.__game.state.selectedTower !== null)
        const upgradeIcons = await readIcons(page, ['amélioration'])
        verifyIcons(upgradeIcons, 'critère 3 [amélioration]')
        const upgradeLabel = await readLabels(page)
        check(upgradeLabel.upgrade.text === FR['tower.upgrade'],
          `critère 3 : libellé « ${upgradeLabel.upgrade.text} » au lieu de « ${FR['tower.upgrade']} »`)
      }

      // Amélioration : 80 → 50, compteur égal à l'état à l'image suivante.
      await page.click('.tower-bar__upgrade')
      await page.waitForFunction(() => window.__game.state.towers[0]?.level === 2
        && window.__game.state.resources === 50)
      await nextFrames(page, 1)
      const upgraded = await state()
      const upgradedBar = await readHighBar(page)
      check(upgraded.resources === 50,
        `critère 1 : ${upgraded.resources} sève après l'amélioration au lieu de 50`)
      check(upgradedBar?.sap?.text === sapText(FR, 50),
        `critère 1 : compteur « ${upgradedBar?.sap?.text} » après l'amélioration (state 50) au lieu de « ${sapText(FR, 50)} »`)
      check(upgradedBar?.sap?.visible === true,
        'critère 1 : le compteur de sève disparaît après l\'amélioration')
      await capture('c1-depenses')
      console.log(`[interface-132] critère 1 — 120 → 80 (Pousse) → 50 (amélioration), compteur aligné sur l'état`)
    }
  } catch (error) {
    failures.push(`critères 1–2–5 [1280×720] : ${error.message}`)
  }

  // ===========================================================================
  // Critère 1 (Floraison) : chargement séparé, 120 → 60, séquence finançable.
  // ===========================================================================
  try {
    await page.setViewportSize(DESKTOP)
    await load('?lang=fr&niveau=1')
    await ready(page)
    await page.click('.tower-bar__entry[data-tower="bloom"]')
    await page.waitForFunction(() => window.__game.state.towerBar.selectedType === 'bloom')
    const slots = await slotPoints(page)
    const target = slots.find((slot) => slot.inFront && slot.inside && slot.canvas)
    check(Boolean(target), 'critère 1 : aucun emplacement cliquable pour poser la Floraison')
    if (target) {
      await clickCanvas(page, target)
      await page.waitForFunction(() => window.__game.state.towers.length === 1
        && window.__game.state.resources === 60)
      await nextFrames(page, 1)
      const bloom = await state()
      const bloomBar = await readHighBar(page)
      check(bloom.resources === 60,
        `critère 1 : ${bloom.resources} sève après une Floraison au lieu de 60`)
      check(bloom.towers[0]?.type === 'bloom',
        `critère 1 : tour posée « ${bloom.towers[0]?.type} » au lieu de bloom`)
      check(bloomBar?.sap?.text === sapText(FR, 60),
        `critère 1 : compteur « ${bloomBar?.sap?.text} » après une Floraison (state 60) au lieu de « ${sapText(FR, 60)} »`)
      await capture('c1-floraison')
    }
  } catch (error) {
    failures.push(`critère 1 [Floraison] : ${error.message}`)
  }

  // ===========================================================================
  // Critère 6 — FR puis EN : clés identiques, aucune clé brute dans le DOM,
  // aucun débordement ; une capture par langue en 390×844.
  // ===========================================================================
  try {
    const frKeys = Object.keys(FR).sort()
    const enKeys = Object.keys(EN).sort()
    check(frKeys.length === enKeys.length && frKeys.every((key, index) => key === enKeys[index]),
      `critère 6 : clés FR (${frKeys.length}) et EN (${enKeys.length}) différentes : `
      + `manquantes EN ${frKeys.filter((key) => !enKeys.includes(key)).join(', ') || 'aucune'} ; `
      + `manquantes FR ${enKeys.filter((key) => !frKeys.includes(key)).join(', ') || 'aucune'}`)
    for (const key of REQUIRED_KEYS) {
      check(frKeys.includes(key), `critère 6 : clé « ${key} » absente de fr.json`)
      check(enKeys.includes(key), `critère 6 : clé « ${key} » absente de en.json`)
    }

    for (const lang of ['fr', 'en']) {
      const dict = DICTS[lang]
      await page.setViewportSize(MOBILE)
      await load(`?lang=${lang}&niveau=1`)
      await ready(page)

      const snap = await state()
      check(snap.screen === 'game', `critère 6 [${lang}] : écran « ${snap.screen} »`)
      check(snap.resources === 120, `critère 6 [${lang}] : ${snap.resources} sève au départ`)

      const bar = await readHighBar(page)
      check(bar?.sap?.text === sapText(dict, 120),
        `critère 6 [${lang}] : compteur « ${bar?.sap?.text} » au lieu de « ${sapText(dict, 120)} »`)
      const towerBar = await readTowerBar(page)
      for (const [id, nameKey, cost] of [['sprout', 'tower.sprout.name', TOWERS.sprout.cost], ['bloom', 'tower.bloom.name', TOWERS.bloom.cost]]) {
        const entry = towerBar?.entries.find((item) => item.tower === id)
        check(entry?.name === dict[nameKey],
          `critère 6 [${lang}] : nom ${id} « ${entry?.name} » au lieu de « ${dict[nameKey]} »`)
        check(entry?.price === dict['tower.price'].replace('{n}', String(cost)),
          `critère 6 [${lang}] : prix ${id} « ${entry?.price} » au lieu de « ${dict['tower.price'].replace('{n}', String(cost))} »`)
      }
      // Clé brute : gabarit non résolu (`{n}`) ou motif « a.b.c » dans texte/aria-label/title.
      const texts = await readTexts(page)
      const dotted = /^[a-z][\w-]*(?:\.[\w-]+)+$/i
      const template = /\{\w+\}/
      const raw = [...texts.leaves, ...texts.attributes].filter((item) =>
        template.test(item.text) || item.text.split(/\s+/).some((word) => dotted.test(word)))
      check(raw.length === 0,
        `critère 6 [${lang}] : clé brute dans le DOM : ${raw.map((item) => `${item.where} « ${item.text} »`).join(', ')}`)

      const layout = await readLayout(page)
      verifyText(layout, `critère 6 [${lang}] 390×844`)
      check(layout.viewport.width === MOBILE.width, `critère 6 [${lang}] : viewport ${layout.viewport.width} au lieu de 390`)

      const png = await capture(lang)
      check(png.width === MOBILE.width && png.height === MOBILE.height,
        `capture ${lang} : ${png.width}×${png.height} au lieu de 390×844`)

      // EN sur ordinateur : le libellé le plus long ne déborde pas du cadre non plus.
      if (lang === 'en') {
        await page.setViewportSize(DESKTOP)
        await nextFrames(page, 2)
        const desktopLayout = await readLayout(page)
        verifyText(desktopLayout, 'critère 6 [en] 1280×720')
        check(desktopLayout.viewport.width === DESKTOP.width,
          `critère 6 [en] : viewport ${desktopLayout.viewport.width} au lieu de 1280`)
      }
    }
    console.log(`[interface-132] critère 6 — ${frKeys.length} clés identiques FR/EN, captures fr + en`)
  } catch (error) {
    failures.push(`critère 6 : ${error.message}`)
  }

  if (failures.length) throw new Error(failures.join(' | '))
}
