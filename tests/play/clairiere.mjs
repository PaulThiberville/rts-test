// Playtest de l'Epic #10 — la clairière jouable.
// Un bloc par critère d'acceptation, dans l'ordre de l'Epic. Chaque capture est décodée
// dans la page (createImageBitmap sur le PNG renvoyé par Playwright) : aucune dépendance
// graphique côté Node, et les couleurs comparées sont les couleurs réellement affichées.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { LEVEL_1 } from '../../src/data/level-1.js'

const SCENARIO = 'clairiere'
const RESULTS = 'test-results'
const MAGENTA = '#ff00ff'
const DESKTOP = { width: 1280, height: 720 } // viewport du runner
const MOBILE = { width: 390, height: 844 }
/** Le glissement vaut 0,004 rad/px dans src/core/camera-rig.js. */
const RADIANS_PER_PIXEL = 0.004
const MECANIQUES = fileURLToPath(new URL('../../vault/GDD/Mecaniques.md', import.meta.url))
const FR_JSON = fileURLToPath(new URL('../../src/i18n/fr.json', import.meta.url))
const EN_JSON = fileURLToPath(new URL('../../src/i18n/en.json', import.meta.url))

// ---------------------------------------------------------------------------
// Couleur : sRGB → CIE Lab (illuminant D65), puis ΔE76 = distance euclidienne
// dans Lab. Linéarisation sRGB documentée dans Direction-Artistique.md :
//   c ≤ 0,04045 → c/12,92 ; sinon ((c+0,055)/1,055)^2,4
//   X = 0,4124564 R + 0,3575761 G + 0,1804375 B (matrice sRGB D65)
//   f(t) = t^(1/3) si t > 216/24389, sinon (841/108) t + 4/29
//   L = 116 f(Y) − 16 ; a = 500 (f(X) − f(Y)) ; b = 200 (f(Y) − f(Z))
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
  const white = [0.95047, 1, 1.08883]
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29)
  const [fx, fy, fz] = [X / white[0], Y / white[1], Z / white[2]].map(f)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

/** ΔE76 entre deux couleurs hex sRGB. */
function deltaE76(a, b) {
  const [l1, a1, b1] = hexToLab(a)
  const [l2, a2, b2] = hexToLab(b)
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}

/** Couleur la plus fréquente d'une liste de hex (mode exact). */
function modeHex(values) {
  const counts = new Map()
  for (const value of values) {
    if (!value) continue
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  let best = null
  let bestCount = 0
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value
      bestCount = count
    }
  }
  return best
}

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

/**
 * Décode une capture PNG dans la page et expose trois lectures échantillonnées :
 * sample(x, y), mode(rect) et countNear(hex, ΔE, { rect }).
 */
async function pixels(page, buffer) {
  const base64 = buffer.toString('base64')
  const { width, height } = await page.evaluate(async (data) => {
    const response = await fetch(`data:image/png;base64,${data}`)
    const bitmap = await createImageBitmap(await response.blob())
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    context.drawImage(bitmap, 0, 0)
    const image = context.getImageData(0, 0, bitmap.width, bitmap.height)
    window.__pixels = { width: image.width, height: image.height, data: image.data }
    return { width: image.width, height: image.height }
  }, base64)

  const rectOf = (rect) => (rect
    ? {
        x0: Math.max(0, Math.floor(rect.x)),
        y0: Math.max(0, Math.floor(rect.y)),
        x1: Math.min(width, Math.ceil(rect.x + rect.width)),
        y1: Math.min(height, Math.ceil(rect.y + rect.height)),
      }
    : { x0: 0, y0: 0, x1: width, y1: height })

  return {
    width,
    height,
    /** Couleur exacte d'un pixel de la capture. */
    sample: (x, y) => page.evaluate(({ x, y }) => {
      const { data, width, height } = window.__pixels
      const px = Math.round(x)
      const py = Math.round(y)
      if (px < 0 || py < 0 || px >= width || py >= height) return null
      const i = (py * width + px) * 4
      return '#' + [data[i], data[i + 1], data[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('')
    }, { x, y }),
    /** Couleur la plus fréquente d'une zone (toute l'image par défaut). */
    mode: (rect = null, step = 2) => page.evaluate(({ rect, step, width, height }) => {
      const { data } = window.__pixels
      const counts = new Map()
      let sampled = 0
      for (let y = rect.y0; y < rect.y1; y += step) {
        for (let x = rect.x0; x < rect.x1; x += step) {
          const i = (y * width + x) * 4
          const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2]
          counts.set(key, (counts.get(key) ?? 0) + 1)
          sampled++
        }
      }
      let hex = '#000000'
      let count = 0
      for (const [key, n] of counts) {
        if (n > count) {
          count = n
          hex = '#' + key.toString(16).padStart(6, '0')
        }
      }
      return { hex, count, sampled }
    }, { rect: rectOf(rect), step, width, height }),
    /** Nombre de pixels à ΔE76 < maxDelta d'une couleur hex. */
    countNear: (hex, maxDelta = 10, { rect = null, step = 1 } = {}) => page.evaluate(({
      targetLab, targetRgb, maxDelta, rect, step, width, height,
    }) => {
      const { data } = window.__pixels
      const linear = new Float64Array(256)
      for (let i = 0; i < 256; i++) {
        const c = i / 255
        linear[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
      }
      const labOf = (r, g, b) => {
        const R = linear[r]
        const G = linear[g]
        const B = linear[b]
        const X = R * 0.4124564 + G * 0.3575761 + B * 0.1804375
        const Y = R * 0.2126729 + G * 0.7151522 + B * 0.072175
        const Z = R * 0.0193339 + G * 0.119192 + B * 0.9503041
        const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29)
        const fx = f(X / 0.95047)
        const fy = f(Y / 1)
        const fz = f(Z / 1.08883)
        return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
      }
      let count = 0
      for (let y = rect.y0; y < rect.y1; y += step) {
        for (let x = rect.x0; x < rect.x1; x += step) {
          const i = (y * width + x) * 4
          const r = data[i]
          const g = data[i + 1]
          const b = data[i + 2]
          const dr = r - targetRgb[0]
          const dg = g - targetRgb[1]
          const db = b - targetRgb[2]
          // Filtre RGB avant le calcul Lab : ΔE76 < 10 implique toujours < 150 de distance RGB.
          if (dr * dr + dg * dg + db * db > 150 * 150) continue
          const [L, A, B] = labOf(r, g, b)
          if (Math.hypot(L - targetLab[0], A - targetLab[1], B - targetLab[2]) <= maxDelta) count++
        }
      }
      return count
    }, {
      targetLab: hexToLab(hex),
      targetRgb: hexToRgb(hex),
      maxDelta,
      rect: rectOf(rect),
      step,
      width,
      height,
    }),
  }
}

/**
 * Glisse depuis le centre du canvas. `type: 'mouse'` utilise page.mouse (événements
 * pointer de type souris) ; `type: 'touch'` passe par CDP pour de vrais événements
 * pointeur tactile (pointerType 'touch'), y compris pendant le maintien.
 */
async function drag(page, dx, dy, type = 'mouse', steps = 6) {
  const { width, height } = page.viewportSize()
  const x = Math.round(width / 2)
  const y = Math.round(height / 2)
  if (type === 'mouse') {
    await page.mouse.move(x, y)
    await page.mouse.down()
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(x + (dx * i) / steps, y + (dy * i) / steps)
    }
    await page.mouse.up()
  } else {
    const client = await page.context().newCDPSession(page)
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
    for (let i = 1; i <= steps; i++) {
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x + (dx * i) / steps, y: y + (dy * i) / steps }],
      })
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await client.detach()
  }
  await nextFrames(page, 2)
}

/** Capture jouée + sauvegardée + décodée : une seule image par étape. */
function capture(page, label) {
  return page.screenshot({ path: `${RESULTS}/${SCENARIO}-${label}.png` }).then((buffer) => pixels(page, buffer))
}

/** Panoramique continu de 10 s à la souris, fps et p95 des intervalles rAF mesurés dans la page. */
async function measurePan(page) {
  await page.evaluate(() => {
    window.__rafIntervals = []
    window.__recording = true
    let last = performance.now()
    const loop = (now) => {
      window.__rafIntervals.push(now - last)
      last = now
      if (window.__recording) requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  })
  const { width, height } = page.viewportSize()
  const cx = width / 2
  const cy = height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  const start = Date.now()
  let tick = 0
  while (Date.now() - start < 10_000) {
    tick++
    const angle = tick / 12
    await page.mouse.move(cx + Math.sin(angle) * 220, cy + Math.cos(angle / 2) * 60)
    await page.waitForTimeout(16)
  }
  await page.mouse.up()
  const intervals = await page.evaluate(() => {
    window.__recording = false
    return window.__rafIntervals
  })
  const sorted = [...intervals].sort((a, b) => a - b)
  const total = intervals.reduce((sum, value) => sum + value, 0)
  return {
    frames: intervals.length,
    fps: intervals.length > 0 ? (intervals.length * 1000) / total : 0,
    p95: sorted[Math.floor(sorted.length * 0.95)] ?? Infinity,
  }
}

export default async function ({ page, load, state }) {
  const failures = []
  const check = (condition, message) => {
    if (!condition) failures.push(message)
  }

  // -------------------------------------------------------------------------
  // Critère 1 — chargement du niveau 1 : aucun fond vide, toutes les bornes du
  // décor visibles sont couvertes par le sol/le décor.
  // -------------------------------------------------------------------------
  try {
    await load()
    await setViewport(page, DESKTOP)
    await page.evaluate(() => window.__game.scene.background.set('#ff00ff'))
    await nextFrames(page, 2)
    const sol = await capture(page, 'sol')
    const magenta = await sol.countNear(MAGENTA, 10)
    check(magenta === 0, `critère 1 : ${magenta} pixel(s) de fond magenta (#ff00ff) visibles sur clairiere-sol`)

    const boundsPoints = await page.evaluate(() => {
      const { camera, state } = window.__game
      const { bounds } = state.level
      const points = []
      for (const x of [bounds.minX, (bounds.minX + bounds.maxX) / 2, bounds.maxX]) {
        for (const z of [bounds.minZ, (bounds.minZ + bounds.maxZ) / 2, bounds.maxZ]) {
          const projected = camera.position.clone().set(x, 0, z).project(camera)
          points.push({
            x: (projected.x * 0.5 + 0.5) * innerWidth,
            y: (-projected.y * 0.5 + 0.5) * innerHeight,
            inFront: projected.z < 1,
          })
        }
      }
      return points
    })
    const visible = boundsPoints.filter((p) =>
      p.inFront && p.x >= 0 && p.x < sol.width && p.y >= 0 && p.y < sol.height)
    check(visible.length > 0, 'critère 1 : aucune borne du décor ne tombe dans le champ, couverture invérifiable')
    let uncovered = 0
    for (const point of visible) {
      const hex = await sol.sample(point.x, point.y)
      if (!hex || deltaE76(hex, MAGENTA) < 10) uncovered++
    }
    check(uncovered === 0, `critère 1 : ${uncovered} borne(s) du décor projetées ne sont pas couvertes par le sol/décor`)
  } catch (error) {
    failures.push(error.message)
  }

  // -------------------------------------------------------------------------
  // Critère 2 — chemin continu du bord d'arrivée au cœur, distinct du sol
  // (ΔE76 ≥ 20 sur la capture). Échantillonnage le long de state.level.path.points,
  // à 0,25 m, en excluant le disque du cœur qui recouvre la fin du chemin.
  // -------------------------------------------------------------------------
  try {
    await load()
    await setViewport(page, DESKTOP)
    const chemin = await capture(page, 'chemin')
    const level = (await state()).level
    const heart = level.heart
    const samples = await page.evaluate(({ points, heart, width, height }) => {
      const { camera } = window.__game
      const projected = camera.position.clone()
      const out = []
      for (let i = 1; i < points.length; i++) {
        const [ax, az] = points[i - 1]
        const [bx, bz] = points[i]
        const steps = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.25))
        for (let k = 0; k < steps; k++) {
          const t = k / steps
          const x = ax + (bx - ax) * t
          const z = az + (bz - az) * t
          if ((x - heart.x) ** 2 + (z - heart.z) ** 2 < (heart.radius + 0.2) ** 2) continue
          projected.set(x, 0.02, z).project(camera)
          const sx = (projected.x * 0.5 + 0.5) * width
          const sy = (-projected.y * 0.5 + 0.5) * height
          out.push({
            x, z, sx, sy,
            visible: projected.z < 1 && sx >= 0 && sx < width && sy >= 0 && sy < height,
          })
        }
      }
      return out
    }, { points: level.path.points, heart, width: chemin.width, height: chemin.height })

    const visible = samples.filter((s) => s.visible)
    check(visible.length >= 10, `critère 2 : seulement ${visible.length} échantillons du chemin visibles`)
    const colors = []
    for (const sample of visible) colors.push(await chemin.sample(sample.sx, sample.sy))
    const pathColor = modeHex(colors)
    const ground = await chemin.mode()
    const contrast = pathColor && ground ? deltaE76(pathColor, ground.hex) : 0
    check(contrast >= 20,
      `critère 2 : ΔE76(chemin ${pathColor}, sol ${ground?.hex}) = ${contrast.toFixed(1)} < 20`)
    const offPath = colors.filter((hex) => !hex || deltaE76(hex, pathColor) > 10).length
    check(offPath === 0, `critère 2 : ${offPath}/${colors.length} échantillon(s) du chemin hors de la bande (trou)`)

    // Bord d'arrivée : le premier point du chemin est l'arrivée, sur le bord sud des bornes.
    const first = level.path.points[0]
    const last = level.path.points[level.path.points.length - 1]
    check(Math.hypot(first[0] - level.arrival.x, first[1] - level.arrival.z) <= 0.5,
      `critère 2 : le chemin ne démarre pas à l'arrivée (${first} vs ${level.arrival.x},${level.arrival.z})`)
    check(Math.abs(first[1] - level.bounds.maxZ) <= 2,
      `critère 2 : l'arrivée (z=${first[1]}) n'est pas au bord du décor (maxZ=${level.bounds.maxZ})`)
    // Cœur : le dernier point du chemin est le centre du cœur.
    check(Math.hypot(last[0] - heart.x, last[1] - heart.z) <= 0.5,
      `critère 2 : le chemin ne rejoint pas le cœur (${last} vs ${heart.x},${heart.z})`)
    // Sur la capture, la bande sort par le bas de l'écran, côté arrivée (le chemin
    // continue hors champ derrière la caméra : la ligne de bord est la bonne preuve).
    const bottomEdge = await chemin.countNear(pathColor, 10, {
      rect: { x: 0, y: chemin.height - 1, width: chemin.width, height: 1 },
    })
    check(bottomEdge >= 20,
      `critère 2 : le chemin ne rejoint pas le bord d'arrivée de l'écran (${bottomEdge} px de chemin sur la dernière ligne)`)
  } catch (error) {
    failures.push(error.message)
  }

  // -------------------------------------------------------------------------
  // Critère 3 — cœur distingué sur 390×844 : part de largeur ≥ 8 %, teinte de rôle
  // (primaire/récompense) présente uniquement dans state.view.heartScreen.
  // La teinte rendue est mesurée dans la zone du cœur (le matériau est éclairé) ;
  // le test porte sur l'unicité de cette teinte sur la carte, pas sur le hex matériau.
  // -------------------------------------------------------------------------
  try {
    await setViewport(page, MOBILE)
    const mobile = await capture(page, 'mobile')
    const level = (await state()).level
    const view = (await state()).view
    check(view.heartScreenShare >= 0.08,
      `critère 3 : cœur à ${(view.heartScreenShare * 100).toFixed(1)} % de la largeur (minimum 8 %)`)

    const heartRect = {
      x: view.heartScreen.x - 2,
      y: view.heartScreen.y - 2,
      width: view.heartScreen.w + 4,
      height: view.heartScreen.h + 4,
    }
    const heartTint = await mobile.mode(heartRect, 1)
    const area = Math.max(0, Math.ceil(heartRect.width)) * Math.max(0, Math.ceil(heartRect.height))
    check(heartTint.count / area >= 0.5,
      `critère 3 : la zone du cœur n'est pas remplie par sa teinte (${(100 * heartTint.count / area).toFixed(0)} %)`)

    // La teinte rendue doit rester la teinte de rôle du cœur (palette du niveau).
    const palette = Object.entries(level.palette)
    const nearest = [...palette].sort((a, b) => deltaE76(heartTint.hex, a[1]) - deltaE76(heartTint.hex, b[1]))[0]
    const tintDelta = deltaE76(heartTint.hex, level.heart.color)
    check(nearest[0] === 'heart' && tintDelta <= 20,
      `critère 3 : teinte rendue ${heartTint.hex} à ΔE ${tintDelta.toFixed(1)} du cœur ${level.heart.color} (plus proche : ${nearest[0]})`)

    const inside = await mobile.countNear(heartTint.hex, 10, { rect: heartRect })
    const total = await mobile.countNear(heartTint.hex, 10)
    const outside = total - inside
    check(inside > 0, 'critère 3 : teinte du cœur absente de la zone du cœur')
    check(outside === 0,
      `critère 3 : ${outside} pixel(s) hors de la zone du cœur partagent sa teinte (ΔE76 < 10)`)
  } catch (error) {
    failures.push(error.message)
  }

  // -------------------------------------------------------------------------
  // Critère 4 — 20 positions extrêmes (10 souris puis 10 tactiles) : la caméra
  // obéit et borne chaque glissement, aucune vue ne laisse voir le fond vide.
  // -------------------------------------------------------------------------
  try {
    await load()
    await setViewport(page, DESKTOP)
    await page.evaluate(() => window.__game.scene.background.set('#ff00ff'))
    await nextFrames(page, 2)
    const yaws = [-0.45, -0.225, 0, 0.225, 0.45]
    const pitches = [0.72, 0.83, 0.94, 1.05]
    const targets = pitches.flatMap((pitch) => yaws.map((yaw) => [yaw, pitch]))
    for (const [index, [yaw, pitch]] of targets.entries()) {
      const type = index < 10 ? 'mouse' : 'touch'
      const before = (await state()).camera
      const dx = -(yaw - before.yaw) / RADIANS_PER_PIXEL
      const dy = -(pitch - before.pitch) / RADIANS_PER_PIXEL
      await drag(page, dx, dy, type)
      const camera = (await state()).camera
      check(Math.abs(camera.yaw - yaw) <= 0.01,
        `critère 4 : ${type} n°${index + 1}, yaw ${camera.yaw.toFixed(3)} au lieu de ${yaw}`)
      check(Math.abs(camera.pitch - pitch) <= 0.01,
        `critère 4 : ${type} n°${index + 1}, pitch ${camera.pitch.toFixed(3)} au lieu de ${pitch}`)
      check(camera.inBounds === true, `critère 4 : ${type} n°${index + 1}, caméra hors bornes (inBounds=false)`)
      const frame = await capture(page, `extreme-${String(index + 1).padStart(2, '0')}`)
      const magenta = await frame.countNear(MAGENTA, 10)
      check(magenta === 0, `critère 4 : ${type} n°${index + 1} laisse voir ${magenta} pixel(s) de fond vide`)
    }
  } catch (error) {
    failures.push(error.message)
  }

  // -------------------------------------------------------------------------
  // Critère 5 — panoramique continu de 10 s : moyenne ≥ 55 ips, p95 des
  // intervalles rAF ≤ 33 ms, au viewport du runner.
  // -------------------------------------------------------------------------
  try {
    await load()
    await setViewport(page, DESKTOP)
    const pan = await measurePan(page)
    await capture(page, 'pan')
    check(pan.fps >= 55, `critère 5 : moyenne ${pan.fps.toFixed(1)} ips < 55`)
    check(pan.p95 <= 33, `critère 5 : p95 des intervalles ${pan.p95.toFixed(1)} ms > 33 ms`)
  } catch (error) {
    failures.push(error.message)
  }

  // -------------------------------------------------------------------------
  // Critère 6 — FR puis EN : chaque libellé du HUD vient du JSON de la langue,
  // mêmes clés dans les deux fichiers, aucun texte en dur dans l'interface.
  // -------------------------------------------------------------------------
  try {
    const [fr, en] = await Promise.all([
      readFile(FR_JSON, 'utf8').then(JSON.parse),
      readFile(EN_JSON, 'utf8').then(JSON.parse),
    ])
    const sameKeys = JSON.stringify(Object.keys(fr).sort()) === JSON.stringify(Object.keys(en).sort())
    check(sameKeys, 'critère 6 : fr.json et en.json n\'ont pas les mêmes clés')
    for (const [lang, dict] of [['fr', fr], ['en', en]]) {
      await load(`?lang=${lang}`)
      const hud = await page.evaluate(() => {
        const root = document.getElementById('ui')
        return {
          title: root.querySelector('.level-hud__title')?.textContent.trim(),
          hint: root.querySelector('.level-hud__hint')?.textContent.trim(),
          texts: [...root.querySelectorAll('*')]
            .filter((element) => element.children.length === 0 && element.textContent.trim())
            .map((element) => element.textContent.trim()),
        }
      })
      check(hud.title === dict['level.1.name'],
        `critère 6 : titre ${lang} « ${hud.title} » ≠ « ${dict['level.1.name']} »`)
      check(hud.hint === dict['level.1.hint'],
        `critère 6 : aide ${lang} « ${hud.hint} » ≠ « ${dict['level.1.hint']} »`)
      const values = new Set(Object.values(dict))
      const hardcoded = hud.texts.filter((text) => !values.has(text))
      check(hardcoded.length === 0, `critère 6 : texte en dur en ${lang} : ${hardcoded.join(' / ')}`)
    }
    await load('?lang=en')
    await capture(page, 'en')
  } catch (error) {
    failures.push(error.message)
  }

  // -------------------------------------------------------------------------
  // Critère 7 — chargement hors ligne : aucune requête hors de l'origine de la
  // page (assets locaux uniquement).
  // -------------------------------------------------------------------------
  try {
    const origin = new URL(page.url()).origin
    const requests = []
    const listener = (request) => requests.push(request.url())
    page.on('request', listener)
    await load()
    await nextFrames(page, 2)
    page.off('request', listener)
    check(requests.length > 0, 'critère 7 : aucune requête capturée, test non concluant')
    const external = requests.filter((url) => /^https?:/i.test(url) && new URL(url).origin !== origin)
    check(external.length === 0,
      `critère 7 : ${external.length} requête(s) hors origine : ${external.slice(0, 3).join(', ')}`)
  } catch (error) {
    failures.push(error.message)
  }

  // -------------------------------------------------------------------------
  // Critère 8 — Mecaniques.md documente les contrôles souris + tactile et les
  // quatre bornes caméra, avec les valeurs de src/data/level-1.js.
  // -------------------------------------------------------------------------
  try {
    const md = await readFile(MECANIQUES, 'utf8')
    const normalized = md.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    check(/souris/.test(normalized) && /tactile/.test(normalized),
      'critère 8 : contrôles souris et tactile non documentés')
    check(/glisser[^|\n]*bouton gauche/.test(normalized) && /glisser un doigt/.test(normalized),
      'critère 8 : glissement souris (bouton gauche) et tactile (un doigt) non documentés')

    const camera = LEVEL_1.camera
    const lineOf = (token) => md.split(/\r?\n/).find((line) => line.includes(token))
    const french = (value) => String(value).replace('.', ',')
    const bounds = [
      ['yaw', camera.yaw[0], camera.yaw[1]],
      ['pitch', camera.pitch[0], camera.pitch[1]],
      ['distance', camera.distance[0], camera.distance[1]],
      ['pan', camera.pan],
    ]
    for (const [name, low, high] of bounds) {
      const line = lineOf(`\`${name}\``)
      const documented = line !== undefined &&
        line.includes(french(low)) &&
        (high === undefined || line.includes(french(high)))
      check(documented, `critère 8 : borne « ${name} » absente ou désynchronisée de level-1.js (${low}${high === undefined ? '' : ` à ${high}`})`)
    }
  } catch (error) {
    failures.push(error.message)
  }

  if (failures.length) throw new Error(failures.join(' | '))
}
