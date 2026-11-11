---
tags: [gdd]
status: draft
updated: 2026-11-11
---

# Mécaniques

Boucle de jeu et contrôles : le livré d'aujourd'hui. Découle de [[Vision]] ; le cadrage et le ton visuel viennent de [[Direction-Artistique]].

## Chargement

Au lancement, l'accueil s'affiche avant la clairière (`src/main.js`) : aucun décor 3D, HUD ni barre des tours n'est monté tant qu'un niveau n'est pas lancé, mais la boucle de rendu tourne. Parcours : accueil → campagne → jardin → difficulté → niveau ; « Retour », depuis la liste des jardins comme depuis le niveau, ramène à l'accueil **sans rechargement de page** (niveau détruit, progression locale intacte, compteur d'images toujours croissant). Dans le niveau, ce « Retour » vit dans la barre haute dédiée, ancrée en haut de l'écran à côté de la sève, et cette barre ne se replie jamais. L'URL accepte `?niveau=<levelId>` pour démarrer directement sur un niveau, accueil ignoré, et `?difficulty=<easy|medium|hard>` pour présélectionner le rythme.

## Accueil et difficultés

- 3 cartes de campagne, dans cet ordre : La Clairière de Sèveclaire (ouvrable), Les Brumes douces et La Rive lente (toutes deux « Bientôt disponible ») ; un clic sur une carte indisponible ne change ni l'écran ni l'état, et le badge reste affiché. La campagne principale ouvre ses 6 jardins nommés, seul le premier ouvert au premier lancement, chaque jardin terminé débloquant le suivant.
- Difficulté choisie sur la liste des jardins, avant « Commencer » : multiplicateur de vagues **0,75** (facile), **1** (moyen) ou **1,5** (difficile) ; il module le rythme des vagues du niveau, jamais le déblocage.
- Terminer un niveau écrit son id dans `localStorage`, clé `seveclaire.progress.v1`, au format `{ version: 1, completed: ["niveau-1", …] }` : ids uniques, ordre d'arrivée conservé. Clé absente, JSON corrompu ou stockage indisponible valent progression vide, sans erreur visible ; noms et valeurs exactes dans [[Campagnes-et-Difficultes]].

## Boucle principale

Dans un niveau lancé, le joueur fait le tour de la clairière à la caméra, choisit une graine dans la barre des tours-plantes toujours ouverte et la pose sur un emplacement, puis sélectionne une tour posée et l'améliore. Les vagues montent ensuite d'elles-mêmes : 8 s de répit, 6 vagues d'ombres apparues une à une depuis l'entrée sud et qui suivent le chemin, tir automatique des tours-plantes sans aucun clic, cœur à 12 PV. La partie s'achève sur une victoire calme ou une défaite sans punition, avec la vague atteinte et la durée : trois actions en victoire, deux en défaite (« Cœur et fin de partie »). Valeurs détaillées dans « Les petites ombres ».

## Tours-plantes

La barre est toujours ouverte, en bas à gauche de l'écran : aucun bouton ne l'ouvre ni ne la ferme, elle est là dès l'entrée dans le niveau et liste les deux graines avec leur prix en sève. Dès qu'une tour est sélectionnée, la rangée de graines cède la place à son niveau, au prix de son amélioration et au bouton « Améliorer » ; la sélection effacée, les deux graines reviennent. Le panneau est un aplat translucide unique, arrondi, posé sur le décor : aucun fond blanc entre ses boutons, aucun interstice clair ; les boutons se lisent côte à côte, séparés par leur propre contour et non par une bande de fond clair (barre permanente livrée avec #148).

| Graine | Pose | Amélioration 1 → 2 |
|---|---|---|
| Pousse (`sprout`) | 40 sève | 30 sève |
| Floraison (`bloom`) | 60 sève | 40 sève |

- Prix, coûts d'amélioration et niveau maximal (2) lus dans `src/data/towers.js` ; le joueur démarre avec 120 sève, la clairière offre 4 emplacements fixes de `src/data/level-1.js`, et la sève courante s'affiche en permanence dans la barre haute, à côté de « Retour », débitée à chaque pose ou amélioration.
- Économie fermée : 120 sève = trois Pousses, ou deux Pousses et une amélioration (110) ; une Pousse et une Floraison coûtent 100.
- Choisir une graine arme la pose (un fantôme de la tour flotte sur l'emplacement survolé) et désélectionne la tour en cours ; un clic sur un emplacement libre pose la tour et débite son prix. Pose refusée, sans aucune dépense : emplacement déjà occupé, clic hors emplacement, ou sève insuffisante.
- Un clic sur une tour posée la sélectionne, un marqueur au sol la désigne ; un clic hors d'une tour efface la sélection. « Améliorer » passe la tour du niveau 1 au niveau 2 et débite son prix, et reste inactif quand la sève manque ou que le niveau 2 est atteint.

## Les petites ombres

Valeurs de `src/data/level-1.js` (`windup`, `waves`, `heart`, `combat`, `arrival`) importées par `src/core/waves.js`, qui n'en porte aucune en dur : elles se règlent là. La silhouette ronde des ombres vient de [[Direction-Artistique]], le ton « victoire calme, défaite sans punition » de [[Vision]].

### Vagues

Huit secondes de répit (`windup`) avant la vague 1, puis les six entrées de `waves` s'enchaînent dans l'ordre. Une ombre apparaît à la fois depuis `arrival`, l'entrée sud du chemin (x 0, z 11) ; toutes marchent le long de la polyligne `path.points`, sans jamais en sortir. `count` (ombres), `hp` (PV par ombre), `speed` (m/s) et `gap` (s entre deux apparitions) viennent de chaque entrée de `waves`, jamais recopiés dans le code.

| Vague | Ombres | PV par ombre | Vitesse (m/s) | Espacement (s) |
|---|---|---|---|---|
| 1 | 4 | 6 | 0,45 | 2,4 |
| 2 | 4 | 7 | 0,47 | 2,2 |
| 3 | 5 | 7 | 0,49 | 2,0 |
| 4 | 5 | 8 | 0,51 | 1,8 |
| 5 | 6 | 8 | 0,53 | 1,6 |
| 6 | 7 | 8 | 0,55 | 1,4 |

### Tir automatique

| Tour | Portée | Cadence | Dégâts par tir |
|---|---|---|---|
| Pousse (`sprout`) | 3,8 m | 1,0 s | 2 PV |
| Floraison (`bloom`) | 3,8 m | 1,0 s | 4 PV |

- `combat.range` et `combat.cadence` sont communes aux deux tours ; `combat.damage[type]` donne les dégâts de chaque type.
- À chaque tir, chaque tour posée vise l'ombre non morte la plus avancée à ≤ `combat.range` et lui retire `combat.damage[type]`. Zéro clic : le joueur ne commande jamais le tir, il choisit seulement où poser et quoi améliorer. Une ombre à 0 PV est retirée de la scène.

### Cœur et fin de partie

- Le cœur a 12 PV (`heart.hp`, vie maximale) et `heart.damage` = 1 : chaque ombre qui l'atteint coûte exactement 1 PV et disparaît.
- Victoire quand la dernière ombre de la vague 6 est abattue ; défaite quand la vie du cœur tombe à 0. Une seule fin par partie.
- L'écran de fin est une modale plein cadre (`src/ui/wave-hud.js`) : titre « Victoire » ou « Défaite », vague atteinte, durée `mm:ss` ; le reste du HUD devient inerte tant qu'elle est ouverte.
- Actions de l'écran de fin — trois en victoire, deux en défaite — dans cet ordre :

| Fin | « Niveau suivant » | « Rejouer » | « Retour aux jardins » |
|---|---|---|---|
| Victoire | affiché, action principale (focus à l'ouverture) | affiché | affiché |
| Défaite | masqué **et** désactivé : hors boucle de tabulation et d'arbre d'accessibilité | affiché | affiché |

- Progression écrite **avant** toute relance ou réinitialisation : la victoire est enregistrée au moment où la partie se termine, avant l'affichage de la modale, sans attendre un clic. `markCompleted` est idempotent et ajoute l'id à `seveclaire.progress.v1` (`localStorage`).
- « Rejouer » ne peut donc rien effacer : `waves.restart()` remet cœur plein (12 PV), 120 sève, emplacements libres, vague 1 et durée à zéro, sans toucher à la progression. Une défaite n'écrit rien.
- La progression survit à `location.reload()` : au démarrage, `readProgress` relit `localStorage`, le jardin terminé reste terminé et le suivant reste déverrouillé. « Niveau suivant » monte directement le jardin suivant de la campagne, URL mise à jour en place (`?niveau=niveau-2&difficulty=<easy|medium|hard>`), sans accueil ni liste et sans rechargement ; au dernier jardin, retour à la liste. « Retour aux jardins » ferme le niveau et rouvre la liste des jardins de la campagne, le suivant déverrouillé, sans rechargement de page.

## Projectiles

- Naissance au **sommet de la tour** : `topY` relevé sur la boîte englobante de son maillage (`src/core/towers.js`), jamais une constante de hauteur ; le niveau 2 tire donc de plus haut (`src/core/waves.js`).
- Vol **≤ 0,35 s** : `cadence × rayon d'ombre` (1,0 s × 0,35) au plus, réduit proportionnellement à la distance dans les 3,8 m de portée ; trajectoire bombée de 0,35 unité, impact à 0,35 de hauteur.
- Baie facettée de 6 cm (`src/entities/projectile.js`) : 16 triangles, ni ombre portée ni réceptrice, matériau non tone-mappé. Sa teinte est celle de la tour, relevée sur son matériau : Pousse `#6ec6b5` (niv. 2 `#8bdccc`), Floraison `#c9a7d8` (niv. 2 `#d6bce1`).
- Marque d'impact : corail `#e8907f`, **0,5 s** de vie au plus, rayon 0,72 × l'échelle de l'événement, apparition en 75 ms puis plateau. Teinte fixe, jamais celle de la tour.

## Silhouettes

Trois profils attribués tour à tour à chaque apparition (ordre `ronde` → `haute` → `oreillue`) : dès la troisième ombre les trois cohabitent, et `state.enemies.silhouettes` ne redescend plus avant la vague suivante. `PROFILES` donne la boîte englobante en rayons (rayon 0,35 m au niveau 1).

| Profil | Largeur × hauteur (rayons) | En mètres (niv. 1) | Élément animé | Période |
|---|---|---|---|---|
| `ronde` | 2,00 × 1,16 | 0,70 × 0,41 | clignement des yeux | 0,9 s |
| `oreillue` | 1,55 × 2,22 | 0,54 × 0,78 | balancement des oreilles | 1,2 s |
| `haute` | 1,00 × 2,89 | 0,35 × 1,01 | marche des pattes | 0,6 s |

- Écarts de proportions : largeur −22 % (ronde ↔ oreillue), −50 % (ronde ↔ haute), −35 % (oreillue ↔ haute) ; hauteur +91 % puis +30 % : chaque paire diffère de plus de 15 %. Un seul élément animé par profil, déplacement ≤ 0,1 × rayon, période propre à chacun pour que trois silhouettes côte à côte ne battent jamais ensemble.

## Retours sensoriels

Cinq événements de `src/vfx/juice.js`, gerbe ≤ **0,15 s** chacun, deux draw calls au plus pour une gerbe et sa marque.

| Événement | Déclencheur | Particules | Marque | Secousse |
|---|---|---|---|---|
| `towerPlaced` | pose d'une tour | 9 | 0,9× | non |
| `shot` | impact d'un tir | 1 | 0,5× | non |
| `kill` | ombre repoussée | 14 | 1,1× | non |
| `heartDamage` | fuite au cœur | 1 | 1,35× | oui |
| `victory` | victoire | 18 | aucune | non |

- Micro-secousse : amplitude 0,05 unité (× 0,42 en x, × 0,8 en y, soit ≤ 0,045 par axe) et **180 ms** ; la caméra borne chaque axe à 0,06. Jamais cumulée : l'enveloppe repart de zéro à chaque déclenchement et la caméra relit l'offset de l'image courante, sans additionner deux secousses.

## Facteurs de vitesse

- `game.state.speed` ne vaut que **1**, **2** ou **3** : `dt = dt réel × facteur` pour toutes les entités, donc cadence de tir, compte à rebours, marche des ombres et fondus suivent le même facteur.
- Retour à **×1** : à l'ouverture de chaque jardin (`mountLevel`), à la sortie du niveau (`stopLevel`) et à chaque « Rejouer », avant `waves.restart()`. Pastille en haut à droite, trois cibles de 44 × 44 px (`aria-pressed`), touches 1/2/3 et pavé numérique ; elle reflète `state.speed` à chaque image et ne décide de rien.

## Contrôles

| Action | Souris | Tactile |
|---|---|---|
| Regarder la clairière | glisser, bouton gauche maintenu | glisser un doigt |
| Choisir une graine | clic sur Pousse ou Floraison | toucher Pousse ou Floraison |
| Poser une tour | clic sur un emplacement libre | toucher un emplacement libre |
| Sélectionner une tour | clic sur la tour posée | toucher la tour posée |
| Améliorer une tour | clic sur « Améliorer » | toucher « Améliorer » |
| Choisir la vitesse | clic sur ×1, ×2 ou ×3 | toucher ×1, ×2 ou ×3 |
| Rejouer | clic sur « Rejouer » | toucher « Rejouer » |

- Aucun geste n'ouvre ni ne ferme l'interface : la barre des tours reste déployée en bas à gauche et la barre haute ne se replie pas.
- Le tir est automatique : aucune commande de tir, ni souris ni tactile. La caméra ne change pas : choisir, poser, sélectionner et améliorer sont des appuis sur place, et un déplacement de plus de 6 px entre l'appui et le relâchement reste un glissement de caméra, jamais une pose.
- Clavier : seules les touches 1/2/3 (pavé numérique compris) choisissent la vitesse ; ni ZQSD, ni flèches, ni raccourci de pose. Le clavier annoncé dans le cadre de [[Vision]] reste un objectif, pas un contrôle de caméra.
- Aucun zoom imposé : molette et pincement ne changent pas la distance de caméra ; le glissement fait orbiter la caméra autour de la cible et s'arrête net aux bornes ci-dessous.

## Caméra niveau 1

Bornes retenues et leur origine, lues dans `src/data/level-1.js` (`LEVEL_1.camera`) — le code de la caméra les importe, il ne les recopie pas :

| Réglage | Valeur | Rôle |
|---|---|---|
| `yaw` | -0,45 à 0,45 rad | rotation horizontale autour de la cible ; 0 place la caméra au sud de la cible, tournée vers le cœur ; l'arrivée reste hors cadre |
| `pitch` | 0,72 à 1,05 rad | élévation, de la vue la moins plongeante à la plus verticale |
| `distance` | 14 à 20 unités (m) | rayon orbital ; la caméra démarre au milieu, à 17 |
| `pan` | 2,5 unités | garde-fou : la cible ne s'écarte jamais de plus de 2,5 unités du centre (0, -2) |

- Le cadre ne sort jamais de `bounds` + `skirt` du décor (`minX -16`, `maxX 16`, `minZ -20`, `maxZ 12`, `skirt 6`), soit x ∈ [-22, 22] et z ∈ [-26, 18].
- Si les quatre coins de l'écran sortent de ce sol décoré pour une combinaison des bornes, la caméra resserre son champ de vision au lieu de montrer le vide. La cible est bornée au pan, puis recalée automatiquement pour garder le sol dans le cadre : aucune vue ne montre le vide.
