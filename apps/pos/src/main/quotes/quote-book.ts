import type { StatementSync } from 'node:sqlite';

import { lineTotals, MoneyError, quantityOf, saleTotals, type TaxRate, type Unit } from '@pos-saas/money';

import type { UserSummary } from '../../shared/auth';
import type { CatalogProduct } from '../../shared/pos-api';
import {
  addDays,
  formatQuoteFolio,
  isQuoteExpired,
  localDay,
  MAX_QUOTE_CANCEL_REASON,
  MAX_QUOTE_CUSTOMER_NAME,
  MAX_QUOTE_CUSTOMER_PHONE,
  MAX_QUOTE_LINES,
  MAX_QUOTE_NOTES,
  MAX_QUOTE_VALIDITY_DAYS,
  MAX_QUOTES_LISTED,
  parseQuoteFolio,
  type CancelQuoteRequest,
  type CancelQuoteResult,
  type ConversionLine,
  type MarkConvertedRequest,
  type MarkConvertedResult,
  type PrepareConversionResult,
  type Quote,
  type QuoteDisplayStatus,
  type QuoteEvent,
  type QuoteLine,
  type QuoteSearch,
  type QuoteStatus,
  type QuoteSummary,
  type SaveQuoteRequest,
  type SaveQuoteResult,
} from '../../shared/quotes';
import type { AuditLog } from '../audit/audit-log';
import type { OwnerAuthorization } from '../auth/auth-service';
import { formatFolio } from '../checkout/ticket/ticket';
import type { LocalStore } from '../local-store/local-store';
import { uuidV7 } from '../uuid-v7';

const MILLI_PER_UNIT = 1000;
/** A billion thousandths: far more than anyone quotes, and far below what the money package can multiply. */
const MAX_QUANTITY_MILLI = 1_000_000_000;
/** The list reads this many recent quotes and narrows them with the search, which is plenty for one store. */
const SEARCH_WINDOW = 2000;
const UNKNOWN_PERSON = 'Alguien';
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

interface QuoteRow {
  readonly id: string;
  readonly folio: number;
  readonly customer_name: string | null;
  readonly customer_phone: string | null;
  readonly notes: string | null;
  readonly valid_until: string;
  readonly created_by: string;
  readonly created_by_name: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly status: QuoteStatus;
  readonly sale_id: string | null;
  readonly times_printed: number;
}

interface LineRow {
  readonly product_id: string;
  readonly product_name: string;
  readonly unit: Unit;
  readonly quantity_milli: number;
  readonly unit_price_e4: number;
  readonly tax_factor: TaxRate['factor'];
  readonly tax_rate_bp: number;
  readonly total_cents: number;
}

interface EventRow {
  readonly status: QuoteStatus;
  readonly recorded_at: string;
  readonly by_name: string | null;
  readonly note: string | null;
}

interface SummaryRow {
  readonly id: string;
  readonly folio: number;
  readonly customer_name: string | null;
  readonly customer_phone: string | null;
  readonly created_at: string;
  readonly valid_until: string;
  readonly status: QuoteStatus;
  readonly line_count: number;
  readonly total_cents: number;
  readonly product_names: string | null;
}

/** A line ready to be written, with the price it is quoted at. */
interface PricedLine {
  readonly product: CatalogProduct;
  readonly quantityMilli: number;
  readonly unitPriceE4: number;
  readonly taxRate: TaxRate;
  readonly totalCents: number;
}

/** What the quotes need from the rest of the register. */
export interface QuoteBookDependencies {
  readonly catalog: { findById(id: string): CatalogProduct | null };
  readonly audit: Pick<AuditLog, 'record'>;
  /** Checks the PIN of an owner, for a cashier who cancels a quote somebody else made. */
  readonly authorizeOwnerPin: (pin: string) => OwnerAuthorization;
  /** The clock, which tests replace. */
  readonly now?: () => Date;
}

/** The latest step of the history of a quote is what it is now. */
const LATEST_STATUS = `(SELECT status FROM quote_status s WHERE s.quote_id = q.id ORDER BY s.sequence DESC LIMIT 1)`;

/**
 * Keeps the quotes of the store (F2-07, ADR 0077). A quote copies the name and price of each product when it is made, so
 * a later change in the catalog does not change what the customer was told. It never touches stock, sales or cash: it
 * becomes a sale only when the register collects one from it, and then its history says which.
 */
export class QuoteBook {
  readonly #store: LocalStore;
  readonly #tenantId: string;
  readonly #catalog: QuoteBookDependencies['catalog'];
  readonly #audit: Pick<AuditLog, 'record'>;
  readonly #authorizeOwnerPin: (pin: string) => OwnerAuthorization;
  readonly #now: () => Date;
  readonly #findByKey: StatementSync;
  readonly #nextFolio: StatementSync;
  readonly #insertQuote: StatementSync;
  readonly #updateQuote: StatementSync;
  readonly #deleteLines: StatementSync;
  readonly #insertLine: StatementSync;
  readonly #nextSequence: StatementSync;
  readonly #insertStatus: StatementSync;
  readonly #insertPrint: StatementSync;
  readonly #quote: StatementSync;
  readonly #lines: StatementSync;
  readonly #history: StatementSync;
  readonly #summaries: StatementSync;
  readonly #sale: StatementSync;
  readonly #saleTaken: StatementSync;

  /**
   * @param store the open local store
   * @param tenantId the business whose quotes these are
   * @param dependencies the catalog, the audit log, the PIN of the owner and the clock
   */
  constructor(store: LocalStore, tenantId: string, { catalog, audit, authorizeOwnerPin, now = () => new Date() }: QuoteBookDependencies) {
    this.#store = store;
    this.#tenantId = tenantId;
    this.#catalog = catalog;
    this.#audit = audit;
    this.#authorizeOwnerPin = authorizeOwnerPin;
    this.#now = now;
    this.#findByKey = store.prepare('SELECT id FROM quote WHERE tenant_id = ? AND idempotency_key = ?');
    this.#nextFolio = store.prepare('SELECT coalesce(max(folio), 0) + 1 AS next FROM quote WHERE tenant_id = ?');
    this.#insertQuote = store.prepare(`
      INSERT INTO quote (id, tenant_id, folio, idempotency_key, customer_name, customer_phone, notes, valid_until, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.#updateQuote = store.prepare(`
      UPDATE quote SET customer_name = ?, customer_phone = ?, notes = ?, valid_until = ?, updated_at = ? WHERE tenant_id = ? AND id = ?
    `);
    this.#deleteLines = store.prepare('DELETE FROM quote_line WHERE tenant_id = ? AND quote_id = ?');
    this.#insertLine = store.prepare(`
      INSERT INTO quote_line (id, tenant_id, quote_id, line_number, product_id, product_name, unit, quantity_milli, unit_price_e4, tax_factor, tax_rate_bp, total_cents)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.#nextSequence = store.prepare('SELECT coalesce(max(sequence), 0) + 1 AS next FROM quote_status WHERE quote_id = ?');
    this.#insertStatus = store.prepare(`
      INSERT INTO quote_status (id, tenant_id, quote_id, sequence, status, sale_id, note, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.#insertPrint = store.prepare('INSERT INTO quote_print (id, tenant_id, quote_id, printed_by, printed_at) VALUES (?, ?, ?, ?, ?)');
    this.#quote = store.prepare(`
      SELECT q.id, q.folio, q.customer_name, q.customer_phone, q.notes, q.valid_until, q.created_by, u.name AS created_by_name,
        q.created_at, q.updated_at, ${LATEST_STATUS} AS status,
        (SELECT sale_id FROM quote_status s WHERE s.quote_id = q.id AND s.sale_id IS NOT NULL) AS sale_id,
        (SELECT count(*) FROM quote_print p WHERE p.quote_id = q.id) AS times_printed
      FROM quote q LEFT JOIN app_user u ON u.id = q.created_by
      WHERE q.tenant_id = ? AND q.id = ?
    `);
    this.#lines = store.prepare(`
      SELECT product_id, product_name, unit, quantity_milli, unit_price_e4, tax_factor, tax_rate_bp, total_cents
      FROM quote_line WHERE tenant_id = ? AND quote_id = ? ORDER BY line_number
    `);
    this.#history = store.prepare(`
      SELECT s.status, s.recorded_at, u.name AS by_name, s.note FROM quote_status s LEFT JOIN app_user u ON u.id = s.recorded_by
      WHERE s.tenant_id = ? AND s.quote_id = ? ORDER BY s.sequence
    `);
    this.#summaries = store.prepare(`
      SELECT q.id, q.folio, q.customer_name, q.customer_phone, q.created_at, q.valid_until, ${LATEST_STATUS} AS status,
        (SELECT count(*) FROM quote_line l WHERE l.quote_id = q.id) AS line_count,
        (SELECT coalesce(sum(total_cents), 0) FROM quote_line l WHERE l.quote_id = q.id) AS total_cents,
        (SELECT group_concat(product_name, ' ') FROM quote_line l WHERE l.quote_id = q.id) AS product_names
      FROM quote q WHERE q.tenant_id = ? ORDER BY q.folio DESC LIMIT ?
    `);
    this.#sale = store.prepare('SELECT status, folio FROM sale WHERE tenant_id = ? AND id = ?');
    this.#saleTaken = store.prepare('SELECT 1 FROM quote_status WHERE tenant_id = ? AND sale_id = ?');
  }

  /**
   * Creates a quote, or replaces the products and details of an open one. The prices come from the catalog: a product
   * that was already in a valid quote keeps the price it was quoted at, and an expired quote that is edited is quoted
   * again at today's prices.
   *
   * @param request what the screen sent
   * @param user who saves it
   * @returns the quote as it was saved, or why it was not
   */
  save(request: SaveQuoteRequest, user: UserSummary): SaveQuoteResult {
    const today = localDay(this.#now());
    const details = this.#checkDetails(request, today);
    if (typeof details === 'string') {
      return { status: 'invalid', message: details };
    }
    if (request.quoteId === null) {
      const existing = this.#findByKey.get(this.#tenantId, request.idempotencyKey) as { id: string } | undefined;
      if (existing !== undefined) {
        return { status: 'saved', quote: this.get(existing.id)! };
      }
    }
    const previous = request.quoteId === null ? null : this.get(request.quoteId);
    if (request.quoteId !== null && (previous === null || (previous.status !== 'draft' && previous.status !== 'expired'))) {
      return { status: 'not_editable' };
    }
    const keptPrices = previous?.status === 'draft' ? new Map(previous.lines.map((line) => [line.productId, line])) : new Map<string, QuoteLine>();
    const lines = this.#priceLines(request, keptPrices);
    if (typeof lines === 'string') {
      return { status: 'invalid', message: lines };
    }
    const now = this.#now().toISOString();
    const quoteId = this.#store.transaction(() => {
      const id = previous?.id ?? uuidV7(this.#now().getTime());
      if (previous === null) {
        const { next: folio } = this.#nextFolio.get(this.#tenantId) as { next: number };
        this.#insertQuote.run(id, this.#tenantId, folio, request.idempotencyKey, details.customerName, details.customerPhone, details.notes, request.validUntil, user.id, now, now);
        const note = request.duplicatedFrom == null ? null : `Copia de ${this.get(request.duplicatedFrom)?.folio ?? 'otra cotización'}`;
        this.#appendStatus(id, 'draft', null, note, user.id, now);
      } else {
        this.#updateQuote.run(details.customerName, details.customerPhone, details.notes, request.validUntil, now, this.#tenantId, id);
        this.#deleteLines.run(this.#tenantId, id);
      }
      lines.forEach((line, index) => {
        this.#insertLine.run(
          uuidV7(this.#now().getTime()),
          this.#tenantId,
          id,
          index + 1,
          line.product.id,
          line.product.name,
          line.product.unit,
          line.quantityMilli,
          line.unitPriceE4,
          line.taxRate.factor,
          line.taxRate.rateBp,
          line.totalCents,
        );
      });
      this.#audit.record({
        userId: user.id,
        action: previous === null ? 'quote.created' : 'quote.edited',
        entity: 'quote',
        entityId: id,
        detail: `${String(lines.length)} lines, ${String(lines.reduce((sum, line) => sum + line.totalCents, 0))} cents, valid until ${request.validUntil}`,
      });
      return id;
    });
    return { status: 'saved', quote: this.get(quoteId)! };
  }

  /**
   * Reads a quote, whole.
   *
   * @param quoteId the quote
   * @returns the quote with its lines, totals and history, or null if this business has none with that id
   */
  get(quoteId: string): Quote | null {
    const row = this.#quote.get(this.#tenantId, quoteId) as QuoteRow | undefined;
    if (row === undefined) {
      return null;
    }
    const lineRows = this.#lines.all(this.#tenantId, quoteId) as unknown as LineRow[];
    const lines = lineRows.map((line): QuoteLine => ({
      productId: line.product_id,
      productName: line.product_name,
      quantity: quantityOf(line.quantity_milli, line.unit),
      unitPriceE4: line.unit_price_e4,
      taxRate: { factor: line.tax_factor, rateBp: line.tax_rate_bp },
      totalCents: line.total_cents,
      currentPriceE4: this.#catalog.findById(line.product_id)?.unitPriceE4 ?? null,
    }));
    const totals = saleTotals(lines.map((line) => ({ totalCents: line.totalCents, taxRate: line.taxRate })));
    const history = (this.#history.all(this.#tenantId, quoteId) as unknown as EventRow[]).map((event): QuoteEvent => ({
      status: event.status,
      at: event.recorded_at,
      byName: event.by_name ?? UNKNOWN_PERSON,
      note: event.note,
    }));
    return {
      id: row.id,
      folio: formatQuoteFolio(row.folio),
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      notes: row.notes,
      validUntil: row.valid_until,
      createdAt: row.created_at,
      createdById: row.created_by,
      createdByName: row.created_by_name ?? UNKNOWN_PERSON,
      updatedAt: row.updated_at,
      status: this.#displayStatus(row.status, row.valid_until),
      lines,
      subtotalCents: totals.subtotalCents,
      taxCents: totals.totalCents - totals.subtotalCents,
      totalCents: totals.totalCents,
      saleId: row.sale_id,
      history,
      timesPrinted: row.times_printed,
    };
  }

  /**
   * Lists the quotes, the newest first.
   *
   * @param search a folio, a name, a phone or a product, and which statuses to show
   * @returns the quotes that match, at most {@link MAX_QUOTES_LISTED}
   */
  list({ text, status }: QuoteSearch): QuoteSummary[] {
    const rows = this.#summaries.all(this.#tenantId, SEARCH_WINDOW) as unknown as SummaryRow[];
    const wanted = normalize(text);
    const folio = parseQuoteFolio(text);
    const digits = text.replace(/\D/gu, '');
    return rows
      .map((row) => ({ row, displayStatus: this.#displayStatus(row.status, row.valid_until) }))
      .filter(({ displayStatus }) => status === 'all' || displayStatus === status)
      .filter(({ row }) => wanted === '' || row.folio === folio || matches(row, wanted, digits))
      .slice(0, MAX_QUOTES_LISTED)
      .map(({ row, displayStatus }) => ({
        id: row.id,
        folio: formatQuoteFolio(row.folio),
        customerName: row.customer_name,
        customerPhone: row.customer_phone,
        createdAt: row.created_at,
        validUntil: row.valid_until,
        status: displayStatus,
        lineCount: row.line_count,
        totalCents: row.total_cents,
      }));
  }

  /**
   * Cancels an open quote. Whoever made it, or an owner, may cancel it; a cashier cancels somebody else's quote with the
   * PIN of an owner. The history keeps the reason.
   *
   * @param request the quote, the reason and, when needed, the PIN of an owner
   * @param user who is signed in
   * @returns the cancelled quote, or why it was not cancelled
   */
  cancel({ quoteId, reason, ownerPin }: CancelQuoteRequest, user: UserSummary): CancelQuoteResult {
    const text = reason.trim();
    if (text === '' || [...text].length > MAX_QUOTE_CANCEL_REASON) {
      return { status: 'invalid', message: `Escribe por qué se cancela, en ${String(MAX_QUOTE_CANCEL_REASON)} letras o menos.` };
    }
    const quote = this.get(quoteId);
    if (quote === null || (quote.status !== 'draft' && quote.status !== 'expired')) {
      return { status: 'not_cancellable' };
    }
    let authorizedBy = user.id;
    if (user.role !== 'owner' && quote.createdById !== user.id) {
      if (ownerPin === undefined || ownerPin === '') {
        return { status: 'owner_pin_required' };
      }
      const authorization = this.#authorizeOwnerPin(ownerPin);
      if (authorization.status === 'wrong_pin') {
        return { status: 'wrong_pin', attemptsLeft: authorization.attemptsLeft };
      }
      if (authorization.status === 'locked') {
        return { status: 'locked' };
      }
      authorizedBy = authorization.owner.id;
    }
    const now = this.#now().toISOString();
    this.#store.transaction(() => {
      this.#appendStatus(quoteId, 'cancelled', null, text, user.id, now);
      this.#audit.record({
        userId: user.id,
        action: 'quote.cancelled',
        entity: 'quote',
        entityId: quoteId,
        detail: `${quote.folio}: ${text}${authorizedBy === user.id ? '' : ` (authorized by owner ${authorizedBy})`}`,
      });
    });
    return { status: 'cancelled', quote: this.get(quoteId)! };
  }

  /**
   * Reads an open quote as the lines of a sale. While it is valid, each line goes at its quoted price; once it expired,
   * at today's price. A product that is no longer sold stays out. Nothing is written.
   *
   * @param quoteId the quote
   * @returns the lines, or why the quote cannot be sold
   */
  prepareConversion(quoteId: string): PrepareConversionResult {
    const quote = this.get(quoteId);
    if (quote === null) {
      return { status: 'not_convertible', message: 'Esa cotización no existe.' };
    }
    if (quote.status === 'converted') {
      return { status: 'not_convertible', message: `La cotización ${quote.folio} ya se vendió.` };
    }
    if (quote.status === 'cancelled') {
      return { status: 'not_convertible', message: `La cotización ${quote.folio} está cancelada.` };
    }
    const isExpired = quote.status === 'expired';
    const lines: ConversionLine[] = [];
    const skipped: string[] = [];
    for (const line of quote.lines) {
      const product = this.#catalog.findById(line.productId);
      if (product === null) {
        skipped.push(line.productName);
        continue;
      }
      lines.push({ product, quantityMilli: line.quantity.milli, chargedPriceE4: isExpired ? product.unitPriceE4 : line.unitPriceE4, quotedPriceE4: line.unitPriceE4 });
    }
    if (lines.length === 0) {
      return { status: 'not_convertible', message: 'Ya no se vende ningún producto de esta cotización.' };
    }
    return { status: 'ready', quoteId, folio: quote.folio, isExpired, lines, skipped };
  }

  /**
   * Marks an open quote as sold, once the register collected its sale. The sale must be completed and belong to no
   * other quote.
   *
   * @param request the quote and the sale it became
   * @param user who collected it
   * @returns whether it was marked
   */
  markConverted({ quoteId, saleId }: MarkConvertedRequest, user: UserSummary): MarkConvertedResult {
    const quote = this.get(quoteId);
    if (quote === null || (quote.status !== 'draft' && quote.status !== 'expired')) {
      return { status: 'not_convertible', message: 'La cotización ya no está abierta.' };
    }
    const sale = this.#sale.get(this.#tenantId, saleId) as { status: string; folio: number | null } | undefined;
    if (sale?.status !== 'completed' || sale.folio === null) {
      return { status: 'not_convertible', message: 'Esa venta no está cobrada.' };
    }
    if (this.#saleTaken.get(this.#tenantId, saleId) !== undefined) {
      return { status: 'not_convertible', message: 'Esa venta ya es de otra cotización.' };
    }
    const now = this.#now().toISOString();
    const saleFolio = formatFolio(sale.folio);
    this.#store.transaction(() => {
      this.#appendStatus(quoteId, 'converted', saleId, `Venta ${saleFolio}`, user.id, now);
      this.#audit.record({ userId: user.id, action: 'quote.converted', entity: 'quote', entityId: quoteId, detail: `${quote.folio} became sale ${saleFolio} (${saleId})` });
    });
    return { status: 'converted' };
  }

  /**
   * Writes down that a quote was printed, for its reprints and the audit log.
   *
   * @param quoteId the quote
   * @param userId who printed it
   * @returns the quote and whether it had been printed before, or null if it does not exist
   */
  recordPrint(quoteId: string, userId: string): { readonly quote: Quote; readonly isReprint: boolean } | null {
    const quote = this.get(quoteId);
    if (quote === null) {
      return null;
    }
    const now = this.#now();
    this.#store.transaction(() => {
      this.#insertPrint.run(uuidV7(now.getTime()), this.#tenantId, quoteId, userId, now.toISOString());
      this.#audit.record({ userId, action: 'quote.printed', entity: 'quote', entityId: quoteId, detail: `${quote.folio}, print ${String(quote.timesPrinted + 1)}` });
    });
    return { quote, isReprint: quote.timesPrinted > 0 };
  }

  #appendStatus(quoteId: string, status: QuoteStatus, saleId: string | null, note: string | null, userId: string, at: string): void {
    const { next } = this.#nextSequence.get(quoteId) as { next: number };
    this.#insertStatus.run(uuidV7(this.#now().getTime()), this.#tenantId, quoteId, next, status, saleId, note, userId, at);
  }

  #displayStatus(status: QuoteStatus, validUntil: string): QuoteDisplayStatus {
    return status === 'draft' && isQuoteExpired(validUntil, localDay(this.#now())) ? 'expired' : status;
  }

  /** Checks the customer, the notes and the day. @returns the cleaned details, or what is wrong */
  #checkDetails(
    request: SaveQuoteRequest,
    today: string,
  ): { customerName: string | null; customerPhone: string | null; notes: string | null } | string {
    const customerName = cleanText(request.customerName);
    const customerPhone = cleanText(request.customerPhone);
    const notes = cleanText(request.notes);
    if (customerName !== null && [...customerName].length > MAX_QUOTE_CUSTOMER_NAME) {
      return `El nombre del cliente cabe en ${String(MAX_QUOTE_CUSTOMER_NAME)} letras.`;
    }
    if (customerPhone !== null && (customerPhone.length > MAX_QUOTE_CUSTOMER_PHONE || !/^[\d\s()+-]+$/u.test(customerPhone))) {
      return 'El teléfono lleva solo números, espacios, guiones o paréntesis.';
    }
    if (notes !== null && [...notes].length > MAX_QUOTE_NOTES) {
      return `Las notas caben en ${String(MAX_QUOTE_NOTES)} letras.`;
    }
    if (!DAY_PATTERN.test(request.validUntil) || addDays(request.validUntil, 0) !== request.validUntil) {
      return 'Elige un día válido para la vigencia.';
    }
    if (request.validUntil < today) {
      return 'La vigencia no puede terminar antes de hoy.';
    }
    if (request.validUntil > addDays(today, MAX_QUOTE_VALIDITY_DAYS)) {
      return `La vigencia es de un año como máximo.`;
    }
    if (request.lines.length === 0) {
      return 'Agrega al menos un producto a la cotización.';
    }
    if (request.lines.length > MAX_QUOTE_LINES) {
      return `Una cotización lleva hasta ${String(MAX_QUOTE_LINES)} productos.`;
    }
    return { customerName, customerPhone, notes };
  }

  /** Prices each product, joining repeated ones. @returns the lines, or what is wrong */
  #priceLines(request: SaveQuoteRequest, keptPrices: ReadonlyMap<string, QuoteLine>): PricedLine[] | string {
    const quantities = new Map<string, number>();
    for (const { productId, quantityMilli } of request.lines) {
      if (!Number.isSafeInteger(quantityMilli) || quantityMilli <= 0) {
        return 'Cada producto lleva una cantidad mayor que cero.';
      }
      quantities.set(productId, (quantities.get(productId) ?? 0) + quantityMilli);
    }
    const lines: PricedLine[] = [];
    try {
      for (const [productId, quantityMilli] of quantities) {
        const product = this.#catalog.findById(productId);
        if (product === null) {
          return 'Un producto de la cotización ya no se vende. Quítalo y guarda otra vez.';
        }
        if (quantityMilli > MAX_QUANTITY_MILLI || (product.unit === 'piece' && quantityMilli % MILLI_PER_UNIT !== 0)) {
          return `Revisa la cantidad de ${product.name}: las piezas van en números enteros.`;
        }
        const kept = keptPrices.get(productId);
        const unitPriceE4 = kept?.unitPriceE4 ?? product.unitPriceE4;
        const taxRate = kept?.taxRate ?? product.taxRate;
        const { totalCents } = lineTotals(unitPriceE4, quantityOf(quantityMilli, product.unit), taxRate);
        lines.push({ product, quantityMilli, unitPriceE4, taxRate, totalCents });
      }
      saleTotals(lines.map(({ totalCents, taxRate }) => ({ totalCents, taxRate })));
    } catch (error) {
      if (error instanceof MoneyError) {
        return 'El importe es demasiado grande para una cotización. Revisa las cantidades.';
      }
      throw error;
    }
    return lines;
  }
}

function cleanText(value: string | null): string | null {
  const text = value?.trim().replace(/\s+/gu, ' ') ?? '';
  return text === '' ? null : text;
}

/** Text without accents, capitals or extra spaces, so «Martín» finds «martin». */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
}

function matches(row: SummaryRow, wanted: string, digits: string): boolean {
  const haystack = normalize(`${row.customer_name ?? ''} ${row.product_names ?? ''}`);
  if (haystack.includes(wanted)) {
    return true;
  }
  return digits.length >= 3 && (row.customer_phone ?? '').replace(/\D/gu, '').includes(digits);
}
