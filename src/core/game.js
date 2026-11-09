import * as THREE from 'three'

/**
 * Boucle de jeu unique. Une entité = un Object3D avec update(dt) optionnel, ajouté via game.add().
 * game.state est l'état de gameplay observable (sérialisable) : le playtester l'interroge.
 */
export function createGame(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.setSize(innerWidth, innerHeight)
  container.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x1d2433)
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 2))

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
  const state = { frames: 0, paused: false }
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
    const dt = Math.min(timer.getDelta(), 0.1) // évite les sauts après un onglet en arrière-plan
    if (!state.paused) for (const e of entities) e.update?.(dt)
    render(dt)
    state.frames++
  }

  return {
    scene,
    camera,
    renderer,
    state,
    on,
    emit,
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
