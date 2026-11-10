import { expect, test, type Page } from '@playwright/test';

const FAKE_URL = 'http://127.0.0.1:4017';

async function control(page: Page, patch: Record<string, unknown>): Promise<void> {
  await page.request.post(`${FAKE_URL}/__control`, { data: patch });
}

async function stats(page: Page): Promise<{ logins: number; refreshes: number; logouts: number; pkceChecks: number }> {
  return (await page.request.get(`${FAKE_URL}/__stats`)).json();
}

async function signIn(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('link', { name: 'Iniciar sesión' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test.beforeEach(async ({ page }) => {
  await control(page, { reset: true });
});

test('a visitor sees the home page and is sent there from a protected route', async ({ page }) => {
  await page.goto('/dashboard');

  await expect(page).toHaveURL(/\/\?error=login_required$/);
  await expect(page.getByRole('heading', { name: 'Tu tienda, a la vista' })).toBeVisible();
  await expect(page.getByText('Inicia sesión para entrar al panel.')).toBeVisible();
});

test('the owner signs in with PKCE and sees the business, the role, and the core answer', async ({ page }) => {
  await signIn(page);

  await expect(page.getByTestId('tenant')).toHaveText('0192f3a4…4a60');
  await expect(page.getByText('Dueño')).toBeVisible();
  await expect(page.getByText('Conectado')).toBeVisible();
  expect((await stats(page)).pkceChecks).toBe(1);
});

test('tokens stay out of reach of scripts', async ({ page }) => {
  await signIn(page);

  const visibleToScripts = await page.evaluate(() => ({
    cookie: document.cookie,
    local: JSON.stringify(localStorage),
    session: JSON.stringify(sessionStorage),
  }));
  expect(visibleToScripts).toEqual({ cookie: '', local: '{}', session: '{}' });
  const cookies = await page.context().cookies();
  expect(cookies.length).toBeGreaterThan(0);
  expect(cookies.every((cookie) => cookie.httpOnly)).toBe(true);
});

test('signing out also closes the session in Keycloak', async ({ page }) => {
  await signIn(page);

  await page.getByRole('button', { name: 'Cerrar sesión' }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('link', { name: 'Iniciar sesión' })).toBeVisible();
  expect((await stats(page)).logouts).toBe(1);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/error=login_required/);
});

test('an expired access token is renewed with the refresh token without asking again', async ({ page }) => {
  await control(page, { loginTtl: 10 }); // inside the renewal margin, so the first page renews
  await signIn(page);

  await page.reload();

  await expect(page.getByText('Conectado')).toBeVisible();
  expect((await stats(page)).refreshes).toBeGreaterThanOrEqual(1);
});

test('when Keycloak refuses the renewal the user is asked to sign in again', async ({ page }) => {
  await control(page, { loginTtl: 10, refresh: 'fail' });

  await page.goto('/');
  await page.getByRole('link', { name: 'Iniciar sesión' }).click();

  await expect(page).toHaveURL(/error=session_expired/);
  await expect(page.getByText('Tu sesión terminó.')).toBeVisible();
});

test('a token the core rejects offers to sign in again', async ({ page }) => {
  await signIn(page);
  await control(page, { coreStatus: 401 });

  await page.reload();

  await expect(page.getByText('Sesión no válida')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Iniciar sesión de nuevo' })).toBeVisible();
});

test('a user without a business can enter but is told so', async ({ page }) => {
  await control(page, { persona: 'notenant' });
  await signIn(page);

  await expect(page.getByText('Sin negocio', { exact: true })).toBeVisible();
  await expect(page.getByText('Sin rol asignado')).toBeVisible();
});

test('a role the route does not allow sees the no-permission page', async ({ page }) => {
  await control(page, { persona: 'cashier' });
  await signIn(page);

  await page.goto('/catalog');

  await expect(page.getByRole('heading', { name: 'No tienes permiso para ver esto' })).toBeVisible();
});

test('the owner is allowed on the catalog route (it does not exist yet, so 404)', async ({ page }) => {
  await signIn(page);

  const response = await page.goto('/catalog');

  expect(response?.status()).toBe(404);
});
