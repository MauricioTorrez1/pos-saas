import type { Unit } from '@pos-saas/money';

/** The time zone every day, week, month and year of the dashboard is counted in (ADR 0060). */
export const DASHBOARD_TIME_ZONE = 'America/Mexico_City';

/** The ways to choose the stretch of time to look at. A week goes from Monday to Sunday. */
export const PERIOD_KINDS = ['day', 'week', 'month', 'year', 'custom'] as const;
export type PeriodKind = (typeof PERIOD_KINDS)[number];

/** What «Más vendidos» is ordered by. */
export const TOP_METRICS = ['quantity', 'amount', 'profit'] as const;
export type TopMetric = (typeof TOP_METRICS)[number];

/** How many products «Más vendidos» lists. */
export const TOP_LIMITS = [10, 20, 50] as const;
export type TopLimit = (typeof TOP_LIMITS)[number];

/** The files the summary can be saved as. */
export const EXPORT_FORMATS = ['xlsx', 'pdf'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** The longest custom range the dashboard answers, in days. */
export const MAX_CUSTOM_DAYS = 1_830;

/** What the screen asks for. */
export interface DashboardRequest {
  readonly period: PeriodKind;
  /** A day of the period as `YYYY-MM-DD`; for a custom range, the first day. */
  readonly date: string;
  /** For a custom range only: the last day, included. */
  readonly endDate?: string;
  readonly topMetric: TopMetric;
  readonly topLimit: TopLimit;
  /** The PIN of an owner, when a cashier asks for the whole summary (ADR 0047). */
  readonly ownerPin?: string;
}

/** A stretch of whole days in the time zone of the register. */
export interface PeriodRange {
  readonly kind: PeriodKind | 'shift';
  /** First day as `YYYY-MM-DD`. */
  readonly fromDay: string;
  /** Last day, included. */
  readonly toDay: string;
  readonly dayCount: number;
}

/** The headline numbers of one period. Money is in cents; the costs and the profit are null where nobody may see them. */
export interface PeriodTotals {
  readonly salesCount: number;
  /** What was charged, with VAT. */
  readonly totalCents: number;
  /** What was sold before VAT. */
  readonly subtotalCents: number;
  readonly taxCents: number;
  /** Lines (partidas) of the completed sales. */
  readonly lineCount: number;
  /** The total divided by the sales, rounded half up to the cent. */
  readonly averageTicketCents: number;
  /** Lines per ticket times 100, rounded half up: 250 reads "2.50". */
  readonly linesPerTicketX100: number;
  readonly returnsCount: number;
  readonly returnsCents: number;
  /** Sales minus returns, with VAT. */
  readonly netCents: number;
  /** Sales minus returns, before VAT. */
  readonly netSubtotalCents: number;
  /** What the net units cost, only for the products whose cost is known. */
  readonly costOfGoodsCents: number | null;
  /** The net sale before VAT of the products with a known cost, minus their cost. */
  readonly grossProfitCents: number | null;
  /** The profit over the net sale of the products with a known cost, in basis points, or null if there is none. */
  readonly marginBp: number | null;
  /** Products that sold in the period without a known cost, so they are not in the profit. */
  readonly productsWithoutCostSold: number;
}

/** How the sales were paid. A sale paid with two ways counts as `mixed`. */
export type PaymentKind = 'cash' | 'card' | 'transfer' | 'mixed';

export interface PaymentKindSales {
  readonly kind: PaymentKind;
  readonly salesCount: number;
  readonly totalCents: number;
}

/** Money that came in by one means, whatever the sale it was part of. */
export interface MethodAmount {
  readonly method: Exclude<PaymentKind, 'mixed'>;
  readonly amountCents: number;
}

export interface TimeBucket {
  /** `YYYY-MM-DD` for a day, `YYYY-MM` for a month. */
  readonly key: string;
  readonly salesCount: number;
  readonly totalCents: number;
}

export interface HourBucket {
  /** 0 to 23, in the time zone of the register. */
  readonly hour: number;
  readonly salesCount: number;
  readonly totalCents: number;
}

export interface WeekdayBucket {
  /** 0 is Monday and 6 is Sunday. */
  readonly weekday: number;
  readonly salesCount: number;
  readonly totalCents: number;
}

export interface CashierBucket {
  readonly name: string;
  readonly salesCount: number;
  readonly totalCents: number;
}

/** Where a product's cost came from. `none` means nobody knows it, and the product is flagged instead of guessed. */
export type CostSource = 'typed' | 'average' | 'none';

/** One row of «Más vendidos». */
export interface TopSeller {
  readonly rank: number;
  readonly productId: string;
  readonly name: string;
  readonly unit: Unit;
  /** Sold in the period, in thousandths of the unit. */
  readonly quantityMilli: number;
  /** Charged with VAT. */
  readonly amountCents: number;
  /** Before VAT minus cost; null without a cost or for a cashier. */
  readonly profitCents: number | null;
  /** Cost per unit in millionths of a peso; null without a cost or for a cashier. */
  readonly costE6: number | null;
  readonly costSource: CostSource | null;
}

/** A product of the inventory lists. */
export interface StockLine {
  readonly productId: string;
  readonly name: string;
  readonly unit: Unit;
  readonly stockMilli: number;
  /** What the stock cost, or null when the cost is unknown. */
  readonly valueCents: number | null;
}

/** A list that is cut at a limit, with how many there really are. */
export interface LimitedList<Item> {
  readonly total: number;
  readonly items: readonly Item[];
}

/** What only the owner sees about the stock. */
export interface InventorySection {
  /** Stock that is above zero at its cost, product by product rounded. */
  readonly valueCents: number;
  /** Products with stock whose cost is unknown, so their stock is not in the value. */
  readonly stockedWithoutCost: number;
  /** Active products with stock that did not sell in the period. */
  readonly notSelling: LimitedList<StockLine>;
  /** Active products with a stock at or below zero. */
  readonly outOfStock: LimitedList<StockLine>;
  /** Active products whose stock is at most what sold in the period: at that pace they run out in the next one. */
  readonly runningLow: LimitedList<StockLine>;
  /** Active products with stock or sales and no cost. */
  readonly withoutCost: LimitedList<StockLine>;
}

/** Everything the dashboard shows. */
export interface DashboardSummary {
  /** `business` for an owner, `shift` for a cashier without the PIN of an owner. */
  readonly scope: 'business' | 'shift';
  /** False for a cashier: the costs, the profit and the inventory value are not even sent. */
  readonly includesCosts: boolean;
  readonly generatedAt: string;
  readonly period: PeriodRange;
  /** The period right before, with the same length. Null for a shift. */
  readonly previousPeriod: PeriodRange | null;
  /** The period has not ended yet, so comparing it with a whole one is not fair. */
  readonly isInProgress: boolean;
  readonly totals: PeriodTotals;
  readonly previousTotals: PeriodTotals | null;
  readonly cancellations: { readonly count: number; readonly totalCents: number };
  readonly paymentKinds: readonly PaymentKindSales[];
  readonly methodAmounts: readonly MethodAmount[];
  readonly trendUnit: 'day' | 'month';
  readonly trend: readonly TimeBucket[];
  /** The 24 hours, the ones without sales with zeros. */
  readonly byHour: readonly HourBucket[];
  /** Monday to Sunday. */
  readonly byWeekday: readonly WeekdayBucket[];
  /** Only for the owner. */
  readonly byCashier: readonly CashierBucket[] | null;
  readonly topMetric: TopMetric;
  readonly topLimit: TopLimit;
  readonly topSellers: readonly TopSeller[];
  /** Only for the owner. */
  readonly inventory: InventorySection | null;
}

/** Why the whole summary was not given to a cashier. */
export type DashboardRefusal =
  | { readonly status: 'wrong_pin'; readonly attemptsLeft: number }
  | { readonly status: 'locked'; readonly until: string };

export type DashboardResult = { readonly status: 'ok'; readonly summary: DashboardSummary } | DashboardRefusal;

export type ExportResult =
  | { readonly status: 'saved'; readonly path: string }
  | { readonly status: 'cancelled' }
  | { readonly status: 'failed'; readonly message: string }
  | DashboardRefusal;

/** The IPC channels of the dashboard. */
export const DASHBOARD_CHANNELS = {
  getDashboard: 'dashboard:get',
  exportDashboard: 'dashboard:export',
} as const;

/** What the screen can ask of the dashboard. */
export interface DashboardApi {
  /**
   * Reads the summary of a period. The owner gets everything; a cashier gets only the sales of their shift, without costs,
   * unless the request carries the PIN of an owner.
   *
   * @param request the period, the order of «Más vendidos» and, for a cashier, the PIN of an owner
   * @returns the summary, or why it was not given
   */
  getDashboard(request: DashboardRequest): Promise<DashboardResult>;

  /**
   * Saves the summary and «Más vendidos» as an Excel file or as a PDF, asking where.
   *
   * @param request the same request the screen made to read it
   * @param format `xlsx` or `pdf`
   * @returns where it was saved, or why not
   */
  exportDashboard(request: DashboardRequest, format: ExportFormat): Promise<ExportResult>;
}
