/**
 * Jeu d'icônes de l'interface de niveau, construites par DOM (createElementNS).
 *
 * Chaque SVG produit est un `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">`
 * dont le trait est `#3e4a43` (stroke-width 1.8, bouts et jonctions ronds, fill none) et dont
 * les accents sont des `fill` pris dans la palette : `#6ec6b5` primaire, `#f2c66d` récompense,
 * `#e8907f` danger, `#faf3e3` fond. Aucun bitmap, aucune balise image, aucun dégradé.
 *
 * Le dessin laisse au moins 1 px de marge dans le viewBox : rien n'est coupé au bord,
 * le rendu reste net à 24 px comme à 256 px.
 */

const SVG_NS = 'http://www.w3.org/2000/svg'

const INK = '#3e4a43'
const PRIMARY = '#6ec6b5'
const REWARD = '#f2c66d'
const DANGER = '#e8907f'
const PAPER = '#faf3e3'

/** @type {Record<string, ReadonlyArray<[string, Record<string, string>]>>} */
const ICONS = {
  // Goutte de sève : goutte pleine, ventre rond, reflet de fond.
  sap: [
    ['path', { d: 'M12 3.6c-2.5 3.8-6.4 7-6.4 11a6.4 6.4 0 0 0 12.8 0c0-4-3.9-7.2-6.4-11Z', fill: PRIMARY }],
    ['ellipse', { cx: '9.3', cy: '14.5', rx: '1.1', ry: '1.5', fill: PAPER, stroke: 'none' }],
  ],

  // Cœur arrondi, lobes pleins et pointe molle.
  heart: [
    [
      'path',
      {
        d: 'M12 20.4s-7.8-4.8-7.8-10c0-2.4 2-4.1 4.4-4.1 1.5 0 2.7.8 3.4 2 .7-1.2 1.9-2 3.4-2 2.4 0 4.4 1.7 4.4 4.1 0 5.2-7.8 10-7.8 10Z',
        fill: DANGER,
      },
    ],
    ['ellipse', { cx: '8.4', cy: '10.6', rx: '1', ry: '1.3', fill: PAPER, stroke: 'none' }],
  ],

  // Germe : tige dressée, deux feuilles pleines, la haute à droite.
  seed: [
    ['path', { d: 'M12 20.4V8.6' }],
    ['path', { d: 'M12 12.2C12.4 9.1 14.6 6.6 18.2 6.2c.3 3.1-1.9 5.7-6.2 6Z', fill: PRIMARY }],
    ['path', { d: 'M12 15.6C11.6 12.5 9.4 10.6 6.2 10.2c-.3 3.1 1.9 5.5 5.8 5.4Z', fill: PRIMARY }],
  ],

  // Flèche montante de récompense : pointe pleine, hampe franche.
  upgrade: [
    ['path', { d: 'M12 4.1 17.5 10.7H6.5L12 4.1Z', fill: REWARD }],
    ['path', { d: 'M12 10.2v9.1' }],
  ],

  // Haut-parleur sonore : cône plein arrondi et deux ondes.
  sound: [
    [
      'path',
      {
        d: 'M11.4 4.9c.5-.4 1.2-.1 1.2.5v13.2c0 .6-.7.9-1.2.5L6.6 15.7H4c-.6 0-1-.5-1-1.1V9.4c0-.6.4-1.1 1-1.1h2.6l4.8-3.4Z',
      },
    ],
    ['path', { d: 'M15.3 9.2c1.4 1.6 1.4 4.4 0 6' }],
    ['path', { d: 'M18 6.6c2.7 3 2.7 7.8 0 10.8' }],
  ],

  // Haut-parleur muet : même cône, onde barrée d'une croix nette à sa place.
  'sound-muted': [
    [
      'path',
      {
        d: 'M11.4 4.9c.5-.4 1.2-.1 1.2.5v13.2c0 .6-.7.9-1.2.5L6.6 15.7H4c-.6 0-1-.5-1-1.1V9.4c0-.6.4-1.1 1-1.1h2.6l4.8-3.4Z',
      },
    ],
    ['path', { d: 'M14.6 8.4 20.9 15.6' }],
    ['path', { d: 'M14.6 15.6 20.9 8.4' }],
  ],

  // Chevron gauche du retour, un peu plus gras pour rester lisible à 24 px.
  back: [['path', { d: 'M15.9 4.9 8.1 12l7.8 7.1', 'stroke-width': '2' }]],
}

/** Noms des icônes disponibles, dans l'ordre de la planche. */
export const ICON_NAMES = ['sap', 'heart', 'seed', 'upgrade', 'sound', 'sound-muted', 'back']

/**
 * @param {string} name
 * @returns {boolean} vrai si `createIcon` dessine une icône pour ce nom.
 */
export function hasIcon(name) {
  return Object.prototype.hasOwnProperty.call(ICONS, name)
}

/**
 * Construit l'icône demandée. Un nom inconnu renvoie un SVG vide aux mêmes attributs,
 * jamais une exception : l'appelant peut toujours l'insérer.
 * @param {string} name
 * @param {{ size?: number, className?: string }} [options]
 * @returns {SVGSVGElement}
 */
export function createIcon(name, { size = 20, className = '' } = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg')
  const side = String(size)
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', side)
  svg.setAttribute('height', side)
  svg.setAttribute('class', className)
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('stroke', INK)
  svg.setAttribute('stroke-width', '1.8')
  svg.setAttribute('stroke-linecap', 'round')
  svg.setAttribute('stroke-linejoin', 'round')

  // Le garde `hasIcon` évite qu'un nom hérité d'Object (`toString`, `__proto__`) ne soit lu ici.
  const shapes = hasIcon(name) ? ICONS[name] : null
  if (!shapes) return svg

  for (const [tag, attrs] of shapes) {
    const node = document.createElementNS(SVG_NS, tag)
    for (const key in attrs) node.setAttribute(key, attrs[key])
    svg.append(node)
  }
  return svg
}
