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

Livré aujourd'hui : la clairière se charge, le joueur en fait le tour à la caméra, ouvre la barre des tours-plantes, choisit une graine et la pose sur un emplacement, puis sélectionne une tour posée et l'améliore.

## Tours-plantes

La barre démarre fermée et se bascule avec la poignée « Tours », en bas à gauche de l'écran. Ouverte, elle liste les deux graines avec leur prix en sève ; dès qu'une tour est sélectionnée, la rangée de graines cède la place à son niveau, au prix de son amélioration et au bouton « Améliorer ».

| Graine | Pose | Amélioration 1 → 2 |
|---|---|---|
| Pousse (`sprout`) | 40 sève | 30 sève |
| Floraison (`bloom`) | 60 sève | 40 sève |

- Prix, coûts d'amélioration et niveau maximal (2) lus dans `src/data/towers.js`.
- Le joueur démarre avec 120 sève ; la clairière offre 4 emplacements fixes, matérialisés au sol et lus dans `src/data/level-1.js`. Aucun compteur de sève n'est affiché : seuls les prix renseignent le budget.
- Économie fermée : 120 sève = trois Pousses, ou deux Pousses et une amélioration (110) ; une Pousse et une Floraison coûtent 100.
- Choisir une graine arme la pose : un fantôme de la tour flotte sur l'emplacement survolé ; choisir une graine désélectionne la tour en cours.
- Un clic sur un emplacement libre pose la tour et débite son prix.
- Pose refusée, sans aucune dépense : emplacement déjà occupé, clic hors emplacement, ou sève insuffisante.
- Un clic sur une tour posée la sélectionne ; un marqueur au sol la désigne. Un clic hors d'une tour efface la sélection.
- « Améliorer » fait passer la tour du niveau 1 au niveau 2 et débite son prix ; le bouton reste inactif quand la sève manque ou que le niveau 2 est atteint.

## Contrôles

| Action | Souris | Tactile |
|---|---|---|
| Regarder la clairière | glisser, bouton gauche maintenu | glisser un doigt |
| Ouvrir ou fermer la barre des tours | clic sur la poignée « Tours » | toucher la poignée « Tours » |
| Choisir une graine | clic sur Pousse ou Floraison | toucher Pousse ou Floraison |
| Poser une tour | clic sur un emplacement libre | toucher un emplacement libre |
| Sélectionner une tour | clic sur la tour posée | toucher la tour posée |
| Améliorer une tour | clic sur « Améliorer » | toucher « Améliorer » |

- La caméra ne change pas : choisir, poser, sélectionner et améliorer sont des appuis sur place. Un déplacement de plus de 6 px entre l'appui et le relâchement reste un glissement de caméra, jamais une pose.
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
