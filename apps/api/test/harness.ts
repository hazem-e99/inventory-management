import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apiErrorSchema, type ApiError, type OnboardingResult } from '@inv/contracts'
import { createSqliteDb, migrateToLatest } from '@inv/db'
import { afterAll } from 'vitest'
import { createApp, type AppDeps } from '../src'

export const OWNER = { fullName: 'حازم عصام', username: 'owner', password: 'owner-password' }

export const ONBOARDING = {
  locale: 'ar',
  store: { name: 'صيدلية النور', businessType: 'pharmacy' },
  owner: OWNER,
}

export interface Harness {
  deps: AppDeps
  time: { now: number }
  call(method: string, path: string, options?: { session?: string; body?: unknown }): Promise<Response>
  json<T>(method: string, path: string, options?: { session?: string; body?: unknown }): Promise<T>
  failure(method: string, path: string, options?: { session?: string; body?: unknown }): Promise<ApiError>
}

export async function createHarness(): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'inv-api-'))
  const hexKey = randomBytes(32).toString('hex')
  const db = createSqliteDb({ path: join(dir, 'test.db'), hexKey })
  await migrateToLatest(db)

  const time = { now: 1_800_000_000_000 }
  const deps: AppDeps = {
    db,
    token: 'test-token',
    allowedOrigin: 'app://renderer',
    version: '0.0.0',
    bootCount: 3,
    databaseKey: hexKey,
    backupsDir: join(dir, 'backups'),
    clock: () => time.now,
    logError: () => {},
  }
  const app = createApp(deps)

  afterAll(async () => {
    await db.destroy()
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  const call: Harness['call'] = async (method, path, { session, body } = {}) =>
    app.request(path, {
      method,
      headers: {
        Authorization: 'Bearer test-token',
        ...(session ? { 'X-Session-Token': session } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })

  return {
    deps,
    time,
    call,
    async json<T>(method: string, path: string, options?: { session?: string; body?: unknown }) {
      const response = await call(method, path, options)
      const payload: unknown = await response.json()
      if (response.status !== 200) throw new Error(`${path}: ${JSON.stringify(payload)}`)
      return payload as T
    },
    async failure(method, path, options) {
      const response = await call(method, path, options)
      const parsed = apiErrorSchema.parse(await response.json())
      if (response.status !== parsed.status) throw new Error('Body status differs from HTTP status')
      return parsed
    },
  }
}

export async function onboarded(): Promise<{ harness: Harness; owner: OnboardingResult }> {
  const harness = await createHarness()
  const owner = await harness.json<OnboardingResult>('POST', '/onboarding', { body: ONBOARDING })
  return { harness, owner }
}
