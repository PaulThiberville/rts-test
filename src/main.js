import { createGame } from './core/game.js'
import { createLevel } from './core/level.js'

const game = createGame(document.body)
createLevel(game)
game.start()

// Contrat de test : le playtester lit window.__game.state.
window.__game = game
