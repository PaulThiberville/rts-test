import * as THREE from 'three'
import { LEVEL_1 } from '../data/level-1.js'
import { TOWERS } from '../data/towers.js'
import {
  createTower,
  createTowerGhost,
  createSlotMarker,
  createSelectionMarker,
  disposeTower,
} from '../entities/tower.js'

/** Rayon de saisie d'un emplacement, identique au marqueur affiché. */
const SLOT_RADIUS = 1.1
/** Déplacement maximal, en pixels, d'un clic : au-delà, c'est un glissement de caméra. */
const CLICK_SLOP = 6
/** Altitude de base du fantôme, un cheveu au-dessus du sol. */
const GHOST_Y = 0.01
/** Amplitude du flottement du fantôme, en unités monde. */
const GHOST_BOB = 0.02
/** Vitesse du flottement du fantôme, en radians par seconde. */
const GHOST_SPEED = 2.2

/**
 * Tours-plantes : emplacements, fantôme, pose, sélection et amélioration.
 * Le groupe porte `update(dt)` (flottement du fantôme) et tous les objets 3D du
 * système ; `game.state` reçoit un état sérialisable lu par le HUD et les playtests.
 * Toute décision passe par les entrées pointeur du canvas, sans jamais consommer
 * l'événement : le glissement de caméra de `camera-rig.js` reste intact.
 * @param {{ scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer, state: object, add(entity: THREE.Object3D): THREE.Object3D, remove(entity: THREE.Object3D): void, emit(name: string, payload?: object): void }} game
 * @param {{ level?: object, towers?: object, onChange?: (state: object) => void }} [options]
 * @returns {{ group: THREE.Group, update(dt: number): void, selectType(type: string | null): void, place(slotId?: string): boolean, upgrade(towerId?: number): boolean, reset(): void, dispose(): void }}
 */
export function createTowerSystem(game, {
  level = LEVEL_1,
  towers = TOWERS,
  onChange = () => {},
} = {}) {
  const { camera, renderer, state } = game
  const domElement = renderer.domElement

  state.resources = level.startingResources
  state.towerBar = { open: true, selectedType: null }
  state.slots = level.slots.map(({ id, x, z }) => ({ id, x, z, occupied: false, towerId: null }))
  state.hoveredSlot = null
  state.ghost = { visible: false, slotId: null, type: null }
  state.towers = []
  state.selectedTower = null
  state.lastAction = null
  state.lastRefusal = null

  const group = new THREE.Group()
  group.name = 'towers'

  /** Index des emplacements par identifiant, pour les appels `place(slotId)`. */
  const slotById = new Map()
  /** Marqueurs d'emplacement, libérés par `dispose`. */
  const slotMarkers = new Map()
  for (const slot of state.slots) {
    slotById.set(slot.id, slot)
    const marker = createSlotMarker({ radius: SLOT_RADIUS })
    marker.group.position.set(slot.x, 0, slot.z)
    group.add(marker.group)
    slotMarkers.set(slot.id, marker)
  }

  /** Un fantôme par type de graine, positionné sur l'emplacement visé. */
  const ghosts = new Map()
  const ghostObjects = []
  for (const type of Object.keys(towers)) {
    const ghost = createTowerGhost({ type })
    ghost.visible = false
    group.add(ghost)
    ghosts.set(type, ghost)
    ghostObjects.push(ghost)
  }

  const selectionMarker = createSelectionMarker()
  selectionMarker.visible = false
  group.add(selectionMarker)

  /** Enregistrements de `state.towers` par identifiant, et objets 3D correspondants. */
  const towersById = new Map()
  const towerByObject = new Map()
  const towerObjects = []
  const objectsById = new Map()
  let nextTowerId = 1

  let dirty = false
  let elapsed = 0

  // Tout ce qui suit est alloué une seule fois : les entrées ne créent que les tours.
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  const raycaster = new THREE.Raycaster()
  const pointerNdc = new THREE.Vector2()
  const groundHit = new THREE.Vector3()

  /** Signale au HUD la dernière mutation, une seule fois par action. */
  function commit() {
    if (!dirty) return
    dirty = false
    onChange(state)
  }

  /** Positionne le rayon de pointage depuis un événement pointeur (pixels CSS). */
  function setPointerRay(clientX, clientY) {
    const rect = domElement.getBoundingClientRect()
    if (!(rect.width > 0 && rect.height > 0)) return false
    pointerNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    )
    raycaster.setFromCamera(pointerNdc, camera)
    return true
  }

  /** Emplacement le plus proche du sol pointé, ou `null` hors emplacement. */
  function slotAtPointer() {
    if (!raycaster.ray.intersectPlane(groundPlane, groundHit)) return null
    let best = null
    let bestDistance = SLOT_RADIUS * SLOT_RADIUS
    for (let i = 0; i < state.slots.length; i++) {
      const slot = state.slots[i]
      const dx = groundHit.x - slot.x
      const dz = groundHit.z - slot.z
      const distance = dx * dx + dz * dz
      if (distance <= bestDistance) {
        bestDistance = distance
        best = slot
      }
    }
    return best
  }

  /** Tour posée sous le pointeur, ou `null` : un clic sur une tour la sélectionne. */
  function towerAtPointer() {
    const hits = raycaster.intersectObjects(towerObjects, true)
    if (hits.length === 0) return null
    let node = hits[0].object
    while (node && !towerByObject.has(node)) node = node.parent
    return node ? towerByObject.get(node) : null
  }

  /** Fantôme et surbrillance suivent l'emplacement visé et le type sélectionné. */
  function refreshGhost() {
    const type = state.towerBar.selectedType
    const hovered = state.hoveredSlot === null ? null : slotById.get(state.hoveredSlot) ?? null
    const show = Boolean(type && hovered && !hovered.occupied)
    for (let i = 0; i < ghostObjects.length; i++) {
      ghostObjects[i].visible = show && ghostObjects[i].userData.type === type
    }
    if (show) {
      const ghost = ghosts.get(type)
      if (ghost) ghost.position.x = hovered.x
      if (ghost) ghost.position.z = hovered.z
    }
    state.ghost.visible = show
    state.ghost.slotId = show ? hovered.id : null
    state.ghost.type = show ? type : null

    for (const slot of state.slots) {
      const marker = slotMarkers.get(slot.id)
      marker.setHighlight(!slot.occupied && slot.id === state.hoveredSlot)
    }
  }

  /** Met à jour l'emplacement survolé ; vrai s'il change. */
  function setHoveredSlot(slot) {
    const id = slot ? slot.id : null
    if (state.hoveredSlot === id) return false
    state.hoveredSlot = id
    refreshGhost()
    dirty = true
    return true
  }

  /** Sélectionne une tour posée, ou efface la sélection avec `null`. */
  function selectTower(tower) {
    state.selectedTower = tower ? tower.id : null
    selectionMarker.visible = Boolean(tower)
    if (tower) {
      selectionMarker.position.set(tower.x, 0, tower.z)
      state.lastAction = 'selected'
      state.lastRefusal = null
    }
    dirty = true
  }

  /**
   * Teinte du matériau de la tour, en hex sRGB : c'est celle que portera son projectile.
   * @param {THREE.Object3D} object
   * @returns {string | null}
   */
  function readTint(object) {
    let tint = null
    object.traverse((node) => {
      if (tint !== null || !node.material?.color) return
      tint = `#${node.material.color.getHexString()}`
    })
    return tint
  }

  /**
   * Ajoute l'objet 3D d'un enregistrement de tour au groupe et aux index de saisie.
   * Le sommet et la teinte relevés sur le maillage servent au projectile de #149.
   */
  function addTowerObject(record) {
    const object = createTower({ type: record.type, level: record.level })
    object.position.set(record.x, 0, record.z)
    object.userData = { ...object.userData, id: record.id }
    record.topY = new THREE.Box3().setFromObject(object).max.y
    record.tint = readTint(object)
    group.add(object)
    towerObjects.push(object)
    towerByObject.set(object, record)
    objectsById.set(record.id, object)
    return object
  }

  /** Refus : l'état ne bouge pas en dehors des deux champs de retour. */
  function refuse(reason) {
    state.lastAction = 'refused'
    state.lastRefusal = reason
    dirty = true
    return false
  }

  /** Pose la graine sélectionnée sur l'emplacement donné, ou refuse selon le cas. */
  function tryPlace(slot) {
    const type = state.towerBar.selectedType
    if (!type) return false
    if (!slot) return refuse('outside')
    if (slot.occupied) return refuse('occupied')
    const catalog = towers[type]
    if (!catalog) return false
    if (state.resources < catalog.cost) return refuse('funds')

    state.resources -= catalog.cost
    const record = {
      id: nextTowerId++,
      type,
      level: 1,
      slotId: slot.id,
      x: slot.x,
      z: slot.z,
      shots: 0,
    }
    slot.occupied = true
    slot.towerId = record.id
    state.towers.push(record)
    towersById.set(record.id, record)
    addTowerObject(record)
    state.lastAction = 'placed'
    state.lastRefusal = null
    dirty = true
    // Nom d'intégration #149 : le juice fête la pose ; `plant` reste joué par `main.js`.
    game.emit('tower-placed', {
      id: record.id,
      type: record.type,
      level: record.level,
      x: record.x,
      z: record.z,
    })
    refreshGhost()
    return true
  }

  function onPointerMove(event) {
    if (!setPointerRay(event.clientX, event.clientY)) return
    if (setHoveredSlot(slotAtPointer())) commit()
  }

  let pressId = null
  let pressX = 0
  let pressY = 0

  function onPointerDown(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    pressId = event.pointerId
    pressX = event.clientX
    pressY = event.clientY
    if (!setPointerRay(event.clientX, event.clientY)) return
    if (setHoveredSlot(slotAtPointer())) commit()
  }

  function onPointerUp(event) {
    if (event.pointerId !== pressId) return
    const distance = Math.hypot(event.clientX - pressX, event.clientY - pressY)
    pressId = null
    if (distance >= CLICK_SLOP) return
    if (!setPointerRay(event.clientX, event.clientY)) return
    setHoveredSlot(slotAtPointer())

    const tower = towerAtPointer()
    if (tower) {
      selectTower(tower)
      commit()
      return
    }
    if (state.selectedTower !== null) selectTower(null)
    if (state.towerBar.selectedType) tryPlace(slotAtPointer())
    commit()
  }

  function onPointerCancel(event) {
    if (event.pointerId === pressId) pressId = null
  }

  function onResize() {
    onChange(state)
  }

  function update(dt) {
    elapsed += dt
    const y = GHOST_Y + Math.sin(elapsed * GHOST_SPEED) * GHOST_BOB
    for (let i = 0; i < ghostObjects.length; i++) ghostObjects[i].position.y = y
  }

  domElement.addEventListener('pointerdown', onPointerDown)
  domElement.addEventListener('pointermove', onPointerMove)
  domElement.addEventListener('pointerup', onPointerUp)
  domElement.addEventListener('pointercancel', onPointerCancel)
  addEventListener('resize', onResize)

  group.update = update
  game.add(group)

  function selectType(type) {
    const next = type == null ? null : String(type)
    state.towerBar.selectedType = next !== null && Object.hasOwn(towers, next) ? next : null
    if (state.selectedTower !== null) selectTower(null)
    refreshGhost()
    dirty = true
    commit()
  }

  function place(slotId) {
    const slot = slotId === undefined
      ? (state.hoveredSlot === null ? null : slotById.get(state.hoveredSlot) ?? null)
      : slotById.get(slotId) ?? null
    const placed = tryPlace(slot)
    commit()
    return placed
  }

  function upgrade(towerId) {
    const record = towerId == null ? null : towersById.get(towerId) ?? null
    const catalog = record ? towers[record.type] : null
    if (!record || !catalog) return false
    if (record.level >= catalog.maxLevel) return false
    if (state.resources < catalog.upgradeCost) {
      refuse('funds')
      commit()
      return false
    }

    const old = objectsById.get(record.id)
    if (old) {
      group.remove(old)
      const index = towerObjects.indexOf(old)
      if (index !== -1) towerObjects.splice(index, 1)
      towerByObject.delete(old)
      objectsById.delete(record.id)
      disposeTower(old)
    }

    state.resources -= catalog.upgradeCost
    record.level += 1
    addTowerObject(record)
    state.lastAction = 'upgraded'
    state.lastRefusal = null
    dirty = true
    game.emit('tower-upgraded', { towerId: record.id })
    if (state.selectedTower === record.id) {
      selectionMarker.position.set(record.x, 0, record.z)
      selectionMarker.visible = true
    }
    commit()
    return true
  }

  /**
   * Réinitialise la partie sans toucher au décor ni aux marqueurs : toutes les tours
   * posées sont retirées et libérées, les emplacements redeviennent libres, la sève
   * revient au montant de départ et toute sélection est effacée. Notifie `onChange`.
   */
  function reset() {
    for (let i = 0; i < towerObjects.length; i++) {
      const object = towerObjects[i]
      group.remove(object)
      disposeTower(object)
    }
    towerObjects.length = 0
    towersById.clear()
    towerByObject.clear()
    objectsById.clear()
    state.towers.length = 0
    state.resources = level.startingResources
    state.selectedTower = null
    state.hoveredSlot = null
    state.towerBar = { open: true, selectedType: null }
    state.ghost.visible = false
    state.ghost.slotId = null
    state.ghost.type = null
    state.lastAction = null
    state.lastRefusal = null
    selectionMarker.visible = false
    nextTowerId = 1
    pressId = null
    for (const slot of state.slots) {
      slot.occupied = false
      slot.towerId = null
    }
    refreshGhost()
    dirty = false
    onChange(state)
  }

  function dispose() {
    domElement.removeEventListener('pointerdown', onPointerDown)
    domElement.removeEventListener('pointermove', onPointerMove)
    domElement.removeEventListener('pointerup', onPointerUp)
    domElement.removeEventListener('pointercancel', onPointerCancel)
    removeEventListener('resize', onResize)
    pressId = null
    delete group.update
    game.remove(group)
    for (const marker of slotMarkers.values()) marker.dispose()
    for (let i = 0; i < ghostObjects.length; i++) disposeTower(ghostObjects[i])
    for (let i = 0; i < towerObjects.length; i++) disposeTower(towerObjects[i])
    disposeTower(selectionMarker)
    slotMarkers.clear()
    ghosts.clear()
    towersById.clear()
    towerByObject.clear()
    objectsById.clear()
    ghostObjects.length = 0
    towerObjects.length = 0
    group.clear()
  }

  return { group, update, selectType, place, upgrade, reset, dispose }
}
