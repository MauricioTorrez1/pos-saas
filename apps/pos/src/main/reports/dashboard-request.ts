import {
  EXPORT_FORMATS,
  PERIOD_KINDS,
  TOP_LIMITS,
  TOP_METRICS,
  type DashboardRequest,
  type ExportFormat,
  type PeriodKind,
  type TopLimit,
  type TopMetric,
} from '../../shared/dashboard-api';

const MAX_PIN_LENGTH = 32;

function oneOf<Choice extends string | number>(value: unknown, choices: readonly Choice[], description: string): Choice {
  const found = choices.find((choice) => choice === value);
  if (found === undefined) {
    throw new TypeError(`Expected ${description}`);
  }
  return found;
}

/**
 * Checks a request that came over the bridge. The service checks that the days exist; this checks the shape.
 *
 * @param value what the screen sent
 * @returns the request, with only the fields it knows
 * @throws TypeError if a field is missing or is not one of its allowed values
 */
export function parseDashboardRequest(value: unknown): DashboardRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('Expected a dashboard request');
  }
  const record = value as Record<string, unknown>;
  const { date, endDate, ownerPin } = record;
  if (typeof date !== 'string' || date.length !== 10) {
    throw new TypeError('Expected a day as YYYY-MM-DD');
  }
  if (endDate !== undefined && (typeof endDate !== 'string' || endDate.length !== 10)) {
    throw new TypeError('Expected the last day as YYYY-MM-DD');
  }
  if (ownerPin !== undefined && (typeof ownerPin !== 'string' || ownerPin.length > MAX_PIN_LENGTH)) {
    throw new TypeError('Expected the PIN as text');
  }
  const period: PeriodKind = oneOf(record.period, PERIOD_KINDS, 'a period');
  const topMetric: TopMetric = oneOf(record.topMetric, TOP_METRICS, 'an order for the best sellers');
  const topLimit: TopLimit = oneOf(record.topLimit, TOP_LIMITS, 'a size for the best sellers');
  return {
    period,
    date,
    ...(endDate === undefined ? {} : { endDate }),
    topMetric,
    topLimit,
    ...(ownerPin === undefined ? {} : { ownerPin }),
  };
}

/**
 * Checks the format the screen asked to save.
 *
 * @param value what the screen sent
 * @returns `xlsx` or `pdf`
 * @throws TypeError if it is anything else
 */
export function parseExportFormat(value: unknown): ExportFormat {
  return oneOf(value, EXPORT_FORMATS, 'xlsx or pdf');
}
