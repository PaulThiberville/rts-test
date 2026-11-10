import { createAudio } from './audio/index.js'
import { createGame } from './core/game.js'
import { createLevel } from './core/level.js'
import { createTowerSystem } from './core/towers.js'
import { createWaveSystem } from './core/waves.js'
import { LEVEL_1 as level } from './data/level-1.js'
import { TOWERS } from './data/towers.js'
import { createAudioToggle } from './ui/audio-toggle.js'
import { createLevelHud } from './ui/level-hud.js'
import { createTowerBar } from './ui/tower-bar.js'
import { createWaveHud } from './ui/wave-hud.js'

/** Valeurs par défaut du son, reprises dans `state.audio` pour le playtest. */
const AUDIO_VOLUME = 0.4
const AUDIO_VOLUME_KEY = 'clairiere.audio.volume'

const game = createGame(document.body)

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
const audioToggle = createAudioToggle(document.getElementById('ui'), {
  onToggle: () => {
    audio.toggleMute()
    audioToggle.update(audio.getSnapshot())
  },
})
audioToggle.update(audio.getSnapshot())

createLevel(game)
createLevelHud(document.getElementById('ui'), { level })

let bar
/** Nombre de tours déjà posées : une pose de plus, et une seule, déclenche le son. */
let placedTowers = 0
const onTowersChange = () => {
  const placed = game.state.towers.length
  if (placed > placedTowers && game.state.lastAction === 'placed') audio.play('plant')
  placedTowers = placed
  bar?.update(game.state)
}
const system = createTowerSystem(game, { level, onChange: onTowersChange })
bar = createTowerBar(document.getElementById('ui'), {
  towers: TOWERS,
  onSelect: (type) => system.selectType(type),
  onUpgrade: (id) => system.upgrade(id),
  onToggle: () => system.toggleBar(),
})
bar.update(game.state)

// `waves.restart()` remet aussi les tours à zéro : le système lui est exposé ici.
game.towers = system

const waveHud = createWaveHud(document.getElementById('ui'), { onRestart: () => waves.restart() })
const waves = createWaveSystem(game, {
  level,
  onChange: () => waveHud.update(game.state),
  onEnd: () => waveHud.update(game.state),
})

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

game.start()

// Contrat de test : le playtester lit window.__game.state.
window.__game = game
