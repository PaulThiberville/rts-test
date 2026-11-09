---
tags: [tech]
status: validated
updated: 2026-11-08
---

# Réseau

Multijoueur pair-à-pair sans serveur : signalisation via relais Nostr publics, données en WebRTC (bibliothèque `trystero`).
Règles détaillées : skill `game-network`. Contexte : [[Architecture]].

- Chaque pair est autoritaire sur sa propre entité ; état envoyé à 10–20 Hz, interpolé à la réception.
- Le jeu reste jouable en solo si aucun pair n'est trouvé.
