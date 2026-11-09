/** Sales of one hour of the day, in the time zone of the register. */
export interface HourSales {
  /** 0 to 23. */
  readonly hour: number;
  readonly salesCount: number;
  readonly totalCents: number;
}

/** Sales of one cashier. */
export interface CashierSales {
  readonly name: string;
  readonly salesCount: number;
  readonly totalCents: number;
}

/** A product whose stock needs a look. */
export interface StockAlert {
  readonly productId: string;
  readonly name: string;
  readonly unit: 'piece' | 'meter' | 'kilogram' | 'liter';
  readonly stockMilli: number;
}

/** What the owner reads at the end of the day (RF-049). */
export interface DailyReport {
  /** The day as `YYYY-MM-DD`. */
  readonly date: string;
  readonly salesCount: number;
  readonly totalCents: number;
  /** The total divided by the sales, rounded to the cent. Zero when there were no sales. */
  readonly averageTicketCents: number;
  readonly returnsCount: number;
  readonly returnsCents: number;
  /** Only the hours that had sales, from the earliest. */
  readonly byHour: readonly HourSales[];
  readonly byCashier: readonly CashierSales[];
  /** Sales before tax minus what the goods cost, counting only the lines whose cost is known. */
  readonly marginCents: number;
  /** Lines sold without a known cost, so the margin does not include them. */
  readonly linesWithoutCost: number;
  /** Products with a ledger whose stock is zero or below, at most 20. */
  readonly outOfStock: readonly StockAlert[];
  /** Products with stock that sold nothing in the last 30 days up to this day, at most 20. */
  readonly notSelling: readonly StockAlert[];
}
