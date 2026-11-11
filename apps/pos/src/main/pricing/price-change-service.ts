import type { StatementSync } from 'node:sqlite';

import { formatUnitPriceE4 } from '@pos-saas/money';

import { MAX_UNIT_PRICE_E4, type ChangePriceRequest, type ChangePriceResult, type PriceInfo } from '../../shared/pricing';
import type { AuditLog } from '../audit/audit-log';
import type { AuthService } from '../auth/auth-service';
import type { LocalStore } from '../local-store/local-store';
import type { ProductCatalog } from '../local-store/product-catalog';
import { isRefusal, OwnerGate } from '../auth/owner-gate';
import { SyncOutbox } from '../sync/sync-outbox';
import { uuidV7 } from '../uuid-v7';

/** What a sale in progress needs to know about the price a product had before the last change. */
export interface PriceHistoryReader {
  /**
   * Reads the price a product had just before its latest change.
   *
   * @param productId the UUIDv7 of the product
   * @returns that price in ten-thousandths of a peso, or null if the price never changed
   */
  previousPriceOf(productId: string): number | null;
}

/**
 * Changes the price of a product in the catalog (E1-39, ADR 0047). The owner does it with their session, and a cashier
 * with the PIN of an owner. The new price, its entry in the audit log, the record of the change and the operation for the
 * core are written in one transaction, so none of them can exist without the others. A refused attempt is also written
 * down. Completed sales and saved lines keep their own price, because they store it.
 */
export class PriceChangeService implements PriceHistoryReader {
  readonly #store: LocalStore;
  readonly #tenantId: string;
  readonly #auth: Pick<AuthService, 'currentUser' | 'authorizeWithOwnerPin'>;
  readonly #catalog: ProductCatalog;
  readonly #audit: Pick<AuditLog, 'record'>;
  readonly #gate: OwnerGate;
  readonly #outbox: SyncOutbox;
  readonly #lastCost: StatementSync;
  readonly #insertChange: StatementSync;
  readonly #latestChange: StatementSync;

  /**
   * @param store the open local database
   * @param tenantId the business
   * @param auth who is signed in, and who can approve with a PIN
   * @param catalog where the products and their prices are
   * @param audit the audit log
   */
  constructor(
    store: LocalStore,
    tenantId: string,
    auth: Pick<AuthService, 'currentUser' | 'authorizeWithOwnerPin'>,
    catalog: ProductCatalog,
    audit: Pick<AuditLog, 'record'>,
  ) {
    this.#store = store;
    this.#tenantId = tenantId;
    this.#auth = auth;
    this.#catalog = catalog;
    this.#audit = audit;
    this.#gate = new OwnerGate(auth, audit);
    this.#outbox = new SyncOutbox(store, tenantId);
    // The cost the owner typed on the product wins; without one, the last known cost of the ledger, as in the report of the day.
    this.#lastCost = store.prepare(`
      SELECT coalesce(
        (SELECT unit_cost_e6 FROM product WHERE tenant_id = ?1 AND id = ?2),
        (SELECT unit_cost_e6 FROM stock_movement WHERE tenant_id = ?1 AND product_id = ?2 AND unit_cost_e6 IS NOT NULL ORDER BY rowid DESC LIMIT 1)
      ) AS unitCostE6
    `);
    this.#insertChange = store.prepare(`
      INSERT INTO product_price_change
        (id, tenant_id, product_id, previous_unit_price_e4, new_unit_price_e4, changed_by, authorized_by, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.#latestChange = store.prepare(`
      SELECT previous_unit_price_e4 AS previousUnitPriceE4 FROM product_price_change
      WHERE tenant_id = ? AND product_id = ? ORDER BY rowid DESC LIMIT 1
    `);
  }

  /**
   * Reads a product with its last known cost, so the screen can show the margin before and after.
   *
   * @param productId the UUIDv7 of the product
   * @returns the product and its cost, or null if the product does not exist
   */
  info(productId: string): PriceInfo | null {
    const product = this.#catalog.findById(productId);
    if (product === null) {
      return null;
    }
    const cost = this.#lastCost.get(this.#tenantId, productId) as unknown as { unitCostE6: number | null };
    return { product, lastCostE6: cost.unitCostE6 };
  }

  /** @inheritDoc */
  previousPriceOf(productId: string): number | null {
    const row = this.#latestChange.get(this.#tenantId, productId) as unknown as { previousUnitPriceE4: number } | undefined;
    return row?.previousUnitPriceE4 ?? null;
  }

  /**
   * Changes the price of a product.
   *
   * @param request the product, the price the screen saw, the new price, and the PIN when a cashier asks
   * @returns `changed`, or why nothing changed. A wrong PIN, a lock and a missing PIN are written in the audit log.
   * @throws Error if nobody is signed in
   * @throws RangeError if the new price is not a whole number above zero and up to the maximum
   */
  change(request: ChangePriceRequest): ChangePriceResult {
    const user = this.#auth.currentUser();
    if (user === null) {
      throw new Error('A price change needs a person signed in');
    }
    const { productId, previousUnitPriceE4, newUnitPriceE4 } = request;
    if (!Number.isSafeInteger(newUnitPriceE4) || newUnitPriceE4 <= 0 || newUnitPriceE4 > MAX_UNIT_PRICE_E4) {
      throw new RangeError(`The new price must be a whole number of ten-thousandths above zero and up to ${MAX_UNIT_PRICE_E4}`);
    }
    const product = this.#catalog.findById(productId);
    if (product === null) {
      return { status: 'not_found' };
    }
    if (product.unitPriceE4 !== previousUnitPriceE4) {
      return { status: 'stale', product };
    }
    if (newUnitPriceE4 === product.unitPriceE4) {
      return { status: 'unchanged' };
    }

    const authorization = this.#gate.authorize({
      user,
      ownerPin: request.ownerPin,
      deniedAction: 'product.price_change_denied',
      entity: 'product',
      entityId: productId,
      deniedDetail: `tried ${product.name} from ${previousUnitPriceE4} to ${newUnitPriceE4} ten-thousandths`,
    });
    if (isRefusal(authorization)) {
      return authorization;
    }

    const change = { id: uuidV7(), occurredAt: new Date().toISOString() };
    this.#store.transaction(() => {
      if (!this.#catalog.replaceUnitPrice(productId, previousUnitPriceE4, newUnitPriceE4)) {
        throw new Error('The price changed while it was being replaced');
      }
      this.#insertChange.run(change.id, this.#tenantId, productId, previousUnitPriceE4, newUnitPriceE4, user.id, authorization.ownerId, change.occurredAt);
      this.#audit.record({
        userId: user.id,
        action: 'product.price_change',
        entity: 'product',
        entityId: productId,
        detail: `${product.name}: ${formatUnitPriceE4(previousUnitPriceE4)} to ${formatUnitPriceE4(newUnitPriceE4)} with VAT included (${previousUnitPriceE4} to ${newUnitPriceE4} ten-thousandths); approved by ${authorization.ownerId}`,
      });
      this.#outbox.enqueue(
        'product.price_changed',
        { changeId: change.id, productId, previousUnitPriceE4, newUnitPriceE4, changedBy: user.id, authorizedBy: authorization.ownerId },
        change.occurredAt,
      );
    });
    return { status: 'changed', product: { ...product, unitPriceE4: newUnitPriceE4 }, previousUnitPriceE4 };
  }
}
