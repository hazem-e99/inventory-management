import {
  featuresSchema,
  preferencesSchema,
  stockPolicySchema,
  storeSchema,
  type Features,
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
} as const

const DEFAULT_PREFERENCES: Preferences = { locale: 'ar', theme: 'system', digits: 'latin' }

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

    recovery: () => settings.getJson<KeyEnvelope>(KEYS.recovery),

    setRecovery: (envelope: KeyEnvelope, now: number) =>
      settings.setJson(KEYS.recovery, envelope, now),
  }
}
