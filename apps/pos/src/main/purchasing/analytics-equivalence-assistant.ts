import type { EquivalenceConfidence } from '../../shared/catalog-equivalence';
import type { AssistGroup, AssistItem, AssistResponse, EquivalenceAssistant } from './catalog-equivalence-service';

/** Claude reads a hundred lines in well under this; past it the owner is told to try again. */
const REQUEST_TIMEOUT_MS = 120_000;

const MESSAGES: Readonly<Record<string, string>> = {
  matcher_not_configured: 'Falta configurar la llave de la API de Claude en el servicio de analítica.',
  matcher_busy: 'La IA está ocupada. Intenta de nuevo en un minuto.',
  model_refused: 'La IA no quiso agrupar estos artículos. Agrúpalos a mano.',
  malformed_answer: 'La respuesta de la IA salió incompleta. Intenta de nuevo.',
  register_not_allowed: 'El servicio de analítica no reconoce a esta caja. Revisa POS_ANALYTICS_TOKEN.',
};

const UNREACHABLE = 'No hay conexión con el servicio de analítica. Las propuestas sin internet siguen funcionando.';

function isConfidence(value: unknown): value is EquivalenceConfidence {
  return value === 'high' || value === 'medium' || value === 'low';
}

function readGroups(body: unknown): AssistGroup[] | null {
  const groups = (body as { groups?: unknown } | null)?.groups;
  if (!Array.isArray(groups)) {
    return null;
  }
  return groups.flatMap((group: unknown): AssistGroup[] => {
    const record = group as { item_ids?: unknown; reason?: unknown; confidence?: unknown } | null;
    if (!Array.isArray(record?.item_ids) || typeof record.reason !== 'string' || !isConfidence(record.confidence)) {
      return [];
    }
    return [{ item_ids: record.item_ids.filter((id): id is string => typeof id === 'string'), reason: record.reason, confidence: record.confidence }];
  });
}

/**
 * Asks the analytics service (`POST /catalog-matching/group`) to group the items the rules of the register could not
 * (E1-63, ADR 0077). The register signs in with its own token, `Authorization: Device`, which never appears in a message or
 * a log. Without internet it answers a failure in Spanish and the owner keeps the proposals of the rules.
 */
export class AnalyticsEquivalenceAssistant implements EquivalenceAssistant {
  readonly #url: URL;
  readonly #token: string;
  readonly #fetcher: typeof fetch;

  /**
   * @param baseUrl the address of the analytics service, such as `http://192.168.1.10:8000`
   * @param token the token of the register, the same as `ANALYTICS_REGISTER_TOKEN` in the service
   * @param fetcher the HTTP client; tests pass a fake
   */
  constructor(baseUrl: string, token: string, fetcher: typeof fetch = fetch) {
    this.#url = new URL('/catalog-matching/group', baseUrl);
    this.#token = token;
    this.#fetcher = fetcher;
  }

  async group(items: readonly AssistItem[]): Promise<AssistResponse> {
    let response: Response;
    try {
      response = await this.#fetcher(this.#url, {
        method: 'POST',
        headers: { Authorization: `Device ${this.#token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ items }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      return { status: 'failed', message: UNREACHABLE };
    }
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = (body as { detail?: unknown } | null)?.detail;
      return { status: 'failed', message: (typeof detail === 'string' ? MESSAGES[detail] : undefined) ?? UNREACHABLE };
    }
    const groups = readGroups(body);
    return groups === null ? { status: 'failed', message: MESSAGES.malformed_answer! } : { status: 'ok', groups };
  }
}

/**
 * Builds the assistant from the environment of the register, or null when it is not configured: then the screen does not
 * offer the button and everything else works the same.
 *
 * @param url `POS_ANALYTICS_URL`
 * @param token `POS_ANALYTICS_TOKEN`
 * @returns the assistant, or null
 */
export function equivalenceAssistantFromEnvironment(url: string | undefined, token: string | undefined): AnalyticsEquivalenceAssistant | null {
  if (url === undefined || url.trim() === '' || token === undefined || token.trim() === '') {
    return null;
  }
  try {
    return new AnalyticsEquivalenceAssistant(url.trim(), token.trim());
  } catch {
    return null;
  }
}
