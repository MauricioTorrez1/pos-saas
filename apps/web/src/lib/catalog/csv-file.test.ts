import { describe, expect, it } from 'vitest';
import { decodeCsv, rowErrorsCsv } from './csv-file';

describe('decodeCsv', () => {
  it('reads UTF-8 and drops the byte order mark', () => {
    const bytes = new TextEncoder().encode('﻿Código,Tubería\n');

    expect(decodeCsv(bytes)).toBe('Código,Tubería\n');
  });

  it('falls back to Windows-1252, as Excel saves on Windows', () => {
    // «Tubería» in Windows-1252: í is the single byte 0xED, which is not valid UTF-8 on its own.
    const bytes = new Uint8Array([0x54, 0x75, 0x62, 0x65, 0x72, 0xed, 0x61]);

    expect(decodeCsv(bytes)).toBe('Tubería');
  });
});

describe('rowErrorsCsv', () => {
  it('writes the same columns as report=csv of the core, quoting reasons with commas', () => {
    const csv = rowErrorsCsv([
      { line: 3, reason: 'El precio de venta debe ser mayor que cero.' },
      { line: 7, reason: 'No se entiende la unidad «caja, grande».' },
    ]);

    expect(csv).toBe(
      '﻿linea,motivo\r\n3,El precio de venta debe ser mayor que cero.\r\n7,"No se entiende la unidad «caja, grande»."\r\n',
    );
  });
});
