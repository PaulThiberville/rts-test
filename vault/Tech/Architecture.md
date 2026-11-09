---
tags: [tech]
status: validated
updated: 2026-11-08
---

# Architecture

Jeu Three.js servi par Vite, une boucle unique, des modules par domaine. Règles des agents : fournies par le plugin `opencode-threejs-games-harness`.

- `src/core/game.js` — renderer, scène, caméra, boucle `setAnimationLoop`, `game.add(entity)`.
- `src/main.js` — composition des modules (seul endroit qui les relie).
- `src/<domaine>/` — un domaine = un dossier = un agent (un agent spécialiste par dossier).
- `src/i18n/` — `t('cle')`, une langue par fichier JSON. `src/data/` — niveaux et équilibrage.
- `tests/play/` + `scripts/play.mjs` — playtests headless (WebGL, erreurs, budget, critères d'Epic), rejoués par la CI.

Réseau : voir [[Reseau]].
