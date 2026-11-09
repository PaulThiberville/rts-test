---
tags: [gdd]
status: validated
updated: 2026-11-09
---

# Vision

Tower-defense cosy et zen : le joueur garde un jardin paisible, en solo, dans le navigateur.
Direction : mignon, calme et très travaillé visuellement. Voir [[Mecaniques]] et [[Univers]].

## Pitch

Dans la Clairière de Sèveclaire, vous êtes le gardien d'un jardin paisible qui repousse les petites ombres sans jamais perdre son calme.

## Piliers de design

1. **Sérénité d'abord** — Aucune vague ne punit une pause : le joueur observe, respire et ajuste son jardin à son rythme. Décision : 8 secondes de répit entre deux vagues et reprise immédiate d'un niveau perdu, sans pénalité.
2. **Mignon et lisible** — Chaque habitant du jardin a une silhouette ronde et une couleur propre, reconnaissable d'un coup d'œil même sur un écran de téléphone. Décision : une seule forme et une seule teinte par type de plante-défense, sans texte flottant sur le terrain.
3. **Petites sessions, vraie progression** — Une partie de 5 à 10 min doit laisser une trace concrète, pour donner envie d'y revenir sans pression. Décision : sauvegarde locale après chaque niveau et progression débloquée immédiatement au retour.

## Cadre

- **Mode** : solo contre des IA, en navigateur desktop & mobile (souris, clavier ou tactile).
- **Durée** : parties de 5 à 10 min, sauvegarde locale entre deux sessions.
- **Campagnes** : une campagne principale de 6 niveaux, plus 2 campagnes affichées « bientôt disponible » (visibles, verrouillées).
- **Difficulté** : trois profils d'IA facile/moyen/difficile, choisis avant chaque niveau.

## Contraintes

- Jouable dans un navigateur, sans installation, hébergé sur GitHub Pages (chemins d'assets relatifs).
- Zéro serveur à maintenir : le multijoueur éventuel reste en P2P, cf. [[Reseau]].
- Budget léger : la clairière doit tenir sur mobile, textures et modèles compris.
