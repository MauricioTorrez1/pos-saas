import type { Unit } from '@pos-saas/money';

import type {
  CashierBucket,
  CostSource,
  DashboardRequest,
  DashboardResult,
  DashboardSummary,
  HourBucket,
  InventorySection,
  LimitedList,
  MethodAmount,
  PaymentKind,
  PaymentKindSales,
  PeriodRange,
  PeriodTotals,
  StockLine,
  TimeBucket,
  TopMetric,
  TopSeller,
  WeekdayBucket,
} from '../../shared/dashboard-api';
import type { UserSummary } from '../../shared/auth';
import { MISC_PRODUCT_ID } from '../../shared/miscellaneous';
import { isRefusal, type OwnerGate } from '../auth/owner-gate';
import type { LocalStore } from '../local-store/local-store';
import { averageCostE6, costInCents, divideHalfUp, type CostedEntry } from './average-cost';
import {
  dayCountBetween,
  daysOf,
  localDayOf,
  monthsOf,
  offsetSegments,
  previousPeriod,
  resolvePeriod,
  weekdayOf,
  type ResolvedPeriod,
} from './period';

const LIST_LIMIT = 50;
const MONTHLY_TREND_FROM_DAYS = 62;
const MISC_NAME = 'Varios (sin catálogo)';
const NO_CASHIER = 'Sin cajero';

/** The part of the queries that narrows them to one shift. */
interface Scope {
  readonly sales: string;
  readonly returns: string;
  readonly params: readonly string[];
}

const WHOLE_BUSINESS: Scope = { sales: '', returns: '', params: [] };

interface ProductAggregate {
  readonly productId: string;
  readonly name: string;
  readonly unit: Unit;
  soldMilli: number;
  soldSubtotalCents: number;
  soldTotalCents: number;
  lines: number;
  returnedMilli: number;
  returnedSubtotalCents: number;
  returnedTotalCents: number;
}

interface CostInfo {
  readonly costE6: number;
  readonly source: Exclude<CostSource, 'none'>;
}

interface ProductRow {
  readonly id: string;
  readonly name: string;
  readonly unit: Unit;
  readonly typedCostE6: number | null;
  readonly isActive: number;
}

/** The facts about products that the owner's sections share. */
interface Catalog {
  readonly products: readonly ProductRow[];
  readonly costs: ReadonlyMap<string, CostInfo>;
  readonly stock: ReadonlyMap<string, number>;
}

/**
 * What the dashboard reads: the completed sales, the returns and the ledger of the register, everything in SQLite and
 * summarized by the database, so a year of sales answers while the cashier waits. It only reads (ADR 0060).
 *
 * The owner sees the whole business. A cashier sees only the sales of their own shift, with no costs, unless they type the
 * PIN of an owner, which works as in every sensitive action of the register (ADR 0047).
 */
export class DashboardService {
  readonly #store: LocalStore;
  readonly #tenantId: string;
  readonly #gate: Pick<OwnerGate, 'authorize'>;
  readonly #now: () => Date;

  /**
   * @param store the open local database
   * @param tenantId the business
   * @param gate who approves a cashier that wants the whole summary
   * @param now the clock, so a test can move time
   */
  constructor(store: LocalStore, tenantId: string, gate: Pick<OwnerGate, 'authorize'>, now: () => Date = () => new Date()) {
    this.#store = store;
    this.#tenantId = tenantId;
    this.#gate = gate;
    this.#now = now;
  }

  /**
   * Builds the summary of a period.
   *
   * @param request the period, the order of «Más vendidos» and, for a cashier, the PIN of an owner
   * @param user who is signed in
   * @returns the summary, or why a cashier was not given the whole one
   * @throws RangeError if a day does not exist or the range is not valid
   */
  summary(request: DashboardRequest, user: UserSummary): DashboardResult {
    if (user.role !== 'owner' && request.ownerPin !== undefined && request.ownerPin !== '') {
      const approval = this.#gate.authorize({
        user,
        ownerPin: request.ownerPin,
        deniedAction: 'report.dashboard_denied',
        entity: 'dashboard',
        entityId: 'summary',
        deniedDetail: 'asked for the summary of the business',
      });
      if (isRefusal(approval)) {
        // Without a PIN the cashier gets the shift view above, so a refusal here is always about the PIN that was typed.
        return approval.status === 'locked' ? approval : { status: 'wrong_pin', attemptsLeft: approval.status === 'wrong_pin' ? approval.attemptsLeft : 0 };
      }
      return { status: 'ok', summary: this.#business(request) };
    }
    return { status: 'ok', summary: user.role === 'owner' ? this.#business(request) : this.#shift(request, user) };
  }

  #business(request: DashboardRequest): DashboardSummary {
    const period = resolvePeriod(request.period, request.date, request.endDate);
    const previous = previousPeriod(period);
    const catalog = this.#catalog();
    const current = this.#totals(period, WHOLE_BUSINESS, catalog.costs);
    return this.#assemble(request, period, WHOLE_BUSINESS, current, {
      scope: 'business',
      previous,
      previousTotals: this.#totals(previous, WHOLE_BUSINESS, catalog.costs).totals,
      catalog,
    });
  }

  #shift(request: DashboardRequest, user: UserSummary): DashboardSummary {
    const now = this.#now().getTime();
    const session = this.#shiftSession(user.id);
    const fromMs = session === null ? now : Math.min(Date.parse(session.openedAt), now);
    const toMs = now + 1;
    const period: ResolvedPeriod = {
      kind: 'shift',
      fromDay: localDayOf(fromMs),
      toDay: localDayOf(now),
      dayCount: dayCountBetween(localDayOf(fromMs), localDayOf(now)),
      fromMs,
      toMs,
    };
    const scope: Scope = {
      sales: 'AND s.cash_session_id = ? AND s.cashier_id = ?',
      returns: 'AND r.cash_session_id = ? AND r.requested_by = ?',
      params: [session?.id ?? '', user.id],
    };
    const current = this.#totals(period, scope, null);
    return this.#assemble({ ...request, topMetric: request.topMetric === 'profit' ? 'amount' : request.topMetric }, period, scope, current, {
      scope: 'shift',
      previous: null,
      previousTotals: null,
      catalog: null,
    });
  }

  /** The shift of a cashier is the open cash session, or else the last one they sold in. */
  #shiftSession(userId: string): { id: string; openedAt: string } | null {
    const open = this.#store.prepare('SELECT id, opened_at AS openedAt FROM cash_session WHERE tenant_id = ? AND closed_at IS NULL').get(this.#tenantId) as unknown as
      | { id: string; openedAt: string }
      | undefined;
    if (open !== undefined) {
      return open;
    }
    return (
      (this.#store
        .prepare(
          `SELECT c.id, c.opened_at AS openedAt FROM cash_session c
           WHERE c.id = (SELECT cash_session_id FROM sale WHERE tenant_id = ? AND cashier_id = ? AND status = 'completed' AND cash_session_id IS NOT NULL
                         ORDER BY resolved_at DESC LIMIT 1)`,
        )
        .get(this.#tenantId, userId) as unknown as { id: string; openedAt: string } | undefined) ?? null
    );
  }

  #assemble(
    request: DashboardRequest,
    period: ResolvedPeriod,
    scope: Scope,
    current: { totals: PeriodTotals; aggregates: Map<string, ProductAggregate> },
    context: {
      scope: 'business' | 'shift';
      previous: ResolvedPeriod | null;
      previousTotals: PeriodTotals | null;
      catalog: Catalog | null;
    },
  ): DashboardSummary {
    const { catalog } = context;
    const time = this.#timeBuckets(period, scope);
    const dayCount = period.dayCount;
    return {
      scope: context.scope,
      includesCosts: catalog !== null,
      generatedAt: this.#now().toISOString(),
      period: publicRange(period),
      previousPeriod: context.previous === null ? null : publicRange(context.previous),
      isInProgress: this.#now().getTime() < period.toMs,
      totals: current.totals,
      previousTotals: context.previousTotals,
      cancellations: this.#cancellations(period, scope),
      paymentKinds: this.#paymentKinds(period, scope),
      methodAmounts: this.#methodAmounts(period, scope),
      trendUnit: dayCount > MONTHLY_TREND_FROM_DAYS ? 'month' : 'day',
      trend: trendOf(period, time.byDay, dayCount > MONTHLY_TREND_FROM_DAYS),
      byHour: time.byHour,
      byWeekday: time.byWeekday,
      byCashier: catalog === null ? null : this.#byCashier(period, scope),
      topMetric: request.topMetric,
      topLimit: request.topLimit,
      topSellers: topSellers(current.aggregates, catalog?.costs ?? null, request.topMetric, request.topLimit),
      inventory: catalog === null ? null : inventoryOf(catalog, current.aggregates),
    };
  }

  /** The numbers of a period that do not depend on the time zone, and the sales of each product that make the profit. */
  #totals(
    period: ResolvedPeriod,
    scope: Scope,
    costs: ReadonlyMap<string, CostInfo> | null,
  ): { totals: PeriodTotals; aggregates: Map<string, ProductAggregate> } {
    const [from, to] = [new Date(period.fromMs).toISOString(), new Date(period.toMs).toISOString()];
    const sales = this.#store
      .prepare(
        `SELECT count(*) AS count, coalesce(sum(total_cents), 0) AS total, coalesce(sum(subtotal_cents), 0) AS subtotal, coalesce(sum(tax_cents), 0) AS tax
         FROM sale s WHERE s.tenant_id = ? AND s.status = 'completed' AND s.resolved_at >= ? AND s.resolved_at < ? ${scope.sales}`,
      )
      .get(this.#tenantId, from, to, ...scope.params) as unknown as { count: number; total: number; subtotal: number; tax: number };
    const returns = this.#store
      .prepare(
        `SELECT count(*) AS count, coalesce(sum(total_cents), 0) AS total
         FROM sale_return r WHERE r.tenant_id = ? AND r.occurred_at >= ? AND r.occurred_at < ? ${scope.returns}`,
      )
      .get(this.#tenantId, from, to, ...scope.params) as unknown as { count: number; total: number };
    const aggregates = this.#aggregates(from, to, scope);

    let lineCount = 0;
    let returnedSubtotalCents = 0;
    for (const aggregate of aggregates.values()) {
      lineCount += aggregate.lines;
      returnedSubtotalCents += aggregate.returnedSubtotalCents;
    }
    const netSubtotalCents = sales.subtotal - returnedSubtotalCents;
    const profit = costs === null ? null : profitOf(aggregates, costs);
    const totals: PeriodTotals = {
      salesCount: sales.count,
      totalCents: sales.total,
      subtotalCents: sales.subtotal,
      taxCents: sales.tax,
      lineCount,
      averageTicketCents: sales.count === 0 ? 0 : Number(divideHalfUp(BigInt(sales.total), BigInt(sales.count))),
      linesPerTicketX100: sales.count === 0 ? 0 : Number(divideHalfUp(BigInt(lineCount) * 100n, BigInt(sales.count))),
      returnsCount: returns.count,
      returnsCents: returns.total,
      netCents: sales.total - returns.total,
      netSubtotalCents,
      costOfGoodsCents: profit?.costOfGoodsCents ?? null,
      grossProfitCents: profit?.grossProfitCents ?? null,
      marginBp: profit?.marginBp ?? null,
      productsWithoutCostSold: profit?.productsWithoutCostSold ?? 0,
    };
    return { totals, aggregates };
  }

  #aggregates(from: string, to: string, scope: Scope): Map<string, ProductAggregate> {
    const aggregates = new Map<string, ProductAggregate>();
    const sold = this.#store
      .prepare(
        `SELECT l.product_id AS productId, coalesce(p.name, max(l.product_name)) AS name, max(l.unit) AS unit,
                sum(l.quantity_milli) AS soldMilli, sum(l.subtotal_cents) AS soldSubtotal, sum(l.line_total_cents) AS soldTotal, count(*) AS lines
         FROM sale s JOIN sale_line l ON l.sale_id = s.id LEFT JOIN product p ON p.id = l.product_id
         WHERE s.tenant_id = ? AND s.status = 'completed' AND s.resolved_at >= ? AND s.resolved_at < ? ${scope.sales}
         GROUP BY l.product_id`,
      )
      .all(this.#tenantId, from, to, ...scope.params) as unknown as {
      productId: string;
      name: string;
      unit: Unit;
      soldMilli: number;
      soldSubtotal: number;
      soldTotal: number;
      lines: number;
    }[];
    for (const row of sold) {
      aggregates.set(row.productId, {
        productId: row.productId,
        name: row.productId === MISC_PRODUCT_ID ? MISC_NAME : row.name,
        unit: row.unit,
        soldMilli: row.soldMilli,
        soldSubtotalCents: row.soldSubtotal,
        soldTotalCents: row.soldTotal,
        lines: row.lines,
        returnedMilli: 0,
        returnedSubtotalCents: 0,
        returnedTotalCents: 0,
      });
    }
    // The part of a refund that was VAT is the refund times the share of VAT of the line, rounded half up per return line.
    const returned = this.#store
      .prepare(
        `SELECT l.product_id AS productId, coalesce(p.name, max(l.product_name)) AS name, max(l.unit) AS unit,
                sum(rl.quantity_milli) AS milli, sum(rl.refund_cents) AS total,
                sum(CASE WHEN l.line_total_cents = 0 THEN 0
                         ELSE (rl.refund_cents * l.subtotal_cents * 2 + l.line_total_cents) / (l.line_total_cents * 2) END) AS subtotal
         FROM sale_return r JOIN sale_return_line rl ON rl.return_id = r.id JOIN sale_line l ON l.id = rl.sale_line_id
              LEFT JOIN product p ON p.id = l.product_id
         WHERE r.tenant_id = ? AND r.occurred_at >= ? AND r.occurred_at < ? ${scope.returns}
         GROUP BY l.product_id`,
      )
      .all(this.#tenantId, from, to, ...scope.params) as unknown as {
      productId: string;
      name: string;
      unit: Unit;
      milli: number;
      total: number;
      subtotal: number;
    }[];
    for (const row of returned) {
      const aggregate = aggregates.get(row.productId) ?? {
        productId: row.productId,
        name: row.productId === MISC_PRODUCT_ID ? MISC_NAME : row.name,
        unit: row.unit,
        soldMilli: 0,
        soldSubtotalCents: 0,
        soldTotalCents: 0,
        lines: 0,
        returnedMilli: 0,
        returnedSubtotalCents: 0,
        returnedTotalCents: 0,
      };
      aggregate.returnedMilli += row.milli;
      aggregate.returnedSubtotalCents += row.subtotal;
      aggregate.returnedTotalCents += row.total;
      aggregates.set(row.productId, aggregate);
    }
    return aggregates;
  }

  /** The days and hours of the sales, read in the local time of the register: one query per stretch with one offset. */
  #timeBuckets(period: ResolvedPeriod, scope: Scope): { byDay: Map<string, { salesCount: number; totalCents: number }>; byHour: HourBucket[]; byWeekday: WeekdayBucket[] } {
    const byDay = new Map<string, { salesCount: number; totalCents: number }>();
    const hours = Array.from({ length: 24 }, (_, hour): HourBucket => ({ hour, salesCount: 0, totalCents: 0 }));
    const weekdays = Array.from({ length: 7 }, (_, weekday): WeekdayBucket => ({ weekday, salesCount: 0, totalCents: 0 }));
    const statement = this.#store.prepare(
      `SELECT strftime('%Y-%m-%d', s.resolved_at, ?) AS day, CAST(strftime('%H', s.resolved_at, ?) AS INTEGER) AS hour,
              count(*) AS count, sum(s.total_cents) AS total
       FROM sale s WHERE s.tenant_id = ? AND s.status = 'completed' AND s.resolved_at >= ? AND s.resolved_at < ? ${scope.sales}
       GROUP BY day, hour`,
    );
    for (const segment of offsetSegments(period.fromMs, period.toMs)) {
      const modifier = `${segment.offsetMinutes >= 0 ? '+' : '-'}${Math.abs(segment.offsetMinutes)} minutes`;
      const rows = statement.all(
        modifier,
        modifier,
        this.#tenantId,
        new Date(segment.fromMs).toISOString(),
        new Date(segment.toMs).toISOString(),
        ...scope.params,
      ) as unknown as { day: string; hour: number; count: number; total: number }[];
      for (const row of rows) {
        const day = byDay.get(row.day) ?? { salesCount: 0, totalCents: 0 };
        byDay.set(row.day, { salesCount: day.salesCount + row.count, totalCents: day.totalCents + row.total });
        const hour = hours[row.hour]!;
        hours[row.hour] = { hour: row.hour, salesCount: hour.salesCount + row.count, totalCents: hour.totalCents + row.total };
        const weekdayIndex = weekdayOf(row.day);
        const weekday = weekdays[weekdayIndex]!;
        weekdays[weekdayIndex] = { weekday: weekdayIndex, salesCount: weekday.salesCount + row.count, totalCents: weekday.totalCents + row.total };
      }
    }
    return { byDay, byHour: hours, byWeekday: weekdays };
  }

  #cancellations(period: ResolvedPeriod, scope: Scope): { count: number; totalCents: number } {
    const row = this.#store
      .prepare(
        `SELECT count(*) AS count, coalesce(sum(s.total_cents), 0) AS total FROM sale s
         WHERE s.tenant_id = ? AND s.status = 'cancelled' AND coalesce(s.resolved_at, s.occurred_at) >= ? AND coalesce(s.resolved_at, s.occurred_at) < ? ${scope.sales}`,
      )
      .get(this.#tenantId, new Date(period.fromMs).toISOString(), new Date(period.toMs).toISOString(), ...scope.params) as unknown as { count: number; total: number };
    return { count: row.count, totalCents: row.total };
  }

  #paymentKinds(period: ResolvedPeriod, scope: Scope): PaymentKindSales[] {
    const rows = this.#store
      .prepare(
        `SELECT kind, count(*) AS count, sum(total) AS total FROM (
           SELECT s.id, s.total_cents AS total,
                  CASE WHEN count(DISTINCT CASE p.method WHEN 'card_manual' THEN 'card' ELSE p.method END) > 1 THEN 'mixed'
                       ELSE min(CASE p.method WHEN 'card_manual' THEN 'card' ELSE p.method END) END AS kind
           FROM sale s JOIN payment p ON p.sale_id = s.id
           WHERE s.tenant_id = ? AND s.status = 'completed' AND s.resolved_at >= ? AND s.resolved_at < ? ${scope.sales}
           GROUP BY s.id
         ) GROUP BY kind`,
      )
      .all(this.#tenantId, new Date(period.fromMs).toISOString(), new Date(period.toMs).toISOString(), ...scope.params) as unknown as {
      kind: PaymentKind;
      count: number;
      total: number;
    }[];
    const order: readonly PaymentKind[] = ['cash', 'card', 'transfer', 'mixed'];
    return order.map((kind) => {
      const row = rows.find((candidate) => candidate.kind === kind);
      return { kind, salesCount: row?.count ?? 0, totalCents: row?.total ?? 0 };
    });
  }

  #methodAmounts(period: ResolvedPeriod, scope: Scope): MethodAmount[] {
    const rows = this.#store
      .prepare(
        `SELECT CASE p.method WHEN 'card_manual' THEN 'card' ELSE p.method END AS method, sum(p.amount_cents) AS amount
         FROM sale s JOIN payment p ON p.sale_id = s.id
         WHERE s.tenant_id = ? AND s.status = 'completed' AND s.resolved_at >= ? AND s.resolved_at < ? ${scope.sales}
         GROUP BY 1`,
      )
      .all(this.#tenantId, new Date(period.fromMs).toISOString(), new Date(period.toMs).toISOString(), ...scope.params) as unknown as {
      method: MethodAmount['method'];
      amount: number;
    }[];
    const order: readonly MethodAmount['method'][] = ['cash', 'card', 'transfer'];
    return order.map((method) => ({ method, amountCents: rows.find((row) => row.method === method)?.amount ?? 0 }));
  }

  #byCashier(period: ResolvedPeriod, scope: Scope): CashierBucket[] {
    const rows = this.#store
      .prepare(
        `SELECT coalesce(u.name, ?) AS name, count(*) AS count, sum(s.total_cents) AS total
         FROM sale s LEFT JOIN app_user u ON u.id = s.cashier_id
         WHERE s.tenant_id = ? AND s.status = 'completed' AND s.resolved_at >= ? AND s.resolved_at < ? ${scope.sales}
         GROUP BY s.cashier_id ORDER BY name`,
      )
      .all(NO_CASHIER, this.#tenantId, new Date(period.fromMs).toISOString(), new Date(period.toMs).toISOString(), ...scope.params) as unknown as {
      name: string;
      count: number;
      total: number;
    }[];
    return rows.map((row) => ({ name: row.name, salesCount: row.count, totalCents: row.total }));
  }

  /** The products, their stock, and the cost of each: typed by the owner, or else the weighted average of the entries. */
  #catalog(): Catalog {
    const products = this.#store
      .prepare('SELECT id, name, base_unit AS unit, unit_cost_e6 AS typedCostE6, is_active AS isActive FROM product WHERE tenant_id = ?')
      .all(this.#tenantId) as unknown as ProductRow[];
    const stock = new Map(
      (
        this.#store.prepare('SELECT product_id AS productId, sum(quantity_milli) AS total FROM stock_movement WHERE tenant_id = ? GROUP BY product_id').all(this.#tenantId) as unknown as {
          productId: string;
          total: number;
        }[]
      ).map((row) => [row.productId, row.total]),
    );
    // Only the entries with a cost need the stock before them, so the database adds it up for those and not for every sale.
    const entries = this.#store
      .prepare(
        `SELECT e.product_id AS productId, e.quantity_milli AS quantityMilli, e.unit_cost_e6 AS unitCostE6,
                (SELECT coalesce(sum(m.quantity_milli), 0) FROM stock_movement m
                 WHERE m.tenant_id = e.tenant_id AND m.product_id = e.product_id AND m.rowid < e.rowid) AS stockBeforeMilli
         FROM stock_movement e
         WHERE e.tenant_id = ? AND e.unit_cost_e6 IS NOT NULL AND e.quantity_milli > 0
         ORDER BY e.product_id, e.rowid`,
      )
      .all(this.#tenantId) as unknown as (CostedEntry & { productId: string })[];
    const entriesByProduct = new Map<string, CostedEntry[]>();
    for (const entry of entries) {
      const own = entriesByProduct.get(entry.productId) ?? [];
      own.push(entry);
      entriesByProduct.set(entry.productId, own);
    }
    const costs = new Map<string, CostInfo>();
    for (const product of products) {
      if (product.typedCostE6 !== null) {
        costs.set(product.id, { costE6: product.typedCostE6, source: 'typed' });
        continue;
      }
      const average = averageCostE6(entriesByProduct.get(product.id) ?? []);
      if (average !== null) {
        costs.set(product.id, { costE6: average, source: 'average' });
      }
    }
    return { products, costs, stock };
  }
}

function publicRange(period: ResolvedPeriod): PeriodRange {
  return { kind: period.kind, fromDay: period.fromDay, toDay: period.toDay, dayCount: period.dayCount };
}

function trendOf(period: ResolvedPeriod, byDay: ReadonlyMap<string, { salesCount: number; totalCents: number }>, byMonth: boolean): TimeBucket[] {
  if (!byMonth) {
    return daysOf(period).map((key) => ({ key, salesCount: byDay.get(key)?.salesCount ?? 0, totalCents: byDay.get(key)?.totalCents ?? 0 }));
  }
  return monthsOf(period).map((key) => {
    let salesCount = 0;
    let totalCents = 0;
    for (const [day, bucket] of byDay) {
      if (day.startsWith(key)) {
        salesCount += bucket.salesCount;
        totalCents += bucket.totalCents;
      }
    }
    return { key, salesCount, totalCents };
  });
}

/** Cost, profit and margin of the net sale of the products whose cost is known. Misc items and unknown costs stay out. */
function profitOf(
  aggregates: ReadonlyMap<string, ProductAggregate>,
  costs: ReadonlyMap<string, CostInfo>,
): { costOfGoodsCents: number; grossProfitCents: number; marginBp: number | null; productsWithoutCostSold: number } {
  let costOfGoodsCents = 0;
  let costedNetSubtotalCents = 0;
  let productsWithoutCostSold = 0;
  for (const aggregate of aggregates.values()) {
    const cost = costs.get(aggregate.productId);
    if (cost === undefined) {
      if (aggregate.soldMilli > 0 && aggregate.productId !== MISC_PRODUCT_ID) {
        productsWithoutCostSold += 1;
      }
      continue;
    }
    costOfGoodsCents += costInCents(aggregate.soldMilli, cost.costE6) - costInCents(aggregate.returnedMilli, cost.costE6);
    costedNetSubtotalCents += aggregate.soldSubtotalCents - aggregate.returnedSubtotalCents;
  }
  const grossProfitCents = costedNetSubtotalCents - costOfGoodsCents;
  return { costOfGoodsCents, grossProfitCents, marginBp: marginBp(grossProfitCents, costedNetSubtotalCents), productsWithoutCostSold };
}

function marginBp(profitCents: number, baseCents: number): number | null {
  if (baseCents <= 0) {
    return null;
  }
  const magnitude = Number(divideHalfUp(BigInt(Math.abs(profitCents)) * 10_000n, BigInt(baseCents)));
  return profitCents < 0 ? -magnitude : magnitude;
}

/**
 * «Más vendidos»: what sold in the period (returns are shown apart, not subtracted), ordered by the metric, then by
 * quantity, amount and name, so ties always come out in the same order.
 */
function topSellers(
  aggregates: ReadonlyMap<string, ProductAggregate>,
  costs: ReadonlyMap<string, CostInfo> | null,
  metric: TopMetric,
  limit: number,
): TopSeller[] {
  const rows = [...aggregates.values()]
    .filter((aggregate) => aggregate.soldMilli > 0)
    .map((aggregate) => {
      const cost = costs?.get(aggregate.productId);
      return {
        aggregate,
        cost,
        profit: cost === undefined ? null : aggregate.soldSubtotalCents - costInCents(aggregate.soldMilli, cost.costE6),
      };
    });
  const metricOf = ({ aggregate, profit }: (typeof rows)[number]): number =>
    metric === 'quantity' ? aggregate.soldMilli : metric === 'amount' ? aggregate.soldTotalCents : (profit ?? Number.NEGATIVE_INFINITY);
  rows.sort(
    (a, b) =>
      metricOf(b) - metricOf(a) ||
      b.aggregate.soldMilli - a.aggregate.soldMilli ||
      b.aggregate.soldTotalCents - a.aggregate.soldTotalCents ||
      a.aggregate.name.localeCompare(b.aggregate.name, 'es') ||
      a.aggregate.productId.localeCompare(b.aggregate.productId),
  );
  return rows.slice(0, limit).map(({ aggregate, cost, profit }, index) => ({
    rank: index + 1,
    productId: aggregate.productId,
    name: aggregate.name,
    unit: aggregate.unit,
    quantityMilli: aggregate.soldMilli,
    amountCents: aggregate.soldTotalCents,
    profitCents: costs === null ? null : profit,
    costE6: costs === null ? null : (cost?.costE6 ?? null),
    costSource: costs === null ? null : (cost?.source ?? 'none'),
  }));
}

function limited(lines: readonly StockLine[]): LimitedList<StockLine> {
  return { total: lines.length, items: lines.slice(0, LIST_LIMIT) };
}

/** Only for the owner: what the stock is worth, and what needs a look. */
function inventoryOf(catalog: Catalog, aggregates: ReadonlyMap<string, ProductAggregate>): InventorySection {
  let valueCents = 0;
  let stockedWithoutCost = 0;
  const notSelling: StockLine[] = [];
  const outOfStock: StockLine[] = [];
  const runningLow: StockLine[] = [];
  const withoutCost: StockLine[] = [];
  for (const product of catalog.products) {
    const stockMilli = catalog.stock.get(product.id);
    const cost = catalog.costs.get(product.id);
    const sold = aggregates.get(product.id)?.soldMilli ?? 0;
    const lineValue = stockMilli !== undefined && stockMilli > 0 && cost !== undefined ? costInCents(stockMilli, cost.costE6) : null;
    if (stockMilli !== undefined && stockMilli > 0) {
      if (lineValue === null) {
        stockedWithoutCost += 1;
      } else {
        valueCents += lineValue;
      }
    }
    if (product.isActive === 0) {
      continue;
    }
    const line: StockLine = { productId: product.id, name: product.name, unit: product.unit, stockMilli: stockMilli ?? 0, valueCents: lineValue };
    if (stockMilli !== undefined && stockMilli <= 0) {
      outOfStock.push(line);
    }
    if (stockMilli !== undefined && stockMilli > 0) {
      if (sold === 0) {
        notSelling.push(line);
      } else if (sold >= stockMilli) {
        runningLow.push(line);
      }
    }
    if (cost === undefined && ((stockMilli ?? 0) > 0 || sold > 0)) {
      withoutCost.push(line);
    }
  }
  const byName = (a: StockLine, b: StockLine): number => a.name.localeCompare(b.name, 'es') || a.productId.localeCompare(b.productId);
  notSelling.sort((a, b) => (b.valueCents ?? -1) - (a.valueCents ?? -1) || byName(a, b));
  outOfStock.sort(byName);
  runningLow.sort((a, b) => a.stockMilli - b.stockMilli || byName(a, b));
  withoutCost.sort(byName);
  return {
    valueCents,
    stockedWithoutCost,
    notSelling: limited(notSelling),
    outOfStock: limited(outOfStock),
    runningLow: limited(runningLow),
    withoutCost: limited(withoutCost),
  };
}
