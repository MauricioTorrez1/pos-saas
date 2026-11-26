import type { StatementSync } from 'node:sqlite';

import type { CashTotals, ExpectedCut } from '../../shared/cash';
import type { CashMovementKind } from '../../shared/cash-api';
import type { LocalStore } from '../local-store/local-store';
import { localDayOf } from '../reports/period';
import { SyncOutbox } from '../sync/sync-outbox';
import { uuidV7 } from '../uuid-v7';

/** A session that is open, as the database has it. */
export interface OpenSessionRow {
  readonly id: string;
  /** Who opened it, by id. */
  readonly openedById: string;
  readonly openedByName: string;
  readonly openedAt: string;
  readonly openingFloatCents: number;
  /** The past day it captures, or null when it sells today (E1-60). */
  readonly businessDay: string | null;
  /** The day it belongs to: the day it captures, or the local day it opened (E1-61). */
  readonly sessionDay: string;
  /** The cut of its day that this supplementary capture amends, or null (E1-61). */
  readonly amendsCutId: string | null;
}

/** A cut that was saved, as the database has it. */
export interface SavedCut {
  readonly id: string;
  readonly sessionId: string;
  readonly cutAt: string;
  readonly cutByName: string;
  readonly expected: ExpectedCut;
  readonly counted: ExpectedCut;
}

/** What a cut saves. */
export interface CutRecord {
  readonly cutBy: string;
  readonly expected: ExpectedCut;
  readonly counted: ExpectedCut;
  readonly denominations: Readonly<Record<number, number>>;
  readonly reason: string | null;
}

interface SessionRowSql {
  readonly id: string;
  readonly opened_at: string;
  readonly opening_float_cents: number;
  readonly opened_by: string;
  readonly opened_by_name: string;
  readonly business_day: string | null;
  readonly session_day: string;
  readonly amends_cut_id: string | null;
}

interface CutRowSql {
  readonly id: string;
  readonly session_id: string;
  readonly cut_at: string;
  readonly cut_by_name: string;
  readonly expected_cash_cents: number;
  readonly counted_cash_cents: number;
  readonly expected_card_cents: number;
  readonly counted_card_cents: number;
  readonly expected_transfer_cents: number;
  readonly counted_transfer_cents: number;
}

interface ClosedSessionSql {
  readonly opened_at: string;
  readonly business_day: string | null;
  readonly session_day: string | null;
  readonly cut_id: string;
}

const SESSION_COLUMNS = `
  s.id, s.opened_at, s.opening_float_cents, s.opened_by, u.name AS opened_by_name, s.business_day, s.session_day, s.amends_cut_id
`;

const CUT_COLUMNS = `
  c.id, c.session_id, c.cut_at, u.name AS cut_by_name, c.expected_cash_cents, c.counted_cash_cents, c.expected_card_cents,
  c.counted_card_cents, c.expected_transfer_cents, c.counted_transfer_cents
`;

/** How far before the oldest day a closed session is read, because its opening is in UTC and its day is local. */
const DAY_MARGIN_MS = 2 * 86_400_000;

function toSession(row: SessionRowSql): OpenSessionRow {
  return {
    id: row.id,
    openedById: row.opened_by,
    openedByName: row.opened_by_name,
    openedAt: row.opened_at,
    openingFloatCents: row.opening_float_cents,
    businessDay: row.business_day,
    sessionDay: row.session_day,
    amendsCutId: row.amends_cut_id,
  };
}

function toCut(row: CutRowSql): SavedCut {
  return {
    id: row.id,
    sessionId: row.session_id,
    cutAt: row.cut_at,
    cutByName: row.cut_by_name,
    expected: { cashCents: row.expected_cash_cents, cardCents: row.expected_card_cents, transferCents: row.expected_transfer_cents },
    counted: { cashCents: row.counted_cash_cents, cardCents: row.counted_card_cents, transferCents: row.counted_transfer_cents },
  };
}

/** A session closed before E1-61 has no stored day: its day is the one it captured or the local day it opened. */
function dayOfClosed(row: ClosedSessionSql): string {
  return row.session_day ?? row.business_day ?? localDayOf(Date.parse(row.opened_at));
}

interface TotalsRowSql {
  readonly cash_sales: number;
  readonly card_sales: number;
  readonly transfer_sales: number;
}

interface MovementTotalsSql {
  readonly cash_in: number;
  readonly cash_out: number;
}

interface RefundTotalsSql {
  readonly cash_refunds: number;
  readonly card_refunds: number;
  readonly transfer_refunds: number;
}

/**
 * Keeps the cash sessions of one business: who opened the register and with how much, what came in and out of the drawer,
 * and the cut that closes it. Every change is one transaction (ADR 0029).
 */
export class CashSessionStore {
  readonly #store: LocalStore;
  readonly #tenantId: string;
  readonly #findOpen: StatementSync;
  readonly #listOpen: StatementSync;
  readonly #closedSince: StatementSync;
  readonly #findCut: StatementSync;
  readonly #now: () => Date;
  readonly #insertSession: StatementSync;
  readonly #salesTotals: StatementSync;
  readonly #movementTotals: StatementSync;
  readonly #refundTotals: StatementSync;
  readonly #insertMovement: StatementSync;
  readonly #pendingCount: StatementSync;
  readonly #insertCut: StatementSync;
  readonly #closeSession: StatementSync;
  readonly #readSetting: StatementSync;
  readonly #writeSetting: StatementSync;
  readonly #outbox: SyncOutbox;

  /**
   * @param store the open local database
   * @param tenantId the business whose sessions this store sees
   * @param now the clock that says which day is today, so a test can move it
   */
  constructor(store: LocalStore, tenantId: string, now: () => Date = () => new Date()) {
    this.#store = store;
    this.#tenantId = tenantId;
    this.#now = now;
    this.#outbox = new SyncOutbox(store, tenantId);
    // The unfinished session of a day comes before a supplementary capture of it written under E1-60, so it is the one resumed.
    this.#findOpen = store.prepare(`
      SELECT ${SESSION_COLUMNS}
      FROM cash_session s JOIN app_user u ON u.id = s.opened_by
      WHERE s.tenant_id = ? AND s.closed_at IS NULL AND s.session_day = ?
      ORDER BY s.business_day IS NOT NULL, s.opened_at LIMIT 1
    `);
    this.#listOpen = store.prepare(`
      SELECT ${SESSION_COLUMNS}
      FROM cash_session s JOIN app_user u ON u.id = s.opened_by
      WHERE s.tenant_id = ? AND s.closed_at IS NULL
      ORDER BY s.session_day DESC, s.business_day IS NOT NULL, s.opened_at
    `);
    this.#closedSince = store.prepare(`
      SELECT s.opened_at, s.business_day, s.session_day, c.id AS cut_id
      FROM cash_session s JOIN cash_cut c ON c.session_id = s.id
      WHERE s.tenant_id = ? AND s.closed_at IS NOT NULL AND (s.opened_at >= ? OR s.business_day >= ?)
      ORDER BY c.cut_at
    `);
    this.#findCut = store.prepare(`
      SELECT ${CUT_COLUMNS} FROM cash_cut c JOIN app_user u ON u.id = c.cut_by WHERE c.tenant_id = ? AND c.id = ?
    `);
    this.#insertSession = store.prepare(`
      INSERT INTO cash_session (id, tenant_id, opened_by, opened_at, opening_float_cents, business_day, session_day, amends_cut_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.#salesTotals = store.prepare(`
      SELECT
        coalesce(sum(CASE WHEN p.method = 'cash' THEN p.amount_cents END), 0) AS cash_sales,
        coalesce(sum(CASE WHEN p.method IN ('card', 'card_manual') THEN p.amount_cents END), 0) AS card_sales,
        coalesce(sum(CASE WHEN p.method = 'transfer' THEN p.amount_cents END), 0) AS transfer_sales
      FROM payment p JOIN sale s ON s.id = p.sale_id
      WHERE s.tenant_id = ? AND s.cash_session_id = ? AND s.status = 'completed'
    `);
    this.#movementTotals = store.prepare(`
      SELECT
        coalesce(sum(CASE WHEN kind = 'in' THEN amount_cents END), 0) AS cash_in,
        coalesce(sum(CASE WHEN kind = 'out' THEN amount_cents END), 0) AS cash_out
      FROM cash_movement WHERE tenant_id = ? AND session_id = ?
    `);
    this.#refundTotals = store.prepare(`
      SELECT
        coalesce(sum(CASE WHEN rp.method = 'cash' THEN rp.amount_cents END), 0) AS cash_refunds,
        coalesce(sum(CASE WHEN rp.method IN ('card', 'card_manual') THEN rp.amount_cents END), 0) AS card_refunds,
        coalesce(sum(CASE WHEN rp.method = 'transfer' THEN rp.amount_cents END), 0) AS transfer_refunds
      FROM refund_payment rp JOIN sale_return r ON r.id = rp.return_id
      WHERE r.tenant_id = ? AND r.cash_session_id = ?
    `);
    this.#insertMovement = store.prepare(`
      INSERT INTO cash_movement (id, tenant_id, session_id, kind, amount_cents, reason, recorded_by, authorized_by, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.#pendingCount = store.prepare(`
      SELECT count(*) AS total FROM sale WHERE tenant_id = ? AND status = 'pending_payment'
    `);
    this.#insertCut = store.prepare(`
      INSERT INTO cash_cut (id, tenant_id, session_id, cut_by, cut_at, expected_cash_cents, counted_cash_cents,
        expected_card_cents, counted_card_cents, expected_transfer_cents, counted_transfer_cents, denominations, reason)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.#closeSession = store.prepare('UPDATE cash_session SET closed_by = ?, closed_at = ? WHERE tenant_id = ? AND id = ?');
    this.#readSetting = store.prepare('SELECT value FROM register_setting WHERE tenant_id = ? AND name = ?');
    this.#writeSetting = store.prepare(`
      INSERT INTO register_setting (tenant_id, name, value) VALUES (?, ?, ?)
      ON CONFLICT (tenant_id, name) DO UPDATE SET value = excluded.value
    `);
  }

  /** @returns today in the time zone of the register */
  today(): string {
    return localDayOf(this.#now().getTime());
  }

  /**
   * Finds the session that is open for a day. Each day has its own: today's drawer never sees the session a past day left
   * without its cut, and signing in to that past day finds that very session to resume it (E1-60, E1-61).
   *
   * @param day the day, or null for today
   * @returns it, or null when that day has no open session
   */
  findOpen(day: string | null = null): OpenSessionRow | null {
    const row = this.#findOpen.get(this.#tenantId, day ?? this.today()) as unknown as SessionRowSql | undefined;
    return row === undefined ? null : toSession(row);
  }

  /** @returns every session left open, newest day first: today's drawer and the past days still without a cut */
  listOpen(): OpenSessionRow[] {
    return (this.#listOpen.all(this.#tenantId) as unknown as SessionRowSql[]).map(toSession);
  }

  /**
   * Lists the cuts of each day from a day on.
   *
   * @param oldestDay `YYYY-MM-DD`, the oldest day wanted
   * @returns the ids of the cuts by day, in the order they were made
   */
  cutsByDaySince(oldestDay: string): Map<string, string[]> {
    const since = new Date(Date.parse(`${oldestDay}T00:00:00Z`) - DAY_MARGIN_MS).toISOString();
    const cuts = new Map<string, string[]>();
    for (const row of this.#closedSince.all(this.#tenantId, since, oldestDay) as unknown as ClosedSessionSql[]) {
      const day = dayOfClosed(row);
      cuts.set(day, [...(cuts.get(day) ?? []), row.cut_id]);
    }
    return cuts;
  }

  /**
   * Reads a cut that was saved.
   *
   * @param cutId the cut
   * @returns it, or null when there is none with that id
   */
  findCut(cutId: string): SavedCut | null {
    const row = this.#findCut.get(this.#tenantId, cutId) as unknown as CutRowSql | undefined;
    return row === undefined ? null : toCut(row);
  }

  /**
   * Opens the register with a float.
   *
   * @param userId who opens it
   * @param openingFloatCents the cash they put in the drawer to start
   * @param alongWith work that must commit or roll back with the opening, such as its line in the audit log
   * @param businessDay the past day a backdated capture works on, or null for today's drawer (E1-60)
   * @param amendsCutId the cut of that day a supplementary capture amends, or null (E1-61)
   * @returns the id of the new session
   * @throws Error from SQLite if a session of the same day and kind is already open, because there is only one at a time
   */
  open(
    userId: string,
    openingFloatCents: number,
    alongWith?: (sessionId: string) => void,
    businessDay: string | null = null,
    amendsCutId: string | null = null,
  ): string {
    const id = uuidV7();
    this.#store.transaction(() => {
      const openedAt = this.#now().toISOString();
      this.#insertSession.run(id, this.#tenantId, userId, openedAt, openingFloatCents, businessDay, businessDay ?? this.today(), amendsCutId);
      this.#outbox.enqueue(
        'cash_session.opened',
        { sessionId: id, openedBy: userId, openingFloatCents, ...(businessDay === null ? {} : { businessDate: businessDay }) },
        openedAt,
      );
      alongWith?.(id);
    });
    return id;
  }

  /**
   * Adds up what moved in a session.
   *
   * @param session the session
   * @returns the totals the cut and the withdrawal warning are worked out from
   */
  totals(session: OpenSessionRow): CashTotals {
    const sales = this.#salesTotals.get(this.#tenantId, session.id) as unknown as TotalsRowSql;
    const movements = this.#movementTotals.get(this.#tenantId, session.id) as unknown as MovementTotalsSql;
    const refunds = this.#refundTotals.get(this.#tenantId, session.id) as unknown as RefundTotalsSql;
    return {
      openingFloatCents: session.openingFloatCents,
      cashSalesCents: sales.cash_sales,
      cardSalesCents: sales.card_sales,
      transferSalesCents: sales.transfer_sales,
      cashInCents: movements.cash_in,
      cashOutCents: movements.cash_out,
      cashRefundsCents: refunds.cash_refunds,
      cardRefundsCents: refunds.card_refunds,
      transferRefundsCents: refunds.transfer_refunds,
    };
  }

  /**
   * Records cash going into or out of the drawer.
   *
   * @param sessionId the open session
   * @param kind an entry or an exit
   * @param amountCents the cash, positive
   * @param reason why, which cannot be empty
   * @param recordedBy who did it
   * @param authorizedBy the owner who approved it, when a cashier took cash out
   */
  addMovement(
    sessionId: string,
    kind: CashMovementKind,
    amountCents: number,
    reason: string,
    recordedBy: string,
    authorizedBy: string | null,
  ): void {
    this.#store.transaction(() => {
      this.writeMovement(sessionId, kind, amountCents, reason, recordedBy, authorizedBy);
    });
  }

  /**
   * Writes a cash entry or exit inside a transaction that is already open, so another record (such as an expense paid
   * from the drawer) commits or rolls back together with it.
   *
   * @param sessionId the open session
   * @param kind an entry or an exit
   * @param amountCents the cash, positive
   * @param reason why, which cannot be empty
   * @param recordedBy who did it
   * @param authorizedBy the owner who approved it, or null
   * @returns the id of the movement
   * @throws Error if no transaction is open
   */
  writeMovement(sessionId: string, kind: CashMovementKind, amountCents: number, reason: string, recordedBy: string, authorizedBy: string | null): string {
    if (!this.#store.isInTransaction) {
      throw new Error('A cash movement written with another record needs the transaction of that record');
    }
    const movementId = uuidV7();
    const recordedAt = new Date().toISOString();
    this.#insertMovement.run(movementId, this.#tenantId, sessionId, kind, amountCents, reason, recordedBy, authorizedBy, recordedAt);
    this.#outbox.enqueue('cash_movement.recorded', { movementId, sessionId, kind, amountCents, reason, recordedBy, authorizedBy }, recordedAt);
    return movementId;
  }

  /**
   * Counts the sales that nobody has answered for. A cut waits for them, because their payments are not final.
   *
   * @returns how many sales are pending
   */
  pendingSalesCount(): number {
    return (this.#pendingCount.get(this.#tenantId) as unknown as { total: number }).total;
  }

  /**
   * Saves the cut and closes the session in the same transaction, so a session is never closed without its cut.
   *
   * @param sessionId the open session
   * @param cut what was found and counted
   * @param businessDay the past day of a backdated session, which the event carries so the core knows the cut is a
   *   supplementary one of that day
   * @returns the id and the moment of the cut
   */
  close(sessionId: string, cut: CutRecord, businessDay: string | null = null): { id: string; cutAt: string } {
    const id = uuidV7();
    const cutAt = new Date().toISOString();
    this.#store.transaction(() => {
      this.#insertCut.run(
        id,
        this.#tenantId,
        sessionId,
        cut.cutBy,
        cutAt,
        cut.expected.cashCents,
        cut.counted.cashCents,
        cut.expected.cardCents,
        cut.counted.cardCents,
        cut.expected.transferCents,
        cut.counted.transferCents,
        JSON.stringify(cut.denominations),
        cut.reason,
      );
      this.#closeSession.run(cut.cutBy, cutAt, this.#tenantId, sessionId);
      this.#outbox.enqueue(
        'cash_session.closed',
        {
          sessionId,
          cutId: id,
          closedBy: cut.cutBy,
          expected: { cashCents: cut.expected.cashCents, cardCents: cut.expected.cardCents, transferCents: cut.expected.transferCents },
          counted: { cashCents: cut.counted.cashCents, cardCents: cut.counted.cardCents, transferCents: cut.counted.transferCents },
          denominations: cut.denominations,
          reason: cut.reason,
          ...(businessDay === null ? {} : { businessDate: businessDay }),
        },
        cutAt,
      );
    });
    return { id, cutAt };
  }

  /**
   * Reads a setting of the register.
   *
   * @param name the setting
   * @returns its value, or null if the owner never set it
   */
  readSetting(name: string): string | null {
    const row = this.#readSetting.get(this.#tenantId, name) as unknown as { value: string } | undefined;
    return row?.value ?? null;
  }

  /**
   * Saves a setting of the register.
   *
   * @param name the setting
   * @param value its value
   */
  writeSetting(name: string, value: string): void {
    this.#store.transaction(() => {
      this.#writeSetting.run(this.#tenantId, name, value);
    });
  }
}
