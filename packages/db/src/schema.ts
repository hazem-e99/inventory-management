export interface SettingsTable {
  key: string
  value: string
  updated_at: number
}

export interface Database {
  settings: SettingsTable
}
