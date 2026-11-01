import { randomUUID } from 'node:crypto'
import { createSqliteDb, migrateToLatest } from '@inv/db'
import { createApp } from '../src'
import { ONBOARDING } from './fixtures'

// A real process selling as fast as it can, for crash.test.ts to kill mid-write.
const [path, hexKey, backupsDir] = process.argv.slice(2) as [string, string, string]

const db = createSqliteDb({ path, hexKey })
await migrateToLatest(db)

const app = createApp({
  db,
  token: 'test-token',
  allowedOrigin: 'app://renderer',
  version: '0.0.0',
  bootCount: 1,
  databaseKey: hexKey,
  backupsDir,
  clock: () => Date.now(),
  logError: () => {},
})

async function post<T>(route: string, body: unknown, session?: string): Promise<T> {
  const response = await app.request(route, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
      ...(session ? { 'X-Session-Token': session } : {}),
    },
    body: JSON.stringify(body),
  })
  if (response.status !== 200) throw new Error(`${route}: ${await response.text()}`)
  return (await response.json()) as T
}

const { token: session } = await post<{ token: string }>('/onboarding', ONBOARDING)
const product = await post<{ variants: Array<{ id: string }> }>(
  '/products',
  {
    name: 'صنف',
    baseUnitId: 'piece',
    prescriptionRequired: false,
    trackLots: false,
    trackSerials: false,
    conversions: [],
    variants: [
      {
        label: null,
        costMinor: 0,
        barcodes: [],
        prices: [{ unitId: 'piece', amountMinor: 1000, priceListId: 'retail' }],
        attributeValueIds: [],
      },
    ],
  },
  session,
)
const variantId = product.variants[0]!.id

const document = await post<{ id: string }>(
  '/stock/documents',
  { kind: 'adjustment', warehouseId: 'main', reason: 'opening', lines: [{ variantId, unitId: 'piece', qtyMilli: 100_000_000, unitCostMinor: 100 }] },
  session,
)
await post(`/stock/documents/${document.id}/post`, {}, session)
await post('/shifts', { openingCashMinor: 0 }, session)

for (let sold = 1; ; sold++) {
  await post(
    '/sales',
    {
      requestId: randomUUID(),
      lines: [{ variantId, unitId: 'piece', qtyMilli: 1000, unitPriceMinor: 1000, discountMinor: 0 }],
      tenders: [{ method: 'cash', amountMinor: 1000 }],
    },
    session,
  )
  // Written only after the commit returned, which is what a receipt in a customer's hand means.
  process.stdout.write(`sold ${sold}\n`)
}
