import { createAudio } from './audio/index.js'
import { createGame } from './core/game.js'
import { createLevel } from './core/level.js'
import { markCompleted, readProgress } from './core/progress.js'
import { createTowerSystem } from './core/towers.js'
import { createWaveSystem } from './core/waves.js'
import { CAMPAIGNS, findCampaign, findLevel } from './data/campaigns.js'
import { DIFFICULTIES, findDifficulty } from './data/difficulties.js'
import { LEVEL_1 } from './data/level-1.js'
import { LEVEL_2 } from './data/level-2.js'
import { LEVEL_3 } from './data/level-3.js'
import { LEVEL_4 } from './data/level-4.js'
import { LEVEL_5 } from './data/level-5.js'
import { LEVEL_6 } from './data/level-6.js'
import { TOWERS } from './data/towers.js'
import { t } from './i18n/index.js'
import { createAudioToggle } from './ui/audio-toggle.js'
import { createHighBar } from './ui/high-bar.js'
import { createHomeScreen } from './ui/home.js'
import { createLevelHud } from './ui/level-hud.js'
import { createLevelSelect } from './ui/level-select.js'
import { createSpeedSelector } from './ui/speed-selector.js'
import { createTowerBar } from './ui/tower-bar.js'
import { createWaveHud } from './ui/wave-hud.js'

/** Valeurs par défaut du son, reprises dans `state.audio` pour le playtest. */
const AUDIO_VOLUME = 0.4
const AUDIO_VOLUME_KEY = 'clairiere.audio.volume'
/** Difficulté d'un lancement direct par URL : la liste des jardins est ignorée. */
const DIRECT_DIFFICULTY = 'medium'

/** Cartes réellement conçues, par id de `map` des campagnes : les six jardins de Sèveclaire. */
const MAPS = new Map([
  ['level-1', LEVEL_1],
  ['level-2', LEVEL_2],
  ['level-3', LEVEL_3],
  ['level-4', LEVEL_4],
  ['level-5', LEVEL_5],
  ['level-6', LEVEL_6],
])

const game = createGame(document.body)
const ui = document.getElementById('ui')
const params = new URLSearchParams(location.search)

/**
 * Titre d'onglet et description de partage dans la langue courante : le HTML
 * porte la variante FR, `?lang=en` ou un navigateur anglais affiche la variante EN.
 * Les balises absentes sont simplement ignorées.
 */
function applyMeta() {
  const title = t('meta.title')
  const description = t('meta.description')
  document.title = title
  const tags = [
    ['meta[name="description"]', description],
    ['meta[property="og:title"]', title],
    ['meta[property="og:description"]', description],
    ['meta[property="og:image:alt"]', title],
    ['meta[name="twitter:title"]', title],
    ['meta[name="twitter:description"]', description],
  ]
  for (const [selector, content] of tags) {
    document.head.querySelector(selector)?.setAttribute('content', content)
  }
}

/**
 * `?niveau=` accepte l'id de jardin (`niveau-1`) comme sa forme courte (`1`).
 * @param {string|null} value
 * @returns {string|null} id de jardin connu, sinon null
 */
function resolveLevelId(value) {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!raw) return null
  const short = /^(\d+)$/.exec(raw)
  const candidate = short ? `niveau-${Number(short[1])}` : raw
  return findLevel(candidate)?.level.id ?? null
}

/**
 * Jardins accessibles : le premier de chaque campagne, plus le suivant de chaque
 * jardin terminé. L'ordre de `CAMPAIGNS` est conservé.
 * @param {string[]} completed
 * @returns {string[]}
 */
function readUnlocked(completed) {
  const done = new Set(completed)
  const unlocked = []
  for (const campaign of CAMPAIGNS) {
    const levels = Array.isArray(campaign.levels) ? campaign.levels : []
    levels.forEach((level, index) => {
      const previous = levels[index - 1]
      if (index === 0 || (previous && done.has(previous.id))) unlocked.push(level.id)
    })
  }
  return unlocked
}

const progress = readProgress()
const difficultyParam = findDifficulty(params.get('difficulty'))?.id ?? null
const requestedLevelId = resolveLevelId(params.get('niveau'))

game.state.screen = 'home'
game.state.campaign = null
game.state.difficulty = difficultyParam
game.state.waveMultiplier = difficultyParam ? findDifficulty(difficultyParam).multiplier : null
game.state.progress = progress
game.state.unlocked = readUnlocked(progress.completed)

const audio = createAudio({ volume: AUDIO_VOLUME, storageKey: AUDIO_VOLUME_KEY })

/**
 * Expose les clés d'un snapshot audio en getters : l'état observable reste
 * sérialisable et suit le contexte Web Audio (suspendu, muet, gains) sans recopie
 * à maintenir. Aucune valeur THREE n'entre dans `game.state`.
 * @param {object} target objet recevant les propriétés
 * @param {string[]} keys clés du snapshot à exposer
 * @returns {object} l'objet complété
 */
function exposeSnapshot(target, keys) {
  for (const key of keys) {
    Object.defineProperty(target, key, {
      enumerable: true,
      get: () => audio.getSnapshot()[key],
    })
  }
  return target
}

game.state.audio = exposeSnapshot(
  { defaultVolume: AUDIO_VOLUME, volumeKey: AUDIO_VOLUME_KEY },
  Object.keys(audio.getSnapshot()),
)

// Déclencheurs des neuf moments sonores : seuls les noms de `EFFECT_NAMES` (#136)
// sont joués, la limite de 3 déclenchements/s étant imposée par `createAudio`.
game.state.sound = exposeSnapshot(
  { defaultVolume: AUDIO_VOLUME },
  ['played', 'lastEffect', 'effectCount', 'resumeCount', 'families'],
)

game.on('wave-start', () => audio.play('wave'))
game.on('tower-shot', () => audio.play('shoot'))
game.on('tower-upgraded', () => audio.play('upgrade'))
game.on('shade-repelled', () => audio.play('kill'))
game.on('heart-hit', () => audio.play('core-hit'))
game.on('victory', () => audio.play('victory'))
game.on('defeat', () => audio.play('defeat'))

// Monté avant les autres HUD : la pastille est le premier arrêt de Tab, donc
// atteignable en un seul appui au clavier.
const audioToggle = createAudioToggle(ui, {
  onToggle: () => {
    audio.toggleMute()
    audioToggle.update(audio.getSnapshot())
  },
})
audioToggle.update(audio.getSnapshot())

// Sélecteur de vitesse : il ne décide de rien et remonte le choix, la boucle applique le
// facteur. Son affichage suit `state.speed` à chaque image, donc un nouveau niveau ou un
// « Rejouer » le ramène à ×1. Il vit avec le HUD du niveau, jamais dans les menus.
let speedSelector = null
game.on('frame', () => speedSelector?.update({ speed: game.state.speed }))

/** Écran d'accueil monté, ou null hors de `'home'`. */
let home = null
/** Écran de choix du jardin monté, ou null hors de `'levels'`. */
let levelSelect = null
/** Niveau en cours et tous ses systèmes, ou null hors de `'game'`. */
let session = null
/** Juice de la session en cours, ou null hors niveau : les abonnements ci-dessous le lisent. */
let juice = null

// Juice des trois moments d'intégration (#149) : poser une tour, encaisser au cœur,
// terminer la partie. Les noms dédiés s'ajoutent aux événements déjà émis par les
// systèmes, sans les remplacer : le son et les playtests continuent de les écouter.
game.on('tower-placed', (event) => juice?.spawn('towerPlaced', event))
game.on('core-hit', (event) => juice?.spawn('heartDamage', event))
game.on('run-end', (event) => {
  if (event.outcome === 'victory') juice?.spawn('victory', event)
})

/** Progression au format attendu par `createLevelSelect`. */
function selectProgress() {
  return { unlocked: game.state.unlocked, completed: game.state.progress.completed }
}

/** Détruit l'écran courant de la liste des jardins. */
function closeLevelSelect() {
  levelSelect?.destroy()
  levelSelect = null
}

/**
 * Détruit le niveau courant : HUD, barre des tours, systèmes et décor 3D.
 * `state.level` disparaît, la boucle de jeu continue sans rien monter.
 */
function stopLevel() {
  if (!session) return
  const { level, hud, highBar, towerBar, towers, waveHud, waves } = session
  session = null
  speedSelector?.destroy()
  speedSelector = null
  waveHud.destroy()
  waves.dispose()
  highBar.destroy()
  towerBar.destroy()
  towers.dispose()
  hud.destroy()
  level.dispose()
  juice = null
  // Quitter le niveau ne laisse pas de facteur de vitesse derrière soi : le prochain
  // jardin démarre à ×1, et les menus retrouvent le sélecteur neutre.
  game.setSpeed(1)
  delete game.state.level
  delete game.towers
}

/** Affiche l'accueil, progression à jour, sans rechargement de page. */
function showHome() {
  stopLevel()
  closeLevelSelect()
  home?.destroy()
  game.state.screen = 'home'
  game.state.campaign = null
  // Chaque retour à l'accueil sonne la cloche, même sans geste supplémentaire.
  audio.play('home')
  home = createHomeScreen(ui, { onOpen: openCampaign })
  home.update({ progress: game.state.progress })
}

/**
 * Ouvre la liste des jardins d'une campagne `available` ;
 * une campagne indisponible ne change rien à l'écran.
 * L'appel depuis le jeu, après `stopLevel()`, remplace la liste sans rechargement.
 * @param {string} campaignId
 */
function openCampaign(campaignId) {
  const campaign = findCampaign(campaignId)
  if (!campaign || campaign.available !== true) return
  home?.destroy()
  home = null
  closeLevelSelect()
  game.state.screen = 'levels'
  game.state.campaign = campaign.id
  levelSelect = createLevelSelect(ui, {
    campaign,
    difficulties: DIFFICULTIES,
    onStart: startLevel,
    onBack: showHome,
  })
  levelSelect.update({ progress: selectProgress(), difficulty: game.state.difficulty })
}

/**
 * Ferme le niveau et rouvre la liste de la campagne en cours, progression à jour,
 * sans rechargement de page : la victoire y est déjà enregistrée.
 */
function showLevels() {
  const campaignId = game.state.campaign
  stopLevel()
  closeLevelSelect()
  openCampaign(campaignId)
}

/**
 * Monte le niveau demandé : décor, caméra, HUD, tours, vagues.
 * `state.level.id` porte l'id du jardin, `mapId` celui de la carte assemblée.
 * @param {{ campaign: object, level: object }} entry jardin de `CAMPAIGNS` retenu
 * @param {object} difficulty profil de `DIFFICULTIES`
 */
function mountLevel({ campaign, level: entry }, difficulty) {
  // Chaque jardin s'ouvre à vitesse réelle, quel que soit le facteur du précédent.
  game.setSpeed(1)
  speedSelector = createSpeedSelector(ui, { onSelect: (speed) => game.setSpeed(speed) })
  speedSelector.update({ speed: game.state.speed })
  const map = MAPS.get(entry.map) ?? LEVEL_1
  const level = createLevel(game, { level: map })
  // Le juice du niveau reçoit les tirs, les morts et les impacts du système de vagues.
  juice = level.juice
  game.state.level.id = entry.id
  game.state.level.mapId = map.id
  game.state.screen = 'game'
  game.state.campaign = campaign.id
  game.state.difficulty = difficulty.id
  game.state.waveMultiplier = difficulty.multiplier

  // Barre haute montée avant les autres HUD : le retour aux jardins et la sève
  // occupent le haut de l'écran, le HUD du niveau se place en dessous.
  const highBar = createHighBar(ui, { onBack: showHome, state: game.state })
  const hud = createLevelHud(ui, { level: map })

  let towerBar
  /** Nombre de tours déjà posées : une pose de plus, et une seule, déclenche le son. */
  let placedTowers = 0
  const onTowersChange = () => {
    const placed = game.state.towers.length
    if (placed > placedTowers && game.state.lastAction === 'placed') audio.play('plant')
    placedTowers = placed
    towerBar?.update(game.state)
    highBar.update(game.state)
  }
  const towers = createTowerSystem(game, { level: map, onChange: onTowersChange })
  towerBar = createTowerBar(ui, {
    towers: TOWERS,
    onSelect: (type) => towers.selectType(type),
    onUpgrade: (id) => towers.upgrade(id),
  })
  towerBar.update(game.state)
  // `createTowerSystem` pose la sève de départ dans l'état : la barre la lit après lui.
  highBar.update(game.state)

  // `waves.restart()` remet aussi les tours à zéro : le système lui est exposé ici.
  game.towers = towers

  const waveHud = createWaveHud(ui, {
    onRestart: () => {
      // « Rejouer » repart à vitesse réelle : aucune cadence accélérée n'est conservée.
      game.setSpeed(1)
      waves.restart()
    },
    onNext: () => goNextLevel(),
    onExit: () => showLevels(),
  })

  /**
   * Tout changement de vague, et la fin de partie : la victoire est enregistrée
   * avant que le HUD n'affiche la modale de fin, donc sans dépendre d'un clic.
   * `completeLevel` est idempotent : l'appel de `onChange` puis celui de `onEnd`
   * n'écrivent qu'une fois.
   */
  const updateWaves = () => {
    if (game.state.run.outcome === 'victory') completeLevel()
    waveHud.update(game.state)
  }

  const waves = createWaveSystem(game, {
    level: map,
    juice: level.juice,
    onChange: updateWaves,
    onEnd: updateWaves,
  })

  session = { level, hud, highBar, towerBar, towers, waveHud, waves }
}

/**
 * Lance un jardin : depuis la liste des jardins, ou directement par `?niveau=`.
 * @param {string} levelId
 * @param {string} difficultyId
 */
function startLevel(levelId, difficultyId) {
  const found = findLevel(levelId)
  const difficulty = findDifficulty(difficultyId)
  if (!found || !difficulty) return
  stopLevel()
  closeLevelSelect()
  home?.destroy()
  home = null
  mountLevel(found, difficulty)
}

/**
 * Monte le jardin suivant de la campagne en cours, directement, sans repasser par
 * l'accueil : l'URL suit le nouveau jardin. Dernier jardin (ou état incomplet) :
 * retour à la liste des jardins.
 */
function goNextLevel() {
  if (game.state.screen !== 'game') return
  const current = findLevel(game.state.level?.id)
  if (!current) return
  const next = current.campaign.levels[current.index + 1]
  const difficultyId = game.state.difficulty
  if (!next || !difficultyId) {
    showLevels()
    return
  }
  history.replaceState(null, '', `?niveau=${next.id}&difficulty=${difficultyId}`)
  startLevel(next.id, difficultyId)
}

// Premier geste (clic ou touche) : le contexte Web Audio démarre, la cloche d'accueil
// sonne une fois, puis la nappe.
let audioUnlocked = false
function unlockAudio() {
  if (audioUnlocked) return
  audioUnlocked = true
  audio.unlock().then((ready) => {
    if (!ready) return
    audio.play('home')
    audio.startAmbience()
    audioToggle.update(audio.getSnapshot())
  })
}
addEventListener('pointerdown', unlockAudio, { once: true })
addEventListener('keydown', unlockAudio, { once: true })

// Retour d'onglet : le navigateur suspend Web Audio en arrière-plan. `resume()` le
// réveille sans nouvel appui, puis la nappe reprend si elle tournait avant le masquage.
let ambienceWasRunning = false
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    ambienceWasRunning = audio.getSnapshot().ambienceRunning
    return
  }
  audio.resume().then((ready) => {
    if (ready && ambienceWasRunning) audio.startAmbience()
    audioToggle.update(audio.getSnapshot())
  })
})

/**
 * Marque le jardin courant comme terminé, met à jour la progression et les
 * écrans, puis renvoie l'état enregistré.
 * @returns {{ version: 1, completed: string[] }}
 */
function completeLevel() {
  const levelId = game.state.level?.id
  if (game.state.screen !== 'game' || typeof levelId !== 'string') return game.state.progress
  const saved = markCompleted(levelId)
  game.state.progress = saved
  game.state.unlocked = readUnlocked(saved.completed)
  home?.update({ progress: saved })
  levelSelect?.update({ progress: selectProgress() })
  return saved
}

/**
 * Rectangles px CSS des blocs du HUD du niveau, recalculés à chaque appel :
 * le playtest vérifie les cibles et l'absence de chevauchement. Un bloc absent
 * (hors niveau) vaut `null`.
 * @returns {{ highBar: DOMRect|null, waveHud: DOMRect|null, core: DOMRect|null, towerBar: DOMRect|null }}
 */
function measureUi() {
  const measure = (selector) => {
    const node = document.querySelector(selector)
    return node ? node.getBoundingClientRect() : null
  }
  return {
    highBar: measure('.high-bar'),
    waveHud: measure('.wave-hud'),
    core: measure('.wave-hud__core'),
    towerBar: measure('.tower-bar__panel'),
  }
}

game.completeLevel = completeLevel
game.measureUi = measureUi

applyMeta()

if (requestedLevelId) {
  startLevel(requestedLevelId, difficultyParam ?? DIRECT_DIFFICULTY)
} else {
  showHome()
}

game.start()

// Contrat de test : le playtester lit window.__game.state.
window.__game = game
