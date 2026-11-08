import { contextBridge, ipcRenderer } from 'electron';

import { IPC_CHANNELS, type PosApi } from '../shared/pos-api';

const posApi: PosApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getAppInfo),
  findProductByCode: (code) => ipcRenderer.invoke(IPC_CHANNELS.findProductByCode, code),
  searchProducts: (text) => ipcRenderer.invoke(IPC_CHANNELS.searchProducts, text),
  getAppearance: () => ipcRenderer.invoke(IPC_CHANNELS.getAppearance),
  saveAppearance: (appearance) => ipcRenderer.invoke(IPC_CHANNELS.saveAppearance, appearance),
};

contextBridge.exposeInMainWorld('pos', posApi);
