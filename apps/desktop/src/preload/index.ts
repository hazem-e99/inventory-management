import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('desktop', {
  apiConfig: (): Promise<{ baseUrl: string; token: string }> => ipcRenderer.invoke('api:config'),
})
