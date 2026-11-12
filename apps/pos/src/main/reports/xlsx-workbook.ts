import { crc32, deflateRawSync } from 'node:zlib';

/** How a number is shown in Excel. The value itself is written exactly as the decimal text it was given. */
export type NumberFormat = 'integer' | 'money' | 'quantity' | 'percent';

/** One cell: text, or a number kept as exact decimal text so no float ever touches the money. */
export type Cell = string | { readonly decimal: string; readonly format: NumberFormat } | { readonly heading: string };

export interface Sheet {
  /** At most 31 characters, without `[ ] : * ? / \`. */
  readonly name: string;
  readonly rows: readonly (readonly Cell[])[];
  /** Widths of the first columns, in characters. */
  readonly widths?: readonly number[];
}

const STYLE_OF: Readonly<Record<NumberFormat | 'heading', number>> = { integer: 5, money: 1, quantity: 2, percent: 3, heading: 4 };
const DECIMAL_TEXT = /^-?\d+(\.\d+)?$/;
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function escapeXml(text: string): string {
  return text
    .replace(INVALID_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function columnLetters(index: number): string {
  let letters = '';
  for (let rest = index + 1; rest > 0; rest = Math.floor((rest - 1) / 26)) {
    letters = String.fromCharCode(65 + ((rest - 1) % 26)) + letters;
  }
  return letters;
}

function cellXml(cell: Cell, reference: string): string {
  if (typeof cell === 'string') {
    // A text cell is never a formula, whatever it starts with.
    return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell)}</t></is></c>`;
  }
  if ('heading' in cell) {
    return `<c r="${reference}" s="${STYLE_OF.heading}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell.heading)}</t></is></c>`;
  }
  if (!DECIMAL_TEXT.test(cell.decimal)) {
    throw new TypeError(`Not a decimal number: ${cell.decimal}`);
  }
  return `<c r="${reference}" s="${STYLE_OF[cell.format]}"><v>${cell.decimal}</v></c>`;
}

function sheetXml(sheet: Sheet): string {
  const columns =
    sheet.widths === undefined
      ? ''
      : `<cols>${sheet.widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>`;
  const rows = sheet.rows
    .map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((cell, columnIndex) => cellXml(cell, `${columnLetters(columnIndex)}${rowIndex + 1}`)).join('')}</row>`)
    .join('');
  return `${XML_HEADER}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${columns}<sheetData>${rows}</sheetData></worksheet>`;
}

const STYLES_XML = `${XML_HEADER}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="0.000"/><numFmt numFmtId="166" formatCode="0.00&quot;%&quot;"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

interface ZipEntry {
  readonly name: string;
  readonly content: string;
}

/** 1 January 1980, the earliest date of a zip, so the same workbook always has the same bytes. */
const DOS_DATE = 0x21;
const UTF8_FLAG = 0x0800;

function zip(entries: readonly ZipEntry[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const raw = Buffer.from(entry.content, 'utf8');
    const packed = deflateRawSync(raw);
    const checksum = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    chunks.push(local, name, packed);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(UTF8_FLAG, 8);
    header.writeUInt16LE(8, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt16LE(DOS_DATE, 14);
    header.writeUInt32LE(checksum, 16);
    header.writeUInt32LE(packed.length, 20);
    header.writeUInt32LE(raw.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, name);
    offset += local.length + name.length + packed.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, directory, end]);
}

/**
 * Writes an Excel workbook (.xlsx) with no library: a zip of a few XML files. Texts are written as inline strings, so a
 * name that starts with `=` is shown and never evaluated, and numbers are written as the exact decimal text they were
 * given, so a peso amount is never converted through a float (ADR 0060).
 *
 * @param sheets the sheets, in order
 * @returns the bytes of the file
 * @throws TypeError if a sheet name is not valid in Excel or a number is not decimal text
 */
export function buildWorkbook(sheets: readonly Sheet[]): Buffer {
  const names = new Set<string>();
  for (const { name } of sheets) {
    if (name.length === 0 || name.length > 31 || /[[\]:*?/\\]/.test(name) || names.has(name.toLowerCase())) {
      throw new TypeError(`Not a valid sheet name: ${name}`);
    }
    names.add(name.toLowerCase());
  }
  const sheetEntries = sheets.map((sheet, index): ZipEntry => ({ name: `xl/worksheets/sheet${index + 1}.xml`, content: sheetXml(sheet) }));
  const content = (extra: string): string =>
    `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${extra}</Types>`;
  return zip([
    {
      name: '[Content_Types].xml',
      content: content(
        sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join(''),
      ),
    },
    {
      name: '_rels/.rels',
      content: `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      content: `${XML_HEADER}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
        .map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
        .join('')}</sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content: `${XML_HEADER}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`)
        .join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: 'xl/styles.xml', content: STYLES_XML },
    ...sheetEntries,
  ]);
}
