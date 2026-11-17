import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserSummary } from '../../shared/auth';
import { MISSING_CHANNELS, missingItemKey, type MissingItemsReport } from '../../shared/missing-items';
import { AuditLog } from '../audit/audit-log';
import { LocalStore } from '../local-store/local-store';
import { exportMissingItems, missingItemsHtml } from './missing-items-export';
import { registerMissingItemsHandlers } from './missing-items-ipc';
import { MissingItemsLog } from './missing-items-log';

const TENANT = 'tenant-a';
const OWNER: UserSummary = { id: '0190f0d0-0000-7000-8000-000000000001', name: 'Mauricio', role: 'owner' };
const CASHIER: UserSummary = { id: '0190f0d0-0000-7000-8000-000000000002', name: 'Ana', role: 'cashier' };

let directory: string;
let store: LocalStore;
let clock: Date;
let log: MissingItemsLog;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'missing-'));
  store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });
  // A Wednesday at noon, so the week started two days before.
  clock = new Date(2026, 10, 18, 12, 0, 0);
  log = new MissingItemsLog(store, TENANT, new AuditLog(store, TENANT), () => clock);
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function ask(description: string, daysAgo = 0, quantity: number | null = null, notes: string | null = null): void {
  const now = clock;
  clock = new Date(now.getTime() - daysAgo * 86_400_000);
  log.record({ description, quantity, notes }, CASHIER.id);
  clock = now;
}

describe('missingItemKey', () => {
  it('gathers the same thing written with other accents, capitals or spaces', () => {
    expect(missingItemKey('  Pintura  VINÍLICA azul ')).toBe('pintura vinilica azul');
  });
});

describe('MissingItemsLog', () => {
  it('counts each time the same thing is asked for, however it is written', () => {
    ask('Taquete de 1/4');
    ask('taquete  de 1/4', 1, 50, 'Fischer');
    const result = log.record({ description: 'TAQUETE DE 1/4', quantity: 20, notes: 'Fischer' }, CASHIER.id);

    expect(result).toEqual({ status: 'recorded', timesAsked: 3 });
    const [group] = log.report(30).groups;
    expect(group).toMatchObject({ key: 'taquete de 1/4', description: 'TAQUETE DE 1/4', timesAsked: 3, quantityAsked: 70, notes: ['Fischer'], status: 'pending' });
  });

  it('puts the most asked first and leaves out what was asked before the period', () => {
    ask('Lija 100');
    ask('Silicón transparente');
    ask('Silicón transparente', 3);
    ask('Brocha de 4"', 45);

    const report = log.report(30);

    expect(report.groups.map((group) => group.description)).toEqual(['Silicón transparente', 'Lija 100']);
    expect(report.totalRequests).toBe(3);
    expect(log.report(90).groups).toHaveLength(3);
  });

  it('counts by week, empty weeks too, and by day of the week', () => {
    ask('Foco ahorrador');
    ask('Foco ahorrador', 7);

    const report = log.report(30);

    expect(report.byWeek.at(-1)).toEqual({ key: '2026-11-16', count: 1 });
    expect(report.byWeek.at(-2)).toEqual({ key: '2026-11-09', count: 1 });
    expect(report.byWeek.some((week) => week.count === 0)).toBe(true);
    expect(report.byWeekday[3]).toEqual({ key: '3', count: 2 });
  });

  it('refuses an empty description, a long one and a quantity that is not a whole number', () => {
    expect(log.record({ description: '   ', quantity: null, notes: null }, CASHIER.id).status).toBe('invalid');
    expect(log.record({ description: 'x'.repeat(81), quantity: null, notes: null }, CASHIER.id).status).toBe('invalid');
    expect(log.record({ description: 'Clavo', quantity: 1.5, notes: null }, CASHIER.id).status).toBe('invalid');
    expect(log.report(0).totalRequests).toBe(0);
  });

  it('keeps what the owner decided, can go back to pending, and leaves it in the audit log', () => {
    ask('Manguera de 1/2');
    log.resolve('manguera de 1/2', 'added', OWNER.id);
    expect(log.report(30).groups[0]?.status).toBe('added');

    log.resolve('manguera de 1/2', 'pending', OWNER.id);

    expect(log.report(30).groups[0]?.status).toBe('pending');
    const entries = store.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE action = 'missing_item.resolved'").get() as { count: number };
    expect(entries.count).toBe(2);
  });

  it('never changes a request once written', () => {
    ask('Cinta de aislar');

    expect(() => store.prepare("UPDATE missing_item_request SET description = 'otra cosa'").run()).toThrow(/never changes/u);
  });
});

describe('the PDF of the log', () => {
  function aReport(): MissingItemsReport {
    ask('Tornillo <b>de</b> 2"');
    ask('Tornillo <b>de</b> 2"', 2);
    ask('Pegamento epóxico');
    return log.report(30);
  }

  it('has the totals, the three charts and every item, with the text escaped', () => {
    const html = missingItemsHtml(aReport(), 'Tlapalería Torres');

    expect(html).toContain('Tlapalería Torres');
    expect(html).toContain('Bitácora de faltantes · Últimos 30 días');
    expect(html.match(/<svg /gu)).toHaveLength(3);
    expect(html).toContain('Tornillo &lt;b&gt;de&lt;/b&gt; 2&quot;');
    expect(html).not.toContain('<b>de</b>');
    expect(html).toContain("default-src 'none'");
  });

  it('says so when nothing was written down', () => {
    expect(missingItemsHtml(log.report(30), 'Tienda')).toContain('No se anotó ningún faltante');
  });

  it('saves where the person chose, and says when it could not', async () => {
    const writeFile = vi.fn();
    const dependencies = { report: () => aReport(), pickSavePath: () => Promise.resolve('C:\\faltantes.pdf'), renderPdf: () => Promise.resolve(Buffer.from('%PDF')), businessName: () => 'Tienda', writeFile };

    expect(await exportMissingItems(30, dependencies)).toEqual({ status: 'saved', path: 'C:\\faltantes.pdf' });
    expect(writeFile).toHaveBeenCalledOnce();
    expect(await exportMissingItems(30, { ...dependencies, pickSavePath: () => Promise.resolve(null) })).toEqual({ status: 'cancelled' });
    expect((await exportMissingItems(30, { ...dependencies, renderPdf: () => Promise.reject(new Error('no')) })).status).toBe('failed');
  });
});

describe('the channels of the log', () => {
  type Handler = (argument: unknown, user: UserSummary) => unknown;

  function handlers(): Map<string, Handler> {
    const registered = new Map<string, Handler>();
    registerMissingItemsHandlers((channel, respond) => registered.set(channel, respond as Handler), (message) => new Error(message), {
      log,
      exporter: { pickSavePath: () => Promise.resolve(null), renderPdf: () => Promise.resolve(Buffer.from('')), businessName: () => 'Tienda' },
    });
    return registered;
  }

  it('lets anyone write down and read, and only the owner decide', () => {
    const registered = handlers();
    const call = (channel: string, argument: unknown, user: UserSummary): unknown => registered.get(channel)?.(argument, user);

    expect(call(MISSING_CHANNELS.record, { description: 'Bisagra de 3"', quantity: 4, notes: null }, CASHIER)).toEqual({ status: 'recorded', timesAsked: 1 });
    expect((call(MISSING_CHANNELS.report, 30, CASHIER) as MissingItemsReport).totalRequests).toBe(1);
    expect(() => call(MISSING_CHANNELS.resolve, { key: 'bisagra de 3"', status: 'added' }, CASHIER)).toThrow(/owner/u);
    call(MISSING_CHANNELS.resolve, { key: 'bisagra de 3"', status: 'dismissed' }, OWNER);
    expect((call(MISSING_CHANNELS.report, 30, OWNER) as MissingItemsReport).groups[0]?.status).toBe('dismissed');
  });

  it('refuses what is not shaped as the bridge sends it', () => {
    const registered = handlers();
    const call = (channel: string, argument: unknown): unknown => registered.get(channel)?.(argument, OWNER);

    expect(() => call(MISSING_CHANNELS.report, 7)).toThrow(TypeError);
    expect(() => call(MISSING_CHANNELS.record, { description: 5 })).toThrow(TypeError);
    expect(() => call(MISSING_CHANNELS.record, { description: 'Clavo', quantity: '3' })).toThrow(TypeError);
    expect(() => call(MISSING_CHANNELS.resolve, { key: 'clavo', status: 'sold' })).toThrow(TypeError);
  });
});
