/**
 * The charts of the illustrated report (E1-57, ADR 0073), drawn as inline SVG by hand: no library, no network, so the PDF
 * prints the same with or without internet. The amounts stay integers (cents, counts); only the drawing turns them into
 * pixels, and every length is worked out with integer arithmetic. Every text is escaped, because a product name or an
 * expense concept is typed by a person.
 */

/** The colors of the report. Muted, so a page printed in gray still reads. */
export const CHART_COLORS = {
  ink: '#1b2328',
  muted: '#55626b',
  grid: '#d5dbe0',
  positive: '#2f6f4f',
  negative: '#b3261e',
  total: '#33495c',
  series: ['#2b6cb0', '#d69e2e', '#2f855a', '#9b2c2c', '#6b46c1', '#4a5568'],
} as const;

/** One bar, slice or step: a label and an integer amount. */
export interface ChartDatum {
  readonly label: string;
  readonly value: number;
}

/** How a value is written next to its bar. */
export type ValueFormatter = (value: number) => string;

const FONT = "font-family=\"'Segoe UI', Arial, sans-serif\"";

/**
 * Escapes a text for SVG or HTML.
 *
 * @param text anything a person typed
 * @returns the text, safe inside an element or an attribute
 */
export function escapeMarkup(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * Scales an integer amount to a length in pixels with integer arithmetic, rounded half up. Any amount above zero gets at
 * least one pixel, so a small sale never disappears.
 *
 * @param value the amount, of which only the size counts
 * @param max the largest amount, which takes the whole length
 * @param length the whole length in pixels
 * @returns the length of this amount, from 0 to `length`
 */
export function scaleLength(value: number, max: number, length: number): number {
  const size = Math.abs(value);
  if (max <= 0 || size === 0) {
    return 0;
  }
  const scaled = Number((BigInt(size) * BigInt(length) * 2n + BigInt(max)) / (BigInt(max) * 2n));
  return Math.min(length, Math.max(1, scaled));
}

/**
 * Shortens a label that would not fit, with an ellipsis.
 *
 * @param text the label
 * @param maxCharacters how many characters fit
 * @returns the label, cut if it was longer
 */
export function shorten(text: string, maxCharacters: number): string {
  const characters = [...text];
  return characters.length <= maxCharacters ? text : `${characters.slice(0, maxCharacters - 1).join('')}…`;
}

function svgOpen(width: number, height: number, label: string): string {
  return `<svg class="chart" role="img" aria-label="${escapeMarkup(label)}" viewBox="0 0 ${width} ${height}" width="100%" ${FONT} font-size="11"><title>${escapeMarkup(label)}</title>`;
}

function emptyChart(width: number, height: number, label: string, text: string): string {
  return `${svgOpen(width, height, label)}<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" fill="none" stroke="${CHART_COLORS.grid}" stroke-dasharray="4 3"/><text x="${width / 2}" y="${height / 2 + 4}" text-anchor="middle" fill="${CHART_COLORS.muted}">${escapeMarkup(text)}</text></svg>`;
}

/** What a column chart shows. */
export interface ColumnChartOptions {
  readonly label: string;
  readonly data: readonly ChartDatum[];
  readonly format: ValueFormatter;
  /** Writes the amount over each column; for many columns it is left out and the largest is named instead. */
  readonly showValues?: boolean;
  /** What it says when every amount is zero. */
  readonly emptyText?: string;
  /** One color for every column, or the first of the series. */
  readonly color?: string;
}

/**
 * Draws vertical columns, such as the sales by day or by hour. Amounts are zero or more: a negative one is drawn as zero,
 * because sales and counts never go below it.
 *
 * @param options the label, the columns and how to write an amount
 * @returns the SVG
 */
export function columnChart(options: ColumnChartOptions): string {
  const width = 680;
  const height = 175;
  const { data, format } = options;
  const max = Math.max(0, ...data.map((datum) => datum.value));
  if (data.length === 0 || max === 0) {
    return emptyChart(width, 90, options.label, options.emptyText ?? 'Sin ventas en el periodo');
  }
  const left = 8;
  const top = 22;
  const plotHeight = 115;
  const baseline = top + plotHeight;
  const slot = Math.floor((width - left * 2) / data.length);
  const barWidth = Math.max(2, Math.floor(slot * 0.7));
  const showValues = options.showValues ?? data.length <= 12;
  const labelEvery = Math.max(1, Math.ceil(data.length / 16));
  const color = options.color ?? CHART_COLORS.series[0];
  const parts = [svgOpen(width, height, options.label), `<line x1="${left}" y1="${baseline}" x2="${width - left}" y2="${baseline}" stroke="${CHART_COLORS.grid}"/>`];
  let largest = 0;
  data.forEach((datum, index) => {
    const value = Math.max(0, datum.value);
    const barHeight = scaleLength(value, max, plotHeight);
    const x = left + index * slot + Math.floor((slot - barWidth) / 2);
    const center = x + Math.floor(barWidth / 2);
    parts.push(`<rect x="${x}" y="${baseline - barHeight}" width="${barWidth}" height="${barHeight}" fill="${color}" rx="1"><title>${escapeMarkup(`${datum.label}: ${format(value)}`)}</title></rect>`);
    if (showValues && value > 0) {
      parts.push(`<text x="${center}" y="${baseline - barHeight - 4}" text-anchor="middle" font-size="9" fill="${CHART_COLORS.ink}">${escapeMarkup(format(value))}</text>`);
    }
    if (index % labelEvery === 0) {
      parts.push(`<text x="${center}" y="${baseline + 14}" text-anchor="middle" font-size="9" fill="${CHART_COLORS.muted}">${escapeMarkup(shorten(datum.label, 8))}</text>`);
    }
    if (value > (data[largest]?.value ?? 0)) {
      largest = index;
    }
  });
  if (!showValues) {
    const best = data[largest];
    if (best !== undefined) {
      parts.push(`<text x="${width - left}" y="12" text-anchor="end" font-size="10" fill="${CHART_COLORS.ink}">${escapeMarkup(`Lo más alto: ${best.label}, ${format(best.value)}`)}</text>`);
    }
  }
  parts.push('</svg>');
  return parts.join('');
}

/** What a chart of horizontal bars shows. */
export interface BarListOptions {
  readonly label: string;
  readonly data: readonly ChartDatum[];
  readonly format: ValueFormatter;
  readonly emptyText?: string;
  readonly color?: string;
}

/**
 * Draws one horizontal bar per row, with its name on the left and its amount on the right, such as the products that sold
 * the most or the expenses by concept. A negative amount, such as a loss, goes to the left of the zero line in red.
 *
 * @param options the label, the rows and how to write an amount
 * @returns the SVG
 */
export function barList(options: BarListOptions): string {
  const width = 680;
  const rowHeight = 22;
  const { data, format } = options;
  if (data.length === 0 || data.every((datum) => datum.value === 0)) {
    return emptyChart(width, 70, options.label, options.emptyText ?? 'Sin datos en el periodo');
  }
  const nameWidth = 230;
  const valueWidth = 110;
  const plotLeft = nameWidth + 8;
  const plotWidth = width - plotLeft - valueWidth;
  const maxPositive = Math.max(0, ...data.map((datum) => datum.value));
  const maxNegative = Math.max(0, ...data.map((datum) => -datum.value));
  const span = maxPositive + maxNegative;
  const negativeWidth = scaleLength(maxNegative, span, plotWidth);
  const zero = plotLeft + negativeWidth;
  const height = data.length * rowHeight + 8;
  const color = options.color ?? CHART_COLORS.series[0];
  const parts = [svgOpen(width, height, options.label)];
  data.forEach((datum, index) => {
    const y = 4 + index * rowHeight;
    const length = scaleLength(datum.value, span, plotWidth);
    const x = datum.value < 0 ? zero - length : zero;
    parts.push(
      `<text x="${nameWidth}" y="${y + 14}" text-anchor="end" fill="${CHART_COLORS.ink}">${escapeMarkup(shorten(datum.label, 38))}</text>`,
      `<rect x="${x}" y="${y + 4}" width="${length}" height="${rowHeight - 8}" fill="${datum.value < 0 ? CHART_COLORS.negative : color}" rx="1"><title>${escapeMarkup(`${datum.label}: ${format(datum.value)}`)}</title></rect>`,
      `<text x="${width}" y="${y + 14}" text-anchor="end" fill="${datum.value < 0 ? CHART_COLORS.negative : CHART_COLORS.ink}">${escapeMarkup(format(datum.value))}</text>`,
    );
  });
  if (maxNegative > 0) {
    parts.push(`<line x1="${zero}" y1="0" x2="${zero}" y2="${height}" stroke="${CHART_COLORS.muted}"/>`);
  }
  parts.push('</svg>');
  return parts.join('');
}

/** A point on the circle of a donut, for an angle measured in parts of the whole. */
function pointOn(center: number, radius: number, part: number, whole: number): string {
  // The angle is geometry for the drawing, not money: the amounts themselves stay integers.
  const angle = (2 * Math.PI * part) / whole - Math.PI / 2;
  return `${(center + radius * Math.cos(angle)).toFixed(2)} ${(center + radius * Math.sin(angle)).toFixed(2)}`;
}

/**
 * Splits 10,000 basis points among the slices by the largest remainder, so the shares written always add up to 100 %.
 *
 * @param values integer amounts, zero or more
 * @returns the share of each one in basis points
 */
export function sharesBp(values: readonly number[]): number[] {
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (total === 0) {
    return values.map(() => 0);
  }
  const exact = values.map((value) => BigInt(Math.max(0, value)) * 10_000n);
  const floors = exact.map((amount) => Number(amount / BigInt(total)));
  const remainders = exact.map((amount, index) => ({ index, rest: amount % BigInt(total) }));
  let left = 10_000 - floors.reduce((sum, value) => sum + value, 0);
  remainders.sort((a, b) => (b.rest > a.rest ? 1 : b.rest < a.rest ? -1 : a.index - b.index));
  for (const { index } of remainders) {
    if (left === 0) {
      break;
    }
    floors[index] = (floors[index] ?? 0) + 1;
    left -= 1;
  }
  return floors;
}

/** What a donut shows. */
export interface DonutOptions {
  readonly label: string;
  readonly data: readonly ChartDatum[];
  readonly format: ValueFormatter;
  /** Writes a share in basis points. */
  readonly formatShare: (basisPoints: number) => string;
  /** The words in the hole, such as the total. */
  readonly centerText: string;
  readonly emptyText?: string;
}

/**
 * Draws a donut with a legend on its right, such as how the sales were paid. A slice of zero is left out of the ring but
 * stays in the legend, so the owner sees that nobody paid that way.
 *
 * @param options the label, the slices, and how to write an amount and a share
 * @returns the SVG
 */
export function donutChart(options: DonutOptions): string {
  const width = 680;
  const height = 190;
  const { data } = options;
  const total = data.reduce((sum, datum) => sum + Math.max(0, datum.value), 0);
  if (total === 0) {
    return emptyChart(width, 90, options.label, options.emptyText ?? 'Sin ventas en el periodo');
  }
  const center = 95;
  const outer = 85;
  const inner = 52;
  const shares = sharesBp(data.map((datum) => datum.value));
  const parts = [svgOpen(width, height, options.label)];
  let start = 0;
  data.forEach((datum, index) => {
    const value = Math.max(0, datum.value);
    const color = CHART_COLORS.series[index % CHART_COLORS.series.length] ?? CHART_COLORS.total;
    if (value === total) {
      parts.push(`<circle cx="${center}" cy="${center}" r="${(outer + inner) / 2}" fill="none" stroke="${color}" stroke-width="${outer - inner}"/>`);
    } else if (value > 0) {
      const end = start + value;
      const large = value * 2 > total ? 1 : 0;
      parts.push(
        `<path d="M ${pointOn(center, outer, start, total)} A ${outer} ${outer} 0 ${large} 1 ${pointOn(center, outer, end, total)} L ${pointOn(center, inner, end, total)} A ${inner} ${inner} 0 ${large} 0 ${pointOn(center, inner, start, total)} Z" fill="${color}"><title>${escapeMarkup(`${datum.label}: ${options.format(value)}`)}</title></path>`,
      );
    }
    start += value;
    const y = 30 + index * 24;
    parts.push(
      `<rect x="215" y="${y - 10}" width="12" height="12" fill="${color}"/>`,
      `<text x="234" y="${y}" fill="${CHART_COLORS.ink}">${escapeMarkup(shorten(datum.label, 30))}</text>`,
      `<text x="520" y="${y}" text-anchor="end" fill="${CHART_COLORS.ink}">${escapeMarkup(options.format(value))}</text>`,
      `<text x="600" y="${y}" text-anchor="end" fill="${CHART_COLORS.muted}">${escapeMarkup(options.formatShare(shares[index] ?? 0))}</text>`,
    );
  });
  parts.push(`<text x="${center}" y="${center + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="${CHART_COLORS.ink}">${escapeMarkup(options.centerText)}</text>`, '</svg>');
  return parts.join('');
}

/** One step of a waterfall: an amount that adds, takes away, or a subtotal drawn from zero. */
export interface WaterfallStep {
  readonly label: string;
  readonly value: number;
  readonly kind: 'start' | 'add' | 'subtract' | 'total';
}

/**
 * Draws a waterfall, such as the income statement: the sales go up, the cost and the expenses come down, and each
 * subtotal is drawn from the zero line. A subtotal below zero, a loss, goes under the line in red.
 *
 * @param label what the chart is about
 * @param steps the steps, in order; `subtract` takes away the size of its amount
 * @param format how to write an amount
 * @returns the SVG
 */
export function waterfallChart(label: string, steps: readonly WaterfallStep[], format: ValueFormatter): string {
  const width = 680;
  const height = 250;
  if (steps.length === 0 || steps.every((step) => step.value === 0)) {
    return emptyChart(width, 90, label, 'Sin movimientos en el periodo');
  }
  // The level reached after each step, all in integer cents.
  const bars: { readonly from: number; readonly to: number; readonly step: WaterfallStep }[] = [];
  let level = 0;
  for (const step of steps) {
    if (step.kind === 'start' || step.kind === 'total') {
      level = step.value;
      bars.push({ from: 0, to: step.value, step });
    } else {
      const next = step.kind === 'add' ? level + Math.abs(step.value) : level - Math.abs(step.value);
      bars.push({ from: level, to: next, step });
      level = next;
    }
  }
  const highest = Math.max(0, ...bars.flatMap((bar) => [bar.from, bar.to]));
  const lowest = Math.min(0, ...bars.flatMap((bar) => [bar.from, bar.to]));
  const top = 24;
  const plotHeight = 170;
  const span = highest - lowest;
  const zero = top + scaleLength(highest, span, plotHeight);
  const y = (value: number): number => (value >= 0 ? zero - scaleLength(value, span, plotHeight) : zero + scaleLength(value, span, plotHeight));
  const slot = Math.floor((width - 16) / bars.length);
  const barWidth = Math.floor(slot * 0.6);
  const parts = [svgOpen(width, height, label), `<line x1="8" y1="${zero}" x2="${width - 8}" y2="${zero}" stroke="${CHART_COLORS.muted}"/>`];
  bars.forEach((bar, index) => {
    const x = 8 + index * slot + Math.floor((slot - barWidth) / 2);
    const upper = Math.min(y(bar.from), y(bar.to));
    const lower = Math.max(y(bar.from), y(bar.to));
    const isTotal = bar.step.kind === 'start' || bar.step.kind === 'total';
    const color = bar.to < 0 && isTotal ? CHART_COLORS.negative : isTotal ? CHART_COLORS.total : bar.step.kind === 'add' ? CHART_COLORS.positive : CHART_COLORS.negative;
    const shown = bar.step.kind === 'subtract' ? -Math.abs(bar.step.value) : bar.step.value;
    parts.push(
      `<rect x="${x}" y="${upper}" width="${barWidth}" height="${Math.max(1, lower - upper)}" fill="${color}"><title>${escapeMarkup(`${bar.step.label}: ${format(shown)}`)}</title></rect>`,
      `<text x="${x + Math.floor(barWidth / 2)}" y="${Math.max(12, upper - 4)}" text-anchor="middle" font-size="10" fill="${CHART_COLORS.ink}">${escapeMarkup(format(shown))}</text>`,
      `<text x="${x + Math.floor(barWidth / 2)}" y="${height - 8}" text-anchor="middle" font-size="9" fill="${CHART_COLORS.muted}">${escapeMarkup(shorten(bar.step.label, 22))}</text>`,
    );
    const next = bars[index + 1];
    if (next !== undefined && next.step.kind !== 'start' && next.step.kind !== 'total') {
      parts.push(`<line x1="${x + barWidth}" y1="${y(bar.to)}" x2="${x + slot}" y2="${y(bar.to)}" stroke="${CHART_COLORS.grid}" stroke-dasharray="3 2"/>`);
    }
  });
  parts.push('</svg>');
  return parts.join('');
}

/**
 * Draws the initials of the business in a circle, for the cover, when the register has no logo.
 *
 * @param businessName the name of the business
 * @param color the accent the owner chose for the register
 * @returns the SVG
 */
export function monogram(businessName: string, color: string): string {
  const initials =
    businessName
      .split(/\s+/)
      .map((word) => word.replace(/[^\p{L}\p{N}]/gu, ''))
      .filter((word) => [...word].length > 2)
      .slice(0, 2)
      .map((word) => [...word][0]?.toUpperCase() ?? '')
      .join('') || ([...businessName.trim()][0]?.toUpperCase() ?? '·');
  return `<svg role="img" aria-label="${escapeMarkup(`Insignia de ${businessName}`)}" viewBox="0 0 120 120" width="120" height="120" ${FONT}><circle cx="60" cy="60" r="56" fill="${color}"/><circle cx="60" cy="60" r="48" fill="none" stroke="#ffffff" stroke-width="2"/><text x="60" y="73" text-anchor="middle" font-size="38" font-weight="700" fill="#ffffff">${escapeMarkup(initials)}</text></svg>`;
}
