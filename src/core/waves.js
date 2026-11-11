import * as THREE from 'three'
import { LEVEL_1 } from '../data/level-1.js'
import { createProjectile, disposeProjectile } from '../entities/projectile.js'
import { createShadow } from '../entities/shadow.js'

/** Variantes de silhouette attribuées tour à tour à chaque apparition de la vague. */
const VARIANTS = ['ronde', 'haute', 'oreillue']

/**
 * Système des vagues : compte à rebours, apparitions depuis l'arrivée, trajet le
 * long de la polyligne, tir automatique des tours et état du cœur.
 *
 * Le groupe porte `update(dt)` (appelé par la boucle du jeu), les ombres et les
 * projectiles en vol. `game.state` reçoit un état strictement sérialisable, lu par
 * le HUD et les playtests : aucune référence THREE n'y entre (`JSON.stringify(state)`
 * est valide).
 *
 * Aucune valeur de gameplay n'est écrite ici : elles viennent toutes de `level`.
 * Le tableau `state.creatures` est muté en place, comme le tableau interne, pour
 * ne rien allouer à chaque image (seules les apparitions, les tirs et les morts allouent).
 *
 * @param {{ scene: THREE.Scene, state: object, add(entity: THREE.Object3D): THREE.Object3D, remove(entity: THREE.Object3D): void, emit(name: string, payload?: object): void, towers?: { reset(): void } }} game
 * @param {{ level?: object, juice?: { spawn(event: string, position?: object): void }, onChange?: (state: object) => void, onEnd?: (state: object) => void }} [options]
 * @returns {{ group: THREE.Group, update(dt: number): void, restart(): void, dispose(): void }}
 */
export function createWaveSystem(game, {
  level = LEVEL_1,
  juice = null,
  onChange = () => {},
  onEnd = () => {},
} = {}) {
  const { state } = game
  const fx = juice && typeof juice.spawn === 'function' ? juice : null

  // --- État observable initial ------------------------------------------------

  state.wave = {
    index: 1,
    total: level.waves.length,
    countdown: level.windup,
    phase: 'countdown',
  }
  state.core = { hp: level.heart.hp, max: level.heart.hp, damage: level.heart.damage }
  state.creatures = []
  state.enemies = { silhouettes: 0 }
  state.projectiles = { active: 0 }
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
  /** Projectiles en vol : `{ mesh, fromX, fromY, fromZ, record, lethal, age, duration }`. */
  const projectiles = []
  /** Cooldowns de tir par identifiant de tour, indépendants les uns des autres. */
  const cooldowns = new Map()
  /** Variantes déjà apparues dans la vague courante : jamais retirées avant la suivante. */
  const waveVariants = new Set()

  let nextCreatureId = 1
  let countdown = level.windup
  let spawnTimer = 0
  let spawned = 0
  /** Rang de la prochaine variante : parcourt `VARIANTS` à chaque apparition. */
  let variantIndex = 0
  let ended = false
  let disposed = false

  const rangeSquared = level.combat.range * level.combat.range
  const cadence = level.combat.cadence

  // Vol d'une baie, tout tiré de la donnée du niveau : plafond cadence × rayon d'ombre
  // (0,35 s au niveau 1, sous les 0,4 s de l'Epic), durée proportionnelle à la distance
  // sur la portée, hauteur d'impact et bombé à l'échelle d'une ombre.
  const flightTime = cadence * level.shadows.radius
  const impactY = level.shadows.radius
  const arc = level.shadows.radius

  // --- Notifications ----------------------------------------------------------

  /** Signale un changement notable au HUD ; jamais appelé à chaque image. */
  function changed() {
    onChange(state)
  }

  /** Termine la partie une seule fois : victoire ou défaite, chacune annoncée une fois. */
  function finish(outcome) {
    if (ended) return
    ended = true
    state.run.outcome = outcome
    if (outcome === 'victory') state.wave.phase = 'cleared'
    state.lastEvent = 'end'
    game.emit(outcome === 'victory' ? 'victory' : 'defeat', { elapsed: state.run.elapsed })
    // Nom d'intégration #149 : le juice regarde la fin de partie, sans retirer les deux
    // événements ci-dessus dont le son et les playtests dépendent.
    game.emit('run-end', {
      outcome,
      elapsed: state.run.elapsed,
      x: level.heart.x,
      z: level.heart.z,
    })
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
    variantIndex = 0
    waveVariants.clear()
    state.enemies.silhouettes = 0
    state.lastEvent = 'wave'
    game.emit('wave-start', { index })
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
    // Les trois silhouettes tournent d'une apparition à l'autre : dès la troisième,
    // les trois profils cohabitent, et le compte ne redescend plus avant la vague suivante.
    const variant = VARIANTS[variantIndex % VARIANTS.length]
    variantIndex++
    waveVariants.add(variant)
    state.enemies.silhouettes = waveVariants.size

    const shadow = createShadow({ radius: level.shadows.radius, variant })
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
      variant,
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

  /**
   * Fait naître la baie au sommet de la tour, teintée comme elle, et mémoire la durée de
   * vol proportionnelle à la distance, plafonnée sous les 0,4 s de l'Epic.
   * @param {{ id: number, type: string, x: number, z: number, topY?: number, tint?: string }} tower
   * @param {{ record: object }} target ombre visée, suivie pendant le vol
   * @param {boolean} lethal vrai si ce tir emporte l'ombre
   */
  function spawnProjectile(tower, target, lethal) {
    const mesh = createProjectile({ tint: tower.tint })
    const fromY = Number.isFinite(tower.topY) ? tower.topY : impactY
    mesh.position.set(tower.x, fromY, tower.z)
    group.add(mesh)

    const dx = target.record.x - tower.x
    const dz = target.record.z - tower.z
    // Distance bornée par la portée : le vol ne dépasse jamais `flightTime`.
    const distance = Math.min(Math.hypot(dx, dz), level.combat.range)
    projectiles.push({
      mesh,
      fromX: tower.x,
      fromY,
      fromZ: tower.z,
      record: target.record,
      lethal,
      age: 0,
      duration: (flightTime * distance) / level.combat.range,
    })
    // Le compteur suit l'envol dans la même image : `active > 0` dès qu'une baie existe.
    state.projectiles.active = projectiles.length
  }

  /**
   * Avance chaque baie vers sa cible vivante : vol en cloche, impact à la fin du temps
   * de vol, puis juice et libération immédiate du projectile.
   */
  function updateProjectiles(dt) {
    for (let i = projectiles.length - 1; i >= 0; i--) {
      const shot = projectiles[i]
      shot.age += dt
      const t = Math.min(1, shot.age / shot.duration)
      const record = shot.record
      const x = shot.fromX + (record.x - shot.fromX) * t
      const z = shot.fromZ + (record.z - shot.fromZ) * t
      const y = shot.fromY
        + (impactY - shot.fromY) * t
        + Math.sin(Math.PI * t) * arc
      shot.mesh.position.set(x, y, z)
      if (t < 1) continue

      group.remove(shot.mesh)
      disposeProjectile(shot.mesh)
      projectiles.splice(i, 1)
      if (fx) {
        const impact = { x, y: impactY, z }
        fx.spawn('shot', impact)
        if (shot.lethal) fx.spawn('kill', impact)
      }
    }
    state.projectiles.active = projectiles.length
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
      const lethal = target.record.hp <= 0
      tower.shots = (tower.shots ?? 0) + 1
      // Une salve par tour et par cadence : un seul événement, quel que soit le nombre
      // de projectiles ou de cibles du système de rendu.
      game.emit('tower-shot', { towerId: tower.id })
      target.shadow.playHit()
      spawnProjectile(tower, target, lethal)
      state.lastEvent = 'hit'
      cooldowns.set(tower.id, cadence)
      if (lethal) kill(target)
      changed()
    }
  }

  // --- Morts et fuites --------------------------------------------------------

  /**
   * À 0 PV : impact puis fondu, entrée retirée, objet 3D libéré en fin de fondu.
   * `shade-repelled` est émis une seule fois par ombre : `alive` sert de garde.
   */
  function kill(creature) {
    if (!creature.record.alive) return
    creature.record.hp = 0
    creature.record.alive = false
    creature.shadow.playHit()
    creature.shadow.playDeath()
    removeCreature(creature)
    dying.push(creature.shadow)
    game.emit('shade-repelled', { id: creature.record.id })
  }

  /** Atteinte du cœur : dégât exact, ombre retirée et libérée aussitôt. */
  function breach(creature) {
    removeCreature(creature)
    group.remove(creature.shadow.group)
    creature.shadow.dispose()

    state.core.hp = Math.max(0, state.core.hp - level.heart.damage)
    state.lastEvent = 'breach'
    game.emit('heart-hit', { hp: state.core.hp, damage: level.heart.damage })
    // Nom d'intégration #149 : le juice encaisse au cœur, en plus du son de `heart-hit`.
    game.emit('core-hit', {
      hp: state.core.hp,
      damage: level.heart.damage,
      x: level.heart.x,
      z: level.heart.z,
    })
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
    // Fondus et vols continuent même après la fin : seule la logique de jeu est figée.
    updateDying(dt)
    updateProjectiles(dt)
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

  /** Libère les projectiles encore en vol : ils ne survivent ni au rejeu ni au démontage. */
  function clearProjectiles() {
    for (let i = 0; i < projectiles.length; i++) {
      group.remove(projectiles[i].mesh)
      disposeProjectile(projectiles[i].mesh)
    }
    projectiles.length = 0
    state.projectiles.active = 0
  }

  /** Réinitialise une partie sans rechargement : décor intact, tours rendues. */
  function restart() {
    if (disposed) return
    clearShadows()
    clearProjectiles()
    state.creatures = []
    cooldowns.clear()
    nextCreatureId = 1
    countdown = level.windup
    spawnTimer = 0
    spawned = 0
    variantIndex = 0
    waveVariants.clear()
    state.enemies.silhouettes = 0
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
    clearProjectiles()
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
