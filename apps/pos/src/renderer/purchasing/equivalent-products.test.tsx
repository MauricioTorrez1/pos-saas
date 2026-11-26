import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { EquivalenceApi, EquivalenceItem, EquivalenceProposal } from '../../shared/catalog-equivalence';
import { EquivalentProducts } from './EquivalentProducts';

const HSS: EquivalenceItem = {
  itemId: '019a5f2e-7c40-7b1a-9d2e-eeeeeeeeeee1',
  supplierId: '019a5f2e-7c40-7b1a-9d2e-aaaaaaaaaaa1',
  supplierName: 'Ferretera del Centro',
  supplierCode: 'B-14',
  description: 'BROCAS HSS 1/4" P/METAL',
  purchaseUnit: null,
  piecesPerUnitMilli: 1000,
  baseUnitCostE6: 30_000_000,
  productName: null,
};
const HIGH_SPEED: EquivalenceItem = {
  ...HSS,
  itemId: '019a5f2e-7c40-7b1a-9d2e-eeeeeeeeeee2',
  supplierId: '019a5f2e-7c40-7b1a-9d2e-aaaaaaaaaaa2',
  supplierName: 'Eléctrica del Norte',
  supplierCode: 'AV-635',
  description: 'Broca de alta velocidad 6.35 mm',
  baseUnitCostE6: 26_000_000,
};
const PROPOSAL: EquivalenceProposal = {
  items: [HSS, HIGH_SPEED],
  score: 86,
  confidence: 'high',
  origin: 'rules',
  reason: 'Comparten broca, hss; tienen la misma medida; se escribió distinto: hss.',
  groupId: null,
  groupName: null,
  suggestedName: 'BROCAS HSS 1/4" P/METAL',
};

function fakeApi(overrides: Partial<EquivalenceApi> = {}): EquivalenceApi {
  return {
    proposeEquivalences: vi.fn().mockResolvedValue({ proposals: [PROPOSAL], examinedCount: 6 }),
    askAiForEquivalences: vi.fn().mockResolvedValue({ status: 'proposed', proposals: [], sentCount: 2 }),
    aiAvailable: vi.fn().mockResolvedValue(false),
    approveEquivalence: vi.fn().mockResolvedValue({ status: 'approved', group: { id: 'g', name: 'Broca HSS 1/4"', items: [HSS, HIGH_SPEED], cheapestItemId: HIGH_SPEED.itemId } }),
    rejectEquivalence: vi.fn().mockResolvedValue({ status: 'rejected' }),
    listEquivalenceGroups: vi.fn().mockResolvedValue([]),
    removeFromEquivalence: vi.fn().mockResolvedValue({ status: 'removed' }),
    listSynonyms: vi.fn().mockResolvedValue([]),
    addSynonym: vi.fn().mockResolvedValue({ status: 'added' }),
    removeSynonym: vi.fn().mockResolvedValue({ status: 'removed' }),
    ...overrides,
  };
}

afterEach(cleanup);

describe('the screen of equivalent products (E1-63)', () => {
  it('shows a proposal with its reason and cheapest item, and approves it with the name the owner typed', async () => {
    const api = fakeApi();
    render(<EquivalentProducts api={api} onBack={() => undefined} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar en las listas' }), { target: { value: 'broca' } });
    fireEvent.click(screen.getByRole('button', { name: /Buscar equivalentes/ }));
    expect(await screen.findByRole('heading', { name: '1. Muy probable (86 de 100)' })).toBeTruthy();
    expect(screen.getByText(/se escribió distinto: hss/u)).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Artículos de la propuesta 1' }).querySelector('tr.price-cheapest')?.textContent).toContain('Eléctrica del Norte');
    expect(screen.queryByRole('button', { name: /Pedir ayuda a la IA/ })).toBeNull();

    fireEvent.change(screen.getByRole('textbox', { name: 'Nombre del grupo 1' }), { target: { value: 'Broca HSS 1/4"' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aprobar propuesta 1' }));
    await screen.findByText(/«Broca HSS 1\/4"» ya se compara junto/u);
    expect(api.approveEquivalence).toHaveBeenCalledWith({
      itemIds: [HSS.itemId, HIGH_SPEED.itemId],
      groupId: null,
      name: 'Broca HSS 1/4"',
      origin: 'rules',
      score: 86,
      reason: PROPOSAL.reason,
    });
    expect(screen.queryByRole('region', { name: 'Propuesta 1' })).toBeNull();
  });

  it('approves an edited proposal as the owner\'s and explains a refusal', async () => {
    const api = fakeApi({ approveEquivalence: vi.fn().mockResolvedValue({ status: 'too_few' }) });
    render(<EquivalentProducts api={api} onBack={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /Buscar equivalentes/ }));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Incluir B-14' }));
    fireEvent.click(screen.getByRole('button', { name: 'Aprobar propuesta 1' }));
    await screen.findByText('Deja al menos dos artículos de proveedores distintos.');
    expect(api.approveEquivalence).toHaveBeenCalledWith(expect.objectContaining({ itemIds: [HIGH_SPEED.itemId], origin: 'manual' }));
  });

  it('rejects a proposal so it is not shown again', async () => {
    const api = fakeApi();
    render(<EquivalentProducts api={api} onBack={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /Buscar equivalentes/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'No son iguales' }));
    await screen.findByText(/no te los volveré a proponer/u);
    expect(api.rejectEquivalence).toHaveBeenCalledWith([HSS.itemId, HIGH_SPEED.itemId]);
  });

  it('offers the AI only when configured and shows what it proposed', async () => {
    const api = fakeApi({
      aiAvailable: vi.fn().mockResolvedValue(true),
      askAiForEquivalences: vi.fn().mockResolvedValue({ status: 'proposed', proposals: [{ ...PROPOSAL, origin: 'ai', score: null, confidence: 'medium', reason: 'Son la misma broca.' }], sentCount: 12 }),
    });
    render(<EquivalentProducts api={api} onBack={() => undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: /Pedir ayuda a la IA/ }));
    expect(await screen.findByRole('heading', { name: '1. Propuesta de la IA' })).toBeTruthy();
    expect(screen.getByText(/La IA revisó 12 artículos/u)).toBeTruthy();
  });

  it('says why the AI could not help', async () => {
    const api = fakeApi({ aiAvailable: vi.fn().mockResolvedValue(true), askAiForEquivalences: vi.fn().mockResolvedValue({ status: 'failed', message: 'No hay conexión con el servicio de analítica.' }) });
    render(<EquivalentProducts api={api} onBack={() => undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: /Pedir ayuda a la IA/ }));
    await screen.findByText('No hay conexión con el servicio de analítica.');
  });

  it('adds and removes words of the dictionary', async () => {
    const listSynonyms = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ term: 'chalupa', canonical: 'caja de registro' }]).mockResolvedValue([]);
    const api = fakeApi({ listSynonyms });
    render(<EquivalentProducts api={api} onBack={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /Sinónimos/ }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Palabra' }), { target: { value: 'Chalupa' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Significa' }), { target: { value: 'Caja de registro' } });
    fireEvent.click(screen.getByRole('button', { name: 'Agregar palabra' }));
    await screen.findByText('«chalupa» = «caja de registro»', { exact: false });
    expect(api.addSynonym).toHaveBeenCalledWith({ term: 'Chalupa', canonical: 'Caja de registro' });
    fireEvent.click(screen.getByRole('button', { name: 'Quitar chalupa' }));
    await waitFor(() => expect(api.removeSynonym).toHaveBeenCalledWith('chalupa'));
  });

  it('lists the approved groups and takes an item out', async () => {
    const group = { id: 'g', name: 'Broca HSS 1/4"', items: [HSS, HIGH_SPEED], cheapestItemId: HIGH_SPEED.itemId };
    const api = fakeApi({ listEquivalenceGroups: vi.fn().mockResolvedValue([group]) });
    render(<EquivalentProducts api={api} onBack={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /Grupos aprobados/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Quitar B-14' }));
    await waitFor(() => expect(api.removeFromEquivalence).toHaveBeenCalledWith({ groupId: 'g', itemId: HSS.itemId }));
  });
});
