/**
 * The catalog endpoints of the core, in memory, for the Playwright tests. It follows the contracts of
 * `ProductsController` and `CatalogToolsController` closely enough for the screens: pages of a search, idempotent
 * creation, duplicate codes, the price only for the owner, the CSV import with a dry run, and the bulk price change
 * with its 409 when the preview is stale. Amounts are integers in ten-thousandths (`bigint`), never floats.
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

interface StoredProduct {
  id: string;
  name: string;
  status: string;
  unit: string;
  codes: { code: string; kind: string }[];
  presentations: { name: string; baseQuantity: string }[];
  priceE4: bigint;
  taxFactor: string;
  taxRateBp: number;
  satProductKey: string | null;
  satUnitKey: string | null;
  updatedAt: string;
}

/** What the fake core needs from the server around it. */
export interface CoreContext {
  /** Role of the caller, or `null` when the token is not valid. */
  role: string | null;
  send: (status: number, body?: unknown) => void;
  readBody: () => Promise<string>;
}

const products = new Map<string, StoredProduct>();
const idempotencyKeys = new Map<string, string>();

/** Forgets every product. */
export function resetCatalog(): void {
  products.clear();
  idempotencyKeys.clear();
}

/**
 * Adds products straight to the store, for tests that need a large catalog or a catalog that moves.
 *
 * @param count - How many.
 * @param prefix - Start of their names; they get a number after it.
 * @param price - Their price, as text with up to 4 decimals.
 */
export function seedProducts(count: number, prefix: string, price: string): void {
  for (let index = 1; index <= count; index += 1) {
    const id = randomUUID();
    products.set(id, {
      id,
      name: `${prefix} ${String(index).padStart(4, '0')}`,
      status: 'active',
      unit: 'piece',
      codes: [{ code: `${prefix.replace(/\W/g, '').toUpperCase()}${index}`, kind: 'barcode' }],
      presentations: [],
      priceE4: priceE4(price) ?? 0n,
      taxFactor: 'rate',
      taxRateBp: 1600,
      satProductKey: null,
      satUnitKey: null,
      updatedAt: new Date().toISOString(),
    });
  }
}

function priceE4(text: string): bigint | null {
  const match = /^(\d+)(?:\.(\d{1,4}))?$/.exec(text.trim());
  return match ? BigInt(match[1] ?? '0') * 10_000n + BigInt((match[2] ?? '').padEnd(4, '0')) : null;
}

function priceText(e4: bigint): string {
  return `${e4 / 10_000n}.${String(e4 % 10_000n).padStart(4, '0')}`;
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

function view(product: StoredProduct) {
  return {
    id: product.id,
    name: product.name,
    status: product.status,
    unit: product.unit,
    unitKind: product.unit === 'piece' ? 'count' : 'length',
    codes: product.codes,
    presentations: product.presentations,
    unitPrice: priceText(product.priceE4),
    taxFactor: product.taxFactor,
    taxRateBp: product.taxRateBp,
    satProductKey: product.satProductKey,
    satUnitKey: product.satUnitKey,
    invoiceable: Boolean(product.satProductKey && product.satUnitKey),
    createdAt: product.updatedAt,
    updatedAt: product.updatedAt,
  };
}

function byName(): StoredProduct[] {
  return [...products.values()].sort((a, b) => a.name.localeCompare(b.name, 'es'));
}

function matches(product: StoredProduct, query: string): boolean {
  return product.codes.some((code) => code.code === query) || fold(query).split(/\s+/).every((word) => fold(product.name).includes(word));
}

function codeOwner(code: string, except?: string): StoredProduct | undefined {
  return [...products.values()].find((product) => product.id !== except && product.codes.some((candidate) => candidate.code === code));
}

interface ProductBody {
  name?: string;
  unit?: string;
  status?: string;
  codes?: { code: string; kind?: string }[];
  presentations?: { name: string; baseQuantity: string }[];
  unitPrice?: string;
  taxFactor?: string;
  taxRateBp?: number;
  satProductKey?: string;
  satUnitKey?: string;
}

/** Applies a create or patch body; returns a problem to send, or nothing when it worked. */
function applyBody(target: StoredProduct, body: ProductBody): { status: number; body: unknown } | null {
  if (body.name !== undefined) {
    if (!body.name.trim()) {
      return { status: 400, body: { detail: 'name is required' } };
    }
    target.name = body.name.trim();
  }
  if (body.unit !== undefined) {
    if (!['piece', 'meter', 'kilogram', 'liter'].includes(body.unit)) {
      return { status: 400, body: { detail: 'unit must be piece, meter, kilogram or liter' } };
    }
    target.unit = body.unit;
  }
  if (body.codes !== undefined) {
    const taken = body.codes.find((code) => codeOwner(code.code, target.id));
    if (taken) {
      return { status: 409, body: { detail: `the code ${taken.code} belongs to another product`, code: taken.code } };
    }
    target.codes = body.codes.map((code) => ({ code: code.code, kind: code.kind ?? 'barcode' }));
  }
  if (body.presentations !== undefined) target.presentations = body.presentations;
  if (body.status !== undefined) target.status = body.status;
  if (body.taxFactor !== undefined) target.taxFactor = body.taxFactor;
  if (body.taxRateBp !== undefined) target.taxRateBp = body.taxRateBp;
  if (body.satProductKey !== undefined) target.satProductKey = body.satProductKey || null;
  if (body.satUnitKey !== undefined) target.satUnitKey = body.satUnitKey || null;
  target.updatedAt = new Date().toISOString();
  return null;
}

function blank(): StoredProduct {
  return {
    id: randomUUID(),
    name: '',
    status: 'active',
    unit: 'piece',
    codes: [],
    presentations: [],
    priceE4: 0n,
    taxFactor: 'rate',
    taxRateBp: 1600,
    satProductKey: null,
    satUnitKey: null,
    updatedAt: new Date().toISOString(),
  };
}

async function createProduct(request: IncomingMessage, context: CoreContext): Promise<void> {
  const key = String(request.headers['idempotency-key'] ?? '');
  if (!key) {
    return context.send(400, { detail: 'the Idempotency-Key header is required' });
  }
  const known = idempotencyKeys.get(key);
  if (known && products.has(known)) {
    return context.send(200, view(products.get(known)!));
  }
  const body = JSON.parse(await context.readBody()) as ProductBody;
  if (body.unitPrice !== undefined && context.role !== 'owner') {
    return context.send(403, { detail: 'Only the owner sets a price' });
  }
  const product = blank();
  const problem = applyBody(product, { ...body, name: body.name ?? '' });
  if (problem) {
    return context.send(problem.status, problem.body);
  }
  if (body.unitPrice !== undefined) {
    product.priceE4 = priceE4(body.unitPrice) ?? 0n;
  }
  products.set(product.id, product);
  idempotencyKeys.set(key, product.id);
  return context.send(201, view(product));
}

function parseCsv(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => line.split(',').map((cell) => cell.trim()));
}

async function importCatalog(url: URL, context: CoreContext): Promise<void> {
  const rows = parseCsv(await context.readBody());
  const titles = (rows[0] ?? []).map(fold);
  const column = (names: string[]) => titles.findIndex((title) => names.includes(title));
  const code = column(['codigo del producto', 'codigo']);
  const name = column(['nombre del producto', 'descripcion', 'nombre']);
  const price = column(['precio de venta', 'precio']);
  if (code < 0 || name < 0 || price < 0) {
    return context.send(400, { detail: 'Faltan columnas en la primera fila. Escribe los títulos así: Código del producto, Nombre del producto, Precio de venta.' });
  }
  const dryRun = url.searchParams.get('dryRun') === 'true';
  const maySetPrices = context.role === 'owner';
  const report = { rowsRead: rows.length - 1, created: 0, alreadyThere: 0, pricesSkipped: 0, invalid: [] as { line: number; reason: string }[], ignoredColumns: [] as string[], dryRun };
  rows.slice(1).forEach((row, index) => {
    const line = index + 2;
    const parsedPrice = priceE4((row[price] ?? '').replace(/[$,\s]/g, ''));
    if (!row[code]) {
      report.invalid.push({ line, reason: 'El código está vacío.' });
    } else if (parsedPrice === null || parsedPrice === 0n) {
      report.invalid.push({ line, reason: 'El precio de venta debe ser mayor que cero.' });
    } else if (codeOwner(row[code])) {
      report.alreadyThere += 1;
    } else {
      report.created += 1;
      if (!maySetPrices) report.pricesSkipped += 1;
      if (!dryRun) {
        const product = blank();
        product.name = row[name] ?? '';
        product.codes = [{ code: row[code], kind: 'barcode' }];
        product.priceE4 = maySetPrices ? parsedPrice : 0n;
        products.set(product.id, product);
      }
    }
  });
  return context.send(200, report);
}

const STEPS: Record<string, bigint> = { cent: 100n, half_peso: 5_000n, peso: 10_000n };

async function changePrices(context: CoreContext): Promise<void> {
  if (context.role !== 'owner') {
    return context.send(403);
  }
  const body = JSON.parse(await context.readBody()) as { search?: string; percent: string; rounding?: string; preview?: boolean; expectedCount?: number };
  const [whole = '0', fraction = ''] = body.percent.replace('-', '').split('.');
  const hundredths = (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))) * (body.percent.startsWith('-') ? -1n : 1n);
  const step = STEPS[body.rounding ?? 'cent'] ?? 100n;
  const chosen = byName().filter((product) => product.priceE4 > 0n && (!body.search || matches(product, body.search)));
  const lines = chosen.map((product) => {
    const raw = (product.priceE4 * (10_000n + hundredths)) / 10_000n;
    const rounded = ((raw + step / 2n) / step) * step;
    return { product, newE4: rounded };
  });
  if (!body.preview) {
    if (body.expectedCount !== lines.length) {
      return context.send(409, { detail: 'The catalog changed since the preview', expectedCount: body.expectedCount, actualCount: lines.length });
    }
    lines.forEach(({ product, newE4 }) => {
      product.priceE4 = newE4;
    });
  }
  return context.send(200, {
    applied: !body.preview,
    count: lines.length,
    lines: lines.slice(0, 500).map(({ product, newE4 }) => ({ productId: product.id, name: product.name, currentPrice: priceText(product.priceE4), newPrice: priceText(newE4) })),
  });
}

/**
 * Answers a request if it belongs to the catalog.
 *
 * @returns `true` when it handled the request.
 */
export async function handleCatalog(request: IncomingMessage, url: URL, context: CoreContext): Promise<boolean> {
  const isCatalog = url.pathname === '/products' || url.pathname.startsWith('/products/') || url.pathname === '/imports/catalog' || url.pathname === '/price-changes';
  if (!isCatalog) {
    return false;
  }
  if (context.role === null) {
    context.send(401);
    return true;
  }
  const writes = request.method !== 'GET';
  if (writes && context.role === 'cashier') {
    context.send(403);
    return true;
  }
  const [, , id, sub] = url.pathname.split('/');
  if (url.pathname === '/products' && request.method === 'GET') {
    const query = url.searchParams.get('q')?.trim() ?? '';
    const page = Number(url.searchParams.get('page') ?? 0);
    const size = Math.min(100, Number(url.searchParams.get('size') ?? 20));
    const found = byName().filter((product) => !query || matches(product, query));
    context.send(200, { items: found.slice(page * size, page * size + size).map(view), page, size, total: found.length });
  } else if (url.pathname === '/products' && request.method === 'POST') {
    await createProduct(request, context);
  } else if (url.pathname === '/imports/catalog' && request.method === 'POST') {
    await importCatalog(url, context);
  } else if (url.pathname === '/price-changes' && request.method === 'POST') {
    await changePrices(context);
  } else {
    const product = products.get(id ?? '');
    if (!product) {
      context.send(404, { detail: 'The product does not exist' });
    } else if (sub === 'price' && request.method === 'PATCH') {
      if (context.role !== 'owner') {
        context.send(403);
      } else {
        product.priceE4 = priceE4((JSON.parse(await context.readBody()) as { unitPrice: string }).unitPrice) ?? product.priceE4;
        context.send(200, view(product));
      }
    } else if (request.method === 'GET') {
      context.send(200, view(product));
    } else if (request.method === 'PATCH') {
      const changes = { ...product, codes: [...product.codes] };
      const problem = applyBody(changes, JSON.parse(await context.readBody()) as ProductBody);
      if (problem) {
        context.send(problem.status, problem.body);
      } else {
        products.set(product.id, changes);
        context.send(200, view(changes));
      }
    } else if (request.method === 'DELETE') {
      products.delete(product.id);
      context.send(204);
    } else {
      context.send(405);
    }
  }
  return true;
}
