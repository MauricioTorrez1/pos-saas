import type { StatementSync } from 'node:sqlite';

import type { CashTotals, ExpectedCut } from '../../shared/cash';
import type { CashMovementKind } from '../../shared/cash-api';
import type { LocalStore } from '../local-store/local-store';
import { SyncOutbox } from '../sync/sync-outbox';
import { uuidV7 } from '../uuid-v7';

/** A session that is open, as the database has it. */
export interface OpenSessionRow {
  readonly id: string;
  readonly openedByName: string;
  readonly openedAt: string;
  readonly openingFloatCents: number;
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
  readonly opened_by_name: string;
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
   */
  constructor(store: LocalStore, tenantId: string) {
    this.#store = store;
    this.#tenantId = tenantId;
    this.#outbox = new SyncOutbox(store, tenantId);
    this.#findOpen = store.prepare(`
      SELECT s.id, s.opened_at, s.opening_float_cents, u.name AS opened_by_name
      FROM cash_session s JOIN app_user u ON u.id = s.opened_by
      WHERE s.tenant_id = ? AND s.closed_at IS NULL
    `);
    this.#insertSession = store.prepare(`
      INSERT INTO cash_session (id, tenant_id, opened_by, opened_at, opening_float_cents) VALUES (?, ?, ?, ?, ?)
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

  /**
   * Finds the session that is open.
   *
   * @returns it, or null when the register is closed
   */
  findOpen(): OpenSessionRow | null {
    const row = this.#findOpen.get(this.#tenantId) as unknown as SessionRowSql | undefined;
    return row === undefined
      ? null
      : { id: row.id, openedByName: row.opened_by_name, openedAt: row.opened_at, openingFloatCents: row.opening_float_cents };
  }

  /**
   * Opens the register with a float.
   *
   * @param userId who opens it
   * @param openingFloatCents the cash they put in the drawer to start
   * @returns the id of the new session
   * @throws Error from SQLite if a session is already open, because there is only one at a time
   */
  open(userId: string, openingFloatCents: number): string {
    const id = uuidV7();
    this.#store.transaction(() => {
      const openedAt = new Date().toISOString();
      this.#insertSession.run(id, this.#tenantId, userId, openedAt, openingFloatCents);
      this.#outbox.enqueue('cash_session.opened', { sessionId: id, openedBy: userId, openingFloatCents }, openedAt);
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
    const movementId = uuidV7();
    this.#store.transaction(() => {
      const recordedAt = new Date().toISOString();
      this.#insertMovement.run(movementId, this.#tenantId, sessionId, kind, amountCents, reason, recordedBy, authorizedBy, recordedAt);
      this.#outbox.enqueue('cash_movement.recorded', { movementId, sessionId, kind, amountCents, reason, recordedBy, authorizedBy }, recordedAt);
    });
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
   * @returns the id and the moment of the cut
   */
  close(sessionId: string, cut: CutRecord): { id: string; cutAt: string } {
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
