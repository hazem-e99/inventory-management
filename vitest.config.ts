import { defineConfig } from 'vitest/config'

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
        },
      },
    ],
  },
})
