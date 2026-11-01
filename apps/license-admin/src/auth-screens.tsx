import { Button, Field, Input } from '@inv/ui'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import qrcode from 'qrcode-generator'
import { useId, useState, type FormEvent, type ReactNode } from 'react'
import { ApiError, api, errorMessage } from './api'

function Plate({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid min-h-screen grid-cols-[22rem_1fr]">
      <aside className="flex flex-col justify-end bg-plate p-8 text-plate-ink">
        <p className="text-2xl font-semibold">لوحة التراخيص</p>
        <p className="text-plate-soft">للمطور فقط</p>
      </aside>
      <main className="flex items-center justify-center p-8">
        <section className="flex w-full max-w-sm flex-col gap-5">
          <h1 className="text-2xl font-semibold text-ink">{title}</h1>
          {children}
        </section>
      </main>
    </div>
  )
}

function codeOf(error: unknown): unknown {
  // Better Auth reports its own errors under `message`, which never reach the user as they are.
  return error instanceof ApiError && error.status === 401 ? new ApiError('INVALID_EMAIL_OR_PASSWORD', 401) : error
}

function useReload() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: ['access'] })
}

function CodeStep() {
  const id = useId()
  const reload = useReload()
  const [code, setCode] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  const verify = useMutation({
    mutationFn: () => api('POST', '/api/auth/two-factor/verify-totp', { code: code.trim() }),
    onSuccess: reload,
    onError: () => setProblem(errorMessage(new ApiError('INVALID_CODE', 401))),
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    verify.mutate()
  }

  return (
    <Plate title="رمز التحقق">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field id={id} label="الرمز من تطبيق المصادقة" error={problem}>
          <Input
            id={id}
            dir="ltr"
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </Field>
        <Button type="submit" size="lg" loading={verify.isPending}>
          تأكيد
        </Button>
      </form>
    </Plate>
  )
}

export function Login() {
  const emailId = useId()
  const passwordId = useId()
  const reload = useReload()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [needsCode, setNeedsCode] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const signIn = useMutation({
    mutationFn: () => api<{ twoFactorRedirect?: boolean }>('POST', '/api/auth/sign-in/email', { email, password }),
    onSuccess: async (result) => {
      if (result.twoFactorRedirect) setNeedsCode(true)
      else await reload()
    },
    onError: (error) => setProblem(errorMessage(codeOf(error))),
  })

  if (needsCode) return <CodeStep />

  return (
    <Plate title="تسجيل الدخول">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          signIn.mutate()
        }}
        className="flex flex-col gap-4"
      >
        <Field id={emailId} label="البريد الإلكتروني">
          <Input id={emailId} dir="ltr" type="email" autoComplete="username" autoFocus value={email} onChange={(event) => setEmail(event.target.value)} />
        </Field>
        <Field id={passwordId} label="كلمة المرور" error={problem}>
          <Input id={passwordId} dir="ltr" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </Field>
        <Button type="submit" size="lg" loading={signIn.isPending}>
          دخول
        </Button>
      </form>
    </Plate>
  )
}

function qrImage(uri: string): string {
  const code = qrcode(0, 'M')
  code.addData(uri)
  code.make()
  return code.createDataURL(5, 8)
}

interface Enrolment {
  totpURI: string
  backupCodes: string[]
}

/** Nothing in the panel opens until this is done, so there is no way to skip it. */
export function TotpSetup() {
  const passwordId = useId()
  const codeId = useId()
  const reload = useReload()
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const enable = useMutation({
    mutationFn: () => api<Enrolment>('POST', '/api/auth/two-factor/enable', { password }),
    onSuccess: (result) => {
      setProblem(null)
      setEnrolment(result)
    },
    onError: (error) => setProblem(errorMessage(codeOf(error))),
  })

  const verify = useMutation({
    mutationFn: () => api('POST', '/api/auth/two-factor/verify-totp', { code: code.trim() }),
    onSuccess: reload,
    onError: () => setProblem(errorMessage(new ApiError('INVALID_CODE', 401))),
  })

  if (!enrolment) {
    return (
      <Plate title="تفعيل التحقق بخطوتين">
        <p className="text-ink-soft">مطلوب لدخول اللوحة. اكتب كلمة المرور لتبدأ.</p>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            enable.mutate()
          }}
          className="flex flex-col gap-4"
        >
          <Field id={passwordId} label="كلمة المرور" error={problem}>
            <Input id={passwordId} dir="ltr" type="password" autoComplete="current-password" autoFocus value={password} onChange={(event) => setPassword(event.target.value)} />
          </Field>
          <Button type="submit" size="lg" loading={enable.isPending}>
            متابعة
          </Button>
        </form>
      </Plate>
    )
  }

  const secret = new URL(enrolment.totpURI).searchParams.get('secret')

  return (
    <Plate title="امسح الرمز">
      <img src={qrImage(enrolment.totpURI)} alt="رمز QR لتطبيق المصادقة" className="size-48 self-center" />
      <p className="text-sm text-ink-soft">
        أو اكتب هذا المفتاح يدوياً: <bdi dir="ltr" className="font-medium break-all text-ink">{secret}</bdi>
      </p>
      <div className="rounded-md border border-rule bg-surface p-3">
        <p className="pb-1 text-sm font-medium text-ink">رموز الطوارئ، احفظها الآن فلن تظهر مرة أخرى:</p>
        <p dir="ltr" className="tabular text-sm break-words text-ink-soft">
          {enrolment.backupCodes.join('  ')}
        </p>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          verify.mutate()
        }}
        className="flex flex-col gap-4"
      >
        <Field id={codeId} label="الرمز من التطبيق" error={problem}>
          <Input id={codeId} dir="ltr" inputMode="numeric" autoComplete="one-time-code" autoFocus value={code} onChange={(event) => setCode(event.target.value)} />
        </Field>
        <Button type="submit" size="lg" loading={verify.isPending}>
          تأكيد وبدء الاستخدام
        </Button>
      </form>
    </Plate>
  )
}
