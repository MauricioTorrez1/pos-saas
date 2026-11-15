import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { costWithoutTaxE6, costWithTaxE6 } from '../../shared/pricing';
import { parseCatalogTable, parseEleventaCatalog } from './eleventa-csv';
import { readXlsxTable, WorkbookError } from './xlsx-reader';

async function workbookOf(rows: readonly (readonly (string | number | null)[])[]): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Productos');
  rows.forEach((row) => sheet.addRow([...row]));
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}

describe('reading an Excel workbook without a library', () => {
  it('reads the first sheet as text, with shared strings, numbers, gaps and special characters', async () => {
    const bytes = await workbookOf([
      ['Código del producto', 'Nombre del producto', 'Precio de venta', 'Existencias'],
      ['7501', 'Martillo de uña 16 oz', 135.5, 12],
      ['7502', 'Cable <rojo> & "negro"', 12.5, null],
      [null, null, null, null],
      ['7503', 'Ñandú', 19.99, 3.275],
    ]);

    expect(readXlsxTable(bytes)).toEqual([
      ['Código del producto', 'Nombre del producto', 'Precio de venta', 'Existencias'],
      ['7501', 'Martillo de uña 16 oz', '135.5', '12'],
      ['7502', 'Cable <rojo> & "negro"', '12.5'],
      ['7503', 'Ñandú', '19.99', '3.275'],
    ]);
  });

  it('cleans the binary dust of a number, so 19.989999999999998 is read as 19.99', async () => {
    const bytes = await workbookOf([['Precio'], [0.1 + 0.2], [19.989999999999998], [1500]]);

    expect(readXlsxTable(bytes)).toEqual([['Precio'], ['0.3'], ['19.99'], ['1500']]);
  });

  it('says in Spanish when the file is not a workbook', () => {
    expect(() => readXlsxTable(new TextEncoder().encode('Código,Nombre\n1,Martillo'))).toThrow(WorkbookError);
    expect(() => readXlsxTable(new Uint8Array(10))).toThrow(/no es un libro de Excel/);
  });
});

describe('the columns of a catalog from another point of sale', () => {
  const TITLES = ['Código del producto', 'Nombre del producto', 'Costo con IVA', 'Costo sin IVA', 'Existencias', 'Precio de Venta'];

  it('reads the code, the name, both costs, the stock and the price, whatever the capitals and the accents', async () => {
    const bytes = await workbookOf([TITLES, ['7501', 'Martillo', 116, 100, 8, 174], ['7502', 'Clavo', 58, null, 20, 87]]);

    const reading = parseCatalogTable(readXlsxTable(bytes));

    expect(reading).toMatchObject({
      status: 'read',
      invalid: [],
      rows: [
        // A cost without VAT is used as it comes.
        { code: '7501', name: 'Martillo', unitPriceE4: 1_740_000, unitCostE6: 100_000_000, stockMilli: 8000 },
        // Only the cost with VAT: 58 with the 16 % is 50 without it.
        { code: '7502', name: 'Clavo', unitPriceE4: 870_000, unitCostE6: 50_000_000, stockMilli: 20_000 },
      ],
    });
  });

  it('reads the same columns from a CSV, and prefers the cost without VAT when both come', () => {
    const reading = parseEleventaCatalog('codigo del producto;nombre del producto;costo con iva;costo sin iva;existencias;precio de venta\n1;Foco;23.20;19.50;4;35\n');

    expect(reading).toMatchObject({ status: 'read', rows: [{ code: '1', unitCostE6: 19_500_000, stockMilli: 4000, unitPriceE4: 350_000 }] });
  });

  it('tells how to write the titles when a required one is missing', () => {
    const reading = parseCatalogTable([['Clave interna', 'Algo'], ['1', 'x']]);

    expect(reading.status).toBe('unreadable');
    expect(reading.status === 'unreadable' && reading.message).toContain('Código del producto, Nombre del producto, Precio de venta, Costo con IVA, Costo sin IVA, Existencias');
  });

  it('takes the VAT out of a cost and puts it back, rounding half up', () => {
    const sixteen = { factor: 'rate', rateBp: 1600 } as const;
    expect(costWithoutTaxE6(116_000_000, sixteen)).toBe(100_000_000);
    expect(costWithoutTaxE6(100_000_000, sixteen)).toBe(86_206_897);
    expect(costWithTaxE6(100_000_000, sixteen)).toBe(116_000_000);
    expect(costWithoutTaxE6(50_000_000, { factor: 'exempt', rateBp: 0 })).toBe(50_000_000);
    expect(costWithTaxE6(50_000_000, { factor: 'rate', rateBp: 0 })).toBe(50_000_000);
  });
});
