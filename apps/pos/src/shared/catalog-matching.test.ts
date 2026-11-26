import { describe, expect, it } from 'vitest';

import {
  HIGH_CONFIDENCE_THRESHOLD,
  PROPOSAL_THRESHOLD,
  buildSynonymIndex,
  extractFeatures,
  matchPairKey,
  normalizeText,
  proposeMatches,
  scorePair,
  singularize,
  synonymSearchTexts,
  type MatchCandidate,
} from './catalog-matching';

function candidate(id: string, supplierId: string, description: string, extra: Partial<MatchCandidate> = {}): MatchCandidate {
  return { id, supplierId, description, productId: null, groupId: null, ...extra };
}

describe('normalizeText', () => {
  it('drops accents and capitals and writes inches and decimals one way', () => {
    expect(normalizeText('  CINTA  DE AISLÁR 3/4”  ')).toBe('cinta de aislar 3/4"');
    expect(normalizeText('Broca 6,35 mm')).toBe('broca 6.35 mm');
    expect(normalizeText('Taquete ¼')).toBe('taquete 1/4');
  });
});

describe('singularize', () => {
  it('turns hardware plurals into their singular', () => {
    expect(['brocas', 'llaves', 'tornillos', 'colores', 'luces', 'cables', 'rieles'].map(singularize)).toEqual(['broca', 'llave', 'tornillo', 'color', 'luz', 'cable', 'riel']);
  });

  it('leaves alone words that are not plurals', () => {
    expect(['gris', 'hss', 'phillips', 'mas', '3/4s'].map(singularize)).toEqual(['gris', 'hss', 'phillips', 'mas', '3/4s']);
  });
});

describe('extractFeatures', () => {
  it('reads «alta velocidad» as HSS and 1/4" and 6.35 mm as the same length', () => {
    const inches = extractFeatures('BROCAS HSS 1/4" P/METAL');
    const millimetres = extractFeatures('Broca de alta velocidad 6.35 mm');
    expect(inches.tokens).toEqual(['broca', 'hss', 'metal']);
    expect(millimetres.tokens).toEqual(['broca', 'hss']);
    expect(millimetres.synonymsUsed).toEqual(['hss']);
    expect(inches.measures.length_um).toEqual([6350]);
    expect(millimetres.measures.length_um).toEqual([6350]);
  });

  it('reads mixed fractions, metres, gauges, volumes and weights as integers', () => {
    expect(extractFeatures('Tubo galv 1-1/2" x 6 m').measures.length_um).toEqual([38_100, 6_000_000]);
    expect(extractFeatures('Cable THW cal. 12').measures.gauge).toEqual([12]);
    expect(extractFeatures('Thinner 1 lt').measures.volume_ml).toEqual([1000]);
    expect(extractFeatures('Pintura 1 galon').measures.volume_ml).toEqual([3785]);
    expect(extractFeatures('Martillo 16 oz').measures.weight_mg).toEqual([453_600]);
  });

  it('reads how many pieces a pack brings and keeps it out of the words', () => {
    const pack = extractFeatures('Pija para lámina caja c/100');
    expect(pack.packCount).toBe(100);
    expect(pack.tokens).toEqual(['pija', 'lamina']);
    expect(extractFeatures('Taquete 1/4 bolsa con 50 piezas').packCount).toBe(50);
    expect(extractFeatures('Taquete 1/4').packCount).toBeNull();
  });

  it('applies the synonyms the owner added', () => {
    const index = buildSynonymIndex([{ term: 'acero rápido 2', canonical: 'alta velocidad' }, { term: 'chalupa', canonical: 'caja de registro' }]);
    expect(extractFeatures('Broca acero rapido 2 1/8', index).tokens).toEqual(['broca', 'hss']);
    expect(extractFeatures('Chalupa galvanizada', index).tokens).toEqual(['caja_de_registro', 'galvanizado']);
    expect(extractFeatures('Caja de registro galv', index).tokens).toEqual(['caja_de_registro', 'galvanizado']);
  });
});

describe('scorePair', () => {
  it('scores the HSS drill bit of two catalogs as very likely the same product', () => {
    const score = scorePair(extractFeatures('BROCAS HSS 1/4" P/METAL'), extractFeatures('Broca de alta velocidad 6.35 mm'));
    expect(score.conflict).toBeNull();
    expect(score.score).toBeGreaterThanOrEqual(HIGH_CONFIDENCE_THRESHOLD);
  });

  it('never matches two sizes', () => {
    const score = scorePair(extractFeatures('Broca HSS 1/4"'), extractFeatures('Broca HSS 3/8"'));
    expect(score.score).toBe(0);
    expect(score.conflict).toBe('Las medidas son distintas.');
    expect(scorePair(extractFeatures('Broca alta velocidad 6 mm'), extractFeatures('Broca HSS 1/4"')).score).toBe(0);
  });

  it('never matches two materials or two uses', () => {
    expect(scorePair(extractFeatures('Broca HSS 1/4'), extractFeatures('Broca cobalto 1/4')).score).toBe(0);
    expect(scorePair(extractFeatures('Broca para madera 1/2'), extractFeatures('Broca p/concreto 1/2')).score).toBe(0);
    expect(scorePair(extractFeatures('Desarmador phillips 1/4 x 4'), extractFeatures('Desarmador plano 1/4 x 4')).score).toBe(0);
  });

  it('keeps different kinds of product below the proposal line', () => {
    expect(scorePair(extractFeatures('Llave española 1/2'), extractFeatures('Broca HSS 1/2')).score).toBeLessThan(PROPOSAL_THRESHOLD);
    expect(scorePair(extractFeatures('Cinta de aislar negra'), extractFeatures('Cinta canela')).score).toBeLessThan(PROPOSAL_THRESHOLD);
  });

  it('matches words that only differ in plural, accents and abbreviations', () => {
    expect(scorePair(extractFeatures('Arandelas planas galvanizadas 3/8'), extractFeatures('RONDANA PLANA GALV. 3/8"')).score).toBeGreaterThanOrEqual(HIGH_CONFIDENCE_THRESHOLD);
    expect(scorePair(extractFeatures('Cinta aislante negra 19 mm x 20 m'), extractFeatures('CINTA DE AISLAR NGO 19MM 20M')).score).toBeGreaterThanOrEqual(HIGH_CONFIDENCE_THRESHOLD);
  });
});

describe('proposeMatches', () => {
  const catalogs: MatchCandidate[] = [
    candidate('a1', 'centro', 'BROCAS HSS 1/4" P/METAL'),
    candidate('a2', 'centro', 'BROCAS HSS 3/8" P/METAL'),
    candidate('a3', 'centro', 'Martillo uña curva 16 oz'),
    candidate('b1', 'norte', 'Broca de alta velocidad 6.35 mm'),
    candidate('b2', 'norte', 'Broca de alta velocidad 9.53 mm'),
    candidate('b3', 'norte', 'Broca alta velocidad 6.35 mm caja c/10'),
    candidate('c1', 'sur', 'Broca cobalto 1/4'),
  ];

  it('groups each size with its equal of the other supplier and never two items of one supplier', () => {
    const proposals = proposeMatches(catalogs);
    const groups = proposals.map((proposal) => proposal.itemIds);
    expect(groups).toContainEqual(['a2', 'b2']);
    const quarter = groups.find((ids) => ids.includes('a1'));
    expect(quarter).toHaveLength(2);
    expect(quarter?.some((id) => id === 'b1' || id === 'b3')).toBe(true);
    expect(groups.flat()).not.toContain('c1');
    expect(groups.flat()).not.toContain('a3');
    expect(proposals.find((proposal) => proposal.itemIds.includes('a1'))?.reason).toContain('se escribió distinto: hss');
  });

  it('does not propose again a pair the owner rejected', () => {
    const proposals = proposeMatches(catalogs, { rejectedPairs: new Set([matchPairKey('a2', 'b2')]) });
    expect(proposals.map((proposal) => proposal.itemIds)).not.toContainEqual(['a2', 'b2']);
  });

  it('adds a new item to an approved group and skips groups that are complete', () => {
    const approved = [
      candidate('a1', 'centro', 'BROCAS HSS 1/4" P/METAL', { groupId: 'g1' }),
      candidate('b1', 'norte', 'Broca de alta velocidad 6.35 mm', { groupId: 'g1' }),
      candidate('d1', 'oriente', 'Broca HSS de 1/4 pulg'),
    ];
    expect(proposeMatches(approved)).toEqual([expect.objectContaining({ itemIds: ['a1', 'b1', 'd1'], groupId: 'g1' })]);
    expect(proposeMatches(approved.slice(0, 2))).toEqual([]);
  });

  it('never joins items tied to two different products of the store', () => {
    const tied = [candidate('a1', 'centro', 'Broca HSS 1/4', { productId: 'p1' }), candidate('b1', 'norte', 'Broca alta velocidad 1/4', { productId: 'p2' })];
    expect(proposeMatches(tied)).toEqual([]);
  });
});

describe('synonymSearchTexts', () => {
  it('also searches the other ways to write a word', () => {
    expect(synonymSearchTexts('broca alta velocidad')).toContain('broca hss');
    expect(synonymSearchTexts('Broca HSS')).toContain('broca alta velocidad');
    expect(synonymSearchTexts('martillo')).toEqual([]);
  });
});
