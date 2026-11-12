import { lineTotals, quantityOf, saleTotals, taxRateOf, type Unit } from '@pos-saas/money';

import { MISC_PRODUCT_ID } from '../../shared/miscellaneous';
import type { LocalStore } from '../local-store/local-store';
import { uuidV7 } from '../uuid-v7';

/** What a test sells: a product, how much of it, and optionally another price than the catalog's. */
export interface SoldLine {
  readonly productId: string;
  readonly milli: number;
  readonly priceE4?: number;
}

/** A sale to write straight into the database at a chosen moment, which the register itself would never allow. */
export interface SeededSale {
  /** The moment it was paid, in ISO 8601 UTC. */
  readonly at: string;
  readonly lines: readonly SoldLine[];
  readonly cashierId?: string;
  readonly sessionId?: string;
  /** The means of payment. The first parts get an even share and the last one the rest. Cash by default. */
  readonly pay?: readonly ('cash' | 'card' | 'transfer' | 'card_manual')[];
}

export interface SeededSaleResult {
  readonly saleId: string;
  readonly lineIds: readonly string[];
  readonly subtotalCents: number;
  readonly taxCents: number;
  readonly totalCents: number;
}

/**
 * Writes sales, returns and stock into a local database with the same triggers as the register, but at any moment in time,
 * so a test can seed a year of history and a sale at midnight. Only tests use it.
 */
export class DashboardFixture {
  readonly #store: LocalStore;
  readonly #tenantId: string;
  #folio = 0;
  #sessionId: string | null = null;

  /**
   * @param store the open local database
   * @param tenantId the business
   */
  constructor(store: LocalStore, tenantId: string) {
    this.#store = store;
    this.#tenantId = tenantId;
  }

  /**
   * Adds a product with 16% VAT included in its price.
   *
   * @param name its name
   * @param unit its unit
   * @param options its price with VAT in ten-thousandths of a peso, the cost typed by the owner, and whether it is active
   * @returns its id
   */
  product(name: string, unit: Unit = 'piece', options: { priceE4?: number; costE6?: number; isActive?: boolean } = {}): string {
    const id = uuidV7();
    this.#store
      .prepare('INSERT INTO product (id, tenant_id, name, base_unit, unit_price_e4, tax_factor, tax_rate_bp, unit_cost_e6, is_active) VALUES (?, ?, ?, ?, ?, ?, 1600, ?, ?)')
      .run(id, this.#tenantId, name, unit, options.priceE4 ?? 1_160_000, 'rate', options.costE6 ?? null, options.isActive === false ? 0 : 1);
    return id;
  }

  /**
   * Posts a movement of the ledger.
   *
   * @param productId the product
   * @param milli the signed quantity
   * @param unitCostE6 the cost per unit, when the entry has one
   * @param type the kind of movement
   */
  stock(productId: string, milli: number, unitCostE6?: number, type: 'opening_balance' | 'adjustment' | 'waste' = 'opening_balance'): void {
    this.#store
      .prepare('INSERT INTO stock_movement (id, tenant_id, product_id, type, quantity_milli, unit_cost_e6, source, source_id, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(uuidV7(), this.#tenantId, productId, type, milli, unitCostE6 ?? null, 'fixture', uuidV7(), new Date().toISOString());
  }

  /**
   * Opens a cash session, if one is not open.
   *
   * @param openedAt when it opened
   * @returns its id
   */
  openSession(openedAt = '2020-01-01T00:00:00.000Z'): string {
    if (this.#sessionId === null) {
      this.#sessionId = this.session(openedAt, null);
    }
    return this.#sessionId;
  }

  /**
   * Writes a cash session.
   *
   * @param openedAt when it opened
   * @param closedAt when it closed, or null to leave it open
   * @returns its id
   */
  session(openedAt: string, closedAt: string | null): string {
    const id = uuidV7();
    this.#store
      .prepare('INSERT INTO cash_session (id, tenant_id, opened_by, opened_at, opening_float_cents, closed_by, closed_at) VALUES (?, ?, ?, ?, 0, ?, ?)')
      .run(id, this.#tenantId, 'fixture', openedAt, closedAt === null ? null : 'fixture', closedAt);
    return id;
  }

  /**
   * Closes a cash session.
   *
   * @param sessionId the session
   * @param closedAt when it closed
   */
  closeSession(sessionId: string, closedAt: string): void {
    this.#store.prepare("UPDATE cash_session SET closed_by = 'fixture', closed_at = ? WHERE id = ?").run(closedAt, sessionId);
    if (this.#sessionId === sessionId) {
      this.#sessionId = null;
    }
  }

  /**
   * Writes a completed sale with its lines, its payments and the stock it takes out.
   *
   * @param sale what was sold, when, and how it was paid
   * @returns the sale and its lines
   */
  sale(sale: SeededSale): SeededSaleResult {
    const prepared = this.#prepare(sale);
    const sessionId = sale.sessionId ?? this.openSession();
    this.#insert(prepared, sale, sessionId, 'pending_payment');
    this.#store.transaction((connection) => {
      this.#folio += 1;
      connection.prepare("UPDATE sale SET status = 'completed', resolved_at = ?, folio = ? WHERE id = ?").run(sale.at, this.#folio, prepared.saleId);
      for (const [index, line] of sale.lines.entries()) {
        if (line.productId === MISC_PRODUCT_ID) {
          continue;
        }
        connection
          .prepare('INSERT INTO stock_movement (id, tenant_id, product_id, type, quantity_milli, source, source_id, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(uuidV7(), this.#tenantId, line.productId, 'sale', -line.milli, 'sale_line', prepared.lineIds[index]!, sale.at);
      }
    });
    return prepared;
  }

  /**
   * Writes a sale that was cancelled before it was paid.
   *
   * @param sale what was on it and when it was cancelled
   * @returns the sale
   */
  cancelledSale(sale: Omit<SeededSale, 'pay'>): SeededSaleResult {
    const prepared = this.#prepare(sale);
    this.#insert(prepared, sale, sale.sessionId ?? this.openSession(), 'pending_payment', false);
    this.#store.prepare("UPDATE sale SET status = 'cancelled', resolved_at = ? WHERE id = ?").run(sale.at, prepared.saleId);
    return prepared;
  }

  /**
   * Writes a sale that is still open: nobody has paid it.
   *
   * @param sale what is on it
   * @returns the sale
   */
  openSale(sale: Omit<SeededSale, 'pay'>): SeededSaleResult {
    const prepared = this.#prepare(sale);
    this.#insert(prepared, sale, sale.sessionId ?? this.openSession(), 'pending_payment', false);
    return prepared;
  }

  /**
   * Writes a return of part of one line of a sale, and the stock that comes back.
   *
   * @param sale the sale that came from `sale`
   * @param lineIndex which of its lines
   * @param milli how much comes back
   * @param at when it was returned
   * @param refundCents what was given back, with VAT
   */
  saleReturn(sale: SeededSaleResult, lineIndex: number, milli: number, at: string, refundCents: number): void {
    const returnId = uuidV7();
    const line = this.#store.prepare('SELECT product_id AS productId FROM sale_line WHERE id = ?').get(sale.lineIds[lineIndex]!) as unknown as { productId: string };
    this.#store.transaction((connection) => {
      connection
        .prepare('INSERT INTO sale_return (id, tenant_id, sale_id, cash_session_id, requested_by, authorized_by, reason, total_cents, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(returnId, this.#tenantId, sale.saleId, this.openSession(), 'fixture', 'fixture', 'test', refundCents, at);
      connection
        .prepare('INSERT INTO sale_return_line (id, tenant_id, return_id, sale_line_id, quantity_milli, refund_cents) VALUES (?, ?, ?, ?, ?, ?)')
        .run(uuidV7(), this.#tenantId, returnId, sale.lineIds[lineIndex]!, milli, refundCents);
      connection
        .prepare('INSERT INTO stock_movement (id, tenant_id, product_id, type, quantity_milli, source, source_id, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(uuidV7(), this.#tenantId, line.productId, 'return', milli, 'return_line', returnId, at);
    });
  }

  /** A miscellaneous item is not in the catalog, so it has a name and a price of its own. */
  #productOf(productId: string): { name: string; unit: Unit; price: number } {
    if (productId === MISC_PRODUCT_ID) {
      return { name: 'Llave inglesa', unit: 'piece', price: 1_160_000 };
    }
    return this.#store.prepare('SELECT name, base_unit AS unit, unit_price_e4 AS price FROM product WHERE id = ?').get(productId) as unknown as {
      name: string;
      unit: Unit;
      price: number;
    };
  }

  #prepare(sale: Omit<SeededSale, 'pay'>): SeededSaleResult {
    const rate = taxRateOf('rate', 1600);
    const totals = sale.lines.map((line) => {
      const product = this.#productOf(line.productId);
      return lineTotals(line.priceE4 ?? product.price, quantityOf(line.milli, product.unit), rate);
    });
    const total = saleTotals(totals);
    return {
      saleId: uuidV7(),
      lineIds: sale.lines.map(() => uuidV7()),
      subtotalCents: total.subtotalCents,
      taxCents: total.taxCents,
      totalCents: total.totalCents,
    };
  }

  #insert(prepared: SeededSaleResult, sale: Omit<SeededSale, 'pay'> & { pay?: SeededSale['pay'] }, sessionId: string, status: string, withPayments = true): void {
    this.#store.transaction((connection) => {
      connection
        .prepare('INSERT INTO sale (id, tenant_id, idempotency_key, status, subtotal_cents, tax_cents, total_cents, occurred_at, cash_session_id, cashier_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(prepared.saleId, this.#tenantId, uuidV7(), status, prepared.subtotalCents, prepared.taxCents, prepared.totalCents, sale.at, sessionId, sale.cashierId ?? 'fixture-cashier');
      for (const [index, line] of sale.lines.entries()) {
        const product = this.#productOf(line.productId);
        const price = line.priceE4 ?? product.price;
        const totals = lineTotals(price, quantityOf(line.milli, product.unit), taxRateOf('rate', 1600));
        connection
          .prepare(
            'INSERT INTO sale_line (id, tenant_id, sale_id, line_number, product_id, product_name, unit, quantity_milli, unit_price_e4, tax_factor, tax_rate_bp, subtotal_cents, tax_cents, line_total_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .run(prepared.lineIds[index]!, this.#tenantId, prepared.saleId, index + 1, line.productId, product.name, product.unit, line.milli, price, 'rate', 1600, totals.subtotalCents, totals.taxCents, totals.totalCents);
      }
      if (!withPayments) {
        return;
      }
      const methods = sale.pay ?? ['cash'];
      let remaining = prepared.totalCents;
      for (const [index, method] of methods.entries()) {
        const amount = index === methods.length - 1 ? remaining : Math.floor(prepared.totalCents / methods.length);
        remaining -= amount;
        connection
          .prepare('INSERT INTO payment (id, tenant_id, sale_id, method, amount_cents, reference, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .run(uuidV7(), this.#tenantId, prepared.saleId, method, amount, method === 'cash' ? null : 'REF-1', sale.at);
      }
    });
  }
}
