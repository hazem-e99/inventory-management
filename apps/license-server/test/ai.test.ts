import type { InvoiceReading } from '@inv/license-core'
import { describe, expect, it, vi } from 'vitest'
import { costMicros } from '../src/ai/pricing'
import { AiUnreadable, type AiProvider, type AiUsage } from '../src/ai/provider'
import { scoreReading } from '../src/ai/score'
import { createHarness, type Harness } from './harness'

const DEVICE = 'a'.repeat(32)
const USAGE: AiUsage = { model: 'gemini-3.1-flash-lite', inputTokens: 2000, outputTokens: 1000 }
const INVOICE: InvoiceReading = {
  supplierName: 'شركة النيل',
  invoiceNumber: '123',
  invoiceDate: '2026-06-15',
  total: 250,
  lines: [{ description: 'باراسيتامول', quantity: 10, unitPrice: 25, lineTotal: 250, batch: 'L1', expiry: '2027-01-01', confidence: 'high' }],
}
const IMAGE = { mimeType: 'image/jpeg', data: 'U0VDUkVULUlOVk9JQ0U=' }

const body = (value: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(value),
})

const provider = (): AiProvider & { readInvoice: ReturnType<typeof vi.fn> } => ({
  readInvoice: vi.fn(async () => ({ invoice: INVOICE, usage: USAGE })),
})

interface Shop {
  harness: Harness
  id: string
  model: ReturnType<typeof provider>
  key: () => Promise<string>
  read: (key?: string, value?: unknown) => Promise<Response>
}

async function shop({ limit = 5, enabled = true, budgetMicros = 1_000_000 } = {}): Promise<Shop> {
  const model = provider()
  const harness = await createHarness({ ai: { provider: model, dailyBudgetMicros: budgetMicros } })
  const customer = (await (await harness.admin('POST', '/admin/customers', { name: 'صيدلية النور' })).json()) as { id: string }
  const { id, serial } = (await (await harness.admin('POST', `/admin/customers/${customer.id}/licenses`, { amount: 1, unit: 'year' })).json()) as { id: string; serial: string }
  await harness.fetch('/v1/activate', body({ serial, fingerprint: DEVICE }))
  await harness.admin('PUT', `/admin/licenses/${id}/ai`, { enabled, monthlyLimit: limit })

  const checkIn = async () => (await (await harness.fetch('/v1/check-in', body({ licenseId: id, fingerprint: DEVICE }))).json()) as { ai: { key: string } }
  const key = async () => (await checkIn()).ai.key
  const read = async (presented?: string, value: unknown = IMAGE) =>
    harness.fetch('/v1/ai/invoice', body(value, { authorization: `Bearer ${presented ?? (await key())}`, 'x-license-id': id }))

  return { harness, id, model, key, read }
}

describe('the AI gateway', () => {
  it('reads an invoice for a shop that has the add-on', async () => {
    const { read, model } = await shop()
    const response = await read()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ invoice: INVOICE, used: 1, monthlyLimit: 5 })
    expect(model.readInvoice).toHaveBeenCalledWith(IMAGE)
  })

  it('never hands a key to a license without the add-on', async () => {
    const { harness, id } = await shop({ enabled: false })
    expect(await (await harness.fetch('/v1/check-in', body({ licenseId: id, fingerprint: DEVICE }))).json()).toMatchObject({ ai: { enabled: false } })
  })

  it('refuses a made-up key before spending anything', async () => {
    const { read, model } = await shop()
    expect((await read('made-up')).status).toBe(401)
    expect(model.readInvoice).not.toHaveBeenCalled()
  })

  it('stops the moment the add-on is switched off, even with a valid key', async () => {
    const { harness, id, key, read, model } = await shop()
    const held = await key()
    await harness.admin('PUT', `/admin/licenses/${id}/ai`, { enabled: false, monthlyLimit: 5 })

    const response = await read(held)
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ code: 'AI_NOT_ENABLED' })
    expect(model.readInvoice).not.toHaveBeenCalled()
  })

  it('stops a suspended or expired license', async () => {
    const stopped = await shop()
    const held = await stopped.key()
    await stopped.harness.admin('POST', `/admin/licenses/${stopped.id}/suspend`)
    expect((await stopped.read(held)).status).toBe(403)

    const expired = await shop()
    const key = await expired.key()
    expired.harness.time.now += 400 * 86_400_000
    expect((await expired.read(key)).status).toBe(403)
    expect(expired.model.readInvoice).not.toHaveBeenCalled()
  })

  it('cuts off a copied key when it is rotated', async () => {
    const { harness, id, key, read } = await shop()
    const copied = await key()
    await harness.admin('POST', `/admin/licenses/${id}/ai/rotate`)

    expect((await read(copied)).status).toBe(401)
    expect((await read()).status).toBe(200)
  })

  it('stops a shop at its monthly limit, and starts again next month', async () => {
    const { harness, read, model } = await shop({ limit: 1 })
    expect((await read()).status).toBe(200)

    const refused = await read()
    expect(refused.status).toBe(429)
    expect(await refused.json()).toEqual({ code: 'AI_QUOTA_EXCEEDED' })
    expect(model.readInvoice).toHaveBeenCalledTimes(1)

    harness.time.now += 31 * 86_400_000
    expect((await read()).status).toBe(200)
  })

  it('stops everyone once the daily budget is spent, and resumes the next day', async () => {
    const { harness, read, model } = await shop({ budgetMicros: 1 })
    expect((await read()).status).toBe(200)

    const refused = await read()
    expect(refused.status).toBe(503)
    expect(await refused.json()).toEqual({ code: 'AI_BUDGET_EXCEEDED' })
    expect(model.readInvoice).toHaveBeenCalledTimes(1)

    harness.time.now += 86_400_000
    expect((await read()).status).toBe(200)
  })

  it('counts the cost of an unreadable answer but not against the shop', async () => {
    const { harness, read, model, id } = await shop({ limit: 1 })
    model.readInvoice.mockRejectedValueOnce(new AiUnreadable(USAGE))

    const response = await read()
    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ code: 'AI_UNREADABLE' })

    const usage = (await (await harness.admin('GET', '/admin/ai/usage')).json()) as { items: unknown[] }
    expect(usage.items).toEqual([expect.objectContaining({ licenseId: id, requests: 0, failures: 1, costMicros: costMicros(USAGE, harness.time.now) })])
    expect((await read()).status).toBe(200)
  })

  it('reports an outage without writing the file down anywhere', async () => {
    const logged: unknown[] = []
    const { harness, read, model } = await shop()
    harness.deps.logError = (...entry) => logged.push(entry)
    model.readInvoice.mockRejectedValueOnce(new Error('quota'))

    const response = await read()
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ code: 'AI_UNAVAILABLE' })
    expect(JSON.stringify(logged)).not.toContain(IMAGE.data)
    expect(await harness.deps.db.selectFrom('ai_usage').selectAll().execute()).toEqual([])
  })

  it('keeps counts and cost, never content', async () => {
    const { harness, read } = await shop()
    await read()
    const rows = await harness.deps.db.selectFrom('ai_usage').selectAll().execute()
    expect(rows).toHaveLength(1)
    expect(JSON.stringify(rows)).not.toContain(IMAGE.data)
    expect(JSON.stringify(rows)).not.toContain('باراسيتامول')
  })

  it('turns away a file that is too large, and anything that is not a document', async () => {
    const { read, model } = await shop()
    expect((await read(undefined, { mimeType: 'image/jpeg', data: 'x'.repeat(15 * 1024 * 1024) })).status).toBe(413)
    expect((await read(undefined, { mimeType: 'text/html', data: 'x' })).status).toBe(422)
    expect(model.readInvoice).not.toHaveBeenCalled()
  })

  it('is closed with no provider configured, which is the kill switch', async () => {
    const harness = await createHarness()
    const response = await harness.fetch('/v1/ai/invoice', body(IMAGE, { authorization: 'Bearer x', 'x-license-id': 'y' }))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ code: 'AI_DISABLED' })
  })
})

describe('what a request costs', () => {
  it('follows the price rise on 1 January 2027', () => {
    const usage = { model: 'gemini-3.8-flash', inputTokens: 1_000_000, outputTokens: 1_000_000 }
    expect(costMicros(usage, Date.UTC(2026, 11, 31))).toBe(4_500_000)
    expect(costMicros(usage, Date.UTC(2027, 0, 1))).toBe(9_000_000)
  })

  it('refuses to guess a price for an unknown model', () => {
    expect(() => costMicros({ model: 'made-up', inputTokens: 1, outputTokens: 1 }, 0)).toThrow('No price')
  })
})

describe('scoring a reading', () => {
  const line = (quantity: number, unitPrice: number) => ({ description: 'صنف', quantity, unitPrice, lineTotal: quantity * unitPrice, batch: null, expiry: null, confidence: 'high' as const })
  const reading = (lines: ReturnType<typeof line>[], total = 100) => ({ supplierName: null, invoiceNumber: null, invoiceDate: null, total, lines })

  it('counts every quantity and price', () => {
    const score = scoreReading(reading([line(2, 10), line(3, 20)]), reading([line(2, 10), line(3, 25)]))
    expect(score).toMatchObject({ lines: 2, linesFound: 2, numbers: 4, numbersRight: 3, totalRight: true })
  })

  it('is not thrown off by one missed line', () => {
    const score = scoreReading(reading([line(1, 5), line(2, 10), line(3, 20)]), reading([line(2, 10), line(3, 20)]))
    expect(score).toMatchObject({ linesFound: 2, numbersRight: 4, numbers: 6, extraLines: 0 })
  })

  it('notices lines that were never on the invoice', () => {
    expect(scoreReading(reading([line(1, 5)]), reading([line(1, 5), line(9, 9)])).extraLines).toBe(1)
  })
})
