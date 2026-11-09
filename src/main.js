import { createGame } from './core/game.js'
import { createPlayer } from './entities/player.js'
import { createHud } from './ui/hud.js'

const game = createGame(document.body)
game.add(createPlayer())
createHud(document.getElementById('ui'))
game.start()

// Contrat de test : le playtester lit window.__game.state.
window.__game = game
