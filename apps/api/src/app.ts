import { Hono } from 'hono'
import { bearerAuth } from 'hono/bearer-auth'
import { cors } from 'hono/cors'
import type { Health } from '@inv/contracts'

export interface AppOptions {
  token: string
  allowedOrigin: string
  version: string
  bootCount: number
}

export function createApp(options: AppOptions) {
  const app = new Hono()

  app.use(
    cors({
      origin: options.allowedOrigin,
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowHeaders: ['Authorization', 'Content-Type'],
    }),
  )

  // CORS only stops browsers reading the response, so foreign origins are refused outright.
  app.use(async (c, next) => {
    const origin = c.req.header('Origin')
    if (origin && origin !== options.allowedOrigin) return c.json({ code: 'FORBIDDEN_ORIGIN' }, 403)
    await next()
  })

  app.use(bearerAuth({ token: options.token }))

  return app.get('/health', (c) => {
    const health: Health = { status: 'ok', version: options.version, bootCount: options.bootCount }
    return c.json(health)
  })
}
