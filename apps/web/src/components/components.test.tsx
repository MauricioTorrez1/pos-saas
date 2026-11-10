// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CoreStatus } from './core-status';
import { RoleList } from './role-list';

afterEach(cleanup);

describe('RoleList', () => {
  it('shows the Spanish name of each role', () => {
    render(<RoleList roles={['owner', 'storekeeper']} />);

    expect(screen.getByText('Dueño')).toBeTruthy();
    expect(screen.getByText('Almacenista')).toBeTruthy();
  });

  it('explains that no role is assigned', () => {
    render(<RoleList roles={[]} />);

    expect(screen.getByText('Sin rol asignado')).toBeTruthy();
  });
});

describe('CoreStatus', () => {
  it('shows a connected state', () => {
    render(<CoreStatus result={{ status: 'ok', subject: 's', tenantId: 't' }} />);

    expect(screen.getByText('Conectado')).toBeTruthy();
  });

  it('offers to sign in again when the core rejects the token', () => {
    render(<CoreStatus result={{ status: 'unauthorized' }} />);

    const link = screen.getByRole('link', { name: 'Iniciar sesión de nuevo' });
    expect(link.getAttribute('href')).toBe('/auth/login');
  });

  it('explains a missing business', () => {
    render(<CoreStatus result={{ status: 'forbidden' }} />);

    expect(screen.getByText('Sin negocio asignado')).toBeTruthy();
  });

  it('explains an unreachable core without ending the session', () => {
    render(<CoreStatus result={{ status: 'unavailable' }} />);

    expect(screen.getByText(/Tu sesión sigue abierta/)).toBeTruthy();
  });
});
