import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { UserSummary } from '../../shared/auth';
import { DEFAULT_KEYMAP, DEFAULT_TICKET_DESIGN, isTicketDesign, TICKET_PRINT_POLICY_CHOICES, TOOLS_CHANNELS, type TicketDesign } from '../../shared/register-tools';
import { AuditLog } from '../audit/audit-log';
import { AuthService } from '../auth/auth-service';
import { UserStore } from '../auth/user-store';
import { CashService } from '../cash/cash-service';
import { CashSessionStore } from '../cash/cash-session-store';
import { parsePendingSaleRequest } from '../checkout/pending-sale-request';
import { PendingSales } from '../checkout/pending-sales';
import { TicketPrintLog } from '../checkout/ticket-print-log';
import { composeTicket, layoutTicket, renderTicket } from '../checkout/ticket/ticket';
import { RecordingPrinter } from '../hardware/fakes/recording-printer';
import { LocalStore } from '../local-store/local-store';
import { ProductCatalog } from '../local-store/product-catalog';
import { SaleStore } from '../local-store/sale-store';
import { uuidV7 } from '../uuid-v7';
import { SalesHistory } from './sales-history';
import { SwitchablePrinter } from './switchable-printer';
import { registerToolsHandlers, sampleTicket } from './tools-ipc';
import { ToolsStore } from './tools-store';

const TENANT = 'tenant-a';

let directory: string;
let store: LocalStore;
let auth: AuthService;
let sales: SaleStore;
let pending: PendingSales;
let tools: ToolsStore;
let owner: UserSummary;
let cashier: UserSummary;
let hammerId: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'tools-'));
  store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });
  auth = new AuthService(new UserStore(store, TENANT));
  const cash = new CashService(new CashSessionStore(store, TENANT), auth);
  sales = new SaleStore(store, TENANT);
  tools = new ToolsStore(store, TENANT);
  owner = auth.setupOwner('Mauricio', '4321');
  auth.login(owner.id, '4321');
  cashier = auth.createUser('Ana', 'cashier', '5555');
  cash.open(0);
  pending = new PendingSales(
    new ProductCatalog(store, TENANT),
    sales,
    () => ({ cashierId: auth.currentUser()!.id, cashSessionId: cash.openSessionId()! }),
    { auth, audit: new AuditLog(store, TENANT) },
  );
  hammerId = uuidV7();
  store.transaction((connection) => {
    connection
      .prepare("INSERT INTO product (id, tenant_id, name, base_unit, unit_price_e4, tax_factor, tax_rate_bp) VALUES (?, ?, 'Martillo', 'piece', 1000000, 'rate', 1600)")
      .run(hammerId, TENANT);
  });
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

/** Sells hammers at a price for this sale only, and completes the sale in cash. */
function sellHammer(saleUnitPriceE4: number | undefined, expectedTotalCents: number): string {
  const result = pending.save({
    idempotencyKey: uuidV7(),
    lines: [{ productId: hammerId, quantityMilli: 1000, ...(saleUnitPriceE4 === undefined ? {} : { saleUnitPriceE4 }) }],
    expectedTotalCents,
  });
  if (result.status !== 'saved') {
    throw new Error(`The sale was not saved: ${result.status}`);
  }
  sales.markCompleted(result.sale.id, [{ method: 'cash', amountCents: expectedTotalCents, reference: null }]);
  return result.sale.id;
}

describe('a price for this sale only (ADR 0061)', () => {
  it('charges the line at the price typed, leaves the catalog alone, and writes who did it', () => {
    auth.logout();
    auth.login(cashier.id, '5555');

    sellHammer(900_000, 9000);

    expect(store.prepare('SELECT unit_price_e4 FROM product WHERE id = ?').get(hammerId)).toEqual({ unit_price_e4: 1_000_000 });
    expect(store.prepare('SELECT unit_price_e4, line_total_cents FROM sale_line').all()).toEqual([{ unit_price_e4: 900_000, line_total_cents: 9000 }]);
    expect(store.prepare('SELECT user_id, action, detail FROM audit_log').all()).toEqual([
      { user_id: cashier.id, action: 'sale.price_override', detail: expect.stringContaining('catalog 1000000, charged 900000') },
    ]);
  });

  it('writes nothing in the log when the price sent is the one of the catalog', () => {
    sellHammer(1_000_000, 10_000);

    expect(store.prepare('SELECT count(*) AS total FROM audit_log').get()).toEqual({ total: 0 });
  });

  it('refuses a price that is not a positive whole number or is above the limit', () => {
    const request = (price: unknown) => ({ idempotencyKey: uuidV7(), lines: [{ productId: hammerId, quantityMilli: 1000, saleUnitPriceE4: price }], expectedTotalCents: 100 });

    for (const price of [0, -5, 1.5, '100', 10_000_000_001]) {
      expect(() => parsePendingSaleRequest(request(price)), String(price)).toThrow(TypeError);
    }
    expect(parsePendingSaleRequest(request(900_000)).lines[0]).toMatchObject({ saleUnitPriceE4: 900_000 });
  });
});

describe('the list of sales', () => {
  it('lists the completed sales newest first, with the cashier and what went back, and finds one by its folio', () => {
    sellHammer(undefined, 10_000);
    const second = sellHammer(900_000, 9000);
    const history = new SalesHistory(store, TENANT);

    expect(history.list('')).toMatchObject([
      { saleId: second, folio: 'T1-000002', totalCents: 9000, refundedCents: 0, cashierName: 'Mauricio', lineCount: 1 },
      { folio: 'T1-000001', totalCents: 10_000 },
    ]);
    expect(history.list('T1-000001').map((sale) => sale.folio)).toEqual(['T1-000001']);
    expect(history.list('2').map((sale) => sale.folio)).toEqual(['T1-000002']);
    expect(history.list('999')).toEqual([]);
  });

  it('finds a sale by the name or the code of a product sold, and says which products matched (E1-50)', () => {
    store.transaction((connection) => {
      connection.prepare('INSERT INTO product_barcode (tenant_id, code, product_id) VALUES (?, ?, ?)').run(TENANT, '7501031311309', hammerId);
    });
    const sold = sellHammer(undefined, 10_000);
    const history = new SalesHistory(store, TENANT, new ProductCatalog(store, TENANT));

    expect(history.list('martillo')).toMatchObject([{ saleId: sold, folio: 'T1-000001', matchedProducts: ['Martillo'] }]);
    expect(history.list('7501031311309')).toMatchObject([{ saleId: sold, matchedProducts: ['Martillo'] }]);
    expect(history.list('T1-000001')).toMatchObject([{ saleId: sold, matchedProducts: [] }]);
    expect(history.list('serrucho')).toEqual([]);
    // A % or a _ is only text to look for, never a wildcard that matches every sale.
    expect(history.list('%')).toEqual([]);
    expect(history.list('_')).toEqual([]);
  });

  it('says which sales were left without their ticket, until one is printed (E1-59)', () => {
    const old = sellHammer(undefined, 10_000);
    const skipped = sellHammer(undefined, 10_000);
    const printedLater = sellHammer(undefined, 10_000);
    const log = new TicketPrintLog(store, TENANT, { audit: new AuditLog(store, TENANT), currentUserId: () => cashier.id });
    log.recordNotPrinted(skipped, 'awaiting_answer');
    log.recordNotPrinted(printedLater, 'policy_never');
    log.recordPrinted(printedLater, false);
    const history = new SalesHistory(store, TENANT);

    const printed = Object.fromEntries(history.list('').map((sale) => [sale.saleId, sale.ticketPrinted]));

    // A sale from before E1-59 has no entry, and it printed its ticket right away.
    expect(printed).toEqual({ [old]: true, [skipped]: false, [printedLater]: true });
    expect([log.wasPrinted(old), log.wasPrinted(skipped), log.wasPrinted(printedLater)]).toEqual([true, false, true]);
  });
});

describe('the settings the owner keeps', () => {
  it('starts with the keys and the ticket the register was born with', () => {
    expect(tools.keymap()).toEqual(DEFAULT_KEYMAP);
    expect(tools.ticketDesign()).toEqual(DEFAULT_TICKET_DESIGN);
    expect(tools.printerShare()).toBe('');
  });

  it('keeps what was saved, and survives reopening the database', () => {
    const keymap = { ...DEFAULT_KEYMAP, checkout: 'F9', appearance: 'F12' };
    const design: TicketDesign = { ...DEFAULT_TICKET_DESIGN, headerLines: ['Av. Juárez 12', 'Tel. 555 123'], columns: 32, bigTotal: true, copies: 2 };
    tools.saveKeymap(keymap);
    tools.saveTicketDesign(design);
    tools.savePrinterShare('\\\\localhost\\TM-T20');

    const reopened = new ToolsStore(store, TENANT);

    expect(reopened.keymap()).toEqual(keymap);
    expect(reopened.ticketDesign()).toEqual(design);
    expect(reopened.printerShare()).toBe('\\\\localhost\\TM-T20');
  });

  it('goes back to the defaults when what is saved no longer makes sense, and fills in the actions added since', () => {
    const write = store.prepare('INSERT INTO register_setting (tenant_id, name, value) VALUES (?, ?, ?) ON CONFLICT (tenant_id, name) DO UPDATE SET value = excluded.value');
    store.transaction(() => {
      write.run(TENANT, 'keymap', 'not json');
      write.run(TENANT, 'ticket_design', JSON.stringify({ columns: 7 }));
    });
    expect(tools.keymap()).toEqual(DEFAULT_KEYMAP);
    expect(tools.ticketDesign()).toEqual(DEFAULT_TICKET_DESIGN);

    // A keymap saved by an older version knows only some actions.
    store.transaction(() => write.run(TENANT, 'keymap', JSON.stringify({ checkout: 'Ctrl+K', gone: 'F2' })));
    expect(tools.keymap()).toEqual({ ...DEFAULT_KEYMAP, checkout: 'Ctrl+K' });
  });

  it('asks before printing by default, and reads a design saved before E1-59 as asking too', () => {
    expect(DEFAULT_TICKET_DESIGN.printPolicy).toBe('ask');
    const { printPolicy: _absent, ...savedBefore } = { ...DEFAULT_TICKET_DESIGN, headerLines: ['Av. Juárez 12'], copies: 2 };
    store.transaction(() =>
      store.prepare('INSERT INTO register_setting (tenant_id, name, value) VALUES (?, ?, ?)').run(TENANT, 'ticket_design', JSON.stringify(savedBefore)),
    );

    expect(tools.ticketDesign()).toEqual({ ...savedBefore, printPolicy: 'ask' });
  });

  it('keeps each print policy the owner chooses, and refuses one it does not know', () => {
    for (const printPolicy of TICKET_PRINT_POLICY_CHOICES) {
      tools.saveTicketDesign({ ...DEFAULT_TICKET_DESIGN, printPolicy });
      expect(new ToolsStore(store, TENANT).ticketDesign().printPolicy).toBe(printPolicy);
    }
    expect(isTicketDesign({ ...DEFAULT_TICKET_DESIGN, printPolicy: 'sometimes' })).toBe(false);
    expect(isTicketDesign({ ...DEFAULT_TICKET_DESIGN, printPolicy: undefined })).toBe(false);
  });
});

describe('the ticket with a design', () => {
  const ticket = sampleTicket('Tlapalería Torres');

  it('prints the header and the foot of the owner, and the total in big letters', () => {
    const design: TicketDesign = { ...DEFAULT_TICKET_DESIGN, headerLines: ['Av. Juárez 12', ''], footerLines: ['Gracias', 'Cambios en 30 días'], bigTotal: true };

    const parts = composeTicket(ticket, design);

    expect(parts.slice(0, 3).map((part) => part.text)).toEqual(['Tlapalería Torres', 'Av. Juárez 12', 'Folio T1-000123']);
    expect(parts.find((part) => part.big)).toMatchObject({ bold: true, text: expect.stringMatching(/^TOTAL\s+\$134\.94$/) });
    expect(parts.find((part) => part.big)!.text).toHaveLength(24);
    expect(parts.slice(-2).map((part) => part.text)).toEqual(['Gracias', 'Cambios en 30 días']);
  });

  it('fits every line in the width of the paper, and hides what the owner turned off', () => {
    const narrow = composeTicket(ticket, { ...DEFAULT_TICKET_DESIGN, columns: 32, showUnitPrice: false, showTaxBreakdown: false });

    expect(Math.max(...narrow.map((part) => [...part.text].length))).toBeLessThanOrEqual(32);
    const text = narrow.map((part) => part.text).join('\n');
    expect(text).not.toContain('Subtotal');
    expect(text).not.toContain(' x $');
    expect(text).toContain('3.275 m Cable calibre 12');
  });

  it('prints as many tickets as copies, each one cut', () => {
    const cuts = (bytes: Uint8Array): number => bytes.reduce((count, byte, index) => (byte === 0x1d && bytes[index + 1] === 0x56 ? count + 1 : count), 0);

    expect(cuts(renderTicket(ticket))).toBe(1);
    expect(cuts(renderTicket(ticket, { ...DEFAULT_TICKET_DESIGN, copies: 3 }))).toBe(3);
  });

  it('keeps the plain ticket exactly as it was before it could be designed', () => {
    expect(layoutTicket(ticket)).toEqual(layoutTicket(ticket, DEFAULT_TICKET_DESIGN));
    expect(layoutTicket(ticket).at(-1)).toMatch(/^Cambio\s+\$15\.06$/);
  });
});

describe('the printer set from the settings', () => {
  it('prints on the printer that is set right now, without a restart, and on the fallback while there is none', async () => {
    const fallback = new RecordingPrinter();
    const real = new RecordingPrinter();
    const opened: string[] = [];
    const printer = new SwitchablePrinter(() => tools.printerShare(), fallback, (share) => {
      opened.push(share);
      return real;
    });

    await printer.print(new Uint8Array([1]));
    expect(printer.isConfigured()).toBe(false);
    expect(fallback.jobs).toHaveLength(1);

    tools.savePrinterShare('\\\\localhost\\TM-T20');
    await printer.print(new Uint8Array([2]));

    expect(printer.isConfigured()).toBe(true);
    expect(opened).toEqual(['\\\\localhost\\TM-T20']);
    expect(real.jobs).toHaveLength(1);
    expect(fallback.jobs).toHaveLength(1);
  });
});

describe('the handlers of the settings', () => {
  type Handler = (argument: unknown, user: UserSummary) => unknown;

  function handlers(): Map<string, Handler> {
    const registered = new Map<string, Handler>();
    registerToolsHandlers((channel, respond) => registered.set(channel, respond as Handler), (message) => new Error(message), {
      store: tools,
      history: new SalesHistory(store, TENANT),
      printer: new SwitchablePrinter(() => tools.printerShare(), new RecordingPrinter()),
      audit: new AuditLog(store, TENANT),
      businessName: () => 'Tlapalería Torres',
    });
    return registered;
  }

  it('lets only the owner save the keys, the ticket and the printer', () => {
    const registered = handlers();

    for (const [channel, value] of [
      [TOOLS_CHANNELS.saveKeymap, DEFAULT_KEYMAP],
      [TOOLS_CHANNELS.saveTicketDesign, DEFAULT_TICKET_DESIGN],
      [TOOLS_CHANNELS.savePrinter, 'TM-T20'],
    ] as const) {
      expect(() => registered.get(channel)!(value, cashier), channel).toThrow(/Only the owner/);
    }
    expect(registered.get(TOOLS_CHANNELS.savePrinter)!('TM-T20', owner)).toEqual({ status: 'saved', share: '\\\\localhost\\TM-T20' });
    expect(registered.get(TOOLS_CHANNELS.savePrinter)!('C:\\nope', owner)).toEqual({ status: 'invalid' });
    expect(() => registered.get(TOOLS_CHANNELS.saveKeymap)!({ ...DEFAULT_KEYMAP, misc: 'F12' }, owner)).toThrow(TypeError);
  });

  it('draws the sample ticket centered in the width of the design, for anyone signed in', () => {
    const lines = handlers().get(TOOLS_CHANNELS.previewTicket)!({ ...DEFAULT_TICKET_DESIGN, columns: 32 }, cashier) as string[];

    expect(lines[0]).toBe(`${' '.repeat(7)}Tlapalería Torres`);
    expect(lines.every((line) => [...line].length <= 32)).toBe(true);
  });

  it('says there is no printer on a test print before one is set', async () => {
    expect(await handlers().get(TOOLS_CHANNELS.testPrint)!(undefined, owner)).toEqual({ status: 'no_printer' });
  });

  it('leaves in the audit log a sale that was dropped before it was charged', () => {
    const registered = handlers();

    registered.get(TOOLS_CHANNELS.recordSaleCancelled)!({ lineCount: 3, totalCents: 45_000 }, cashier);

    expect(store.prepare('SELECT user_id, action, detail FROM audit_log').all()).toEqual([
      { user_id: cashier.id, action: 'sale.dropped_before_payment', detail: '3 lines, 45000 cents, dropped before it was charged' },
    ]);
    expect(() => registered.get(TOOLS_CHANNELS.recordSaleCancelled)!({ lineCount: 0, totalCents: 1 }, cashier)).toThrow(TypeError);
  });
});
