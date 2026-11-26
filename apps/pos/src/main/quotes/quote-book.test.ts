import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserSummary } from '../../shared/auth';
import { addDays, localDay, parseQuoteFolio, QUOTE_VALIDITY_DAYS, type SaveQuoteRequest } from '../../shared/quotes';
import { DEFAULT_TICKET_DESIGN } from '../../shared/register-tools';
import { AuditLog } from '../audit/audit-log';
import type { OwnerAuthorization } from '../auth/auth-service';
import { LocalStore } from '../local-store/local-store';
import { ProductCatalog } from '../local-store/product-catalog';
import { uuidV7 } from '../uuid-v7';
import { QuoteBook } from './quote-book';
import { composeQuoteTicket } from './quote-ticket';

const TENANT = 'tenant-a';
const OWNER: UserSummary = { id: '0190f0d0-0000-7000-8000-000000000001', name: 'Mauricio', role: 'owner' };
const CASHIER: UserSummary = { id: '0190f0d0-0000-7000-8000-000000000002', name: 'Ana', role: 'cashier' };
const OTHER_CASHIER: UserSummary = { id: '0190f0d0-0000-7000-8000-000000000003', name: 'Luis', role: 'cashier' };
/** $116.00 with VAT. */
const HAMMER_PRICE_E4 = 1_160_000;
/** $25.00 a meter, with VAT. */
const CABLE_PRICE_E4 = 250_000;

let directory: string;
let store: LocalStore;
let clock: Date;
let book: QuoteBook;
let authorize: ReturnType<typeof vi.fn<(pin: string) => OwnerAuthorization>>;
let hammer: string;
let cable: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'quotes-'));
  store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });
  clock = new Date(2026, 10, 25, 12, 0, 0);
  authorize = vi.fn((pin: string): OwnerAuthorization => (pin === '1234' ? { status: 'ok', owner: OWNER } : { status: 'wrong_pin', attemptsLeft: 4 }));
  book = new QuoteBook(store, TENANT, { catalog: new ProductCatalog(store, TENANT), audit: new AuditLog(store, TENANT), authorizeOwnerPin: authorize, now: () => clock });
  for (const user of [OWNER, CASHIER, OTHER_CASHIER]) {
    store.prepare("INSERT INTO app_user (id, tenant_id, name, role, pin_hash, created_at) VALUES (?, ?, ?, ?, 'x', '2026-01-01T00:00:00.000Z')").run(user.id, TENANT, user.name, user.role);
  }
  hammer = addProduct('Martillo de uña', 'piece', HAMMER_PRICE_E4);
  cable = addProduct('Cable THW calibre 12', 'meter', CABLE_PRICE_E4);
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function addProduct(name: string, unit: string, priceE4: number): string {
  const id = uuidV7();
  store.prepare("INSERT INTO product (id, tenant_id, name, base_unit, unit_price_e4, tax_factor, tax_rate_bp) VALUES (?, ?, ?, ?, ?, 'rate', 1600)").run(id, TENANT, name, unit, priceE4);
  return id;
}

function setPrice(productId: string, priceE4: number): void {
  store.prepare('UPDATE product SET unit_price_e4 = ? WHERE id = ?').run(priceE4, productId);
}

function today(): string {
  return localDay(clock);
}

function request(overrides: Partial<SaveQuoteRequest> = {}): SaveQuoteRequest {
  return {
    quoteId: null,
    idempotencyKey: crypto.randomUUID(),
    customerName: 'Martín López',
    customerPhone: '55 1234 5678',
    notes: 'Entrega en obra',
    validUntil: addDays(today(), QUOTE_VALIDITY_DAYS),
    lines: [
      { productId: hammer, quantityMilli: 2000 },
      { productId: cable, quantityMilli: 3500 },
    ],
    ...overrides,
  };
}

function create(overrides: Partial<SaveQuoteRequest> = {}, user: UserSummary = CASHIER): string {
  const result = book.save(request(overrides), user);
  if (result.status !== 'saved') {
    throw new Error(`Expected a saved quote, got ${JSON.stringify(result)}`);
  }
  return result.quote.id;
}

function count(table: string): number {
  return (store.prepare(`SELECT count(*) AS total FROM ${table}`).get() as { total: number }).total;
}

function completeSale(): string {
  const sessionId = uuidV7();
  const saleId = uuidV7();
  store.prepare("INSERT INTO cash_session (id, tenant_id, opened_by, opened_at, opening_float_cents) VALUES (?, ?, ?, '2026-11-25T18:00:00.000Z', 0)").run(sessionId, TENANT, CASHIER.id);
  store
    .prepare(
      "INSERT INTO sale (id, tenant_id, idempotency_key, status, subtotal_cents, tax_cents, total_cents, occurred_at, cash_session_id) VALUES (?, ?, ?, 'pending_payment', 100, 16, 116, '2026-11-25T18:00:00.000Z', ?)",
    )
    .run(saleId, TENANT, crypto.randomUUID(), sessionId);
  store.prepare("INSERT INTO payment (id, tenant_id, sale_id, method, amount_cents, recorded_at) VALUES (?, ?, ?, 'cash', 116, '2026-11-25T18:00:00.000Z')").run(uuidV7(), TENANT, saleId);
  store.prepare("UPDATE sale SET status = 'completed', resolved_at = '2026-11-25T18:00:00.000Z', folio = 7 WHERE id = ?").run(saleId);
  return saleId;
}

describe('QuoteBook.save', () => {
  it('creates a quote with folio, customer, notes, the prices of the catalog and a draft history', () => {
    const quote = book.get(create())!;

    expect(quote).toMatchObject({
      folio: 'COT-000001',
      customerName: 'Martín López',
      customerPhone: '55 1234 5678',
      notes: 'Entrega en obra',
      validUntil: '2026-12-10',
      status: 'draft',
      createdByName: 'Ana',
      saleId: null,
      timesPrinted: 0,
    });
    expect(quote.lines.map((line) => [line.productName, line.quantity.milli, line.unitPriceE4, line.totalCents])).toEqual([
      ['Martillo de uña', 2000, HAMMER_PRICE_E4, 23_200],
      ['Cable THW calibre 12', 3500, CABLE_PRICE_E4, 8_750],
    ]);
    expect(quote.totalCents).toBe(31_950);
    expect(quote.subtotalCents + quote.taxCents).toBe(quote.totalCents);
    expect(quote.history).toEqual([{ status: 'draft', at: clock.toISOString(), byName: 'Ana', note: null }]);
  });

  it('never moves stock and never writes a sale, a payment or a cash movement', () => {
    const stock = count('stock_movement');
    create();
    create();

    expect(count('stock_movement')).toBe(stock);
    expect(count('sale')).toBe(0);
    expect(count('payment')).toBe(0);
    expect(count('cash_movement')).toBe(0);
    expect(book.list({ text: '', status: 'all' }).map((quote) => quote.folio)).toEqual(['COT-000002', 'COT-000001']);
  });

  it('returns the same quote when the screen sends it twice', () => {
    const key = crypto.randomUUID();
    const first = create({ idempotencyKey: key });
    const second = create({ idempotencyKey: key });

    expect(second).toBe(first);
    expect(count('quote')).toBe(1);
  });

  it('joins a product sent twice and refuses what makes no sense', () => {
    const quote = book.get(create({ lines: [{ productId: hammer, quantityMilli: 1000 }, { productId: hammer, quantityMilli: 2000 }] }))!;
    expect(quote.lines.map((line) => line.quantity.milli)).toEqual([3000]);

    expect(book.save(request({ lines: [] }), CASHIER)).toMatchObject({ status: 'invalid', message: 'Agrega al menos un producto a la cotización.' });
    expect(book.save(request({ lines: [{ productId: hammer, quantityMilli: 1500 }] }), CASHIER)).toMatchObject({ status: 'invalid' });
    expect(book.save(request({ validUntil: addDays(today(), -1) }), CASHIER)).toMatchObject({ status: 'invalid', message: 'La vigencia no puede terminar antes de hoy.' });
    expect(book.save(request({ validUntil: '2026-02-30' }), CASHIER)).toMatchObject({ status: 'invalid' });
    expect(book.save(request({ customerPhone: 'llámale' }), CASHIER)).toMatchObject({ status: 'invalid' });
    expect(book.save(request({ lines: [{ productId: uuidV7(), quantityMilli: 1000 }] }), CASHIER)).toMatchObject({ status: 'invalid' });
  });

  it('edits a valid draft keeping the quoted price of the products it already had', () => {
    const quoteId = create();
    setPrice(hammer, 1_300_000);
    const anvil = addProduct('Yunque', 'piece', 5_000_000);

    const result = book.save(request({ quoteId, customerName: '  Martín  López Ruiz ', lines: [{ productId: hammer, quantityMilli: 1000 }, { productId: anvil, quantityMilli: 1000 }] }), OTHER_CASHIER);

    expect(result.status).toBe('saved');
    const quote = book.get(quoteId)!;
    expect(quote.customerName).toBe('Martín López Ruiz');
    expect(quote.folio).toBe('COT-000001');
    expect(quote.lines.map((line) => [line.productName, line.unitPriceE4, line.currentPriceE4])).toEqual([
      ['Martillo de uña', HAMMER_PRICE_E4, 1_300_000],
      ['Yunque', 5_000_000, 5_000_000],
    ]);
  });

  it('quotes an expired draft again at today’s prices when it is edited', () => {
    const quoteId = create({ validUntil: today() });
    setPrice(hammer, 1_300_000);
    clock = new Date(2026, 10, 26, 9, 0, 0);
    expect(book.get(quoteId)!.status).toBe('expired');

    book.save(request({ quoteId, validUntil: addDays(today(), 5) }), CASHIER);

    const quote = book.get(quoteId)!;
    expect(quote.status).toBe('draft');
    expect(quote.lines[0]!.unitPriceE4).toBe(1_300_000);
  });
});

describe('QuoteBook expiry', () => {
  it('is valid through its last day and expired the day after, without writing anything', () => {
    const quoteId = create({ validUntil: '2026-11-30' });
    const events = count('quote_status');

    clock = new Date(2026, 10, 30, 23, 59, 0);
    expect(book.get(quoteId)!.status).toBe('draft');
    clock = new Date(2026, 11, 1, 0, 0, 0);
    expect(book.get(quoteId)!.status).toBe('expired');
    expect(book.list({ text: '', status: 'expired' })).toHaveLength(1);
    expect(book.list({ text: '', status: 'draft' })).toHaveLength(0);
    expect(count('quote_status')).toBe(events);
  });
});

describe('QuoteBook.list', () => {
  it('finds quotes by folio, customer, phone and product, without minding accents or capitals', () => {
    create({ customerName: 'Martín López' });
    create({ customerName: 'Rosa', customerPhone: '33 9876 5432', lines: [{ productId: cable, quantityMilli: 1000 }] });
    const folios = (text: string): string[] => book.list({ text, status: 'all' }).map((quote) => quote.folio);

    expect(folios('cot-2')).toEqual(['COT-000002']);
    expect(folios('COT-000001')).toEqual(['COT-000001']);
    expect(folios('MARTIN')).toEqual(['COT-000001']);
    expect(folios('9876')).toEqual(['COT-000002']);
    expect(folios('martillo')).toEqual(['COT-000001']);
    expect(folios('cable')).toEqual(['COT-000002', 'COT-000001']);
  });

  it('reads folios the way people type them', () => {
    expect(parseQuoteFolio('COT-000012')).toBe(12);
    expect(parseQuoteFolio('cot 7')).toBe(7);
    expect(parseQuoteFolio('martillo')).toBeNull();
  });
});

describe('QuoteBook.cancel', () => {
  it('lets its author cancel it, keeps the reason in the history and leaves it closed', () => {
    const quoteId = create();

    const result = book.cancel({ quoteId, reason: 'El cliente compró en otro lado' }, CASHIER);

    expect(result.status).toBe('cancelled');
    const quote = book.get(quoteId)!;
    expect(quote.status).toBe('cancelled');
    expect(quote.history.at(-1)).toMatchObject({ status: 'cancelled', note: 'El cliente compró en otro lado', byName: 'Ana' });
    expect(book.save(request({ quoteId }), CASHIER)).toEqual({ status: 'not_editable' });
    expect(book.cancel({ quoteId, reason: 'otra vez' }, CASHIER)).toEqual({ status: 'not_cancellable' });
    expect(book.prepareConversion(quoteId).status).toBe('not_convertible');
  });

  it('asks a cashier for the PIN of an owner to cancel a quote somebody else made', () => {
    const quoteId = create({}, OTHER_CASHIER);

    expect(book.cancel({ quoteId, reason: 'Duplicada' }, CASHIER)).toEqual({ status: 'owner_pin_required' });
    expect(book.cancel({ quoteId, reason: 'Duplicada', ownerPin: '9999' }, CASHIER)).toEqual({ status: 'wrong_pin', attemptsLeft: 4 });
    expect(book.cancel({ quoteId, reason: 'Duplicada', ownerPin: '1234' }, CASHIER).status).toBe('cancelled');
    expect(book.cancel({ quoteId: create({}, OTHER_CASHIER), reason: 'Duplicada' }, OWNER).status).toBe('cancelled');
    expect(book.cancel({ quoteId: create(), reason: '  ' }, CASHIER)).toMatchObject({ status: 'invalid' });
  });

  it('refuses to change the history once it is written', () => {
    create();
    expect(() => store.prepare("UPDATE quote_status SET status = 'cancelled'").run()).toThrow(/only grows/);
    expect(() => store.prepare('DELETE FROM quote_status').run()).toThrow(/only grows/);
    expect(() => store.prepare('DELETE FROM quote').run()).toThrow(/never deleted/);
  });
});

describe('QuoteBook conversion', () => {
  it('sells a valid quote at its quoted prices, even when the catalog changed', () => {
    const quoteId = create();
    setPrice(hammer, 1_300_000);

    const result = book.prepareConversion(quoteId);

    expect(result).toMatchObject({ status: 'ready', folio: 'COT-000001', isExpired: false, skipped: [] });
    if (result.status !== 'ready') {
      throw new Error('not ready');
    }
    expect(result.lines.map((line) => [line.product.name, line.product.unitPriceE4, line.chargedPriceE4, line.quantityMilli])).toEqual([
      ['Martillo de uña', 1_300_000, HAMMER_PRICE_E4, 2000],
      ['Cable THW calibre 12', CABLE_PRICE_E4, CABLE_PRICE_E4, 3500],
    ]);
  });

  it('sells an expired quote at today’s prices, and leaves out what is no longer sold', () => {
    const quoteId = create({ validUntil: today() });
    setPrice(hammer, 1_300_000);
    store.prepare('UPDATE product SET is_active = 0 WHERE id = ?').run(cable);
    clock = new Date(2026, 10, 27, 9, 0, 0);

    const result = book.prepareConversion(quoteId);

    expect(result).toMatchObject({ status: 'ready', isExpired: true, skipped: ['Cable THW calibre 12'] });
    expect(result.status === 'ready' && result.lines.map((line) => line.chargedPriceE4)).toEqual([1_300_000]);
  });

  it('marks the quote as sold with its sale, once, and only with a collected sale', () => {
    const quoteId = create();
    const saleId = completeSale();

    expect(book.markConverted({ quoteId, saleId: uuidV7() }, CASHIER)).toMatchObject({ status: 'not_convertible' });
    expect(book.markConverted({ quoteId, saleId }, CASHIER)).toEqual({ status: 'converted' });

    const quote = book.get(quoteId)!;
    expect(quote).toMatchObject({ status: 'converted', saleId });
    expect(quote.history.map((event) => [event.status, event.note])).toEqual([
      ['draft', null],
      ['converted', 'Venta T1-000007'],
    ]);
    expect(book.markConverted({ quoteId, saleId }, CASHIER)).toMatchObject({ status: 'not_convertible' });
    expect(book.markConverted({ quoteId: create(), saleId }, CASHIER)).toEqual({ status: 'not_convertible', message: 'Esa venta ya es de otra cotización.' });
    expect(book.save(request({ quoteId }), CASHIER)).toEqual({ status: 'not_editable' });
    expect(book.cancel({ quoteId, reason: 'x' }, OWNER)).toEqual({ status: 'not_cancellable' });
  });

  it('writes the audit log for each step', () => {
    const quoteId = create();
    book.recordPrint(quoteId, CASHIER.id);
    book.markConverted({ quoteId, saleId: completeSale() }, CASHIER);
    const actions = (store.prepare("SELECT action FROM audit_log WHERE entity = 'quote' ORDER BY rowid").all() as { action: string }[]).map((row) => row.action);

    expect(actions).toEqual(['quote.created', 'quote.printed', 'quote.converted']);
  });
});

describe('composeQuoteTicket', () => {
  it('prints «COTIZACIÓN», its validity and that it is not a sale, and marks the reprints', () => {
    const quoteId = create();
    const first = book.recordPrint(quoteId, CASHIER.id)!;
    const second = book.recordPrint(quoteId, CASHIER.id)!;
    const text = (isReprint: boolean, quote = first.quote): string[] => composeQuoteTicket(quote, 'Tlapalería', DEFAULT_TICKET_DESIGN, isReprint).map((part) => part.text);

    const lines = text(first.isReprint);
    expect(first.isReprint).toBe(false);
    expect(lines).toContain('COTIZACIÓN');
    expect(lines).toContain('Folio COT-000001');
    expect(lines.some((line) => line.startsWith('Válida hasta el 10 dic 2026'))).toBe(true);
    expect(lines).toContain('Este documento no es una venta');
    expect(lines).not.toContain('REIMPRESIÓN');
    expect(lines.some((line) => line.startsWith('TOTAL') && line.endsWith('$319.50'))).toBe(true);
    expect(second.isReprint).toBe(true);
    expect(text(true, second.quote)).toContain('REIMPRESIÓN');
  });
});
