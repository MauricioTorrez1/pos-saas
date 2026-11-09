import { readFileSync } from 'node:fs';

import { test as base, expect, type ElectronApplication } from '@playwright/test';

import { MIGRATIONS } from '../src/main/local-store/migrations';
import {
  createTemporaryUserData,
  forceClose,
  launchRegister,
  leaveSaleUnfinished,
  readConfirmedSales,
  readMainPid,
  readRecoveredState,
  readWalSize,
  recordStartupOptions,
  removeTemporaryUserData,
  runRegisterUntilExit,
  startupRecordPath,
  startWritingTestSales,
  testSalePaths,
} from './register-harness.ts';

const MIN_SALES_BEFORE_CRASH = 50;

const test = base.extend<{
  userDataDir: string;
  launch: () => Promise<ElectronApplication>;
}>({
  // Playwright requires an object pattern as the first argument, even when it is empty.
  userDataDir: async ({}, use) => {
    const userDataDir = createTemporaryUserData();
    await use(userDataDir);
    await removeTemporaryUserData(userDataDir);
  },
  // A failed test can leave the app open, and Windows would not let the folder be deleted.
  launch: async ({ userDataDir }, use) => {
    const running = new Set<number>();
    await use(async () => {
      const register = await launchRegister(userDataDir, recordStartupOptions(userDataDir));
      const mainPid = await readMainPid(register);
      running.add(mainPid);
      register.once('close', () => running.delete(mainPid));
      return register;
    });
    await Promise.all([...running].map(forceClose));
  },
});

test('creates its database in the user data folder, with WAL on and every migration applied', async ({ userDataDir, launch }) => {
  const { databasePath } = testSalePaths(userDataDir);

  const register = await launch();
  await register.firstWindow();
  const database = await register.evaluate(
    (_electron, path) => {
      const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
      const connection = new DatabaseSync(path, { readOnly: true });
      const settings = {
        journalMode: connection.prepare('PRAGMA journal_mode').get(),
        schemaVersion: connection.prepare('PRAGMA user_version').get(),
      };
      connection.close();
      return settings;
    },
    databasePath,
  );
  await register.close();

  expect(database).toEqual({ journalMode: { journal_mode: 'wal' }, schemaVersion: { user_version: MIGRATIONS.length } });
});

test('keeps every confirmed sale, whole, after a forced close during writes', async ({ userDataDir, launch }) => {
  const paths = testSalePaths(userDataDir);
  const register = await launch();
  await register.firstWindow();
  await startWritingTestSales(register, paths);
  await expect.poll(() => readConfirmedSales(paths)).toBeGreaterThanOrEqual(MIN_SALES_BEFORE_CRASH);

  await forceClose(await readMainPid(register));
  const confirmedSales = readConfirmedSales(paths);
  expect(readWalSize(paths)).toBeGreaterThan(0);

  const reopened = await launch();
  const reopenedWindow = await reopened.firstWindow();
  await expect(reopenedWindow.getByRole('heading', { name: /Bienvenido|¿Quién cobra\?/ })).toBeVisible();
  const state = await readRecoveredState(reopened, paths);
  await reopened.close();

  expect(state.journalMode).toBe('wal');
  expect(state.integrity).toBe('ok');
  expect(state.incompleteSales).toBe(0);
  expect(state.salesFound.slice(0, confirmedSales)).toEqual(Array.from({ length: confirmedSales }, (_, index) => index + 1));
});

test('discards a sale that a forced close caught halfway', async ({ userDataDir, launch }) => {
  const paths = testSalePaths(userDataDir);
  const register = await launch();
  await register.firstWindow();
  const walSizeBefore = readWalSize(paths);
  await leaveSaleUnfinished(register, paths);
  // The unfinished sale has to be on disk, or this test would prove nothing.
  expect(readWalSize(paths)).toBeGreaterThan(walSizeBefore + 500 * 4096);

  await forceClose(await readMainPid(register));

  const reopened = await launch();
  await reopened.firstWindow();
  const salesFound = await reopened.evaluate(
    (_electron, path) => {
      const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
      const connection = new DatabaseSync(path, { readOnly: true });
      const rows = connection.prepare('SELECT DISTINCT sale_number AS sale FROM test_sale_line ORDER BY sale').all();
      connection.close();
      return rows;
    },
    paths.databasePath,
  );
  await reopened.close();

  expect(salesFound).toEqual([{ sale: 1 }]);
});

test('tells the cashier and stays closed when the database is from a newer app', async ({ userDataDir, launch }) => {
  const { databasePath } = testSalePaths(userDataDir);
  const register = await launch();
  await register.firstWindow();
  await register.evaluate(
    (_electron, { path, version }) => {
      const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
      const connection = new DatabaseSync(path);
      connection.exec(`PRAGMA user_version = ${version}`);
      connection.close();
    },
    { path: databasePath, version: MIGRATIONS.length + 1 },
  );
  await register.close();

  const exitCode = runRegisterUntilExit(userDataDir, recordStartupOptions(userDataDir));

  expect(exitCode).toBe(1);
  expect(JSON.parse(readFileSync(startupRecordPath(userDataDir), 'utf8'))).toMatchObject({
    errorBox: { title: 'La caja no pudo abrir su base de datos' },
    windowsOpened: 0,
  });
});
