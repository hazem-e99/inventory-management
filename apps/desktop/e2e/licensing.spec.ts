import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { DEVELOPMENT_PRIVATE_KEY } from './dev-license-key'
import { activateOffline, cleanUp, completeOnboardingWithoutLicense, expectAccessible, launch, pasteCode } from './helpers'
import { TOTP, Secret } from 'otpauth'

const PORT = 8791
const SERVER = `http://127.0.0.1:${PORT}`
const ADMIN = { email: 'admin@example.com', password: 'development-password' }

async function startLicenseServer(): Promise<ChildProcess> {
  const child = spawn('pnpm', ['exec', 'tsx', 'src/dev.ts'], {
    cwd: resolve(__dirname, '../../license-server'),
    shell: true,
    env: { ...process.env, PORT: String(PORT), LICENSE_PRIVATE_KEY: DEVELOPMENT_PRIVATE_KEY },
  })
  await new Promise<void>((ready, failed) => {
    child.stdout?.on('data', (data: Buffer) => {
      if (data.toString().includes('READY')) ready()
    })
    child.once('exit', (code) => failed(new Error(`License server exited with ${code}`)))
  })
  return child
}

/** A plain kill stops only the shell around the server on Windows, and leaves the port taken. */
function stopLicenseServer(child: ChildProcess): void {
  spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'])
}

/** The developer's side, through the same calls the panel makes. */
async function signInAsDeveloper() {
  let cookie = ''
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${SERVER}${path}`, {
      method,
      headers: { 'content-type': 'application/json', origin: SERVER, cookie },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const set = response.headers.getSetCookie().map((value) => value.split(';')[0]!)
    if (set.length > 0) cookie = set.join('; ')
    expect(response.ok, `${path}: ${response.status}`).toBe(true)
    return response.json() as Promise<any>
  }

  await call('POST', '/api/auth/sign-in/email', ADMIN)
  const { totpURI } = await call('POST', '/api/auth/two-factor/enable', { password: ADMIN.password })
  const secret = new URL(totpURI as string).searchParams.get('secret')!
  const code = () => new TOTP({ secret: Secret.fromBase32(secret) }).generate()
  await call('POST', '/api/auth/two-factor/verify-totp', { code: code() })
  await call('POST', '/api/auth/sign-in/email', ADMIN)
  await call('POST', '/api/auth/two-factor/verify-totp', { code: code() })
  return call
}

async function updateFromServer(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'تحديث من الخادم' }).click()
  await expect(page.getByText('تم تحديث الترخيص').last()).toBeVisible()
}

test('a serial issued from the panel activates, extends, stops and resumes the app', async () => {
  test.setTimeout(150_000)
  const userData = mkdtempSync(join(tmpdir(), 'inv-e2e-license-'))
  const server = await startLicenseServer()

  try {
    const admin = await signInAsDeveloper()
    const { id: customerId } = await admin('POST', '/admin/customers', { name: 'صيدلية النور', phone: '01000000000', businessType: 'pharmacy' })
    const { id: licenseId, serial } = await admin('POST', `/admin/customers/${customerId}/licenses`, { amount: 7, unit: 'day' })

    const app = await launch(userData, { INV_LICENSE_SERVER: SERVER })
    const page = await app.firstWindow()
    await completeOnboardingWithoutLicense(page)

    // Nothing opens until the app is activated.
    await expect(page.getByRole('heading', { name: 'تفعيل البرنامج' })).toBeVisible()
    await expectAccessible(page)

    await page.getByLabel('السيريال').fill('AAAAA-BBBBB-CCCCC-DDDDD')
    await page.getByRole('button', { name: 'تفعيل', exact: true }).click()
    await expect(page.getByText('السيريال غير صحيح')).toBeVisible()

    await page.getByLabel('السيريال').fill(serial as string)
    await page.getByRole('button', { name: 'تفعيل', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'أهلاً، حازم عصام' })).toBeVisible()

    await page.getByRole('link', { name: 'الترخيص' }).click()
    await expect(page.getByTestId('license-days')).toHaveText('7')
    await expect(page.getByText('صيدلية النور').last()).toBeVisible()
    await expectAccessible(page)

    // The server now knows the device, and an early renewal adds to what is left.
    const bound = await admin('GET', `/admin/licenses/${licenseId}`)
    expect(bound).toMatchObject({ state: 'active' })
    expect(bound.fingerprint).toMatch(/^[0-9a-f]{32}$/)

    await admin('POST', `/admin/licenses/${licenseId}/extend`, { amount: 30, unit: 'day' })
    await updateFromServer(page)
    await expect(page.getByTestId('license-days')).toHaveText('37')

    // Suspended from the panel: selling stops, reading and backups carry on.
    await admin('POST', `/admin/licenses/${licenseId}/suspend`)
    await updateFromServer(page)
    await expect(page.getByRole('status').filter({ hasText: 'الترخيص موقوف' })).toBeVisible()
    await expectAccessible(page)

    await page.getByRole('link', { name: 'نقطة البيع' }).click()
    await expect(page.getByRole('heading', { name: 'البيع متوقف' })).toBeVisible()

    await page.getByRole('link', { name: 'الأصناف', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'الأصناف', exact: true })).toBeVisible()
    await page.getByRole('link', { name: 'النسخ الاحتياطي' }).click()
    await page.getByRole('button', { name: 'إنشاء نسخة الآن' }).click()
    await expect(page.getByText('تم إنشاء النسخة').first()).toBeVisible()

    await page.getByRole('link', { name: 'الموردون' }).click()
    await page.getByRole('button', { name: 'إضافة مورد' }).click()
    await page.getByLabel('اسم المورد').fill('مورد جديد')
    await page.getByRole('dialog').getByRole('button', { name: 'حفظ' }).click()
    await expect(page.getByText('البرنامج في وضع القراءة فقط')).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: 'إلغاء' }).click()

    // Resumed: the same screens work again.
    await admin('POST', `/admin/licenses/${licenseId}/resume`)
    await page.getByRole('link', { name: 'الترخيص' }).click()
    await updateFromServer(page)
    await expect(page.getByRole('status').filter({ hasText: 'الترخيص موقوف' })).toHaveCount(0)

    await page.getByRole('link', { name: 'نقطة البيع' }).click()
    await expect(page.getByRole('heading', { name: 'فتح وردية' })).toBeVisible()

    // Unbound for a new machine: this one has to activate again.
    await admin('POST', `/admin/licenses/${licenseId}/unbind`)
    await page.getByRole('link', { name: 'الترخيص' }).click()
    await page.getByRole('button', { name: 'تحديث من الخادم' }).click()
    await expect(page.getByRole('heading', { name: 'تفعيل البرنامج' })).toBeVisible()

    await app.close()
  } finally {
    stopLicenseServer(server)
    await cleanUp(userData)
  }
})

test('an expired license warns, then turns read-only, and a new code brings it back', async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'inv-e2e-expiry-'))

  try {
    const app = await launch(userData)
    const page = await app.firstWindow()
    await completeOnboardingWithoutLicense(page)

    // Lapsed two days ago: inside the grace period, so work carries on with a warning.
    await activateOffline(page, -2)
    await expect(page.getByRole('status').filter({ hasText: 'أمامك 5 يوم' })).toBeVisible()
    await page.getByRole('link', { name: 'نقطة البيع' }).click()
    await expect(page.getByRole('heading', { name: 'فتح وردية' })).toBeVisible()

    // Past the grace period: read-only, and the banner says the data is safe.
    await page.getByRole('link', { name: 'الترخيص' }).click()
    await pasteCode(page, -8)
    await expect(page.getByRole('status').filter({ hasText: 'للقراءة فقط' })).toBeVisible()
    await page.getByRole('link', { name: 'نقطة البيع' }).click()
    await expect(page.getByRole('heading', { name: 'البيع متوقف' })).toBeVisible()

    // Renewed: everything is back, with nothing lost.
    await page.getByRole('link', { name: 'الترخيص' }).click()
    await pasteCode(page, 365)
    await expect(page.getByTestId('license-days')).toHaveText('365')
    await expect(page.getByRole('status').filter({ hasText: 'للقراءة فقط' })).toHaveCount(0)
    await page.getByRole('link', { name: 'نقطة البيع' }).click()
    await expect(page.getByRole('heading', { name: 'فتح وردية' })).toBeVisible()

    await app.close()
  } finally {
    await cleanUp(userData)
  }
})
