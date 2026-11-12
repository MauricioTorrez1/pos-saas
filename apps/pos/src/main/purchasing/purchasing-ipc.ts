import {
  PURCHASING_CHANNELS,
  type DiscardOrderResult,
  type ExportOrderResult,
  type MarkOrderSentResult,
  type OrderCandidate,
  type PurchaseOrder,
  type PurchaseOrderSummary,
  type SaveOrderResult,
  type SaveSupplierResult,
  type SetReorderLevelResult,
  type SetSupplierCodesResult,
  type Supplier,
  type SupplierProductLink,
} from '../../shared/supplier-order';
import { parseProductId } from '../inventory/inventory-request';
import type { OrderExporter } from './order-exporter';
import type { PurchaseOrderService } from './purchase-order-service';
import {
  parseExportOrderRequest,
  parseOrderActionRequest,
  parsePath,
  parseSaveOrderRequest,
  parseSaveSupplierRequest,
  parseSearchOrderProductsRequest,
  parseSetReorderLevelRequest,
  parseSetSupplierCodesRequest,
  parseUuid,
} from './purchasing-request';
import type { SupplierService } from './supplier-service';

/** What the handlers of the purchase order answer with. */
export interface PurchasingServices {
  readonly suppliers: SupplierService;
  readonly orders: PurchaseOrderService;
  readonly exporter: OrderExporter;
}

/** Registers a channel that answers only while somebody is signed in, and only to the register screen. */
export type AnswerSignedIn = <Result>(channel: string, respond: (argument: unknown) => Result) => void;

/**
 * Registers what the main process answers to the screens of the purchase order (E1-44). Reading is for whoever is signed in,
 * and every change asks the owner (or the PIN of an owner) inside the service, which is where that rule lives.
 *
 * @param answerSignedIn registers a channel that refuses calls from any other page and while nobody is signed in
 * @param services the local data the answers come from
 */
export function registerPurchasingHandlers(answerSignedIn: AnswerSignedIn, { suppliers, orders, exporter }: PurchasingServices): void {
  answerSignedIn(PURCHASING_CHANNELS.listSuppliers, (includeInactive): Supplier[] => suppliers.list(includeInactive === true));
  answerSignedIn(PURCHASING_CHANNELS.saveSupplier, (request): SaveSupplierResult => suppliers.save(parseSaveSupplierRequest(request)));
  answerSignedIn(PURCHASING_CHANNELS.getSupplierLinks, (productId): SupplierProductLink[] => suppliers.linksOfProduct(parseProductId(productId)));
  answerSignedIn(PURCHASING_CHANNELS.setSupplierCodes, (request): SetSupplierCodesResult => suppliers.setCodes(parseSetSupplierCodesRequest(request)));
  answerSignedIn(PURCHASING_CHANNELS.searchOrderProducts, (request): OrderCandidate[] => orders.search(parseSearchOrderProductsRequest(request)));
  answerSignedIn(PURCHASING_CHANNELS.suggestOrderProducts, (supplierId): OrderCandidate[] => orders.suggest(parseUuid(supplierId, 'a supplier')));
  answerSignedIn(PURCHASING_CHANNELS.setReorderLevel, (request): SetReorderLevelResult => orders.setReorderLevel(parseSetReorderLevelRequest(request)));
  answerSignedIn(PURCHASING_CHANNELS.listOrders, (): PurchaseOrderSummary[] => orders.list());
  answerSignedIn(PURCHASING_CHANNELS.getOrder, (orderId): PurchaseOrder | null => orders.get(parseUuid(orderId, 'an order')));
  answerSignedIn(PURCHASING_CHANNELS.saveOrder, (request): SaveOrderResult => orders.save(parseSaveOrderRequest(request)));
  answerSignedIn(PURCHASING_CHANNELS.markOrderSent, (request): MarkOrderSentResult => orders.markSent(parseOrderActionRequest(request)));
  answerSignedIn(PURCHASING_CHANNELS.discardOrder, (request): DiscardOrderResult => orders.discard(parseOrderActionRequest(request)));
  answerSignedIn(PURCHASING_CHANNELS.exportOrder, (request): Promise<ExportOrderResult> => exporter.export(parseExportOrderRequest(request)));
  answerSignedIn(PURCHASING_CHANNELS.revealFile, (path): void => exporter.reveal(parsePath(path)));
}
