import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserSummary } from '../../shared/auth';
import { EQUIVALENCE_CHANNELS } from '../../shared/catalog-equivalence';
import type { Supplier } from '../../shared/supplier-order';
import { AuditLog } from '../audit/audit-log';
import { AuthService } from '../auth/auth-service';
import { UserStore } from '../auth/user-store';
import { parseCsv } from '../import/eleventa-csv';
import { LocalStore } from '../local-store/local-store';
import { AnalyticsEquivalenceAssistant, equivalenceAssistantFromEnvironment } from './analytics-equivalence-assistant';
import { parseApproveEquivalenceRequest } from './catalog-equivalence-ipc';
import { CatalogEquivalenceService, type AssistItem, type EquivalenceAssistant } from './catalog-equivalence-service';
import { registerSupplierCatalogHandlers } from './supplier-catalog-ipc';
import { SupplierCatalogService } from './supplier-catalog-service';
import { SupplierService } from './supplier-service';

const TENANT = 'tenant-a';

let directory: string;
let store: LocalStore;
let catalog: SupplierCatalogService;
let equivalences: CatalogEquivalenceService;
let owner: UserSummary;
let centro: Supplier;
let norte: Supplier;
let suppliers: SupplierService;
let audit: AuditLog;

function saveSupplier(name: string): Supplier {
  const saved = suppliers.save({ name, contact: null, notes: null, isActive: true });
  if (saved.status !== 'saved') {
    throw new Error(`Could not save ${name}`);
  }
  return saved.supplier;
}

function importFor(target: Supplier, text: string): void {
  const preview = catalog.preview(target.id, 'lista.csv', parseCsv(text));
  const result = catalog.import({ token: preview.token, supplierId: target.id, mapping: preview.mapping, costsIncludeVat: false, listDate: '2026-11-25', source: 'file' }, owner.id);
  if (result.status !== 'imported') {
    throw new Error(`Expected imported, got ${result.status}`);
  }
}

function itemId(target: Supplier, code: string): string {
  return catalog.list({ supplierId: target.id, onlyUnlinked: false, text: '' }).find((item) => item.supplierCode === code)!.id;
}

const CENTRO_LIST = 'codigo,descripcion,costo,piezas\nB-14,"BROCAS HSS 1/4"" P/METAL",30,1\nB-38,"BROCAS HSS 3/8"" P/METAL",45,1\nM-16,Martillo uña curva 16 oz,150,1\n';
const NORTE_LIST = 'codigo,descripcion,costo,piezas\nAV-635,Broca de alta velocidad 6.35 mm,26,1\nAV-953,Broca de alta velocidad 9.53 mm,50,1\nPJ-100,Pija para lamina caja c/100,80,\n';

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'catalog-equivalence-'));
  store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });
  const auth = new AuthService(new UserStore(store, TENANT));
  audit = new AuditLog(store, TENANT);
  suppliers = new SupplierService(store, TENANT, auth, audit);
  catalog = new SupplierCatalogService(store, TENANT, audit, suppliers);
  equivalences = new CatalogEquivalenceService(store, TENANT, audit, null);
  owner = auth.setupOwner('Mauricio', '4321');
  auth.login(owner.id, '4321');
  centro = saveSupplier('Ferretera del Centro');
  norte = saveSupplier('Eléctrica del Norte');
  importFor(centro, CENTRO_LIST);
  importFor(norte, NORTE_LIST);
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('CatalogEquivalenceService', () => {
  it('proposes the HSS drill bits of both catalogs, size by size, without internet', () => {
    const { proposals, examinedCount } = equivalences.propose('');
    expect(examinedCount).toBe(6);
    const pairs = proposals.map((proposal) => proposal.items.map((item) => item.supplierCode).sort());
    expect(pairs).toEqual(expect.arrayContaining([['AV-635', 'B-14'], ['AV-953', 'B-38']]));
    expect(pairs.flat()).not.toContain('M-16');
    expect(proposals[0]).toMatchObject({ origin: 'rules', confidence: 'high', groupId: null });
  });

  it('finds them by the synonym too: «alta velocidad» also searches «HSS»', () => {
    const { proposals } = equivalences.propose('broca alta velocidad');
    expect(proposals.map((proposal) => proposal.items.length)).toEqual([2, 2]);
  });

  it('approves a group with append-only decisions and an audit entry, and the comparator shows it side by side', () => {
    const result = equivalences.approve(
      { itemIds: [itemId(centro, 'B-14'), itemId(norte, 'AV-635')], groupId: null, name: 'Broca HSS 1/4"', origin: 'rules', score: 90, reason: 'Comparten broca, hss.' },
      owner.id,
    );
    expect(result).toMatchObject({ status: 'approved', group: { name: 'Broca HSS 1/4"', cheapestItemId: itemId(norte, 'AV-635') } });

    const group = catalog.compare('brocas hss').find((candidate) => candidate.equivalenceName === 'Broca HSS 1/4"')!;
    expect(group.options.map((option) => [option.item.supplierName, option.item.baseUnitCostE6, option.isCheapest])).toEqual([
      ['Eléctrica del Norte', 26_000_000, true],
      ['Ferretera del Centro', 30_000_000, false],
    ]);
    expect(store.prepare("SELECT kind, supplier_code FROM catalog_match_decision ORDER BY seq").all()).toEqual([
      { kind: 'join', supplier_code: 'B-14' },
      { kind: 'join', supplier_code: 'AV-635' },
      { kind: 'name', supplier_code: null },
    ]);
    expect(() => store.prepare("UPDATE catalog_match_decision SET kind = 'leave'").run()).toThrow(/never changes/u);
    expect(() => store.prepare('DELETE FROM catalog_match_decision').run()).toThrow(/never deleted/u);
    expect(store.prepare("SELECT action FROM audit_log WHERE action LIKE 'catalog_equivalence.%'").all()).toEqual([{ action: 'catalog_equivalence.approve' }]);
    // Approved groups are not proposed again.
    expect(equivalences.propose('').proposals.flatMap((proposal) => proposal.items.map((item) => item.supplierCode))).not.toContain('B-14');
  });

  it('remembers the groups and the rejections when the lists are imported again', () => {
    equivalences.approve({ itemIds: [itemId(centro, 'B-14'), itemId(norte, 'AV-635')], groupId: null, name: 'Broca 1/4', origin: 'rules', score: 90, reason: '' }, owner.id);
    equivalences.reject([itemId(centro, 'B-38'), itemId(norte, 'AV-953')], owner.id);
    importFor(centro, CENTRO_LIST);
    importFor(norte, NORTE_LIST);
    expect(equivalences.groups('')).toEqual([expect.objectContaining({ name: 'Broca 1/4', items: [expect.objectContaining({ supplierCode: 'AV-635' }), expect.objectContaining({ supplierCode: 'B-14' })] })]);
    expect(equivalences.propose('').proposals).toEqual([]);
  });

  it('adds an item to a group, takes it out, and refuses two items of one supplier', () => {
    const third = saveSupplier('Tornillos del Sur');
    importFor(third, 'codigo,descripcion,costo,piezas\nS-1,Broca HSS de 1/4 pulg,28,1\n');
    const approved = equivalences.approve({ itemIds: [itemId(centro, 'B-14'), itemId(norte, 'AV-635')], groupId: null, name: 'Broca 1/4', origin: 'rules', score: 90, reason: '' }, owner.id);
    const groupId = approved.status === 'approved' ? approved.group.id : '';
    const proposal = equivalences.propose('').proposals.find((candidate) => candidate.groupId === groupId)!;
    expect(proposal.items.map((item) => item.supplierCode).sort()).toEqual(['AV-635', 'B-14', 'S-1']);
    expect(equivalences.approve({ itemIds: [itemId(third, 'S-1')], groupId, name: 'Broca 1/4', origin: 'rules', score: proposal.score, reason: '' }, owner.id)).toMatchObject({
      status: 'approved',
      group: { items: [expect.anything(), expect.anything(), expect.anything()] },
    });
    expect(equivalences.approve({ itemIds: [itemId(centro, 'B-38')], groupId, name: 'Broca 1/4', origin: 'manual', score: null, reason: '' }, owner.id)).toEqual({
      status: 'same_supplier',
      supplierName: 'Ferretera del Centro',
    });
    expect(equivalences.remove({ groupId, itemId: itemId(third, 'S-1') }, owner.id)).toEqual({ status: 'removed' });
    expect(equivalences.groups('')[0]?.items).toHaveLength(2);
    expect(equivalences.remove({ groupId, itemId: itemId(third, 'S-1') }, owner.id)).toEqual({ status: 'not_found' });
  });

  it('compares an unlinked pack per piece with the pieces of its description', () => {
    const third = saveSupplier('Tornillos del Sur');
    importFor(third, 'codigo,descripcion,costo,piezas\nPJ,Pija para lamina,1,1\n');
    const group = catalog.compare('pija').find((candidate) => candidate.productId === null)!;
    expect(group.options.map((option) => [option.item.supplierCode, option.item.baseUnitCostE6, option.item.piecesFromDescription ?? false])).toEqual([
      ['PJ-100', 800_000, true],
      ['PJ', 1_000_000, false],
    ]);
  });

  it('learns the words the owner adds and forgets the ones removed', () => {
    importFor(centro, 'codigo,descripcion,costo,piezas\nCH-1,Chalupa galvanizada,12,1\n');
    importFor(norte, 'codigo,descripcion,costo,piezas\nCR-1,Caja de registro galv.,11,1\n');
    expect(equivalences.propose('').proposals).toEqual([]);
    expect(equivalences.addSynonym({ term: 'Chalupa', canonical: 'Caja de registro' }, owner.id)).toEqual({ status: 'added' });
    expect(equivalences.synonyms()).toEqual([{ term: 'chalupa', canonical: 'caja de registro' }]);
    expect(equivalences.propose('').proposals.map((proposal) => proposal.items.length)).toEqual([2]);
    expect(equivalences.propose('chalupa').proposals).toHaveLength(1);
    expect(equivalences.addSynonym({ term: 'hss', canonical: 'HSS' }, owner.id)).toMatchObject({ status: 'invalid' });
    equivalences.removeSynonym('chalupa', owner.id);
    expect(equivalences.propose('').proposals).toEqual([]);
    expect(store.prepare("SELECT action FROM audit_log WHERE action LIKE 'catalog_synonym.%' ORDER BY rowid").all()).toEqual([{ action: 'catalog_synonym.add' }, { action: 'catalog_synonym.remove' }]);
  });

  it('asks Claude only for what the rules did not group, without costs or supplier names, and vetoes its mistakes', async () => {
    importFor(centro, `${CENTRO_LIST}T-1,Taquete plastico 1/4,1,1\nT-2,Taquete plastico 5/16,1,1\n`);
    importFor(norte, `${NORTE_LIST}AP-1,Ancla de nylon 6 mm,1,1\nAP-2,Ancla de nylon 8 mm,1,1\n`);
    const sent: AssistItem[][] = [];
    const assistant: EquivalenceAssistant = {
      group: (items) => {
        sent.push([...items]);
        const id = (description: string): string => items.find((item) => item.description === description)!.id;
        return Promise.resolve({
          status: 'ok',
          groups: [
            { item_ids: [id('Taquete plastico 5/16'), id('Ancla de nylon 8 mm')], reason: 'Taquete y ancla son lo mismo; 5/16" son 8 mm.', confidence: 'medium' },
            // Sizes differ: the rules veto it.
            { item_ids: [id('Taquete plastico 1/4'), id('Ancla de nylon 8 mm')], reason: 'Mal.', confidence: 'low' },
          ],
        });
      },
    };
    const withAi = new CatalogEquivalenceService(store, TENANT, audit, assistant);
    const result = await withAi.askAi('');
    expect(result).toMatchObject({ status: 'proposed', proposals: [{ origin: 'ai', score: null, confidence: 'medium', items: [{ supplierCode: 'T-2' }, { supplierCode: 'AP-2' }] }] });
    const items = sent[0]!;
    expect(items.map((item) => item.description)).not.toContain('BROCAS HSS 1/4" P/METAL');
    expect(new Set(items.map((item) => item.supplier))).toEqual(new Set(['P1', 'P2']));
    expect(JSON.stringify(items)).not.toMatch(/Ferretera|Norte|cost/u);
  });

  it('says when Claude is not configured or there is nothing to send', async () => {
    expect(equivalences.aiAvailable()).toBe(false);
    await expect(equivalences.askAi('')).resolves.toEqual({ status: 'not_configured' });
    const withAi = new CatalogEquivalenceService(store, TENANT, audit, { group: () => Promise.resolve({ status: 'ok', groups: [] }) });
    await expect(withAi.askAi('martillo')).resolves.toEqual({ status: 'nothing_to_send' });
  });

  it('answers only to the owner over the bridge', () => {
    const handlers = new Map<string, (argument: unknown, user: UserSummary) => unknown>();
    registerSupplierCatalogHandlers(
      (channel, respond) => handlers.set(channel, respond),
      (message) => new Error(message),
      { catalog, equivalences, pickFile: () => Promise.resolve(null), orders: {} as never, pickSavePath: () => Promise.resolve(null), renderPdf: () => Promise.resolve(Buffer.alloc(0)), businessName: () => '' },
    );
    const cashier: UserSummary = { ...owner, role: 'cashier' };
    expect(() => handlers.get(EQUIVALENCE_CHANNELS.proposeEquivalences)!('', cashier)).toThrow(/Only the owner/u);
    expect(handlers.get(EQUIVALENCE_CHANNELS.listSynonyms)!(undefined, owner)).toEqual([]);
    expect(() => parseApproveEquivalenceRequest({ itemIds: [], groupId: null, name: 'x', origin: 'rules', score: 1, reason: '' })).toThrow(TypeError);
    expect(() => parseApproveEquivalenceRequest({ itemIds: ['not-a-uuid'], groupId: null, name: 'x', origin: 'rules', score: 1, reason: '' })).toThrow(TypeError);
  });
});

describe('AnalyticsEquivalenceAssistant', () => {
  const items: AssistItem[] = [{ id: 'a', supplier: 'P1', description: 'Broca HSS', purchase_unit: null, pieces_per_unit: '1' }];

  it('posts the items with the token of the register and reads the groups', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ groups: [{ item_ids: ['a', 'b'], reason: 'Iguales.', confidence: 'high' }] }), { status: 200 }));
    const assistant = new AnalyticsEquivalenceAssistant('http://analytics:8000', 'secret-token', fetcher);
    await expect(assistant.group(items)).resolves.toEqual({ status: 'ok', groups: [{ item_ids: ['a', 'b'], reason: 'Iguales.', confidence: 'high' }] });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe('http://analytics:8000/catalog-matching/group');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Device secret-token');
    expect(JSON.parse(String(init?.body))).toEqual({ items });
  });

  it('turns every failure into a message in Spanish without the token', async () => {
    const offline = new AnalyticsEquivalenceAssistant('http://analytics:8000', 'secret-token', () => Promise.reject(new TypeError('fetch failed')));
    const offlineResult = await offline.group(items);
    expect(offlineResult).toMatchObject({ status: 'failed', message: expect.stringContaining('sin internet') });
    expect(JSON.stringify(offlineResult)).not.toContain('secret-token');
    const busy = new AnalyticsEquivalenceAssistant('http://analytics:8000', 't', () => Promise.resolve(new Response(JSON.stringify({ detail: 'matcher_busy' }), { status: 503 })));
    await expect(busy.group(items)).resolves.toEqual({ status: 'failed', message: 'La IA está ocupada. Intenta de nuevo en un minuto.' });
  });

  it('is built only when the address and the token are set', () => {
    expect(equivalenceAssistantFromEnvironment(undefined, 't')).toBeNull();
    expect(equivalenceAssistantFromEnvironment('http://a', ' ')).toBeNull();
    expect(equivalenceAssistantFromEnvironment('not a url', 't')).toBeNull();
    expect(equivalenceAssistantFromEnvironment('http://a:8000', 't')).toBeInstanceOf(AnalyticsEquivalenceAssistant);
  });
});
