import { existsSync, mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { cleanUp, completeOnboarding, expectAccessible, importProduct, launch, scanCode } from './helpers'

const BARCODE = '4006381333931'

async function chooseDestinations(app: ElectronApplication, directory: string): Promise<void> {
  await app.evaluate(({ dialog }, folder) => {
    dialog.showSaveDialog = (async (_window: unknown, options: { defaultPath?: string }) => ({
      canceled: false,
      filePath: `${folder}\\${options.defaultPath}`,
    })) as never
  }, directory)
}

async function stockUp(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'حركات المخزون' }).click()
  await page.getByRole('button', { name: 'تسوية جديدة' }).click()
  await page.getByLabel('السبب').selectOption({ label: 'رصيد أول المدة' })
  await page.getByRole('searchbox', { name: /امسح الباركود/ }).fill(BARCODE)
  await page.getByRole('searchbox', { name: /امسح الباركود/ }).press('Enter')
  await page.getByLabel('الكمية').fill('8')
  await page.getByLabel('التكلفة').fill('30')
  await page.getByLabel('الدُفعة').fill('SOON')
  await page.getByLabel('الصلاحية').fill(new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10))
  await page.getByRole('button', { name: 'ترحيل المستند' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'ترحيل المستند' }).click()
  await expect(page.getByRole('link', { name: 'ADJ-000001' })).toBeVisible()
}

async function sellOne(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'نقطة البيع' }).click()
  await page.getByLabel('نقدية بداية الوردية').fill('100')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: 'الفاتورة فارغة' })).toBeVisible()
  await scanCode(page, `3*${BARCODE}`)
  await page.keyboard.press('F12')
  await expect(page.getByRole('dialog', { name: 'الدفع' }).getByLabel(/نقدي/)).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByText('تم تسجيل INV-000001')).toBeVisible()
}

test('reports follow the shop: dashboard, profit, alerts, reorder and export', async () => {
  test.setTimeout(150_000)
  const userData = mkdtempSync(join(tmpdir(), 'inv-e2e-report-'))
  const files = mkdtempSync(join(tmpdir(), 'inv-e2e-report-files-'))

  try {
    const app = await launch(userData)
    const page = await app.firstWindow()
    await completeOnboarding(page)
    await chooseDestinations(app, files)
    await importProduct(app, page, files)

    // With no sales yet the dashboard says so plainly, and the report says why it is empty.
    await page.getByRole('link', { name: 'التقارير', exact: true }).click()
    await expectAccessible(page)
    await page.getByRole('link', { name: /المبيعات اليومية/ }).click()
    await expect(page.getByRole('heading', { name: 'لا توجد بيانات في هذه الفترة' })).toBeVisible()
    await expectAccessible(page)

    // A reorder level is set on the item, as a shop would.
    await page.getByRole('link', { name: 'الأصناف', exact: true }).click()
    await page.getByRole('link', { name: 'بنادول اكسترا' }).click()
    await page.getByLabel('حد إعادة الطلب').fill('6')
    await page.getByRole('button', { name: 'حفظ الصنف' }).click()
    await expect(page.getByRole('link', { name: 'بنادول اكسترا' })).toBeVisible()

    await stockUp(page)
    await sellOne(page)

    // 3 × 45.50 sold at a cost of 30 each.
    await page.getByRole('link', { name: 'الرئيسية' }).click()
    await expect(page.getByTestId('dashboard-net')).toHaveText('136.50')
    await expect(page.getByText('46.50').first()).toBeVisible()
    await expect(page.getByRole('link', { name: /أصناف عند حد الطلب/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /دفعات قاربت الانتهاء/ })).toBeVisible()
    await expectAccessible(page)

    await page.getByRole('link', { name: 'التقارير', exact: true }).click()
    await page.getByRole('link', { name: /المبيعات اليومية/ }).click()
    const totals = page.getByTestId('report-totals')
    await expect(totals).toContainText('136.50')
    await expect(totals).toContainText('90.00')
    await expect(totals).toContainText('46.50')
    await expectAccessible(page)

    await page.getByRole('button', { name: 'Excel' }).click()
    await expect(page.getByText('تم حفظ 1 صف')).toBeVisible()
    expect(statSync(join(files, `sales-${new Date().toISOString().slice(0, 10)}.xlsx`)).size).toBeGreaterThan(1000)

    await page.getByRole('button', { name: 'PDF' }).click()
    await expect(page.getByText('تم حفظ ملف PDF')).toBeVisible()
    const pdf = join(files, `sales-${new Date().toISOString().slice(0, 10)}.pdf`)
    expect(existsSync(pdf)).toBe(true)
    expect(statSync(pdf).size).toBeGreaterThan(5000)

    await page.getByRole('link', { name: 'التقارير', exact: true }).click()
    await page.getByRole('link', { name: /قيمة المخزون/ }).click()
    await expect(page.getByRole('link', { name: 'بنادول اكسترا' })).toBeVisible()
    await expect(page.getByTestId('report-totals')).toContainText('150.00')

    await page.getByRole('link', { name: 'التقارير', exact: true }).click()
    await page.getByRole('link', { name: /قرب انتهاء الصلاحية/ }).click()
    await expect(page.getByText('SOON')).toBeVisible()

    // The reorder list hands its suggestion straight to a new purchase order.
    await page.getByRole('link', { name: 'التقارير', exact: true }).click()
    await page.getByRole('link', { name: /نواقص وطلبات شراء/ }).click()
    await expect(page.getByRole('link', { name: 'بنادول اكسترا' })).toBeVisible()
    await expectAccessible(page)
    await page.getByRole('button', { name: 'أمر شراء بالمقترح' }).click()
    await expect(page.getByRole('list', { name: 'حالة أمر الشراء' })).toBeVisible()
    await expect(page.getByRole('cell', { name: /بنادول اكسترا/ })).toBeVisible()
    await expect(page.getByLabel('الكمية')).toHaveValue('7')

    await app.close()
  } finally {
    await cleanUp(userData, files)
  }
})
