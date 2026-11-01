export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code)
  }
}

const MESSAGES: Record<string, string> = {
  VALIDATION_FAILED: 'راجع البيانات المكتوبة.',
  NOT_FOUND: 'لم يعد هذا السجل موجوداً.',
  LICENSE_BOUND: 'الترخيص مربوط بجهاز آخر. فك الربط أولاً.',
  LICENSE_REVOKED: 'هذا الترخيص ملغي نهائياً.',
  LICENSE_NOT_ACTIVATED: 'لم يُفعَّل الترخيص بعد، فمدته تبدأ من أول تفعيل.',
  FORBIDDEN_ORIGIN: 'رُفض الطلب لأنه لم يأت من هذه اللوحة.',
  INVALID_EMAIL_OR_PASSWORD: 'البريد أو كلمة المرور غير صحيحة.',
  INVALID_CODE: 'الرمز غير صحيح أو انتهى وقته.',
  INVALID_TWO_FACTOR_COOKIE: 'انتهت المحاولة. سجل الدخول من جديد.',
}

export const errorMessage = (error: unknown): string =>
  (error instanceof ApiError && MESSAGES[error.code]) || 'حدث خطأ غير متوقع. حاول مرة أخرى.'

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  })

  const text = await response.text()
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : {}
  if (!response.ok) throw new ApiError(String(data.code ?? 'UNKNOWN'), response.status)
  return data as T
}

export interface License {
  id: string
  customerId: string
  serialHint: string
  state: 'issued' | 'active' | 'suspended' | 'revoked'
  durationAmount: number
  durationUnit: DurationUnit
  activatedAt: number | null
  expiresAt: number | null
  fingerprint: string | null
  deviceName: string | null
  appVersion: string | null
  lastSeenAt: number | null
  notes: string | null
  createdAt: number
}

export type DurationUnit = 'day' | 'week' | 'month' | 'year'

export interface LicenseDetail extends License {
  customerName: string
  events: Array<{ id: number; occurredAt: number; actor: string; action: string; details: string | null }>
}

export interface Overview {
  counts: { active: number; expiringIn7: number; expiringIn30: number; expired: number; issued: number; suspended: number }
  expiring: Array<License & { customerName: string }>
}

export interface CustomerRow {
  id: string
  name: string
  phone: string | null
  businessType: string | null
  licenseCount: number
}

export interface Payment {
  id: string
  licenseId: string | null
  amountMinor: number
  paidOn: string
  method: 'instapay' | 'vodafone_cash' | 'cash' | 'bank'
  note: string | null
  recordedBy: string
}

export interface CustomerDetail {
  id: string
  name: string
  phone: string | null
  businessType: string | null
  notes: string | null
  licenses: License[]
  payments: Payment[]
}

export interface EventRow {
  id: number
  occurredAt: number
  actor: string
  action: string
  customerName: string | null
  licenseId: string | null
  details: string | null
}
