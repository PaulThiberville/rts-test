---
tags: [gdd]
status: validated
updated: 2026-11-09
---

# Mécaniques

Boucle de jeu et contrôles réellement livrés. Découle de [[Vision]] ; le cadrage et le ton visuel viennent de [[Direction-Artistique]].

## Chargement

Le niveau 1 se charge directement au lancement (`src/main.js`), sans menu ni écran titre : la clairière, son HUD et la caméra sont prêts dès le premier rendu.

## Boucle principale

Livré aujourd'hui : le joueur observe la Clairière de Sèveclaire et fait le tour du décor à la caméra. Les vagues, la pose de plantes-défenses et les gains décrits dans [[Vision]] ne sont pas encore implémentés et ne figurent donc pas ici.

## Contrôles

| Action | Souris | Tactile |
|---|---|---|
| Regarder la clairière | glisser, bouton gauche maintenu | glisser un doigt |

- Aucun clavier livré : ni ZQSD, ni flèches, ni raccourcis. Le clavier annoncé dans le cadre de [[Vision]] reste un objectif, pas un contrôle disponible aujourd'hui.
- Aucun zoom imposé : molette et pincement ne changent pas la distance de caméra.
- Le glissement fait orbiter la caméra autour de la cible et s'arrête net aux bornes ci-dessous.

## Caméra niveau 1

Bornes retenues et leur origine, lues dans `src/data/level-1.js` (`LEVEL_1.camera`) — le code de la caméra les importe, il ne les recopie pas :

| Réglage | Valeur | Rôle |
|---|---|---|
| `yaw` | -0,45 à 0,45 rad | rotation horizontale autour de la cible ; 0 place la caméra au sud de la cible, tournée vers le cœur ; l'arrivée reste hors cadre |
| `pitch` | 0,72 à 1,05 rad | élévation, de la vue la moins plongeante à la plus verticale |
| `distance` | 14 à 20 unités (m) | rayon orbital ; la caméra démarre au milieu, à 17 |
| `pan` | 2,5 unités | garde-fou : la cible ne s'écarte jamais de plus de 2,5 unités du centre (0, -2) |

- Le cadre ne sort jamais de `bounds` + `skirt` du décor (`minX -16`, `maxX 16`, `minZ -20`, `maxZ 12`, `skirt 6`), soit x ∈ [-22, 22] et z ∈ [-26, 18].
- Si les quatre coins de l'écran sortent de ce sol décoré pour une combinaison des bornes, la caméra resserre son champ de vision au lieu de montrer le vide.
- La cible est bornée au pan, puis recalée automatiquement pour garder le sol dans le cadre : aucune vue ne montre le vide.
