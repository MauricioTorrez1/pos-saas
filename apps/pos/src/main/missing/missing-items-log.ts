import type { StatementSync } from 'node:sqlite';

import {
  MAX_MISSING_DESCRIPTION,
  MAX_MISSING_NOTES,
  MAX_MISSING_QUANTITY,
  missingItemKey,
  type MissingCount,
  type MissingItemGroup,
  type MissingItemRequest,
  type MissingItemsReport,
  type MissingPeriod,
  type MissingStatus,
  type RecordMissingResult,
} from '../../shared/missing-items';
import type { AuditLog } from '../audit/audit-log';
import type { LocalStore } from '../local-store/local-store';
import { uuidV7 } from '../uuid-v7';

const DAY_MS = 86_400_000;
const DAYS_PER_WEEK = 7;
/** A chart with more weeks than this cannot be read, so a long log shows its last year by week. */
const MAX_WEEKS = 52;

interface RequestRow {
  readonly description: string;
  readonly item_key: string;
  readonly quantity: number | null;
  readonly notes: string | null;
  readonly recorded_at: string;
}

interface StatusRow {
  readonly item_key: string;
  readonly status: Exclude<MissingStatus, 'pending'>;
}

/**
 * Keeps the log of what customers ask for and the store does not carry (E1-49, ADR 0063). Each time is written as it
 * happened and never changes; the report gathers the times of the same thing and counts them by week and by day.
 */
export class MissingItemsLog {
  readonly #store: LocalStore;
  readonly #tenantId: string;
  readonly #audit: Pick<AuditLog, 'record'>;
  readonly #now: () => Date;
  readonly #insert: StatementSync;
  readonly #since: StatementSync;
  readonly #timesOf: StatementSync;
  readonly #statuses: StatementSync;
  readonly #setStatus: StatementSync;
  readonly #clearStatus: StatementSync;
  readonly #clearNotes: StatementSync;
  readonly #setLatestNotes: StatementSync;
  readonly #deleteRequests: StatementSync;

  /**
   * @param store the open local store
   * @param tenantId the business whose log this is
   * @param audit where the decisions of the owner are written
   * @param now the clock, which tests replace
   */
  constructor(store: LocalStore, tenantId: string, audit: Pick<AuditLog, 'record'>, now: () => Date = () => new Date()) {
    this.#store = store;
    this.#tenantId = tenantId;
    this.#audit = audit;
    this.#now = now;
    this.#insert = store.prepare(`
      INSERT INTO missing_item_request (id, tenant_id, description, item_key, quantity, notes, recorded_by, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.#since = store.prepare(`
      SELECT description, item_key, quantity, notes, recorded_at FROM missing_item_request
      WHERE tenant_id = ? AND recorded_at >= ? ORDER BY recorded_at DESC
    `);
    this.#timesOf = store.prepare('SELECT COUNT(*) AS times FROM missing_item_request WHERE tenant_id = ? AND item_key = ?');
    this.#statuses = store.prepare('SELECT item_key, status FROM missing_item_status WHERE tenant_id = ?');
    this.#setStatus = store.prepare(`
      INSERT INTO missing_item_status (tenant_id, item_key, status, decided_by, decided_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (tenant_id, item_key) DO UPDATE SET status = excluded.status, decided_by = excluded.decided_by, decided_at = excluded.decided_at
    `);
    this.#clearStatus = store.prepare('DELETE FROM missing_item_status WHERE tenant_id = ? AND item_key = ?');
    this.#clearNotes = store.prepare('UPDATE missing_item_request SET notes = NULL WHERE tenant_id = ? AND item_key = ? AND notes IS NOT NULL');
    this.#setLatestNotes = store.prepare(`
      UPDATE missing_item_request SET notes = ? WHERE id = (
        SELECT id FROM missing_item_request WHERE tenant_id = ? AND item_key = ? ORDER BY recorded_at DESC, id DESC LIMIT 1
      )
    `);
    this.#deleteRequests = store.prepare('DELETE FROM missing_item_request WHERE tenant_id = ? AND item_key = ?');
  }

  /**
   * Writes down one time a customer asked for something.
   *
   * @param request what was asked for, already shaped as the bridge sends it
   * @param userId who wrote it down
   * @returns how many times that thing has been asked for, counting this one, or why it was not written
   */
  record(request: MissingItemRequest, userId: string): RecordMissingResult {
    const description = request.description.trim().replace(/\s+/gu, ' ');
    const notes = request.notes?.trim() ?? '';
    if (description === '') {
      return { status: 'invalid', message: 'Escribe qué pidió el cliente.' };
    }
    if ([...description].length > MAX_MISSING_DESCRIPTION) {
      return { status: 'invalid', message: `Describe lo que pidió en ${String(MAX_MISSING_DESCRIPTION)} letras o menos.` };
    }
    if ([...notes].length > MAX_MISSING_NOTES) {
      return { status: 'invalid', message: `Las notas caben en ${String(MAX_MISSING_NOTES)} letras.` };
    }
    const { quantity } = request;
    if (quantity !== null && (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_MISSING_QUANTITY)) {
      return { status: 'invalid', message: 'La cantidad debe ser un número entero mayor que cero.' };
    }
    const key = missingItemKey(description);
    const now = this.#now();
    return this.#store.transaction(() => {
      this.#insert.run(uuidV7(now.getTime()), this.#tenantId, description, key, quantity, notes === '' ? null : notes, userId, now.toISOString());
      const { times } = this.#timesOf.get(this.#tenantId, key) as unknown as { times: number };
      return { status: 'recorded', timesAsked: times };
    });
  }

  /**
   * Marks an item as sold now, dismissed, or pending again, and leaves it in the audit log.
   *
   * @param key the key of the item
   * @param status what the owner decided
   * @param userId the owner
   */
  resolve(key: string, status: MissingStatus, userId: string): void {
    const now = this.#now().toISOString();
    this.#store.transaction(() => {
      if (status === 'pending') {
        this.#clearStatus.run(this.#tenantId, key);
      } else {
        this.#setStatus.run(this.#tenantId, key, status, userId, now);
      }
      this.#audit.record({ userId, action: 'missing_item.resolved', entity: 'missing_item', entityId: uuidV7(), detail: `${key}: ${status}` });
    });
  }

  /**
   * Replaces the notes of an item: the last time it was asked for keeps them, and the earlier times lose theirs, so the
   * item shows exactly what was typed. What was asked for, when and by whom does not change.
   *
   * @param key the key of the item
   * @param notes the new notes, or null for none
   * @param userId who edited them
   * @returns how many times the item was asked for, or why the notes were not kept
   */
  editNotes(key: string, notes: string | null, userId: string): RecordMissingResult {
    const text = notes?.trim() ?? '';
    if ([...text].length > MAX_MISSING_NOTES) {
      return { status: 'invalid', message: `Las notas caben en ${String(MAX_MISSING_NOTES)} letras.` };
    }
    return this.#store.transaction(() => {
      const { times } = this.#timesOf.get(this.#tenantId, key) as unknown as { times: number };
      if (times === 0) {
        return { status: 'invalid', message: 'Ese faltante ya no existe.' };
      }
      this.#clearNotes.run(this.#tenantId, key);
      if (text !== '') {
        this.#setLatestNotes.run(text, this.#tenantId, key);
      }
      this.#audit.record({ userId, action: 'missing_item.notes_edited', entity: 'missing_item', entityId: uuidV7(), detail: `${key}: ${text === '' ? '(sin notas)' : text}` });
      return { status: 'recorded', timesAsked: times };
    });
  }

  /**
   * Deletes every time an item was asked for, and what the owner decided about it, when it was written by mistake. The
   * audit log keeps what was deleted.
   *
   * @param key the key of the item
   * @param userId the owner
   */
  remove(key: string, userId: string): void {
    this.#store.transaction(() => {
      const { times } = this.#timesOf.get(this.#tenantId, key) as unknown as { times: number };
      this.#deleteRequests.run(this.#tenantId, key);
      this.#clearStatus.run(this.#tenantId, key);
      this.#audit.record({ userId, action: 'missing_item.deleted', entity: 'missing_item', entityId: uuidV7(), detail: `${key}: ${String(times)} veces` });
    });
  }

  /**
   * Reads the log of a period.
   *
   * @param period how many days back, or zero for all of it
   * @returns the items, the most asked first, and the times by week and by day of the week
   */
  report(period: MissingPeriod): MissingItemsReport {
    const now = this.#now();
    const since = period === 0 ? '' : new Date(now.getTime() - period * DAY_MS).toISOString();
    const rows = this.#since.all(this.#tenantId, since) as unknown as RequestRow[];
    const statuses = new Map<string, StatusRow['status']>((this.#statuses.all(this.#tenantId) as unknown as StatusRow[]).map((row) => [row.item_key, row.status]));
    return {
      period,
      groups: groupRequests(rows, statuses),
      byWeek: countByWeek(rows, now, period),
      byWeekday: countByWeekday(rows),
      totalRequests: rows.length,
      generatedAt: now.toISOString(),
    };
  }
}

/** Gathers the times of each item. The rows come newest first, so the first one of a key has its latest spelling. */
function groupRequests(rows: readonly RequestRow[], statuses: ReadonlyMap<string, StatusRow['status']>): MissingItemGroup[] {
  const groups = new Map<string, { description: string; times: number; quantity: number; notes: string[]; first: string; last: string }>();
  for (const row of rows) {
    const group = groups.get(row.item_key);
    if (group === undefined) {
      groups.set(row.item_key, { description: row.description, times: 1, quantity: row.quantity ?? 0, notes: row.notes === null ? [] : [row.notes], first: row.recorded_at, last: row.recorded_at });
      continue;
    }
    group.times += 1;
    group.quantity += row.quantity ?? 0;
    group.first = row.recorded_at;
    if (row.notes !== null && !group.notes.includes(row.notes)) {
      group.notes.push(row.notes);
    }
  }
  return [...groups.entries()]
    .map(([key, group]): MissingItemGroup => ({
      key,
      description: group.description,
      timesAsked: group.times,
      quantityAsked: group.quantity,
      notes: group.notes,
      firstAskedAt: group.first,
      lastAskedAt: group.last,
      status: statuses.get(key) ?? 'pending',
    }))
    .sort((left, right) => right.timesAsked - left.timesAsked || right.lastAskedAt.localeCompare(left.lastAskedAt));
}

/** The Monday that starts the week of a moment, in the time of this computer, as `YYYY-MM-DD`. */
function weekStart(moment: Date): Date {
  const day = new Date(moment.getFullYear(), moment.getMonth(), moment.getDate());
  day.setDate(day.getDate() - ((day.getDay() + DAYS_PER_WEEK - 1) % DAYS_PER_WEEK));
  return day;
}

function dayKey(day: Date): string {
  return `${String(day.getFullYear())}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
}

function countByWeek(rows: readonly RequestRow[], now: Date, period: MissingPeriod): MissingCount[] {
  const oldest = rows.at(-1);
  if (oldest === undefined) {
    return [];
  }
  const firstDay = period === 0 ? new Date(oldest.recorded_at) : new Date(now.getTime() - period * DAY_MS);
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = dayKey(weekStart(new Date(row.recorded_at)));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const weeks: MissingCount[] = [];
  const last = weekStart(now);
  for (let week = weekStart(firstDay); week <= last; week.setDate(week.getDate() + DAYS_PER_WEEK)) {
    const key = dayKey(week);
    weeks.push({ key, count: counts.get(key) ?? 0 });
  }
  return weeks.slice(-MAX_WEEKS);
}

function countByWeekday(rows: readonly RequestRow[]): MissingCount[] {
  const counts = Array.from({ length: DAYS_PER_WEEK }, () => 0);
  for (const row of rows) {
    const weekday = new Date(row.recorded_at).getDay();
    counts[weekday] = (counts[weekday] ?? 0) + 1;
  }
  return counts.map((count, weekday) => ({ key: String(weekday), count }));
}
