import { Badge, Button, Dialog, Field, FormSkeleton, Input, Select, Sign, Table, TableSkeleton, Td, Th, Tr } from '@inv/ui'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { Copy, Plus } from 'lucide-react'
import { useEffect, useId, useState, type ComponentProps, type ReactNode } from 'react'
import { toast } from 'sonner'
import {
  api,
  errorMessage,
  type AiUsage,
  type CustomerDetail,
  type CustomerRow,
  type DurationUnit,
  type EventRow,
  type License,
  type LicenseDetail,
  type Overview,
  type Payment,
} from './api'
import { PAYMENT_LABELS, STATE_LABELS, UNIT_LABELS, actionLabel, formatDate, formatDateTime, formatMoney, isLapsed } from './text'

const UNITS = Object.keys(UNIT_LABELS) as DurationUnit[]
const METHODS = Object.keys(PAYMENT_LABELS) as Array<Payment['method']>

const STATE_TONE: Record<License['state'], ComponentProps<typeof Badge>['tone']> = {
  issued: 'neutral',
  active: 'ok',
  suspended: 'warn',
  revoked: 'danger',
}

function StateBadge({ license }: { license: Pick<License, 'state' | 'expiresAt'> }) {
  if (isLapsed(license)) return <Badge tone="danger">منتهي</Badge>
  return <Badge tone={STATE_TONE[license.state]}>{STATE_LABELS[license.state]}</Badge>
}

const dollars = (micros: number) => `$${(micros / 1_000_000).toFixed(4)}`

function AiPanel({ license, onChange }: { license: LicenseDetail; onChange: () => void }) {
  const fail = useFail()
  const limitId = useId()
  const [limit, setLimit] = useState(String(license.aiMonthlyLimit))

  const save = useMutation({
    mutationFn: (enabled: boolean) => api('PUT', `/admin/licenses/${license.id}/ai`, { enabled, monthlyLimit: Number(limit) }),
    onSuccess: () => {
      toast.success('تم الحفظ. يصل التغيير للجهاز عند اتصاله القادم.')
      onChange()
    },
    onError: fail,
  })
  const rotate = useMutation({
    mutationFn: () => api('POST', `/admin/licenses/${license.id}/ai/rotate`),
    onSuccess: () => toast.success('تم تغيير المفتاح. القديم توقف الآن.'),
    onError: fail,
  })

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold text-ink">الذكاء الاصطناعي</h2>
      <p className="text-ink-soft">
        {license.aiEnabled ? `مفعل. الاستخدام هذا الشهر ${license.aiUsed} من ${license.aiMonthlyLimit}.` : 'غير مفعل لهذا الترخيص.'}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Field id={limitId} label="الحد الشهري">
          <Input id={limitId} dir="ltr" inputMode="numeric" className="w-32" value={limit} onChange={(event) => setLimit(event.target.value.replace(/\D/g, ''))} />
        </Field>
        <Button loading={save.isPending} onClick={() => save.mutate(true)}>
          {license.aiEnabled ? 'حفظ الحد' : 'تفعيل'}
        </Button>
        {license.aiEnabled && (
          <>
            <Button variant="secondary" onClick={() => save.mutate(false)}>
              إيقاف
            </Button>
            <Button variant="secondary" loading={rotate.isPending} onClick={() => rotate.mutate()}>
              تغيير المفتاح
            </Button>
          </>
        )}
      </div>
    </section>
  )
}

export function AiUsagePage() {
  const usage = useQuery({ queryKey: ['ai-usage'], queryFn: () => api<AiUsage>('GET', '/admin/ai/usage') })

  if (!usage.data) return <TableSkeleton />
  const { enabled, spentTodayMicros, dailyBudgetMicros, items } = usage.data
  const month = items.reduce((sum, row) => sum + row.costMicros, 0)

  return (
    <div className="flex flex-col gap-6">
      <Sign title="استهلاك الذكاء الاصطناعي" secondary="AI usage" />
      {!enabled && <p className="text-ink-soft">الخدمة متوقفة من إعدادات السيرفر.</p>}
      <dl className="grid max-w-xl grid-cols-2 gap-4">
        <Fact label="اليوم" value={`${dollars(spentTodayMicros)} من ${dollars(dailyBudgetMicros)}`} />
        <Fact label="هذا الشهر" value={dollars(month)} />
      </dl>
      <Table>
        <thead>
          <tr>
            <Th>العميل</Th>
            <Th>الطلبات</Th>
            <Th>الفاشلة</Th>
            <Th>الحد</Th>
            <Th>التكلفة</Th>
          </tr>
        </thead>
        <tbody>
          {items.map((row) => (
            <Tr key={row.licenseId}>
              <Td>
                <Link to="/licenses/$id" params={{ id: row.licenseId }} className="font-medium text-route">
                  {row.customerName}
                </Link>
              </Td>
              <Td>{row.requests}</Td>
              <Td>{row.failures}</Td>
              <Td>{row.monthlyLimit}</Td>
              <Td>
                <bdi dir="ltr">{dollars(row.costMicros)}</bdi>
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>
  )
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-ink-soft">{label}</dt>
      <dd className="text-2xl font-semibold text-ink">{value}</dd>
    </div>
  )
}

function useFail() {
  return (error: unknown) => {
    toast.error(errorMessage(error))
  }
}

export function OverviewPage() {
  const overview = useQuery({ queryKey: ['overview'], queryFn: () => api<Overview>('GET', '/admin/overview') })

  return (
    <>
      <Sign title="الرئيسية" secondary="Overview" />
      {!overview.data ? (
        <TableSkeleton columns={4} rows={4} />
      ) : (
        <>
          <dl className="grid grid-cols-5 gap-4 rounded-lg border border-rule bg-surface p-5">
            <Fact label="نشط" value={overview.data.counts.active} />
            <Fact label="ينتهي خلال 7 أيام" value={overview.data.counts.expiringIn7} />
            <Fact label="ينتهي خلال 30 يوماً" value={overview.data.counts.expiringIn30} />
            <Fact label="منتهي" value={overview.data.counts.expired} />
            <Fact label="موقوف" value={overview.data.counts.suspended} />
          </dl>
          <section className="flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-ink">انتهت أو تنتهي قريباً</h2>
            {overview.data.expiring.length === 0 ? (
              <p className="text-ink-soft">لا يوجد ترخيص يحتاج تجديداً.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>العميل</Th>
                    <Th>الحالة</Th>
                    <Th>ينتهي في</Th>
                    <Th>آخر اتصال</Th>
                  </tr>
                </thead>
                <tbody>
                  {overview.data.expiring.map((license) => (
                    <Tr key={license.id}>
                      <Td>
                        <Link to="/licenses/$id" params={{ id: license.id }} className="font-medium text-ink hover:text-route">
                          {license.customerName}
                        </Link>
                      </Td>
                      <Td>
                        <StateBadge license={license} />
                      </Td>
                      <Td>{formatDate(license.expiresAt)}</Td>
                      <Td>{formatDate(license.lastSeenAt)}</Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </section>
        </>
      )}
    </>
  )
}

export function CustomersPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const fail = useFail()
  const nameId = useId()
  const phoneId = useId()
  const typeId = useId()
  const [search, setSearch] = useState('')
  const [adding, setAdding] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', businessType: '' })

  const customers = useQuery({
    queryKey: ['customers', search],
    queryFn: () => api<{ items: CustomerRow[] }>('GET', `/admin/customers?search=${encodeURIComponent(search)}`),
  })

  const add = useMutation({
    mutationFn: () => api<{ id: string }>('POST', '/admin/customers', form),
    onSuccess: async ({ id }) => {
      await queryClient.invalidateQueries({ queryKey: ['customers'] })
      await navigate({ to: '/customers/$id', params: { id } })
    },
    onError: fail,
  })

  return (
    <>
      <Sign
        title="العملاء"
        secondary="Customers"
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden className="size-4" />
            إضافة عميل
          </Button>
        }
      />
      <Input type="search" aria-label="ابحث بالاسم أو التليفون" placeholder="ابحث بالاسم أو التليفون" value={search} onChange={(event) => setSearch(event.target.value)} />
      {!customers.data ? (
        <TableSkeleton columns={4} rows={5} />
      ) : customers.data.items.length === 0 ? (
        <p className="text-ink-soft">لا يوجد عملاء بعد.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>الاسم</Th>
              <Th>التليفون</Th>
              <Th>النشاط</Th>
              <Th>التراخيص</Th>
            </tr>
          </thead>
          <tbody>
            {customers.data.items.map((customer) => (
              <Tr key={customer.id}>
                <Td>
                  <Link to="/customers/$id" params={{ id: customer.id }} className="font-medium text-ink hover:text-route">
                    {customer.name}
                  </Link>
                </Td>
                <Td>
                  <bdi dir="ltr">{customer.phone}</bdi>
                </Td>
                <Td>{customer.businessType}</Td>
                <Td>{customer.licenseCount}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}

      <Dialog open={adding} onOpenChange={setAdding} title="عميل جديد" closeLabel="إغلاق">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            add.mutate()
          }}
        >
          <Field id={nameId} label="الاسم">
            <Input id={nameId} autoFocus value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </Field>
          <Field id={phoneId} label="التليفون">
            <Input id={phoneId} dir="ltr" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
          </Field>
          <Field id={typeId} label="النشاط">
            <Input id={typeId} value={form.businessType} onChange={(event) => setForm({ ...form, businessType: event.target.value })} />
          </Field>
          <Button type="submit" loading={add.isPending}>
            حفظ
          </Button>
        </form>
      </Dialog>
    </>
  )
}

function SerialDialog({ serial, onClose }: { serial: string; onClose: () => void }) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title="السيريال"
      description="انسخه الآن. لن يظهر مرة أخرى، ولو ضاع تصدر سيريالاً بديلاً."
      closeLabel="إغلاق"
    >
      <p data-testid="serial" dir="ltr" className="tabular rounded-md bg-sunken p-3 text-center text-lg font-semibold text-ink">
        {serial}
      </p>
      <Button
        onClick={() => {
          void navigator.clipboard.writeText(serial).then(() => toast.success('تم النسخ'))
        }}
      >
        <Copy aria-hidden className="size-4" />
        نسخ
      </Button>
    </Dialog>
  )
}

function DurationFields({ amount, unit, onAmount, onUnit }: { amount: string; unit: DurationUnit; onAmount: (value: string) => void; onUnit: (value: DurationUnit) => void }) {
  const amountId = useId()
  const unitId = useId()
  return (
    <div className="grid grid-cols-2 gap-4">
      <Field id={amountId} label="المدة">
        <Input id={amountId} dir="ltr" inputMode="numeric" autoFocus value={amount} onChange={(event) => onAmount(event.target.value)} />
      </Field>
      <Field id={unitId} label="الوحدة">
        <Select id={unitId} value={unit} onChange={(event) => onUnit(event.target.value as DurationUnit)}>
          {UNITS.map((value) => (
            <option key={value} value={value}>
              {UNIT_LABELS[value]}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  )
}

export function CustomerPage() {
  const { id } = useParams({ strict: false })
  const queryClient = useQueryClient()
  const fail = useFail()
  const amountId = useId()
  const dateId = useId()
  const methodId = useId()
  const noteId = useId()
  const [issuing, setIssuing] = useState(false)
  const [paying, setPaying] = useState(false)
  const [duration, setDuration] = useState<{ amount: string; unit: DurationUnit }>({ amount: '1', unit: 'year' })
  const [payment, setPayment] = useState({ amount: '', paidOn: new Date().toISOString().slice(0, 10), method: 'instapay' as Payment['method'], note: '' })
  const [serial, setSerial] = useState<string | null>(null)

  const customer = useQuery({ queryKey: ['customer', id], queryFn: () => api<CustomerDetail>('GET', `/admin/customers/${id}`) })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['customer', id] })

  const issue = useMutation({
    mutationFn: () => api<{ id: string; serial: string }>('POST', `/admin/customers/${id}/licenses`, { amount: Number(duration.amount), unit: duration.unit }),
    onSuccess: async (result) => {
      setIssuing(false)
      setSerial(result.serial)
      await refresh()
    },
    onError: fail,
  })

  const pay = useMutation({
    mutationFn: () =>
      api('POST', '/admin/payments', {
        customerId: id,
        amountMinor: Math.round(Number(payment.amount) * 100),
        paidOn: payment.paidOn,
        method: payment.method,
        note: payment.note,
      }),
    onSuccess: async () => {
      setPaying(false)
      toast.success('تم تسجيل الدفعة')
      await refresh()
    },
    onError: fail,
  })

  if (!customer.data) return <FormSkeleton fields={3} />
  const { data } = customer

  return (
    <>
      <Sign
        title={data.name}
        secondary="العملاء"
        actions={
          <>
            <Button variant="secondary" onClick={() => setPaying(true)}>
              تسجيل دفعة
            </Button>
            <Button onClick={() => setIssuing(true)}>
              <Plus aria-hidden className="size-4" />
              إصدار سيريال
            </Button>
          </>
        }
      />
      {data.phone && (
        <p className="text-ink-soft">
          <bdi dir="ltr">{data.phone}</bdi>
        </p>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-ink">التراخيص</h2>
        {data.licenses.length === 0 ? (
          <p className="text-ink-soft">لا توجد تراخيص لهذا العميل.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>السيريال</Th>
                <Th>الحالة</Th>
                <Th>المدة</Th>
                <Th>ينتهي في</Th>
                <Th>الجهاز</Th>
              </tr>
            </thead>
            <tbody>
              {data.licenses.map((license) => (
                <Tr key={license.id}>
                  <Td>
                    <Link to="/licenses/$id" params={{ id: license.id }} className="font-medium text-ink hover:text-route">
                      <bdi dir="ltr">…{license.serialHint}</bdi>
                    </Link>
                  </Td>
                  <Td>
                    <StateBadge license={license} />
                  </Td>
                  <Td>
                    {license.durationAmount} {UNIT_LABELS[license.durationUnit]}
                  </Td>
                  <Td>{formatDate(license.expiresAt)}</Td>
                  <Td>{license.deviceName ?? '-'}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-ink">المدفوعات</h2>
        {data.payments.length === 0 ? (
          <p className="text-ink-soft">لم تسجل أي دفعة.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>التاريخ</Th>
                <Th>الطريقة</Th>
                <Th>ملاحظة</Th>
                <Th className="text-end">المبلغ</Th>
              </tr>
            </thead>
            <tbody>
              {data.payments.map((row) => (
                <Tr key={row.id}>
                  <Td>{row.paidOn}</Td>
                  <Td>{PAYMENT_LABELS[row.method]}</Td>
                  <Td>{row.note}</Td>
                  <Td className="text-end font-medium">{formatMoney(row.amountMinor)}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <Dialog open={issuing} onOpenChange={setIssuing} title="إصدار سيريال" description="تبدأ المدة من أول تفعيل على جهاز العميل." closeLabel="إغلاق">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            issue.mutate()
          }}
        >
          <DurationFields
            amount={duration.amount}
            unit={duration.unit}
            onAmount={(amount) => setDuration({ ...duration, amount })}
            onUnit={(unit) => setDuration({ ...duration, unit })}
          />
          <Button type="submit" loading={issue.isPending}>
            إصدار
          </Button>
        </form>
      </Dialog>

      <Dialog open={paying} onOpenChange={setPaying} title="تسجيل دفعة" closeLabel="إغلاق">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            pay.mutate()
          }}
        >
          <div className="grid grid-cols-2 gap-4">
            <Field id={amountId} label="المبلغ">
              <Input id={amountId} dir="ltr" inputMode="decimal" autoFocus value={payment.amount} onChange={(event) => setPayment({ ...payment, amount: event.target.value })} />
            </Field>
            <Field id={dateId} label="التاريخ">
              <Input id={dateId} dir="ltr" type="date" value={payment.paidOn} onChange={(event) => setPayment({ ...payment, paidOn: event.target.value })} />
            </Field>
          </div>
          <Field id={methodId} label="الطريقة">
            <Select id={methodId} value={payment.method} onChange={(event) => setPayment({ ...payment, method: event.target.value as Payment['method'] })}>
              {METHODS.map((method) => (
                <option key={method} value={method}>
                  {PAYMENT_LABELS[method]}
                </option>
              ))}
            </Select>
          </Field>
          <Field id={noteId} label="ملاحظة">
            <Input id={noteId} value={payment.note} onChange={(event) => setPayment({ ...payment, note: event.target.value })} />
          </Field>
          <Button type="submit" loading={pay.isPending}>
            حفظ
          </Button>
        </form>
      </Dialog>

      {serial && <SerialDialog serial={serial} onClose={() => setSerial(null)} />}
    </>
  )
}

type Pending = 'suspend' | 'resume' | 'revoke' | 'unbind' | 'reissue' | null

const ACTION_TEXT: Record<Exclude<Pending, null>, { title: string; body: string; label: string }> = {
  suspend: { title: 'إيقاف الترخيص؟', body: 'يصبح البرنامج قراءة فقط عند اتصاله القادم بالإنترنت.', label: 'إيقاف' },
  resume: { title: 'إعادة تشغيل الترخيص؟', body: 'يعود البرنامج للعمل عند اتصاله القادم بالإنترنت.', label: 'إعادة تشغيل' },
  revoke: { title: 'إلغاء الترخيص نهائياً؟', body: 'لا يمكن التراجع عن هذا. يصبح البرنامج قراءة فقط عند اتصاله القادم.', label: 'إلغاء نهائي' },
  unbind: { title: 'فك الربط بالجهاز؟', body: 'يتوقف الجهاز الحالي عند اتصاله القادم، ويمكن تفعيل السيريال على جهاز جديد.', label: 'فك الربط' },
  reissue: { title: 'إصدار سيريال بديل؟', body: 'يتوقف السيريال القديم فوراً، ولا تتأثر المدة ولا الجهاز.', label: 'إصدار' },
}

export function LicensePage() {
  const { id } = useParams({ strict: false })
  const queryClient = useQueryClient()
  const fail = useFail()
  const fingerprintId = useId()
  const [pending, setPending] = useState<Pending>(null)
  const [extending, setExtending] = useState(false)
  const [offline, setOffline] = useState(false)
  const [duration, setDuration] = useState<{ amount: string; unit: DurationUnit }>({ amount: '1', unit: 'year' })
  const [fingerprint, setFingerprint] = useState('')
  const [serial, setSerial] = useState<string | null>(null)
  const [offlineToken, setOfflineToken] = useState<string | null>(null)

  const license = useQuery({ queryKey: ['license', id], queryFn: () => api<LicenseDetail>('GET', `/admin/licenses/${id}`) })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['license', id] })

  useEffect(() => setOfflineToken(null), [offline])

  const act = useMutation({
    mutationFn: (action: Exclude<Pending, null>) => api<{ serial?: string }>('POST', `/admin/licenses/${id}/${action}`, {}),
    onSuccess: async (result) => {
      setPending(null)
      if (result.serial) setSerial(result.serial)
      else toast.success('تم')
      await refresh()
    },
    onError: (error) => {
      setPending(null)
      fail(error)
    },
  })

  const extend = useMutation({
    mutationFn: () => api('POST', `/admin/licenses/${id}/extend`, { amount: Number(duration.amount), unit: duration.unit }),
    onSuccess: async () => {
      setExtending(false)
      toast.success('تم التمديد')
      await refresh()
    },
    onError: fail,
  })

  const makeOffline = useMutation({
    mutationFn: () => api<{ token: string }>('POST', `/admin/licenses/${id}/offline`, { fingerprint: fingerprint.replace(/[\s-]/g, '').toLowerCase() }),
    onSuccess: async ({ token }) => {
      setOfflineToken(token)
      await refresh()
    },
    onError: fail,
  })

  if (!license.data) return <FormSkeleton fields={3} />
  const { data } = license
  const stopped = data.state === 'revoked'

  return (
    <>
      <Sign
        title={data.customerName}
        secondary={`ترخيص …${data.serialHint}`}
        actions={
          !stopped && (
            <Button onClick={() => setExtending(true)} disabled={data.expiresAt === null}>
              تمديد
            </Button>
          )
        }
      />

      <dl className="grid grid-cols-4 gap-4 rounded-lg border border-rule bg-surface p-5">
        <div>
          <dt className="text-sm text-ink-soft">الحالة</dt>
          <dd className="pt-1">
            <StateBadge license={data} />
          </dd>
        </div>
        <div>
          <dt className="text-sm text-ink-soft">ينتهي في</dt>
          <dd data-testid="expires-at" className="font-medium text-ink">
            {formatDate(data.expiresAt)}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-ink-soft">الجهاز</dt>
          <dd className="font-medium text-ink">{data.deviceName ?? 'غير مربوط'}</dd>
        </div>
        <div>
          <dt className="text-sm text-ink-soft">آخر اتصال</dt>
          <dd className="font-medium text-ink">{formatDate(data.lastSeenAt)}</dd>
        </div>
      </dl>

      {!stopped && (
        <div className="flex flex-wrap gap-2">
          {data.state === 'suspended' ? (
            <Button variant="secondary" onClick={() => setPending('resume')}>
              إعادة تشغيل
            </Button>
          ) : (
            <Button variant="secondary" onClick={() => setPending('suspend')}>
              إيقاف
            </Button>
          )}
          <Button variant="secondary" disabled={!data.fingerprint} onClick={() => setPending('unbind')}>
            فك الربط بالجهاز
          </Button>
          <Button variant="secondary" onClick={() => setPending('reissue')}>
            سيريال بديل
          </Button>
          <Button variant="secondary" onClick={() => setOffline(true)}>
            كود تفعيل أوفلاين
          </Button>
          <Button variant="danger" onClick={() => setPending('revoke')}>
            إلغاء نهائي
          </Button>
        </div>
      )}

      {!stopped && <AiPanel key={data.aiMonthlyLimit} license={data} onChange={() => void refresh()} />}

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold text-ink">سجل الترخيص</h2>
        <Table>
          <thead>
            <tr>
              <Th>الوقت</Th>
              <Th>العملية</Th>
              <Th>بواسطة</Th>
            </tr>
          </thead>
          <tbody>
            {data.events.map((event) => (
              <Tr key={event.id}>
                <Td>{formatDateTime(event.occurredAt)}</Td>
                <Td>{actionLabel(event.action)}</Td>
                <Td>
                  <bdi dir="ltr">{event.actor}</bdi>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </section>

      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
        title={pending ? ACTION_TEXT[pending].title : ''}
        description={pending ? ACTION_TEXT[pending].body : ''}
        closeLabel="إغلاق"
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setPending(null)}>
            رجوع
          </Button>
          <Button variant={pending === 'revoke' ? 'danger' : 'primary'} loading={act.isPending} onClick={() => act.mutate(pending!)}>
            {pending ? ACTION_TEXT[pending].label : ''}
          </Button>
        </div>
      </Dialog>

      <Dialog open={extending} onOpenChange={setExtending} title="تمديد الترخيص" description="تُضاف المدة إلى تاريخ الانتهاء، أو إلى اليوم لو كان منتهياً." closeLabel="إغلاق">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            extend.mutate()
          }}
        >
          <DurationFields
            amount={duration.amount}
            unit={duration.unit}
            onAmount={(amount) => setDuration({ ...duration, amount })}
            onUnit={(unit) => setDuration({ ...duration, unit })}
          />
          <Button type="submit" loading={extend.isPending}>
            تمديد
          </Button>
        </form>
      </Dialog>

      <Dialog open={offline} onOpenChange={setOffline} title="كود تفعيل أوفلاين" description="لعميل بدون إنترنت: اكتب رقم الجهاز من شاشة الترخيص عنده، وأرسل له الكود." closeLabel="إغلاق">
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            makeOffline.mutate()
          }}
        >
          <Field id={fingerprintId} label="رقم الجهاز">
            <Input id={fingerprintId} dir="ltr" autoFocus value={fingerprint} onChange={(event) => setFingerprint(event.target.value)} />
          </Field>
          <Button type="submit" loading={makeOffline.isPending}>
            إنشاء الكود
          </Button>
        </form>
        {offlineToken && (
          <>
            <textarea readOnly dir="ltr" aria-label="الكود" rows={5} className="w-full rounded-md border border-rule bg-sunken p-2 text-xs break-all text-ink" value={offlineToken} />
            <Button
              variant="secondary"
              onClick={() => {
                void navigator.clipboard.writeText(offlineToken).then(() => toast.success('تم النسخ'))
              }}
            >
              <Copy aria-hidden className="size-4" />
              نسخ
            </Button>
          </>
        )}
      </Dialog>

      {serial && <SerialDialog serial={serial} onClose={() => setSerial(null)} />}
    </>
  )
}

export function EventsPage() {
  const events = useQuery({ queryKey: ['events'], queryFn: () => api<{ items: EventRow[] }>('GET', '/admin/events') })

  return (
    <>
      <Sign title="سجل العمليات" secondary="Activity" />
      {!events.data ? (
        <TableSkeleton columns={4} rows={6} />
      ) : events.data.items.length === 0 ? (
        <p className="text-ink-soft">لم تسجل أي عملية بعد.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>الوقت</Th>
              <Th>العملية</Th>
              <Th>العميل</Th>
              <Th>بواسطة</Th>
            </tr>
          </thead>
          <tbody>
            {events.data.items.map((event) => (
              <Tr key={event.id}>
                <Td>{formatDateTime(event.occurredAt)}</Td>
                <Td>{actionLabel(event.action)}</Td>
                <Td>{event.customerName}</Td>
                <Td>
                  <bdi dir="ltr">{event.actor}</bdi>
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  )
}
