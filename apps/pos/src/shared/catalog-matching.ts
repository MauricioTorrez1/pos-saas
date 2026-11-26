/**
 * Finds the items of different supplier catalogs that are the same product even when they are written differently, such
 * as «BROCAS HSS 1/4"» and «Broca de alta velocidad 6.35 mm» (E1-63, ADR 0079). Everything here is pure and works without
 * internet: the text is normalized, the hardware synonyms are applied, the measures are read into integers, and each pair
 * of items gets a score from 0 to 100. Two items whose measures, materials or uses differ never match.
 */

/** A word and the other ways suppliers write it. The canonical form is one token. */
export interface SynonymEntry {
  readonly canonical: string;
  readonly variants: readonly string[];
}

/**
 * The synonyms and abbreviations of a Mexican hardware store that come with the register. The owner adds more from the
 * screen of equivalent products; they live in the local database and are merged with these.
 */
export const BUILT_IN_SYNONYMS: readonly SynonymEntry[] = [
  { canonical: 'hss', variants: ['alta velocidad', 'acero de alta velocidad', 'acero rapido', 'high speed steel', 'high speed'] },
  { canonical: 'galvanizado', variants: ['galv', 'galvanizada', 'galvanizados', 'galvanizadas', 'galvanized'] },
  { canonical: 'inoxidable', variants: ['inox', 'acero inoxidable', 'stainless', 'stainless steel'] },
  { canonical: 'cobalto', variants: ['cobalt'] },
  { canonical: 'carburo', variants: ['carburo de tungsteno', 'tungsteno', 'widia', 'carbide'] },
  { canonical: 'laton', variants: ['brass'] },
  { canonical: 'concreto', variants: ['mamposteria', 'muro', 'concrete', 'masonry'] },
  { canonical: 'madera', variants: ['wood'] },
  { canonical: 'metal', variants: ['fierro', 'hierro'] },
  { canonical: 'desarmador', variants: ['destornillador', 'desarm', 'screwdriver'] },
  { canonical: 'rondana', variants: ['arandela', 'roldana'] },
  { canonical: 'taquete', variants: ['ancla plastica', 'tarugo'] },
  { canonical: 'cinta_aislar', variants: ['cinta de aislar', 'cinta aislante', 'cinta aislar'] },
  { canonical: 'broca', variants: ['mecha'] },
  { canonical: 'tornillo', variants: ['torn'] },
  { canonical: 'manguera', variants: ['mang'] },
  { canonical: 'juego', variants: ['jgo', 'set', 'kit'] },
  { canonical: 'phillips', variants: ['philips', 'cruz'] },
  { canonical: 'negro', variants: ['negra', 'ngo', 'neg'] },
  { canonical: 'blanco', variants: ['blanca', 'bco', 'blco'] },
  { canonical: 'rojo', variants: ['roja'] },
  { canonical: 'amarillo', variants: ['amarilla', 'amar'] },
  { canonical: 'plano', variants: ['plana'] },
];

/** Words that say nothing about which product it is. */
const STOPWORDS = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'para', 'p', 'con', 'c', 'sin', 'y', 'o', 'en', 'a', 'al', 'x', 'por', 'tipo', 'mod',
  'modelo', 'un', 'una', 'pieza', 'pza', 'pz', 'pzas', 'pzs', 'piezas', 'caja', 'cja', 'bolsa', 'paquete', 'paq', 'blister',
  'unidad', 'medida', 'num', 'no',
]);

/**
 * Words that say what something is made of, or what it is for. Two items that each name one, but not the same one, are
 * different products: an HSS drill bit is not a cobalt one, and a wood bit is not a concrete one.
 */
const CONFLICT_CLASSES: readonly (readonly string[])[] = [
  ['hss', 'cobalto', 'carburo', 'inoxidable', 'galvanizado', 'laton', 'cobre', 'aluminio', 'pvc', 'cpvc'],
  ['concreto', 'madera', 'metal', 'vidrio', 'ceramica', 'azulejo'],
  ['phillips', 'plano', 'torx', 'allen', 'cuadrado'],
];

/** The kinds of measure that are read from a description, each one kept as an integer. */
export type MeasureKind = 'length_um' | 'gauge' | 'volume_ml' | 'weight_mg' | 'watts' | 'volts' | 'amps';

/** What is read from one description. */
export interface ItemFeatures {
  /** The words that remain, singular, with the synonyms replaced by their canonical form. */
  readonly tokens: readonly string[];
  /** The measures by kind, in integer units (micrometres, millilitres, milligrams…). */
  readonly measures: Readonly<Partial<Record<MeasureKind, readonly number[]>>>;
  /** How many pieces the description says come in it («caja c/100»), when more than one. */
  readonly packCount: number | null;
  /** The canonical forms of the synonyms that were found written another way, such as «alta velocidad» → hss. */
  readonly synonymsUsed: readonly string[];
}

const MICRONS_PER_INCH = 25_400;
/** Two lengths match when they differ by at most 1 %: 1/4" is 6.35 mm and a list may say 6.4 mm. */
const MEASURE_TOLERANCE_PER_THOUSAND = 10;

const UNICODE_FRACTIONS: Readonly<Record<string, string>> = { '¼': ' 1/4', '½': ' 1/2', '¾': ' 3/4', '⅛': ' 1/8', '⅜': ' 3/8', '⅝': ' 5/8', '⅞': ' 7/8' };

/**
 * Makes a description comparable: lowercase, no accents, the same quote for inches, decimal commas as points and one space
 * between words.
 *
 * @param text a description as the supplier wrote it
 * @returns the text ready to read measures and words
 */
export function normalizeText(text: string): string {
  return text
    .replace(/[¼½¾⅛⅜⅝⅞]/gu, (fraction) => UNICODE_FRACTIONS[fraction] ?? fraction)
    .normalize('NFD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/[“”″]|''/gu, '"')
    .replace(/(\d),(\d)/gu, '$1.$2')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Reads a decimal written with a point into thousandths, without floating point. */
function toThousandths(text: string): number {
  const [whole = '0', fraction = ''] = text.split('.');
  return Number(whole) * 1000 + Number(fraction.slice(0, 3).padEnd(3, '0'));
}

interface MeasureRule {
  readonly kind: MeasureKind;
  readonly pattern: RegExp;
  readonly read: (match: RegExpExecArray) => number;
}

const INCH_UNIT = String.raw`\s*(?:"|pulgadas?\b|pulg\b|plg\b|in\b)`;

/** Integer micrometres of whole + numerator/denominator inches, rounded. */
function inchesToMicrons(whole: number, numerator: number, denominator: number): number {
  return Math.round(((whole * denominator + numerator) * MICRONS_PER_INCH) / denominator);
}

/**
 * The measures a hardware description carries. The order matters: a mixed fraction is read before a plain one, and each
 * match is taken out of the text before the next rule looks.
 */
const MEASURE_RULES: readonly MeasureRule[] = [
  { kind: 'length_um', pattern: new RegExp(String.raw`\b(\d{1,2})[- ](\d{1,2})/(\d{1,2})(?:${INCH_UNIT})?`, 'gu'), read: (m) => inchesToMicrons(Number(m[1]), Number(m[2]), Number(m[3])) },
  // A fraction of a hardware item without its unit is inches: «broca 1/4».
  { kind: 'length_um', pattern: new RegExp(String.raw`(?<![\w/])(\d{1,2})/(\d{1,2})(?![\d/])(?:${INCH_UNIT})?`, 'gu'), read: (m) => inchesToMicrons(0, Number(m[1]), Number(m[2])) },
  { kind: 'length_um', pattern: new RegExp(String.raw`\b(\d+(?:\.\d+)?)${INCH_UNIT}`, 'gu'), read: (m) => Math.round((toThousandths(m[1] ?? '0') * MICRONS_PER_INCH) / 1000) },
  { kind: 'length_um', pattern: /\b(\d+(?:\.\d+)?)\s*mm\b/gu, read: (m) => toThousandths(m[1] ?? '0') },
  { kind: 'length_um', pattern: /\b(\d+(?:\.\d+)?)\s*cm\b/gu, read: (m) => toThousandths(m[1] ?? '0') * 10 },
  { kind: 'length_um', pattern: /\b(\d+(?:\.\d+)?)\s*(?:m|mts?|metros?)\b/gu, read: (m) => toThousandths(m[1] ?? '0') * 1000 },
  { kind: 'gauge', pattern: /(?:\bcal(?:ibre)?\.?\s*|#\s*)(\d{1,2})\b/gu, read: (m) => Number(m[1]) },
  { kind: 'gauge', pattern: /\b(\d{1,2})\s*awg\b/gu, read: (m) => Number(m[1]) },
  { kind: 'volume_ml', pattern: /\b(\d+(?:\.\d+)?)\s*ml\b/gu, read: (m) => Math.round(toThousandths(m[1] ?? '0') / 1000) },
  { kind: 'volume_ml', pattern: /\b(\d+(?:\.\d+)?)\s*(?:lts?|litros?|l)\b/gu, read: (m) => toThousandths(m[1] ?? '0') },
  { kind: 'volume_ml', pattern: /\b(\d+(?:\.\d+)?)\s*(?:gal|galon|galones)\b/gu, read: (m) => Math.round((toThousandths(m[1] ?? '0') * 3785) / 1000) },
  { kind: 'weight_mg', pattern: /\b(\d+(?:\.\d+)?)\s*(?:kgs?|kilos?|kilogramos?)\b/gu, read: (m) => toThousandths(m[1] ?? '0') * 1000 },
  { kind: 'weight_mg', pattern: /\b(\d+(?:\.\d+)?)\s*(?:grs?|g|gramos?)\b/gu, read: (m) => toThousandths(m[1] ?? '0') },
  { kind: 'weight_mg', pattern: /\b(\d+(?:\.\d+)?)\s*(?:oz|onzas?)\b/gu, read: (m) => Math.round((toThousandths(m[1] ?? '0') * 28_350) / 1000) },
  { kind: 'weight_mg', pattern: /\b(\d+(?:\.\d+)?)\s*(?:lbs?|libras?)\b/gu, read: (m) => Math.round((toThousandths(m[1] ?? '0') * 453_592) / 1000) },
  { kind: 'watts', pattern: /\b(\d+)\s*(?:w|watts?)\b/gu, read: (m) => Number(m[1]) },
  { kind: 'volts', pattern: /\b(\d+)\s*(?:v|volts?)\b/gu, read: (m) => Number(m[1]) },
  { kind: 'amps', pattern: /\b(\d+)\s*(?:amps?|amperes?)\b/gu, read: (m) => Number(m[1]) },
];

const PACK_PATTERNS: readonly RegExp[] = [
  /\bc\s*\/\s*(\d+)\b/gu,
  /\b(?:caja|bolsa|paquete|paq|blister|juego|jgo)\s+(?:con|de|c\/)\s*(\d+)\b/gu,
  /\b(\d+)\s*(?:pzas?|pzs|piezas|pz)\b/gu,
];

/**
 * Turns a Spanish plural into its singular with the rules that cover hardware words: «brocas» → broca, «llaves» → llave,
 * «tornillos» → tornillo, «colores» → color, «luces» → luz.
 *
 * @param word a lowercase word without accents
 * @returns the singular
 */
export function singularize(word: string): string {
  if (word.length <= 3 || !word.endsWith('s') || /\d/u.test(word)) {
    return word;
  }
  if (word.endsWith('ces')) {
    return `${word.slice(0, -3)}z`;
  }
  // «colores», «rieles», «redes», «botones»: a vowel, then l, r, n or d, then -es.
  if (/[aeiou][lrnd]es$/u.test(word)) {
    return word.slice(0, -2);
  }
  // A Spanish plural ends in a, e or o and an s; «gris», «phillips» or «hss» are not plurals.
  return /[aeo]s$/u.test(word) ? word.slice(0, -1) : word;
}

/** Where to look up the synonyms: the phrases longest first, the single words, and every form of each canonical word. */
export interface SynonymIndex {
  readonly phrases: readonly { readonly pattern: RegExp; readonly canonical: string }[];
  /** Each single word, its canonical form included, with the canonical form it stands for. */
  readonly words: ReadonlyMap<string, string>;
  /** Every way to write each canonical word, the canonical one first with spaces instead of underscores. */
  readonly formsOf: ReadonlyMap<string, readonly string[]>;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

/**
 * Builds the lookup of the synonyms of the register and the ones the owner added. An owner's entry whose meaning is
 * already a word of the dictionary joins it, so «alta velocidad = hss» and «rápida = alta velocidad» end in the same word.
 *
 * @param ownerEntries what the owner added: the term and what it means
 * @returns the index used by {@link extractFeatures}
 */
export function buildSynonymIndex(ownerEntries: readonly { readonly term: string; readonly canonical: string }[] = []): SynonymIndex {
  const toCanonical = new Map<string, string>();
  const formsOf = new Map<string, string[]>();
  const add = (canonical: string, form: string): void => {
    if (form === '' || toCanonical.has(form)) {
      return;
    }
    const forms = formsOf.get(canonical) ?? [canonical.replace(/_/gu, ' ')];
    if (!forms.includes(form)) {
      forms.push(form);
    }
    formsOf.set(canonical, forms);
    toCanonical.set(form, canonical);
  };
  for (const entry of BUILT_IN_SYNONYMS) {
    add(entry.canonical, entry.canonical.replace(/_/gu, ' '));
    for (const variant of entry.variants) {
      add(entry.canonical, normalizeText(variant));
    }
  }
  for (const entry of ownerEntries) {
    const meaning = normalizeText(entry.canonical);
    let canonical = toCanonical.get(meaning);
    if (canonical === undefined) {
      canonical = meaning.replace(/ /gu, '_');
      add(canonical, meaning);
    }
    add(canonical, normalizeText(entry.term));
  }
  const phrases = [...toCanonical.entries()]
    .filter(([form]) => form.includes(' '))
    .sort(([left], [right]) => right.length - left.length)
    .map(([form, canonical]) => ({ pattern: new RegExp(String.raw`(?<![\w])${escapeRegExp(form)}(?![\w])`, 'gu'), canonical }));
  const words = new Map([...toCanonical.entries()].filter(([form]) => !form.includes(' ')));
  for (const canonical of formsOf.keys()) {
    words.set(canonical, canonical);
  }
  return { phrases, words, formsOf };
}

const DEFAULT_INDEX = buildSynonymIndex();

/**
 * Reads what a description says: its measures, how many pieces it brings, and its meaningful words with the synonyms
 * replaced, so «Broca de alta velocidad 6.35 mm» and «BROCAS HSS 1/4"» both read as broca + hss + 6,350 µm.
 *
 * @param description the description as the supplier wrote it
 * @param index the synonyms to apply
 * @returns the features
 */
export function extractFeatures(description: string, index: SynonymIndex = DEFAULT_INDEX): ItemFeatures {
  let text = ` ${normalizeText(description)} `;
  let packCount: number | null = null;
  for (const pattern of PACK_PATTERNS) {
    text = text.replace(pattern, (whole, count: string) => {
      const value = Number(count);
      if (value > 1 && packCount === null) {
        packCount = value;
      }
      return ' ';
    });
  }
  const measures: Partial<Record<MeasureKind, number[]>> = {};
  for (const rule of MEASURE_RULES) {
    text = text.replace(rule.pattern, (...args: unknown[]) => {
      const match = args.slice(0, -2) as unknown as RegExpExecArray;
      const value = rule.read(match);
      if (value > 0) {
        (measures[rule.kind] ??= []).push(value);
      }
      return ' ';
    });
  }
  const synonymsUsed = new Set<string>();
  for (const { pattern, canonical } of index.phrases) {
    text = text.replace(pattern, () => {
      synonymsUsed.add(canonical);
      return ` ${canonical} `;
    });
  }
  const tokens: string[] = [];
  for (const raw of text.split(/[^a-z0-9_]+/u)) {
    if (raw === '') {
      continue;
    }
    const direct = index.words.get(raw);
    const singular = singularize(raw);
    const canonical = direct ?? index.words.get(singular) ?? singular;
    if (canonical !== raw && canonical !== singular) {
      synonymsUsed.add(canonical);
    }
    if (!STOPWORDS.has(canonical) && !STOPWORDS.has(raw) && !tokens.includes(canonical)) {
      tokens.push(canonical);
    }
  }
  const sortedMeasures: Partial<Record<MeasureKind, readonly number[]>> = {};
  for (const [kind, values] of Object.entries(measures) as [MeasureKind, number[]][]) {
    sortedMeasures[kind] = [...new Set(values)].sort((left, right) => left - right);
  }
  return { tokens, measures: sortedMeasures, packCount, synonymsUsed: [...synonymsUsed].filter((word) => tokens.includes(word)) };
}

function closeEnough(left: number, right: number): boolean {
  return Math.abs(left - right) * 1000 <= Math.max(left, right) * MEASURE_TOLERANCE_PER_THOUSAND;
}

function sameValues(left: readonly number[], right: readonly number[]): boolean {
  return left.every((value) => right.some((other) => closeEnough(value, other))) && right.every((value) => left.some((other) => closeEnough(value, other)));
}

/** Why two items cannot be the same product, in Spanish for the owner, or null when nothing says so. */
export function conflictOf(left: ItemFeatures, right: ItemFeatures): string | null {
  for (const kind of Object.keys(left.measures) as MeasureKind[]) {
    const mine = left.measures[kind];
    const theirs = right.measures[kind];
    if (mine !== undefined && theirs !== undefined && !sameValues(mine, theirs)) {
      return 'Las medidas son distintas.';
    }
  }
  for (const group of CONFLICT_CLASSES) {
    const mine = left.tokens.filter((token) => group.includes(token));
    const theirs = right.tokens.filter((token) => group.includes(token));
    if (mine.length > 0 && theirs.length > 0 && !mine.some((token) => theirs.includes(token))) {
      return `Una dice ${mine.join(', ')} y la otra ${theirs.join(', ')}.`;
    }
  }
  return null;
}

/** How rare each word is among the items being compared: a word in few items weighs more than «acero». */
export type TokenWeights = ReadonlyMap<string, number>;

/**
 * Weighs each word by how few items carry it (inverse document frequency), so the rare words decide.
 *
 * @param features the features of every item being compared
 * @returns the weight of each word
 */
export function tokenWeights(features: readonly ItemFeatures[]): TokenWeights {
  const counts = new Map<string, number>();
  for (const item of features) {
    for (const token of item.tokens) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  const total = Math.max(features.length, 1);
  return new Map([...counts.entries()].map(([token, count]) => [token, Math.log(1 + total / count)]));
}

/** The score of a pair of items and why. */
export interface PairScore {
  /** From 0 to 100; 0 when something says they are different products. */
  readonly score: number;
  /** The words both share, the measures both share, or the conflict. */
  readonly sharedTokens: readonly string[];
  readonly sharedMeasures: readonly MeasureKind[];
  readonly conflict: string | null;
}

/**
 * Scores how likely two items are the same product. 70 % comes from the shared words, weighed by how rare they are, and
 * 30 % from the measures both agree on. Different measures or materials give 0. A different first word (the kind of
 * product: «broca», «llave») lowers the score unless the other description also has it.
 *
 * @param left the features of one item
 * @param right the features of the other
 * @param weights the weight of each word; words without one weigh 1
 * @returns the score from 0 to 100 and why
 */
export function scorePair(left: ItemFeatures, right: ItemFeatures, weights: TokenWeights = new Map()): PairScore {
  const conflict = conflictOf(left, right);
  const sharedTokens = left.tokens.filter((token) => right.tokens.includes(token));
  const kinds = new Set([...Object.keys(left.measures), ...Object.keys(right.measures)] as MeasureKind[]);
  const sharedMeasures = [...kinds].filter((kind) => left.measures[kind] !== undefined && right.measures[kind] !== undefined);
  if (conflict !== null) {
    return { score: 0, sharedTokens, sharedMeasures, conflict };
  }
  const weightOf = (token: string): number => weights.get(token) ?? 1;
  const sum = (tokens: readonly string[]): number => tokens.reduce((total, token) => total + weightOf(token), 0);
  const denominator = sum(left.tokens) + sum(right.tokens);
  let similarity = denominator === 0 ? 0 : (2 * sum(sharedTokens)) / denominator;
  const leftHead = left.tokens[0];
  const rightHead = right.tokens[0];
  if (leftHead !== undefined && rightHead !== undefined && leftHead !== rightHead && !right.tokens.includes(leftHead) && !left.tokens.includes(rightHead)) {
    similarity *= 0.6;
  }
  const score = kinds.size === 0 ? similarity : 0.7 * similarity + (0.3 * sharedMeasures.length) / kinds.size;
  return { score: Math.round(score * 100), sharedTokens, sharedMeasures, conflict: null };
}

/** From this score up a pair is proposed. */
export const PROPOSAL_THRESHOLD = 60;
/** From this score up a proposal is shown as very likely. */
export const HIGH_CONFIDENCE_THRESHOLD = 80;

/** One item of a catalog as the matcher sees it. */
export interface MatchCandidate {
  readonly id: string;
  readonly supplierId: string;
  readonly description: string;
  /** The product of the store it is tied to, if any. */
  readonly productId: string | null;
  /** The approved group of equivalent products it belongs to, if any. */
  readonly groupId: string | null;
}

/** A set of items of different suppliers that look like the same product. */
export interface MatchProposal {
  readonly itemIds: readonly string[];
  /** The lowest score that joined two of its items, from 0 to 100. */
  readonly score: number;
  /** The approved group this proposal adds to, if it does. */
  readonly groupId: string | null;
  /** In Spanish, for the owner: the words and measures they share and the synonyms used. */
  readonly reason: string;
}

/** The most items one word may gather before it is too common to look for pairs by it alone. */
const MAX_BLOCK_SIZE = 1_500;

class DisjointSets {
  readonly #parent = new Map<string, string>();

  find(id: string): string {
    const parent = this.#parent.get(id) ?? id;
    if (parent === id) {
      return id;
    }
    const root = this.find(parent);
    this.#parent.set(id, root);
    return root;
  }

  union(left: string, right: string): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) {
      this.#parent.set(rightRoot, leftRoot);
    }
  }
}

function pairKey(left: string, right: string): string {
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

const MEASURE_NAMES: Readonly<Record<MeasureKind, string>> = {
  length_um: 'la misma medida',
  gauge: 'el mismo calibre',
  volume_ml: 'el mismo volumen',
  weight_mg: 'el mismo peso',
  watts: 'los mismos watts',
  volts: 'el mismo voltaje',
  amps: 'el mismo amperaje',
};

function describeReason(tokens: readonly string[], measures: readonly MeasureKind[], synonyms: readonly string[]): string {
  const parts: string[] = [];
  if (tokens.length > 0) {
    parts.push(`Comparten ${tokens.map((token) => token.replace(/_/gu, ' ')).join(', ')}`);
  }
  if (measures.length > 0) {
    parts.push(`tienen ${measures.map((kind) => MEASURE_NAMES[kind]).join(' y ')}`);
  }
  if (synonyms.length > 0) {
    parts.push(`se escribió distinto: ${synonyms.map((word) => word.replace(/_/gu, ' ')).join(', ')}`);
  }
  return parts.length === 0 ? 'Se parecen.' : `${parts.join('; ')}.`;
}

/**
 * Proposes groups of equivalent items across suppliers. Each item is paired only with items of other suppliers that share a
 * rare enough word; the pairs are joined from the best score down, never putting two items of the same supplier together.
 * The approved groups and the items tied to the same product start joined, so a proposal can add an item to them. A pair
 * the owner rejected, or two items tied to different products, are never joined.
 *
 * @param candidates the items to look at
 * @param options the synonyms, the rejected pairs (as `pairKey` of their ids) and the lowest score to propose
 * @returns the proposals, the most likely first
 */
export function proposeMatches(
  candidates: readonly MatchCandidate[],
  options: { readonly index?: SynonymIndex; readonly rejectedPairs?: ReadonlySet<string>; readonly threshold?: number } = {},
): MatchProposal[] {
  const index = options.index ?? DEFAULT_INDEX;
  const rejected = options.rejectedPairs ?? new Set<string>();
  const threshold = options.threshold ?? PROPOSAL_THRESHOLD;
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const features = new Map(candidates.map((candidate) => [candidate.id, extractFeatures(candidate.description, index)]));
  const weights = tokenWeights([...features.values()]);

  const sets = new DisjointSets();
  const firstOf = new Map<string, string>();
  for (const candidate of candidates) {
    for (const key of [candidate.groupId === null ? null : `g:${candidate.groupId}`, candidate.productId === null ? null : `p:${candidate.productId}`]) {
      if (key === null) {
        continue;
      }
      const first = firstOf.get(key);
      if (first === undefined) {
        firstOf.set(key, candidate.id);
      } else {
        sets.union(first, candidate.id);
      }
    }
  }
  const startRoots = new Map(candidates.map((candidate) => [candidate.id, sets.find(candidate.id)]));

  const blocks = new Map<string, string[]>();
  for (const [id, item] of features) {
    for (const token of item.tokens) {
      const block = blocks.get(token) ?? [];
      block.push(id);
      blocks.set(token, block);
    }
  }
  const scored = new Map<string, { left: string; right: string; pair: PairScore }>();
  for (const block of blocks.values()) {
    if (block.length < 2 || block.length > MAX_BLOCK_SIZE) {
      continue;
    }
    for (let i = 0; i < block.length; i += 1) {
      for (let j = i + 1; j < block.length; j += 1) {
        const left = byId.get(block[i]!)!;
        const right = byId.get(block[j]!)!;
        const key = pairKey(left.id, right.id);
        if (left.supplierId === right.supplierId || scored.has(key) || rejected.has(key)) {
          continue;
        }
        if (left.productId !== null && right.productId !== null && left.productId !== right.productId) {
          continue;
        }
        const pair = scorePair(features.get(left.id)!, features.get(right.id)!, weights);
        if (pair.score >= threshold) {
          scored.set(key, { left: left.id, right: right.id, pair });
        }
      }
    }
  }

  const members = new Map<string, Set<string>>();
  for (const [id, root] of startRoots) {
    members.set(root, (members.get(root) ?? new Set<string>()).add(id));
  }
  const membersOf = (root: string): Set<string> => members.get(root) ?? new Set([root]);
  const used: { left: string; right: string; pair: PairScore }[] = [];
  for (const edge of [...scored.values()].sort((left, right) => right.pair.score - left.pair.score)) {
    const leftRoot = sets.find(edge.left);
    const rightRoot = sets.find(edge.right);
    if (leftRoot === rightRoot) {
      continue;
    }
    const leftMembers = membersOf(leftRoot);
    const rightMembers = membersOf(rightRoot);
    const suppliers = new Set([...leftMembers].map((id) => byId.get(id)!.supplierId));
    const products = new Set([...leftMembers].map((id) => byId.get(id)!.productId).filter((id) => id !== null));
    const groups = new Set([...leftMembers].map((id) => byId.get(id)!.groupId).filter((id) => id !== null));
    const clash = [...rightMembers].some((id) => {
      const item = byId.get(id)!;
      return (
        suppliers.has(item.supplierId) ||
        (item.productId !== null && products.size > 0 && !products.has(item.productId)) ||
        (item.groupId !== null && groups.size > 0 && !groups.has(item.groupId))
      );
    });
    const rejectedInside = [...leftMembers].some((left) => [...rightMembers].some((right) => rejected.has(pairKey(left, right))));
    if (clash || rejectedInside) {
      continue;
    }
    sets.union(leftRoot, rightRoot);
    const root = sets.find(leftRoot);
    members.delete(leftRoot);
    members.delete(rightRoot);
    members.set(root, new Set([...leftMembers, ...rightMembers]));
    used.push(edge);
  }

  const proposals: MatchProposal[] = [];
  const edgesByRoot = new Map<string, typeof used>();
  for (const edge of used) {
    const root = sets.find(edge.left);
    edgesByRoot.set(root, [...(edgesByRoot.get(root) ?? []), edge]);
  }
  for (const [root, edges] of edgesByRoot) {
    const itemIds = [...membersOf(root)];
    const groupId = itemIds.map((id) => byId.get(id)!.groupId).find((id) => id !== null) ?? null;
    const startedTogether = new Set(itemIds.map((id) => startRoots.get(id)));
    if (startedTogether.size < 2) {
      continue;
    }
    const tokens = [...new Set(edges.flatMap((edge) => edge.pair.sharedTokens))];
    const measures = [...new Set(edges.flatMap((edge) => edge.pair.sharedMeasures))];
    const synonyms = [...new Set(itemIds.flatMap((id) => features.get(id)!.synonymsUsed))];
    proposals.push({
      itemIds: itemIds.sort(),
      score: Math.min(...edges.map((edge) => edge.pair.score)),
      groupId,
      reason: describeReason(tokens, measures, synonyms),
    });
  }
  return proposals.sort((left, right) => right.score - left.score || left.itemIds[0]!.localeCompare(right.itemIds[0]!));
}

/**
 * The key of a pair of items, the same whatever their order; rejected pairs are kept with it.
 *
 * @param left one item
 * @param right the other
 * @returns the key
 */
export function matchPairKey(left: string, right: string): string {
  return pairKey(left, right);
}

/**
 * The words to look for in the lists besides the ones typed: each synonym found is also searched as its other forms, so
 * «alta velocidad» also finds «HSS».
 *
 * @param text what the owner typed
 * @param index the synonyms
 * @returns the other texts to search, at most five
 */
export function synonymSearchTexts(text: string, index: SynonymIndex = DEFAULT_INDEX): string[] {
  const normalized = ` ${normalizeText(text)} `;
  const results = new Set<string>();
  for (const forms of index.formsOf.values()) {
    const present = forms.find((form) => normalized.includes(` ${form} `));
    if (present === undefined) {
      continue;
    }
    for (const form of forms) {
      if (form !== present) {
        results.add(normalized.replace(` ${present} `, ` ${form} `).trim());
      }
    }
  }
  return [...results].slice(0, 5);
}
