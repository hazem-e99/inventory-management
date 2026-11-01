import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('desktop', {
  startup: () => ipcRenderer.invoke('startup'),
  chooseBackupFile: () => ipcRenderer.invoke('backup:choose-file'),
  chooseBackupDestination: (defaultName: string) =>
    ipcRenderer.invoke('backup:choose-destination', defaultName),
  chooseCatalogFile: () => ipcRenderer.invoke('catalog:choose-file'),
  chooseSpreadsheetDestination: (defaultName: string) =>
    ipcRenderer.invoke('catalog:choose-destination', defaultName),
  listPrinters: () => ipcRenderer.invoke('print:printers'),
  print: (job: { deviceName: string | null; widthMm: number | null; heightMm: number | null }) =>
    ipcRenderer.invoke('print:run', job),
  savePdf: (job: { defaultName: string; landscape: boolean }) => ipcRenderer.invoke('print:pdf', job),
  restoreBackup: (input: { path: string; recoveryCode: string }) =>
    ipcRenderer.invoke('backup:restore', input),
})
