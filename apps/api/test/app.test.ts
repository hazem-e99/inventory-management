import { apiErrorSchema, healthSchema } from '@inv/contracts'
import { describe, expect, it } from 'vitest'
import { createHarness } from './harness'

const harness = await createHarness()
const request = (path: string, headers: Record<string, string> = {}) =>
  createAppRequest(path, headers)

async function createAppRequest(path: string, headers: Record<string, string>) {
  const { createApp } = await import('../src')
  return createApp(harness.deps).request(path, { headers })
}

describe('transport guard', () => {
  it('returns health to an authorised caller', async () => {
    const response = await harness.call('GET', '/health')
    expect(response.status).toBe(200)
    expect(healthSchema.parse(await response.json()).bootCount).toBe(3)
  })

  it('accepts the app origin', async () => {
    const response = await request('/health', {
      Authorization: 'Bearer test-token',
      Origin: 'app://renderer',
    })
    expect(response.status).toBe(200)
  })

  it('rejects a missing token in the standard error format', async () => {
    const response = await request('/health')
    expect(response.status).toBe(401)
    expect(apiErrorSchema.parse(await response.json()).code).toBe('UNAUTHENTICATED')
  })

  it('rejects a wrong token', async () => {
    const response = await request('/health', { Authorization: 'Bearer nope' })
    expect(response.status).toBe(401)
  })

  it('rejects a foreign origin even with a valid token', async () => {
    const response = await request('/health', {
      Authorization: 'Bearer test-token',
      Origin: 'https://evil.example',
    })
    expect(response.status).toBe(403)
    expect(apiErrorSchema.parse(await response.json()).code).toBe('FORBIDDEN_ORIGIN')
  })

  it('returns NOT_FOUND with a trace id for an unknown route', async () => {
    const failure = await harness.failure('GET', '/nowhere')
    expect(failure.code).toBe('NOT_FOUND')
    expect(failure.traceId).toBeTruthy()
  })
})

describe('openapi document', () => {
  it('describes the routes', async () => {
    const response = await harness.call('GET', '/openapi.json')
    expect(response.status).toBe(200)
    const document = (await response.json()) as { paths: Record<string, unknown> }
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining(['/auth/login', '/users', '/users/{id}', '/backups']),
    )
  })
})
