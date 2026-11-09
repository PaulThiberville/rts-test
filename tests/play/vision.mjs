// Playtest de l'Epic #1 : Vision + Direction artistique.
// Chaque critère d'acceptation de l'Epic est asservi sur les deux notes du Vault,
// lues depuis Node (le scénario tourne dans le runner, pas dans la page).
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const VISION = fileURLToPath(new URL('../../vault/GDD/Vision.md', import.meta.url))
const DA = fileURLToPath(new URL('../../vault/GDD/Direction-Artistique.md', import.meta.url))

// Minuscules, sans accents, apostrophes typographiques et espaces insécables ramenés à l'ASCII.
const norm = (s) => s
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[\u2018\u2019\u02bc]/g, "'")
  .replace(/[\u00a0\u202f]/g, ' ')
  .toLowerCase()
const frontmatter = (md) => {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  return m ? m[1] : ''
}
const section = (md, title) => {
  const re = new RegExp(`^##\\s+${title}\\s*$`, 'im')
  const m = re.exec(md)
  if (!m) return null
  const rest = md.slice(m.index + m[0].length)
  const end = rest.search(/^#{1,2}\s/m)
  return end === -1 ? rest : rest.slice(0, end)
}
const words = (s) => s.trim().split(/\s+/).filter(Boolean).length

// Contraste WCAG AA recalculé ici, indépendamment du chiffre annoncé dans la note.
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

// Ligne du tableau Palette portant ce rôle, ex. « | Fond | `#faf3e3` | ... ».
function paletteHex(md, role) {
  const wanted = norm(role)
  for (const line of md.split(/\r?\n/)) {
    if (!/^\s*\|/.test(line) || !/`#[0-9a-f]{6}`/i.test(line)) continue
    const cells = line.split('|').map((c) => c.trim())
    const label = norm(cells[1] ?? '')
    if (label.includes(wanted)) return line.match(/`(#[0-9a-f]{6})`/i)[1].toLowerCase()
  }
  return null
}

export default async function ({ assert, shot }) {
  const [vision, da] = await Promise.all([readFile(VISION, 'utf8'), readFile(DA, 'utf8')])
  const visionN = norm(vision)
  const daN = norm(da)

  // Critère 1 : les deux notes sont validées et datées, et le pitch tient en une phrase
  // nommant la clairière/jardin, le gardien et l'absence de stress.
  for (const [name, md] of [['Vision', vision], ['Direction-Artistique', da]]) {
    const fm = frontmatter(md)
    assert(/^status:\s*validated\s*$/m.test(fm), `critère 1 : ${name}.md doit être status: validated`)
    assert(/^updated:\s*\d{4}-\d{2}-\d{2}\s*$/m.test(fm), `critère 1 : ${name}.md doit porter un champ updated: daté`)
  }
  const pitch = section(vision, 'Pitch')
  assert(pitch && pitch.trim(), 'critère 1 : section « ## Pitch » absente de Vision.md')
  assert(words(pitch) <= 25, `critère 1 : pitch de ${words(pitch)} mots, maximum 25`)
  const pitchN = norm(pitch)
  assert(/clairiere|jardin/.test(pitchN), 'critère 1 : le pitch ne nomme ni la clairière ni le jardin')
  assert(/gardien/.test(pitchN), 'critère 1 : le pitch ne nomme pas le rôle de gardien')
  assert(/calme|sans stress|serein|paisible/.test(pitchN), 'critère 1 : le pitch n\'évoque pas l\'absence de stress')

  // Critère 2 : exactement 3 piliers, chacun avec une décision concrète qui en découle.
  const pillarsSec = section(vision, 'Piliers de design')
  assert(pillarsSec !== null, 'critère 2 : section « ## Piliers de design » absente')
  const pillars = pillarsSec.split(/\r?\n/).filter((l) => /^\s*\d+[.)]\s+/.test(l))
  assert(pillars.length === 3, `critère 2 : ${pillars.length} pilier(s) numéroté(s), exactement 3 attendus`)
  pillars.forEach((p, i) => {
    const n = i + 1
    assert(/decision\s*:/.test(norm(p)), `critère 2 : pilier ${n} sans exemple de décision (« Décision : »)`)
    assert(p.replace(/^\s*\d+[.)]\s+/, '').trim().length > 40, `critère 2 : pilier ${n} sans phrase de développement`)
  })

  // Critère 3 : cadre de jeu complet (solo, desktop & mobile, 5 à 10 min, 6 niveaux,
  // 2 campagnes « bientôt disponible », IA facile/moyen/difficile).
  const frameSec = section(vision, 'Cadre')
  assert(frameSec !== null, 'critère 3 : section « ## Cadre » absente')
  const frame = norm(frameSec)
  assert(/solo/.test(frame), 'critère 3 : le mode solo n\'est pas documenté')
  assert(/desktop/.test(frame) && /mobile/.test(frame), 'critère 3 : navigateur desktop & mobile non documentés')
  assert(/5\s*a\s*10\s*min/.test(frame), 'critère 3 : durée de partie 5 à 10 min absente')
  assert(/campagne[^.\n]*\b6\s*niveaux/.test(frame), 'critère 3 : campagne de 6 niveaux absente')
  assert(/\b2\s*campagnes/.test(frame) && /bientot disponible/.test(frame), 'critère 3 : les 2 campagnes « bientôt disponible » sont absentes')
  assert(/facile\s*\/\s*moyen\s*\/\s*difficile/.test(frame), 'critère 3 : profils d\'IA facile/moyen/difficile absents')

  // Critère 4 : palette nommée à 5 rôles en hex pastel, #1d2433 banni, contraste ≥ 4.5:1 recalculé.
  for (const role of ['fond', 'primaire', 'danger', 'recompense', 'texte']) {
    assert(paletteHex(da, role) !== null, `critère 4 : rôle de palette « ${role} » absent ou sans hex`)
  }
  assert(!/#1d2433/i.test(da), 'critère 4 : la palette sombre #1d2433 est toujours présente dans Direction-Artistique.md')
  assert(!/#1d2433/i.test(vision), 'critère 4 : #1d2433 traîne aussi dans Vision.md')
  const bg = paletteHex(da, 'fond')
  const fg = paletteHex(da, 'texte')
  const ratio = contrast(bg, fg)
  assert(ratio >= 4.5, `critère 4 : contraste texte ${fg} / fond ${bg} = ${ratio.toFixed(2)}:1, minimum 4.5:1`)

  // Critère 5 : formes, lumière, animation et liste d'interdits fixées dans la même note.
  assert(/formes? rondes?/.test(daN), 'critère 5 : formes rondes absentes')
  assert(/low-poly/.test(daN), 'critère 5 : style low-poly absent')
  assert(/aplats?/.test(daN), 'critère 5 : aplats de couleur absents')
  assert(/fin d'?apres-midi/.test(daN), 'critère 5 : lumière de fin d\'après-midi absente')
  assert(/ombres? douces?/.test(daN), 'critère 5 : ombres douces absentes')
  assert(/feutre/.test(daN), 'critère 5 : animation feutrée absente')
  // Négation liée à « shake » : une note qui prescrirait un shake agressif doit échouer.
  assert(/(?:aucun|sans|pas de)\s+shake/.test(daN), 'critère 5 : absence de shake agressif non documentée')
  assert(/degrad\w* criards?/.test(daN), 'critère 5 : interdit « dégradés criards » absent')
  assert(/realisme photo/.test(daN), 'critère 5 : interdit « réalisme photo » absent')
  assert(/texte dans les images/.test(daN), 'critère 5 : interdit « texte dans les images » absent')

  // Critère 6 : Son apaisant, 3 exemples nommés, volume par défaut ≤ 50 %.
  const sonSec = section(da, 'Son')
  assert(sonSec !== null, 'critère 6 : section « ## Son » absente')
  const son = norm(sonSec)
  assert(/apaisant|apaise|calme/.test(son), 'critère 6 : le ton sonore apaisant n\'est pas posé')
  for (const fx of ['poser une tour', 'vague', 'victoire']) {
    assert(son.includes(fx), `critère 6 : exemple sonore « ${fx} » absent`)
  }
  const vol = son.match(/volume par defaut\s*:\s*\*{0,2}\s*(\d{1,3})\s*%/)
  assert(vol !== null, 'critère 6 : volume par défaut chiffré absent')
  assert(Number(vol[1]) <= 50, `critère 6 : volume par défaut ${vol[1]} %, maximum 50 %`)

  // Critère 6 (suite) : cadrage i18n FR/EN, tutoiement, libellé de bouton ≤ 20 caractères.
  const i18nSec = section(da, 'i18n')
  assert(i18nSec !== null, 'critère 6 : section « ## i18n » absente')
  const i18n = norm(i18nSec)
  assert(/\bfr\b/.test(i18n) && /\ben\b/.test(i18n), 'critère 6 : langues FR et EN non cadrées')
  assert(/tutoiement/.test(i18n) && /« ?tu ?»/.test(i18n), 'critère 6 : tutoiement du joueur non cadré')
  assert(/20 caracteres/.test(i18n), 'critère 6 : limite de 20 caractères pour un libellé de bouton absente')

  await shot('vision')
}
