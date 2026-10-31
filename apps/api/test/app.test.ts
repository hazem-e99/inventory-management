import { healthSchema } from '@inv/contracts'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app'

const token = 'test-token'
const allowedOrigin = 'app://renderer'
const app = createApp({ token, allowedOrigin, version: '0.0.0', bootCount: 3 })
const auth = { Authorization: `Bearer ${token}` }

describe('GET /health', () => {
  it('returns a valid payload for an authorised caller', async () => {
    const response = await app.request('/health', { headers: auth })
    expect(response.status).toBe(200)
    expect(healthSchema.parse(await response.json()).bootCount).toBe(3)
  })

  it('accepts the app origin', async () => {
    const response = await app.request('/health', { headers: { ...auth, Origin: allowedOrigin } })
    expect(response.status).toBe(200)
  })

  it('rejects a missing token', async () => {
    const response = await app.request('/health')
    expect(response.status).toBe(401)
  })

  it('rejects a wrong token', async () => {
    const response = await app.request('/health', { headers: { Authorization: 'Bearer nope' } })
    expect(response.status).toBe(401)
  })

  it('rejects a foreign origin even with a valid token', async () => {
    const response = await app.request('/health', {
      headers: { ...auth, Origin: 'https://evil.example' },
    })
    expect(response.status).toBe(403)
  })
})
