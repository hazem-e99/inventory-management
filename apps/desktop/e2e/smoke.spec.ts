import { closeSync, existsSync, mkdtempSync, openSync, readdirSync, readSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { chooseFile, cleanUp, completeOnboarding, expectAccessible, launch, OWNER_PASSWORD } from './helpers'

async function signIn(page: Page, password = OWNER_PASSWORD): Promise<void> {
  await page.getByLabel('اسم المستخدم').fill('owner')
  await page.getByRole('textbox', { name: 'كلمة المرور' }).fill(password)
  await page.getByRole('button', { name: 'دخول' }).click()
}

test('first run, sign-in, language, users, backup and restore', async () => {
  test.setTimeout(120_000)
  const userData = mkdtempSync(join(tmpdir(), 'inv-e2e-'))
  const restoreData = mkdtempSync(join(tmpdir(), 'inv-e2e-restore-'))

  try {
    const first = await launch(userData)
    const page = await first.firstWindow()

    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    const recoveryCode = await completeOnboarding(page)
    expect(recoveryCode).toMatch(/^([0-9A-Z]{4}-){5}[0-9A-Z]{4}$/)

    // Validation and a server-side conflict, both shown under the field in Arabic.
    await page.getByRole('link', { name: 'المستخدمون' }).click()
    await page.getByRole('button', { name: 'إضافة مستخدم' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('الاسم').fill('م')
    await dialog.getByLabel('اسم المستخدم').fill('owner')
    await dialog.getByLabel('كلمة مرور مؤقتة').fill('temp-password')
    await dialog.getByRole('button', { name: 'إضافة' }).click()
    await expect(dialog.getByText('اكتب حرفين على الأقل.')).toBeVisible()
    await dialog.getByLabel('الاسم').fill('سارة محمد')
    await dialog.getByRole('button', { name: 'إضافة' }).click()
    await expect(dialog.getByText('اسم المستخدم هذا مستخدم بالفعل. اختر اسماً آخر.')).toBeVisible()
    await dialog.getByLabel('اسم المستخدم').fill('sara')
    await dialog.getByRole('button', { name: 'إضافة' }).click()
    await expect(page.getByRole('cell', { name: 'سارة محمد', exact: true })).toBeVisible()
    await expectAccessible(page)

    // Language switches live, with direction, and the choice is saved.
    await page.getByRole('link', { name: 'الإعدادات' }).click()
    await page.getByRole('radio', { name: 'English' }).click()
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await expectAccessible(page)

    await page.getByRole('link', { name: 'Backups' }).click()
    await expect(page.getByRole('button', { name: 'Back up now' })).toBeVisible()
    await page.getByRole('button', { name: 'Back up now' }).click()
    await expect(page.getByText('Backup created')).toBeVisible()

    await page.getByRole('link', { name: 'Audit log' }).click()
    await expect(page.getByText('User added')).toBeVisible()

    await page.getByRole('button', { name: 'Account menu' }).click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
    await expectAccessible(page)
    await first.close()

    const backupsDir = join(userData, 'backups')
    const backup = readdirSync(backupsDir).find((name) => !name.startsWith('auto-'))
    expect(backup).toBeTruthy()

    const databasePath = join(userData, 'inventory.db')
    expect(existsSync(databasePath)).toBe(true)
    const header = Buffer.alloc(16)
    const fd = openSync(databasePath, 'r')
    readSync(fd, header, 0, 16, 0)
    closeSync(fd)
    expect(header.toString('latin1')).not.toBe('SQLite format 3\0')

    // A wrong password is refused with the clear message, and the store persisted.
    const second = await launch(userData)
    const secondPage = await second.firstWindow()
    await expect(secondPage.locator('html')).toHaveAttribute('dir', 'ltr')
    await secondPage.getByRole('button', { name: 'العربية' }).click()
    await signIn(secondPage, 'wrong-password')
    await expect(secondPage.getByText('اسم المستخدم أو كلمة المرور غير صحيحة')).toBeVisible()
    await second.close()

    // A brand new machine: only the backup file and the recovery code.
    const third = await launch(restoreData)
    await chooseFile(third, join(backupsDir, backup!))
    const thirdPage = await third.firstWindow()
    await thirdPage.getByRole('button', { name: /نسخة احتياطية/ }).click()
    await thirdPage.getByRole('button', { name: 'اختيار ملف النسخة' }).click()
    await thirdPage.getByLabel('كود الاسترجاع').fill('0000-0000-0000-0000-0000-0000')
    await thirdPage.getByRole('button', { name: 'استرجاع البيانات' }).click()
    await expect(thirdPage.getByText(/الكود غير صحيح/)).toBeVisible()

    await thirdPage.getByLabel('كود الاسترجاع').fill(recoveryCode)
    await thirdPage.getByRole('button', { name: 'استرجاع البيانات' }).click()

    await expect(thirdPage.getByRole('heading', { name: 'Sign in' })).toBeVisible({ timeout: 20_000 })
    await expect(thirdPage.getByText('صيدلية النور')).toBeVisible()
    await thirdPage.getByLabel('Username').fill('owner')
    await thirdPage.getByRole('textbox', { name: 'Password' }).fill(OWNER_PASSWORD)
    await thirdPage.getByRole('button', { name: 'Sign in' }).last().click()
    await expect(thirdPage.getByRole('heading', { name: /حازم عصام/ })).toBeVisible()
    await third.close()
  } finally {
    await cleanUp(userData, restoreData)
  }
})

test('the window closes from a screen that guards unsaved edits', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'inv-e2e-close-'))

  try {
    const app = await launch(userData)
    const page = await app.firstWindow()
    await completeOnboarding(page)
    await page.getByRole('link', { name: 'الإعدادات' }).click()
    await expect(page.getByRole('heading', { name: 'الإعدادات' })).toBeVisible()

    await Promise.race([
      app.close(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('The window refused to close')), 10_000)),
    ])
  } finally {
    await cleanUp(userData)
  }
})
