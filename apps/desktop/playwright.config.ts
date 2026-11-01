import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from '@playwright/test'

// Test data stays beside the project, so a large run can't fill the system drive.
const testTemp = resolve(__dirname, '../../.test-tmp')
mkdirSync(testTemp, { recursive: true })
process.env.TEMP = testTemp
process.env.TMP = testTemp

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  workers: 1,
  reporter: 'list',
})
