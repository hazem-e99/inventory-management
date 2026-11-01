import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { cleanUp, completeOnboarding, expectAccessible, importProduct, launch, scanCode } from './helpers'

const BARCODE = '4006381333931'

/** Printing is replaced with a recorder, so the test needs no printer and can see every job. */
async function recordPrinting(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ ipcMain }) => {
    const jobs: unknown[] = []
    ;(globalThis as unknown as { printJobs: unknown[] }).printJobs = jobs
    ipcMain.removeHandler('print:run')
    ipcMain.handle('print:run', (_event, job) => {
      jobs.push(job)
      return { ok: true }
    })
  })
}

const printJobs = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as unknown as { printJobs: Array<{ widthMm: number | null; heightMm: number | null }> }).printJobs)

async function stockUp(page: Page, quantity: string): Promise<void> {
  await page.getByRole('link', { name: 'حركات المخزون' }).click()
  await page.getByRole('button', { name: 'تسوية جديدة' }).click()
  await page.getByLabel('السبب').selectOption({ label: 'رصيد أول المدة' })
  await page.getByRole('searchbox', { name: /امسح الباركود/ }).fill(BARCODE)
  await page.getByRole('searchbox', { name: /امسح الباركود/ }).press('Enter')
  await page.getByLabel('الكمية').fill(quantity)
  await page.getByLabel('التكلفة').fill('30')
  await page.getByLabel('الدُفعة').fill('SOON')
  await page.getByLabel('الصلاحية').fill('2031-01-01')
  await page.getByRole('button', { name: 'ترحيل المستند' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'ترحيل المستند' }).click()
  await expect(page.getByRole('link', { name: 'ADJ-000001' })).toBeVisible()
}

test('a full sale by keyboard alone, then hold, credit, return, void and closing the shift', async () => {
  test.setTimeout(180_000)
  const userData = mkdtempSync(join(tmpdir(), 'inv-e2e-sale-'))
  const files = mkdtempSync(join(tmpdir(), 'inv-e2e-sale-files-'))

  try {
    const app = await launch(userData)
    const page = await app.firstWindow()
    await completeOnboarding(page)
    await recordPrinting(app)
    await importProduct(app, page, files)
    await stockUp(page, '20')

    // Printing starts off until a shop chooses it, so the first sale can't stop at a dialog.
    await page.getByRole('link', { name: 'الإعدادات' }).click()
    await page.getByLabel('طباعة الإيصال تلقائياً بعد كل بيع').click()
    await expect(page.getByText('تم حفظ إعدادات نقطة البيع')).toBeVisible()

    // The till asks for the opening cash first, and the cursor is already in the field.
    await page.getByRole('link', { name: 'نقطة البيع' }).click()
    await expect(page.getByRole('heading', { name: 'فتح وردية' })).toBeVisible()
    await expectAccessible(page)
    await expect(page.getByLabel('نقدية بداية الوردية')).toBeFocused()
    await page.keyboard.type('500')
    await page.keyboard.press('Enter')

    const scanner = page.getByRole('searchbox', { name: /امسح الباركود/ })
    await expect(scanner).toBeFocused()
    await expect(page.getByRole('heading', { name: 'الفاتورة فارغة' })).toBeVisible()
    await expectAccessible(page)

    // From here on the mouse stays still: scan, change quantity, pay.
    await scanCode(page, BARCODE)
    await expect(page.getByRole('cell', { name: /بنادول اكسترا/ })).toBeVisible()
    await expect(page.getByTestId('pos-total')).toHaveText('45.50')

    await scanCode(page, BARCODE)
    await expect(page.getByTestId('pos-total')).toHaveText('91.00')
    await scanner.press('+')
    await expect(page.getByTestId('pos-total')).toHaveText('136.50')
    await scanner.press('-')
    await scanCode(page, `2*${BARCODE}`)
    await expect(page.getByTestId('pos-total')).toHaveText('182.00')
    await expectAccessible(page)

    await page.keyboard.press('F12')
    const payment = page.getByRole('dialog', { name: 'الدفع' })
    await expect(payment.getByLabel(/نقدي/)).toBeFocused()
    await expect(payment.getByLabel(/نقدي/)).toHaveValue('182')
    await page.keyboard.type('200')
    await expect(payment.getByText('18.00')).toBeVisible()
    await expectAccessible(page)
    await page.keyboard.press('Enter')

    await expect(page.getByText('تم تسجيل INV-000001')).toBeVisible()
    await expect(page.getByTestId('pos-change')).toHaveText('18.00')
    await expect(page.getByTestId('pos-total')).toHaveText('0.00')
    await expect(scanner).toBeFocused()

    // The receipt went to the printer with the sale in it, cut to its own length.
    await expect.poll(async () => (await printJobs(app)).length).toBe(1)
    const job = (await printJobs(app))[0]!
    expect(job.widthMm).toBe(80)
    expect(job.heightMm).toBeGreaterThan(40)
    const receipt = page.getByTestId('print-receipt')
    await expect(receipt).toContainText('صيدلية النور')
    await expect(receipt).toContainText('INV-000001')
    await expect(receipt).toContainText('بنادول اكسترا')
    await expect(receipt).toContainText('182.00')

    // A customer steps aside: the cart waits, and the next one is served meanwhile.
    await scanCode(page, BARCODE)
    await page.keyboard.press('F4')
    await page.keyboard.type('الزبون الأول')
    await page.keyboard.press('Enter')
    await expect(page.getByText('تم تعليق الفاتورة')).toBeVisible()
    await expect(page.getByTestId('pos-total')).toHaveText('0.00')

    await page.keyboard.press('F6')
    await expect(page.getByRole('dialog').getByText('الزبون الأول')).toBeVisible()
    await page.getByRole('button', { name: 'استكمال' }).click()
    await expect(page.getByTestId('pos-total')).toHaveText('45.50')

    // On account: the customer is added from the till, and the balance follows them.
    await page.keyboard.press('F2')
    await page.keyboard.type('منى')
    await page.getByRole('button', { name: 'عميل جديد' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'حفظ' }).click()
    await expect(page.getByRole('button', { name: 'منى' })).toBeVisible()

    await page.keyboard.press('F12')
    await expect(page.getByRole('dialog', { name: 'الدفع' }).getByLabel(/نقدي/)).toBeFocused()
    await page.keyboard.press('F8')
    await expect(page.getByRole('dialog', { name: 'الدفع' }).getByLabel(/آجل/)).toHaveValue('45.5')
    await page.keyboard.press('Enter')
    await expect(page.getByText('تم تسجيل INV-000002')).toBeVisible()

    await page.getByRole('link', { name: 'العملاء' }).click()
    await expect(page.getByRole('cell', { name: 'مستحق على العميل' })).toBeVisible()
    await page.getByRole('link', { name: 'منى' }).click()
    await expect(page.getByRole('heading', { name: 'كشف الحساب' })).toBeVisible()
    await expect(page.getByRole('link', { name: /INV-000002/ })).toBeVisible()
    await expectAccessible(page)

    await page.getByRole('button', { name: 'تحصيل دفعة' }).click()
    await page.getByLabel('المبلغ').fill('20')
    await page.getByRole('dialog').getByRole('button', { name: 'تحصيل دفعة' }).click()
    await expect(page.getByText('تم تسجيل الإيصال RCT-000001')).toBeVisible()
    await expect(page.getByText('25.50').first()).toBeVisible()

    // A return of part of the first sale.
    await page.getByRole('link', { name: 'الفواتير' }).click()
    await page.getByRole('link', { name: 'INV-000001' }).click()
    await expect(page.getByRole('heading', { name: /فاتورة بيع INV-000001/ })).toBeVisible()
    await expectAccessible(page)
    await page.getByRole('button', { name: 'مرتجع' }).click()
    await page.getByLabel(/كمية المرتجع/).fill('10')
    await page.getByRole('button', { name: 'تسجيل المرتجع' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'تسجيل المرتجع' }).click()
    await expect(page.getByText('الكمية أكبر من المتبقي في الفاتورة')).toBeVisible()
    await page.getByLabel(/كمية المرتجع/).fill('1')
    await expect(page.getByText('45.50')).toBeVisible()
    await expectAccessible(page)
    await page.getByRole('button', { name: 'تسجيل المرتجع' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'تسجيل المرتجع' }).click()
    await expect(page.getByText('تم تسجيل المرتجع RET-000001')).toBeVisible()

    // Voiding the sale on account puts the customer back where they were.
    await page.getByRole('link', { name: 'الفواتير' }).click()
    await page.getByRole('link', { name: 'INV-000002' }).click()
    await page.getByRole('button', { name: 'إلغاء الفاتورة' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'إلغاء الفاتورة' }).click()
    await expect(page.getByText('تم إلغاء المستند')).toBeVisible()

    // The drawer: 500 opening + 182 sale + 20 collected - 45.50 returned - 50 taken out.
    await page.getByRole('link', { name: 'الورديات' }).click()
    await page.getByRole('button', { name: 'حركة نقدية' }).click()
    await page.getByLabel('المبلغ').fill('50')
    await page.getByLabel('السبب').fill('مشتريات مكتب')
    await page.getByRole('dialog').getByRole('button', { name: 'حفظ' }).click()
    await expect(page.getByText('تم تسجيل الحركة')).toBeVisible()
    await expectAccessible(page)

    await page.getByRole('button', { name: 'إغلاق الوردية' }).click()
    await page.getByLabel('النقدية الفعلية').fill('600')
    await page.getByRole('dialog').getByRole('button', { name: 'إغلاق الوردية' }).click()
    await expect(page.getByRole('heading', { name: /تقرير الوردية SH-000001/ })).toBeVisible()
    await expect(page.getByText('606.50')).toBeVisible()
    await expect(page.getByText('عجز')).toBeVisible()
    await expect(page.getByText('6.50', { exact: true })).toBeVisible()
    await expectAccessible(page)

    await page.getByRole('button', { name: 'طباعة تقرير الوردية' }).click()
    await expect.poll(async () => (await printJobs(app)).length).toBeGreaterThan(1)

    // The item's own history leads back to the invoice.
    await page.getByRole('link', { name: 'الأصناف', exact: true }).click()
    await page.getByRole('button', { name: /بنادول اكسترا/ }).click()
    await page.getByRole('menuitem', { name: 'الرصيد والحركة' }).click()
    await expect(page.getByRole('heading', { name: 'الرصيد الحالي' })).toBeVisible()
    await page.getByRole('link', { name: /فاتورة بيع INV-000001/ }).click()
    await expect(page.getByRole('heading', { name: /فاتورة بيع INV-000001/ })).toBeVisible()

    await app.close()
  } finally {
    await cleanUp(userData, files)
  }
})
