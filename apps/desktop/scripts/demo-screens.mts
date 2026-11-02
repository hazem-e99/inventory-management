// Photographs every feature of the built app on the demo shop, in the folder beside the project:
//   pnpm demo --build-only && pnpm --filter @inv/desktop build && pnpm --filter @inv/desktop screens
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { closeApp, demoData } from './demo.mts'
import { DEMO_LOGIN } from './demo-seed.mts'

const WIDTH = 1600
const HEIGHT = 1000
const SCALE = 1.5

const appRoot = resolve(import.meta.dirname, '..')
const outputDir = resolve(appRoot, '../../سكرين شوت')

// A working copy, so photographing the shop never changes what `pnpm demo` opens.
const workingData = mkdtempSync(join(resolve(appRoot, '../../.test-tmp'), 'screens-'))
const staged = join(workingData, 'shop')
const fresh = join(workingData, 'fresh')

async function open(userData: string): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ args: [appRoot, `--user-data-dir=${userData}`], cwd: appRoot })
  const page = await app.firstWindow()
  // A fixed canvas, so the pictures don't depend on the size of the screen they were taken on.
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE, mobile: false })
  return { app, page }
}

/** Settled means no skeleton, no toast and no chart still animating in. */
async function settle(page: Page): Promise<void> {
  // Parked over empty space, so no menu row is left looking selected.
  await page.mouse.move(WIDTH / 2, HEIGHT - 2)
  await page.waitForFunction(() => document.querySelector('[aria-busy="true"]') === null, undefined, { timeout: 15_000 })
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(350)
  // Raced, because a looping animation never finishes.
  await page.evaluate(() => Promise.race([Promise.allSettled(document.getAnimations().map(({ finished }) => finished)), new Promise((done) => setTimeout(done, 1200))]))
}

let shot = 0
async function snap(page: Page, name: string): Promise<void> {
  await settle(page)
  shot += 1
  await page.screenshot({ path: join(outputDir, `${String(shot).padStart(2, '0')}-${name}.png`) })
  console.log(`${shot} ${name}`)
}

async function go(page: Page, route: string): Promise<void> {
  const before = await page.evaluate(() => document.querySelector('main')?.innerText ?? '')
  await page.evaluate((hash) => {
    window.location.hash = hash
  }, route)
  await page.waitForFunction((previous) => {
    const main = document.querySelector('main')
    return main !== null && main.innerText !== previous
  }, before, { timeout: 10_000 }).catch(() => undefined)
  await settle(page)
}

const visit = async (page: Page, route: string, name: string) => {
  await go(page, route)
  await snap(page, name)
}

async function signIn(page: Page): Promise<void> {
  await page.getByLabel(/اسم المستخدم|Username/).fill(DEMO_LOGIN.username)
  await page.getByRole('textbox', { name: /كلمة المرور|Password/ }).fill(DEMO_LOGIN.password)
  await page.getByRole('button', { name: /^(دخول|Sign in)$/ }).last().click()
  await page.getByRole('heading', { name: /أحمد سامي/ }).waitFor({ timeout: 15_000 })
}

/** Opens the first row that links to a detail page, from any list. */
async function firstLink(page: Page, pattern: string): Promise<string> {
  const href = await page.locator(`main a[href*="${pattern}"]:not([href*="/new"])`).first().getAttribute('href')
  if (!href) throw new Error(`No link matching ${pattern}`)
  return href.slice(href.indexOf('#') + 1)
}

async function firstRun(): Promise<void> {
  const { app, page } = await open(fresh)
  await snap(page, 'بداية-التشغيل-اختيار-اللغة')
  await page.getByRole('button', { name: 'التالي' }).click()
  await snap(page, 'بداية-التشغيل-نوع-النشاط')
  await closeApp(app)
}

async function arabicTour(page: Page, app: ElectronApplication): Promise<void> {
  await snap(page, 'الرئيسية-لوحة-المتابعة')

  // The till with a real basket on it.
  await go(page, '/pos')
  const picker = page.getByRole('searchbox', { name: /امسح الباركود/ })
  for (const search of ['باراسيتامول 500', 'أوميبرازول', 'فيتامين د3', 'كمامات']) {
    await picker.fill(search)
    await picker.press('Enter')
    await page.waitForTimeout(400)
    const option = page.getByRole('option').first()
    if (await option.isVisible().catch(() => false)) {
      await option.click()
      await page.waitForTimeout(200)
    }
  }
  await snap(page, 'الكاشير-فاتورة-جارية')
  await page.keyboard.press('F12')
  await snap(page, 'الكاشير-الدفع-المختلط')
  await page.keyboard.press('Escape')

  await visit(page, '/sales', 'المبيعات-الفواتير')
  const sale = await firstLink(page, '/sales/')
  await visit(page, sale, 'المبيعات-تفاصيل-الفاتورة')
  await visit(page, `${sale}/return`, 'المبيعات-مرتجع')

  await visit(page, '/customers', 'العملاء-القائمة')
  await visit(page, await firstLink(page, '/customers/'), 'العملاء-كشف-الحساب')
  await visit(page, '/shifts', 'الورديات-القائمة')
  await visit(page, await firstLink(page, '/shifts/'), 'الورديات-تفاصيل-الوردية')

  await visit(page, '/products', 'الأصناف-القائمة')
  const product = await firstLink(page, '/products/')
  await visit(page, product, 'الأصناف-بيانات-الصنف')
  await visit(page, `${product}/stock`, 'الأصناف-الرصيد-والدفعات')
  await go(page, '/products')
  await page.getByRole('button', { name: 'استيراد وتصدير' }).click()
  await page.getByRole('menuitem', { name: 'استيراد من ملف' }).click()
  await snap(page, 'الأصناف-الاستيراد-من-اكسل')
  await page.keyboard.press('Escape')
  await page.locator('main [aria-haspopup="menu"]').nth(1).click()
  await page.getByRole('menuitem', { name: 'طباعة ملصقات' }).click()
  await snap(page, 'الأصناف-طباعة-ملصقات-الباركود')
  await page.keyboard.press('Escape')
  await visit(page, '/catalog', 'الأصناف-التصنيفات-والوحدات')

  await visit(page, '/stock', 'المخزون-المستندات')
  await visit(page, await firstLink(page, '/stock/'), 'المخزون-ورقة-جرد')
  await visit(page, '/stock/new/transfer', 'المخزون-تحويل-بين-المخازن')
  await visit(page, '/stock/new/adjustment', 'المخزون-تسوية')

  await visit(page, '/purchases', 'المشتريات-الفواتير')
  await visit(page, await firstLink(page, '/purchases/'), 'المشتريات-تفاصيل-الفاتورة')
  await visit(page, '/orders', 'المشتريات-أوامر-الشراء')
  await visit(page, await firstLink(page, '/orders/'), 'المشتريات-تفاصيل-أمر-الشراء')
  await visit(page, '/suppliers', 'الموردون-القائمة')
  await visit(page, await firstLink(page, '/suppliers/'), 'الموردون-كشف-الحساب')

  await visit(page, '/reports', 'التقارير-القائمة')
  const reports: Array<[string, string]> = [
    ['sales', 'المبيعات-اليومية'],
    ['items', 'ربحية-الأصناف'],
    ['inventory', 'قيمة-المخزون'],
    ['movements', 'حركة-المخزون'],
    ['reorder', 'إعادة-الطلب'],
    ['expiry', 'قرب-الانتهاء'],
    ['dead', 'الأصناف-الراكدة'],
    ['suppliers', 'حسابات-الموردين'],
    ['customers', 'حسابات-العملاء'],
    ['shifts', 'تقرير-الورديات'],
  ]
  for (const [key, label] of reports) {
    // Through the list, as a person gets there, so each report starts from its own filters.
    await go(page, '/reports')
    await visit(page, `/reports/${key}`, `التقارير-${label}`)
  }

  await visit(page, '/users', 'المستخدمون')
  await visit(page, '/roles', 'الأدوار-والصلاحيات')
  await visit(page, '/audit', 'سجل-المراجعة')
  await visit(page, '/backups', 'النسخ-الاحتياطي')
  await visit(page, '/license', 'الترخيص')
  await visit(page, '/settings', 'الإعدادات')
  await visit(page, '/help', 'المساعدة-ودليل-الاستخدام')

  void app
}

async function otherLooks(page: Page): Promise<void> {
  await go(page, '/settings')
  await page.getByRole('radio', { name: 'داكن' }).click()
  await page.locator('html[data-theme="dark"]').waitFor({ state: 'attached' })
  await visit(page, '/', 'الوضع-الداكن-الرئيسية')
  await go(page, '/reports')
  await visit(page, '/reports/sales', 'الوضع-الداكن-التقارير')
  await visit(page, '/products', 'الوضع-الداكن-الأصناف')

  await go(page, '/settings')
  await page.getByRole('radio', { name: 'فاتح' }).click()
  await page.getByRole('radio', { name: 'English' }).click()
  await page.locator('html[lang="en"]').waitFor({ state: 'attached' })
  await visit(page, '/', 'English-dashboard')
  await visit(page, '/products', 'English-items')
  await go(page, '/reports')
  await visit(page, '/reports/items', 'English-report')
}

if (!existsSync(join(demoData, 'login.txt'))) throw new Error('Run pnpm demo --build-only first.')

try {
  rmSync(outputDir, { recursive: true, force: true })
  mkdirSync(outputDir, { recursive: true })
  mkdirSync(fresh, { recursive: true })
  cpSync(demoData, staged, { recursive: true })

  await firstRun()

  const { app, page } = await open(staged)
  await snap(page, 'تسجيل-الدخول')
  await signIn(page)
  await arabicTour(page, app)
  await otherLooks(page)
  await closeApp(app)
  console.log(`${readdirSync(outputDir).length} screenshots in ${outputDir}`)
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  // A failed tour can leave the window open, and a locked folder must not hide what went wrong.
  try {
    rmSync(workingData, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 })
  } catch {}
}
process.exit()
