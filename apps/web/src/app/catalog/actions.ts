'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  EMPTY_PRODUCT_FORM,
  type ImportState,
  type PriceChangeState,
  type PriceFormState,
  type ProductFormState,
} from '@/lib/catalog/action-state';
import { failureMessage, type CoreResult } from '@/lib/catalog/core-api';
import { isZeroAmount, parseDecimalInput, parsePercentInput } from '@/lib/catalog/decimal-text';
import { parseProductForm, productFormFromData } from '@/lib/catalog/product-form';
import { ROUNDINGS, type PriceChangeRequest, type Product, type Rounding } from '@/lib/catalog/types';
import { getCoreApi } from '@/lib/server';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The core refuses files above 8 million characters; the panel says so before sending them. */
const MAX_CSV_CHARACTERS = 8_000_000;

function field(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === 'string' ? value : '';
}

/** Turns a failed save of a product into the state of the form, with a duplicate code next to its field. */
function productFailure(result: Extract<CoreResult<Product>, { ok: false }>): ProductFormState {
  if (result.status === 409 && typeof result.problem.code === 'string') {
    return {
      ...EMPTY_PRODUCT_FORM,
      errors: { codes: `El código ${result.problem.code} ya es de otro producto.` },
    };
  }
  if (result.status === 403) {
    return { ...EMPTY_PRODUCT_FORM, message: 'Tu rol no permite guardar esto. Solo el dueño pone precios.' };
  }
  return { ...EMPTY_PRODUCT_FORM, message: failureMessage(result, 'El sistema central no aceptó los datos.') };
}

/**
 * Creates a product from the form of `/catalog/new` and opens it.
 *
 * The page renders a UUIDv7 into the form as the idempotency key, so a double click or a retry after a lost answer
 * gets the same product instead of a copy.
 */
export async function createProductAction(_previous: ProductFormState, data: FormData): Promise<ProductFormState> {
  const idempotencyKey = field(data, 'idempotencyKey');
  if (!UUID_PATTERN.test(idempotencyKey)) {
    return { ...EMPTY_PRODUCT_FORM, message: 'Recarga la página y vuelve a intentarlo.' };
  }
  const parsed = parseProductForm(productFormFromData(data, data.has('unitPrice')));
  if (!parsed.ok) {
    return { ...EMPTY_PRODUCT_FORM, errors: parsed.errors };
  }
  const api = await getCoreApi();
  const result = await api.createProduct(idempotencyKey, parsed.request);
  if (!result.ok) {
    return productFailure(result);
  }
  revalidatePath('/catalog');
  redirect(`/catalog/${result.data.id}?created=1`);
}

/**
 * Saves the changes of the edit form and reloads the page. Every field is sent, so the product ends up exactly as
 * the form shows it; the price is not here (it has its own form and permission).
 *
 * @param productId - The product being edited, bound by the page.
 */
export async function updateProductAction(
  productId: string,
  _previous: ProductFormState,
  data: FormData,
): Promise<ProductFormState> {
  const parsed = parseProductForm(productFormFromData(data, false));
  if (!parsed.ok) {
    return { ...EMPTY_PRODUCT_FORM, errors: parsed.errors };
  }
  const api = await getCoreApi();
  const result = await api.updateProduct(productId, parsed.request);
  if (!result.ok) {
    return productFailure(result);
  }
  revalidatePath('/catalog');
  // A redirect, not a state: the page renders the saved product and a fresh form, and the notice comes from the URL.
  redirect(`/catalog/${productId}?saved=1`);
}

/**
 * Changes the price of one product. The core lets only the owner do it and audits the old and the new price.
 *
 * @param productId - The product, bound by the page.
 */
export async function changePriceAction(
  productId: string,
  _previous: PriceFormState,
  data: FormData,
): Promise<PriceFormState> {
  const price = parseDecimalInput(field(data, 'unitPrice'), 4);
  if (price === null || isZeroAmount(price)) {
    return { error: 'Escribe un precio mayor que cero, con hasta 4 decimales.', savedPrice: null };
  }
  const api = await getCoreApi();
  const result = await api.changePrice(productId, price);
  if (!result.ok) {
    return { error: failureMessage(result, 'El sistema central no aceptó el precio.'), savedPrice: null };
  }
  revalidatePath('/catalog');
  revalidatePath(`/catalog/${productId}`);
  return { error: null, savedPrice: result.data.unitPrice };
}

/**
 * Deletes a product logically and goes back to the list. The registers stop selling it after their next sync.
 *
 * @param productId - The product, bound by the page.
 */
export async function deleteProductAction(productId: string): Promise<{ error: string | null }> {
  const api = await getCoreApi();
  const result = await api.deleteProduct(productId);
  if (!result.ok) {
    return { error: failureMessage(result, 'No se pudo dar de baja.') };
  }
  revalidatePath('/catalog');
  redirect('/catalog?deleted=1');
}

/**
 * Checks or loads a CSV file with `POST /imports/catalog`. The screen first sends `dryRun=true` and shows the
 * report; only when the owner confirms does it send the same text again to load it.
 */
export async function importCatalogAction(_previous: ImportState, data: FormData): Promise<ImportState> {
  const csv = field(data, 'csv');
  if (!csv.trim()) {
    return { report: null, error: 'Elige un archivo CSV con tus productos.' };
  }
  if (csv.length > MAX_CSV_CHARACTERS) {
    return { report: null, error: 'El archivo es demasiado grande. Divídelo en partes de menos de 8 MB.' };
  }
  const dryRun = field(data, 'mode') !== 'load';
  const api = await getCoreApi();
  const result = await api.importCatalog(csv, dryRun);
  if (!result.ok) {
    // A 400 here is a file that cannot be read at all; the core explains why in Spanish.
    const message = result.status === 400 && result.detail ? result.detail : failureMessage(result, 'No se pudo leer el archivo.');
    return { report: null, error: message };
  }
  if (!dryRun) {
    revalidatePath('/catalog');
  }
  return { report: result.data, error: null };
}

function readPriceChange(data: FormData): PriceChangeRequest | string {
  const percent = parsePercentInput(field(data, 'percent'));
  if (percent === null) {
    return 'Escribe un porcentaje distinto de cero con hasta 2 decimales, por ejemplo 5 o -2.5.';
  }
  const rounding = field(data, 'rounding');
  if (!(ROUNDINGS as readonly string[]).includes(rounding)) {
    return 'Elige cómo redondear los precios.';
  }
  return { search: field(data, 'search').trim(), percent, rounding: rounding as Rounding };
}

/**
 * Shows or applies a bulk price change (`POST /price-changes`).
 *
 * `intent=preview` asks what would change. `intent=apply` sends the request of that preview with the count it
 * showed; if the catalog moved in between, the core answers 409 and the screen shows a fresh preview to confirm.
 */
export async function priceChangeAction(previous: PriceChangeState, data: FormData): Promise<PriceChangeState> {
  const api = await getCoreApi();
  if (field(data, 'intent') === 'apply') {
    if (!previous.preview) {
      return { ...previous, error: 'Primero revisa la vista previa.' };
    }
    const { request, result: shown } = previous.preview;
    const applied = await api.applyPriceChange(request, shown.count);
    if (applied.ok) {
      revalidatePath('/catalog');
      return { preview: null, appliedCount: applied.data.count, error: null, staleNotice: null };
    }
    if (applied.status === 409) {
      const fresh = await api.previewPriceChange(request);
      if (fresh.ok) {
        return {
          preview: { request, result: fresh.data },
          appliedCount: null,
          error: null,
          staleNotice: `El catálogo cambió mientras revisabas: antes eran ${shown.count} productos y ahora son ${fresh.data.count}. No se cambió ningún precio. Revisa la nueva vista previa y confirma otra vez.`,
        };
      }
    }
    return { ...previous, error: failureMessage(applied, 'No se aplicó el cambio.'), staleNotice: null };
  }

  const request = readPriceChange(data);
  if (typeof request === 'string') {
    return { preview: null, appliedCount: null, error: request, staleNotice: null };
  }
  const result = await api.previewPriceChange(request);
  if (!result.ok) {
    return { preview: null, appliedCount: null, error: failureMessage(result, 'No se pudo calcular la vista previa.'), staleNotice: null };
  }
  return { preview: { request, result: result.data }, appliedCount: null, error: null, staleNotice: null };
}
