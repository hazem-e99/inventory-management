import type { ErrorCode } from '@inv/contracts'

export type Startup =
  | { kind: 'ready'; baseUrl: string; token: string }
  | { kind: 'restore-required' }

export type RestoreResult = { ok: true } | { ok: false; code: ErrorCode }

export interface PrintJob {
  deviceName: string | null
  /** Set for a roll, whose page is exactly as long as the receipt. */
  widthMm: number | null
  heightMm: number | null
}

declare global {
  interface Window {
    desktop: {
      startup(): Promise<Startup>
      chooseBackupFile(): Promise<string | null>
      chooseBackupDestination(defaultName: string): Promise<string | null>
      chooseCatalogFile(): Promise<string | null>
      chooseSpreadsheetDestination(defaultName: string): Promise<string | null>
      listPrinters(): Promise<string[]>
      print(job: PrintJob): Promise<{ ok: boolean }>
      savePdf(job: { defaultName: string; landscape: boolean }): Promise<{ saved: boolean }>
      restoreBackup(input: { path: string; recoveryCode: string }): Promise<RestoreResult>
    }
  }
}

export const desktop = () => window.desktop
