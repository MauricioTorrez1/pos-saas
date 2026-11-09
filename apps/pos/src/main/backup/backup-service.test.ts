import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalStore } from '../local-store/local-store';
import {
  applyPendingRestore,
  backupFileName,
  BackupError,
  createEncryptedBackup,
  decryptBackup,
  PENDING_RESTORE_FILE,
  pruneBackups,
  stageRestore,
} from './backup-service';

const PASSPHRASE = 'una contraseña larga';

let directory: string;
let store: LocalStore;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'backup-'));
  store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });
  store.transaction((connection) => {
    connection.exec("CREATE TABLE note (text TEXT); INSERT INTO note VALUES ('venta de cable'), ('devolución de martillo');");
  });
});

afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

function backupTo(file: string): string {
  const destination = join(directory, file);
  createEncryptedBackup(store, PASSPHRASE, destination, join(directory, 'work'));
  return destination;
}

describe('creating a backup (RNF-09)', () => {
  it('writes a file that does not show the data, so a lost USB drive leaks nothing', () => {
    const file = backupTo('one.posbak');

    const bytes = readFileSync(file);

    expect(bytes.includes(Buffer.from('SQLite format 3'))).toBe(false);
    expect(bytes.includes(Buffer.from('venta de cable'))).toBe(false);
  });

  it('leaves no plain copy behind, and no half-written file', () => {
    backupTo('one.posbak');

    expect(readdirSync(join(directory, 'work'))).toEqual([]);
    expect(readdirSync(directory).filter((name) => name.endsWith('.part'))).toEqual([]);
  });

  it('includes what was written a moment ago, even if it is still in the WAL', () => {
    store.transaction((connection) => {
      connection.exec("INSERT INTO note VALUES ('lo último')");
    });

    const file = backupTo('one.posbak');
    stageRestore(file, PASSPHRASE, directory);

    const restored = LocalStore.open({ path: join(directory, PENDING_RESTORE_FILE), appVersion: '1.0.0' });
    expect(restored.prepare('SELECT count(*) AS total FROM note').get()).toEqual({ total: 3 });
    restored.close();
  });

  it('does not stop the register: it keeps writing afterwards', () => {
    backupTo('one.posbak');

    expect(() => store.transaction((connection) => connection.exec("INSERT INTO note VALUES ('otra')"))).not.toThrow();
  });

  it('refuses a passphrase that is too short, because a short one is easy to guess', () => {
    expect(() => createEncryptedBackup(store, 'corta', join(directory, 'x.posbak'), join(directory, 'work'))).toThrow(RangeError);
    expect(existsSync(join(directory, 'x.posbak'))).toBe(false);
  });

  it('makes a different file each time, even for the same data', () => {
    expect(readFileSync(backupTo('a.posbak')).equals(readFileSync(backupTo('b.posbak')))).toBe(false);
  });
});

describe('opening a backup', () => {
  it('refuses a wrong passphrase, a damaged file, and a file that is not a backup', () => {
    const file = backupTo('one.posbak');
    const damaged = readFileSync(file);
    damaged[damaged.length - 5] = damaged[damaged.length - 5]! ^ 0xff;
    writeFileSync(join(directory, 'damaged.posbak'), damaged);
    writeFileSync(join(directory, 'note.txt'), 'hola, esto no es un respaldo de nada de nada');

    expect(() => decryptBackup(file, 'otra contraseña')).toThrow(BackupError);
    expect(() => decryptBackup(join(directory, 'damaged.posbak'), PASSPHRASE)).toThrow(/dañado/);
    expect(() => decryptBackup(join(directory, 'note.txt'), PASSPHRASE)).toThrow(/no es un respaldo/);
  });
});

describe('restoring (E1-35)', () => {
  it('waits for the restart, and then swaps the database in while keeping the old one', () => {
    const file = backupTo('one.posbak');
    stageRestore(file, PASSPHRASE, directory);
    store.close();
    writeFileSync(join(directory, 'pos.db'), 'the current database, which got damaged');

    expect(applyPendingRestore(directory, 'pos.db')).toBe(true);

    store = LocalStore.open({ path: join(directory, 'pos.db'), appVersion: '1.0.0' });
    expect(store.prepare('SELECT count(*) AS total FROM note').get()).toEqual({ total: 2 });
    expect(readdirSync(directory).some((name) => name.startsWith('pos.before-restore-'))).toBe(true);
    expect(existsSync(join(directory, PENDING_RESTORE_FILE))).toBe(false);
  });

  it('does nothing when no restore is waiting', () => {
    expect(applyPendingRestore(directory, 'pos.db')).toBe(false);
  });

  it('refuses a backup whose database is not healthy, and leaves nothing waiting', () => {
    const file = join(directory, 'strange.posbak');
    createEncryptedBackup(store, PASSPHRASE, file, join(directory, 'work'));
    const empty = LocalStore.open({ path: join(directory, 'empty.db'), appVersion: '1.0.0' });
    empty.close();

    expect(() => stageRestore(file, 'otra contraseña', directory)).toThrow(BackupError);
    expect(existsSync(join(directory, PENDING_RESTORE_FILE))).toBe(false);
  });
});

describe('keeping the folder tidy', () => {
  it('names a backup after its moment, so the files sort in order', () => {
    expect(backupFileName(new Date('2026-11-08T20:05:09.123Z'))).toBe('pos-2026-11-08T20-05-09.posbak');
  });

  it('keeps the newest backups and deletes the oldest, and leaves other files alone', () => {
    const folder = join(directory, 'usb');
    backupTo('placeholder.posbak');
    for (const name of ['pos-2026-11-01T10-00-00.posbak', 'pos-2026-11-02T10-00-00.posbak', 'pos-2026-11-03T10-00-00.posbak', 'foto.jpg']) {
      writeFileSync(join(directory, name), 'x');
    }
    const files = readdirSync(directory);
    expect(files).toContain('foto.jpg');

    expect(pruneBackups(directory, 2)).toBe(1);
    expect(readdirSync(directory)).not.toContain('pos-2026-11-01T10-00-00.posbak');
    expect(readdirSync(directory)).toEqual(expect.arrayContaining(['pos-2026-11-02T10-00-00.posbak', 'pos-2026-11-03T10-00-00.posbak', 'foto.jpg']));
    expect(folder).toContain('usb');
  });
});
