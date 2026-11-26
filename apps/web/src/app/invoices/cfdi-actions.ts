'use server';

import { revalidatePath } from 'next/cache';
import { cancellationLabel, cfdiFailureMessage, replaceFailureMessage } from '@/lib/invoicing/messages';
import { CANCELLATION_MOTIVES, EMPTY_CFDI_STATE, type CfdiActionState, type CfdiKind } from '@/lib/invoicing/types';
import { getInvoicingApi } from '@/lib/server';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function field(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function failure(result: Parameters<typeof cfdiFailureMessage>[0], message: string): CfdiActionState {
  const providerMessage = typeof result.problem.providerMessage === 'string' ? result.problem.providerMessage : null;
  return { done: null, error: message, providerMessage };
}

function refreshScreens() {
  revalidatePath('/invoices');
  revalidatePath('/invoices/global');
}

/**
 * Asks to cancel a CFDI, or reads at the provider where its cancellation stands (ADR 0081). Only the owner holds
 * `invoice.cancel`; the core answers 403 to anyone else.
 *
 * Fields: `kind` (`invoice` or `global`), `id`, `intent` (`cancel` or `refresh`), `motive` and, for motive 01,
 * `substitute` (UUID of the replacement invoice).
 */
export async function cancellationAction(_previous: CfdiActionState, data: FormData): Promise<CfdiActionState> {
  const kind = field(data, 'kind') as CfdiKind;
  const id = field(data, 'id');
  if (!(kind in CANCELLATION_MOTIVES) || !UUID_PATTERN.test(id)) {
    return { ...EMPTY_CFDI_STATE, error: 'No reconocemos ese comprobante.' };
  }
  const api = await getInvoicingApi();
  if (field(data, 'intent') === 'refresh') {
    const refreshed = await api.refreshCancellation(kind, id);
    refreshScreens();
    return refreshed.ok
      ? { ...EMPTY_CFDI_STATE, done: cancellationLabel(refreshed.data.cancellationStatus) }
      : failure(refreshed, cfdiFailureMessage(refreshed));
  }

  const motive = field(data, 'motive');
  if (!CANCELLATION_MOTIVES[kind].includes(motive)) {
    return { ...EMPTY_CFDI_STATE, error: 'Elige el motivo de la cancelación.' };
  }
  const substitute = field(data, 'substitute');
  if (motive === '01' && !UUID_PATTERN.test(substitute)) {
    return { ...EMPTY_CFDI_STATE, error: 'El motivo 01 necesita el UUID de la factura que la sustituye.' };
  }
  const cancelled = await api.cancel(kind, id, motive, motive === '01' ? substitute : null);
  refreshScreens();
  return cancelled.ok
    ? { ...EMPTY_CFDI_STATE, done: cancellationLabel(cancelled.data.cancellationStatus) }
    : failure(cancelled, cfdiFailureMessage(cancelled));
}

/**
 * Stamps the invoice that replaces another of the same sale (SAT relation 04), the first step of motive 01.
 *
 * Fields: `saleId`, `replacesInvoiceId` and the receiver: `legalName`, `taxId`, `taxRegime`, `cfdiUse`, `zipCode`.
 */
export async function replaceInvoiceAction(_previous: CfdiActionState, data: FormData): Promise<CfdiActionState> {
  const saleId = field(data, 'saleId');
  const replacesInvoiceId = field(data, 'replacesInvoiceId');
  if (!UUID_PATTERN.test(saleId) || !UUID_PATTERN.test(replacesInvoiceId)) {
    return { ...EMPTY_CFDI_STATE, error: 'No reconocemos esa factura.' };
  }
  const receiver = {
    legalName: field(data, 'legalName'),
    taxId: field(data, 'taxId').toUpperCase(),
    taxRegime: field(data, 'taxRegime'),
    cfdiUse: field(data, 'cfdiUse'),
    zipCode: field(data, 'zipCode'),
  };
  if (Object.values(receiver).some((value) => value === '')) {
    return { ...EMPTY_CFDI_STATE, error: 'Llena todos los datos fiscales del cliente.' };
  }
  const api = await getInvoicingApi();
  const issued = await api.replaceInvoice(saleId, replacesInvoiceId, receiver);
  refreshScreens();
  return issued.ok
    ? {
        ...EMPTY_CFDI_STATE,
        done: `Sustituta timbrada con UUID ${issued.data.fiscalUuid ?? '—'}. Ahora cancela la original con motivo 01.`,
      }
    : failure(issued, replaceFailureMessage(issued));
}

/**
 * Stamps the credit note of a return of an invoiced sale. Repeating it after a timeout is safe: one per return.
 *
 * Fields: `returnId`.
 */
export async function creditNoteAction(_previous: CfdiActionState, data: FormData): Promise<CfdiActionState> {
  const returnId = field(data, 'returnId');
  if (!UUID_PATTERN.test(returnId)) {
    return { ...EMPTY_CFDI_STATE, error: 'No reconocemos esa devolución.' };
  }
  const api = await getInvoicingApi();
  const issued = await api.issueCreditNote(returnId);
  refreshScreens();
  return issued.ok
    ? { ...EMPTY_CFDI_STATE, done: `Nota de crédito timbrada con UUID ${issued.data.fiscalUuid ?? '—'}.` }
    : failure(issued, cfdiFailureMessage(issued));
}
