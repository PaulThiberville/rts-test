---
tags: [gdd]
status: draft
updated: 2026-11-09
---

# Mécaniques

Boucle de jeu et contrôles : le livré d'aujourd'hui, puis le contrat de #60/#58 signalé comme tel. Découle de [[Vision]] ; le cadrage et le ton visuel viennent de [[Direction-Artistique]].

## Chargement

Le niveau 1 se charge directement au lancement (`src/main.js`), sans menu ni écran titre : la clairière, son HUD et la caméra sont prêts dès le premier rendu.

## Boucle principale

La clairière se charge, le joueur en fait le tour à la caméra, ouvre la barre des tours-plantes, choisit une graine et la pose sur un emplacement, puis sélectionne une tour posée et l'améliore. Les vagues montent ensuite d'elles-mêmes : 8 s de répit, 6 vagues d'ombres apparues une à une depuis l'entrée sud et qui suivent le chemin, tir automatique des tours-plantes sans aucun clic, cœur à 12 PV. La partie s'achève sur une victoire calme ou une défaite sans punition, avec la vague atteinte et la durée ; « Rejouer » relance aussitôt, sans confirmation. Cette seconde moitié est le contrat de #60 et #58, absente de cette branche ; ses valeurs sont dans « Les petites ombres ».

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

## Les petites ombres

Contrat des tickets #60 (vagues, tir automatique, cœur) et #58 (écran de fin) : `src/core/waves.js` n'existe pas encore dans cette branche, rien de ce qui suit n'y est livré tant que #60 n'est pas mergé. Seules les valeurs existent, dans `src/data/level-1.js`. La silhouette ronde des ombres vient de [[Direction-Artistique]], le ton « victoire calme, défaite sans punition » de [[Vision]].

### Vagues

Huit secondes de répit (`windup`) avant la vague 1, puis les six entrées de `waves` s'enchaînent dans l'ordre. Une ombre apparaît à la fois depuis `arrival`, l'entrée sud du chemin (x 0, z 11) ; toutes marchent le long de la polyligne `path.points`, sans jamais en sortir.

| Vague | Ombres | PV par ombre | Vitesse (m/s) | Espacement (s) |
|---|---|---|---|---|
| 1 | 4 | 6 | 0,45 | 2,4 |
| 2 | 4 | 7 | 0,47 | 2,2 |
| 3 | 5 | 7 | 0,49 | 2,0 |
| 4 | 5 | 8 | 0,51 | 1,8 |
| 5 | 6 | 8 | 0,53 | 1,6 |
| 6 | 7 | 8 | 0,55 | 1,4 |

- `count` (ombres), `hp` (PV par ombre), `speed` (m/s) et `gap` (s entre deux apparitions) de chaque entrée de `waves` ; jamais recopiés dans le code.

### Tir automatique

| Tour | Portée | Cadence | Dégâts par tir |
|---|---|---|---|
| Pousse (`sprout`) | 3,8 m | 1,0 s | 2 PV |
| Floraison (`bloom`) | 3,8 m | 1,0 s | 4 PV |

- `combat.range` et `combat.cadence` sont communes aux deux tours ; `combat.damage[type]` donne les dégâts de chaque type.
- À chaque tir, chaque tour posée vise l'ombre non morte la plus avancée à ≤ `combat.range` et lui retire `combat.damage[type]`.
- Zéro clic : le joueur ne commande jamais le tir, il choisit seulement où poser et quoi améliorer.
- Une ombre à 0 PV est retirée de la scène.

### Cœur et fin de partie

- Le cœur a 12 PV (`heart.hp`, vie maximale) et `heart.damage` = 1 : chaque ombre qui l'atteint coûte exactement 1 PV et disparaît.
- Victoire quand la dernière ombre de la vague 6 est abattue ; défaite quand la vie du cœur tombe à 0. Une seule fin par partie.
- L'écran de fin affiche la vague atteinte et la durée de la partie ; « Rejouer » remet le niveau à son état de départ — cœur plein, 120 sève, emplacements libres, vague 1 — sans confirmation ni pénalité.

### Réglage

Toutes ces valeurs se règlent dans `src/data/level-1.js` (`windup`, `waves`, `heart`, `combat`, `arrival`) ; le `src/core/waves.js` du contrat #60 les importera et n'en portera aucune en dur.

## Contrôles

| Action | Souris | Tactile |
|---|---|---|
| Regarder la clairière | glisser, bouton gauche maintenu | glisser un doigt |
| Ouvrir ou fermer la barre des tours | clic sur la poignée « Tours » | toucher la poignée « Tours » |
| Choisir une graine | clic sur Pousse ou Floraison | toucher Pousse ou Floraison |
| Poser une tour | clic sur un emplacement libre | toucher un emplacement libre |
| Sélectionner une tour | clic sur la tour posée | toucher la tour posée |
| Améliorer une tour | clic sur « Améliorer » | toucher « Améliorer » |
| Rejouer | clic sur « Rejouer » | toucher « Rejouer » |

- Le tir est automatique : aucune commande de tir, ni souris ni tactile.
- « Rejouer » et l'écran de fin arrivent avec #58/#60 ; les autres lignes du tableau sont livrées.
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
