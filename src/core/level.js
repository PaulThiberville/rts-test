import * as THREE from 'three'
import { LEVEL_1 } from '../data/level-1.js'
import { createClairiere } from '../entities/clairiere.js'
import { createCameraRig } from './camera-rig.js'

/** Altitude du disque du cœur, identique à celle posée par la clairière. */
const HEART_Y = 0.03
/** Points du disque projetés à l'écran pour en déduire la boîte englobante. */
const HEART_SAMPLES = 32

/**
 * Niveau 1 assemblé : clairière, caméra orbitale et état observable.
 * Le groupe porte `update(dt)` (appelé par la boucle du jeu) qui avance la caméra
 * et recalcule la projection du cœur ; `state` reste une copie sérialisable.
 * @param {{ scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer, state: object, add(entity: THREE.Object3D): THREE.Object3D, remove(entity: THREE.Object3D): void }} game
 * @param {{ level?: object }} [options]
 * @returns {{ group: THREE.Group, rig: ReturnType<typeof createCameraRig>, dispose(): void }}
 */
export function createLevel(game, { level = LEVEL_1 } = {}) {
  const { camera, renderer, state } = game
  const domElement = renderer.domElement

  const rig = createCameraRig({ camera, domElement, level })
  const group = createClairiere({ level })
  game.add(group)

  game.scene.background = new THREE.Color(level.palette.ground)

  state.level = JSON.parse(JSON.stringify({
    id: level.id,
    bounds: level.bounds,
    arrival: level.arrival,
    path: level.path,
    heart: level.heart,
    camera: level.camera,
    palette: level.palette,
  }))
  state.camera = rig.state

  const heartScreen = { x: 0, y: 0, w: 0, h: 0 }
  state.view = { width: 0, height: 0, heartScreen, heartScreenShare: 0 }

  // Positions monde du périmètre du cœur : le disque est statique, calculées une seule fois.
  const heartPoints = []
  for (let i = 0; i < HEART_SAMPLES; i++) {
    const angle = (i / HEART_SAMPLES) * Math.PI * 2
    heartPoints.push(new THREE.Vector3(
      level.heart.x + Math.cos(angle) * level.heart.radius,
      HEART_Y,
      level.heart.z + Math.sin(angle) * level.heart.radius,
    ))
  }
  const projected = new THREE.Vector3()

  /** Projette le disque du cœur et met à jour `state.view` (viewport en pixels CSS). */
  function updateView() {
    const width = domElement.clientWidth || innerWidth
    const height = domElement.clientHeight || innerHeight
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const point of heartPoints) {
      projected.copy(point).project(camera)
      const x = (projected.x * 0.5 + 0.5) * width
      const y = (-projected.y * 0.5 + 0.5) * height
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    heartScreen.x = minX
    heartScreen.y = minY
    heartScreen.w = maxX - minX
    heartScreen.h = maxY - minY
    state.view.width = width
    state.view.height = height
    state.view.heartScreenShare = width > 0 ? heartScreen.w / width : 0
  }

  function update(dt) {
    rig.update(dt)
    updateView()
  }

  function onResize() {
    // Le redimensionnement du renderer est traité avant ce listener : l'aspect est déjà à jour.
    rig.update(0)
    updateView()
  }

  group.update = update
  addEventListener('resize', onResize)
  update(0)

  function dispose() {
    removeEventListener('resize', onResize)
    delete group.update
    game.remove(group)
    rig.dispose()
    group.traverse((object) => {
      object.geometry?.dispose()
      if (!object.material) return
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        for (const value of Object.values(material)) {
          if (value?.isTexture) value.dispose()
        }
        material.dispose()
      }
    })
    group.clear()
  }

  return { group, rig, dispose }
}
