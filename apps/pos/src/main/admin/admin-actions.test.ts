import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { StockStore } from '../inventory/stock-store';
import { CatalogImporter } from '../import/catalog-importer';
import { LocalStore } from '../local-store/local-store';
import { ProductCatalog } from '../local-store/product-catalog';
import { CashSessionStore } from '../cash/cash-session-store';
import { AdminActions, BACKUPS_TO_KEEP } from './admin-actions';

const TENANT = 'tenant-a';
const FILE = 'Código,Descripción,Precio Costo,Precio Venta,Existencia,Unidad\n7501,Martillo uña,80,116,12,Pieza';

let directory: string;
let store: LocalStore;
let picked: { file: string | null; folder: string | null };
let vaultValue: string | null;
let clock: Date;
let actions: AdminActions;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'admin-'));
  mkdirSync(join(directory, 'usb'));
  store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });
  picked = { file: null, folder: join(directory, 'usb') };
  vaultValue = null;
  clock = new Date('2026-11-08T20:00:00.000Z');
  // The settings live in the same table the cash limit uses.
  const settings = new CashSessionStore(store, TENANT);
  actions = new AdminActions({
    store,
    importer: new CatalogImporter(store, TENANT, new StockStore(store, TENANT)),
    settings,
    vault: { read: () => vaultValue, save: (value) => void (vaultValue = value) },
    userDataDirectory: directory,
    pickFile: () => Promise.resolve(picked.file),
    pickFolder: () => Promise.resolve(picked.folder),
    now: () => clock,
  });
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

describe('importing the catalog', () => {
  it('loads the file the owner chooses and reports what it did', async () => {
    picked.file = join(directory, 'productos.csv');
    writeFileSync(picked.file, FILE);

    const outcome = await actions.importCatalog();

    expect(outcome).toMatchObject({ status: 'done', report: { created: 1, openingBalances: 1, inventoryValueCents: 96_000 } });
    expect(new ProductCatalog(store, TENANT).findByCode('7501')).not.toBeNull();
  });

  it('reads a file saved by Excel in the code page of Windows without breaking the accents', async () => {
    picked.file = join(directory, 'productos.csv');
    writeFileSync(picked.file, Buffer.from(FILE.replace('Martillo uña', 'Martillo uña'), 'latin1'));

    await actions.importCatalog();

    expect(new ProductCatalog(store, TENANT).findByCode('7501')?.name).toBe('Martillo uña');
  });

  it('does nothing when the owner closes the window, and says why when the file cannot be understood', async () => {
    expect(await actions.importCatalog()).toEqual({ status: 'cancelled' });

    picked.file = join(directory, 'otra-cosa.csv');
    writeFileSync(picked.file, 'Nombre,Algo\nA,B');
    expect(await actions.importCatalog()).toMatchObject({ status: 'unreadable', message: expect.stringContaining('código') });

    picked.file = join(directory, 'no-existe.csv');
    expect(await actions.importCatalog()).toMatchObject({ status: 'unreadable', message: expect.stringContaining('No se pudo leer') });
  });
});

describe('the backups', () => {
  it('start unconfigured, and cannot run until they are set up', () => {
    expect(actions.backupStatus()).toEqual({ folder: null, lastBackupAt: null, lastError: null });
    expect(actions.backupNow()).toEqual({ status: 'not_configured' });
  });

  it('are set up with a folder and a passphrase, and make the first copy at once', async () => {
    const outcome = await actions.configureBackup('una contraseña larga');

    expect(outcome).toMatchObject({ status: 'done', backup: { folder: picked.folder, lastBackupAt: clock.toISOString(), lastError: null } });
    expect(readdirSync(picked.folder!)).toEqual(['pos-2026-11-08T20-00-00.posbak']);
    expect(vaultValue).toBe('una contraseña larga');
  });

  it('are not set up when the system cannot protect the passphrase, instead of keeping it in plain text', async () => {
    const unprotected = new AdminActions({
      store,
      importer: new CatalogImporter(store, TENANT, new StockStore(store, TENANT)),
      settings: new CashSessionStore(store, TENANT),
      vault: {
        read: () => null,
        save: () => {
          throw new Error('no encryption available');
        },
      },
      userDataDirectory: directory,
      pickFile: () => Promise.resolve(null),
      pickFolder: () => Promise.resolve(picked.folder),
    });

    const outcome = await unprotected.configureBackup('una contraseña larga');

    expect(outcome).toMatchObject({ status: 'failed', message: expect.stringContaining('proteger'), backup: { folder: null } });
    expect(readdirSync(picked.folder!)).toEqual([]);
  });

  it('refuse a short passphrase, and ask for nothing else', async () => {
    expect(await actions.configureBackup('corta')).toEqual({ status: 'weak_passphrase' });
    expect(vaultValue).toBeNull();
  });

  it('do nothing when the owner does not choose a folder', async () => {
    picked.folder = null;

    expect(await actions.configureBackup('una contraseña larga')).toMatchObject({ status: 'cancelled' });
    expect(vaultValue).toBeNull();
  });

  it('keep only the newest copies, so the USB does not fill up', async () => {
    await actions.configureBackup('una contraseña larga');
    for (let hour = 1; hour <= BACKUPS_TO_KEEP + 2; hour += 1) {
      clock = new Date(clock.getTime() + 3_600_000);
      actions.backupNow();
    }

    expect(readdirSync(picked.folder!)).toHaveLength(BACKUPS_TO_KEEP);
  });

  it('say that a copy failed, and keep saying it until one works, so a stopped backup is not a secret', async () => {
    await actions.configureBackup('una contraseña larga');
    rmSync(picked.folder!, { recursive: true, force: true });
    writeFileSync(picked.folder!, 'now a file, not a folder');

    const failed = actions.backupNow();

    expect(failed).toMatchObject({ status: 'failed', message: expect.stringContaining('USB'), backup: { lastError: expect.any(String) } });
    expect(actions.backupStatus().lastError).not.toBeNull();
    rmSync(picked.folder!);
    mkdirSync(picked.folder!);
    expect(actions.backupNow()).toMatchObject({ status: 'done', backup: { lastError: null } });
  });
});

describe('restoring a backup', () => {
  it('prepares a healthy backup to be used when the register restarts', async () => {
    await actions.configureBackup('una contraseña larga');
    picked.file = join(picked.folder!, readdirSync(picked.folder!)[0]!);

    expect(await actions.restoreBackup('una contraseña larga')).toEqual({ status: 'staged' });
    expect(readdirSync(directory)).toContain('pos.restore-pending.db');
  });

  it('says so when the passphrase is wrong, or nothing was chosen', async () => {
    await actions.configureBackup('una contraseña larga');
    picked.file = join(picked.folder!, readdirSync(picked.folder!)[0]!);

    expect(await actions.restoreBackup('otra contraseña')).toMatchObject({ status: 'failed', message: expect.stringContaining('contraseña') });
    picked.file = null;
    expect(await actions.restoreBackup('una contraseña larga')).toEqual({ status: 'cancelled' });
    expect(readdirSync(directory)).not.toContain('pos.restore-pending.db');
  });
});
