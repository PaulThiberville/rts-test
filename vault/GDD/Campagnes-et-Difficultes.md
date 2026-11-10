---
tags: [gdd]
status: validated
updated: 2026-11-10
---

# Campagnes et difficultés

Valeurs recopiées de `src/data/campaigns.js` et `src/data/difficulties.js`, jamais recalculées. Cadre : [[Vision]] ; parcours et sauvegarde : [[Mecaniques]].

## Campagnes

`seveclaire` est ouvrable ; `brumes` et `rive` restent « bientôt disponible » et ne lancent rien, dans cet ordre d'affichage.

## Jardins de Sèveclaire

Campagne `seveclaire`, 6 niveaux dans l'ordre de `levels` :

| id | Nom FR |
|---|---|
| `niveau-1` | Le Seuil |
| `niveau-2` | Les Premiers Semis |
| `niveau-3` | Le Bosquet clair |
| `niveau-4` | La Fontaine tiède |
| `niveau-5` | Les Haies vives |
| `niveau-6` | Le Cœur de Sève |

Libellés affichés : `campaign.seveclaire.level.<1..6>.name` (`src/i18n/fr.json`).

Cartes assemblées (`src/data/level-<1..6>.js`), du seuil au cœur de sève : les six jardins se resserrent, la densité ne redescend jamais et le sol s'assombrit par paliers lisibles. Cadre : [[Vision]], [[Direction-Artistique]] ; pose des tours : [[Mecaniques]].

| id de carte | Nom FR | Sol (`palette.ground`) | Heure (`light.hour`) | Densité hors graminées (instances/m²) |
|---|---|---|---|---|
| `niveau-1-clairiere` | Le Seuil | `#faf3e3` | 17.5 | 0,15 |
| `niveau-2-premiers-semis` | Les Premiers Semis | `#f1ecd6` | 9.5 | 0,16 |
| `niveau-3-bosquet-clair` | Le Bosquet clair | `#eaefd8` | 10.5 | 0,18 |
| `niveau-4-fontaine-tiede` | La Fontaine tiède | `#f6efdd` | 15.5 | 0,19 |
| `niveau-5-haies-vives` | Les Haies vives | `#e4ebd4` | 16.5 | 0,21 |
| `niveau-6-coeur-de-seve` | Le Cœur de Sève | `#d7e1c6` | 7.5 | 0,28 |

Densité = `stats.density.total` de `src/entities/vegetation.js` (arbres + buissons + fleurs ÷ surface de `bounds` sans `skirt`), arrondie à 2 décimales. Heures recopiées telles quelles, point décimal. Seul ressaut de sol : la carte 4 (`#f6efdd`) éclaircit sur la carte 3 (`#eaefd8`), avant la reprise de la descente.

## Difficultés

| id | Nom FR | `multiplier` |
|---|---|---|
| `easy` | Facile | 0.75 |
| `medium` | Moyen | 1 |
| `hard` | Difficile | 1.5 |

En français : **0,75 / 1 / 1,5**. Ce nombre module le rythme des vagues du niveau, jamais le déblocage.
