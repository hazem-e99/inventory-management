import { apiErrorSchema, type ApiError, type ErrorCode } from '@inv/contracts'
import type { z } from 'zod'

export class ApiRequestError extends Error {
  constructor(readonly error: ApiError) {
    super(error.code)
  }

  get code(): ErrorCode {
    return this.error.code
  }
}

interface Connection {
  baseUrl: string
  token: string
}

const SESSION_KEY = 'inventory.session'

let connection: Connection | undefined
let sessionToken: string | null = readSession()
let onSessionLost: (code: ErrorCode) => void = () => {}

// sessionStorage ends with the window, so closing the app always signs the user out.
function readSession(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY)
  } catch {
    return null
  }
}

export function connect(next: Connection): void {
  connection = next
}

export function setSessionToken(token: string | null): void {
  sessionToken = token
  try {
    if (token) sessionStorage.setItem(SESSION_KEY, token)
    else sessionStorage.removeItem(SESSION_KEY)
  } catch {
    // Without storage the session simply lasts until the next reload.
  }
}

export const hasSession = () => sessionToken !== null

export function subscribeSessionLost(listener: (code: ErrorCode) => void): void {
  onSessionLost = listener
}

interface RequestOptions {
  body?: unknown
}

export async function api<T extends z.ZodType>(
  schema: T,
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<z.output<T>> {
  if (!connection) throw new ApiRequestError({ code: 'NETWORK', status: 0 })

  let response: Response
  try {
    response = await fetch(`${connection.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${connection.token}`,
        ...(sessionToken ? { 'X-Session-Token': sessionToken } : {}),
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    })
  } catch {
    throw new ApiRequestError({ code: 'NETWORK', status: 0 })
  }

  const payload: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    const parsed = apiErrorSchema.safeParse(payload)
    const error: ApiError = parsed.success ? parsed.data : { code: 'INTERNAL', status: response.status }
    if (sessionToken && (error.code === 'UNAUTHENTICATED' || error.code === 'SESSION_EXPIRED')) {
      setSessionToken(null)
      onSessionLost(error.code)
    }
    throw new ApiRequestError(error)
  }

  return schema.parse(payload) as z.output<T>
}
