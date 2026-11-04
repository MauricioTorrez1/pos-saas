/** One change to the local database schema. */
export interface Migration {
  /** Position in the list, starting at 1. It becomes the schema version once applied. */
  readonly version: number;
  /** Short name that appears in errors and in `schema_history`. */
  readonly name: string;
  /** Statements to run. They must not manage transactions: the runner wraps them in one. */
  readonly sql: string;
}

/**
 * Every schema change, in order. Registers in the field update when they can, so a migration that
 * has shipped never changes: a correction is a new migration at the end of the list.
 */
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    name: 'create_schema_history',
    // Describes this device's copy of the schema rather than the business, so it has no tenant_id.
    sql: `
      CREATE TABLE schema_history (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        app_version TEXT NOT NULL,
        applied_at TEXT NOT NULL
      ) STRICT;
    `,
  },
];
