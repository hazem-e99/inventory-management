import type { DurationUnit, License, Payment } from './api'

const dateTime = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { dateStyle: 'medium', timeStyle: 'short' })
const date = new Intl.DateTimeFormat('ar-EG-u-nu-latn', { dateStyle: 'medium' })
const money = new Intl.NumberFormat('ar-EG-u-nu-latn', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const formatDateTime = (value: number): string => dateTime.format(value)
export const formatDate = (value: number | null): string => (value === null ? '-' : date.format(value))
export const formatMoney = (minor: number): string => money.format(minor / 100)

export const UNIT_LABELS: Record<DurationUnit, string> = { day: 'يوم', week: 'أسبوع', month: 'شهر', year: 'سنة' }

export const STATE_LABELS: Record<License['state'], string> = {
  issued: 'لم يُفعَّل',
  active: 'نشط',
  suspended: 'موقوف',
  revoked: 'ملغي',
}

export const PAYMENT_LABELS: Record<Payment['method'], string> = {
  instapay: 'إنستاباي',
  vodafone_cash: 'فودافون كاش',
  cash: 'كاش',
  bank: 'تحويل بنكي',
}

const ACTIONS: Record<string, string> = {
  'customer.created': 'إضافة عميل',
  'customer.updated': 'تعديل عميل',
  'license.issued': 'إصدار سيريال',
  'license.activated': 'أول تفعيل',
  'license.device_bound': 'ربط بالجهاز',
  'license.extended': 'تمديد',
  'license.suspended': 'إيقاف',
  'license.resumed': 'إعادة تشغيل',
  'license.revoked': 'إلغاء نهائي',
  'license.unbound': 'فك الربط بالجهاز',
  'license.reissued': 'إعادة إصدار السيريال',
  'payment.recorded': 'تسجيل دفعة',
}

export const actionLabel = (action: string): string => ACTIONS[action] ?? action

/** A lapsed license is still marked active until someone acts, so the date decides what it reads as. */
export function isLapsed(license: Pick<License, 'state' | 'expiresAt'>): boolean {
  return license.state === 'active' && license.expiresAt !== null && license.expiresAt < Date.now()
}
