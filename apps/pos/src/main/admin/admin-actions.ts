import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { BackupOutcome, BackupStatus, ImportOutcome, RestoreOutcome } from '../../shared/admin-api';
import { backupFileName, BackupError, createEncryptedBackup, pruneBackups, stageRestore } from '../backup/backup-service';
import type { CatalogImporter } from '../import/catalog-importer';
import { parseEleventaCatalog } from '../import/eleventa-csv';
import type { LocalStore } from '../local-store/local-store';

/** A file of Eleventa is a list of products: more than this is not one. */
const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

/** How many copies stay in the folder. With one an hour, that is two days. */
export const BACKUPS_TO_KEEP = 48;

const FOLDER_SETTING = 'backup_folder';
const LAST_BACKUP_SETTING = 'backup_last_at';
const LAST_ERROR_SETTING = 'backup_last_error';

/** Where the settings of the register are kept. */
export interface SettingsStore {
  readSetting(name: string): string | null;
  writeSetting(name: string, value: string): void;
}

/** Where the passphrase of the backups is kept, protected by the operating system. */
export interface PassphraseVault {
  /** @returns the passphrase, or null if none was saved */
  read(): string | null;
  /** @param passphrase what to keep */
  save(passphrase: string): void;
}

/** What the actions need from the outside: the native windows, the clock, and the folders. */
export interface AdminDependencies {
  readonly store: LocalStore;
  readonly importer: CatalogImporter;
  readonly settings: SettingsStore;
  readonly vault: PassphraseVault;
  readonly userDataDirectory: string;
  /** Opens the window to choose a file. */
  readonly pickFile: (title: string) => Promise<string | null>;
  /** Opens the window to choose a folder. */
  readonly pickFolder: (title: string) => Promise<string | null>;
  readonly now?: () => Date;
}

/**
 * What only the owner does at the register: load the catalog of Eleventa, set up the backups, and restore one. The windows
 * to choose files come from outside, so the rest can be tested without a screen.
 */
export class AdminActions {
  readonly #dependencies: AdminDependencies;

  /** @param dependencies the store, the importer, the settings, the vault, and the native windows */
  constructor(dependencies: AdminDependencies) {
    this.#dependencies = dependencies;
  }

  /**
   * Asks for the file of Eleventa and loads it (RF-034).
   *
   * @returns what was loaded, or why not
   */
  async importCatalog(): Promise<ImportOutcome> {
    const file = await this.#dependencies.pickFile('Elige el archivo de productos de Eleventa (CSV)');
    if (file === null) {
      return { status: 'cancelled' };
    }
    let text: string;
    try {
      if (statSync(file).size > MAX_IMPORT_BYTES) {
        return { status: 'unreadable', message: 'El archivo es demasiado grande para ser una lista de productos.' };
      }
      text = decode(readFileSync(file));
    } catch {
      return { status: 'unreadable', message: 'No se pudo leer el archivo. Revisa que no esté abierto en otro programa.' };
    }
    const reading = parseEleventaCatalog(text);
    if (reading.status === 'unreadable') {
      return reading;
    }
    return { status: 'done', report: this.#dependencies.importer.load(reading) };
  }

  /** @returns how the backups stand */
  backupStatus(): BackupStatus {
    const { settings } = this.#dependencies;
    return {
      folder: settings.readSetting(FOLDER_SETTING),
      lastBackupAt: settings.readSetting(LAST_BACKUP_SETTING),
      lastError: settings.readSetting(LAST_ERROR_SETTING) || null,
    };
  }

  /**
   * Sets up the backups: asks for the folder, keeps the passphrase, and makes the first copy.
   *
   * @param passphrase at least 8 characters. Without it no copy can be opened.
   * @returns how it ended
   */
  async configureBackup(passphrase: string): Promise<BackupOutcome> {
    if ([...passphrase].length < 8) {
      return { status: 'weak_passphrase' };
    }
    const folder = await this.#dependencies.pickFolder('Elige dónde guardar los respaldos (mejor una USB)');
    if (folder === null) {
      return { status: 'cancelled', backup: this.backupStatus() };
    }
    this.#dependencies.settings.writeSetting(FOLDER_SETTING, folder);
    this.#dependencies.vault.save(passphrase);
    return this.backupNow();
  }

  /**
   * Makes a copy now. The hourly timer calls it too.
   *
   * @returns how it ended. A failure is kept, so the owner can see that backups stopped working.
   */
  backupNow(): BackupOutcome {
    const { settings, vault, store, userDataDirectory } = this.#dependencies;
    const folder = settings.readSetting(FOLDER_SETTING);
    const passphrase = vault.read();
    if (folder === null || passphrase === null) {
      return { status: 'not_configured' };
    }
    const now = (this.#dependencies.now ?? (() => new Date()))();
    try {
      createEncryptedBackup(store, passphrase, join(folder, backupFileName(now)), join(userDataDirectory, 'backup-work'));
      pruneBackups(folder, BACKUPS_TO_KEEP);
      settings.writeSetting(LAST_BACKUP_SETTING, now.toISOString());
      settings.writeSetting(LAST_ERROR_SETTING, '');
      return { status: 'done', backup: this.backupStatus() };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      settings.writeSetting(LAST_ERROR_SETTING, message);
      return { status: 'failed', message: 'No se pudo hacer la copia. Revisa que la carpeta o la USB estén conectadas.', backup: this.backupStatus() };
    }
  }

  /**
   * Asks for a backup and prepares it to be restored. The register uses it when it starts again.
   *
   * @param passphrase the passphrase the backup was made with
   * @returns `staged` when the backup is healthy, or why not
   */
  async restoreBackup(passphrase: string): Promise<RestoreOutcome> {
    const file = await this.#dependencies.pickFile('Elige el respaldo que quieres restaurar');
    if (file === null) {
      return { status: 'cancelled' };
    }
    try {
      stageRestore(file, passphrase, this.#dependencies.userDataDirectory);
      return { status: 'staged' };
    } catch (error) {
      return { status: 'failed', message: error instanceof BackupError ? error.message : 'No se pudo leer el respaldo.' };
    }
  }
}

/** Excel saves some files in the code page of Windows instead of UTF-8, and reading those as UTF-8 breaks the accents. */
function decode(bytes: Buffer): string {
  const utf8 = bytes.toString('utf8');
  return utf8.includes('�') ? bytes.toString('latin1') : utf8;
}
