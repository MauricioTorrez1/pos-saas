import { crc32, deflateRawSync } from 'node:zlib';

/** How a number is shown in Excel. The value itself is written exactly as the decimal text it was given. */
export type NumberFormat = 'integer' | 'money' | 'quantity' | 'percent';

/** How a cell looks. Every field is optional, and a cell without style is plain Calibri 11. */
export interface CellStyle {
  readonly bold?: boolean;
  /** Font size in points; 11 when missing. */
  readonly size?: number;
  /** Solid background, as six hexadecimal digits such as `EEEEEE`. */
  readonly fill?: string;
  readonly bottomBorder?: boolean;
  readonly alignRight?: boolean;
  /** An Excel number format code, such as `@` (text) or `"$"#,##0.00`. */
  readonly numFormat?: string;
}

/**
 * One cell. A string is a text and a `decimal` is a number kept as exact decimal text, so no float ever touches the money.
 * `null` leaves the cell empty, and `heading` is a bold text.
 */
export type Cell =
  | string
  | null
  | { readonly heading: string }
  | { readonly text: string; readonly style: CellStyle }
  | { readonly decimal: string; readonly format: NumberFormat | { readonly code: string }; readonly style?: CellStyle };

export interface Sheet {
  /** At most 31 characters, without `[ ] : * ? / \`. */
  readonly name: string;
  readonly rows: readonly (readonly Cell[])[];
  /** Widths of the first columns, in characters. */
  readonly widths?: readonly number[];
  /** How many rows at the top stay in view while the rest scrolls. */
  readonly frozenRows?: number;
  /** Prints on A4 portrait, one page wide and as many pages tall as needed. */
  readonly fitToPageWidth?: boolean;
}

/** What the file says about itself, in the properties of the document. */
export interface WorkbookProperties {
  readonly creator?: string;
  readonly created?: Date;
}

const NUMBER_FORMAT_CODES: Readonly<Record<NumberFormat, string>> = { integer: '0', money: '#,##0.00', quantity: '0.000', percent: '0.00"%"' };
/** The formats Excel already knows by number; any other code is declared in the file. */
const BUILT_IN_FORMAT_IDS: Readonly<Record<string, number>> = { General: 0, '0': 1, '0.00': 2, '#,##0': 3, '#,##0.00': 4, '@': 49 };
const FIRST_CUSTOM_FORMAT_ID = 164;
const HEADING_STYLE: CellStyle = { bold: true };
const DEFAULT_FONT_SIZE = 11;
const DECIMAL_TEXT = /^-?\d+(\.\d+)?$/;
const HEX_COLOR = /^[0-9A-Fa-f]{6}$/;
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL_TYPE = 'http://schemas.openxmlformats.org/package/2006/relationships';

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

/** Hands out the position of each distinct font, fill, border, number format and combination of them, as a styles part needs. */
class StyleBook {
  readonly #fonts: string[] = [fontXml(HEADING_STYLE.size, false)];
  readonly #fills: string[] = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
  readonly #borders: string[] = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
  readonly #formats: string[] = [];
  readonly #cellFormats: string[] = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];

  /** @returns the index of the cell format for this style, which is 0 (plain) when the style says nothing */
  indexOf(style: CellStyle): number {
    const font = style.bold === true || (style.size ?? DEFAULT_FONT_SIZE) !== DEFAULT_FONT_SIZE ? StyleBook.#intern(this.#fonts, fontXml(style.size, style.bold === true)) : 0;
    const fill = style.fill === undefined ? 0 : StyleBook.#intern(this.#fills, fillXml(style.fill));
    const border = style.bottomBorder === true ? StyleBook.#intern(this.#borders, '<border><left/><right/><top/><bottom style="thin"><color auto="1"/></bottom><diagonal/></border>') : 0;
    const format = style.numFormat === undefined ? 0 : this.#formatId(style.numFormat);
    const alignment = style.alignRight === true ? '<alignment horizontal="right"/>' : '';
    if (font === 0 && fill === 0 && border === 0 && format === 0 && alignment === '') {
      return 0;
    }
    const flags = `${format === 0 ? '' : ' applyNumberFormat="1"'}${font === 0 ? '' : ' applyFont="1"'}${fill === 0 ? '' : ' applyFill="1"'}${border === 0 ? '' : ' applyBorder="1"'}${alignment === '' ? '' : ' applyAlignment="1"'}`;
    const open = `<xf numFmtId="${format}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"${flags}`;
    return StyleBook.#intern(this.#cellFormats, alignment === '' ? `${open}/>` : `${open}>${alignment}</xf>`);
  }

  #formatId(code: string): number {
    const builtIn = BUILT_IN_FORMAT_IDS[code];
    if (builtIn !== undefined) {
      return builtIn;
    }
    return FIRST_CUSTOM_FORMAT_ID + StyleBook.#intern(this.#formats, `formatCode="${escapeXml(code)}"`);
  }

  static #intern(list: string[], xml: string): number {
    const found = list.indexOf(xml);
    if (found >= 0) {
      return found;
    }
    list.push(xml);
    return list.length - 1;
  }

  /** @returns the whole styles part */
  xml(): string {
    const formats = this.#formats.map((attribute, index) => `<numFmt numFmtId="${FIRST_CUSTOM_FORMAT_ID + index}" ${attribute}/>`).join('');
    return `${XML_HEADER}<styleSheet xmlns="${MAIN_NS}">${formats === '' ? '' : `<numFmts count="${this.#formats.length}">${formats}</numFmts>`}<fonts count="${this.#fonts.length}">${this.#fonts.join('')}</fonts><fills count="${this.#fills.length}">${this.#fills.join('')}</fills><borders count="${this.#borders.length}">${this.#borders.join('')}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${this.#cellFormats.length}">${this.#cellFormats.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  }
}

function fontXml(size: number | undefined, bold: boolean): string {
  return `<font>${bold ? '<b/>' : ''}<sz val="${size ?? DEFAULT_FONT_SIZE}"/><name val="Calibri"/></font>`;
}

function fillXml(color: string): string {
  if (!HEX_COLOR.test(color)) {
    throw new TypeError(`Not a color of six hexadecimal digits: ${color}`);
  }
  return `<fill><patternFill patternType="solid"><fgColor rgb="FF${color.toUpperCase()}"/><bgColor indexed="64"/></patternFill></fill>`;
}

/** A text is always an inline string, so a name that starts with `=` is shown and never evaluated. */
function textXml(reference: string, text: string, styleIndex: number): string {
  const style = styleIndex === 0 ? '' : ` s="${styleIndex}"`;
  return `<c r="${reference}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(text)}</t></is></c>`;
}

function cellXml(cell: Cell, reference: string, styles: StyleBook): string {
  if (cell === null) {
    return '';
  }
  if (typeof cell === 'string') {
    return textXml(reference, cell, 0);
  }
  if ('heading' in cell) {
    return textXml(reference, cell.heading, styles.indexOf(HEADING_STYLE));
  }
  if ('text' in cell) {
    return textXml(reference, cell.text, styles.indexOf(cell.style));
  }
  if (!DECIMAL_TEXT.test(cell.decimal)) {
    throw new TypeError(`Not a decimal number: ${cell.decimal}`);
  }
  const code = typeof cell.format === 'string' ? NUMBER_FORMAT_CODES[cell.format] : cell.format.code;
  const styleIndex = styles.indexOf({ ...cell.style, numFormat: code });
  return `<c r="${reference}" s="${styleIndex}"><v>${cell.decimal}</v></c>`;
}

function sheetXml(sheet: Sheet, styles: StyleBook): string {
  const fitToPage = sheet.fitToPageWidth === true;
  const frozen = sheet.frozenRows ?? 0;
  const properties = fitToPage ? '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>' : '';
  const views =
    frozen > 0
      ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${frozen}" topLeftCell="A${frozen + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/></sheetView></sheetViews>`
      : '';
  const columns =
    sheet.widths === undefined
      ? ''
      : `<cols>${sheet.widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>`;
  const rows = sheet.rows
    .map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((cell, columnIndex) => cellXml(cell, `${columnLetters(columnIndex)}${rowIndex + 1}`, styles)).join('')}</row>`)
    .join('');
  const page = fitToPage ? '<pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="0"/>' : '';
  return `${XML_HEADER}<worksheet xmlns="${MAIN_NS}">${properties}${views}${columns}<sheetData>${rows}</sheetData>${page}</worksheet>`;
}

function corePropertiesXml(properties: WorkbookProperties): string {
  const creator = properties.creator === undefined ? '' : `<dc:creator>${escapeXml(properties.creator)}</dc:creator>`;
  const created = properties.created === undefined ? '' : `<dcterms:created xsi:type="dcterms:W3CDTF">${properties.created.toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created>`;
  return `${XML_HEADER}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${creator}${created}</cp:coreProperties>`;
}

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
 * Writes an Excel workbook (.xlsx) with no library: a zip of a few XML files. This is the only writer of spreadsheets of
 * the register. Texts are written as inline strings, so a name that starts with `=` is shown and never evaluated, and
 * numbers are written as the exact decimal text they were given, so a peso amount is never converted through a float
 * (ADR 0060). The same sheets always give the same bytes.
 *
 * @param sheets the sheets, in order
 * @param properties who made the file and when, for the properties of the document; nothing is written when missing
 * @returns the bytes of the file
 * @throws TypeError if a sheet name is not valid in Excel, a number is not decimal text or a color is not hexadecimal
 */
export function buildWorkbook(sheets: readonly Sheet[], properties?: WorkbookProperties): Buffer {
  const names = new Set<string>();
  for (const { name } of sheets) {
    if (name.length === 0 || name.length > 31 || /[[\]:*?/\\]/.test(name) || names.has(name.toLowerCase())) {
      throw new TypeError(`Not a valid sheet name: ${name}`);
    }
    names.add(name.toLowerCase());
  }
  const styles = new StyleBook();
  const sheetEntries = sheets.map((sheet, index): ZipEntry => ({ name: `xl/worksheets/sheet${index + 1}.xml`, content: sheetXml(sheet, styles) }));
  const hasProperties = properties?.creator !== undefined || properties?.created !== undefined;
  const contentTypes = `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets
    .map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
    .join('')}${hasProperties ? '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' : ''}</Types>`;
  const propertiesRelationship = hasProperties
    ? `<Relationship Id="rId2" Type="${PACKAGE_REL_TYPE}/metadata/core-properties" Target="docProps/core.xml"/>`
    : '';
  return zip([
    { name: '[Content_Types].xml', content: contentTypes },
    {
      name: '_rels/.rels',
      content: `${XML_HEADER}<Relationships xmlns="${PACKAGE_REL_TYPE}"><Relationship Id="rId1" Type="${REL_TYPE}/officeDocument" Target="xl/workbook.xml"/>${propertiesRelationship}</Relationships>`,
    },
    ...(hasProperties ? [{ name: 'docProps/core.xml', content: corePropertiesXml(properties) }] : []),
    {
      name: 'xl/workbook.xml',
      content: `${XML_HEADER}<workbook xmlns="${MAIN_NS}" xmlns:r="${REL_NS}"><bookViews><workbookView/></bookViews><sheets>${sheets
        .map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
        .join('')}</sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content: `${XML_HEADER}<Relationships xmlns="${PACKAGE_REL_TYPE}">${sheets
        .map((_, index) => `<Relationship Id="rId${index + 1}" Type="${REL_TYPE}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`)
        .join('')}<Relationship Id="rId${sheets.length + 1}" Type="${REL_TYPE}/styles" Target="styles.xml"/></Relationships>`,
    },
    { name: 'xl/styles.xml', content: styles.xml() },
    ...sheetEntries,
  ]);
}
