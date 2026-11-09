import { createCipheriv, createDecipheriv, randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, join } from 'node:path';

import type { LocalStore } from '../local-store/local-store';

const MAGIC = Buffer.from('POSBAK1\0', 'latin1');
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const SCRYPT_COST = 16_384;
const MIN_PASSPHRASE_LENGTH = 8;

/** Suffix of a backup file. */
export const BACKUP_EXTENSION = '.posbak';

/** Name of the file a restore waits in until the register starts again. */
export const PENDING_RESTORE_FILE = 'pos.restore-pending.db';

/** A backup cannot be read: the passphrase is wrong, the file is damaged, or it is not a backup of this register. */
export class BackupError extends Error {
  /** @param message what is wrong, in words the owner can act on */
  constructor(message: string) {
    super(message);
    this.name = 'BackupError';
  }
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, KEY_BYTES, { N: SCRYPT_COST, r: 8, p: 1 });
}

/**
 * Writes an encrypted copy of the database. The copy is a consistent snapshot, taken while the register keeps working, and
 * it is encrypted with a key made from a passphrase (AES-256-GCM), so a lost USB drive does not leak the sales.
 *
 * @param store the open database
 * @param passphrase at least 8 characters. Without it the copy cannot be opened, and there is no way to recover it.
 * @param destinationFile where to write the backup
 * @param workDirectory a folder for the temporary plain copy, which is deleted before this returns
 * @throws RangeError if the passphrase is too short
 */
export function createEncryptedBackup(store: LocalStore, passphrase: string, destinationFile: string, workDirectory: string): void {
  if ([...passphrase].length < MIN_PASSPHRASE_LENGTH) {
    throw new RangeError(`The backup passphrase needs at least ${MIN_PASSPHRASE_LENGTH} characters`);
  }
  mkdirSync(workDirectory, { recursive: true });
  mkdirSync(dirname(destinationFile), { recursive: true });
  const plainCopy = join(workDirectory, `.backup-${randomUUID()}.tmp`);
  try {
    store.backupTo(plainCopy);
    const salt = randomBytes(SALT_BYTES);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
    const encrypted = Buffer.concat([cipher.update(readFileSync(plainCopy)), cipher.final()]);
    // Written beside the destination and renamed, so a backup that is cut short never looks like a finished one.
    const partial = `${destinationFile}.part`;
    writeFileSync(partial, Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), encrypted]));
    renameSync(partial, destinationFile);
  } finally {
    rmSync(plainCopy, { force: true });
  }
}

/**
 * Opens a backup.
 *
 * @param backupFile the file
 * @param passphrase the passphrase it was made with
 * @returns the database file inside it
 * @throws BackupError if the file is not a backup, is damaged, or the passphrase is wrong
 */
export function decryptBackup(backupFile: string, passphrase: string): Buffer {
  const contents = readFileSync(backupFile);
  const headerLength = MAGIC.length + SALT_BYTES + IV_BYTES + TAG_BYTES;
  if (contents.length <= headerLength || !contents.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new BackupError('Ese archivo no es un respaldo de la caja.');
  }
  const salt = contents.subarray(MAGIC.length, MAGIC.length + SALT_BYTES);
  const iv = contents.subarray(MAGIC.length + SALT_BYTES, MAGIC.length + SALT_BYTES + IV_BYTES);
  const tag = contents.subarray(MAGIC.length + SALT_BYTES + IV_BYTES, headerLength);
  try {
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(contents.subarray(headerLength)), decipher.final()]);
  } catch {
    throw new BackupError('La contraseña es incorrecta o el respaldo está dañado.');
  }
}

/**
 * Prepares a restore: opens the backup, checks that it is a healthy database of this register, and leaves it waiting. The
 * register has to restart to use it, because it cannot swap its own database while it is open.
 *
 * @param backupFile the backup to restore
 * @param passphrase the passphrase it was made with
 * @param userDataDirectory the folder of the register
 * @throws BackupError if it cannot be opened, or what is inside is not a healthy database
 */
export function stageRestore(backupFile: string, passphrase: string, userDataDirectory: string): void {
  const database = decryptBackup(backupFile, passphrase);
  const staging = join(userDataDirectory, `.restore-${randomUUID()}.tmp`);
  writeFileSync(staging, database);
  try {
    const check = new DatabaseSync(staging, { readOnly: true });
    try {
      const integrity = (check.prepare('PRAGMA integrity_check').get() as { integrity_check: string }).integrity_check;
      const version = (check.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
      if (integrity !== 'ok' || version < 1) {
        throw new BackupError('El respaldo se abrió, pero la base de datos que trae no está sana.');
      }
    } finally {
      check.close();
    }
    renameSync(staging, join(userDataDirectory, PENDING_RESTORE_FILE));
  } catch (error) {
    rmSync(staging, { force: true });
    throw error instanceof BackupError ? error : new BackupError('El respaldo se abrió, pero la base de datos que trae no se puede leer.');
  }
}

/**
 * Swaps in a restore that was waiting, before the database opens. The database it replaces is kept beside it, because a
 * restore can be a mistake.
 *
 * @param userDataDirectory the folder of the register
 * @param databaseFileName the name of the database file
 * @returns true if a restore was applied
 */
export function applyPendingRestore(userDataDirectory: string, databaseFileName: string): boolean {
  const pending = join(userDataDirectory, PENDING_RESTORE_FILE);
  if (!existsSync(pending)) {
    return false;
  }
  const current = join(userDataDirectory, databaseFileName);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(current + suffix)) {
      renameSync(current + suffix, join(userDataDirectory, `pos.before-restore-${stamp}.db${suffix}`));
    }
  }
  renameSync(pending, current);
  return true;
}

/**
 * Names a backup after the moment it was made, so the files sort in order.
 *
 * @param now the moment
 * @returns such as `pos-2026-11-08T20-05-00.posbak`
 */
export function backupFileName(now: Date): string {
  return `pos-${now.toISOString().slice(0, 19).replace(/:/g, '-')}${BACKUP_EXTENSION}`;
}

/**
 * Deletes the oldest backups of a folder, so the USB drive does not fill up. Only files named like backups are touched.
 *
 * @param folder the backup folder
 * @param keep how many of the newest to keep
 * @returns how many were deleted
 */
export function pruneBackups(folder: string, keep: number): number {
  const backups = readdirSync(folder)
    .filter((name) => /^pos-.*\.posbak$/.test(name))
    .sort();
  const old = backups.slice(0, Math.max(backups.length - keep, 0));
  old.forEach((name) => rmSync(join(folder, name), { force: true }));
  return old.length;
}
