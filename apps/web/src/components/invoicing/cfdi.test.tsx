// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cancellationLabel, cfdiFailureMessage, mayAskToCancel, replaceFailureMessage } from '@/lib/invoicing/messages';
import { EMPTY_CFDI_STATE, type CfdiActionState, type CreditNoteView, type InvoiceRow } from '@/lib/invoicing/types';
import { CancelForm } from './cfdi-forms';
import { CreditNoteLists, InvoiceList } from './invoice-list';

afterEach(cleanup);

type Action = (previous: CfdiActionState, data: FormData) => Promise<CfdiActionState>;

const ORIGINAL: InvoiceRow = {
  id: '01900000-0000-7000-8000-000000000001',
  saleId: '01900000-0000-7000-8000-0000000000aa',
  folio: 101,
  status: 'stamped',
  receiverTaxId: 'ABC010203AB1',
  fiscalUuid: '11111111-1111-4111-8111-111111111111',
  totalCents: 11600,
  replacesInvoiceId: null,
  superseded: false,
  cancellationStatus: null,
  cancellationMotive: null,
  createdAt: '2026-11-20T12:00:00Z',
};

const REPLACEMENT: InvoiceRow = {
  ...ORIGINAL,
  id: '01900000-0000-7000-8000-000000000002',
  fiscalUuid: '22222222-2222-4222-8222-222222222222',
  replacesInvoiceId: ORIGINAL.id,
};

const CANDIDATE: CreditNoteView = {
  returnId: '01900000-0000-7000-8000-0000000000bb',
  saleId: ORIGINAL.saleId,
  folio: 101,
  refundCents: 5800,
  target: 'invoice',
  relatedFiscalUuid: ORIGINAL.fiscalUuid!,
  creditNoteId: null,
  status: null,
  fiscalUuid: null,
  errorCode: null,
};

function failed(problem: Record<string, unknown>, status = 422) {
  return { ok: false as const, status, detail: null, problem };
}

describe('CancelForm', () => {
  it('sends the motive and asks for the substitute only with motive 01', async () => {
    const action = vi.fn<Action>().mockResolvedValue({ ...EMPTY_CFDI_STATE, done: 'Cancelada' });
    render(<CancelForm action={action} kind="invoice" id={ORIGINAL.id} status={null} />);

    expect(screen.queryByLabelText(/UUID de la factura que la sustituye/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Motivo del SAT'), { target: { value: '01' } });
    fireEvent.change(screen.getByLabelText(/UUID de la factura que la sustituye/), {
      target: { value: REPLACEMENT.fiscalUuid },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Pedir la cancelación al SAT' }));

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Cancelada'));
    const sent = action.mock.calls[0]![1];
    expect(sent.get('kind')).toBe('invoice');
    expect(sent.get('motive')).toBe('01');
    expect(sent.get('substitute')).toBe(REPLACEMENT.fiscalUuid);
  });

  it('offers only the motives of a global and starts on 04 when asked', () => {
    render(<CancelForm action={vi.fn<Action>()} kind="global" id="g1" status={null} defaultMotive="04" />);

    const options = Array.from(screen.getByLabelText('Motivo del SAT').querySelectorAll('option')).map((o) => o.value);
    expect(options).toEqual(['02', '03', '04']);
    expect((screen.getByLabelText('Motivo del SAT') as HTMLSelectElement).value).toBe('04');
  });

  it('offers a refresh instead while the receiver has not answered', async () => {
    const action = vi.fn<Action>().mockResolvedValue({ ...EMPTY_CFDI_STATE, error: 'x', providerMessage: 'No existe' });
    render(<CancelForm action={action} kind="invoice" id={ORIGINAL.id} status="pending" />);

    fireEvent.click(screen.getByRole('button', { name: 'Consultar cancelación' }));

    await screen.findByRole('alert');
    expect(action.mock.calls[0]![1].get('intent')).toBe('refresh');
    expect(screen.getByRole('alert').textContent).toContain('Facturapi dice: «No existe»');
  });
});

describe('InvoiceList', () => {
  it('pre-fills the replacement UUID for motive 01 and hides the forms from a manager', () => {
    const { unmount } = render(
      <InvoiceList invoices={[REPLACEMENT, ORIGINAL]} mayCancel cancelAction={vi.fn()} replaceAction={vi.fn()} />,
    );
    expect(screen.getByText(/Ya tiene sustituta: cancélala con motivo 01/)).toBeTruthy();
    expect((screen.getByDisplayValue(REPLACEMENT.fiscalUuid!) as HTMLInputElement).name).toBe('substitute');
    unmount();

    render(<InvoiceList invoices={[ORIGINAL]} mayCancel={false} cancelAction={vi.fn()} replaceAction={vi.fn()} />);
    expect(screen.queryByText('Cancelar')).toBeNull();
    expect(screen.queryByText('Sustituir')).toBeNull();
  });
});

describe('CreditNoteLists', () => {
  it('issues the credit note of a pending return', async () => {
    const action = vi.fn<Action>().mockResolvedValue({ ...EMPTY_CFDI_STATE, done: 'Nota de crédito timbrada' });
    render(<CreditNoteLists candidates={[CANDIDATE]} recent={[]} issueAction={action} />);

    fireEvent.click(screen.getByRole('button', { name: 'Emitir nota de crédito del folio 101' }));

    await screen.findByRole('status');
    expect(action.mock.calls[0]![1].get('returnId')).toBe(CANDIDATE.returnId);
    expect(screen.getByText('Todavía no hay notas de crédito.')).toBeTruthy();
  });
});

describe('cancellation messages', () => {
  it('names each state and knows when a cancellation may be asked', () => {
    expect(cancellationLabel(null)).toBe('Vigente');
    expect(cancellationLabel('pending')).toContain('espera');
    expect(mayAskToCancel(true, 'rejected')).toBe(true);
    expect(mayAskToCancel(true, 'accepted')).toBe(false);
    expect(mayAskToCancel(true, 'pending')).toBe(false);
    expect(mayAskToCancel(false, null)).toBe(false);
  });

  it('turns the codes of the core into sentences', () => {
    expect(cfdiFailureMessage(failed({ code: 'substitute_not_replacement' }))).toContain('Sustituir');
    expect(cfdiFailureMessage(failed({ code: 'not_invoiced' }))).toContain('ya se descontó');
    expect(cfdiFailureMessage(failed({}, 403))).toContain('Solo el dueño');
    expect(replaceFailureMessage(failed({ errors: { taxId: 'x' } }))).toContain('datos fiscales');
    expect(replaceFailureMessage(failed({ code: 'not_replaceable' }))).toContain('vigente');
  });
});
