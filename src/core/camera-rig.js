import * as THREE from 'three'
import { LEVEL_1 } from '../data/level-1.js'

/** Un glissement de 1 px vaut 0,004 rad, à l'horizontale comme à la verticale. */
const RADIANS_PER_PIXEL = 0.004
/** Précision de la recherche du cadrage qui garde le sol dans les bornes. */
const FOV_SEARCH_STEPS = 14
const FOV_FLOOR = 1
/** Marge de sécurité, en unités monde, entre le sol visible et le bord du décor. */
const FIT_MARGIN = 0.6
/** Retrait appliqué à la cible pour que les coins restent strictement dans le sol. */
const EDGE_INSET = 0.01
/** Décalage maximal de la secousse, en unités monde : le plafond de l'Epic #131. */
const SHAKE_LIMIT = 0.06
/** Coins de l'écran en coordonnées normalisées, parcourus dans l'ordre des quatre coins. */
const CORNER_NDC = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
]

const clamp = (value, min, max) => (value < min ? min : value > max ? max : value)

/**
 * Caméra orbitale bornée : orbite sphérique autour d'une cible au sol, glissement
 * souris/tactile via les événements pointeur, cadrage resserré pour que le sol visible
 * reste dans `bounds` élargi de `skirt`, et cible limitée à `camera.pan` autour de
 * `camera.target`. `state` est un objet simple, sérialisable, lu par les playtests.
 *
 * `juice` fournit la micro-secousse de #147 : son décalage est ajouté à la pose finale
 * de chaque image, donc jamais cumulé, et borné à 0,06 unité par axe.
 */
export function createCameraRig({ camera, domElement, level = LEVEL_1, juice = null }) {
  const { bounds, camera: view } = level
  const panMinX = view.target.x - view.pan
  const panMaxX = view.target.x + view.pan
  const panMinZ = view.target.z - view.pan
  const panMaxZ = view.target.z + view.pan
  const footprintMinX = bounds.minX - bounds.skirt
  const footprintMaxX = bounds.maxX + bounds.skirt
  const footprintMinZ = bounds.minZ - bounds.skirt
  const footprintMaxZ = bounds.maxZ + bounds.skirt

  const baseFov = camera.fov
  const previousTouchAction = domElement.style.touchAction
  domElement.style.touchAction = 'none'

  const state = {
    yaw: (view.yaw[0] + view.yaw[1]) / 2,
    pitch: (view.pitch[0] + view.pitch[1]) / 2,
    distance: (view.distance[0] + view.distance[1]) / 2,
    targetX: view.target.x,
    targetZ: view.target.z,
    dragging: false,
    inBounds: true,
  }

  let activePointerId = null
  let lastPointerX = 0
  let lastPointerY = 0
  let fittedAspect = 0

  // Tout ce qui suit est alloué une seule fois : update() ne crée aucun objet.
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  const raycaster = new THREE.Raycaster()
  const probe = new THREE.PerspectiveCamera(baseFov, camera.aspect, camera.near, camera.far)
  const corners = CORNER_NDC.map(([x, y]) => new THREE.Vector2(x, y))
  const hit = new THREE.Vector3()
  const cornerX = new Float64Array(4)
  const cornerZ = new Float64Array(4)
  let minRelX = 0
  let maxRelX = 0
  let minRelZ = 0
  let maxRelZ = 0

  /** Place la caméra en orbite autour de (targetX, 0, targetZ) puis la fait viser la cible. */
  function poseCamera(targetCamera, targetX, targetZ, yaw, pitch, distance) {
    const horizontal = distance * Math.cos(pitch)
    targetCamera.position.set(
      targetX + horizontal * Math.sin(yaw),
      distance * Math.sin(pitch),
      targetZ + horizontal * Math.cos(yaw),
    )
    targetCamera.lookAt(targetX, 0, targetZ)
    targetCamera.updateMatrixWorld()
  }

  /**
   * Lance un rayon par coin de l'écran sur le plan y = 0 et mémorise les intersections
   * relatives à la cible (invariantes par translation de la caméra et de la cible).
   */
  function projectFootprint(targetCamera, targetX, targetZ, yaw, pitch, distance) {
    poseCamera(targetCamera, targetX, targetZ, yaw, pitch, distance)
    let complete = true
    minRelX = Infinity
    maxRelX = -Infinity
    minRelZ = Infinity
    maxRelZ = -Infinity
    for (let i = 0; i < 4; i++) {
      raycaster.setFromCamera(corners[i], targetCamera)
      if (!raycaster.ray.intersectPlane(groundPlane, hit)) {
        complete = false
        continue
      }
      const relX = hit.x - targetX
      const relZ = hit.z - targetZ
      cornerX[i] = relX
      cornerZ[i] = relZ
      if (relX < minRelX) minRelX = relX
      if (relX > maxRelX) maxRelX = relX
      if (relZ < minRelZ) minRelZ = relZ
      if (relZ > maxRelZ) maxRelZ = relZ
    }
    return complete
  }

  /** Échantillonne les valeurs extrêmes et médianes des bornes de la caméra du niveau. */
  const yawSamples = [view.yaw[0], (view.yaw[0] + view.yaw[1]) / 2, view.yaw[1]]
  const pitchSamples = [view.pitch[0], (view.pitch[0] + view.pitch[1]) / 2, view.pitch[1]]
  const distanceSamples = [view.distance[0], (view.distance[0] + view.distance[1]) / 2, view.distance[1]]

  /** Vrai si, à ce fov, toutes les positions permises gardent le sol dans les bornes. */
  function footprintFits(fov, aspect) {
    probe.fov = fov
    probe.aspect = aspect
    probe.updateProjectionMatrix()
    for (const yaw of yawSamples) {
      for (const pitch of pitchSamples) {
        for (const distance of distanceSamples) {
          if (!projectFootprint(probe, view.target.x, view.target.z, yaw, pitch, distance)) return false
          const lowX = Math.max(panMinX, footprintMinX - minRelX)
          const highX = Math.min(panMaxX, footprintMaxX - maxRelX)
          const lowZ = Math.max(panMinZ, footprintMinZ - minRelZ)
          const highZ = Math.min(panMaxZ, footprintMaxZ - maxRelZ)
          if (lowX + FIT_MARGIN > highX || lowZ + FIT_MARGIN > highZ) return false
        }
      }
    }
    return true
  }

  /**
   * Resserre le fov si l'objectif d'origine laisserait voir hors du sol décoré.
   * Le fov ne change jamais par frame : seulement quand l'aspect de la caméra change.
   */
  function fitLens() {
    const { aspect } = camera
    if (!(aspect > 0) || aspect === fittedAspect) return
    fittedAspect = aspect
    let fitting = FOV_FLOOR
    if (footprintFits(FOV_FLOOR, aspect)) {
      let tooWide = baseFov
      for (let i = 0; i < FOV_SEARCH_STEPS; i++) {
        const middle = (fitting + tooWide) / 2
        if (footprintFits(middle, aspect)) fitting = middle
        else tooWide = middle
      }
    }
    const fov = Math.min(baseFov, fitting)
    if (camera.fov !== fov) camera.fov = fov
    camera.updateProjectionMatrix()
  }

  /** Borne une coordonnée de la cible dans le pan, en laissant la priorité au sol si les deux se contredisent. */
  function clampTarget(value, panMin, panMax, groundMin, groundMax) {
    const low = Math.max(panMin, groundMin)
    const high = Math.min(panMax, groundMax)
    if (low <= high) return clamp(value, low, high)
    return clamp(value, groundMin, groundMax)
  }

  /**
   * Ajoute la secousse du juice à la pose finale, axe par axe et sans cumul : la pose est
   * recalculée à chaque image, l'enveloppe de `shake()` est donc simplement remplacée.
   */
  function applyShake() {
    if (!juice || typeof juice.shake !== 'function') return
    const offset = juice.shake()
    if (!offset) return
    camera.position.x += clamp(offset.x, -SHAKE_LIMIT, SHAKE_LIMIT)
    camera.position.y += clamp(offset.y, -SHAKE_LIMIT, SHAKE_LIMIT)
    camera.position.z += clamp(offset.z, -SHAKE_LIMIT, SHAKE_LIMIT)
    // La projection du cœur, calculée juste après, lit la matrice à jour.
    camera.updateMatrixWorld()
  }

  /** Vrai si les quatre intersections tiennent dans le sol élargi. */
  function cornersInBounds() {
    for (let i = 0; i < 4; i++) {
      const x = state.targetX + cornerX[i]
      const z = state.targetZ + cornerZ[i]
      if (x < footprintMinX || x > footprintMaxX || z < footprintMinZ || z > footprintMaxZ) return false
    }
    return true
  }

  function update(dt) {
    fitLens()
    state.yaw = clamp(state.yaw, view.yaw[0], view.yaw[1])
    state.pitch = clamp(state.pitch, view.pitch[0], view.pitch[1])
    state.distance = clamp(state.distance, view.distance[0], view.distance[1])
    state.targetX = clamp(state.targetX, panMinX, panMaxX)
    state.targetZ = clamp(state.targetZ, panMinZ, panMaxZ)

    let projected = projectFootprint(camera, state.targetX, state.targetZ, state.yaw, state.pitch, state.distance)
    if (projected) {
      const targetX = clampTarget(
        state.targetX, panMinX, panMaxX,
        footprintMinX - minRelX + EDGE_INSET, footprintMaxX - maxRelX - EDGE_INSET,
      )
      const targetZ = clampTarget(
        state.targetZ, panMinZ, panMaxZ,
        footprintMinZ - minRelZ + EDGE_INSET, footprintMaxZ - maxRelZ - EDGE_INSET,
      )
      if (targetX !== state.targetX || targetZ !== state.targetZ) {
        state.targetX = targetX
        state.targetZ = targetZ
        projected = projectFootprint(camera, state.targetX, state.targetZ, state.yaw, state.pitch, state.distance)
      }
    }
    state.inBounds = projected && cornersInBounds()
    if (!projected) poseCamera(camera, state.targetX, state.targetZ, state.yaw, state.pitch, state.distance)
    applyShake()
  }

  function reset() {
    state.yaw = (view.yaw[0] + view.yaw[1]) / 2
    state.pitch = (view.pitch[0] + view.pitch[1]) / 2
    state.distance = (view.distance[0] + view.distance[1]) / 2
    state.targetX = view.target.x
    state.targetZ = view.target.z
    state.dragging = false
    if (activePointerId !== null && domElement.hasPointerCapture?.(activePointerId)) {
      domElement.releasePointerCapture(activePointerId)
    }
    activePointerId = null
    update(0)
  }

  function onPointerDown(event) {
    if (activePointerId !== null) return
    activePointerId = event.pointerId
    lastPointerX = event.clientX
    lastPointerY = event.clientY
    state.dragging = true
    domElement.setPointerCapture?.(event.pointerId)
    event.preventDefault?.()
  }

  function onPointerMove(event) {
    if (event.pointerId !== activePointerId) return
    state.yaw = clamp(state.yaw - (event.clientX - lastPointerX) * RADIANS_PER_PIXEL, view.yaw[0], view.yaw[1])
    state.pitch = clamp(state.pitch - (event.clientY - lastPointerY) * RADIANS_PER_PIXEL, view.pitch[0], view.pitch[1])
    lastPointerX = event.clientX
    lastPointerY = event.clientY
    event.preventDefault?.()
  }

  function onPointerUp(event) {
    if (event.pointerId !== activePointerId) return
    activePointerId = null
    state.dragging = false
    if (domElement.hasPointerCapture?.(event.pointerId)) domElement.releasePointerCapture(event.pointerId)
  }

  domElement.addEventListener('pointerdown', onPointerDown)
  domElement.addEventListener('pointermove', onPointerMove)
  domElement.addEventListener('pointerup', onPointerUp)
  domElement.addEventListener('pointercancel', onPointerUp)

  function dispose() {
    domElement.removeEventListener('pointerdown', onPointerDown)
    domElement.removeEventListener('pointermove', onPointerMove)
    domElement.removeEventListener('pointerup', onPointerUp)
    domElement.removeEventListener('pointercancel', onPointerUp)
    if (activePointerId !== null && domElement.hasPointerCapture?.(activePointerId)) {
      domElement.releasePointerCapture(activePointerId)
    }
    activePointerId = null
    state.dragging = false
    domElement.style.touchAction = previousTouchAction
  }

  return { update, state, reset, dispose }
}
