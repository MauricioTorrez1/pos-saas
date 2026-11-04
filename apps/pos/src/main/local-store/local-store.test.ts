import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync, truncateSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalStore, MigrationFailedError, SchemaNewerThanAppError, WalUnavailableError } from './local-store';
import { MIGRATIONS, type Migration } from './migrations';

const APP_VERSION = '1.2.3';
const LATEST_VERSION = MIGRATIONS.length;

const ADD_NOTES: Migration = {
  version: LATEST_VERSION + 1,
  name: 'add_notes',
  sql: 'CREATE TABLE note (id INTEGER PRIMARY KEY, body TEXT NOT NULL) STRICT;',
};

const ADD_NOTE_AUTHOR: Migration = {
  version: LATEST_VERSION + 2,
  name: 'add_note_author',
  sql: `
    ALTER TABLE note ADD COLUMN author TEXT;
    UPDATE note SET author = 'old app';
  `,
};

/** Its first statement works and its second one fails, so a partial run would leave a table behind. */
const HALF_BROKEN: Migration = {
  version: LATEST_VERSION + 2,
  name: 'half_broken',
  sql: `
    CREATE TABLE half_done (id INTEGER PRIMARY KEY);
    INSERT INTO table_that_does_not_exist VALUES (1);
  `,
};

let directory: string;
let databasePath: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'local-store-'));
  databasePath = join(directory, 'pos.db');
});

afterEach(() => {
  // On Windows this also fails if a test leaves the database open.
  rmSync(directory, { recursive: true, force: true });
});

function openStore(migrations: readonly Migration[] = MIGRATIONS, appVersion = APP_VERSION): LocalStore {
  return LocalStore.open({ path: databasePath, appVersion, migrations });
}

function addNote(store: LocalStore, body: string): void {
  store.transaction((connection) => {
    connection.prepare('INSERT INTO note (body) VALUES (?)').run(body);
  });
}

/** Looks at the file with a separate connection, so the check does not trust the code under test. */
function readDatabase<T>(path: string, read: (database: DatabaseSync) => T): T {
  const database = new DatabaseSync(path);
  try {
    return read(database);
  } finally {
    database.close();
  }
}

function readSchemaVersion(path: string): number {
  return readDatabase(path, (database) => (database.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
}

function readNotes(path: string): string[] {
  return readDatabase(path, (database) =>
    (database.prepare('SELECT body FROM note ORDER BY id').all() as { body: string }[]).map(({ body }) => body),
  );
}

function tableExists(path: string, table: string): boolean {
  return readDatabase(
    path,
    (database) => database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined,
  );
}

function readIntegrity(path: string): unknown {
  return readDatabase(path, (database) => (database.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check);
}

describe('opening the database', () => {
  it('creates the file and its missing folder on first use', () => {
    const nestedPath = join(directory, 'register', 'data', 'pos.db');

    LocalStore.open({ path: nestedPath, appVersion: APP_VERSION }).close();

    expect(readSchemaVersion(nestedPath)).toBe(LATEST_VERSION);
  });

  it('turns on WAL, a disk sync on every commit, and foreign keys', () => {
    const store = openStore();

    const settings = store.transaction((connection) => ({
      journalMode: connection.prepare('PRAGMA journal_mode').get(),
      synchronous: connection.prepare('PRAGMA synchronous').get(),
      foreignKeys: connection.prepare('PRAGMA foreign_keys').get(),
    }));
    store.close();

    expect(settings).toEqual({
      journalMode: { journal_mode: 'wal' },
      synchronous: { synchronous: 2 },
      foreignKeys: { foreign_keys: 1 },
    });
  });

  it('refuses to run when WAL is not available', () => {
    // SQLite cannot use WAL on an in-memory database, as on some network drives.
    expect(() => LocalStore.open({ path: ':memory:', appVersion: APP_VERSION })).toThrow(WalUnavailableError);
  });

  it('folds the WAL into the database on a normal close', () => {
    const store = openStore();
    expect(existsSync(`${databasePath}-wal`)).toBe(true);

    store.close();

    expect(existsSync(`${databasePath}-wal`)).toBe(false);
  });
});

describe('migrating', () => {
  it('brings an old database to the latest version and keeps its data', () => {
    const oldStore = openStore([...MIGRATIONS, ADD_NOTES]);
    addNote(oldStore, 'written by the old app');
    oldStore.close();

    openStore([...MIGRATIONS, ADD_NOTES, ADD_NOTE_AUTHOR]).close();

    expect(readSchemaVersion(databasePath)).toBe(ADD_NOTE_AUTHOR.version);
    expect(readDatabase(databasePath, (database) => database.prepare('SELECT body, author FROM note').all())).toEqual([
      { body: 'written by the old app', author: 'old app' },
    ]);
  });

  it('records which app version applied each migration', () => {
    openStore([...MIGRATIONS, ADD_NOTES], '1.0.0').close();
    openStore([...MIGRATIONS, ADD_NOTES, ADD_NOTE_AUTHOR], '2.0.0').close();

    const history = readDatabase(databasePath, (database) =>
      database.prepare('SELECT version, name, app_version FROM schema_history ORDER BY version').all(),
    );

    expect(history).toEqual([
      ...MIGRATIONS.map(({ version, name }) => ({ version, name, app_version: '1.0.0' })),
      { version: ADD_NOTES.version, name: ADD_NOTES.name, app_version: '1.0.0' },
      { version: ADD_NOTE_AUTHOR.version, name: ADD_NOTE_AUTHOR.name, app_version: '2.0.0' },
    ]);
  });

  it('does not apply a migration again on the next start', () => {
    openStore([...MIGRATIONS, ADD_NOTES]).close();

    // CREATE TABLE would fail if it ran a second time.
    expect(() => openStore([...MIGRATIONS, ADD_NOTES]).close()).not.toThrow();
  });

  it('refuses a database written by a newer version of the app', () => {
    openStore([...MIGRATIONS, ADD_NOTES]).close();

    expect(() => openStore(MIGRATIONS)).toThrow(SchemaNewerThanAppError);
    expect(readSchemaVersion(databasePath)).toBe(ADD_NOTES.version);
  });

  it.each([
    ['a gap', { ...ADD_NOTES, version: LATEST_VERSION + 2 }],
    ['a repeated version', { ...ADD_NOTES, version: LATEST_VERSION }],
  ])('rejects a migration list with %s before touching the disk', (_problem, migration) => {
    expect(() => openStore([...MIGRATIONS, migration])).toThrow(/consecutive/);
    expect(existsSync(databasePath)).toBe(false);
  });
});

describe('when a migration fails', () => {
  it('undoes that migration completely', () => {
    const oldStore = openStore([...MIGRATIONS, ADD_NOTES]);
    addNote(oldStore, 'must survive');
    oldStore.close();

    expect(() => openStore([...MIGRATIONS, ADD_NOTES, HALF_BROKEN])).toThrow(MigrationFailedError);

    expect(tableExists(databasePath, 'half_done')).toBe(false);
    expect(readSchemaVersion(databasePath)).toBe(ADD_NOTES.version);
    expect(readNotes(databasePath)).toEqual(['must survive']);
  });

  it('keeps the migrations that worked before it', () => {
    expect(() => openStore([...MIGRATIONS, ADD_NOTES, HALF_BROKEN])).toThrow(MigrationFailedError);

    expect(readSchemaVersion(databasePath)).toBe(ADD_NOTES.version);
    expect(tableExists(databasePath, 'note')).toBe(true);
  });

  it('names the migration and keeps the original error', () => {
    let failure: unknown;
    try {
      openStore([...MIGRATIONS, ADD_NOTES, HALF_BROKEN]);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(MigrationFailedError);
    expect((failure as MigrationFailedError).message).toContain(HALF_BROKEN.name);
    expect((failure as MigrationFailedError).cause).toBeInstanceOf(Error);
  });

  it('applies the migration on a later start once it is fixed', () => {
    expect(() => openStore([...MIGRATIONS, ADD_NOTES, HALF_BROKEN])).toThrow(MigrationFailedError);

    openStore([...MIGRATIONS, ADD_NOTES, ADD_NOTE_AUTHOR]).close();

    expect(readSchemaVersion(databasePath)).toBe(ADD_NOTE_AUTHOR.version);
  });

  it('releases the database file', () => {
    expect(() => openStore([...MIGRATIONS, ADD_NOTES, HALF_BROKEN])).toThrow(MigrationFailedError);

    // Windows refuses to delete a file that is still open.
    expect(() => rmSync(databasePath)).not.toThrow();
  });
});

describe('transactions', () => {
  it('saves the work and returns its result', () => {
    const store = openStore([...MIGRATIONS, ADD_NOTES]);

    const inserted = store.transaction((connection) => connection.prepare("INSERT INTO note (body) VALUES ('saved')").run().changes);
    store.close();

    expect(inserted).toBe(1);
    expect(readNotes(databasePath)).toEqual(['saved']);
  });

  it('undoes all the work when any of it throws', () => {
    const store = openStore([...MIGRATIONS, ADD_NOTES]);

    expect(() =>
      store.transaction((connection) => {
        connection.exec("INSERT INTO note (body) VALUES ('undone')");
        throw new Error('the sale could not be saved');
      }),
    ).toThrow('the sale could not be saved');
    store.close();

    expect(readNotes(databasePath)).toEqual([]);
  });

  it('refuses asynchronous work, because it would commit before the work ends', () => {
    const store = openStore([...MIGRATIONS, ADD_NOTES]);

    expect(() =>
      store.transaction(async (connection) => {
        connection.exec("INSERT INTO note (body) VALUES ('undone')");
      }),
    ).toThrow(TypeError);
    store.close();

    expect(readNotes(databasePath)).toEqual([]);
  });
});

describe('after an abrupt close', () => {
  /** Copies the files while the connection is open, which is how a power cut leaves them. */
  function copyAsAbruptlyClosed(crashedPath: string): void {
    copyFileSync(databasePath, crashedPath);
    copyFileSync(`${databasePath}-wal`, `${crashedPath}-wal`);
  }

  it('recovers every commit left in the WAL', () => {
    const crashedPath = join(directory, 'crashed.db');
    const store = openStore([...MIGRATIONS, ADD_NOTES]);
    addNote(store, 'first');
    addNote(store, 'second');
    copyAsAbruptlyClosed(crashedPath);
    store.close();

    LocalStore.open({ path: crashedPath, appVersion: APP_VERSION, migrations: [...MIGRATIONS, ADD_NOTES] }).close();

    expect(readNotes(crashedPath)).toEqual(['first', 'second']);
    expect(readIntegrity(crashedPath)).toBe('ok');
  });

  it('discards a commit that was cut off halfway to the disk, and keeps the ones before it', () => {
    const crashedPath = join(directory, 'crashed.db');
    const store = openStore([...MIGRATIONS, ADD_NOTES]);
    addNote(store, 'first');
    addNote(store, 'second');
    addNote(store, 'cut off');
    copyAsAbruptlyClosed(crashedPath);
    store.close();
    truncateSync(`${crashedPath}-wal`, statSync(`${crashedPath}-wal`).size - 100);

    LocalStore.open({ path: crashedPath, appVersion: APP_VERSION, migrations: [...MIGRATIONS, ADD_NOTES] }).close();

    expect(readNotes(crashedPath)).toEqual(['first', 'second']);
    expect(readIntegrity(crashedPath)).toBe('ok');
  });
});
