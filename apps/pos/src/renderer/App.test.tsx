import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { PosApi } from '../shared/pos-api';
import { App } from './App';

afterEach(cleanup);

describe('App', () => {
  it('shows the version that the bridge reports', async () => {
    const posApi: PosApi = { getAppInfo: () => Promise.resolve({ version: '1.2.3' }) };

    render(<App posApi={posApi} />);

    expect(await screen.findByText('Versión 1.2.3')).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('warns the cashier when the bridge fails', async () => {
    const posApi: PosApi = { getAppInfo: () => Promise.reject(new Error('channel closed')) };

    render(<App posApi={posApi} />);

    expect((await screen.findByRole('alert')).textContent).toContain('No se pudo leer la versión');
    expect(screen.queryByText(/^Versión/)).toBeNull();
  });
});
