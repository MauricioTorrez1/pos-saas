import { contextBridge, ipcRenderer } from 'electron';

import { DASHBOARD_CHANNELS, type DashboardApi } from '../shared/dashboard-api';
import { MISSING_CHANNELS, type MissingItemsApi } from '../shared/missing-items';
import { IPC_CHANNELS, type PosApi } from '../shared/pos-api';
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
  getAppearance: () => ipcRenderer.invoke(IPC_CHANNELS.getAppearance),
  saveAppearance: (appearance) => ipcRenderer.invoke(IPC_CHANNELS.saveAppearance, appearance),
  savePendingSale: (request) => ipcRenderer.invoke(IPC_CHANNELS.savePendingSale, request),
  checkoutSale: (request) => ipcRenderer.invoke(IPC_CHANNELS.checkoutSale, request),
  reprintLastTicket: () => ipcRenderer.invoke(IPC_CHANNELS.reprintLastTicket),
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

contextBridge.exposeInMainWorld('pos', posApi);
contextBridge.exposeInMainWorld('supplierCatalog', supplierCatalogApi);
contextBridge.exposeInMainWorld('tools', toolsApi);
contextBridge.exposeInMainWorld('purchasing', purchasingApi);
contextBridge.exposeInMainWorld('missing', missingApi);
