import { contextBridge, ipcRenderer } from 'electron';

import { IPC_CHANNELS, type PosApi } from '../shared/pos-api';

const posApi: PosApi = {
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
  findReturnableSale: (folio) => ipcRenderer.invoke(IPC_CHANNELS.findReturnableSale, folio),
  createReturn: (request) => ipcRenderer.invoke(IPC_CHANNELS.createReturn, request),
  getCashStatus: () => ipcRenderer.invoke(IPC_CHANNELS.getCashStatus),
  openCashSession: (request) => ipcRenderer.invoke(IPC_CHANNELS.openCashSession, request),
  recordCashMovement: (request) => ipcRenderer.invoke(IPC_CHANNELS.recordCashMovement, request),
  closeCashSession: (request) => ipcRenderer.invoke(IPC_CHANNELS.closeCashSession, request),
  setWithdrawalLimit: (request) => ipcRenderer.invoke(IPC_CHANNELS.setWithdrawalLimit, request),
  findProductByCode: (code) => ipcRenderer.invoke(IPC_CHANNELS.findProductByCode, code),
  searchProducts: (text) => ipcRenderer.invoke(IPC_CHANNELS.searchProducts, text),
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
