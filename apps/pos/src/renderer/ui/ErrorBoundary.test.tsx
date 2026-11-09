import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ErrorBoundary } from './ErrorBoundary';

afterEach(cleanup);

function Broken(): never {
  throw new Error('drawing failed');
}

describe('ErrorBoundary', () => {
  it('shows what is inside while nothing fails', () => {
    render(
      <ErrorBoundary>
        <p>Caja</p>
      </ErrorBoundary>,
    );

    expect(screen.getByText('Caja')).toBeDefined();
  });

  it('says what happened, instead of leaving a blank window, when the screen fails', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <ErrorBoundary>
        <Broken />
      </ErrorBoundary>,
    );

    expect(screen.getByRole('heading', { name: 'Algo falló en la pantalla' })).toBeDefined();
    expect(screen.getByText(/Tus ventas están guardadas/)).toBeDefined();
    expect(consoleError).toHaveBeenCalledWith('The register screen failed', expect.any(Error), expect.any(String));
    consoleError.mockRestore();
  });
});
