---
tags: [gdd]
status: validated
updated: 2026-11-09
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

## Lumière & effets
- Lumière de fin d’après-midi, chaude et rasante, comme une clairière au soleil couchant.
- Ombres douces, larges et peu contrastées, jamais dures ni découpées au couteau.
- Bloom réservé aux éléments interactifs (plantes-défenses, récompenses) ; le décor reste mat.

## Animation
- Mouvements feutrés : respirations lentes, balancements de feuillage, transitions en easing doux.
- Aucun shake agressif d’écran ; les impacts se lisent par un léger rebond et une variation de couleur.

## Interdits
- Dégradés criards et contrastes saturés qui cassent le calme.
- Réalisme photo et textures photographiques.
- Texte dans les images : tout texte passe par l’interface localisée.

## Son

Ton apaisant comme le reste de la clairière : synthés doux (nappes, cloches feutrées), percussion légère (bois, peaux, pas de batterie sèche). Aucun son ne doit surprendre le joueur en pause. Découle de [[Vision]] : « Sérénité d’abord ».

Trois effets nommés, seuls indispensables au lancement :

| Effet | Rôle | Caractère |
|---|---|---|
| « poser une tour » | Confirmer une plante-défense | Cloche douce, une note montante, 200 ms |
| « vague » | Annoncer l’arrivée des ombres | Nappe descendante discrète, 1 s, sans urgence |
| « victoire » | Clore un niveau | Trois notes de harpe montantes, récompense calme |

- Volume par défaut : **40 %**, jamais plus de **50 %** à la première ouverture ; le joueur ajuste ensuite.
- Ambiance de fond coupée par défaut sur mobile ; effets toujours audibles.
- Un son d’impact ne se répète pas plus de 3 fois par seconde (pas de mitraillette sonore).

## i18n

Deux langues : **FR** (source, rédigé en premier) et **EN** (traduction fidèle du ton, pas du mot à mot). Fichiers `src/i18n/fr.json` et `src/i18n/en.json`, clés identiques.

- **Tutoiement** du joueur en FR : « tu » et « ton jardin », jamais « vous ». Le ton cosy reste celui de [[Univers]], sans jargon militaire.
- **Libellé de bouton ≤ 20 caractères**, verbe d’abord : « Poser », « Reprendre », « Niveau suivant ».
- Les noms propres (Sèveclaire, gardien) ne se traduisent pas.
- Rappel de l’interdit visuel : **aucun texte dans les images**, tout passe par ces fichiers localisés.
