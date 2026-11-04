import { spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { _electron as electron, type ElectronApplication } from '@playwright/test';

const APP_ROOT = join(import.meta.dirname, '..');
// Outside the Electron runtime, this package only exports the path of its binary.
const ELECTRON_PATH = createRequire(import.meta.url)('electron') as string;
const LINES_PER_TEST_SALE = 5;
const SELF_EXIT_LIMIT_MS = 30_000;
const CLEANUP_ATTEMPTS = 20;
const CLEANUP_RETRY_MS = 500;
const FORCE_CLOSE_ATTEMPTS = 50;
const FORCE_CLOSE_RETRY_MS = 100;

/** How to open the register in a special way. */
export interface LaunchOptions {
  readonly electronArgs?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

/** Where a test run keeps its files. */
export interface TestSalePaths {
  readonly databasePath: string;
  readonly confirmationsPath: string;
}

/** What a reopened register finds in the database. */
export interface RecoveredState {
  readonly journalMode: string;
  readonly integrity: string;
  readonly salesFound: readonly number[];
  readonly incompleteSales: number;
}

/**
 * Creates a user data folder that only this run uses, so tests never touch the real database.
 *
 * @returns the path of the new folder
 */
export function createTemporaryUserData(): string {
  return mkdtempSync(join(tmpdir(), 'pos-register-'));
}

/**
 * Deletes a temporary user data folder. After a forced close, the helper processes of the app keep
 * its files open on Windows for a few seconds. A folder left behind only wastes space, so it warns
 * instead of failing a test whose checks already passed.
 *
 * @param userDataDir the folder to delete
 */
export async function removeTemporaryUserData(userDataDir: string): Promise<void> {
  for (let attempt = 1; attempt <= CLEANUP_ATTEMPTS; attempt += 1) {
    try {
      rmSync(userDataDir, { recursive: true, force: true });
      return;
    } catch {
      await delay(CLEANUP_RETRY_MS);
    }
  }
  console.warn(`Could not delete the temporary folder ${userDataDir}`);
}

/**
 * Opens the built register with its data in the given folder.
 *
 * @param userDataDir the folder the app treats as its user data
 * @param options arguments placed before the app path, and extra environment variables
 * @returns the running app
 */
export async function launchRegister(userDataDir: string, options: LaunchOptions = {}): Promise<ElectronApplication> {
  return electron.launch({
    args: [...(options.electronArgs ?? []), '.', `--user-data-dir=${userDataDir}`],
    cwd: APP_ROOT,
    env: { ...process.env, ...options.env } as Record<string, string>,
  });
}

/**
 * Names the files of a test run.
 *
 * @param userDataDir the folder of the run
 * @returns the database of the register, and a file outside it that lists the confirmed sales
 */
export function testSalePaths(userDataDir: string): TestSalePaths {
  return {
    databasePath: join(userDataDir, 'pos.db'),
    confirmationsPath: join(userDataDir, 'confirmed-sales.txt'),
  };
}

/**
 * Makes the running register save test sales without stopping, as the sale screen will.
 *
 * Each sale is one transaction with several lines. Its number reaches the confirmations file only
 * after the commit returns, and that file is the promise the database must keep after a crash.
 *
 * @param register the running app
 * @param paths the files of this run
 */
export async function startWritingTestSales(register: ElectronApplication, paths: TestSalePaths): Promise<void> {
  await register.evaluate(
    (_electron, { databasePath, confirmationsPath, linesPerSale }) => {
      const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
      const { openSync, writeSync } = process.getBuiltinModule('node:fs');
      const database = new DatabaseSync(databasePath, { timeout: 5_000 });
      database.exec(`
        PRAGMA synchronous = FULL;
        CREATE TABLE test_sale_line (
          sale_number INTEGER NOT NULL,
          line_number INTEGER NOT NULL,
          PRIMARY KEY (sale_number, line_number)
        ) STRICT;
      `);
      const insertLine = database.prepare('INSERT INTO test_sale_line (sale_number, line_number) VALUES (?, ?)');
      const confirmations = openSync(confirmationsPath, 'a');
      let saleNumber = 0;

      setInterval(() => {
        saleNumber += 1;
        database.exec('BEGIN IMMEDIATE');
        for (let line = 1; line <= linesPerSale; line += 1) {
          insertLine.run(saleNumber, line);
        }
        database.exec('COMMIT');
        writeSync(confirmations, `${saleNumber}\n`);
      }, 1);
    },
    { ...paths, linesPerSale: LINES_PER_TEST_SALE },
  );
}

/**
 * Reads how many test sales were confirmed.
 *
 * @param paths the files of this run
 * @returns the number of the last confirmed sale, or 0 if there is none yet
 */
export function readConfirmedSales(paths: TestSalePaths): number {
  if (!existsSync(paths.confirmationsPath)) {
    return 0;
  }
  const lines = readFileSync(paths.confirmationsPath, 'utf8').trim().split('\n');
  return Number(lines.at(-1)) || 0;
}

/**
 * Waits for the register to end, whatever the cause.
 *
 * @param appProcess the process of the app. Playwright stops giving it out once the app has closed.
 * @returns its exit code, which is null when a signal ended it
 */
export async function waitForExit(appProcess: ChildProcess): Promise<number | null> {
  if (appProcess.exitCode !== null || appProcess.signalCode !== null) {
    return appProcess.exitCode;
  }
  return new Promise((resolve) => {
    appProcess.once('exit', (code) => resolve(code));
  });
}

/**
 * Asks the app which process it really runs in. On Windows, Playwright starts it through a launcher,
 * so killing the process Playwright hands out leaves the register running.
 *
 * @param register the running app
 * @returns the process id of the main process of the app
 */
export async function readMainPid(register: ElectronApplication): Promise<number> {
  return register.evaluate(() => process.pid);
}

function isProcessAlive(pid: number): boolean {
  try {
    // Signal 0 only checks that the process exists.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ends the register at once, with no chance to clean up. Windows and Linux both kill it outright.
 *
 * @param mainPid the id from `readMainPid`
 * @throws Error if the process survives, because a crash test would then prove nothing
 */
export async function forceClose(mainPid: number): Promise<void> {
  if (isProcessAlive(mainPid)) {
    process.kill(mainPid, 'SIGKILL');
  }
  for (let attempt = 1; attempt <= FORCE_CLOSE_ATTEMPTS; attempt += 1) {
    if (!isProcessAlive(mainPid)) {
      return;
    }
    await delay(FORCE_CLOSE_RETRY_MS);
  }
  throw new Error(`Process ${mainPid} survived a forced close`);
}

/**
 * Runs the register without Playwright until it ends by itself, for runs that never reach a window.
 *
 * @param userDataDir the folder the app treats as its user data
 * @param options arguments placed before the app path, and extra environment variables
 * @returns its exit code, or null if it had to be stopped after the time limit
 */
export function runRegisterUntilExit(userDataDir: string, options: LaunchOptions): number | null {
  const { status } = spawnSync(ELECTRON_PATH, [...(options.electronArgs ?? []), '.', `--user-data-dir=${userDataDir}`], {
    cwd: APP_ROOT,
    env: { ...process.env, ...options.env },
    timeout: SELF_EXIT_LIMIT_MS,
  });
  return status;
}

/**
 * Reads the WAL size in bytes, which shows whether recent writes are still waiting there.
 *
 * @param paths the files of this run
 * @returns the size, or 0 if there is no WAL file
 */
export function readWalSize(paths: TestSalePaths): number {
  const walPath = `${paths.databasePath}-wal`;
  return existsSync(walPath) ? statSync(walPath).size : 0;
}

/**
 * Starts a sale and leaves it unfinished, with pages already on disk, so a crash catches it halfway.
 *
 * @param register the running app
 * @param paths the files of this run
 */
export async function leaveSaleUnfinished(register: ElectronApplication, paths: TestSalePaths): Promise<void> {
  await register.evaluate(
    (_electron, { databasePath }) => {
      const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
      const database = new DatabaseSync(databasePath, { timeout: 5_000 });
      database.exec(`
        CREATE TABLE test_sale_line (
          sale_number INTEGER NOT NULL,
          line_number INTEGER NOT NULL,
          padding BLOB,
          PRIMARY KEY (sale_number, line_number)
        ) STRICT;
        INSERT INTO test_sale_line (sale_number, line_number) VALUES (1, 1);
        PRAGMA cache_size = 1;
        BEGIN IMMEDIATE;
        WITH RECURSIVE line(number) AS (SELECT 1 UNION ALL SELECT number + 1 FROM line WHERE number < 500)
        INSERT INTO test_sale_line (sale_number, line_number, padding) SELECT 2, number, randomblob(4096) FROM line;
      `);
      // Keeps the connection, and with it the open transaction, alive until the crash.
      (globalThis as { unfinishedSale?: unknown }).unfinishedSale = database;
    },
    { databasePath: paths.databasePath },
  );
}

/**
 * Reads the database from inside a reopened register, with the SQLite that the app really uses.
 *
 * @param register the reopened app
 * @param paths the files of this run
 * @returns what the app finds in the database
 */
export async function readRecoveredState(register: ElectronApplication, paths: TestSalePaths): Promise<RecoveredState> {
  return register.evaluate(
    (_electron, { databasePath, linesPerSale }) => {
      const { DatabaseSync } = process.getBuiltinModule('node:sqlite');
      const database = new DatabaseSync(databasePath, { readOnly: true });
      try {
        const sales = database
          .prepare('SELECT sale_number AS sale, count(*) AS lines FROM test_sale_line GROUP BY sale_number ORDER BY sale_number')
          .all() as unknown as { sale: number; lines: number }[];
        return {
          journalMode: (database.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode,
          integrity: (database.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check,
          salesFound: sales.map(({ sale }) => sale),
          incompleteSales: sales.filter(({ lines }) => lines !== linesPerSale).length,
        };
      } finally {
        database.close();
      }
    },
    { databasePath: paths.databasePath, linesPerSale: LINES_PER_TEST_SALE },
  );
}
