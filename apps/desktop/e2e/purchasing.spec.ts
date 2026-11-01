import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { cleanUp, completeOnboarding, expectAccessible, importProduct, launch, scan } from './helpers'

const SUPPLIER = 'النور للأدوية'

async function chooseSupplier(page: Page): Promise<void> {
  await page.getByLabel('المورد', { exact: true }).fill('النور')
  await page.getByRole('button', { name: new RegExp(SUPPLIER) }).click()
}

async function confirmPost(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'ترحيل المستند' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'ترحيل المستند' }).click()
}

async function openSupplier(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'الموردون' }).click()
  await page.getByRole('link', { name: SUPPLIER }).click()
  await expect(page.getByRole('heading', { name: 'كشف الحساب' })).toBeVisible()
}

test('a pharmacy buying cycle: order, partial receipts, payment, return and void', async () => {
  test.setTimeout(180_000)
  const userData = mkdtempSync(join(tmpdir(), 'inv-e2e-buy-'))
  const files = mkdtempSync(join(tmpdir(), 'inv-e2e-buy-files-'))

  try {
    const app = await launch(userData)
    const page = await app.firstWindow()
    await completeOnboarding(page)
    await importProduct(app, page, files)

    // A supplier comes with what was already owed to them.
    await page.getByRole('link', { name: 'الموردون' }).click()
    await expect(page.getByRole('heading', { name: 'لا يوجد موردون بعد' })).toBeVisible()
    await expectAccessible(page)
    await page.getByRole('button', { name: 'إضافة مورد' }).click()
    await page.getByLabel('اسم المورد').fill(SUPPLIER)
    await page.getByLabel(/الرقم الضريبي/).fill('12')
    await page.getByLabel(/الرصيد الافتتاحي/).fill('100')
    await page.getByRole('dialog').getByRole('button', { name: 'حفظ' }).click()
    await expect(page.getByText('الرقم الضريبي يتكون من 9 أرقام.')).toBeVisible()
    await page.getByLabel(/الرقم الضريبي/).fill('')
    await page.getByRole('dialog').getByRole('button', { name: 'حفظ' }).click()
    await expect(page.getByRole('link', { name: SUPPLIER })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'مستحق للمورد' })).toBeVisible()

    // Ordering changes nothing yet, and the order can't be edited once it is open.
    await page.getByRole('link', { name: 'أوامر الشراء' }).click()
    await expect(page.getByRole('heading', { name: 'لا توجد أوامر شراء' })).toBeVisible()
    await page.getByRole('button', { name: 'أمر شراء جديد' }).click()
    await expect(page.getByRole('list', { name: 'حالة أمر الشراء' })).toBeVisible()
    await scan(page)
    await page.getByLabel('الكمية').fill('10')
    await page.getByLabel('سعر الوحدة').fill('30')
    await page.getByRole('button', { name: 'فتح الأمر' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'فتح الأمر' }).click()
    await expect(page.getByLabel('المورد').locator('xpath=ancestor::div[1]/following-sibling::*')).toHaveText('هذا الحقل مطلوب.')
    await chooseSupplier(page)
    await expectAccessible(page)
    await page.getByRole('button', { name: 'فتح الأمر' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'فتح الأمر' }).click()
    await page.getByRole('link', { name: 'PO-000001' }).click()
    await expect(page.getByLabel('الكمية')).toBeDisabled()

    // First delivery: part of the order, taxed, and partly paid on the spot.
    await page.getByRole('button', { name: 'استلام' }).click()
    await expect(page.getByRole('heading', { name: 'استلام على PO-000001' })).toBeVisible()
    await expect(page.getByLabel('الكمية')).toHaveValue('10')
    await page.getByLabel('الكمية').fill('6')
    await page.getByLabel('الضريبة %').fill('14')
    await page.getByLabel('الدُفعة').fill('SOON')
    await page.getByLabel('الصلاحية').fill('2030-01-01')
    await page.getByLabel(/المدفوع الآن/).fill('100')
    const summary = page.getByRole('region', { name: 'ملخص الفاتورة' })
    await expect(summary.getByText('205.20')).toBeVisible()
    await expect(summary.getByText('105.20')).toBeVisible()
    await expectAccessible(page)
    await confirmPost(page)
    await expect(page.getByRole('link', { name: 'PUR-000001' })).toBeVisible()

    await page.getByRole('link', { name: 'أوامر الشراء' }).click()
    await expect(page.getByRole('cell', { name: 'استلام جزئي' })).toBeVisible()

    // Second delivery: the server refuses more than is left, and the retry reuses the draft.
    await page.getByRole('link', { name: 'PO-000001' }).click()
    await page.getByRole('button', { name: 'استلام' }).click()
    await expect(page.getByLabel('الكمية')).toHaveValue('4')
    await page.getByLabel('الكمية').fill('5')
    await page.getByLabel('الدُفعة').fill('LATER')
    await page.getByLabel('الصلاحية').fill('2031-01-01')
    await confirmPost(page)
    await expect(page.getByText('الكمية أكبر من المتبقي في أمر الشراء')).toBeVisible()
    await page.getByLabel('الكمية').fill('4')
    await confirmPost(page)
    await expect(page.getByRole('link', { name: 'PUR-000002' })).toBeVisible()
    await expect(page.getByRole('cell', { name: 'مسودة' })).toHaveCount(0)
    await expectAccessible(page)

    await page.getByRole('link', { name: 'أوامر الشراء' }).click()
    await expect(page.getByRole('cell', { name: 'مكتمل' })).toBeVisible()

    // 100 opening + 205.20 + 120 - 100 paid.
    await openSupplier(page)
    await expect(page.getByText('325.20').first()).toBeVisible()
    await expectAccessible(page)

    // A return leaves stock and comes off the balance, and asks for no receiving details.
    await page.getByRole('link', { name: 'المشتريات' }).click()
    await page.getByRole('button', { name: 'مرتجع جديد' }).click()
    await chooseSupplier(page)
    await scan(page)
    await page.getByLabel('الكمية').fill('2')
    await page.getByLabel('سعر الوحدة').fill('30')
    await confirmPost(page)
    await expect(page.getByRole('link', { name: 'PRT-000001' })).toBeVisible()

    await openSupplier(page)
    await expect(page.getByText('265.20').first()).toBeVisible()

    // A payment lowers the balance, and voiding it puts it back while it stays on record.
    await page.getByRole('button', { name: 'تسجيل دفعة' }).click()
    await page.getByLabel('المبلغ').fill('0')
    await page.getByRole('dialog').getByRole('button', { name: 'تسجيل دفعة' }).click()
    await expect(page.getByText('السعر غير صحيح', { exact: false })).toBeVisible()
    await page.getByLabel('المبلغ').fill('65.20')
    await expectAccessible(page)
    await page.getByRole('dialog').getByRole('button', { name: 'تسجيل دفعة' }).click()
    await expect(page.getByText('200.00').first()).toBeVisible()
    await page.getByRole('button', { name: 'إلغاء الدفعة' }).first().click()
    await page.getByRole('dialog').getByRole('button', { name: 'إلغاء الدفعة' }).click()
    await expect(page.getByText('تم إلغاء الدفعة')).toBeVisible()
    await expect(page.getByText('265.20').first()).toBeVisible()

    // Voiding the second invoice reverses stock and the debt, and the order reopens.
    await page.getByRole('link', { name: 'المشتريات' }).click()
    await page.getByRole('link', { name: 'PUR-000002' }).click()
    await expect(page.getByLabel('الكمية')).toBeDisabled()
    await expectAccessible(page)
    await page.getByRole('button', { name: 'إلغاء المستند' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'إلغاء المستند' }).click()
    await expect(page.getByText('تم إلغاء المستند')).toBeVisible()

    await page.getByRole('link', { name: 'أوامر الشراء' }).click()
    await expect(page.getByRole('cell', { name: 'استلام جزئي' })).toBeVisible()

    await openSupplier(page)
    await expect(page.getByText('145.20').first()).toBeVisible()

    // The item's own page shows what is left and where each movement came from.
    await page.getByRole('link', { name: 'الأصناف', exact: true }).click()
    await page.getByRole('button', { name: /بنادول اكسترا/ }).click()
    await page.getByRole('menuitem', { name: 'الرصيد والحركة' }).click()
    await expect(page.getByRole('heading', { name: 'الرصيد الحالي' })).toBeVisible()
    await page.getByRole('link', { name: /مرتجع شراء PRT-000001/ }).click()
    await expect(page.getByRole('heading', { name: /مرتجع شراء PRT-000001/ })).toBeVisible()

    await app.close()
  } finally {
    await cleanUp(userData, files)
  }
})
