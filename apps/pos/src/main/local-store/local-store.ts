import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import { MIGRATIONS, type Migration } from './migrations';
import { retryWhileSharedMemoryBusy } from './shared-memory-retry';

/** How long a write waits for another connection, such as a backup, before it fails. */
const BUSY_TIMEOUT_MS = 5_000;

/** A migration failed. Its changes were undone, and the database stayed at the previous version. */
export class MigrationFailedError extends Error {
  /**
   * @param migration the migration that failed
   * @param cause the original error
   */
  constructor(migration: Migration, cause: unknown) {
    super(`Migration ${migration.version} (${migration.name}) failed and was undone`, { cause });
    this.name = 'MigrationFailedError';
  }
}

/** The database comes from a newer app, and this app could damage a schema it does not know. */
export class SchemaNewerThanAppError extends Error {
  /**
   * @param databaseVersion the schema version of the file
   * @param appVersion the latest schema version this app knows
   */
  constructor(databaseVersion: number, appVersion: number) {
    super(`The database is at schema version ${databaseVersion}, and this app only knows up to ${appVersion}`);
    this.name = 'SchemaNewerThanAppError';
  }
}

/** SQLite could not turn on WAL, so the promise of not losing sales would not hold. */
export class WalUnavailableError extends Error {
  /** @param journalMode the mode SQLite stayed in */
  constructor(journalMode: string) {
    super(`The database must use WAL, but SQLite stayed in ${journalMode} mode`);
    this.name = 'WalUnavailableError';
  }
}

/** What `LocalStore.open` needs. */
export interface LocalStoreOptions {
  /** Path of the database file. Its folder is created if it does not exist. */
  readonly path: string;
  /** Version of the running app, recorded next to each migration it applies. */
  readonly appVersion: string;
  /** Schema changes to apply. Only tests pass another list. */
  readonly migrations?: readonly Migration[];
}

/**
 * The local database of the register. It lives in the main process, and the screen never reaches it
 * directly.
 */
export class LocalStore {
  readonly #connection: DatabaseSync;

  private constructor(connection: DatabaseSync) {
    this.#connection = connection;
  }

  /**
   * Opens the database, creating it if needed, and brings its schema up to date.
   *
   * @param options where the file lives and which version of the app is opening it
   * @returns the open store, which the caller must close
   * @throws MigrationFailedError if a migration fails. Earlier migrations stay applied.
   * @throws SchemaNewerThanAppError if a newer version of the app already updated the file
   * @throws WalUnavailableError if SQLite cannot use WAL on this file
   */
  static open({ path, appVersion, migrations = MIGRATIONS }: LocalStoreOptions): LocalStore {
    assertConsecutiveVersions(migrations);
    mkdirSync(dirname(path), { recursive: true });
    return retryWhileSharedMemoryBusy(() => {
      const connection = new DatabaseSync(path, { enableForeignKeyConstraints: true, timeout: BUSY_TIMEOUT_MS });
      try {
        configureForDurability(connection);
        applyPendingMigrations(connection, migrations, appVersion);
        return new LocalStore(connection);
      } catch (error) {
        connection.close();
        throw error;
      }
    });
  }

  /**
   * Runs work so that all of it is saved or none of it is, even if the app dies halfway.
   *
   * @param work synchronous function that receives the connection
   * @returns what `work` returns, once it is safely on disk
   * @throws whatever `work` throws, after undoing its changes
   * @throws TypeError if `work` is asynchronous, because the commit would not wait for it
   */
  transaction<T>(work: (connection: DatabaseSync) => T): T {
    return runInTransaction(this.#connection, () => work(this.#connection));
  }

  /**
   * Compiles a statement once, so a lookup that runs on every scan does not parse its SQL each time. Reads do not
   * need `transaction`, which would take the write lock.
   *
   * @param sql the statement, with `?` for its values
   * @returns the compiled statement. It stops working once the store closes.
   */
  prepare(sql: string): StatementSync {
    return this.#connection.prepare(sql);
  }

  /** Closes the database. SQLite moves the WAL into the main file and removes it. */
  close(): void {
    this.#connection.close();
  }
}

/** A gap or a repeated version would skip a migration or apply it in the wrong place. */
function assertConsecutiveVersions(migrations: readonly Migration[]): void {
  migrations.forEach(({ version, name }, index) => {
    if (version !== index + 1) {
      throw new RangeError(`Migration versions must be consecutive from 1, but ${name} has ${version} at position ${index + 1}`);
    }
  });
}

function configureForDurability(connection: DatabaseSync): void {
  const { journal_mode: journalMode } = connection.prepare('PRAGMA journal_mode = WAL').get() as { journal_mode: string };
  if (journalMode !== 'wal') {
    throw new WalUnavailableError(journalMode);
  }
  // Each commit reaches the disk before it returns, so a power cut cannot lose a confirmed sale.
  connection.exec('PRAGMA synchronous = FULL');
}

function applyPendingMigrations(connection: DatabaseSync, migrations: readonly Migration[], appVersion: string): void {
  const { user_version: currentVersion } = connection.prepare('PRAGMA user_version').get() as { user_version: number };
  if (currentVersion > migrations.length) {
    throw new SchemaNewerThanAppError(currentVersion, migrations.length);
  }
  for (const migration of migrations.slice(currentVersion)) {
    try {
      runInTransaction(connection, () => applyMigration(connection, migration, appVersion));
    } catch (cause) {
      throw new MigrationFailedError(migration, cause);
    }
  }
}

/** The new version is saved in the same transaction as the changes, so they cannot disagree after a crash. */
function applyMigration(connection: DatabaseSync, migration: Migration, appVersion: string): void {
  connection.exec(migration.sql);
  connection
    .prepare('INSERT INTO schema_history (version, name, app_version, applied_at) VALUES (?, ?, ?, ?)')
    .run(migration.version, migration.name, appVersion, new Date().toISOString());
  // A PRAGMA cannot take a bound value. The version is an integer, checked against its position in the list.
  connection.exec(`PRAGMA user_version = ${migration.version}`);
}

function runInTransaction<T>(connection: DatabaseSync, work: () => T): T {
  connection.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    if (result instanceof Promise) {
      throw new TypeError('A transaction must be synchronous, because the commit would not wait for a promise');
    }
    connection.exec('COMMIT');
    return result;
  } catch (error) {
    // SQLite already undoes the transaction on some errors, and a second rollback would hide the first error.
    if (connection.isTransaction) {
      connection.exec('ROLLBACK');
    }
    throw error;
  }
}
