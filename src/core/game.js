import * as THREE from 'three'

/**
 * Boucle de jeu unique. Une entité = un Object3D avec update(dt) optionnel, ajouté via game.add().
 * game.state est l'état de gameplay observable (sérialisable) : le playtester l'interroge.
 */
export function createGame(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.setSize(innerWidth, innerHeight)
  // Ombres douces : sous three 0.187, `PCFSoftShadowMap` n'est plus implémenté — au premier
  // rendu d'ombre, WebGLShadowMap bascule le renderer sur `PCFShadowMap` et avertit une fois.
  // La douceur vient de `shadow.radius`, et `state.lighting.shadowMap` expose ce type réel.
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  container.appendChild(renderer.domElement)

  // Fond provisoire : `createLevel` le remplace par la teinte du sol dès le montage.
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x1d2433)

  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 1000)
  camera.position.set(0, 2, 5)
  camera.lookAt(0, 0, 0)

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(innerWidth, innerHeight)
  })

  const timer = new THREE.Timer()
  const entities = new Set()
  // `speed` est le seul facteur de temps du gameplay : 1 par défaut, jamais intermédiaire.
  const state = { frames: 0, paused: false, speed: 1, render: { drawCalls: 0, triangles: 0 } }
  let render = () => renderer.render(scene, camera)

  /** Abonnés du bus de jeu, rangés par nom d'événement. */
  const listeners = new Map()

  /** Abonne `fn` aux événements `name` ; un abonnement invalide est ignoré. */
  function on(name, fn) {
    if (typeof name !== 'string' || typeof fn !== 'function') return
    let set = listeners.get(name)
    if (!set) {
      set = new Set()
      listeners.set(name, set)
    }
    set.add(fn)
  }

  /** Diffuse `payload` aux abonnés de `name` : `'wave-start'`, `'shade-repelled'`… */
  function emit(name, payload) {
    const set = listeners.get(name)
    if (!set) return
    for (const fn of set) fn(payload)
  }

  function tick(time) {
    timer.update(time)
    // Horloge réelle, bornée pour éviter les sauts après un onglet en arrière-plan.
    const realDt = Math.min(timer.getDelta(), 0.1)
    // Temps de gameplay : le multiplicateur s'applique d'un bloc à toutes les entités,
    // donc cadence de tir, compte à rebours et marche des ombres suivent le même facteur.
    const dt = realDt * state.speed
    if (!state.paused) for (const e of entities) e.update?.(dt)
    render(realDt)
    // Budget de rendu de la dernière image : lu par le playtest en 390×844.
    state.render.drawCalls = renderer.info.render.calls
    state.render.triangles = renderer.info.render.triangles
    state.frames++
    // Battement de rendu en temps réel : le HUD s'y recale sans tenir sa propre horloge.
    emit('frame', realDt)
  }

  /** Facteur de vitesse du gameplay : seules les valeurs entières 1, 2 et 3 sont acceptées. */
  function setSpeed(value) {
    if (value !== 1 && value !== 2 && value !== 3) return
    state.speed = value
  }

  return {
    scene,
    camera,
    renderer,
    state,
    on,
    emit,
    setSpeed,
    add(entity) {
      entities.add(entity)
      scene.add(entity)
      return entity
    },
    remove(entity) {
      entities.delete(entity)
      scene.remove(entity)
    },
    /** Remplace le rendu, ex. post-processing : game.setRender((dt) => postfx.render(dt)) */
    setRender(fn) {
      render = fn
    },
    start: () => renderer.setAnimationLoop(tick),
  }
}
