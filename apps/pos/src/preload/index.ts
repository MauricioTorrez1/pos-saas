import { contextBridge, ipcRenderer } from 'electron';

import { DASHBOARD_CHANNELS, type DashboardApi } from '../shared/dashboard-api';
import { IPC_CHANNELS, type PosApi } from '../shared/pos-api';
import type { PricingApi } from '../shared/pricing';
import type { ProductAdminApi } from '../shared/product-admin';

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

contextBridge.exposeInMainWorld('pos', posApi);
