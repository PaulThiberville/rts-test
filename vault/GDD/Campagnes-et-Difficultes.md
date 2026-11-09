---
tags: [gdd]
status: validated
updated: 2026-11-09
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

## Difficultés

| id | Nom FR | `multiplier` |
|---|---|---|
| `easy` | Facile | 0.75 |
| `medium` | Moyen | 1 |
| `hard` | Difficile | 1.5 |

En français : **0,75 / 1 / 1,5**. Ce nombre module le rythme des vagues du niveau, jamais le déblocage.
