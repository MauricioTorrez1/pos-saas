import type { CoreResult } from '../catalog/core-api';
import { PERIODICITY_LABELS, type CancellationStatus, type Periodicity } from './types';

const MONEY = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const DAY = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/**
 * Formats an amount in cents as pesos, for example `$1,160.00`. The integer is split, never divided as a float.
 *
 * @param cents - Amount in cents.
 */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  const pesos = Math.trunc(absolute / 100);
  const rest = absolute % 100;
  return sign + MONEY.format(pesos).replace(/\.00$/, '') + '.' + String(rest).padStart(2, '0');
}

/**
 * Formats a `yyyy-MM-dd` day, for example `3 de octubre de 2026`.
 *
 * @param day - The day as the core sends it.
 */
export function formatDay(day: string): string {
  return DAY.format(new Date(`${day}T00:00:00Z`));
}

/**
 * Names a tax rate for the table of totals.
 *
 * @param basisPoints - VAT rate in basis points, or `null` for exempt.
 */
export function rateLabel(basisPoints: number | null): string {
  if (basisPoints === null) {
    return 'Exento';
  }
  return `IVA ${basisPoints / 100}%`;
}

/**
 * Names a periodicity the core sends, falling back to the raw value.
 *
 * @param periodicity - `monthly`, `biweekly` or `daily`.
 */
export function periodicityLabel(periodicity: string): string {
  return PERIODICITY_LABELS[periodicity as Periodicity] ?? periodicity;
}

/**
 * The first day of last month, the period the owner most likely invoices.
 *
 * @param today - The current day.
 * @returns The day as `yyyy-MM-dd`.
 */
export function defaultGlobalDay(today: Date): string {
  const year = today.getMonth() === 0 ? today.getFullYear() - 1 : today.getFullYear();
  const month = today.getMonth() === 0 ? 12 : today.getMonth();
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

/**
 * Turns a failed global invoice call into a sentence for the owner, using the `code` of the core.
 *
 * @param result - The failed call.
 */
export function globalFailureMessage(result: Extract<CoreResult<unknown>, { ok: false }>): string {
  const code = typeof result.problem.code === 'string' ? result.problem.code : null;
  switch (code) {
    case 'period_not_closed':
      return 'El periodo todavía no termina. La factura global se emite cuando acaba.';
    case 'no_sales':
      return 'No quedan ventas sin facturar en ese periodo.';
    case 'preview_stale':
      return `Las ventas del periodo cambiaron mientras revisabas (antes ${String(result.problem.expectedSaleCount)}, ahora ${String(result.problem.actualSaleCount)}). No se timbró nada; revisa la nueva vista previa.`;
    case 'already_issued':
      return 'Ese periodo ya tiene su factura global timbrada.';
    case 'in_progress':
      return 'Otra persona está timbrando la global de este periodo. Espera un momento y vuelve a revisar.';
    case 'issuer_not_configured':
      return 'Falta configurar el código postal de expedición (INVOICING_ISSUER_ZIP_CODE) en el sistema central.';
    case 'provider_rejected':
      return 'Facturapi rechazó la factura global. Las ventas quedaron libres; corrige lo que indica y vuelve a intentarlo.';
    case 'provider_not_configured':
      return 'La facturación todavía no está configurada (falta la llave de Facturapi).';
    case 'outcome_unknown':
      return 'Facturapi no respondió y no sabemos si se timbró. Vuelve a dar clic en «Timbrar»: antes de timbrar otra vez se consulta si ya existe.';
    case 'invalid_request':
      return 'Revisa la periodicidad y la fecha del periodo.';
    default:
      break;
  }
  switch (result.status) {
    case 0:
      return 'No pudimos hablar con el sistema central. Revisa tu conexión e inténtalo de nuevo.';
    case 401:
      return 'Tu sesión terminó. Vuelve a iniciar sesión.';
    case 403:
      return 'Tu rol no permite facturar. Solo el dueño y el encargado pueden.';
    default:
      return 'El sistema central tuvo un problema. Inténtalo en unos minutos.';
  }
}

const CANCELLATION_LABELS: Record<CancellationStatus, string> = {
  requested: 'Cancelación enviada; falta la respuesta de Facturapi',
  pending: 'Cancelación en espera de que el cliente la acepte',
  accepted: 'Cancelada',
  rejected: 'El cliente rechazó la cancelación; sigue vigente',
  failed: 'Facturapi rechazó la cancelación; sigue vigente',
};

/**
 * Describes where the cancellation of a CFDI stands.
 *
 * @param status - The cancellation status of the core, or `null` if nobody asked to cancel it.
 */
export function cancellationLabel(status: CancellationStatus | null): string {
  return status === null ? 'Vigente' : CANCELLATION_LABELS[status];
}

/**
 * Whether the owner may ask to cancel a CFDI in this state: stamped, and not cancelled or waiting for an answer.
 *
 * @param stamped - Whether the CFDI is stamped.
 * @param status - Its cancellation status.
 */
export function mayAskToCancel(stamped: boolean, status: CancellationStatus | null): boolean {
  return stamped && (status === null || status === 'rejected' || status === 'failed' || status === 'requested');
}

/**
 * Turns a failed cancellation or credit note call into a sentence for the owner, using the `code` of the core.
 *
 * @param result - The failed call.
 */
export function cfdiFailureMessage(result: Extract<CoreResult<unknown>, { ok: false }>): string {
  const code = typeof result.problem.code === 'string' ? result.problem.code : null;
  switch (code) {
    case 'motive_unknown':
    case 'motive_not_allowed':
      return 'Ese motivo no aplica a este comprobante. Elige otro.';
    case 'substitute_required':
      return 'El motivo 01 necesita el UUID de la factura que la sustituye. Emítela primero con «Sustituir».';
    case 'substitute_not_replacement':
      return 'Ese UUID no es una factura que sustituya a esta. Usa el UUID de la factura emitida con «Sustituir».';
    case 'not_stamped':
      return 'Solo se cancela un comprobante timbrado.';
    case 'already_cancelled':
      return 'Ese comprobante ya está cancelado.';
    case 'awaiting_acceptance':
      return 'La cancelación espera la respuesta del cliente. Usa «Consultar» para ver si ya respondió.';
    case 'in_progress':
      return 'Otra persona está tramitando este comprobante. Espera un momento y vuelve a consultar.';
    case 'not_requested':
      return 'Nadie ha pedido cancelar ese comprobante.';
    case 'not_invoiced':
      return 'Esa venta no tiene factura que corregir: o no se facturó, o la devolución llegó antes de la global y ya se descontó.';
    case 'customer_unknown':
      return 'La factura se emitió antes de guardar al cliente en Facturapi. Emite la nota de crédito desde Facturapi.';
    case 'already_issued':
      return 'Esa devolución ya tiene su nota de crédito.';
    case 'issuer_not_configured':
      return 'Falta configurar el código postal de expedición (INVOICING_ISSUER_ZIP_CODE) en el sistema central.';
    case 'provider_rejected':
      return 'Facturapi rechazó la solicitud. No cambió nada; corrige lo que indica y vuelve a intentarlo.';
    case 'provider_not_configured':
      return 'La facturación todavía no está configurada (falta la llave de Facturapi).';
    case 'outcome_unknown':
      return 'Facturapi no respondió y no sabemos si se hizo. Vuelve a intentarlo: antes se consulta en Facturapi.';
    case 'not_found':
      return 'No encontramos ese comprobante o esa devolución en este negocio.';
    default:
      break;
  }
  if (result.status === 403) {
    return 'Tu rol no permite esta acción. Solo el dueño cancela facturas.';
  }
  return globalFailureMessage(result);
}

/**
 * Turns a failed replacement invoice into a sentence for the owner.
 *
 * @param result - The failed call.
 */
export function replaceFailureMessage(result: Extract<CoreResult<unknown>, { ok: false }>): string {
  const code = typeof result.problem.code === 'string' ? result.problem.code : null;
  if (code === 'not_replaceable') {
    return 'Solo se sustituye una factura timbrada y vigente de esa venta.';
  }
  if (result.problem.errors !== undefined) {
    return 'Revisa los datos fiscales del cliente: el sistema central no los aceptó.';
  }
  if (result.status === 409 && code === null) {
    return 'Esa factura ya tiene una sustituta, o alguien la está timbrando ahora.';
  }
  return cfdiFailureMessage(result);
}
