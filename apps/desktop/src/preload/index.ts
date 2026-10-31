import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('desktop', {
  startup: () => ipcRenderer.invoke('startup'),
  chooseBackupFile: () => ipcRenderer.invoke('backup:choose-file'),
  chooseBackupDestination: (defaultName: string) =>
    ipcRenderer.invoke('backup:choose-destination', defaultName),
  chooseCatalogFile: () => ipcRenderer.invoke('catalog:choose-file'),
  chooseSpreadsheetDestination: (defaultName: string) =>
    ipcRenderer.invoke('catalog:choose-destination', defaultName),
  restoreBackup: (input: { path: string; recoveryCode: string }) =>
    ipcRenderer.invoke('backup:restore', input),
})
