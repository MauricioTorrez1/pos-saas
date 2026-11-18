import type { LocalStore } from '../local-store/local-store';

const NO_NAME = 'Sin nombre';

/** The cash of one cashier in a period: the shifts they opened and the cuts of those shifts. Money in cents. */
export interface CashierCash {
  readonly name: string;
  /** Shifts opened in the period. */
  readonly sessions: number;
  /** The opening floats of those shifts, added up. */
  readonly openingFloatCents: number;
  /** Cuts made in the period of the shifts this cashier opened. */
  readonly cuts: number;
  /** Cuts where what was counted was not what was expected, in cash, card or transfer. */
  readonly cutsWithDifference: number;
  /** Cash counted minus cash expected: negative is missing money, positive is extra money. */
  readonly cashDifferenceCents: number;
  /** The same for the vouchers of card and the transfers. */
  readonly otherDifferenceCents: number;
}

/** The orders to suppliers: the drafts still open, and the ones sent in the period. Money in cents. */
export interface PurchaseSnapshot {
  readonly draftCount: number;
  /** The drafts at their known costs. */
  readonly draftTotalCents: number;
  readonly sentCount: number;
  /** What was sent in the period, at its known costs. */
  readonly sentTotalCents: number;
  /** Lines of those orders without a cost, which are not in the totals. */
  readonly linesWithoutCost: number;
}

/** What the illustrated report reads that the summary of the business does not have. */
export interface ReportExtras {
  readonly cashiers: readonly CashierCash[];
  readonly purchases: PurchaseSnapshot;
}

interface SessionRow {
  readonly name: string;
  readonly sessions: number;
  readonly floats: number;
}

interface CutRow {
  readonly name: string;
  readonly cuts: number;
  readonly withDifference: number;
  readonly cashDifference: number;
  readonly otherDifference: number;
}

/**
 * Reads the cuts of the drawer and the orders to suppliers of a period for the illustrated report (E1-57, ADR 0073). It
 * only reads, and everything is added up by the database in integer cents.
 */
export class ReportReader {
  readonly #store: LocalStore;
  readonly #tenantId: string;

  /**
   * @param store the open local database
   * @param tenantId the business
   */
  constructor(store: LocalStore, tenantId: string) {
    this.#store = store;
    this.#tenantId = tenantId;
  }

  /**
   * Reads the extras of a period.
   *
   * @param fromIso the first moment of the period, included, as ISO text in UTC
   * @param toIso the moment the period ends, excluded
   * @returns the cash by cashier and the orders to suppliers
   */
  read(fromIso: string, toIso: string): ReportExtras {
    return { cashiers: this.#cashiers(fromIso, toIso), purchases: this.#purchases(fromIso, toIso) };
  }

  #cashiers(fromIso: string, toIso: string): CashierCash[] {
    const sessions = this.#store
      .prepare(
        `SELECT coalesce(u.name, ?) AS name, count(*) AS sessions, sum(c.opening_float_cents) AS floats
         FROM cash_session c LEFT JOIN app_user u ON u.id = c.opened_by
         WHERE c.tenant_id = ? AND c.opened_at >= ? AND c.opened_at < ?
         GROUP BY c.opened_by`,
      )
      .all(NO_NAME, this.#tenantId, fromIso, toIso) as unknown as SessionRow[];
    const cuts = this.#store
      .prepare(
        `SELECT coalesce(u.name, ?) AS name, count(*) AS cuts,
                sum(CASE WHEN k.counted_cash_cents <> k.expected_cash_cents OR k.counted_card_cents <> k.expected_card_cents
                          OR k.counted_transfer_cents <> k.expected_transfer_cents THEN 1 ELSE 0 END) AS withDifference,
                sum(k.counted_cash_cents - k.expected_cash_cents) AS cashDifference,
                sum(k.counted_card_cents - k.expected_card_cents + k.counted_transfer_cents - k.expected_transfer_cents) AS otherDifference
         FROM cash_cut k JOIN cash_session c ON c.id = k.session_id LEFT JOIN app_user u ON u.id = c.opened_by
         WHERE k.tenant_id = ? AND k.cut_at >= ? AND k.cut_at < ?
         GROUP BY c.opened_by`,
      )
      .all(NO_NAME, this.#tenantId, fromIso, toIso) as unknown as CutRow[];
    const byName = new Map<string, CashierCash>();
    const empty = (name: string): CashierCash => ({
      name,
      sessions: 0,
      openingFloatCents: 0,
      cuts: 0,
      cutsWithDifference: 0,
      cashDifferenceCents: 0,
      otherDifferenceCents: 0,
    });
    for (const row of sessions) {
      const known = byName.get(row.name) ?? empty(row.name);
      byName.set(row.name, { ...known, sessions: known.sessions + row.sessions, openingFloatCents: known.openingFloatCents + row.floats });
    }
    for (const row of cuts) {
      const known = byName.get(row.name) ?? empty(row.name);
      byName.set(row.name, {
        ...known,
        cuts: known.cuts + row.cuts,
        cutsWithDifference: known.cutsWithDifference + row.withDifference,
        cashDifferenceCents: known.cashDifferenceCents + row.cashDifference,
        otherDifferenceCents: known.otherDifferenceCents + row.otherDifference,
      });
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }

  #purchases(fromIso: string, toIso: string): PurchaseSnapshot {
    const row = this.#store
      .prepare(
        `SELECT coalesce(sum(CASE WHEN o.status = 'draft' THEN 1 ELSE 0 END), 0) AS draftCount,
                coalesce(sum(CASE WHEN o.status = 'draft' THEN coalesce(t.total, 0) ELSE 0 END), 0) AS draftTotal,
                coalesce(sum(CASE WHEN o.status = 'sent' THEN 1 ELSE 0 END), 0) AS sentCount,
                coalesce(sum(CASE WHEN o.status = 'sent' THEN coalesce(t.total, 0) ELSE 0 END), 0) AS sentTotal,
                coalesce(sum(coalesce(t.uncosted, 0)), 0) AS uncosted
         FROM purchase_order o
         LEFT JOIN (SELECT order_id, coalesce(sum(line_total_cents), 0) AS total, sum(CASE WHEN line_total_cents IS NULL THEN 1 ELSE 0 END) AS uncosted
               FROM purchase_order_line GROUP BY order_id) t ON t.order_id = o.id
         WHERE o.tenant_id = ? AND (o.status = 'draft' OR (o.sent_at >= ? AND o.sent_at < ?))`,
      )
      .get(this.#tenantId, fromIso, toIso) as unknown as { draftCount: number; draftTotal: number; sentCount: number; sentTotal: number; uncosted: number };
    return {
      draftCount: row.draftCount,
      draftTotalCents: row.draftTotal,
      sentCount: row.sentCount,
      sentTotalCents: row.sentTotal,
      linesWithoutCost: row.uncosted,
    };
  }
}
