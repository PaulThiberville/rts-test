---
tags: [gdd]
status: validated
updated: 2026-11-10
---

# Direction artistique

Référence unique pour textureur, illustrateur, VFX et UI. Découle de [[Vision]] et [[Univers]] : un jardin cosy, mignon et zen, lisible sur mobile.

## Palette

| Rôle | Hex | Usage |
|---|---|---|
| Fond | `#faf3e3` | Ciel et sol de la clairière, aube douce |
| Primaire (joueur) | `#6ec6b5` | Plantes-défenses et éléments du gardien |
| Danger | `#e8907f` | Ombres hostiles et alertes |
| Récompense | `#f2c66d` | Butin, étoiles et gains de niveau |
| Texte | `#3e4a43` | Texte d’interface sur fond clair |

Teintes pastel, désaturées, jamais fluo : chaque rôle reste reconnaissable d’un coup d’œil, même sur petit écran. Une seule teinte par type de plante-défense (pilier « Mignon et lisible » de [[Vision]]).

### Contraste texte / fond

Calculé selon la luminance relative sRGB : canal linéarisé `c/12.92` si `c ≤ 0.04045`, sinon `((c+0.055)/1.055)^2.4` ; `L = 0.2126·R + 0.7152·G + 0.0722·B` ; ratio `(L1+0.05)/(L2+0.05)`.

- `#faf3e3` → L = 0.8997
- `#3e4a43` → L = 0.0633
- Ratio Texte/Fond = **8.38:1**, au-dessus du seuil WCAG AA de 4.5:1. Recalculable par script sur ces deux hex.

## Formes & style
- Formes rondes et silhouettes lisibles : aucune arête agressive sur les habitants du jardin.
- Low-poly assumé, facettes douces, une seule forme par type de plante-défense.
- Aplats de couleur unis, éventuellement ombrés en douceur ; pas de textures photo.

Quatre familles de végétaux instanciées, une teinte dominante par famille, prise dans `LEVEL_1.palette` :

| Famille | Silhouette | Teinte | Échelle | Rôle dans la clairière |
|---|---|---|---|---|
| Arbre (`tree`) | Tronc sombre, houppier rond en quatre lobes | `#8fb99a` | 0,85–1,3 | 26 instances : cadre le fond de la clairière, ne masque jamais le chemin |
| Buisson (`bush`) | Cinq lobes bas et larges, base au sol | `#b7d3ac` | 0,6–1,2 | 40 instances : masses de bord de chemin, jamais devant un emplacement de pose |
| Fleur (`flower`) | Tige fine, deux feuilles, corolle de cinq pétales et cœur `#e3d4f0` | `#edb8c6` | 0,7–1,2 | 90 instances : accent de premier plan, plus petit détail lisible |
| Graminée (`grass`) | Touffe de douze lames courbées, pointe `#c2c083` | `#a9c8a0` | 0,7–1,4 | 1 200 instances : tapis de sol, comble les vides sans les meubler |

- Une famille = une géométrie = un draw call ; la variation vient de l’échelle, de la rotation et de la teinte d’instance (bornée entre − 22 % et + 30 %), jamais d’un nouveau maillage.
- Les accents internes (`flowerAlt`, `grassTall`, `stem`) restent dans la famille : contraste doux, pas de saut de teinte.

## Lumière & effets
- Lumière de fin d’après-midi, chaude et rasante, comme une clairière au soleil couchant.
- Ombres douces, larges et peu contrastées, jamais dures ni découpées au couteau.
- Bloom réservé aux éléments interactifs (plantes-défenses, récompenses) ; le décor reste mat.

Valeurs de référence, reprises de `LEVEL_1.light` par le module de lumière :

| Paramètre | Valeur | Effet |
|---|---|---|
| `sun` | `#f6d9a8` | Directionnelle chaude, teinte du soleil bas |
| `sky` | `#faf3e3` | Hémisphérique, dôme céleste (identique à `palette.sky`) |
| `ground` | `#b9c4ab` | Hémisphérique, rebond du sol : plus sombre que `palette.ground`, c’est un éclairage, pas le sol |
| `intensity` | 2,1 | Soleil franc mais jamais écrasant |
| `elevation` | 0,62 rad (~35°) | Soleil rasant : ombres longues et lisibles |
| `azimuth` | 0,85 rad (~49°) | Soleil de côté, la clairière reste modelée |
| `shadowRadius` | 4 | Pénombre large, bords d’ombre flous |
| `shadowMapSize` | 1024 | Précision suffisante pour la clairière, budget mobile respecté |

- Type d’ombre : `PCFSoftShadowMap`, valeur de référence à câbler sur le renderer par le module de lumière (#96) ; aucune ombre dure, aucun `BasicShadowMap`.
- Règle : **≥ 80 % des végétaux projettent une ombre** (`castShadow = true`), critère du ticket #96, à mesurer par `vegetalsCastShadow / vegetalsTotal ≥ 0,8`. Le sol et le chemin la reçoivent (`receiveShadow = true`), activation prévue par #96.

### Ambiance

Deux familles de particules seulement, purement visuelles : elles ne pèsent pas sur la boucle de jeu.

| Famille | Densité | Mouvement | Teintes |
|---|---|---|---|
| Pétales | 60 | Chute 0,1–0,24 m/s, dérive latérale ± 0,3–0,85 m, lente oscillation | `#f0d6de`, `#e6bacb`, `#f3dce6` |
| Lucioles | 24 | Orbite de 0,3–0,9 m, 0,12–0,3 rad/s, flottement vertical 0,08–0,16 m | `#f2c66d` |

- **Discret, jamais bloquant pour les entrées joueur** : aucun écouteur, aucun raycast, aucun élément d’interface ; les particules passent derrière le HUD et ne masquent ni le chemin, ni un emplacement, ni le cœur.
- Aucune apparition à moins de `heart.radius + 1,6 m` du cœur ; `update(dt)` ne fait aucune allocation.
- Budget : **≤ 300 draw calls, ≤ 500 000 triangles, p95 ≤ 16,7 ms** en 390×844. L’ambiance ajoute exactement 2 draw calls.

Ces familles, valeurs de lumière et densités d’ambiance sont la référence des futurs décors : chaque niveau suivant garde la même structure et ne change que les teintes et les densités, sans sortir du budget. Toute évolution part de [[Vision]] (« Mignon et lisible », « Sérénité d’abord »).

## Animation
- Mouvements feutrés : respirations lentes, balancements de feuillage, transitions en easing doux.
- Aucun shake agressif d’écran ; les impacts se lisent par un léger rebond et une variation de couleur.

## Interdits
- Dégradés criards et contrastes saturés qui cassent le calme.
- Réalisme photo et textures photographiques.
- Texte dans les images : tout texte passe par l’interface localisée.

## Son

Ton apaisant comme le reste de la clairière : synthés doux (nappes, cloches feutrées), percussion légère (bois, peaux, pas de batterie sèche). Aucun son ne doit surprendre le joueur en pause. Découle de [[Vision]] : « Sérénité d’abord », et ne sonorise que les gestes de [[Mecaniques]].

Trois effets à livrer pour l’Epic #48, plus « victoire » déjà validée :

| Effet | Rôle | Caractère |
|---|---|---|
| « poser une plante-défense » (« poser une tour ») | Confirmer la pose d’une tour-plante | Cloche douce, une note montante, 200 ms |
| « vague » | Annoncer l’arrivée des ombres | Nappe descendante discrète, 1 s, sans urgence |
| « ombre repoussée » | Confirmer qu’une ombre recule | Cloche feutrée, durée ≤ 1 s, aucune urgence |
| « victoire » | Clore un niveau | Trois notes de harpe montantes, récompense calme |

- Volume par défaut : 40 %, jamais plus de 50 % à la première ouverture ; le joueur ajuste ensuite.
- Règle des impacts : ≤ 3 fois par seconde, pas de mitraillette sonore.

### Silence et muet

Le bouton muet est atteignable au clavier (Tab puis Entrée ou Espace) et porte un libellé localisé. Muet, le gain master tombe à zéro et le jeu laisse place au silence, compris comme le jardin qui respire : aucune nappe, aucun effet. Un second appui rétablit exactement le volume précédent. Sur mobile, l’ambiance de fond est coupée par défaut ; les effets restent audibles tant que le joueur ne coupe pas le son.

## i18n

Deux langues : **FR** (source, rédigé en premier) et **EN** (traduction fidèle du ton, pas du mot à mot). Fichiers `src/i18n/fr.json` et `src/i18n/en.json`, clés identiques.

- **Tutoiement** du joueur en FR : « tu » et « ton jardin », jamais « vous ». Le ton cosy reste celui de [[Univers]], sans jargon militaire.
- **Libellé de bouton ≤ 20 caractères**, verbe d’abord : « Poser », « Reprendre », « Niveau suivant ».
- Les noms propres (Sèveclaire, gardien) ne se traduisent pas.
- Rappel de l’interdit visuel : **aucun texte dans les images**, tout passe par ces fichiers localisés.
