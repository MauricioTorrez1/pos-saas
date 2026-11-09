import { describe, expect, it } from 'vitest';

import { parseCsv, parseEleventaCatalog } from './eleventa-csv';

describe('parseCsv', () => {
  it('reads commas, semicolons, and tabs, whichever the file uses', () => {
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a;b\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a\tb\n1\t2')).toEqual([['a', 'b'], ['1', '2']]);
  });

  it('keeps a comma, a quote, and a line break inside a quoted field', () => {
    expect(parseCsv('a,b\n"Clavo, 2 1/2""",x\n"uno\ndos",y')).toEqual([['a', 'b'], ['Clavo, 2 1/2"', 'x'], ['uno\ndos', 'y']]);
  });

  it('ignores the byte order mark of Excel and the empty lines', () => {
    expect(parseCsv('﻿a,b\r\n1,2\r\n\r\n')).toEqual([['a', 'b'], ['1', '2']]);
  });
});

const HEADER = 'Código,Descripción,Precio Costo,Precio Venta,Existencia,Unidad';

describe('parseEleventaCatalog', () => {
  it('reads a product with its code, name, price, cost, stock, and unit', () => {
    const result = parseEleventaCatalog(`${HEADER}\n7501,Martillo uña curva,80.50,116.00,12,Pieza`);

    expect(result).toEqual({
      status: 'read',
      rows: [
        { line: 2, code: '7501', name: 'Martillo uña curva', unit: 'piece', unitPriceE4: 1_160_000, unitCostE6: 80_500_000, stockMilli: 12_000, taxRate: { factor: 'rate', rateBp: 1600 } },
      ],
      invalid: [],
    });
  });

  it('finds the columns whatever their capitals, accents, or order, and with the names Eleventa gives them', () => {
    const result = parseEleventaCatalog('PRECIO DE VENTA;DESCRIPCION;CODIGO DE BARRAS\n45.5;Clavo;7502');

    expect(result).toMatchObject({ status: 'read', rows: [{ code: '7502', name: 'Clavo', unitPriceE4: 455_000, unit: 'piece' }] });
  });

  it.each([
    ['Kg', 'kilogram'],
    ['kilo', 'kilogram'],
    ['Granel', 'kilogram'],
    ['m', 'meter'],
    ['Metro', 'meter'],
    ['Lt', 'liter'],
    ['Litro', 'liter'],
    ['pza', 'piece'],
    ['', 'piece'],
  ])('reads the unit %j as %s', (text, unit) => {
    const result = parseEleventaCatalog(`${HEADER}\nA,B,1,2,3,${text}`);

    expect(result).toMatchObject({ status: 'read', rows: [{ unit }] });
  });

  it('reads prices with a peso sign and thousands commas, and the VAT of the product', () => {
    const result = parseEleventaCatalog('Código,Descripción,Precio Venta,IVA\nA,B,"$1,160.50",8\nC,D,10,Exento\nE,F,10,0');

    expect(result).toMatchObject({
      status: 'read',
      rows: [
        { unitPriceE4: 11_605_000, taxRate: { factor: 'rate', rateBp: 800 } },
        { taxRate: { factor: 'exempt', rateBp: 0 } },
        { taxRate: { factor: 'rate', rateBp: 0 } },
      ],
    });
  });

  it('reads stock with decimals for what is measured, and refuses them for pieces', () => {
    const result = parseEleventaCatalog(`${HEADER}\nA,Cable,5,12.5,3.275,m\nB,Martillo,5,12.5,2.5,Pieza`);

    expect(result).toMatchObject({ status: 'read', rows: [{ stockMilli: 3275 }], invalid: [{ line: 3, reason: expect.stringContaining('piezas') }] });
  });

  it('keeps going past a bad row and says which line it is and why', () => {
    const result = parseEleventaCatalog(`${HEADER}\n,Sin código,1,2,3,Pieza\nA,,1,2,3,Pieza\nB,Bien,1,2,3,Pieza\nC,Precio mal,x,abc,3,Pieza\nD,Existencia mal,1,2,mucho,Pieza`);

    expect(result).toMatchObject({ status: 'read', rows: [{ code: 'B' }] });
    expect((result as unknown as { invalid: { line: number; reason: string }[] }).invalid.map(({ line }) => line)).toEqual([2, 3, 5, 6]);
  });

  it('refuses a repeated code inside the same file, because it would post the stock twice', () => {
    const result = parseEleventaCatalog(`${HEADER}\nA,Uno,1,2,3,Pieza\nA,Otra vez,1,2,3,Pieza`);

    expect(result).toMatchObject({ status: 'read', rows: [{ code: 'A', name: 'Uno' }], invalid: [{ line: 3, reason: expect.stringContaining('repetido') }] });
  });

  it('says which column is missing when the file cannot be understood', () => {
    expect(parseEleventaCatalog('Nombre,Algo\nA,B')).toEqual({
      status: 'unreadable',
      message: expect.stringContaining('código'),
    });
    expect(parseEleventaCatalog('')).toEqual({ status: 'unreadable', message: expect.stringContaining('vacío') });
  });

  it('refuses a name or a code that is too long, or that carries control characters', () => {
    const result = parseEleventaCatalog(`${HEADER}\n${'9'.repeat(51)},A,1,2,3,Pieza\nB,${'x'.repeat(121)},1,2,3,Pieza\nC\u0007,D,1,2,3,Pieza`);

    expect((result as unknown as { rows: unknown[] }).rows).toEqual([]);
    expect((result as unknown as { invalid: unknown[] }).invalid).toHaveLength(3);
  });
});
