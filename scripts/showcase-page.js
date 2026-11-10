// Page de vitrine : affiche UN asset seul, dans des conditions neutres et reproductibles, pour en juger le rendu.
// Paramètres : ?module=/src/...&export=createX  |  ?module=...&kind=ui  |  ?image=/images/x.svg
import * as THREE from 'three'

const VIEWS = {
  face: new THREE.Vector3(0, 0.25, 1),
  'trois-quarts': new THREE.Vector3(1, 0.6, 1),
  profil: new THREE.Vector3(1, 0.25, 0),
  dessus: new THREE.Vector3(0.01, 1, 0.01),
}

const params = new URLSearchParams(location.search)
const show = (window.__showcase = { ready: false, error: null, kind: null, views: [], show: async () => {} })

try {
  if (params.get('image')) showImage(params.get('image'))
  else await showModule(params.get('module'), params.get('export'), params.get('kind'))
  show.ready = true
} catch (e) {
  show.error = String(e?.stack ?? e)
}

function showImage(src) {
  document.body.innerHTML = `<div class="sizes">${['dark', 'light']
    .map((bg) => `<div class="${bg}">${[24, 64, 256].map((s) => `<img src="${src}" width="${s}" height="${s}" alt="">`).join('')}</div>`)
    .join('')}</div>`
  Object.assign(show, { kind: 'image', views: ['tailles'] })
}

async function showModule(path, exportName, kind) {
  if (!path) throw new Error('paramètre module manquant')
  const mod = await import(/* @vite-ignore */ path)
  const factory = exportName ? mod[exportName] : Object.values(mod).find((v) => typeof v === 'function')
  if (typeof factory !== 'function') throw new Error(`aucune fonction exportée${exportName ? ` « ${exportName} »` : ''} dans ${path}`)

  if (kind === 'ui') {
    const game = { state: { frames: 0, paused: false } }
    const component = await factory(document.getElementById('ui'), game)
    component?.update?.(game.state)
    Object.assign(show, { kind: 'ui', views: ['ordinateur', 'mobile'] })
    return
  }

  const value = await factory()
  const stage = createStage()
  if (value?.isObject3D && typeof value.burst === 'function') return showEffect(stage, value)
  if (value?.isObject3D) return showObject(stage, value)
  if (value?.isMaterial) return showMaterial(stage, value)
  if (value?.isTexture) return showMaterial(stage, new THREE.MeshBasicMaterial({ map: value }), 'texture')
  throw new Error('la fonction ne renvoie ni Object3D, ni Material, ni Texture')
}

function createStage() {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1)
  renderer.setSize(innerWidth, innerHeight)
  renderer.shadowMap.enabled = true
  document.body.appendChild(renderer.domElement)
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x2a2f3a)
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444a55, 1.6))
  const sun = new THREE.DirectionalLight(0xffffff, 2.2)
  sun.position.set(4, 8, 5)
  sun.castShadow = true
  scene.add(sun)
  const ground = new THREE.Mesh(new THREE.CircleGeometry(30, 64), new THREE.MeshStandardMaterial({ color: 0x3a404d, roughness: 1 }))
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)
  const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.01, 500)
  return { renderer, scene, camera, ground, render: () => renderer.render(scene, camera) }
}

/** Cadre la caméra sur l'objet selon une direction de vue. */
function frame(stage, object, direction) {
  const box = new THREE.Box3().setFromObject(object)
  const radius = box.getSize(new THREE.Vector3()).length() / 2 || 1
  const center = box.getCenter(new THREE.Vector3())
  // Distance pour que la sphère englobante tienne dans le champ vertical, avec une marge.
  const distance = (radius / Math.sin(THREE.MathUtils.degToRad(stage.camera.fov / 2))) * 1.15
  stage.camera.position.copy(center).add(direction.clone().normalize().multiplyScalar(distance))
  stage.camera.lookAt(center)
  stage.render()
}


function showObject(stage, object) {
  object.traverse((o) => o.isMesh && (o.castShadow = o.receiveShadow = true))
  const box = new THREE.Box3().setFromObject(object)
  object.position.y -= box.min.y // posé sur le sol
  stage.scene.add(object)
  Object.assign(show, { kind: 'objet', views: Object.keys(VIEWS), show: async (v) => frame(stage, object, VIEWS[v]) })
}

function showMaterial(stage, material, kind = 'matériau') {
  const group = new THREE.Group()
  const shapes = kind === 'texture'
    ? [new THREE.PlaneGeometry(2, 2)]
    : [new THREE.SphereGeometry(0.7, 64, 32), new THREE.BoxGeometry(1.2, 1.2, 1.2), new THREE.TorusKnotGeometry(0.45, 0.16, 160, 24)]
  shapes.forEach((geometry, i) => {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.position.set((i - (shapes.length - 1) / 2) * 1.9, kind === 'texture' ? 1 : 0.8, 0)
    mesh.castShadow = true
    group.add(mesh)
  })
  stage.scene.add(group)
  const views = kind === 'texture' ? { face: VIEWS.face } : { face: VIEWS.face, 'trois-quarts': VIEWS['trois-quarts'] }
  Object.assign(show, { kind, views: Object.keys(views), show: async (v) => frame(stage, group, views[v]) })
}

function showEffect(stage, effect) {
  stage.scene.add(effect)
  effect.burst(new THREE.Vector3(0, 0.5, 0))
  let elapsed = 0
  const times = { '0.15s': 0.15, '0.4s': 0.4, '0.8s': 0.8 }
  stage.camera.position.set(0, 2, 6)
  stage.camera.lookAt(0, 0.8, 0)
  Object.assign(show, {
    kind: 'effet',
    views: Object.keys(times),
    show: async (v) => {
      while (elapsed < times[v]) {
        effect.update?.(1 / 60)
        elapsed += 1 / 60
      }
      stage.render()
    },
  })
}
