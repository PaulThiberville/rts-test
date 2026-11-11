---
tags: [gdd]
status: draft
updated: 2026-11-11
---

# Mécaniques

Boucle de jeu et contrôles : le livré d'aujourd'hui. Découle de [[Vision]] ; le cadrage et le ton visuel viennent de [[Direction-Artistique]].

## Chargement

Au lancement, l'accueil s'affiche avant la clairière (`src/main.js`) : aucun décor 3D, HUD ni barre des tours n'est monté tant qu'un niveau n'est pas lancé. La boucle de rendu tourne quand même, sans niveau.

Parcours : accueil → campagne → jardin → difficulté → niveau. « Retour » depuis la liste des jardins comme depuis le niveau ramène à l'accueil **sans rechargement de page** : le niveau est détruit, la progression locale reste intacte et le compteur d'images continue de croître. Dans le niveau, ce « Retour » vit dans une barre haute dédiée, ancrée en haut de l'écran, à côté de la sève : cette barre haute ne se replie jamais.

L'URL accepte `?niveau=<levelId>` pour démarrer directement sur un niveau, accueil ignoré, et `?difficulty=<easy|medium|hard>` pour présélectionner le rythme.

## Accueil et difficultés

- 3 cartes de campagne, dans cet ordre : La Clairière de Sèveclaire (ouvrable), Les Brumes douces et La Rive lente (toutes deux « Bientôt disponible »). Un clic sur une carte indisponible ne change ni l'écran ni l'état, et le badge reste affiché.
- La campagne principale ouvre ses 6 jardins nommés ; seul le premier est ouvert au premier lancement, chaque jardin terminé débloque le suivant.
- La difficulté se choisit sur la liste des jardins, avant « Commencer » : le multiplicateur de vagues vaut **0,75** (facile), **1** (moyen) ou **1,5** (difficile). Il module le rythme des vagues du niveau, jamais le déblocage.
- Terminer un niveau écrit son id dans `localStorage`, clé `seveclaire.progress.v1`, au format `{ version: 1, completed: ["niveau-1", …] }` : ids uniques, ordre d'arrivée conservé. Clé absente, JSON corrompu ou stockage indisponible valent progression vide, sans erreur visible.
- Noms de jardins et valeurs exactes : [[Campagnes-et-Difficultes]].

## Boucle principale

Dans un niveau lancé, le joueur fait le tour de la clairière à la caméra, choisit une graine dans la barre des tours-plantes toujours ouverte et la pose sur un emplacement, puis sélectionne une tour posée et l'améliore. Les vagues montent ensuite d'elles-mêmes : 8 s de répit, 6 vagues d'ombres apparues une à une depuis l'entrée sud et qui suivent le chemin, tir automatique des tours-plantes sans aucun clic, cœur à 12 PV. La partie s'achève sur une victoire calme ou une défaite sans punition, avec la vague atteinte et la durée : trois actions en victoire, deux en défaite (« Cœur et fin de partie »). Valeurs détaillées dans « Les petites ombres ».

## Tours-plantes

La barre est toujours ouverte, en bas à gauche de l'écran : aucun bouton ne l'ouvre ni ne la ferme, elle est là dès l'entrée dans le niveau et liste les deux graines avec leur prix en sève. Dès qu'une tour est sélectionnée, la rangée de graines cède la place à son niveau, au prix de son amélioration et au bouton « Améliorer » ; la sélection effacée, les deux graines reviennent.

Le panneau est un aplat translucide unique, arrondi, posé sur le décor : aucun fond blanc entre ses boutons, aucun interstice clair, ni sur la rangée de graines ni sur la sélection. Les boutons affichés se lisent côte à côte, séparés par leur propre contour et non par une bande de fond clair.

Livrées avec #148 : la barre des tours n'a pas de bouton de repli, et la barre haute affiche « Retour » et la sève en permanence.

| Graine | Pose | Amélioration 1 → 2 |
|---|---|---|
| Pousse (`sprout`) | 40 sève | 30 sève |
| Floraison (`bloom`) | 60 sève | 40 sève |

- Prix, coûts d'amélioration et niveau maximal (2) lus dans `src/data/towers.js`.
- Le joueur démarre avec 120 sève ; la clairière offre 4 emplacements fixes, matérialisés au sol et lus dans `src/data/level-1.js`. La sève courante est affichée en permanence dans la barre haute, à côté de « Retour », et se décrémente à chaque pose ou amélioration : le budget se lit d'un coup d'œil, les prix ne font que l'expliciter. Compteur livré avec #148.
- Économie fermée : 120 sève = trois Pousses, ou deux Pousses et une amélioration (110) ; une Pousse et une Floraison coûtent 100.
- Choisir une graine arme la pose : un fantôme de la tour flotte sur l'emplacement survolé ; choisir une graine désélectionne la tour en cours.
- Un clic sur un emplacement libre pose la tour et débite son prix.
- Pose refusée, sans aucune dépense : emplacement déjà occupé, clic hors emplacement, ou sève insuffisante.
- Un clic sur une tour posée la sélectionne ; un marqueur au sol la désigne. Un clic hors d'une tour efface la sélection.
- « Améliorer » fait passer la tour du niveau 1 au niveau 2 et débite son prix ; le bouton reste inactif quand la sève manque ou que le niveau 2 est atteint.

## Les petites ombres

Valeurs de `src/data/level-1.js` importées par `src/core/waves.js`, qui n'en porte aucune en dur. La silhouette ronde des ombres vient de [[Direction-Artistique]], le ton « victoire calme, défaite sans punition » de [[Vision]].

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
- L'écran de fin est une modale plein cadre (`src/ui/wave-hud.js`) : titre « Victoire » ou « Défaite », vague atteinte, durée `mm:ss` ; le reste du HUD devient inerte tant qu'elle est ouverte.
Actions de l'écran de fin — trois en victoire, deux en défaite — dans cet ordre :

| Fin | « Niveau suivant » | « Rejouer » | « Retour aux jardins » |
|---|---|---|---|
| Victoire | affiché, action principale (focus à l'ouverture) | affiché | affiché |
| Défaite | masqué **et** désactivé : hors boucle de tabulation et d'arbre d'accessibilité | affiché | affiché |

- Progression écrite **avant** toute relance ou réinitialisation : la victoire est enregistrée au moment où la partie se termine, avant l'affichage de la modale, sans attendre un clic. `markCompleted` est idempotent et ajoute l'id à `seveclaire.progress.v1` (`localStorage`), au format décrit en « Accueil et difficultés ».
- « Rejouer » ne peut donc rien effacer : `waves.restart()` remet cœur plein (12 PV), 120 sève, emplacements libres, vague 1 et durée à zéro, sans toucher à la progression. Une défaite n'écrit rien.
- La progression survit à `location.reload()` : au démarrage, `readProgress` relit `localStorage`, le jardin terminé reste terminé et le suivant reste déverrouillé.
- « Niveau suivant » monte directement le jardin suivant de la campagne, URL mise à jour en place (`?niveau=niveau-2&difficulty=<easy|medium|hard>`), sans accueil ni liste et sans rechargement ; au dernier jardin, retour à la liste.
- « Retour aux jardins » ferme le niveau et rouvre la liste des jardins de la campagne, le suivant déverrouillé, sans rechargement de page.

### Réglage

Toutes ces valeurs se règlent dans `src/data/level-1.js` (`windup`, `waves`, `heart`, `combat`, `arrival`) ; `src/core/waves.js` les importe et n'en porte aucune en dur.

## Contrôles

| Action | Souris | Tactile |
|---|---|---|
| Regarder la clairière | glisser, bouton gauche maintenu | glisser un doigt |
| Choisir une graine | clic sur Pousse ou Floraison | toucher Pousse ou Floraison |
| Poser une tour | clic sur un emplacement libre | toucher un emplacement libre |
| Sélectionner une tour | clic sur la tour posée | toucher la tour posée |
| Améliorer une tour | clic sur « Améliorer » | toucher « Améliorer » |
| Rejouer | clic sur « Rejouer » | toucher « Rejouer » |

- Aucun geste n'ouvre ni ne ferme l'interface : la barre des tours reste déployée en bas à gauche et la barre haute ne se replie pas (barre permanente livrée avec #148).
- Le tir est automatique : aucune commande de tir, ni souris ni tactile.
- Toutes les lignes du tableau sont livrées ; les trois actions de fin sont détaillées dans « Cœur et fin de partie ».
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
