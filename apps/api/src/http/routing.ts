import { OpenAPIHono, type z } from '@hono/zod-openapi'
import type { AppEnv } from './context'
import { validationError } from './errors'

export function router() {
  return new OpenAPIHono<AppEnv>({
    defaultHook: (result) => {
      if (!result.success) throw validationError(result.error)
    },
  })
}

export const jsonBody = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { 'application/json': { schema } },
})

export const jsonOk = <T extends z.ZodType>(schema: T) => ({
  description: 'OK',
  content: { 'application/json': { schema } },
})
