import { inflateRawSync } from 'node:zlib';

/**
 * Thrown when a file is not a workbook this reader understands. The message is in Spanish, because the owner reads it.
 */
export class WorkbookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkbookError';
  }
}

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;
/** A list of products never unpacks to more than this, and a file that claims to is refused instead of filling the memory. */
const MAX_UNPACKED_BYTES = 64 * 1024 * 1024;
/** Excel keeps numbers as binary fractions, so 19.99 may come as 19.989999999999998. Prices carry four decimals at most. */
const DECIMALS_KEPT = 4;

interface ZipEntry {
  readonly name: string;
  readonly method: number;
  readonly packedSize: number;
  readonly unpackedSize: number;
  readonly headerOffset: number;
}

/**
 * Reads the first sheet of an Excel workbook (.xlsx) as a table of text. It needs no library: a workbook is a zip of XML
 * files, and Node unpacks them. Formulas give their last saved value, and dates come as the number Excel keeps.
 *
 * @param bytes the whole file
 * @returns the rows of the first sheet, each one a list of cells; a missing cell is an empty text
 * @throws WorkbookError if the file is not a workbook, is damaged, or is too large
 */
export function readXlsxTable(bytes: Uint8Array): string[][] {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = readDirectory(buffer);
  const sheet = pickFirstSheet(entries);
  if (sheet === undefined) {
    throw new WorkbookError('El archivo no trae ninguna hoja. Guárdalo de nuevo como Libro de Excel (.xlsx).');
  }
  const sharedEntry = entries.find((entry) => entry.name === 'xl/sharedStrings.xml');
  const shared = sharedEntry === undefined ? [] : readSharedStrings(unpack(buffer, sharedEntry).toString('utf8'));
  return readSheet(unpack(buffer, sheet).toString('utf8'), shared);
}

function readDirectory(buffer: Buffer): ZipEntry[] {
  // The end record sits at the tail, after an optional comment of up to 65,535 bytes.
  const earliest = Math.max(0, buffer.length - 22 - 0xffff);
  let end = -1;
  for (let offset = buffer.length - 22; offset >= earliest; offset -= 1) {
    if (buffer.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) {
      end = offset;
      break;
    }
  }
  if (end === -1) {
    throw new WorkbookError('El archivo no es un libro de Excel (.xlsx). Si es de Excel antiguo (.xls), guárdalo como .xlsx o como CSV.');
  }
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CENTRAL_FILE_HEADER) {
      throw new WorkbookError('El archivo de Excel está dañado. Ábrelo en Excel y guárdalo de nuevo.');
    }
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    entries.push({
      name: buffer.toString('utf8', offset + 46, offset + 46 + nameLength),
      method: buffer.readUInt16LE(offset + 10),
      packedSize: buffer.readUInt32LE(offset + 20),
      unpackedSize: buffer.readUInt32LE(offset + 24),
      headerOffset: buffer.readUInt32LE(offset + 42),
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function pickFirstSheet(entries: readonly ZipEntry[]): ZipEntry | undefined {
  const sheets = entries.filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/u.test(entry.name));
  const numberOf = (entry: ZipEntry): number => Number(/sheet(\d+)\.xml$/u.exec(entry.name)![1]);
  return sheets.sort((first, second) => numberOf(first) - numberOf(second))[0];
}

function unpack(buffer: Buffer, entry: ZipEntry): Buffer {
  if (entry.unpackedSize > MAX_UNPACKED_BYTES) {
    throw new WorkbookError('La hoja es demasiado grande para ser una lista de productos.');
  }
  const header = entry.headerOffset;
  if (header + 30 > buffer.length || buffer.readUInt32LE(header) !== LOCAL_FILE_HEADER) {
    throw new WorkbookError('El archivo de Excel está dañado. Ábrelo en Excel y guárdalo de nuevo.');
  }
  const start = header + 30 + buffer.readUInt16LE(header + 26) + buffer.readUInt16LE(header + 28);
  const packed = buffer.subarray(start, start + entry.packedSize);
  if (entry.method === STORED) {
    return packed;
  }
  if (entry.method !== DEFLATED) {
    throw new WorkbookError('El archivo de Excel usa una compresión que la caja no lee. Guárdalo de nuevo como .xlsx.');
  }
  try {
    return inflateRawSync(packed, { maxOutputLength: MAX_UNPACKED_BYTES });
  } catch {
    throw new WorkbookError('El archivo de Excel está dañado o es demasiado grande.');
  }
}

function readSharedStrings(xml: string): string[] {
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/gu)].map(([, body]) => textOf(body ?? ''));
}

/** Joins every text run of a string item. Phonetic guides (rPh) are not part of what the cell shows. */
function textOf(xml: string): string {
  const visible = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/gu, '');
  return [...visible.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gu)].map(([, text]) => unescapeXml(text ?? '')).join('');
}

function readSheet(xml: string, shared: readonly string[]): string[][] {
  const table: string[][] = [];
  for (const [, rowXml] of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gu)) {
    const row: string[] = [];
    let next = 0;
    for (const [, attributes, body] of (rowXml ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/gu)) {
      const reference = /\br="([A-Z]+)\d+"/u.exec(attributes ?? '')?.[1];
      const column = reference === undefined ? next : columnIndex(reference);
      next = column + 1;
      while (row.length < column) {
        row.push('');
      }
      row[column] = cellText(attributes ?? '', body ?? '', shared);
    }
    table.push(row);
  }
  return table.filter((fields) => fields.some((value) => value.trim() !== ''));
}

function cellText(attributes: string, body: string, shared: readonly string[]): string {
  const type = /\bt="([^"]+)"/u.exec(attributes)?.[1];
  if (type === 'inlineStr') {
    return textOf(body);
  }
  const value = /<v\b[^>]*>([\s\S]*?)<\/v>/u.exec(body)?.[1];
  if (value === undefined) {
    return '';
  }
  if (type === 's') {
    return shared[Number(value)] ?? '';
  }
  if (type === 'str' || type === 'b' || type === 'e') {
    return unescapeXml(value);
  }
  return tidyNumber(value);
}

/**
 * Cleans a number as Excel stores it. 19.989999999999998 and 1.5E2 become 19.99 and 150, which is what the owner typed.
 * Text that is not a number is returned untouched.
 */
function tidyNumber(text: string): string {
  const trimmed = text.trim();
  if (!/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/u.test(trimmed)) {
    return trimmed;
  }
  if (/^-?\d+(\.\d{1,4})?$/u.test(trimmed)) {
    return trimmed;
  }
  const rounded = Number(trimmed).toFixed(DECIMALS_KEPT);
  return rounded.includes('.') ? rounded.replace(/0+$/u, '').replace(/\.$/u, '') : rounded;
}

function columnIndex(letters: string): number {
  let index = 0;
  for (const letter of letters) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }
  return index - 1;
}

function unescapeXml(text: string): string {
  return text
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&#x([0-9a-fA-F]+);/gu, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/gu, (_, decimal: string) => String.fromCodePoint(Number(decimal)))
    .replace(/&amp;/gu, '&');
}
