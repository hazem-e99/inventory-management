// Builds a ready-made pharmacy to show the app with, then opens it:
//   pnpm demo            builds the shop if it is missing, and opens the app on it
//   pnpm demo --reset    starts the shop again from nothing
// It stays in .demo-data and never touches a real profile.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { signLicenseToken } from '@inv/license-core'
import { _electron as electron, type ElectronApplication } from '@playwright/test'
import { DEVELOPMENT_PRIVATE_KEY } from '../e2e/dev-license-key.ts'
import { DEMO_LOGIN } from './demo-seed.mts'

const LICENSE_DAYS = 365
const DAY_MS = 86_400_000

const appRoot = resolve(import.meta.dirname, '..')
export const demoData = resolve(appRoot, '../../.demo-data')

/** Closes from the window, as a person does: Chromium only saves its encryption key on a clean exit. */
export async function closeApp(app: ElectronApplication): Promise<void> {
  const child = app.process()
  const exited = new Promise((done) => app.once('close', done))
  await app.evaluate(({ BrowserWindow }) => {
    setTimeout(() => BrowserWindow.getAllWindows()[0]?.close(), 200)
  })
  await Promise.race([exited, new Promise((done) => setTimeout(done, 20_000))])
  if (child.pid && child.exitCode === null) spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'])
}

async function firstLaunch() {
  const app = await electron.launch({ args: [appRoot, `--user-data-dir=${demoData}`], cwd: appRoot })
  await app.firstWindow()
  const key = readFileSync(join(demoData, 'db.key')).toString('base64')
  const hexKey = await app.evaluate(({ safeStorage }, encrypted) => safeStorage.decryptString(Buffer.from(encrypted, 'base64')), key)
  await closeApp(app)
  return hexKey
}

/** The app's own device id signed with the development key, as an offline code would be. */
async function activate() {
  const app = await electron.launch({ args: [appRoot, `--user-data-dir=${demoData}`], cwd: appRoot })
  const page = await app.firstWindow()
  await page.getByRole('heading', { name: 'تسجيل الدخول' }).waitFor()
  await page.getByLabel('اسم المستخدم').fill(DEMO_LOGIN.username)
  await page.getByRole('textbox', { name: 'كلمة المرور' }).fill(DEMO_LOGIN.password)
  await page.getByRole('button', { name: 'دخول' }).click()
  await page.getByRole('button', { name: 'لا يوجد إنترنت؟' }).click()
  const fingerprint = (await page.getByTestId('device-id').innerText()).trim()
  const code = signLicenseToken(
    {
      v: 1,
      licenseId: 'demo',
      customer: 'صيدلية الشفاء',
      fingerprint,
      issuedAt: Date.now(),
      expiresAt: Date.now() + LICENSE_DAYS * DAY_MS,
      suspended: false,
    },
    DEVELOPMENT_PRIVATE_KEY,
  )
  await page.getByLabel('كود التفعيل').fill(code)
  await page.getByRole('button', { name: 'تفعيل بالكود' }).click()
  await page.getByRole('heading', { name: /أحمد سامي/ }).waitFor()
  await closeApp(app)
}

export async function buildDemo(): Promise<void> {
  rmSync(demoData, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  const hexKey = await firstLaunch()
  // Its own process: the database driver stalls when it opens beside Playwright's Electron link.
  const seeded = spawnSync('pnpm', ['exec', 'tsx', 'scripts/demo-seed.mts'], {
    cwd: appRoot,
    shell: true,
    stdio: ['ignore', 'pipe', 'inherit'],
    encoding: 'utf8',
    env: { ...process.env, DEMO_PATH: join(demoData, 'inventory.db'), DEMO_BACKUPS: join(demoData, 'backups'), DEMO_KEY: hexKey },
  })
  if (seeded.status !== 0) throw new Error('Seeding the demo shop failed')
  const [summary, recoveryCode] = seeded.stdout.trim().split(/\r?\n/).slice(-2)
  console.log(summary)
  await activate()
  writeFileSync(join(demoData, 'login.txt'), `اسم المستخدم: ${DEMO_LOGIN.username}\nكلمة المرور: ${DEMO_LOGIN.password}\nكود الاسترجاع: ${recoveryCode}\n`)
}

if (process.argv[1]?.endsWith('demo.mts')) {
  if (process.argv.includes('--reset') || !existsSync(join(demoData, 'login.txt'))) await buildDemo()
  console.log(`\nDemo login: ${DEMO_LOGIN.username} / ${DEMO_LOGIN.password}\n`)
  if (!process.argv.includes('--build-only')) {
    spawnSync('pnpm', ['exec', 'electron-vite', 'dev', '--', `--user-data-dir=${demoData}`], { cwd: appRoot, shell: true, stdio: 'inherit' })
  }
}
