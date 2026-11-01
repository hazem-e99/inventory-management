import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test'

const appRoot = join(__dirname, '..')
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')

export const OWNER_PASSWORD = 'owner-password'

interface AxeResult {
  violations: Array<{ id: string; impact?: string; nodes: Array<{ html: string }> }>
}

const running = new Set<ElectronApplication>()

export async function launch(userData: string): Promise<ElectronApplication> {
  const app = await electron.launch({ args: [appRoot, `--user-data-dir=${userData}`], cwd: appRoot })
  running.add(app)
  app.once('close', () => running.delete(app))
  return app
}

/** Runs even when a step fails, and never hides that failure behind a cleanup error. */
export async function cleanUp(...directories: string[]): Promise<void> {
  // A wedged window must not hold the run open and swallow the real failure.
  await Promise.all(
    [...running].map((app) =>
      Promise.race([app.close().catch(() => {}), new Promise((done) => setTimeout(done, 5_000))]),
    ),
  )
  for (const directory of directories) {
    try {
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    } catch {
      // A leftover temp folder must not mask the test result.
    }
  }
}

export async function chooseFile(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [file] })
  }, path)
}

export async function chooseDestination(app: ElectronApplication, path: string): Promise<void> {
  await app.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: file })
  }, path)
}

/** Fails on anything serious, including contrast, in the rendered theme and direction. */
export async function expectAccessible(page: Page): Promise<void> {
  // Contrast must be measured on settled colours, not midway through a transition.
  await page.evaluate(() => Promise.allSettled(document.getAnimations().map(({ finished }) => finished)))
  await page.evaluate(axeSource)
  const serious = await page.evaluate(async () => {
    const { axe } = window as unknown as { axe: { run(context: Document, options: object): Promise<AxeResult> } }
    const { violations } = await axe.run(document, { iframes: false })
    return violations
      .filter(({ impact }) => impact === 'serious' || impact === 'critical')
      .map(({ id, nodes }) => `${id}: ${nodes[0]?.html}`)
  })
  expect(serious).toEqual([])
}

/** Walks the whole first-run flow in Arabic and returns the recovery code. */
export async function completeOnboarding(page: Page, business: RegExp = /صيدلية/): Promise<string> {
  await expectAccessible(page)
  await page.getByRole('button', { name: 'التالي' }).click()
  await page.getByRole('radio', { name: business }).click()
  await expectAccessible(page)
  await page.getByRole('button', { name: 'التالي' }).click()

  await page.getByLabel('اسم المحل').fill('صيدلية النور')
  await page.getByLabel(/الرقم الضريبي/).fill('123')
  await page.getByRole('button', { name: 'التالي' }).click()
  await expect(page.getByText('الرقم الضريبي يتكون من 9 أرقام.')).toBeVisible()
  await page.getByLabel(/الرقم الضريبي/).fill('123456789')
  await page.getByRole('button', { name: 'التالي' }).click()

  await page.getByLabel('الاسم بالكامل').fill('حازم عصام')
  await page.getByLabel('اسم المستخدم').fill('owner')
  await page.getByLabel('كلمة المرور', { exact: true }).fill(OWNER_PASSWORD)
  await page.getByLabel('تأكيد كلمة المرور').fill('different-password')
  await page.getByRole('button', { name: 'إنشاء الحساب' }).click()
  await expect(page.getByText('كلمتا المرور غير متطابقتين. أعد كتابتهما.')).toBeVisible()
  await page.getByLabel('تأكيد كلمة المرور').fill(OWNER_PASSWORD)
  await page.getByRole('button', { name: 'إنشاء الحساب' }).click()

  const code = await page.getByTestId('recovery-code').innerText()
  await expectAccessible(page)
  const start = page.getByRole('button', { name: 'ابدأ استخدام البرنامج' })
  await expect(start).toBeDisabled()
  await page.getByRole('checkbox', { name: /كتبت الكود/ }).check()
  await start.click()
  await expect(page.getByRole('heading', { name: 'أهلاً، حازم عصام' })).toBeVisible()
  return code
}

const BARCODE = '4006381333931'

export async function importProduct(app: ElectronApplication, page: Page, directory: string): Promise<void> {
  const csv = join(directory, 'items.csv')
  writeFileSync(csv, `اسم الصنف,الباركود,سعر البيع\nبنادول اكسترا,${BARCODE},45.5\n`)
  await chooseFile(app, csv)
  await page.getByRole('link', { name: 'الأصناف', exact: true }).click()
  await page.getByRole('button', { name: 'استيراد من ملف' }).click()
  await page.getByRole('button', { name: 'اختيار ملف' }).click()
  await page.getByRole('button', { name: 'استيراد 1 صنف' }).click()
  await expect(page.getByRole('link', { name: 'بنادول اكسترا' })).toBeVisible()
}

/** Types the code and presses Enter, exactly as a keyboard-wedge scanner does. */
export async function scan(page: Page): Promise<void> {
  const picker = page.getByRole('searchbox', { name: /امسح الباركود/ })
  await picker.fill(BARCODE)
  await picker.press('Enter')
  await expect(picker).toHaveValue('')
}
