import { createAudio } from './audio/index.js'
import { createGame } from './core/game.js'
import { createLevel } from './core/level.js'
import { markCompleted, readProgress } from './core/progress.js'
import { createTowerSystem } from './core/towers.js'
import { createWaveSystem } from './core/waves.js'
import { CAMPAIGNS, findCampaign, findLevel } from './data/campaigns.js'
import { DIFFICULTIES, findDifficulty } from './data/difficulties.js'
import { LEVEL_1 } from './data/level-1.js'
import { TOWERS } from './data/towers.js'
import { t } from './i18n/index.js'
import { createAudioToggle } from './ui/audio-toggle.js'
import { createHomeScreen } from './ui/home.js'
import { createLevelHud } from './ui/level-hud.js'
import { createLevelSelect } from './ui/level-select.js'
import { createTowerBar } from './ui/tower-bar.js'
import { createWaveHud } from './ui/wave-hud.js'

/** Valeurs par défaut du son, reprises dans `state.audio` pour le playtest. */
const AUDIO_VOLUME = 0.4
const AUDIO_VOLUME_KEY = 'clairiere.audio.volume'
/** Difficulté d'un lancement direct par URL : la liste des jardins est ignorée. */
const DIRECT_DIFFICULTY = 'medium'

/**
 * Cartes réellement conçues, par id de `map` des campagnes : les six jardins de
 * Sèveclaire partagent la clairière tant que les suivantes ne sont pas dessinées.
 */
const MAPS = new Map([['level-1', LEVEL_1]])

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

// `state.audio` est recalculé à chaque lecture : l'état reste sérialisable et reflète
// le contexte Web Audio (suspendu, mute, gain) sans recopie à maintenir.
const audioState = { defaultVolume: AUDIO_VOLUME, volumeKey: AUDIO_VOLUME_KEY }
for (const key of Object.keys(audio.getSnapshot())) {
  Object.defineProperty(audioState, key, {
    enumerable: true,
    get: () => audio.getSnapshot()[key],
  })
}
game.state.audio = audioState

game.on('wave-start', () => audio.play('wave'))
game.on('shade-repelled', () => audio.play('repelled'))

// Monté avant les autres HUD : la pastille est le premier arrêt de Tab, donc
// atteignable en un seul appui au clavier.
const audioToggle = createAudioToggle(ui, {
  onToggle: () => {
    audio.toggleMute()
    audioToggle.update(audio.getSnapshot())
  },
})
audioToggle.update(audio.getSnapshot())

/** Écran d'accueil monté, ou null hors de `'home'`. */
let home = null
/** Écran de choix du jardin monté, ou null hors de `'levels'`. */
let levelSelect = null
/** Niveau en cours et tous ses systèmes, ou null hors de `'game'`. */
let session = null

/** Progression au format attendu par `createLevelSelect`. */
function selectProgress() {
  return { unlocked: game.state.unlocked, completed: game.state.progress.completed }
}

/**
 * Bouton « Retour » du niveau : le HUD du niveau n'en porte pas, l'intégration le
 * place sous ce HUD, à l'écart du chemin et des contrôles.
 * @returns {HTMLButtonElement}
 */
function createBackButton() {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'level-select__button level-select__button--back'
  button.dataset.action = 'back'
  button.textContent = t('game.back')
  button.style.position = 'absolute'
  button.style.left = 'calc(env(safe-area-inset-left, 0px) + clamp(8px, 2vw, 20px))'
  button.style.top = 'calc(env(safe-area-inset-top, 0px) + clamp(104px, 14vh, 128px))'
  button.style.zIndex = '5'
  button.style.pointerEvents = 'auto'
  button.addEventListener('click', showHome)
  return button
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
  const { level, hud, back, towerBar, towers, waveHud, waves } = session
  session = null
  waveHud.destroy()
  waves.dispose()
  back.remove()
  towerBar.destroy()
  towers.dispose()
  hud.destroy()
  level.dispose()
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
  home = createHomeScreen(ui, { onOpen: openCampaign })
  home.update({ progress: game.state.progress })
}

/**
 * Ouvre la liste des jardins d'une campagne `available` ;
 * une campagne indisponible ne change rien à l'écran.
 * @param {string} campaignId
 */
function openCampaign(campaignId) {
  const campaign = findCampaign(campaignId)
  if (game.state.screen !== 'home' || !campaign || campaign.available !== true) return
  home?.destroy()
  home = null
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
 * Monte le niveau demandé : décor, caméra, HUD, tours, vagues.
 * `state.level.id` porte l'id du jardin, `mapId` celui de la carte assemblée.
 * @param {{ campaign: object, level: object }} entry jardin de `CAMPAIGNS` retenu
 * @param {object} difficulty profil de `DIFFICULTIES`
 */
function mountLevel({ campaign, level: entry }, difficulty) {
  const map = MAPS.get(entry.map) ?? LEVEL_1
  const level = createLevel(game, { level: map })
  game.state.level.id = entry.id
  game.state.level.mapId = map.id
  game.state.screen = 'game'
  game.state.campaign = campaign.id
  game.state.difficulty = difficulty.id
  game.state.waveMultiplier = difficulty.multiplier

  const hud = createLevelHud(ui, { level: map })
  const back = createBackButton()
  ui.append(back)

  let towerBar
  /** Nombre de tours déjà posées : une pose de plus, et une seule, déclenche le son. */
  let placedTowers = 0
  const onTowersChange = () => {
    const placed = game.state.towers.length
    if (placed > placedTowers && game.state.lastAction === 'placed') audio.play('plant')
    placedTowers = placed
    towerBar?.update(game.state)
  }
  const towers = createTowerSystem(game, { level: map, onChange: onTowersChange })
  towerBar = createTowerBar(ui, {
    towers: TOWERS,
    onSelect: (type) => towers.selectType(type),
    onUpgrade: (id) => towers.upgrade(id),
    onToggle: () => towers.toggleBar(),
  })
  towerBar.update(game.state)

  // `waves.restart()` remet aussi les tours à zéro : le système lui est exposé ici.
  game.towers = towers

  const waveHud = createWaveHud(ui, { onRestart: () => waves.restart() })
  const waves = createWaveSystem(game, {
    level: map,
    onChange: () => waveHud.update(game.state),
    onEnd: () => waveHud.update(game.state),
  })

  session = { level, hud, back, towerBar, towers, waveHud, waves }
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

// Premier geste (clic ou touche) : le contexte Web Audio peut démarrer, puis la nappe.
let audioUnlocked = false
function unlockAudio() {
  if (audioUnlocked) return
  audioUnlocked = true
  audio.unlock().then((ready) => {
    if (!ready) return
    audio.startAmbience()
    audioToggle.update(audio.getSnapshot())
  })
}
addEventListener('pointerdown', unlockAudio, { once: true })
addEventListener('keydown', unlockAudio, { once: true })

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

game.completeLevel = completeLevel

applyMeta()

if (requestedLevelId) {
  startLevel(requestedLevelId, difficultyParam ?? DIRECT_DIFFICULTY)
} else {
  showHome()
}

game.start()

// Contrat de test : le playtester lit window.__game.state.
window.__game = game
