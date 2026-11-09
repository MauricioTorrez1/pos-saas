/** What loading the catalog of Eleventa did. The owner compares it with Eleventa before trusting it. */
export interface ImportReportView {
  readonly rowsRead: number;
  readonly created: number;
  readonly alreadyThere: number;
  readonly openingBalances: number;
  /** The cost of the stock that was loaded, in cents. */
  readonly inventoryValueCents: number;
  readonly samplesRemoved: number;
  /** The rows that were left out, with the line of the file and why. */
  readonly invalid: readonly { readonly line: number; readonly reason: string }[];
}

/** How importing the catalog ended. */
export type ImportOutcome =
  | { readonly status: 'done'; readonly report: ImportReportView }
  /** The owner closed the file window without choosing a file. */
  | { readonly status: 'cancelled' }
  /** The file cannot be understood. */
  | { readonly status: 'unreadable'; readonly message: string };

/** How the backups stand. */
export interface BackupStatus {
  /** The folder the copies go to, or null if they were never set up. */
  readonly folder: string | null;
  /** When the last copy was made, in ISO 8601. */
  readonly lastBackupAt: string | null;
  /** Why the last attempt failed, so the owner can see a backup that stopped working. */
  readonly lastError: string | null;
}

/** How setting up or running a backup ended. */
export type BackupOutcome =
  | { readonly status: 'done'; readonly backup: BackupStatus }
  | { readonly status: 'cancelled'; readonly backup: BackupStatus }
  /** The passphrase is too short. */
  | { readonly status: 'weak_passphrase' }
  | { readonly status: 'not_configured' }
  | { readonly status: 'failed'; readonly message: string; readonly backup: BackupStatus };

/** How restoring a backup ended. */
export type RestoreOutcome =
  /** The backup is healthy and waits for the register to restart, which then uses it. */
  | { readonly status: 'staged' }
  | { readonly status: 'cancelled' }
  | { readonly status: 'failed'; readonly message: string };
