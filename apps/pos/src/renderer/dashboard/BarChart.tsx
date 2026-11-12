import { useId, type ReactElement } from 'react';

/** One bar: what it is called, what it is worth, and how that reads. */
export interface Bar {
  readonly key: string;
  /** Short name under the bar. */
  readonly label: string;
  /** Height of the bar. Never negative. */
  readonly value: number;
  /** The value as the person reads it, such as "$1,250.00". */
  readonly valueLabel: string;
  /** Second column of the equivalent table, such as how many sales. */
  readonly extra?: string;
}

interface BarChartProps {
  /** What the chart is about, such as "Ventas por hora". It names the figure and the table. */
  readonly title: string;
  readonly bars: readonly Bar[];
  /** Names the columns of the table: the thing, its value, and optionally a second figure. */
  readonly columns: readonly [string, string] | readonly [string, string, string];
}

const BAR_WIDTH = 28;
const GAP = 8;
const PLOT_HEIGHT = 140;
const TOP_MARGIN = 8;
const LABEL_HEIGHT = 22;
const MAX_LABELS = 16;

/**
 * A bar chart drawn as SVG, with no library: the bars are rectangles that take the colors of the register's appearance, so
 * the light and dark themes work with no extra code. It is for reading and not only for looking: the chart has a text that
 * says what it shows and which bar is the tallest, and the same numbers are one click away as a table.
 *
 * @param props.title what the chart is about
 * @param props.bars the bars, in order
 * @param props.columns the names of the columns of the table
 * @returns the chart and its table
 */
export function BarChart({ title, bars, columns }: BarChartProps): ReactElement {
  const titleId = useId();
  const peak = bars.reduce((best, bar) => (bar.value > best.value ? bar : best), bars[0] ?? { key: '', label: '', value: 0, valueLabel: '' });
  const maximum = Math.max(1, ...bars.map((bar) => bar.value));
  const width = Math.max(1, bars.length) * (BAR_WIDTH + GAP) + GAP;
  const height = TOP_MARGIN + PLOT_HEIGHT + LABEL_HEIGHT;
  const labelEvery = Math.ceil(bars.length / MAX_LABELS);
  const summary =
    peak.value === 0 ? `${title}. No hubo ventas.` : `${title}. La barra más alta es ${peak.label}, con ${peak.valueLabel}.`;

  return (
    <figure className="chart">
      <figcaption id={titleId}>{title}</figcaption>
      <svg role="img" aria-labelledby={titleId} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet" className="chart-svg">
        <title>{summary}</title>
        <line x1={0} x2={width} y1={TOP_MARGIN + PLOT_HEIGHT} y2={TOP_MARGIN + PLOT_HEIGHT} className="chart-axis" />
        {bars.map((bar, index) => {
          const barHeight = bar.value === 0 ? 0 : Math.max(2, Math.round((bar.value / maximum) * PLOT_HEIGHT));
          const x = GAP + index * (BAR_WIDTH + GAP);
          return (
            <g key={bar.key}>
              <rect x={x} y={TOP_MARGIN + PLOT_HEIGHT - barHeight} width={BAR_WIDTH} height={barHeight} className="chart-bar">
                <title>{`${bar.label}: ${bar.valueLabel}`}</title>
              </rect>
              {index % labelEvery === 0 && (
                <text x={x + BAR_WIDTH / 2} y={TOP_MARGIN + PLOT_HEIGHT + 15} textAnchor="middle" className="chart-label">
                  {bar.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <p className="chart-summary">{peak.value === 0 ? 'Sin ventas en este periodo.' : `Lo más alto: ${peak.label}, ${peak.valueLabel}.`}</p>
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
