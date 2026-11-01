import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MAX_BYTES = 5 * 1024 * 1024
const FILE = 'app.log'
const PREVIOUS = 'app.1.log'

/** One line per problem, kept on the shop's PC, so a report from a customer has something behind it. */
export function fileLogger(dir: string) {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, FILE)

  return (message: string, details: Record<string, unknown>): void => {
    try {
      if (existsSync(path) && statSync(path).size > MAX_BYTES) renameSync(path, join(dir, PREVIOUS))
      appendFileSync(path, `${JSON.stringify({ at: new Date().toISOString(), message, ...details })}\n`)
    } catch {
      // A log that can't be written must never take the till down with it.
    }
  }
}
