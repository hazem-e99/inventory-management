import { existsSync, mkdtempSync, openSync, readSync, closeSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'

const appRoot = join(__dirname, '..')

async function launch(userData: string): Promise<ElectronApplication> {
  return electron.launch({ args: [appRoot, `--user-data-dir=${userData}`], cwd: appRoot })
}

test('boots, persists to an encrypted database, and keeps data across restarts', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'inv-e2e-'))

  try {
    const first = await launch(userData)
    const firstWindow = await first.firstWindow()
    await expect(firstWindow.getByTestId('health-status')).toHaveText('ok')
    await expect(firstWindow.getByTestId('boot-count')).toHaveText('1')
    await first.close()

    const second = await launch(userData)
    const secondWindow = await second.firstWindow()
    await expect(secondWindow.getByTestId('boot-count')).toHaveText('2')
    await second.close()

    const databasePath = join(userData, 'inventory.db')
    expect(existsSync(databasePath)).toBe(true)

    const header = Buffer.alloc(16)
    const fd = openSync(databasePath, 'r')
    readSync(fd, header, 0, 16, 0)
    closeSync(fd)
    expect(header.toString('latin1')).not.toBe('SQLite format 3\0')
  } finally {
    rmSync(userData, { recursive: true, force: true })
  }
})
