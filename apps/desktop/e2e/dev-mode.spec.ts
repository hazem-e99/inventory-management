import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { cleanUp, completeOnboarding, launch } from './helpers'

const DEV_PORT = 5199

// Every other test runs the built app. Strict Mode only acts here, and `pnpm dev` is how the app
// gets tried, so a screen that stays empty under it would go unseen by all of them.
test('development mode gets through first run and a change of shop name', async () => {
  test.setTimeout(120_000)
  const { createServer } = await import('vite')
  const { default: react } = await import('@vitejs/plugin-react')
  const { default: tailwindcss } = await import('@tailwindcss/vite')

  const userData = mkdtempSync(join(tmpdir(), 'inv-e2e-dev-'))
  const server = await createServer({
    configFile: false,
    root: resolve(__dirname, '../../web'),
    cacheDir: join(userData, 'vite'),
    plugins: [react(), tailwindcss()],
    server: { port: DEV_PORT, strictPort: true },
    logLevel: 'silent',
  })
  await server.listen()

  try {
    const app = await launch(userData, { ELECTRON_RENDERER_URL: `http://localhost:${DEV_PORT}` })
    const page = await app.firstWindow()
    await completeOnboarding(page)

    await page.getByRole('link', { name: 'الإعدادات', exact: true }).click()
    await page.getByLabel('اسم المحل').fill('صيدلية الأمل')
    await page.getByRole('button', { name: 'حفظ', exact: true }).click()
    await expect(page.getByRole('complementary').getByText('صيدلية الأمل')).toBeVisible()

    await page.getByRole('link', { name: 'المساعدة', exact: true }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'المساعدة' })).toBeVisible()
  } finally {
    await cleanUp()
    await server.close()
    await cleanUp(userData)
  }
})
