import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Test databases stay beside the project, so a large run can't fill the system drive.
const testTemp = resolve(import.meta.dirname, '.test-tmp')
mkdirSync(testTemp, { recursive: true })
process.env.TEMP = testTemp
process.env.TMP = testTemp
process.env.TMPDIR = testTemp

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'db',
          root: 'packages/db',
          include: ['test/**/*.test.ts'],
          environment: 'node',
          // Starting PGlite and running every migration is slow when the whole suite runs at once.
          hookTimeout: 60_000,
          testTimeout: 30_000,
        },
      },
      {
        test: {
          name: 'bench',
          root: 'packages/db',
          include: ['bench/**/*.bench.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'i18n',
          root: 'packages/i18n',
          include: ['test/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'domain',
          root: 'packages/domain',
          include: ['test/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'desktop',
          root: 'apps/desktop',
          include: ['test/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'api',
          root: 'apps/api',
          include: ['test/**/*.test.ts'],
          environment: 'node',
          // Each test hashes real passwords, which queues up when the machine is busy elsewhere.
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
})
