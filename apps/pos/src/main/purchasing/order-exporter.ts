import { writeFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { formatFolio, type ExportOrderRequest, type ExportOrderResult, type OrderFileFormat, type PurchaseOrder } from '../../shared/supplier-order';
import type { AuditLog } from '../audit/audit-log';
import type { AuthService } from '../auth/auth-service';
import { isRefusal, OwnerGate } from '../auth/owner-gate';
import { buildOrderWorkbook, renderOrderHtml } from './order-document';

/** What the exporter needs from the computer, so the tests can answer without a window or a disk dialog. */
export interface ExportPorts {
  /** Asks where to save the file. Null when the person closed the window. */
  readonly chooseSavePath: (suggestedName: string, format: OrderFileFormat) => Promise<string | null>;
  /** Prints a page of HTML to PDF. */
  readonly renderPdf: (html: string) => Promise<Buffer>;
  /** Shows a file in its folder. */
  readonly revealInFolder: (path: string) => void;
  /** The name of the business, for the header. */
  readonly businessName: () => string;
}

/** The characters Windows does not allow in a file name, and the ones that make a name hard to type. */
const UNSAFE_FILE_CHARACTERS = /[<>:"/\\|?*\u0000-\u001f]+/g;
const MAX_NAME_LENGTH = 80;

/**
 * Makes a file name from an order: the folio and the supplier, with nothing a Windows path would refuse.
 *
 * @param order the order
 * @param format the kind of file
 * @returns a name such as "PED-0007 Ferretera del Centro.xlsx"
 */
export function suggestedFileName(order: Pick<PurchaseOrder, 'folio' | 'supplierName'>, format: OrderFileFormat): string {
  const supplier = order.supplierName.replace(UNSAFE_FILE_CHARACTERS, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH).trim().replace(/[. ]+$/, '');
  return `${formatFolio(order.folio)}${supplier === '' ? '' : ` ${supplier}`}.${format}`;
}

/**
 * Turns an order into a file the owner can mail or send by WhatsApp: an Excel sheet, or a PDF printed by the engine of the
 * app itself. The owner chooses where it is saved with the window of Windows, and may then open that folder. It needs the
 * owner, like everything that takes the costs out of the register, and every file made is written in the audit log. It
 * works with no internet, and it changes nothing of the order.
 */
export class OrderExporter {
  readonly #auth: Pick<AuthService, 'currentUser' | 'authorizeWithOwnerPin'>;
  readonly #audit: Pick<AuditLog, 'record'>;
  readonly #gate: OwnerGate;
  readonly #readOrder: (orderId: string) => PurchaseOrder | null;
  readonly #ports: ExportPorts;
  readonly #savedPaths = new Set<string>();

  /**
   * @param auth who is signed in, and who can approve with a PIN
   * @param audit the audit log
   * @param readOrder reads an order with its lines
   * @param ports what the computer does: ask for a path, print a PDF, show a folder
   */
  constructor(
    auth: Pick<AuthService, 'currentUser' | 'authorizeWithOwnerPin'>,
    audit: Pick<AuditLog, 'record'>,
    readOrder: (orderId: string) => PurchaseOrder | null,
    ports: ExportPorts,
  ) {
    this.#auth = auth;
    this.#audit = audit;
    this.#gate = new OwnerGate(auth, audit);
    this.#readOrder = readOrder;
    this.#ports = ports;
  }

  /**
   * Makes the file of an order.
   *
   * @param request the order, the kind of file and the PIN of an owner when a cashier asks
   * @returns `saved` with the path, `cancelled` if the person closed the window, or why nothing was written. A failure to
   *   write is an answer with a message, because the disk may be full or the folder closed, and that must not look like a bug.
   * @throws Error if nobody is signed in
   */
  async export(request: ExportOrderRequest): Promise<ExportOrderResult> {
    const user = this.#auth.currentUser();
    if (user === null) {
      throw new Error('Exporting an order needs a person signed in');
    }
    const order = this.#readOrder(request.orderId);
    if (order === null) {
      return { status: 'not_found' };
    }
    const approval = this.#gate.authorize({
      user,
      ownerPin: request.ownerPin,
      deniedAction: 'purchase_order.export_denied',
      entity: 'purchase_order',
      entityId: order.id,
      deniedDetail: `tried to export ${formatFolio(order.folio)} as ${request.format}`,
    });
    if (isRefusal(approval)) {
      return approval;
    }
    try {
      const path = await this.#ports.chooseSavePath(suggestedFileName(order, request.format), request.format);
      if (path === null) {
        return { status: 'cancelled' };
      }
      const businessName = this.#ports.businessName();
      const content = request.format === 'xlsx' ? buildOrderWorkbook(order, businessName) : await this.#ports.renderPdf(renderOrderHtml(order, businessName));
      await writeFile(path, content);
      this.#savedPaths.add(path);
      this.#audit.record({
        userId: user.id,
        action: 'purchase_order.export',
        entity: 'purchase_order',
        entityId: order.id,
        detail: `${formatFolio(order.folio)} saved as ${basename(path)}; approved by ${approval.ownerId}`,
      });
      return { status: 'saved', path };
    } catch (error) {
      return { status: 'failed', message: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Shows in its folder a file this register just made. A path the register did not write is ignored, so the screen cannot
   * use this to open anything else.
   *
   * @param path the path `export` answered
   */
  reveal(path: string): void {
    if (this.#savedPaths.has(path)) {
      this.#ports.revealInFolder(path);
    }
  }
}
