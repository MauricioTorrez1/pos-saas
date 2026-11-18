import { describe, expect, it } from 'vitest';

import { CHART_COLORS, barList, columnChart, donutChart, escapeMarkup, monogram, scaleLength, sharesBp, shorten, waterfallChart } from './report-charts';

const pesos = (cents: number): string => `$${String(cents / 100)}`;

describe('the scale of the charts', () => {
  it('turns integer amounts into whole pixels, rounded half up', () => {
    expect(scaleLength(50, 100, 140)).toBe(70);
    expect(scaleLength(1, 3, 100)).toBe(33);
    expect(scaleLength(2, 3, 100)).toBe(67);
    expect(scaleLength(100, 100, 140)).toBe(140);
  });

  it('never hides a small amount and never draws a zero', () => {
    expect(scaleLength(1, 1_000_000_000, 140)).toBe(1);
    expect(scaleLength(0, 100, 140)).toBe(0);
    expect(scaleLength(10, 0, 140)).toBe(0);
  });

  it('uses the size of a negative amount', () => {
    expect(scaleLength(-50, 100, 140)).toBe(70);
  });

  it('works with amounts beyond what a float holds exactly', () => {
    expect(scaleLength(9_007_199_254_740_000, 9_007_199_254_740_991, 140)).toBe(140);
  });
});

describe('the shares of a donut', () => {
  it('always add up to 10,000 basis points', () => {
    const shares = sharesBp([1, 1, 1]);
    expect(shares.reduce((sum, value) => sum + value, 0)).toBe(10_000);
    expect(shares).toEqual([3_334, 3_333, 3_333]);
  });

  it('gives zero to everything when there is nothing', () => {
    expect(sharesBp([0, 0])).toEqual([0, 0]);
  });
});

describe('the texts of the charts', () => {
  it('escapes what a person typed', () => {
    expect(escapeMarkup(`<script>alert("x")</script> & 'y'`)).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;');
  });

  it('cuts a long label with an ellipsis, counting characters and not bytes', () => {
    expect(shorten('Pinzas de electricista', 10)).toBe('Pinzas de…');
    expect(shorten('Ñandú', 10)).toBe('Ñandú');
  });

  it('never lets a product name break out of the SVG', () => {
    const svg = barList({ label: 'Más vendidos', data: [{ label: '<img src=x onerror=alert(1)>', value: 100 }], format: pesos });
    expect(svg).not.toContain('<img');
    expect(svg).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('the column chart', () => {
  it('draws one column per amount with its label and an accessible name', () => {
    const svg = columnChart({ label: 'Ventas por día', data: [{ label: '1 nov', value: 100 }, { label: '2 nov', value: 300 }], format: pesos });
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="Ventas por día"');
    expect(svg.match(/<rect /g)).toHaveLength(2);
    expect(svg).toContain('$3');
  });

  it('says there were no sales instead of drawing empty columns', () => {
    const svg = columnChart({ label: 'Ventas por hora', data: [{ label: '9h', value: 0 }], format: pesos });
    expect(svg).toContain('Sin ventas en el periodo');
    expect(svg).not.toContain('<rect x="8"');
  });

  it('names the highest column when there are too many to write every amount', () => {
    const data = Array.from({ length: 24 }, (_, hour) => ({ label: `${String(hour)}h`, value: hour === 13 ? 900 : 10 }));
    const svg = columnChart({ label: 'Por hora', data, format: pesos });
    expect(svg).toContain('Lo más alto: 13h, $9');
  });
});

describe('the bar list', () => {
  it('draws a loss in red to the left of the zero line', () => {
    const svg = barList({ label: 'Utilidad', data: [{ label: 'Martillo', value: 500 }, { label: 'Cable', value: -200 }], format: pesos });
    expect(svg).toContain(`fill="${CHART_COLORS.negative}"`);
    expect(svg).toContain('<line');
  });

  it('says so when every amount is zero', () => {
    expect(barList({ label: 'Gastos', data: [], format: pesos, emptyText: 'No anotaste gastos' })).toContain('No anotaste gastos');
  });
});

describe('the donut', () => {
  it('draws a whole ring for a single way of paying', () => {
    const svg = donutChart({ label: 'Pagos', data: [{ label: 'Efectivo', value: 1_000 }, { label: 'Tarjeta', value: 0 }], format: pesos, formatShare: (bp) => `${String(bp)} bp`, centerText: '$10' });
    expect(svg).toContain('<circle');
    expect(svg).not.toContain('<path');
    expect(svg).toContain('10000 bp');
    expect(svg).toContain('Tarjeta');
  });

  it('draws one slice per way of paying with its share', () => {
    const svg = donutChart({ label: 'Pagos', data: [{ label: 'Efectivo', value: 750 }, { label: 'Tarjeta', value: 250 }], format: pesos, formatShare: (bp) => `${String(bp)} bp`, centerText: '$10' });
    expect(svg.match(/<path/g)).toHaveLength(2);
    expect(svg).toContain('7500 bp');
    expect(svg).toContain('2500 bp');
  });

  it('says there were no sales when the total is zero', () => {
    expect(donutChart({ label: 'Pagos', data: [], format: pesos, formatShare: String, centerText: '$0' })).toContain('Sin ventas');
  });
});

describe('the waterfall', () => {
  it('goes down under the zero line in red when the period lost money', () => {
    const svg = waterfallChart(
      'Resultado',
      [
        { label: 'Ventas netas', value: 10_000, kind: 'start' },
        { label: 'Costo', value: 6_000, kind: 'subtract' },
        { label: 'Utilidad bruta', value: 4_000, kind: 'total' },
        { label: 'Gastos', value: 7_000, kind: 'subtract' },
        { label: 'Utilidad neta', value: -3_000, kind: 'total' },
      ],
      pesos,
    );
    expect(svg).toContain('Utilidad neta: $-30');
    expect(svg).toContain('Gastos: $-70');
    expect(svg).toContain(`fill="${CHART_COLORS.negative}"`);
  });

  it('says so when the period had no movement', () => {
    expect(waterfallChart('Resultado', [{ label: 'Ventas netas', value: 0, kind: 'start' }], pesos)).toContain('Sin movimientos');
  });
});

describe('the cover', () => {
  it('uses the initials of the business and escapes its name', () => {
    const svg = monogram('Tlapalería "La Esperanza"', '#2b6cb0');
    expect(svg).toContain('>TE<');
    expect(svg).toContain('&quot;La Esperanza&quot;');
  });

  it('has a letter even for a short name', () => {
    expect(monogram('Mi', '#2b6cb0')).toContain('>M<');
  });
});
