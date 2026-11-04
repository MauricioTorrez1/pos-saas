import { contextBridge, ipcRenderer } from 'electron';

import { IPC_CHANNELS, type PosApi } from '../shared/pos-api';

const posApi: PosApi = {
  getAppInfo: () => ipcRenderer.invoke(IPC_CHANNELS.getAppInfo),
};

contextBridge.exposeInMainWorld('pos', posApi);
