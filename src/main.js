import { createGame } from './core/game.js'
import { createLevel } from './core/level.js'
import { createTowerSystem } from './core/towers.js'
import { createWaveSystem } from './core/waves.js'
import { LEVEL_1 as level } from './data/level-1.js'
import { TOWERS } from './data/towers.js'
import { createLevelHud } from './ui/level-hud.js'
import { createTowerBar } from './ui/tower-bar.js'
import { createWaveHud } from './ui/wave-hud.js'

const game = createGame(document.body)
createLevel(game)
createLevelHud(document.getElementById('ui'), { level })

let bar
const system = createTowerSystem(game, { level, onChange: () => bar?.update(game.state) })
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

game.start()

// Contrat de test : le playtester lit window.__game.state.
window.__game = game
