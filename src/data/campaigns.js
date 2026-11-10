/**
 * Campagnes et jardins, en données pures (aucun import, aucun calcul exécuté).
 * Trois campagnes dans l'ordre d'affichage : Sèveclaire jouable, les deux autres visibles
 * mais verrouillées (« bientôt disponible », cf. vault/GDD/Vision.md, cadre).
 * Les six jardins de Sèveclaire pointent chacun leur carte assemblée : `level-1` pour le
 * seuil, `level-2` à `level-6` pour les jardins suivants ; seuls ids et `nameKey` changent.
 * Tous les libellés vivent uniquement dans les clés i18n de `nameKey` / `descriptionKey`.
 */
export const CAMPAIGNS = [
  {
    id: 'seveclaire',
    nameKey: 'campaign.seveclaire.name',
    descriptionKey: 'campaign.seveclaire.desc',
    available: true,
    levels: [
      { id: 'niveau-1', nameKey: 'campaign.seveclaire.level.1.name', map: 'level-1' },
      { id: 'niveau-2', nameKey: 'campaign.seveclaire.level.2.name', map: 'level-2' },
      { id: 'niveau-3', nameKey: 'campaign.seveclaire.level.3.name', map: 'level-3' },
      { id: 'niveau-4', nameKey: 'campaign.seveclaire.level.4.name', map: 'level-4' },
      { id: 'niveau-5', nameKey: 'campaign.seveclaire.level.5.name', map: 'level-5' },
      { id: 'niveau-6', nameKey: 'campaign.seveclaire.level.6.name', map: 'level-6' },
    ],
  },
  {
    id: 'brumes',
    nameKey: 'campaign.brumes.name',
    descriptionKey: 'campaign.brumes.desc',
    available: false,
    levels: [],
  },
  {
    id: 'rive',
    nameKey: 'campaign.rive.name',
    descriptionKey: 'campaign.rive.desc',
    available: false,
    levels: [],
  },
]

/** Campagne dont l'id correspond, ou null. */
export function findCampaign(campaignId) {
  return CAMPAIGNS.find((campaign) => campaign.id === campaignId) ?? null
}

/** Jardin et campagne qui le contient, avec son rang dans la campagne, ou null. */
export function findLevel(levelId) {
  for (const campaign of CAMPAIGNS) {
    const index = campaign.levels.findIndex((level) => level.id === levelId)
    if (index !== -1) return { campaign, level: campaign.levels[index], index }
  }
  return null
}
