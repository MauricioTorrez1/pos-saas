import type { DashboardSummary } from '../../shared/dashboard-api';
import { PAYMENT_KIND_LABELS, WEEKDAY_LABELS, changeLabel, percentLabel, pesosLabel } from '../../shared/dashboard-format';
import type { IncomeStatement } from '../../shared/income-statement';
import { divideHalfUp } from '../reports/average-cost';
import type { ReportExtras } from './report-reader';

/**
 * The plain sentences under each chart of the illustrated report (E1-57, ADR 0073), for an owner who is not an accountant.
 * Each one is built from the same integers the chart shows, so the words never say something the numbers do not.
 */

/**
 * The share of a part in a whole, in basis points, rounded half up.
 *
 * @param part an integer, zero or more
 * @param whole an integer
 * @returns the share, or null when the whole is not above zero
 */
export function shareOf(part: number, whole: number): number | null {
  if (whole <= 0) {
    return null;
  }
  const magnitude = Number(divideHalfUp(BigInt(Math.abs(part)) * 10_000n, BigInt(whole)));
  return part < 0 ? -magnitude : magnitude;
}

/** What the sales did, against the period before. */
export function salesReading(summary: DashboardSummary): string {
  const { totals, previousTotals } = summary;
  if (totals.salesCount === 0) {
    return 'En este periodo no hubo ventas.';
  }
  const parts = [`Vendiste ${pesosLabel(totals.totalCents)} con IVA en ${String(totals.salesCount)} ticket(s); cada cliente dejó en promedio ${pesosLabel(totals.averageTicketCents)}.`];
  if (previousTotals !== null) {
    const change = changeLabel(totals.totalCents, previousTotals.totalCents);
    parts.push(
      change === 'nuevo'
        ? 'En el periodo anterior no hubo ventas para comparar.'
        : change === 'sin cambio'
          ? 'Vendiste lo mismo que en el periodo anterior.'
          : `Frente al periodo anterior (${pesosLabel(previousTotals.totalCents)}) es ${change}.`,
    );
  }
  if (summary.isInProgress) {
    parts.push('El periodo todavía no termina, así que la comparación es contra un periodo completo.');
  }
  return parts.join(' ');
}

/** What the business earned, in the words of «de cada $100». */
export function statementReading(statement: IncomeStatement): string {
  if (!statement.hasActivity) {
    return 'En este periodo no hubo ventas, devoluciones ni gastos.';
  }
  const net = statement.netProfit.amountCents;
  if (statement.netSales.amountCents <= 0) {
    return `No hubo ventas netas, y los gastos fueron ${pesosLabel(statement.operatingExpenses.amountCents)}: el periodo cerró en ${pesosLabel(net)}.`;
  }
  const share = statement.netProfit.shareBp ?? 0;
  if (net < 0) {
    return `En este periodo el negocio perdió ${pesosLabel(-net)}: el costo de la mercancía y los gastos fueron más que lo que dejó vender. La pérdida equivale a ${percentLabel(-share)} de las ventas netas.`;
  }
  // A share in basis points is the same number as the cents of every $100: 1,234 bp is $12.34 of each $100.
  return `De cada $100 que vendiste sin IVA, te quedaron ${pesosLabel(share)} después de pagar la mercancía y los gastos que anotaste (antes de ISR). La utilidad neta fue ${pesosLabel(net)}.`;
}

/** Which way of paying weighed the most. */
export function paymentReading(summary: DashboardSummary): string {
  const total = summary.paymentKinds.reduce((sum, row) => sum + row.totalCents, 0);
  const top = [...summary.paymentKinds].sort((a, b) => b.totalCents - a.totalCents)[0];
  if (top === undefined || total === 0) {
    return 'No hubo cobros en el periodo.';
  }
  const share = shareOf(top.totalCents, total) ?? 0;
  const card = summary.methodAmounts.find((row) => row.method === 'card')?.amountCents ?? 0;
  const cardText = card > 0 ? ` Con tarjeta entraron ${pesosLabel(card)}; su comisión cuenta cuando la anotas en «Gastos».` : '';
  return `La forma de pago que más pesó fue ${PAYMENT_KIND_LABELS[top.kind].toLowerCase()}: ${percentLabel(share)} de lo vendido.${cardText}`;
}

/** The busiest hour and day of the week. */
export function timeReading(summary: DashboardSummary): string {
  const bestHour = [...summary.byHour].sort((a, b) => b.totalCents - a.totalCents || a.hour - b.hour)[0];
  const bestDay = [...summary.byWeekday].sort((a, b) => b.totalCents - a.totalCents || a.weekday - b.weekday)[0];
  if (bestHour === undefined || bestHour.totalCents === 0 || bestDay === undefined) {
    return 'Sin ventas no hay horas ni días que comparar.';
  }
  const hour = `${String(bestHour.hour).padStart(2, '0')}:00`;
  return `La hora que más vende es de ${hour} a ${String(bestHour.hour + 1).padStart(2, '0')}:00 (${pesosLabel(bestHour.totalCents)}), y el mejor día es el ${(WEEKDAY_LABELS[bestDay.weekday] ?? '').toLowerCase()}. Ahí conviene tener la caja y el surtido listos.`;
}

/** How much the first product weighs. */
export function topProductsReading(summary: DashboardSummary): string {
  const first = summary.topSellers[0];
  if (first === undefined) {
    return 'Ningún producto se vendió en el periodo.';
  }
  const tenTotal = summary.topSellers.reduce((sum, seller) => sum + seller.amountCents, 0);
  const share = shareOf(tenTotal, summary.totals.totalCents);
  return `«${first.name}» fue lo que más dinero trajo (${pesosLabel(first.amountCents)}). Estos ${String(summary.topSellers.length)} productos suman ${share === null ? 'todo' : percentLabel(share)} de lo vendido: que nunca falten.`;
}

/** What the cost of the goods says. */
export function costReading(statement: IncomeStatement): string {
  const first = statement.detail.costByProduct.find((line) => !line.isRest);
  if (first === undefined) {
    return statement.uncosted.productCount > 0
      ? 'Lo que se vendió no tiene costo capturado, así que no se puede saber cuánto costó.'
      : 'No salió mercancía con costo en el periodo.';
  }
  const share = statement.costOfGoods.shareBp;
  return `La mercancía que salió costó ${pesosLabel(statement.costOfGoods.amountCents)}${share === null ? '' : `, ${percentLabel(share)} de las ventas netas`}. La que más pesó fue «${first.name}» (${pesosLabel(first.costCents)}).`;
}

/** The biggest expense. */
export function expensesReading(statement: IncomeStatement): string {
  const concepts = statement.detail.expensesByConcept;
  if (concepts.length === 0) {
    return 'No anotaste gastos en el periodo. Si pagaste renta, luz o sueldos, anótalos en «Gastos» para que la utilidad sea real.';
  }
  const biggest = [...concepts].sort((a, b) => b.amountCents - a.amountCents)[0]!;
  const share = shareOf(biggest.amountCents, statement.operatingExpenses.amountCents) ?? 0;
  const drawer = concepts.reduce((sum, line) => sum + line.fromDrawerCents, 0);
  const drawerText = drawer > 0 ? ` De la caja salieron ${pesosLabel(drawer)}; ya se restaron en el corte, una sola vez.` : '';
  return `Gastaste ${pesosLabel(statement.operatingExpenses.amountCents)}. El gasto más grande fue «${biggest.concept}», ${percentLabel(share)} del total.${drawerText}`;
}

/** Whether the cuts balanced. */
export function cashReading(summary: DashboardSummary, extras: ReportExtras): string {
  const cuts = extras.cashiers.reduce((sum, row) => sum + row.cuts, 0);
  const difference = extras.cashiers.reduce((sum, row) => sum + row.cashDifferenceCents, 0);
  const unbalanced = extras.cashiers.reduce((sum, row) => sum + row.cutsWithDifference, 0);
  const movements = summary.cashMovements;
  const movementText =
    movements === null || (movements.inCents === 0 && movements.outCents === 0)
      ? ''
      : ` Aparte de las ventas, entraron ${pesosLabel(movements.inCents)} y salieron ${pesosLabel(movements.outCents)} a mano.`;
  if (cuts === 0) {
    return `No se hizo ningún corte en el periodo.${movementText}`;
  }
  if (unbalanced === 0) {
    return `Se hicieron ${String(cuts)} corte(s) y todos cuadraron.${movementText}`;
  }
  const sign = difference < 0 ? `faltaron ${pesosLabel(-difference)}` : difference > 0 ? `sobraron ${pesosLabel(difference)}` : 'el efectivo quedó parejo';
  return `De ${String(cuts)} corte(s), ${String(unbalanced)} no cuadró(aron); en efectivo ${sign}. Revisa el motivo que anotó cada cajero.${movementText}`;
}

/** The money sitting on the shelves. */
export function inventoryReading(summary: DashboardSummary): string {
  const inventory = summary.inventory;
  if (inventory === null) {
    return '';
  }
  const idle = inventory.notSelling.items.reduce((sum, line) => sum + (line.valueCents ?? 0), 0);
  const parts = [`Tienes ${pesosLabel(inventory.valueCents)} en mercancía a costo.`];
  if (inventory.notSelling.total > 0) {
    parts.push(
      `${String(inventory.notSelling.total)} producto(s) con existencia no se vendieron en el periodo${idle > 0 ? `; los de la lista suman ${pesosLabel(idle)} parados` : ''}.`,
    );
  }
  if (inventory.outOfStock.total + inventory.runningLow.total > 0) {
    parts.push(`${String(inventory.outOfStock.total)} están agotados y ${String(inventory.runningLow.total)} se acaban al paso de este periodo: pídelos al proveedor.`);
  }
  if (inventory.withoutCost.total > 0) {
    parts.push(`${String(inventory.withoutCost.total)} producto(s) no tienen costo, así que no suman al valor ni a la utilidad.`);
  }
  return parts.join(' ');
}

/** Returns and cancellations, against the sales. */
export function returnsReading(summary: DashboardSummary): string {
  const { totals, cancellations } = summary;
  if (totals.returnsCount === 0 && cancellations.count === 0) {
    return 'No hubo devoluciones ni cancelaciones en el periodo.';
  }
  const share = shareOf(totals.returnsCents, totals.totalCents);
  return `Se devolvieron ${pesosLabel(totals.returnsCents)} en ${String(totals.returnsCount)} devolución(es)${share === null ? '' : ` (${percentLabel(share)} de lo vendido)`}, y se cancelaron ${String(cancellations.count)} venta(s) por ${pesosLabel(cancellations.totalCents)} antes de cobrarse. Muchas devoluciones del mismo producto pueden ser un defecto o un error de precio.`;
}

/** The orders to suppliers. */
export function purchasesReading(extras: ReportExtras): string {
  const { purchases } = extras;
  if (purchases.draftCount === 0 && purchases.sentCount === 0) {
    return 'No hay pedidos a proveedores abiertos ni enviados en el periodo.';
  }
  const missing = purchases.linesWithoutCost > 0 ? ` ${String(purchases.linesWithoutCost)} renglón(es) no tienen costo y no están en los totales.` : '';
  return `Hay ${String(purchases.draftCount)} pedido(s) en borrador por ${pesosLabel(purchases.draftTotalCents)} y se enviaron ${String(purchases.sentCount)} por ${pesosLabel(purchases.sentTotalCents)} en el periodo.${missing}`;
}
