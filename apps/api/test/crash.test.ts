import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createSqliteDb, isSqliteDbHealthy } from '@inv/db'
import { describe, expect, it } from 'vitest'

const KILL_AFTER_SALES = 25

function sellUntilKilled(path: string, hexKey: string, backupsDir: string): Promise<number> {
  return new Promise((done, fail) => {
    const worker = spawn(process.execPath, ['--import', 'tsx', resolve(import.meta.dirname, 'crash-worker.ts'), path, hexKey, backupsDir], {
      cwd: import.meta.dirname,
    })
    let confirmed = 0
    let errors = ''
    worker.stderr.on('data', (chunk: Buffer) => (errors += chunk.toString()))
    worker.stdout.on('data', (chunk: Buffer) => {
      confirmed = Number(/sold (\d+)\n$/.exec(chunk.toString())?.[1] ?? confirmed)
      if (confirmed >= KILL_AFTER_SALES) worker.kill('SIGKILL')
    })
    worker.on('exit', () => (confirmed > 0 ? done(confirmed) : fail(new Error(errors))))
  })
}

describe('the power going out in the middle of a sale', () => {
  it('loses no confirmed sale, keeps no half of one, and leaves a healthy file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'inv-crash-'))
    const database = { path: join(dir, 'shop.db'), hexKey: randomBytes(32).toString('hex') }

    try {
      const confirmed = await sellUntilKilled(database.path, database.hexKey, join(dir, 'backups'))
      expect(confirmed).toBeGreaterThanOrEqual(KILL_AFTER_SALES)

      expect(isSqliteDbHealthy(database)).toBe(true)

      const db = createSqliteDb(database)
      try {
        const sales = await db.selectFrom('sales').select('id').execute()
        const payments = await db.selectFrom('sale_payments').select('sale_id').execute()
        const lines = await db.selectFrom('sale_lines').select('sale_id').execute()
        const sold = await db.selectFrom('stock_movements').select('qty_milli').where('document_type', '=', 'sale').execute()
        const shelf = await db.selectFrom('variant_stock').select('qty_milli').executeTakeFirstOrThrow()

        // The last sale may have committed in the moment before its line was printed.
        expect(sales.length).toBeGreaterThanOrEqual(confirmed)
        expect(payments).toHaveLength(sales.length)
        expect(lines).toHaveLength(sales.length)
        expect(sold).toHaveLength(sales.length)
        expect(Number(shelf.qty_milli)).toBe(100_000_000 - sales.length * 1000)
      } finally {
        await db.destroy()
      }
    } finally {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    }
  }, 60_000)
})
