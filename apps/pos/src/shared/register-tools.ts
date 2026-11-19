/**
 * What the owner tunes at the register besides its colors: the keys of each action, how the ticket looks, and the
 * printer it goes to. It also carries the list of recent sales, which is where a past sale is cancelled from.
 */

/** Every action of the sale screen that answers to a key. The order is the order of the settings screen. */
export const KEY_ACTIONS = [
  'checkout',
  'misc',
  'linePrice',
  'cancelSale',
  'newProduct',
  'productPanel',
  'cash',
  'returns',
  'salesHistory',
  'reprint',
  'dashboard',
  'supplierOrder',
  'missingItems',
  'admin',
  'appearance',
  'settings',
  'signOut',
] as const;

export type KeyAction = (typeof KEY_ACTIONS)[number];

/** The keys of the register, by action. A key is written as it is shown: `F12`, `Shift+F11`, `Ctrl+P`. */
export type Keymap = Readonly<Record<KeyAction, string>>;

export const KEY_ACTION_LABELS: Readonly<Record<KeyAction, string>> = {
  checkout: 'Cobrar',
  misc: 'Varios',
  linePrice: 'Precio en esta venta',
  cancelSale: 'Cancelar venta',
  newProduct: 'Producto nuevo',
  productPanel: 'Producto',
  cash: 'Caja',
  returns: 'Devolución',
  salesHistory: 'Ventas',
  reprint: 'Reimprimir',
  dashboard: 'Resumen',
  supplierOrder: 'Pedido',
  missingItems: 'Faltantes',
  admin: 'Administración',
  appearance: 'Apariencia',
  settings: 'Ajustes',
  signOut: 'Salir',
};

export const DEFAULT_KEYMAP: Keymap = {
  checkout: 'F12',
  misc: 'F2',
  linePrice: 'F7',
  cancelSale: 'Shift+Delete',
  newProduct: 'F5',
  productPanel: 'F10',
  cash: 'F3',
  returns: 'F4',
  salesHistory: 'Shift+F4',
  reprint: 'F8',
  dashboard: 'F11',
  supplierOrder: 'Shift+F11',
  missingItems: 'Shift+F2',
  admin: 'F1',
  appearance: 'F9',
  settings: 'Shift+F9',
  signOut: 'F6',
};

const FUNCTION_KEY = /^F([1-9]|1[0-2])$/u;
const LETTER_OR_DIGIT = /^[A-Z0-9]$/u;
const NAVIGATION_KEYS = ['Delete', 'Insert', 'Home', 'End', 'PageUp', 'PageDown'] as const;

/** What the keyboard tells about a key press. A KeyboardEvent of the browser fits it. */
export interface KeyPress {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

/**
 * Writes a key press the way the keymap stores it.
 *
 * @param press the key and its modifiers
 * @returns the combination, such as `Shift+F11`, or null when the key cannot be a shortcut
 */
export function comboOf({ key, ctrlKey, altKey, shiftKey }: KeyPress): string | null {
  const name = key.length === 1 ? key.toUpperCase() : key;
  const combo = `${ctrlKey ? 'Ctrl+' : ''}${altKey ? 'Alt+' : ''}${shiftKey ? 'Shift+' : ''}${name}`;
  return problemWithCombo(combo) === null ? combo : null;
}

/**
 * Says why a combination cannot be a shortcut. Letters and digits need Ctrl or Alt, because alone they are what the
 * cashier types and what the scanner sends. Enter, Esc, the arrows, plus and minus keep their meaning in the sale.
 *
 * @param combo the combination as text
 * @returns the problem in Spanish, or null when it can be used
 */
export function problemWithCombo(combo: string): string | null {
  const parts = combo.split('+');
  const key = parts.pop() ?? '';
  const modifiers = parts;
  if (modifiers.some((modifier, index) => !['Ctrl', 'Alt', 'Shift'].includes(modifier) || modifiers.indexOf(modifier) !== index)) {
    return 'Usa una tecla de función (F1 a F12), sola o con Ctrl, Alt o Mayús.';
  }
  if (FUNCTION_KEY.test(key)) {
    return null;
  }
  if (LETTER_OR_DIGIT.test(key)) {
    return modifiers.includes('Ctrl') || modifiers.includes('Alt') ? null : 'Una letra o un número necesita Ctrl o Alt, porque sola se escribe en la búsqueda.';
  }
  if ((NAVIGATION_KEYS as readonly string[]).includes(key)) {
    return modifiers.length > 0 ? null : 'Esa tecla sola ya hace otra cosa en la venta. Combínala con Ctrl, Alt o Mayús.';
  }
  return 'Usa una tecla de función (F1 a F12), sola o con Ctrl, Alt o Mayús.';
}

/**
 * Checks a keymap that came from the screen or from the database.
 *
 * @param value anything
 * @returns whether it names every action once, with a usable key each, and no key twice
 */
export function isKeymap(value: unknown): value is Keymap {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== KEY_ACTIONS.length) {
    return false;
  }
  const combos = KEY_ACTIONS.map((action) => record[action]);
  return combos.every((combo) => typeof combo === 'string' && problemWithCombo(combo) === null) && new Set(combos).size === combos.length;
}

/**
 * Finds the action of a key press.
 *
 * @param keymap the keys of the register
 * @param press the key and its modifiers
 * @returns the action, or null when the key has none
 */
export function actionOf(keymap: Keymap, press: KeyPress): KeyAction | null {
  const combo = comboOf(press);
  return combo === null ? null : (KEY_ACTIONS.find((action) => keymap[action] === combo) ?? null);
}

/** @returns the combination as the screen shows it, with Mayús for Shift and Supr for Delete */
export function comboLabel(combo: string): string {
  return combo.replace('Shift', 'Mayús').replace('Delete', 'Supr').replace('Insert', 'Ins').replace('PageUp', 'RePág').replace('PageDown', 'AvPág').replace(/\+/gu, ' ');
}

/** How many characters fit in a line of each paper: 58 mm, 72 mm and 80 mm. */
export const TICKET_COLUMN_CHOICES = [32, 42, 48] as const;
export type TicketColumns = (typeof TICKET_COLUMN_CHOICES)[number];

/** The two fonts of a thermal printer: A is the usual one, B is narrower and fits a third more letters in a line. */
export const TICKET_FONT_CHOICES = ['a', 'b'] as const;
export type TicketFont = (typeof TICKET_FONT_CHOICES)[number];

/** The size of the letters: as the printer comes, twice as tall, or twice as tall and twice as wide. */
export const TICKET_TEXT_SIZE_CHOICES = ['normal', 'tall', 'large'] as const;
export type TicketTextSize = (typeof TICKET_TEXT_SIZE_CHOICES)[number];

/** How many letters of font B fit where font A fits 32, 42 or 48. */
const FONT_B_COLUMNS: Readonly<Record<TicketColumns, number>> = { 32: 42, 42: 56, 48: 64 };

/** How many times wider and taller than normal each size prints a letter. */
export const TEXT_SIZE_SCALE: Readonly<Record<TicketTextSize, { readonly width: number; readonly height: number }>> = {
  normal: { width: 1, height: 1 },
  tall: { width: 1, height: 2 },
  large: { width: 2, height: 2 },
};

/**
 * Counts the letters that fit in a line of the ticket with its paper, its font and its size.
 *
 * @param design how the ticket looks
 * @param isBig whether the line is the big total, which prints twice as wide as the rest
 * @returns the letters of one line
 */
export function ticketLineWidth(design: Pick<TicketDesign, 'columns' | 'font' | 'textSize'>, isBig = false): number {
  const letters = design.font === 'b' ? FONT_B_COLUMNS[design.columns] : design.columns;
  return Math.floor(letters / (TEXT_SIZE_SCALE[design.textSize].width * (isBig ? 2 : 1)));
}

export const MAX_TICKET_EXTRA_LINES = 4;
export const MAX_TICKET_BUSINESS_NAME = 40;

/** How the ticket writes an amount: `$12.50`, `$12.50 MXN` or `MXN 12.50`. The amount is always in pesos. */
export const TICKET_CURRENCY_CHOICES = ['symbol', 'symbol_code', 'code'] as const;
export type TicketCurrency = (typeof TICKET_CURRENCY_CHOICES)[number];

const CURRENCY_CODE = 'MXN';

/**
 * Writes an amount already formatted with the peso sign the way the ticket design asks for.
 *
 * @param amount an amount such as `$1,234.50`
 * @param currency how the owner wants the currency shown
 * @returns the amount with the sign, the code, or both
 */
export function withCurrency(amount: string, currency: TicketCurrency): string {
  switch (currency) {
    case 'symbol':
      return amount;
    case 'symbol_code':
      return `${amount} ${CURRENCY_CODE}`;
    case 'code':
      return `${CURRENCY_CODE} ${amount.replace(/^\$/u, '')}`;
  }
}
export const MAX_TICKET_COPIES = 3;

/**
 * What the register does with the ticket once a sale is recorded (ADR 0075): ask the cashier, print it every time, or
 * never print it. The sale is saved first whatever the choice, so the answer only decides the paper.
 */
export const TICKET_PRINT_POLICY_CHOICES = ['ask', 'always', 'never'] as const;
export type TicketPrintPolicy = (typeof TICKET_PRINT_POLICY_CHOICES)[number];

/** How the ticket looks. The owner changes it from the settings and sees it before saving. */
export interface TicketDesign {
  /** The name printed at the top. Empty means the name of the business as the register knows it. */
  readonly businessName: string;
  /** How the amounts show the currency. */
  readonly currency: TicketCurrency;
  /** Lines under the name of the business: address, phone, RFC. */
  readonly headerLines: readonly string[];
  /** Lines at the foot: thanks, return policy, social networks. */
  readonly footerLines: readonly string[];
  readonly columns: TicketColumns;
  /** The font of the printer. */
  readonly font: TicketFont;
  /** The size of every letter of the ticket. */
  readonly textSize: TicketTextSize;
  /** Whether each product shows its quantity and its unit price under its name. */
  readonly showUnitPrice: boolean;
  /** Whether the subtotal and each VAT are listed above the total. */
  readonly showTaxBreakdown: boolean;
  /** Whether the total is printed in double size. */
  readonly bigTotal: boolean;
  /** How many tickets come out for each sale. */
  readonly copies: number;
  /** Whether a sale asks before printing, always prints, or never prints. */
  readonly printPolicy: TicketPrintPolicy;
}

/**
 * The ticket as it was before it could be designed, so a register that never opened the settings prints the same. The
 * one exception is the print policy: a sale asks before printing (E1-59), and a design saved before the policy existed
 * reads as asking too.
 */
export const DEFAULT_TICKET_DESIGN: TicketDesign = {
  businessName: '',
  currency: 'symbol',
  headerLines: [],
  footerLines: ['Gracias por su compra'],
  columns: 48,
  font: 'a',
  textSize: 'normal',
  showUnitPrice: true,
  showTaxBreakdown: true,
  bigTotal: false,
  copies: 1,
  printPolicy: 'ask',
};

function isLineList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_TICKET_EXTRA_LINES &&
    value.every((line) => typeof line === 'string' && line.length <= 48 && !/[\u0000-\u001f]/u.test(line))
  );
}

/**
 * Checks a ticket design that came from the screen or from the database.
 *
 * @param value anything
 * @returns whether it is a complete design with allowed values
 */
export function isTicketDesign(value: unknown): value is TicketDesign {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { businessName, currency, headerLines, footerLines, columns, font, textSize, showUnitPrice, showTaxBreakdown, bigTotal, copies, printPolicy } =
    value as Record<string, unknown>;
  return (
    typeof businessName === 'string' &&
    businessName.length <= MAX_TICKET_BUSINESS_NAME &&
    !/[\u0000-\u001f]/u.test(businessName) &&
    (TICKET_CURRENCY_CHOICES as readonly unknown[]).includes(currency) &&
    isLineList(headerLines) &&
    isLineList(footerLines) &&
    (TICKET_COLUMN_CHOICES as readonly unknown[]).includes(columns) &&
    (TICKET_FONT_CHOICES as readonly unknown[]).includes(font) &&
    (TICKET_TEXT_SIZE_CHOICES as readonly unknown[]).includes(textSize) &&
    typeof showUnitPrice === 'boolean' &&
    typeof showTaxBreakdown === 'boolean' &&
    typeof bigTotal === 'boolean' &&
    typeof copies === 'number' &&
    Number.isInteger(copies) &&
    copies >= 1 &&
    copies <= MAX_TICKET_COPIES &&
    (TICKET_PRINT_POLICY_CHOICES as readonly unknown[]).includes(printPolicy)
  );
}

const SHARED_PRINTER_PATH = /^\\\\[^\\/]+\\[^\\/]+$/u;
const SHARE_NAME = /^[^\\/\u0000-\u001f]{1,80}$/u;

/**
 * Reads what the owner typed as the printer. Windows shares a ticket printer under a name, and the register sends the
 * ticket to `\\computer\name`. A bare name means a printer shared by this same computer.
 *
 * @param text what was typed
 * @returns the path of the shared printer, an empty text for no printer, or null when it cannot be one
 */
export function normalizePrinterShare(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === '') {
    return '';
  }
  if (SHARED_PRINTER_PATH.test(trimmed)) {
    return trimmed;
  }
  return SHARE_NAME.test(trimmed) ? `\\\\localhost\\${trimmed}` : null;
}

/** One sale of the list of recent sales. */
export interface SaleSummary {
  readonly saleId: string;
  readonly folio: string;
  readonly completedAt: string;
  readonly totalCents: number;
  /** What already went back to the customer. Equal to the total when the sale was cancelled whole. */
  readonly refundedCents: number;
  readonly cashierName: string | null;
  readonly lineCount: number;
  /** The products of the sale that matched a search by name or code, in the order of the ticket. Empty otherwise. */
  readonly matchedProducts: readonly string[];
  /** False when the cashier chose not to print its ticket and it was not printed since (E1-59). */
  readonly ticketPrinted: boolean;
}

export type TestPrintResult = { readonly status: 'printed' } | { readonly status: 'no_printer' } | { readonly status: 'failed'; readonly message: string };

export type SavePrinterResult = { readonly status: 'saved'; readonly share: string } | { readonly status: 'invalid' };

export const TOOLS_CHANNELS = {
  getKeymap: 'tools:get-keymap',
  saveKeymap: 'tools:save-keymap',
  getTicketDesign: 'tools:get-ticket-design',
  saveTicketDesign: 'tools:save-ticket-design',
  previewTicket: 'tools:preview-ticket',
  getPrinter: 'tools:get-printer',
  savePrinter: 'tools:save-printer',
  testPrint: 'tools:test-print',
  listRecentSales: 'tools:list-recent-sales',
  recordSaleCancelled: 'tools:record-sale-cancelled',
} as const;

/** The bridge of the register tools. It is its own bridge, so the register bridge stays as it was. */
export interface ToolsApi {
  /** @returns the keys of the register */
  getKeymap(): Promise<Keymap>;

  /** Saves the keys. Only the owner can. */
  saveKeymap(keymap: Keymap): Promise<void>;

  /** @returns how the ticket looks */
  getTicketDesign(): Promise<TicketDesign>;

  /** Saves how the ticket looks. Only the owner can. */
  saveTicketDesign(design: TicketDesign): Promise<void>;

  /**
   * Draws a sample ticket with a design that is not saved yet.
   *
   * @param design the design being edited
   * @returns the lines of the ticket, as the printer would print them
   */
  previewTicket(design: TicketDesign): Promise<readonly string[]>;

  /** @returns the path of the shared printer, or an empty text when there is none */
  getPrinter(): Promise<string>;

  /** Saves the printer. Only the owner can. */
  savePrinter(share: string): Promise<SavePrinterResult>;

  /** Prints a sample ticket with the saved design. */
  testPrint(): Promise<TestPrintResult>;

  /**
   * Lists completed sales, the newest first: by folio, by the name of a product sold, or by its code.
   *
   * @param text a folio or part of it, part of a product name, a code, or an empty text for the latest
   */
  listRecentSales(text: string): Promise<readonly SaleSummary[]>;

  /** Leaves in the audit log that a sale being rung up was dropped, with what it held. */
  recordSaleCancelled(request: { readonly lineCount: number; readonly totalCents: number }): Promise<void>;
}
