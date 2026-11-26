import type { PanelConfig } from '../config';
import type { ProposedRow } from './rows';

/** What the review screen gets back for one photo or PDF. */
export type PageReadResult =
  | { status: 'ok'; rows: ProposedRow[]; vatStatement: string }
  | { status: 'error'; httpStatus: number; message: string };

const READ_TIMEOUT_MS = 180_000;

const MESSAGES: Record<string, string> = {
  photo_type: 'Solo se aceptan fotos JPEG o PNG, o un PDF de pocas hojas.',
  photo_too_large: 'La foto pesa más de 5 MB. Tómala de nuevo o recórtala.',
  pdf_too_large: 'El PDF pesa más de 20 MB. Mándalo por partes.',
  pdf_too_many_pages: 'El PDF tiene más de 4 hojas. Mándalo por partes de hasta 4 hojas.',
  model_refused: 'No se pudo leer esta hoja. Revísala a mano.',
  page_too_long: 'La hoja tiene demasiadas líneas. Toma la foto por mitades.',
  malformed_answer: 'La lectura salió incompleta. Intenta de nuevo.',
  reader_busy: 'El lector está ocupado. Intenta de nuevo en un minuto.',
  reader_not_configured: 'Falta configurar la llave de la API de Claude en el servicio de analítica.',
  owner_only: 'Solo el dueño puede leer catálogos en papel.',
};

const GENERIC = 'El lector de catálogos no responde. Intenta de nuevo en un momento.';

/**
 * Sends one photo or PDF to the analytics service with the token of the session. Server-side only: the token never reaches
 * the browser and the photo is not stored on the way.
 *
 * @param config - Panel settings; `analyticsApiUrl` must be set.
 * @param accessToken - Access token of the owner's session.
 * @param photo - The image or PDF bytes.
 * @param mediaType - `image/jpeg`, `image/png` or `application/pdf`.
 * @param fetcher - HTTP client; tests pass a fake.
 */
export async function readCatalogPage(
  config: PanelConfig,
  accessToken: string,
  photo: ArrayBuffer,
  mediaType: string,
  fetcher: typeof fetch = fetch,
): Promise<PageReadResult> {
  if (!config.analyticsApiUrl) {
    return { status: 'error', httpStatus: 503, message: 'El lector de catálogos no está configurado.' };
  }
  try {
    const response = await fetcher(new URL('/catalog-pages/read', config.analyticsApiUrl), {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': mediaType, Accept: 'application/json' },
      body: photo,
      cache: 'no-store',
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
    const body = (await response.json().catch(() => null)) as
      | { rows?: ProposedRow[]; vat_statement?: string; detail?: string }
      | null;
    if (!response.ok) {
      const detail = typeof body?.detail === 'string' ? body.detail : '';
      return { status: 'error', httpStatus: response.status, message: MESSAGES[detail] ?? GENERIC };
    }
    if (!Array.isArray(body?.rows)) {
      return { status: 'error', httpStatus: 502, message: GENERIC };
    }
    return { status: 'ok', rows: body.rows, vatStatement: body.vat_statement ?? 'not_stated' };
  } catch {
    return { status: 'error', httpStatus: 503, message: GENERIC };
  }
}
