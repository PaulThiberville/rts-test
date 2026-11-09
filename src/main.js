import { createGame } from './core/game.js'
import { createLevel } from './core/level.js'
import { LEVEL_1 as level } from './data/level-1.js'
import { createLevelHud } from './ui/level-hud.js'

const game = createGame(document.body)
createLevel(game)
const hud = createLevelHud(document.getElementById('ui'), { level })
game.start()

// Contrat de test : le playtester lit window.__game.state.
window.__game = game
