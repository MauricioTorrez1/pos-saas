import { useId, type ReactElement } from 'react';

/** One bar of a chart: its label on the axis, its height, and how its value reads. */
export interface Bar {
  readonly key: string;
  readonly label: string;
  /** The height of the bar, in whatever the chart measures. Never negative. */
  readonly value: number;
  /** The value as the owner reads it, such as `$1,250.00`. */
  readonly valueLabel: string;
  /** A second number for the table under the chart, such as how many sales. */
  readonly extra?: string;
}

interface BarChartProps {
  readonly title: string;
  readonly bars: readonly Bar[];
  /** The headings of the table under the chart: the label, the value and, when there are three, the extra number. */
  readonly columns: readonly [string, string] | readonly [string, string, string];
  /** What to say when every bar is zero. */
  readonly emptyText?: string | undefined;
}

const PLOT_HEIGHT = 200;
const TOP_MARGIN = 26;
const LABEL_HEIGHT = 26;
const SIDE_MARGIN = 10;
const WIDTH = 760;
const MAX_BAR_WIDTH = 64;
const MAX_LABELS = 16;
/** With more bars than this, the value over each bar would overlap its neighbors. */
const MAX_VALUE_LABELS = 12;
const GRID_LINES = [0.25, 0.5, 0.75, 1];

/**
 * A bar chart drawn in SVG, with the colors of the appearance. It reads without the mouse: the tallest bar is said in
 * words, each bar carries its value, and the same numbers are in a table underneath.
 *
 * @param props.title what the chart shows; it also names the picture for a screen reader
 * @param props.bars the bars, in the order they are drawn
 * @param props.columns the headings of the table
 * @param props.emptyText what to say when there is nothing to draw
 * @returns the chart with its table
 */
export function BarChart({ title, bars, columns, emptyText = 'Sin ventas en este periodo.' }: BarChartProps): ReactElement {
  const titleId = useId();
  const peak = bars.reduce((best, bar) => (bar.value > best.value ? bar : best), bars[0] ?? { key: '', label: '', value: 0, valueLabel: '' });
  const maximum = Math.max(1, ...bars.map((bar) => bar.value));
  const slot = (WIDTH - SIDE_MARGIN * 2) / Math.max(1, bars.length);
  const barWidth = Math.min(MAX_BAR_WIDTH, slot * 0.68);
  const height = TOP_MARGIN + PLOT_HEIGHT + LABEL_HEIGHT;
  const labelEvery = Math.ceil(bars.length / MAX_LABELS);
  const showValues = bars.length <= MAX_VALUE_LABELS;
  const summary = peak.value === 0 ? `${title}. No hubo ventas.` : `${title}. La barra más alta es ${peak.label}, con ${peak.valueLabel}.`;

  return (
    <figure className="chart">
      <figcaption id={titleId}>{title}</figcaption>
      <svg role="img" aria-labelledby={titleId} viewBox={`0 0 ${String(WIDTH)} ${String(height)}`} preserveAspectRatio="xMidYMid meet" className="chart-svg">
        <title>{summary}</title>
        {GRID_LINES.map((share) => (
          <line key={share} x1={0} x2={WIDTH} y1={TOP_MARGIN + PLOT_HEIGHT * (1 - share)} y2={TOP_MARGIN + PLOT_HEIGHT * (1 - share)} className="chart-grid" />
        ))}
        <line x1={0} x2={WIDTH} y1={TOP_MARGIN + PLOT_HEIGHT} y2={TOP_MARGIN + PLOT_HEIGHT} className="chart-axis" />
        {bars.map((bar, index) => {
          const barHeight = bar.value === 0 ? 0 : Math.max(3, Math.round((bar.value / maximum) * PLOT_HEIGHT));
          const center = SIDE_MARGIN + slot * index + slot / 2;
          const top = TOP_MARGIN + PLOT_HEIGHT - barHeight;
          return (
            <g key={bar.key}>
              <rect x={center - barWidth / 2} y={top} width={barWidth} height={barHeight} rx={Math.min(6, barWidth / 4)} className="chart-bar" data-peak={bar === peak && bar.value > 0}>
                <title>{`${bar.label}: ${bar.valueLabel}`}</title>
              </rect>
              {showValues && bar.value > 0 && (
                <text x={center} y={top - 7} textAnchor="middle" className="chart-value">
                  {bar.valueLabel}
                </text>
              )}
              {index % labelEvery === 0 && (
                <text x={center} y={TOP_MARGIN + PLOT_HEIGHT + 18} textAnchor="middle" className="chart-label">
                  {bar.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <p className="chart-summary">{peak.value === 0 ? emptyText : `Lo más alto: ${peak.label}, ${peak.valueLabel}.`}</p>
      <details className="chart-table">
        <summary>Ver como tabla</summary>
        <table aria-label={`${title}, tabla`}>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bars.map((bar) => (
              <tr key={bar.key}>
                <th scope="row">{bar.label}</th>
                <td>{bar.valueLabel}</td>
                {columns.length === 3 && <td>{bar.extra ?? ''}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
