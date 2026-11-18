import type { ImportRowError } from './types';

/**
 * Decodes the bytes of a CSV file. Excel and Eleventa on Windows often save in Windows-1252 instead of UTF-8, which
 * would turn «Tubería» into «TuberÃ­a». So it tries strict UTF-8 first and falls back to Windows-1252.
 *
 * @param bytes - The file as it was read from disk.
 * @returns The text, without a UTF-8 byte order mark.
 */
export function decodeCsv(bytes: Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('windows-1252').decode(bytes);
  }
  return text.startsWith('﻿') ? text.slice(1) : text;
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Writes the rows that were not loaded as a CSV file with the same columns as `report=csv` of the core
 * (`linea,motivo`), so the owner can fix them in Excel. It starts with a byte order mark so Excel reads the accents.
 *
 * @param rows - The rows of the report.
 */
export function rowErrorsCsv(rows: readonly ImportRowError[]): string {
  const body = rows.map((row) => `${row.line},${csvCell(row.reason)}`).join('\r\n');
  return `﻿linea,motivo\r\n${body}${rows.length > 0 ? '\r\n' : ''}`;
}
