import * as THREE from 'three'
import { LEVEL_1 } from '../data/level-1.js'
import { createShadow } from '../entities/shadow.js'

/**
 * Système des vagues : compte à rebours, apparitions depuis l'arrivée, trajet le
 * long de la polyligne, tir automatique des tours et état du cœur.
 *
 * Le groupe porte `update(dt)` (appelé par la boucle du jeu) et toutes les ombres.
 * `game.state` reçoit un état strictement sérialisable, lu par le HUD et les
 * playtests : aucune référence THREE n'y entre (`JSON.stringify(state)` est valide).
 *
 * Aucune valeur de gameplay n'est écrite ici : elles viennent toutes de `level`.
 * Le tableau `state.creatures` est muté en place, comme le tableau interne, pour
 * ne rien allouer à chaque image (seules les apparitions et les morts allouent).
 *
 * @param {{ scene: THREE.Scene, state: object, add(entity: THREE.Object3D): THREE.Object3D, remove(entity: THREE.Object3D): void, towers?: { reset(): void } }} game
 * @param {{ level?: object, onChange?: (state: object) => void, onEnd?: (state: object) => void }} [options]
 * @returns {{ group: THREE.Group, update(dt: number): void, restart(): void, dispose(): void }}
 */
export function createWaveSystem(game, {
  level = LEVEL_1,
  onChange = () => {},
  onEnd = () => {},
} = {}) {
  const { state } = game

  // --- État observable initial ------------------------------------------------

  state.wave = {
    index: 1,
    total: level.waves.length,
    countdown: level.windup,
    phase: 'countdown',
  }
  state.core = { hp: level.heart.hp, max: level.heart.hp, damage: level.heart.damage }
  state.creatures = []
  state.run = { elapsed: 0, outcome: null }
  state.lastEvent = null

  const group = new THREE.Group()
  group.name = 'waves'

  // --- Polyligne précalculée (segments, longueurs d'arc cumulées) -------------
  // Les coordonnées des points sont recopiées une fois : le trajet ne lit jamais
  // le tableau de données du niveau pendant la boucle.

  const points = level.path.points
  const segmentCount = Math.max(0, points.length - 1)
  const segmentX = []
  const segmentZ = []
  const segmentDX = []
  const segmentDZ = []
  const segmentStart = []
  const segmentLength = []
  let totalLength = 0

  for (let i = 0; i < segmentCount; i++) {
    const [ax, az] = points[i]
    const [bx, bz] = points[i + 1]
    const dx = bx - ax
    const dz = bz - az
    const length = Math.hypot(dx, dz)
    segmentX.push(ax)
    segmentZ.push(az)
    segmentDX.push(dx)
    segmentDZ.push(dz)
    segmentStart.push(totalLength)
    segmentLength.push(length)
    totalLength += length
  }

  // --- Listes internes (miroir sérialisable dans state.creatures) -------------

  /** Ombres vivantes : { record, shadow, distance, speed, segment }. */
  const creatures = []
  /** Ombres en cours de fondu : objets `shadow` à animer puis libérer. */
  const dying = []
  /** Cooldowns de tir par identifiant de tour, indépendants les uns des autres. */
  const cooldowns = new Map()

  let nextCreatureId = 1
  let countdown = level.windup
  let spawnTimer = 0
  let spawned = 0
  let ended = false
  let disposed = false

  const rangeSquared = level.combat.range * level.combat.range
  const cadence = level.combat.cadence

  // --- Notifications ----------------------------------------------------------

  /** Signale un changement notable au HUD ; jamais appelé à chaque image. */
  function changed() {
    onChange(state)
  }

  /** Termine la partie une seule fois : victoire ou défaite. */
  function finish(outcome) {
    if (ended) return
    ended = true
    state.run.outcome = outcome
    if (outcome === 'victory') state.wave.phase = 'cleared'
    state.lastEvent = 'end'
    changed()
    onEnd(state)
  }

  // --- Vagues et apparitions --------------------------------------------------

  /** Démarre une vague : première ombre immédiatement, les suivantes au rythme du gap. */
  function beginWave(index) {
    state.wave.index = index
    state.wave.phase = 'spawning'
    spawned = 0
    spawnTimer = 0
    state.lastEvent = 'wave'
  }

  /** Compte à rebours initial, en secondes entières affichées. */
  function updateCountdown(dt) {
    countdown -= dt
    if (countdown <= 0) {
      countdown = 0
      if (state.wave.countdown !== 0) state.wave.countdown = 0
      beginWave(1)
      changed()
      return
    }
    const shown = Math.ceil(countdown)
    if (shown !== state.wave.countdown) {
      state.wave.countdown = shown
      changed()
    }
  }

  /** Espacement de la vague demandée, avec le gap global en repli. */
  function waveGap(wave) {
    return Number.isFinite(wave.gap) ? wave.gap : level.shadows.gap
  }

  /** Fait apparaître une ombre à l'arrivée, orientée vers le premier segment. */
  function spawnCreature(wave) {
    const shadow = createShadow({ radius: level.shadows.radius })
    const object = shadow.group
    object.position.set(level.arrival.x, 0, level.arrival.z)
    if (segmentCount > 0) {
      object.rotation.y = Math.atan2(-segmentDX[0], -segmentDZ[0])
    }
    group.add(object)

    const record = {
      id: nextCreatureId++,
      hp: wave.hp,
      maxHp: wave.hp,
      x: level.arrival.x,
      z: level.arrival.z,
      progress: 0,
      alive: true,
    }
    creatures.push({
      record,
      shadow,
      distance: 0,
      speed: wave.speed,
      segment: 0,
    })
    state.creatures.push(record)
    state.lastEvent = 'spawn'
    changed()
  }

  /** Une ombre à la fois tant qu'il en reste dans la vague. */
  function updateSpawn(dt) {
    const wave = level.waves[state.wave.index - 1]
    if (!wave) return
    spawnTimer -= dt
    if (spawned < wave.count && spawnTimer <= 0) {
      spawnCreature(wave)
      spawned++
      spawnTimer = waveGap(wave)
    }
    if (spawned >= wave.count) {
      state.wave.phase = 'marching'
      changed()
    }
  }

  // --- Déplacement le long du chemin ------------------------------------------

  /** Retire une ombre vivante des deux listes synchronisées, en place. */
  function removeCreature(creature) {
    const index = creatures.indexOf(creature)
    if (index !== -1) creatures.splice(index, 1)
    const stateIndex = state.creatures.indexOf(creature.record)
    if (stateIndex !== -1) state.creatures.splice(stateIndex, 1)
  }

  /** Avance chaque ombre par longueur d'arc ; jamais au-delà du cœur. */
  function updateCreatures(dt) {
    for (let i = creatures.length - 1; i >= 0; i--) {
      const creature = creatures[i]
      // Une ombre vivante anime son rebond d'impact ici : les morts basculent dans
      // `dying` et ne reçoivent donc jamais deux appels sur la même image.
      creature.shadow.update(dt)
      creature.distance = Math.min(creature.distance + creature.speed * dt, totalLength)

      let segment = creature.segment
      while (
        segment < segmentCount - 1
        && creature.distance >= segmentStart[segment] + segmentLength[segment]
      ) {
        segment++
      }
      creature.segment = segment

      const length = segmentLength[segment]
      const t = length > 0 ? (creature.distance - segmentStart[segment]) / length : 1
      const x = segmentX[segment] + segmentDX[segment] * t
      const z = segmentZ[segment] + segmentDZ[segment] * t

      const record = creature.record
      record.x = x
      record.z = z
      record.progress = totalLength > 0 ? creature.distance / totalLength : 1

      const object = creature.shadow.group
      object.position.x = x
      object.position.z = z
      object.position.y = 0

      // Le modèle regarde vers -Z : orientation du segment courant.
      object.rotation.y = Math.atan2(-segmentDX[segment], -segmentDZ[segment])

      if (creature.distance >= totalLength) {
        breach(creature)
        // Une défaite fige la partie : les ombres suivantes ne touchent plus le cœur.
        if (ended) break
      }
    }
  }

  // --- Tir automatique --------------------------------------------------------

  /** Ombre vivante la plus avancée à portée de la tour, ou `null`. */
  function findTarget(tower) {
    let best = null
    let bestProgress = -1
    for (let i = 0; i < creatures.length; i++) {
      const creature = creatures[i]
      const dx = creature.record.x - tower.x
      const dz = creature.record.z - tower.z
      if (dx * dx + dz * dz > rangeSquared) continue
      if (creature.record.progress > bestProgress) {
        bestProgress = creature.record.progress
        best = creature
      }
    }
    return best
  }

  /** Chaque tour vivante tire à sa cadence sur l'ombre de tête à sa portée. */
  function updateCombat(dt) {
    const towers = state.towers
    if (!towers || towers.length === 0) return
    for (let i = 0; i < towers.length; i++) {
      const tower = towers[i]
      const damage = level.combat.damage[tower.type]
      if (!Number.isFinite(damage)) continue

      let cooldown = cooldowns.get(tower.id) ?? 0
      cooldown -= dt
      if (cooldown > 0) {
        cooldowns.set(tower.id, cooldown)
        continue
      }

      const target = findTarget(tower)
      if (!target) {
        cooldowns.set(tower.id, 0)
        continue
      }

      target.record.hp = Math.max(0, target.record.hp - damage)
      tower.shots = (tower.shots ?? 0) + 1
      target.shadow.playHit()
      state.lastEvent = 'hit'
      cooldowns.set(tower.id, cadence)
      if (target.record.hp <= 0) kill(target)
      changed()
    }
  }

  // --- Morts et fuites --------------------------------------------------------

  /** À 0 PV : impact puis fondu, entrée retirée, objet 3D libéré en fin de fondu. */
  function kill(creature) {
    creature.record.hp = 0
    creature.record.alive = false
    creature.shadow.playHit()
    creature.shadow.playDeath()
    removeCreature(creature)
    dying.push(creature.shadow)
  }

  /** Atteinte du cœur : dégât exact, ombre retirée et libérée aussitôt. */
  function breach(creature) {
    removeCreature(creature)
    group.remove(creature.shadow.group)
    creature.shadow.dispose()

    state.core.hp = Math.max(0, state.core.hp - level.heart.damage)
    state.lastEvent = 'breach'
    changed()
    if (state.core.hp <= 0) finish('defeat')
  }

  /** Anime les fondus et libère les ombres une fois invisibles. */
  function updateDying(dt) {
    for (let i = dying.length - 1; i >= 0; i--) {
      const shadow = dying[i]
      shadow.update(dt)
      if (shadow.group.visible === false) {
        group.remove(shadow.group)
        shadow.dispose()
        dying.splice(i, 1)
      }
    }
  }

  // --- Fin de vague -----------------------------------------------------------

  /** Enchaîne les vagues sans nouveau décompte ; victoire après la dernière. */
  function checkWaveEnd() {
    if (state.wave.phase !== 'marching') return
    if (creatures.length > 0) return
    if (state.wave.index < state.wave.total) {
      beginWave(state.wave.index + 1)
      changed()
    } else {
      finish('victory')
    }
  }

  // --- Boucle -----------------------------------------------------------------

  function update(dt) {
    if (disposed) return
    // Les fondus continuent même après la fin : seule la logique de jeu est figée.
    updateDying(dt)
    if (ended) return

    state.run.elapsed += dt

    if (state.wave.phase === 'countdown') updateCountdown(dt)
    if (ended) return
    if (state.wave.phase === 'spawning') updateSpawn(dt)
    if (ended) return
    updateCreatures(dt)
    if (ended) return
    updateCombat(dt)
    if (ended) return
    checkWaveEnd()
  }

  // --- Cycle de vie -----------------------------------------------------------

  /** Vide toutes les ombres 3D, vivantes, en fondu, et libère leurs ressources. */
  function clearShadows() {
    for (let i = 0; i < creatures.length; i++) {
      const shadow = creatures[i].shadow
      group.remove(shadow.group)
      shadow.dispose()
    }
    creatures.length = 0
    for (let i = 0; i < dying.length; i++) {
      const shadow = dying[i]
      group.remove(shadow.group)
      shadow.dispose()
    }
    dying.length = 0
  }

  /** Réinitialise une partie sans rechargement : décor intact, tours rendues. */
  function restart() {
    if (disposed) return
    clearShadows()
    state.creatures = []
    cooldowns.clear()
    nextCreatureId = 1
    countdown = level.windup
    spawnTimer = 0
    spawned = 0
    ended = false

    state.core.hp = state.core.max
    state.wave.index = 1
    state.wave.total = level.waves.length
    state.wave.countdown = level.windup
    state.wave.phase = 'countdown'
    state.run = { elapsed: 0, outcome: null }
    state.lastEvent = null

    game.towers?.reset()
    changed()
  }

  /** Retire le système du jeu et libère tout ce qu'il possède ; idempotent. */
  function dispose() {
    if (disposed) return
    disposed = true
    clearShadows()
    state.creatures.length = 0
    cooldowns.clear()
    delete group.update
    game.remove(group)
    group.clear()
  }

  group.update = update
  game.add(group)
  changed()

  return { group, update, restart, dispose }
}
