import type { BusinessType, Features } from '@inv/contracts'

/** A business type is a set of switches, never a separate code path. */
export const BUSINESS_PRESETS: Record<BusinessType, Features> = {
  pharmacy: {
    lots: true,
    expiryRequired: true,
    fractionalQuantities: false,
    variantsMatrix: false,
    serialNumbers: false,
  },
  supermarket: {
    lots: true,
    expiryRequired: false,
    fractionalQuantities: true,
    variantsMatrix: false,
    serialNumbers: false,
  },
  clothing: {
    lots: false,
    expiryRequired: false,
    fractionalQuantities: false,
    variantsMatrix: true,
    serialNumbers: false,
  },
  general: {
    lots: false,
    expiryRequired: false,
    fractionalQuantities: false,
    variantsMatrix: false,
    serialNumbers: true,
  },
}
