import { writeFileSync } from 'node:fs';

import { formatCents } from '@pos-saas/money';

import { formatUnitCost } from '../../shared/product-admin';
import { milliText, type CartLineRequest, type ConfirmCartResult, type CreatedOrder, type ExportCartResult } from '../../shared/supplier-catalog';
import type { OrderLineRequest } from '../../shared/supplier-order';
import { horizontalBars } from '../missing/missing-items-export';
import type { PurchaseOrderService } from './purchase-order-service';
import type { CartReport, CartReportLine, SupplierCatalogService } from './supplier-catalog-service';

const MOMENT_FORMAT = new Intl.DateTimeFormat('es-MX', { dateStyle: 'long', timeStyle: 'short' });
const INK = '#1b2328';
const SOFT_INK = '#55626b';
const GOOD = '#15803d';
/** The note every draft made from the comparator carries, so the owner knows where it came from. */
export const CART_ORDER_NOTE = 'Armado en el comparador de precios';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** What confirming and exporting need from the outside, so a test can run them without Electron. */
export interface CartDependencies {
  readonly catalog: Pick<SupplierCatalogService, 'cartReport'>;
  readonly orders: Pick<PurchaseOrderService, 'save'>;
  readonly pickSavePath: (title: string, defaultName: string, filterName: string, extension: string) => Promise<string | null>;
  readonly renderPdf: (html: string) => Promise<Buffer>;
  readonly businessName: () => string;
  readonly writeFile?: (path: string, bytes: Buffer) => void;
  readonly now?: () => Date;
}

/**
 * Splits the cart into one draft order per supplier through the order's own `save`, so the same rules apply: the owner
 * PIN, the lines, the audit log. The cost of each line is the cost per base unit of the chosen item, worked out again here.
 * If a supplier's order cannot be saved, the ones already saved stay and the answer names the one that failed.
 *
 * @param lines the lines of the cart
 * @param dependencies the lists and the orders
 * @returns the drafts created, or why not
 */
export function confirmCart(lines: readonly CartLineRequest[], dependencies: Pick<CartDependencies, 'catalog' | 'orders'>): ConfirmCartResult {
  const report = dependencies.catalog.cartReport(lines);
  if ('status' in report) {
    return report;
  }
  const bySupplier = new Map<string, CartReportLine[]>();
  for (const line of report.lines) {
    bySupplier.set(line.chosen.supplierId, [...(bySupplier.get(line.chosen.supplierId) ?? []), line]);
  }
  const created: CreatedOrder[] = [];
  for (const [supplierId, supplierLines] of bySupplier) {
    const orderLines: OrderLineRequest[] = supplierLines.map((line) => ({
      productId: line.productId,
      supplierCode: line.chosen.supplierCode,
      quantityMilli: line.quantityMilli,
      unitCostE6: line.chosen.baseUnitCostE6,
    }));
    const result = dependencies.orders.save({ supplierId, notes: CART_ORDER_NOTE, lines: orderLines });
    if (result.status !== 'saved') {
      const supplierName = supplierLines[0]?.chosen.supplierName ?? '';
      if (created.length === 0 && (result.status === 'authorization_required' || result.status === 'wrong_pin' || result.status === 'locked')) {
        return result;
      }
      return { status: 'partial', orders: created, failedSupplier: supplierName };
    }
    created.push({
      orderId: result.order.id,
      folio: result.order.folio,
      supplierName: result.order.supplierName,
      lineCount: result.order.lines.length,
      totalCents: result.order.totalCents,
    });
  }
  return { status: 'created', orders: created };
}

const PDF_STYLES = `
  body { font-family: 'Segoe UI', Arial, sans-serif; color: ${INK}; font-size: 10px; margin: 0; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  h2 { font-size: 14px; margin: 16px 0 6px; page-break-after: avoid; }
  p { margin: 2px 0; color: ${SOFT_INK}; }
  .kpis { display: flex; gap: 24px; margin: 12px 0; }
  .kpi strong { display: block; font-size: 18px; color: ${INK}; }
  .kpi.good strong { color: ${GOOD}; }
  figure { margin: 0 0 8px; page-break-inside: avoid; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0 12px; }
  th, td { padding: 3px 5px; border-bottom: 1px solid #bfc7cd; text-align: left; vertical-align: top; }
  td.number { text-align: right; white-space: nowrap; }
  td.best { color: ${GOOD}; font-weight: 600; }
  thead th { border-bottom: 2px solid ${INK}; }
  tr { page-break-inside: avoid; }
`;

/**
 * Builds the page that becomes the PDF of the cart: one row per product with the chosen price and supplier next to the
 * lowest price and its supplier, the total and the possible savings, and two bar charts drawn as SVG (products and spend
 * per supplier). Every text is escaped, because descriptions come from the suppliers' files, and the page carries a policy
 * that blocks scripts and the network.
 *
 * @param report the cart with today's prices
 * @param businessName the name of the business for the title
 * @param generatedAt when it was made
 * @returns the HTML
 */
export function cartHtml(report: CartReport, businessName: string, generatedAt: Date): string {
  const rows = report.lines
    .map((line) => {
      const isBest = line.chosen.baseUnitCostE6 === line.cheapest.baseUnitCostE6;
      return (
        `<tr><td>${escapeHtml(line.productCode ?? line.chosen.supplierCode)}</td><td>${escapeHtml(line.productName)}</td>` +
        `<td class="number">${milliText(line.quantityMilli)}</td>` +
        `<td class="number${isBest ? ' best' : ''}">${formatUnitCost(line.chosen.baseUnitCostE6)}</td><td>${escapeHtml(line.chosen.supplierName)}</td>` +
        `<td class="number best">${formatUnitCost(line.cheapest.baseUnitCostE6)}</td><td>${escapeHtml(line.cheapest.supplierName)}</td>` +
        `<td class="number">${formatCents(line.chosenCents)}</td></tr>`
      );
    })
    .join('');
  const parts = [
    `<h1>${escapeHtml(businessName)}</h1>`,
    '<p>Pedido armado en el comparador de precios · precios por unidad, antes de IVA</p>',
    `<p>Generado el ${escapeHtml(MOMENT_FORMAT.format(generatedAt))}</p>`,
    `<div class="kpis"><div class="kpi"><strong>${formatCents(report.totalCents)}</strong>total del pedido</div>` +
      `<div class="kpi"><strong>${formatCents(report.cheapestTotalCents)}</strong>comprando todo con el más barato</div>` +
      `<div class="kpi good"><strong>${formatCents(report.possibleSavingsCents)}</strong>ahorro posible</div></div>`,
    '<h2>Productos</h2>',
    `<table><thead><tr><th>Código</th><th>Producto</th><th>Cantidad</th><th>Precio elegido</th><th>Proveedor elegido</th><th>Precio más bajo</th><th>Proveedor más barato</th><th>Importe</th></tr></thead><tbody>${rows}</tbody></table>`,
    '<h2>Productos por proveedor</h2>',
    `<figure>${horizontalBars(report.suppliers.map((share) => ({ label: share.supplierName, value: share.productCount })))}</figure>`,
    '<h2>Gasto por proveedor</h2>',
    `<figure>${horizontalBars(report.suppliers.map((share) => ({ label: share.supplierName, value: share.spendCents, valueText: formatCents(share.spendCents) })))}</figure>`,
  ];
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><title>Pedido del comparador</title><style>${PDF_STYLES}</style></head><body>${parts.join('')}</body></html>`;
}

/**
 * Saves the PDF of the cart where the owner chooses.
 *
 * @param lines the lines of the cart
 * @param dependencies the lists, the native windows and the name of the business
 * @returns where it was saved, or why not
 */
export async function exportCartPdf(lines: readonly CartLineRequest[], dependencies: Omit<CartDependencies, 'orders'>): Promise<ExportCartResult> {
  const report = dependencies.catalog.cartReport(lines);
  if ('status' in report) {
    return report;
  }
  const now = (dependencies.now ?? (() => new Date()))();
  const path = await dependencies.pickSavePath('Guardar el pedido del comparador', `comparador-${now.toISOString().slice(0, 10)}.pdf`, 'Documento PDF', 'pdf');
  if (path === null) {
    return { status: 'cancelled' };
  }
  try {
    const bytes = await dependencies.renderPdf(cartHtml(report, dependencies.businessName(), now));
    (dependencies.writeFile ?? writeFileSync)(path, bytes);
    return { status: 'saved', path };
  } catch {
    return { status: 'failed', message: 'No se pudo guardar el PDF. Revisa que la carpeta exista y que el archivo no esté abierto en otro programa.' };
  }
}
