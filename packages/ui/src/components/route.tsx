import { Check } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../utils'

/** A station marker: the route line runs through it, the live stop is ringed. */
function Stop({ active, done, tone }: { active: boolean; done?: boolean; tone: 'plate' | 'surface' }) {
  const onPlate = tone === 'plate'
  return (
    <span
      aria-hidden
      className={cn(
        'relative z-10 flex size-[18px] shrink-0 items-center justify-center rounded-full border-2 transition-colors duration-200',
        onPlate ? 'border-plate-route bg-plate' : 'border-route bg-surface',
        active && (onPlate ? 'bg-plate-route ring-4 ring-plate-route/25' : 'bg-route ring-4 ring-route/20'),
        done && (onPlate ? 'bg-plate-route' : 'bg-route'),
      )}
    >
      {done && <Check className={cn('size-3', onPlate ? 'text-plate' : 'text-route-ink')} strokeWidth={3} />}
    </span>
  )
}

export interface StopsProps {
  steps: ReactNode[]
  current: number
  'aria-label': string
}

/** The onboarding journey, on the enamel plate: each step is a stop on one line. */
export function Stops({ steps, current, 'aria-label': label }: StopsProps) {
  return (
    <ol aria-label={label} className="flex flex-col">
      {steps.map((step, index) => {
        const active = index === current
        const done = index < current
        return (
          <li
            key={index}
            aria-current={active ? 'step' : undefined}
            className="relative flex items-center gap-4 pb-9 last:pb-0"
          >
            {index < steps.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  'absolute start-[8px] top-4 h-full w-0.5',
                  done ? 'bg-plate-route' : 'bg-plate-rule',
                )}
              />
            )}
            <Stop active={active} done={done} tone="plate" />
            <span
              className={cn(
                'text-lg transition-colors duration-200',
                active ? 'font-semibold text-plate-ink' : 'text-plate-soft',
              )}
            >
              {step}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export interface StatusLineProps {
  steps: ReactNode[]
  current: number
  'aria-label': string
}

/** A document's journey in one row: a stop for each state, the live one ringed. */
export function StatusLine({ steps, current, 'aria-label': label }: StatusLineProps) {
  return (
    <ol aria-label={label} className="flex items-center">
      {steps.map((step, index) => {
        const active = index === current
        const done = index < current
        return (
          <li key={index} aria-current={active ? 'step' : undefined} className="flex items-center">
            {index > 0 && <span aria-hidden className={cn('h-0.5 w-10', done || active ? 'bg-route' : 'bg-rule-strong')} />}
            <span className="flex items-center gap-2 px-2">
              <Stop active={active} done={done} tone="surface" />
              <span className={cn('text-sm', active ? 'font-semibold text-ink' : 'text-ink-faint')}>{step}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export interface StationLinkProps extends ComponentProps<'span'> {
  icon: ReactNode
  label: ReactNode
  active: boolean
  last?: boolean
}

/** One navigation stop. The caller wraps it in its router link. */
export function Station({ icon, label, active, last = false, className, ...props }: StationLinkProps) {
  return (
    <span
      className={cn(
        'relative flex items-center gap-3 rounded-md py-2.5 ps-3 pe-3 transition-colors duration-150',
        active ? 'bg-route-soft font-semibold text-route' : 'text-ink-soft group-hover:bg-sunken group-hover:text-ink',
        className,
      )}
      {...props}
    >
      {!last && <span aria-hidden className="absolute start-[20px] top-1/2 h-full w-0.5 bg-rule-strong" />}
      <Stop active={active} tone="surface" />
      <span aria-hidden className="flex size-4 items-center justify-center [&>svg]:size-4">
        {icon}
      </span>
      <span>{label}</span>
    </span>
  )
}

export interface SignProps {
  title: ReactNode
  /** The same name in the other language, as bilingual station signs carry it. */
  secondary?: ReactNode
  actions?: ReactNode
}

export function Sign({ title, secondary, actions }: SignProps) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-rule pb-4">
      <div className="flex flex-col">
        <h1 className="text-2xl leading-tight font-semibold text-ink">{title}</h1>
        {secondary && <p className="text-ink-faint">{secondary}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  )
}
