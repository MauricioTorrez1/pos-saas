import type { CashierSales, DailyReport, HourSales, StockAlert } from '../../shared/report-api';
import type { AuthService } from '../auth/auth-service';
import type { LocalStore } from '../local-store/local-store';

const DAY_TEXT = /^(\d{4})-(\d{2})-(\d{2})$/;
const NOT_SELLING_DAYS = 30;
const ALERT_LIMIT = 20;
const NO_CASHIER = 'Sin cajero';
/** Quantity is in thousandths and cost in millionths of a peso, so a cent is 10 million of both together. */
const COST_DIVISOR = 10_000_000n;

interface SaleRow {
  readonly total_cents: number;
  readonly resolved_at: string;
  readonly name: string | null;
}

interface LineRow {
  readonly product_id: string;
  readonly quantity_milli: number;
  readonly subtotal_cents: number;
}

interface CostRow {
  readonly product_id: string;
  readonly unit_cost_e6: number;
}

interface ReturnsRow {
  readonly count: number;
  readonly total: number;
}

interface AlertRow {
  readonly id: string;
  readonly name: string;
  readonly unit: StockAlert['unit'];
  readonly stock: number;
}

/**
 * What the owner reads at the end of the day. It only reads: nothing here changes a sale, a return or the stock, so a
 * wrong report can mislead but cannot damage the books (ADR 0032).
 */
export class ReportService {
  readonly #store: LocalStore;
  readonly #tenantId: string;
  readonly #auth: AuthService;

  /**
   * @param store the open local database
   * @param tenantId the business
   * @param auth who is signed in
   */
  constructor(store: LocalStore, tenantId: string, auth: AuthService) {
    this.#store = store;
    this.#tenantId = tenantId;
    this.#auth = auth;
  }

  /**
   * Builds the report of one day, in the time zone of the register.
   *
   * @param date the day as `YYYY-MM-DD`
   * @returns the report
   * @throws Error if the person signed in is not the owner
   * @throws RangeError if the text is not a real day
   */
  daily(date: string): DailyReport {
    if (this.#auth.currentUser()?.role !== 'owner') {
      throw new Error('Only the owner can read the reports');
    }
    const { start, end, notSellingStart } = dayRange(date);
    const sales = this.#sales(start, end);
    const totalCents = sales.reduce((sum, sale) => sum + sale.total_cents, 0);
    const returns = this.#returns(start, end);
    const margin = this.#margin(start, end);

    return {
      date,
      salesCount: sales.length,
      totalCents,
      averageTicketCents: sales.length === 0 ? 0 : Math.round(totalCents / sales.length),
      returnsCount: returns.count,
      returnsCents: returns.total,
      byHour: byHour(sales),
      byCashier: byCashier(sales),
      marginCents: margin.marginCents,
      linesWithoutCost: margin.linesWithoutCost,
      outOfStock: this.#alerts('level.total <= 0', [], 'ORDER BY product.name'),
      notSelling: this.#alerts(
        `level.total > 0 AND NOT EXISTS (
           SELECT 1 FROM sale_line JOIN sale ON sale.id = sale_line.sale_id
           WHERE sale_line.product_id = product.id AND sale.status = 'completed' AND sale.resolved_at >= ? AND sale.resolved_at < ?
         )`,
        [notSellingStart, end],
        'ORDER BY product.name',
      ),
    };
  }

  #sales(start: string, end: string): SaleRow[] {
    return this.#store
      .prepare(
        `SELECT sale.total_cents, sale.resolved_at, app_user.name
         FROM sale LEFT JOIN app_user ON app_user.id = sale.cashier_id
         WHERE sale.tenant_id = ? AND sale.status = 'completed' AND sale.resolved_at >= ? AND sale.resolved_at < ?`,
      )
      .all(this.#tenantId, start, end) as unknown as SaleRow[];
  }

  #returns(start: string, end: string): { count: number; total: number } {
    const row = this.#store
      .prepare('SELECT count(*) AS count, coalesce(sum(total_cents), 0) AS total FROM sale_return WHERE tenant_id = ? AND occurred_at >= ? AND occurred_at < ?')
      .get(this.#tenantId, start, end) as unknown as ReturnsRow;
    return { count: row.count, total: row.total };
  }

  /** The margin is what was sold before tax minus what it cost at the last known cost of each product. */
  #margin(start: string, end: string): { marginCents: number; linesWithoutCost: number } {
    const lines = this.#store
      .prepare(
        `SELECT sale_line.product_id, sale_line.quantity_milli, sale_line.subtotal_cents
         FROM sale_line JOIN sale ON sale.id = sale_line.sale_id
         WHERE sale.tenant_id = ? AND sale.status = 'completed' AND sale.resolved_at >= ? AND sale.resolved_at < ?`,
      )
      .all(this.#tenantId, start, end) as unknown as LineRow[];
    const costs = new Map(
      (
        this.#store
          .prepare(
            `SELECT product_id, unit_cost_e6 FROM stock_movement
             WHERE rowid IN (SELECT max(rowid) FROM stock_movement WHERE tenant_id = ? AND unit_cost_e6 IS NOT NULL GROUP BY product_id)`,
          )
          .all(this.#tenantId) as unknown as CostRow[]
      ).map((row) => [row.product_id, row.unit_cost_e6]),
    );
    let marginCents = 0;
    let linesWithoutCost = 0;
    for (const line of lines) {
      const unitCost = costs.get(line.product_id);
      if (unitCost === undefined) {
        linesWithoutCost += 1;
        continue;
      }
      const costCents = Number((BigInt(line.quantity_milli) * BigInt(unitCost) + COST_DIVISOR / 2n) / COST_DIVISOR);
      marginCents += line.subtotal_cents - costCents;
    }
    return { marginCents, linesWithoutCost };
  }

  #alerts(condition: string, parameters: readonly string[], order: string): StockAlert[] {
    const rows = this.#store
      .prepare(
        `SELECT product.id, product.name, product.base_unit AS unit, level.total AS stock
         FROM product
         JOIN (SELECT product_id, sum(quantity_milli) AS total FROM stock_movement WHERE tenant_id = ? GROUP BY product_id) AS level
           ON level.product_id = product.id
         WHERE product.tenant_id = ? AND ${condition}
         ${order}
         LIMIT ${ALERT_LIMIT}`,
      )
      .all(this.#tenantId, this.#tenantId, ...parameters) as unknown as AlertRow[];
    return rows.map((row) => ({ productId: row.id, name: row.name, unit: row.unit, stockMilli: row.stock }));
  }
}

/** The moments, in UTC ISO text, where the local day starts and ends, and where the window of 30 days before it starts. */
function dayRange(date: string): { start: string; end: string; notSellingStart: string } {
  const match = DAY_TEXT.exec(date);
  if (match === null) {
    throw new RangeError('Expected a day as YYYY-MM-DD');
  }
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const start = new Date(year, month - 1, day);
  if (start.getFullYear() !== year || start.getMonth() !== month - 1 || start.getDate() !== day) {
    throw new RangeError('That day does not exist');
  }
  return {
    start: start.toISOString(),
    end: new Date(year, month - 1, day + 1).toISOString(),
    notSellingStart: new Date(year, month - 1, day - NOT_SELLING_DAYS).toISOString(),
  };
}

function byHour(sales: readonly SaleRow[]): HourSales[] {
  const hours = new Map<number, { salesCount: number; totalCents: number }>();
  for (const sale of sales) {
    const hour = new Date(sale.resolved_at).getHours();
    const row = hours.get(hour) ?? { salesCount: 0, totalCents: 0 };
    hours.set(hour, { salesCount: row.salesCount + 1, totalCents: row.totalCents + sale.total_cents });
  }
  return [...hours.entries()].sort(([a], [b]) => a - b).map(([hour, row]) => ({ hour, ...row }));
}

function byCashier(sales: readonly SaleRow[]): CashierSales[] {
  const cashiers = new Map<string, { salesCount: number; totalCents: number }>();
  for (const sale of sales) {
    const name = sale.name ?? NO_CASHIER;
    const row = cashiers.get(name) ?? { salesCount: 0, totalCents: 0 };
    cashiers.set(name, { salesCount: row.salesCount + 1, totalCents: row.totalCents + sale.total_cents });
  }
  return [...cashiers.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, row]) => ({ name, ...row }));
}
