import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { chooseDestination, chooseFile, cleanUp, completeOnboarding, expectAccessible, launch } from './helpers'

const VALID_EAN = '4006381333931'
const OTHER_EAN = '96385074'

test('managing a pharmacy catalog by hand and from a file', async () => {
  test.setTimeout(120_000)
  const userData = mkdtempSync(join(tmpdir(), 'inv-e2e-catalog-'))
  const files = mkdtempSync(join(tmpdir(), 'inv-e2e-files-'))

  try {
    const app = await launch(userData)
    const page = await app.firstWindow()
    await completeOnboarding(page)

    // Reference data first: a category the product will use.
    await page.getByRole('link', { name: 'بيانات الأصناف' }).click()
    await expect(page.getByRole('tab', { name: 'الوحدات' })).toBeVisible()
    await page.getByRole('button', { name: 'إضافة' }).click()
    await page.getByRole('dialog').getByLabel('الاسم').fill('مسكنات')
    await page.getByRole('dialog').getByRole('button', { name: 'حفظ' }).click()
    await expect(page.getByRole('cell', { name: 'مسكنات', exact: true })).toBeVisible()
    await expectAccessible(page)

    await page.getByRole('tab', { name: 'الوحدات' }).click()
    await expect(page.getByRole('cell', { name: /^كيلوجرام/ })).toBeVisible()

    // An empty list teaches what to do next.
    await page.getByRole('link', { name: 'الأصناف', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'لا توجد أصناف بعد' })).toBeVisible()
    await expectAccessible(page)

    // Add a product, walking through its validation.
    await page.getByRole('button', { name: 'إضافة صنف' }).click()
    await expect(page.getByRole('heading', { name: 'صنف جديد' })).toBeVisible()
    await expect(page.getByLabel('تتبع الدُفعات وتاريخ الصلاحية')).toBeChecked()

    await page.getByRole('button', { name: 'حفظ الصنف' }).click()
    await expect(page.getByText('هذا الحقل مطلوب.')).toBeVisible()

    await page.getByLabel('اسم الصنف').fill('أموكسيسيلين 500')
    await page.getByLabel(/الاسم العلمي/).fill('Amoxicillin')
    await page.getByLabel('التصنيف').selectOption({ label: 'مسكنات' })

    await page.getByRole('button', { name: 'إضافة وحدة أكبر' }).click()
    await page.getByLabel('الوحدة', { exact: true }).last().selectOption({ label: 'علبة' })
    await page.getByLabel(/تحتوي على/).fill('0')
    await page.getByLabel('سعر الشراء').fill('abc')
    await page.getByRole('button', { name: 'حفظ الصنف' }).click()
    await expect(page.getByText('اكتب عدد الوحدات، رقماً أكبر من صفر.')).toBeVisible()
    await expect(page.getByText(/السعر غير صحيح/)).toBeVisible()

    await page.getByLabel(/تحتوي على/).fill('10')
    await page.getByLabel('سعر الشراء').fill('30')
    await page.getByLabel('سعر القطاعي / قطعة').fill('45.50')
    await page.getByLabel('سعر القطاعي / علبة').fill('400')

    // A typo in the barcode is caught by the server, under the field.
    await page.getByRole('button', { name: 'إضافة باركود' }).click()
    await page.getByLabel('الباركود', { exact: true }).fill('4006381333932')
    await page.getByRole('button', { name: 'حفظ الصنف' }).click()
    await expect(page.getByText(/الباركود غير صحيح/)).toBeVisible()
    await page.getByLabel('الباركود', { exact: true }).fill(VALID_EAN)
    await expectAccessible(page)
    await page.getByRole('button', { name: 'حفظ الصنف' }).click()

    await expect(page.getByRole('link', { name: 'أموكسيسيلين 500' })).toBeVisible()
    await expect(page.getByText('45.50')).toBeVisible()
    await expectAccessible(page)

    // Leaving a dirty form asks first.
    await page.getByRole('link', { name: 'أموكسيسيلين 500' }).click()
    await expect(page.getByLabel('اسم الصنف')).toHaveValue('أموكسيسيلين 500')
    await expect(page.getByLabel('سعر القطاعي / علبة')).toHaveValue('400')
    await page.getByLabel('اسم الصنف').fill('أموكسيسيلين 1000')
    await page.getByRole('link', { name: 'الأصناف', exact: true }).click()
    await expect(page.getByText('الخروج دون حفظ؟')).toBeVisible()
    await page.getByRole('button', { name: 'متابعة التعديل' }).click()
    await expect(page.getByLabel('اسم الصنف')).toHaveValue('أموكسيسيلين 1000')
    await page.getByRole('button', { name: 'حفظ الصنف' }).click()
    await expect(page.getByRole('link', { name: 'أموكسيسيلين 1000' })).toBeVisible()

    // A second product with the same barcode is refused on the exact field.
    await page.getByRole('button', { name: 'إضافة صنف' }).click()
    await page.getByLabel('اسم الصنف').fill('صنف مكرر')
    await page.getByRole('button', { name: 'إضافة باركود' }).click()
    await page.getByLabel('الباركود', { exact: true }).fill(VALID_EAN)
    await page.getByRole('button', { name: 'حفظ الصنف' }).click()
    await expect(page.getByText('هذا الباركود مسجل لصنف آخر.')).toBeVisible()
    await page.getByRole('button', { name: 'إلغاء' }).click()
    await page.getByRole('button', { name: 'الخروج دون حفظ' }).click()

    // Import: one good row, one bad, previewed before anything is written.
    const csv = join(files, 'items.csv')
    writeFileSync(
      csv,
      `اسم الصنف,الباركود,سعر البيع,التصنيف\nبنادول اكسترا,${OTHER_EAN},45.5,فيتامينات\nسعر غلط,4006381333931,عشرة,\n`,
    )
    await chooseFile(app, csv)
    await page.getByRole('button', { name: 'استيراد وتصدير' }).click()
    await page.getByRole('menuitem', { name: 'استيراد من ملف' }).click()
    await page.getByRole('button', { name: 'اختيار ملف' }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('الصفوف في الملف: 2')).toBeVisible()
    await expect(dialog.getByText('صفوف سليمة: 1')).toBeVisible()
    await expect(dialog.getByText('صف 3').first()).toBeVisible()
    await expect(dialog.getByText(/هذا الباركود مسجل لصنف آخر/)).toBeVisible()
    await expectAccessible(page)

    const report = join(files, 'errors.xlsx')
    await chooseDestination(app, report)
    await dialog.getByRole('button', { name: 'حفظ تقرير الأخطاء' }).click()
    await expect(page.getByText('تم حفظ التقرير')).toBeVisible()
    expect(existsSync(report)).toBe(true)

    await dialog.getByRole('button', { name: 'استيراد 1 صنف' }).click()
    await expect(page.getByRole('link', { name: 'بنادول اكسترا' })).toBeVisible()

    // Search folds Arabic spelling, and finds by barcode and generic name.
    const search = page.getByRole('searchbox')
    await search.fill('اموكسيسيلين')
    await expect(page.getByRole('link', { name: 'أموكسيسيلين 1000' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'بنادول اكسترا' })).toBeHidden()
    await search.fill(OTHER_EAN)
    await expect(page.getByRole('link', { name: 'بنادول اكسترا' })).toBeVisible()
    await search.fill('amoxi')
    await expect(page.getByRole('link', { name: 'أموكسيسيلين 1000' })).toBeVisible()
    await search.fill('غير موجود')
    await expect(page.getByRole('heading', { name: 'لا توجد نتائج' })).toBeVisible()
    await search.fill('')

    // Export writes a real file.
    const exported = join(files, 'export.xlsx')
    await chooseDestination(app, exported)
    await page.getByRole('button', { name: 'استيراد وتصدير' }).click()
    await page.getByRole('menuitem', { name: 'تصدير الأصناف' }).click()
    await expect(page.getByText('تم حفظ الملف (2 صنف)')).toBeVisible()
    expect(existsSync(exported)).toBe(true)

    // Labels: the print stylesheet shows only the labels, with a real barcode.
    await page.getByRole('button', { name: 'إجراءات أموكسيسيلين 1000' }).click()
    await page.getByRole('menuitem', { name: 'طباعة ملصقات' }).click()
    await page.getByLabel('عدد النسخ').fill('3')
    const sheet = page.getByTestId('print-sheet')
    await expect(sheet.locator('.print-label')).toHaveCount(3)
    await expect(sheet.locator('.print-label svg rect').first()).toBeAttached()
    await page.emulateMedia({ media: 'print' })
    await expect(sheet).toBeVisible()
    await expect(page.locator('#root')).toBeHidden()
    await page.emulateMedia({ media: 'screen' })
    await page.getByRole('dialog').getByRole('button', { name: 'إلغاء' }).click()

    // Archiving moves an item out of the working list without losing it.
    await page.getByRole('button', { name: 'إجراءات بنادول اكسترا' }).click()
    await page.getByRole('menuitem', { name: 'أرشفة' }).click()
    await expect(page.getByRole('link', { name: 'بنادول اكسترا' })).toBeHidden()
    await page.getByLabel('الأصناف المؤرشفة').check()
    await expect(page.getByRole('link', { name: 'بنادول اكسترا' })).toBeVisible()

    // A blocked delete says why, and how many items are involved.
    await page.getByRole('link', { name: 'بيانات الأصناف' }).click()
    await page.getByRole('button', { name: 'تعديل مسكنات' }).click()
    await page.getByRole('menuitem', { name: 'حذف' }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'حذف' }).click()
    await expect(page.getByText(/لا يمكن الحذف لأن 1 صنف مرتبط به/)).toBeVisible()
  } finally {
    await cleanUp(userData, files)
  }
})

test('a clothing store builds sizes and colours as variants', async () => {
  test.setTimeout(90_000)
  const userData = mkdtempSync(join(tmpdir(), 'inv-e2e-clothing-'))

  try {
    const app = await launch(userData)
    const page = await app.firstWindow()
    await completeOnboarding(page, /محل ملابس/)

    await page.getByRole('link', { name: 'الأصناف', exact: true }).click()
    await page.getByRole('button', { name: 'إضافة صنف' }).click()
    await page.getByLabel('اسم الصنف').fill('تيشيرت قطن')

    const values = page.getByRole('textbox', { name: 'قيمة جديدة' })
    for (const [index, entries] of [['S', 'M'], ['أحمر', 'أسود']].entries()) {
      for (const value of entries) {
        await values.nth(index).fill(value)
        await values.nth(index).press('Enter')
        await page.getByRole('button', { name: value, exact: true }).click()
      }
    }

    await page.getByRole('button', { name: 'إنشاء الأنواع' }).click()
    const labels = page.getByLabel('اسم النوع')
    await expect(labels).toHaveCount(4)
    await expect(labels.first()).toHaveValue('S / أحمر')
    await expect(labels.last()).toHaveValue('M / أسود')
    await expectAccessible(page)

    await page.getByRole('button', { name: 'حفظ الصنف' }).click()
    await expect(page.getByRole('link', { name: 'تيشيرت قطن' })).toBeVisible()
    await expect(page.getByText('عدد الأنواع: 4')).toBeVisible()
  } finally {
    await cleanUp(userData)
  }
})
