import { NextResponse, type NextRequest } from 'next/server';
import { readCatalogPage } from '@/lib/paper-catalog/analytics-client';
import { getConfig, getSession } from '@/lib/server';

export const dynamic = 'force-dynamic';

const PAGE_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf']);

/**
 * Reads one catalog photo or a short scanned PDF. The browser posts the file here and this handler forwards it to the analytics service with
 * the session token, so the token never reaches the browser. The proxy already let in only the owner; a request from
 * another origin is refused so no other site can spend the owner's API credit.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const config = getConfig();
  if (request.headers.get('origin') !== config.baseUrl.origin) {
    return NextResponse.json({ message: 'Origen no permitido.' }, { status: 403 });
  }
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ message: 'Tu sesión terminó. Vuelve a entrar.' }, { status: 401 });
  }
  const mediaType = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!PAGE_TYPES.has(mediaType)) {
    return NextResponse.json({ message: 'Solo se aceptan fotos JPEG o PNG, o un PDF de pocas hojas.' }, { status: 415 });
  }
  const result = await readCatalogPage(config, session.accessToken, await request.arrayBuffer(), mediaType);
  if (result.status === 'error') {
    return NextResponse.json({ message: result.message }, { status: result.httpStatus });
  }
  return NextResponse.json(
    { rows: result.rows, vatStatement: result.vatStatement },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
