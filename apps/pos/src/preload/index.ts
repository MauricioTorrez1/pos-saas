import { contextBridge, ipcRenderer } from 'electron';

import { IPC_CHANNELS, type PosApi } from '../shared/pos-api';

const posApi: PosApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getAppInfo),
  findProductByCode: (code) => ipcRenderer.invoke(IPC_CHANNELS.findProductByCode, code),
  searchProducts: (text) => ipcRenderer.invoke(IPC_CHANNELS.searchProducts, text),
  getAppearance: () => ipcRenderer.invoke(IPC_CHANNELS.getAppearance),
  saveAppearance: (appearance) => ipcRenderer.invoke(IPC_CHANNELS.saveAppearance, appearance),
  savePendingSale: (request) => ipcRenderer.invoke(IPC_CHANNELS.savePendingSale, request),
  listPendingSales: () => ipcRenderer.invoke(IPC_CHANNELS.listPendingSales),
  confirmPendingSale: (saleId) => ipcRenderer.invoke(IPC_CHANNELS.confirmPendingSale, saleId),
  cancelPendingSale: (saleId) => ipcRenderer.invoke(IPC_CHANNELS.cancelPendingSale, saleId),
};

contextBridge.exposeInMainWorld('pos', posApi);
