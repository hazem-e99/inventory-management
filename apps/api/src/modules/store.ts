import {
  featuresSchema,
  posSettingsSchema,
  preferencesSchema,
  stockPolicySchema,
  storeSchema,
  type Features,
  type PosSettings,
  type Preferences,
  type StockPolicy,
  type Store,
} from '@inv/contracts'
import { settingsRepo, type Database, type Kysely } from '@inv/db'
import type { KeyEnvelope } from '@inv/db/backup'

const KEYS = {
  store: 'store',
  features: 'features',
  preferences: 'preferences',
  recovery: 'recovery',
  stockPolicy: 'stock_policy',
  pos: 'pos',
  license: 'license',
  ai: 'ai',
} as const

const DEFAULT_PREFERENCES: Preferences = { locale: 'ar', theme: 'system', digits: 'latin' }
const DEFAULT_POS: PosSettings = { warehouseId: 'main', receiptPaper: '80mm', printerName: null, autoPrint: false }

export interface StoredLicense {
  token: string | null
  /** The latest moment this device has reached, so the clock can't be wound back. */
  lastSeenAt: number
}

export interface StoredAi {
  enabled: boolean
  /** Sent to the license server with each request. Null unless the add-on is on. */
  key: string | null
  monthlyLimit: number
  used: number
  consentedAt: number | null
}

const NO_AI: StoredAi = { enabled: false, key: null, monthlyLimit: 0, used: 0, consentedAt: null }

/** Typed access to the settings rows. Reads are validated, since these outlive app versions. */
export function storeSettings(db: Kysely<Database>) {
  const settings = settingsRepo(db)

  return {
    async store(): Promise<Store | null> {
      const value = await settings.getJson(KEYS.store)
      return value === null ? null : storeSchema.parse(value)
    },

    setStore: (store: Store, now: number) => settings.setJson(KEYS.store, store, now),

    async features(): Promise<Features> {
      return featuresSchema.parse(await settings.getJson(KEYS.features))
    },

    setFeatures: (features: Features, now: number) =>
      settings.setJson(KEYS.features, features, now),

    async preferences(): Promise<Preferences> {
      const value = await settings.getJson(KEYS.preferences)
      return value === null ? DEFAULT_PREFERENCES : preferencesSchema.parse(value)
    },

    setPreferences: (preferences: Preferences, now: number) =>
      settings.setJson(KEYS.preferences, preferences, now),

    async stockPolicy(): Promise<StockPolicy> {
      const value = await settings.getJson(KEYS.stockPolicy)
      return value === null ? { allowNegative: false } : stockPolicySchema.parse(value)
    },

    setStockPolicy: (policy: StockPolicy, now: number) =>
      settings.setJson(KEYS.stockPolicy, policy, now),

    async pos(): Promise<PosSettings> {
      const value = await settings.getJson(KEYS.pos)
      return value === null ? DEFAULT_POS : posSettingsSchema.parse(value)
    },

    setPos: (pos: PosSettings, now: number) => settings.setJson(KEYS.pos, pos, now),

    async license(): Promise<StoredLicense> {
      return (await settings.getJson<StoredLicense>(KEYS.license)) ?? { token: null, lastSeenAt: 0 }
    },

    setLicense: (license: StoredLicense, now: number) => settings.setJson(KEYS.license, license, now),

    async ai(): Promise<StoredAi> {
      return (await settings.getJson<StoredAi>(KEYS.ai)) ?? NO_AI
    },

    setAi: (ai: StoredAi, now: number) => settings.setJson(KEYS.ai, ai, now),

    recovery: () => settings.getJson<KeyEnvelope>(KEYS.recovery),

    setRecovery: (envelope: KeyEnvelope, now: number) =>
      settings.setJson(KEYS.recovery, envelope, now),
  }
}
