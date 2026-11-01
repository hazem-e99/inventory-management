import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { serveStatic } from '@hono/node-server/serve-static'
import type { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import type { ServerEnv } from './app'

/** Serves the admin panel from the same origin as its API, which is what its cookies rely on. */
export function servePanel(app: Hono<ServerEnv>, root: string): void {
  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'self'"],
      },
      referrerPolicy: 'no-referrer',
    }),
  )
  app.use('/assets/*', serveStatic({ root }))
  app.get('*', async (c) => c.html(await readFile(join(root, 'index.html'), 'utf8')))
}
