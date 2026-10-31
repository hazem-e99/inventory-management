import type { ErrorCode } from '@inv/contracts'

export type Startup =
  | { kind: 'ready'; baseUrl: string; token: string }
  | { kind: 'restore-required' }

export type RestoreResult = { ok: true } | { ok: false; code: ErrorCode }

declare global {
  interface Window {
    desktop: {
      startup(): Promise<Startup>
      chooseBackupFile(): Promise<string | null>
      chooseBackupDestination(defaultName: string): Promise<string | null>
      chooseCatalogFile(): Promise<string | null>
      chooseSpreadsheetDestination(defaultName: string): Promise<string | null>
      restoreBackup(input: { path: string; recoveryCode: string }): Promise<RestoreResult>
    }
  }
}

export const desktop = () => window.desktop
