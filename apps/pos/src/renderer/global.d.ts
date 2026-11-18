import type { ExitApi } from '../shared/exit-api';
import type { CatalogExportApi } from '../shared/catalog-export';
import type { DashboardApi } from '../shared/dashboard-api';
import type { ExpensesApi } from '../shared/expenses';
import type { MissingItemsApi } from '../shared/missing-items';
import type { PosApi } from '../shared/pos-api';
import type { PricingApi } from '../shared/pricing';
import type { ProductAdminApi } from '../shared/product-admin';
import type { ToolsApi } from '../shared/register-tools';
import type { SupplierCatalogApi } from '../shared/supplier-catalog';
import type { PurchasingApi } from '../shared/supplier-order';

declare global {
  interface Window {
    /** Bridge from the preload script: the screen's only way to reach the main process. */
    readonly pos: PosApi & PricingApi & ProductAdminApi & DashboardApi;
    /** Bridge for the suppliers and the purchase orders (E1-44). */
    readonly purchasing: PurchasingApi;
    /** Bridge for the price lists of the suppliers (E1-51), only for the owner. */
    readonly supplierCatalog: SupplierCatalogApi;
    /** Bridge for the keys, the ticket, the printer and the list of sales. */
    readonly tools: ToolsApi;
    /** Bridge for the log of missing items (E1-49). */
    readonly missing: MissingItemsApi;
    /** Bridge for closing the register with the cash still open (E1-54). */
    readonly exit: ExitApi;
    /** Bridge to save the whole catalog as a file (E1-55). */
    readonly catalogExport: CatalogExportApi;
    /** Bridge for the operating expenses (E1-56). */
    readonly expenses: ExpensesApi;
  }
}
