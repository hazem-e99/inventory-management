import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { cleanUp, completeOnboarding, expectAccessible, importProduct, launch, scan } from './helpers'

async function postDocument(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'ترحيل المستند' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'ترحيل المستند' }).click()
}

test('a pharmacy stock cycle: receive, issue, transfer, count and void', async () => {
  test.setTimeout(120_000)
  const userData = mkdtempSync(join(tmpdir(), 'inv-e2e-stock-'))
  const files = mkdtempSync(join(tmpdir(), 'inv-e2e-stock-files-'))

  try {
    const app = await launch(userData)
    const page = await app.firstWindow()
    await completeOnboarding(page)
    await importProduct(app, page, files)

    // Opening stock: batch rules are enforced by the server, under the field.
    await page.getByRole('link', { name: 'حركات المخزون' }).click()
    await expect(page.getByRole('heading', { name: 'لا توجد مستندات مخزون' })).toBeVisible()
    await expectAccessible(page)
    await page.getByRole('button', { name: 'تسوية جديدة' }).click()
    await expect(page.getByRole('list', { name: 'حالة المستند' })).toBeVisible()

    await page.getByLabel('السبب').selectOption({ label: 'رصيد أول المدة' })
    await scan(page)
    await expect(page.getByRole('cell', { name: 'بنادول اكسترا' })).toBeVisible()

    await page.getByLabel('الكمية').fill('10')
    await page.getByLabel('التكلفة').fill('30')
    await postDocument(page)
    await expect(page.getByText('هذا الصنف يتتبع الدُفعات. اكتب رقم الدُفعة.')).toBeVisible()

    await page.getByLabel('الدُفعة').fill('SOON')
    await postDocument(page)
    await expect(page.getByText('اكتب تاريخ الصلاحية لهذه الدُفعة.')).toBeVisible()

    await page.getByLabel('الصلاحية').fill('2030-01-01')
    await expectAccessible(page)
    await postDocument(page)
    await expect(page.getByText('تم ترحيل المستند')).toBeVisible()
    await expect(page.getByRole('link', { name: 'ADJ-000001' })).toBeVisible()
    // The failed posts above must not have left stray drafts behind.
    await expect(page.getByRole('link', { name: 'مسودة' })).toHaveCount(0)

    // A second batch with a later expiry.
    await page.getByRole('button', { name: 'تسوية جديدة' }).click()
    await page.getByLabel('السبب').selectOption({ label: 'رصيد أول المدة' })
    await scan(page)
    await page.getByLabel('الكمية').fill('5')
    await page.getByLabel('التكلفة').fill('50')
    await page.getByLabel('الدُفعة').fill('LATER')
    await page.getByLabel('الصلاحية').fill('2031-01-01')
    await postDocument(page)
    await expect(page.getByRole('link', { name: 'ADJ-000002' })).toBeVisible()

    // Asking for more than exists is refused with the item and the amounts.
    await page.getByRole('button', { name: 'تسوية جديدة' }).click()
    await page.getByLabel('السبب').selectOption({ label: 'تالف' })
    await scan(page)
    await page.getByLabel('الكمية').fill('999')
    await postDocument(page)
    await expect(page.getByText(/الكمية غير كافية من بنادول اكسترا: المطلوب 999 والمتاح 15/)).toBeVisible()

    // Issuing 12 takes the whole nearer batch first.
    await page.getByLabel('الكمية').fill('12')
    await postDocument(page)
    await expect(page.getByRole('link', { name: 'ADJ-000003' })).toBeVisible()

    await page.getByRole('link', { name: 'الأصناف', exact: true }).click()
    await expect(page.getByRole('row', { name: /بنادول اكسترا/ }).getByRole('cell').nth(4)).toHaveText('3')

    await page.getByRole('button', { name: 'إجراءات بنادول اكسترا' }).click()
    await page.getByRole('menuitem', { name: 'الرصيد والحركة' }).click()
    const balances = page.locator('tbody')
    await expect(balances.getByRole('cell', { name: 'LATER' })).toBeVisible()
    await expect(balances.getByRole('cell', { name: 'SOON' })).toBeHidden()
    await expect(page.getByText('ADJ-000003').first()).toBeVisible()
    await expectAccessible(page)

    // Transfer to a new warehouse.
    await page.getByRole('link', { name: 'بيانات الأصناف' }).click()
    await page.getByRole('tab', { name: 'المخازن' }).click()
    await expect(page.getByRole('cell', { name: /^المخزن الرئيسي/ })).toBeVisible()
    await page.getByRole('tabpanel').getByRole('button', { name: 'إضافة' }).click()
    await page.getByRole('dialog').getByLabel('الاسم').fill('مخزن الفرع')
    await page.getByRole('dialog').getByRole('button', { name: 'حفظ' }).click()
    await expect(page.getByRole('cell', { name: 'مخزن الفرع', exact: true })).toBeVisible()

    await page.getByRole('link', { name: 'حركات المخزون' }).click()
    await page.getByRole('button', { name: 'تحويل جديد' }).click()
    await page.getByLabel('إلى مخزن').selectOption({ label: 'مخزن الفرع' })
    await scan(page)
    await page.getByLabel('الكمية').fill('2')
    await postDocument(page)
    await expect(page.getByRole('link', { name: 'TRF-000001' })).toBeVisible()

    // Count the main warehouse: it should list the batch still there.
    await page.getByRole('button', { name: 'جرد جديد' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'بدء الجرد' }).click()
    await expect(page.getByLabel('الكمية الفعلية')).toHaveValue('1')
    await page.getByLabel('الكمية الفعلية').fill('4')
    await expect(page.getByText('+3')).toBeVisible()
    await expectAccessible(page)
    await postDocument(page)
    await expect(page.getByRole('link', { name: 'CNT-000001' })).toBeVisible()

    // A posted document is read-only, and voiding reverses it while keeping the record.
    await page.getByRole('link', { name: 'CNT-000001' }).click()
    await expect(page.getByLabel('الكمية الفعلية')).toBeDisabled()
    await expect(page.getByRole('button', { name: 'ترحيل المستند' })).toBeHidden()
    await page.getByRole('button', { name: 'إلغاء المستند' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'إلغاء المستند' }).click()
    await expect(page.getByText('تم إلغاء المستند')).toBeVisible()

    await page.getByRole('link', { name: 'الأصناف', exact: true }).click()
    await expect(page.getByRole('row', { name: /بنادول اكسترا/ }).getByRole('cell').nth(4)).toHaveText('3')
  } finally {
    await cleanUp(userData, files)
  }
})
