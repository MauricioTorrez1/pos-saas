import { inflateRawSync } from 'node:zlib';

import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { buildWorkbook, type Cell, type Sheet } from './xlsx';

/** The parts of the zip as text, found by walking its local headers (the writer always records the sizes there). */
function partsOf(bytes: Buffer): Map<string, string> {
  const parts = new Map<string, string>();
  let position = 0;
  while (bytes.readUInt32LE(position) === 0x04034b50) {
    const packedSize = bytes.readUInt32LE(position + 18);
    const nameLength = bytes.readUInt16LE(position + 26);
    const extraLength = bytes.readUInt16LE(position + 28);
    const name = bytes.toString('utf8', position + 30, position + 30 + nameLength);
    const dataStart = position + 30 + nameLength + extraLength;
    parts.set(name, inflateRawSync(bytes.subarray(dataStart, dataStart + packedSize)).toString('utf8'));
    position = dataStart + packedSize;
  }
  return parts;
}

async function readBack(sheets: readonly Sheet[], properties?: Parameters<typeof buildWorkbook>[1]): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  // The typings of exceljs ask for their own Buffer interface, which Node's Buffer satisfies.
  await workbook.xlsx.load(buildWorkbook(sheets, properties) as unknown as ExcelJS.Buffer);
  return workbook;
}

describe('the shared Excel writer (E1-47)', () => {
  it('writes the sheets in order with their names, widths, frozen rows and the properties of the document', async () => {
    const created = new Date('2026-11-11T18:30:45.123Z');
    const workbook = await readBack(
      [
        { name: 'Pedido', rows: [['a', 'b']], widths: [22, 46], frozenRows: 1, fitToPageWidth: true },
        { name: 'Resumen', rows: [['c']] },
      ],
      { creator: 'Tlapalería <La Esperanza> & Hijos', created },
    );

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Pedido', 'Resumen']);
    const sheet = workbook.getWorksheet('Pedido')!;
    expect(sheet.getColumn(1).width).toBe(22);
    expect(sheet.getColumn(2).width).toBe(46);
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(sheet.pageSetup).toMatchObject({ paperSize: 9, orientation: 'portrait', fitToWidth: 1, fitToHeight: 0 });
    expect(workbook.creator).toBe('Tlapalería <La Esperanza> & Hijos');
    expect(workbook.created.toISOString()).toBe('2026-11-11T18:30:45.000Z');
  });

  it('writes no properties of the document unless it is given some, and the same sheets always give the same bytes', () => {
    const sheets: Sheet[] = [{ name: 'Hoja', rows: [['x', { decimal: '1.50', format: 'money' }]] }];

    expect(partsOf(buildWorkbook(sheets)).has('docProps/core.xml')).toBe(false);
    expect(buildWorkbook(sheets).equals(buildWorkbook(sheets))).toBe(true);
  });

  it('shows each number with its format and keeps the style of a cell: bold, fill, border and alignment', async () => {
    const workbook = await readBack([
      {
        name: 'Formatos',
        rows: [
          [
            { decimal: '7', format: 'integer' },
            { decimal: '1234.5', format: 'money' },
            { decimal: '3.275', format: 'quantity' },
            { decimal: '25.34', format: 'percent' },
            { decimal: '52.25', format: { code: '"$"#,##0.00####' }, style: { bold: true } },
            { heading: 'Total' },
            { text: '000123', style: { numFormat: '@', fill: 'eeeeee', bottomBorder: true, alignRight: true, size: 14 } },
          ],
        ],
      },
    ]);
    const row = workbook.getWorksheet('Formatos')!.getRow(1);

    expect(row.getCell(1).numFmt).toBe('0');
    expect(row.getCell(2).numFmt).toBe('#,##0.00');
    expect(row.getCell(3).numFmt).toBe('0.000');
    expect(row.getCell(4).numFmt).toBe('0.00"%"');
    expect(row.getCell(5).numFmt).toBe('"$"#,##0.00####');
    expect(row.getCell(5).font?.bold).toBe(true);
    expect(row.getCell(6).font?.bold).toBe(true);
    expect(row.getCell(7).value).toBe('000123');
    expect(row.getCell(7).numFmt).toBe('@');
    expect(row.getCell(7).font?.size).toBe(14);
    expect(row.getCell(7).fill).toMatchObject({ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEEEEE' } });
    expect(row.getCell(7).border?.bottom?.style).toBe('thin');
    expect(row.getCell(7).alignment?.horizontal).toBe('right');
  });

  it('writes big numbers and numbers with four decimals as the exact text they were given, not through a float', async () => {
    const big = '12345678901234567.89';
    const bytes = buildWorkbook([
      {
        name: 'Exactos',
        rows: [[{ decimal: big, format: 'money' }, { decimal: '1234.5678', format: 'money' }, { decimal: '0.0001', format: 'money' }, { decimal: '-9007199254740993.01', format: 'money' }]],
      },
    ]);

    const xml = partsOf(bytes).get('xl/worksheets/sheet1.xml')!;
    expect(xml).toContain(`<v>${big}</v>`);
    expect(xml).toContain('<v>-9007199254740993.01</v>');
    expect(String(Number(big))).not.toBe(big);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    const row = workbook.getWorksheet('Exactos')!.getRow(1);
    expect(row.getCell(2).value).toBe(1234.5678);
    expect(row.getCell(3).value).toBe(0.0001);
  });

  it('leaves a null cell empty and keeps the next cells in their own columns', async () => {
    const workbook = await readBack([{ name: 'Huecos', rows: [[null, null, 'c', null, { decimal: '2', format: 'integer' }]] }]);
    const row = workbook.getWorksheet('Huecos')!.getRow(1);

    expect(row.getCell(1).value ?? null).toBeNull();
    expect(row.getCell(3).value).toBe('c');
    expect(row.getCell(4).value ?? null).toBeNull();
    expect(row.getCell(5).value).toBe(2);
  });

  it('keeps special characters intact, and never turns a text that looks like a formula into a formula', async () => {
    const texts = ['=1+1', '+SUM(A1:A2)', '-2+3', '@SUM(1)', '=HYPERLINK("http://x")&<b>Sierra</b> ñandú', "'; DROP TABLE ventas;--", 'línea\nsegunda con  dos espacios', '日本語 😀'];
    const rows: Cell[][] = texts.map((text) => [text, { text, style: { bold: true } }, { heading: text }]);
    const bytes = buildWorkbook([{ name: 'Textos', rows }]);

    expect(partsOf(bytes).get('xl/worksheets/sheet1.xml')).not.toContain('<f>');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet('Textos')!;
    texts.forEach((text, index) => {
      for (const column of [1, 2, 3]) {
        const cell = sheet.getRow(index + 1).getCell(column);
        expect(cell.type).toBe(ExcelJS.ValueType.String);
        expect(cell.value).toBe(text);
      }
    });
  });

  it('drops the characters XML cannot carry instead of writing a file Excel would not open', async () => {
    const workbook = await readBack([{ name: 'Control', rows: [['a\u0000b\u0008c\u001Fd']] }]);

    expect(workbook.getWorksheet('Control')!.getCell('A1').value).toBe('abcd');
  });

  it('refuses a sheet name Excel would not open, a number that is not decimal text and a color that is not hexadecimal', () => {
    for (const name of ['', 'x'.repeat(32), 'a/b', 'a:b', 'a[b]', 'a*b', 'a?b', 'a\\b']) {
      expect(() => buildWorkbook([{ name, rows: [] }])).toThrow(TypeError);
    }
    expect(() => buildWorkbook([{ name: 'Hoja', rows: [] }, { name: 'HOJA', rows: [] }])).toThrow(TypeError);
    for (const decimal of ['1e3', 'NaN', '1,000.00', '', ' 5', '5.', '=1+1']) {
      expect(() => buildWorkbook([{ name: 'Hoja', rows: [[{ decimal, format: 'money' }]] }])).toThrow(TypeError);
    }
    expect(() => buildWorkbook([{ name: 'Hoja', rows: [[{ text: 'x', style: { fill: 'red' } }]] }])).toThrow(TypeError);
  });
});
