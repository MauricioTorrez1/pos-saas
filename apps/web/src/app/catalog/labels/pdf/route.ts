import { NextResponse, type NextRequest } from 'next/server';
import { parseLabelsForm, requestLabels } from '@/lib/labels';
import { getConfig, getSession } from '@/lib/server';

export const dynamic = 'force-dynamic';

function backToScreen(baseUrl: URL, query: string, error: string): NextResponse {
  const url = new URL('/catalog/labels', baseUrl);
  if (query) {
    url.searchParams.set('q', query);
  }
  url.searchParams.set('error', error);
  return NextResponse.redirect(url, 303);
}

/**
 * Downloads the PDF of labels. The browser posts the form here and this handler asks the core with the token of the
 * session, so the token never reaches the browser. It answers POST only, and the session cookie is SameSite=Lax, so
 * another site cannot make the browser call it. The proxy already checked the role (`/catalog` is for the owner and
 * the manager).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const config = getConfig();
  const session = await getSession();
  if (!session) {
    return NextResponse.redirect(new URL('/?error=login_required', config.baseUrl), 303);
  }
  const form = await request.formData();
  const query = String(form.get('q') ?? '').trim();
  const labels = parseLabelsForm(form);
  if ('error' in labels) {
    return backToScreen(config.baseUrl, query, labels.error);
  }

  const result = await requestLabels(config, session.accessToken, labels);
  switch (result.status) {
    case 'ok':
      return new NextResponse(result.file, {
        headers: {
          'Content-Type': result.contentType,
          'Content-Disposition': `attachment; filename="${result.fileName}"`,
          'Cache-Control': 'no-store',
        },
      });
    case 'invalid':
      return backToScreen(config.baseUrl, query, result.message);
    case 'unauthorized':
      return NextResponse.redirect(new URL('/?error=session_expired', config.baseUrl), 303);
    case 'forbidden':
      return NextResponse.redirect(new URL('/forbidden', config.baseUrl), 303);
    case 'unavailable':
      return backToScreen(config.baseUrl, query, 'El sistema central no responde. Intenta de nuevo en un momento.');
  }
}
