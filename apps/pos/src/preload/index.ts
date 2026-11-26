import { contextBridge, ipcRenderer } from 'electron';

import { EXIT_CHANNELS, type ExitApi } from '../shared/exit-api';
import { CATALOG_EXPORT_CHANNELS, type CatalogExportApi } from '../shared/catalog-export';
import { DASHBOARD_CHANNELS, type DashboardApi } from '../shared/dashboard-api';
import { EXPENSE_CHANNELS, type ExpensesApi } from '../shared/expenses';
import { MISSING_CHANNELS, type MissingItemsApi } from '../shared/missing-items';
import { IPC_CHANNELS, type PosApi } from '../shared/pos-api';
import { QUOTE_CHANNELS, type QuotesApi } from '../shared/quotes';
import type { PricingApi } from '../shared/pricing';
import type { ProductAdminApi } from '../shared/product-admin';
import { TOOLS_CHANNELS, type ToolsApi } from '../shared/register-tools';
import { SUPPLIER_CATALOG_CHANNELS, type SupplierCatalogApi } from '../shared/supplier-catalog';
import { PURCHASING_CHANNELS, type PurchasingApi } from '../shared/supplier-order';

const posApi: PosApi & PricingApi & ProductAdminApi & DashboardApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getAppInfo),
  getAuthState: () => ipcRenderer.invoke(IPC_CHANNELS.getAuthState),
  setupOwner: (request) => ipcRenderer.invoke(IPC_CHANNELS.setupOwner, request),
  login: (request) => ipcRenderer.invoke(IPC_CHANNELS.login, request),
  logout: () => ipcRenderer.invoke(IPC_CHANNELS.logout),
  createUser: (request) => ipcRenderer.invoke(IPC_CHANNELS.createUser, request),
  importCatalog: () => ipcRenderer.invoke(IPC_CHANNELS.importCatalog),
  getBackupStatus: () => ipcRenderer.invoke(IPC_CHANNELS.getBackupStatus),
  configureBackup: (request) => ipcRenderer.invoke(IPC_CHANNELS.configureBackup, request),
  backupNow: () => ipcRenderer.invoke(IPC_CHANNELS.backupNow),
  restoreBackup: (request) => ipcRenderer.invoke(IPC_CHANNELS.restoreBackup, request),
  getKardex: (productId) => ipcRenderer.invoke(IPC_CHANNELS.getKardex, productId),
  adjustStock: (request) => ipcRenderer.invoke(IPC_CHANNELS.adjustStock, request),
  checkLedger: () => ipcRenderer.invoke(IPC_CHANNELS.checkLedger),
  getDailyReport: (date) => ipcRenderer.invoke(IPC_CHANNELS.getDailyReport, date),
  findReturnableSale: (folio) => ipcRenderer.invoke(IPC_CHANNELS.findReturnableSale, folio),
  createReturn: (request) => ipcRenderer.invoke(IPC_CHANNELS.createReturn, request),
  getCashStatus: () => ipcRenderer.invoke(IPC_CHANNELS.getCashStatus),
  openCashSession: (request) => ipcRenderer.invoke(IPC_CHANNELS.openCashSession, request),
  recordCashMovement: (request) => ipcRenderer.invoke(IPC_CHANNELS.recordCashMovement, request),
  closeCashSession: (request) => ipcRenderer.invoke(IPC_CHANNELS.closeCashSession, request),
  setWithdrawalLimit: (request) => ipcRenderer.invoke(IPC_CHANNELS.setWithdrawalLimit, request),
  findProductByCode: (code) => ipcRenderer.invoke(IPC_CHANNELS.findProductByCode, code),
  searchProducts: (text) => ipcRenderer.invoke(IPC_CHANNELS.searchProducts, text),
  getPriceInfo: (productId) => ipcRenderer.invoke(IPC_CHANNELS.getPriceInfo, productId),
  changePrice: (request) => ipcRenderer.invoke(IPC_CHANNELS.changePrice, request),
  createProduct: (request) => ipcRenderer.invoke(IPC_CHANNELS.createProduct, request),
  findProducts: (text) => ipcRenderer.invoke(IPC_CHANNELS.findProducts, text),
  getProductDetail: (productId) => ipcRenderer.invoke(IPC_CHANNELS.getProductDetail, productId),
  updateProduct: (request) => ipcRenderer.invoke(IPC_CHANNELS.updateProduct, request),
  getDashboard: (request) => ipcRenderer.invoke(DASHBOARD_CHANNELS.getDashboard, request),
  exportDashboard: (request, format) => ipcRenderer.invoke(DASHBOARD_CHANNELS.exportDashboard, { request, format }),
  getIncomeStatement: (request) => ipcRenderer.invoke(DASHBOARD_CHANNELS.getIncomeStatement, request),
  exportIncomeStatement: (request, format) => ipcRenderer.invoke(DASHBOARD_CHANNELS.exportIncomeStatement, { request, format }),
  exportBusinessReport: (request) => ipcRenderer.invoke(DASHBOARD_CHANNELS.exportBusinessReport, request),
  getAppearance: () => ipcRenderer.invoke(IPC_CHANNELS.getAppearance),
  saveAppearance: (appearance) => ipcRenderer.invoke(IPC_CHANNELS.saveAppearance, appearance),
  savePendingSale: (request) => ipcRenderer.invoke(IPC_CHANNELS.savePendingSale, request),
  checkoutSale: (request) => ipcRenderer.invoke(IPC_CHANNELS.checkoutSale, request),
  reprintLastTicket: () => ipcRenderer.invoke(IPC_CHANNELS.reprintLastTicket),
  printSaleTicket: (saleId) => ipcRenderer.invoke(IPC_CHANNELS.printSaleTicket, saleId),
  listPendingSales: () => ipcRenderer.invoke(IPC_CHANNELS.listPendingSales),
  confirmPendingSale: (request) => ipcRenderer.invoke(IPC_CHANNELS.confirmPendingSale, request),
  cancelPendingSale: (saleId) => ipcRenderer.invoke(IPC_CHANNELS.cancelPendingSale, saleId),
};

/** The suppliers and the purchase orders (E1-44). They are a bridge of their own, so the register bridge above stays as it was. */
const purchasingApi: PurchasingApi = {
  listSuppliers: (includeInactive) => ipcRenderer.invoke(PURCHASING_CHANNELS.listSuppliers, includeInactive),
  saveSupplier: (request) => ipcRenderer.invoke(PURCHASING_CHANNELS.saveSupplier, request),
  getSupplierLinks: (productId) => ipcRenderer.invoke(PURCHASING_CHANNELS.getSupplierLinks, productId),
  setSupplierCodes: (request) => ipcRenderer.invoke(PURCHASING_CHANNELS.setSupplierCodes, request),
  changeSupplierLink: (request) => ipcRenderer.invoke(PURCHASING_CHANNELS.changeSupplierLink, request),
  findDraftsWithProduct: (ref) => ipcRenderer.invoke(PURCHASING_CHANNELS.findDraftsWithProduct, ref),
  unlinkSupplier: (request) => ipcRenderer.invoke(PURCHASING_CHANNELS.unlinkSupplier, request),
  searchOrderProducts: (request) => ipcRenderer.invoke(PURCHASING_CHANNELS.searchOrderProducts, request),
  suggestOrderProducts: (supplierId) => ipcRenderer.invoke(PURCHASING_CHANNELS.suggestOrderProducts, supplierId),
  setReorderLevel: (request) => ipcRenderer.invoke(PURCHASING_CHANNELS.setReorderLevel, request),
  listOrders: () => ipcRenderer.invoke(PURCHASING_CHANNELS.listOrders),
  getOrder: (orderId) => ipcRenderer.invoke(PURCHASING_CHANNELS.getOrder, orderId),
  saveOrder: (request) => ipcRenderer.invoke(PURCHASING_CHANNELS.saveOrder, request),
  markOrderSent: (request) => ipcRenderer.invoke(PURCHASING_CHANNELS.markOrderSent, request),
  discardOrder: (request) => ipcRenderer.invoke(PURCHASING_CHANNELS.discardOrder, request),
  exportOrder: (request) => ipcRenderer.invoke(PURCHASING_CHANNELS.exportOrder, request),
  revealFile: (path) => ipcRenderer.invoke(PURCHASING_CHANNELS.revealFile, path),
  orderMore: (request) => ipcRenderer.invoke(PURCHASING_CHANNELS.orderMore, request),
};

/** The log of what customers ask for and the store does not carry (E1-49). */
const missingApi: MissingItemsApi = {
  record: (request) => ipcRenderer.invoke(MISSING_CHANNELS.record, request),
  report: (period) => ipcRenderer.invoke(MISSING_CHANNELS.report, period),
  resolve: (request) => ipcRenderer.invoke(MISSING_CHANNELS.resolve, request),
  editNotes: (request) => ipcRenderer.invoke(MISSING_CHANNELS.editNotes, request),
  remove: (key) => ipcRenderer.invoke(MISSING_CHANNELS.remove, key),
  exportPdf: (period) => ipcRenderer.invoke(MISSING_CHANNELS.exportPdf, period),
};

/** The quotes of the store (F2-07). */
const quotesApi: QuotesApi = {
  list: (search) => ipcRenderer.invoke(QUOTE_CHANNELS.list, search),
  get: (quoteId) => ipcRenderer.invoke(QUOTE_CHANNELS.get, quoteId),
  save: (request) => ipcRenderer.invoke(QUOTE_CHANNELS.save, request),
  cancel: (request) => ipcRenderer.invoke(QUOTE_CHANNELS.cancel, request),
  preview: (quoteId) => ipcRenderer.invoke(QUOTE_CHANNELS.preview, quoteId),
  print: (quoteId) => ipcRenderer.invoke(QUOTE_CHANNELS.print, quoteId),
  prepareConversion: (quoteId) => ipcRenderer.invoke(QUOTE_CHANNELS.prepareConversion, quoteId),
  markConverted: (request) => ipcRenderer.invoke(QUOTE_CHANNELS.markConverted, request),
};

/** The operating expenses of the business (E1-56). */
const expensesApi: ExpensesApi = {
  record: (request) => ipcRenderer.invoke(EXPENSE_CHANNELS.record, request),
  list: (request) => ipcRenderer.invoke(EXPENSE_CHANNELS.list, request),
  void: (request) => ipcRenderer.invoke(EXPENSE_CHANNELS.void, request),
  saveConcepts: (request) => ipcRenderer.invoke(EXPENSE_CHANNELS.saveConcepts, request),
};

/** The keys, the ticket, the printer and the list of sales. A bridge of their own, like the purchase orders. */
const toolsApi: ToolsApi = {
  getKeymap: () => ipcRenderer.invoke(TOOLS_CHANNELS.getKeymap),
  saveKeymap: (keymap) => ipcRenderer.invoke(TOOLS_CHANNELS.saveKeymap, keymap),
  getTicketDesign: () => ipcRenderer.invoke(TOOLS_CHANNELS.getTicketDesign),
  saveTicketDesign: (design) => ipcRenderer.invoke(TOOLS_CHANNELS.saveTicketDesign, design),
  previewTicket: (design) => ipcRenderer.invoke(TOOLS_CHANNELS.previewTicket, design),
  getPrinter: () => ipcRenderer.invoke(TOOLS_CHANNELS.getPrinter),
  savePrinter: (share) => ipcRenderer.invoke(TOOLS_CHANNELS.savePrinter, share),
  testPrint: () => ipcRenderer.invoke(TOOLS_CHANNELS.testPrint),
  listRecentSales: (text) => ipcRenderer.invoke(TOOLS_CHANNELS.listRecentSales, text),
  recordSaleCancelled: (request) => ipcRenderer.invoke(TOOLS_CHANNELS.recordSaleCancelled, request),
};

/** Saves the whole catalog as a file (E1-55). A bridge of its own, like the log of missing items. */
const catalogExportApi: CatalogExportApi = {
  exportCatalog: (request) => ipcRenderer.invoke(CATALOG_EXPORT_CHANNELS.exportCatalog, request),
};

const supplierCatalogApi: SupplierCatalogApi = {
  pickPriceList: (supplierId) => ipcRenderer.invoke(SUPPLIER_CATALOG_CHANNELS.pickPriceList, supplierId),
  importPriceList: (request) => ipcRenderer.invoke(SUPPLIER_CATALOG_CHANNELS.importPriceList, request),
  priceListSummary: (supplierId) => ipcRenderer.invoke(SUPPLIER_CATALOG_CHANNELS.priceListSummary, supplierId),
  listCatalogItems: (request) => ipcRenderer.invoke(SUPPLIER_CATALOG_CHANNELS.listCatalogItems, request),
  linkCatalogItem: (request) => ipcRenderer.invoke(SUPPLIER_CATALOG_CHANNELS.linkCatalogItem, request),
  compareItems: (text) => ipcRenderer.invoke(SUPPLIER_CATALOG_CHANNELS.compareItems, text),
  confirmCart: (request) => ipcRenderer.invoke(SUPPLIER_CATALOG_CHANNELS.confirmCart, request),
  exportCartPdf: (request) => ipcRenderer.invoke(SUPPLIER_CATALOG_CHANNELS.exportCartPdf, request),
};

/** Closing the register with the cash still open (E1-54). The screen only hears about it and answers; main decides. */
const exitApi: ExitApi = {
  onExitRequested: (listener) => {
    const handler = (): void => listener();
    ipcRenderer.on(EXIT_CHANNELS.requested, handler);
    return () => {
      ipcRenderer.removeListener(EXIT_CHANNELS.requested, handler);
    };
  },
  answerExit: (answer) => ipcRenderer.invoke(EXIT_CHANNELS.answer, answer),
};

contextBridge.exposeInMainWorld('pos', posApi);
contextBridge.exposeInMainWorld('supplierCatalog', supplierCatalogApi);
contextBridge.exposeInMainWorld('exit', exitApi);
contextBridge.exposeInMainWorld('tools', toolsApi);
contextBridge.exposeInMainWorld('purchasing', purchasingApi);
contextBridge.exposeInMainWorld('missing', missingApi);
contextBridge.exposeInMainWorld('catalogExport', catalogExportApi);
contextBridge.exposeInMainWorld('expenses', expensesApi);
contextBridge.exposeInMainWorld('quotes', quotesApi);
