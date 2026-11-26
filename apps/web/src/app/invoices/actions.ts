'use server';

import { revalidatePath } from 'next/cache';
import { globalFailureMessage } from '@/lib/invoicing/messages';
import { EMPTY_GLOBAL_STATE, PERIODICITIES, type GlobalInvoiceState, type Periodicity } from '@/lib/invoicing/types';
import { getInvoicingApi } from '@/lib/server';

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function field(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Shows or stamps the global invoice of a period (ADR 0077).
 *
 * `intent=preview` asks the core which sales the period holds. `intent=issue` stamps the period of that preview and
 * sends the count it showed; if the sales moved in between, the core answers 409, nothing is stamped and a fresh
 * preview appears.
 */
export async function globalInvoiceAction(previous: GlobalInvoiceState, data: FormData): Promise<GlobalInvoiceState> {
  const api = await getInvoicingApi();
  if (field(data, 'intent') === 'issue') {
    if (!previous.preview) {
      return { ...previous, error: 'Primero revisa la vista previa.' };
    }
    const { request, result: shown } = previous.preview;
    const issued = await api.issueGlobal(request, shown.saleCount);
    if (issued.ok) {
      revalidatePath('/invoices/global');
      return { ...EMPTY_GLOBAL_STATE, issued: issued.data };
    }
    const providerMessage = typeof issued.problem.providerMessage === 'string' ? issued.problem.providerMessage : null;
    const fresh = issued.status === 409 || issued.status === 422 ? await api.previewGlobal(request) : null;
    revalidatePath('/invoices/global');
    return {
      preview: fresh?.ok ? { request, result: fresh.data } : previous.preview,
      issued: null,
      error: globalFailureMessage(issued),
      providerMessage,
    };
  }

  const periodicity = field(data, 'periodicity');
  const day = field(data, 'day');
  if (!(PERIODICITIES as readonly string[]).includes(periodicity) || !DAY_PATTERN.test(day)) {
    return { ...EMPTY_GLOBAL_STATE, error: 'Elige la periodicidad y un día del periodo.' };
  }
  const request = { periodicity: periodicity as Periodicity, day };
  const result = await api.previewGlobal(request);
  if (!result.ok) {
    return { ...EMPTY_GLOBAL_STATE, error: globalFailureMessage(result) };
  }
  return { ...EMPTY_GLOBAL_STATE, preview: { request, result: result.data } };
}
