import { AnimatePresence, motion } from 'motion/react'
import { AlertTriangle, Loader2, PlugZap, X, type LucideIcon } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import { type FeatureId } from '../../lib/features'
import { useFeature } from '../../store/device'

export const cn = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ')

export type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'info'
const toneText: Record<Tone, string> = { neutral: 'text-muted', ok: 'text-ok', warn: 'text-warn', danger: 'text-danger', info: 'text-accent' }
const toneBg: Record<Tone, string> = {
  neutral: 'bg-raised text-muted border-line', ok: 'bg-ok/10 text-ok border-ok/20', warn: 'bg-warn/10 text-warn border-warn/25',
  danger: 'bg-danger/10 text-danger border-danger/25', info: 'bg-accent/10 text-accent border-accent/25',
}
export { toneText }

/* ---------- Surfaces ---------- */

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('card rounded-2xl p-5 sm:p-6', className)} {...rest}>{children}</div>
}

export function CardHeader({ title, subtitle, icon: Icon, action }: { title: string; subtitle?: string; icon?: LucideIcon; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        {Icon && <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent"><Icon className="size-[18px]" /></span>}
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold tracking-tight">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[13px] leading-snug text-muted">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  )
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 sm:mb-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-[28px]">{title}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">{subtitle}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Badge({ tone = 'neutral', children, dot, className }: { tone?: Tone; children: ReactNode; dot?: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap', toneBg[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}

export function StatusDot({ tone = 'neutral', pulse }: { tone?: Tone; pulse?: boolean }) {
  return (
    <span className={cn('relative inline-flex size-2.5 shrink-0', toneText[tone])}>
      {pulse && <span className="absolute inset-0 animate-ping rounded-full bg-current opacity-50" />}
      <span className="relative size-2.5 rounded-full bg-current" />
    </span>
  )
}

export function Button({
  variant = 'secondary', size = 'md', loading, icon: Icon, children, className, disabled, ...rest
}: { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; size?: 'sm' | 'md'; loading?: boolean; icon?: LucideIcon } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const styles = {
    primary: 'bg-gradient-to-b from-accent to-accent/80 text-white shadow-[0_6px_20px_-8px_var(--c-accent)] hover:brightness-110',
    secondary: 'bg-raised text-ink border border-line hover:border-accent/40',
    ghost: 'text-muted hover:bg-raised hover:text-ink',
    danger: 'bg-danger/10 text-danger border border-danger/25 hover:bg-danger/15',
  }[variant]
  return (
    <button
      disabled={disabled || loading}
      className={cn('inline-flex items-center justify-center gap-2 rounded-xl font-medium transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
        size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-sm', styles, className)}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" /> : Icon && <Icon className="size-4" />}
      {children}
    </button>
  )
}

/* ---------- Inputs ---------- */

export function Toggle({ checked, onChange, disabled, pending, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; pending?: boolean; label: string }) {
  return (
    <button
      role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn('relative h-6 w-11 shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-45',
        checked ? 'border-accent/60 bg-accent' : 'border-line bg-raised')}
    >
      <motion.span
        layout transition={{ type: 'spring', stiffness: 600, damping: 36 }}
        className={cn('absolute top-0.5 grid size-[18px] place-items-center rounded-full bg-white shadow', checked ? 'left-[22px]' : 'left-0.5')}
      >
        {pending && <Loader2 className="size-3 animate-spin text-accent" />}
      </motion.span>
    </button>
  )
}

export function Slider({ value, min = 0, max = 100, step = 1, onCommit, disabled, label, unit = '%' }: {
  value: number; min?: number; max?: number; step?: number; onCommit: (v: number) => void; disabled?: boolean; label: string; unit?: string
}) {
  const [drag, setDrag] = useState<number | null>(null)
  // After release, keep showing what you set until the device reports it (or 1.5 s passes, then the device's real value wins).
  const [held, setHeld] = useState<number | null>(null)
  const shown = drag ?? held ?? value
  const fill = ((shown - min) / (max - min)) * 100
  const commit = () => { if (drag !== null) { onCommit(drag); setHeld(drag); setDrag(null) } }
  useEffect(() => {
    if (held === null) return
    if (value === held) { setHeld(null); return }
    const t = setTimeout(() => setHeld(null), 1500)
    return () => clearTimeout(t)
  }, [held, value])
  return (
    <div className="flex items-center gap-3">
      <input
        type="range" className="slider w-full" aria-label={label} min={min} max={max} step={step} value={shown} disabled={disabled}
        style={{ ['--fill' as string]: `${fill}%` }}
        onChange={(e) => setDrag(Number(e.target.value))}
        onPointerUp={commit} onKeyUp={commit} onBlur={commit}
      />
      <span className="tabular w-12 text-right text-sm text-muted">{Math.round(shown)}{unit}</span>
    </div>
  )
}

export function Segmented<T extends string>({ options, value, onChange, disabled, size = 'md' }: {
  options: { value: T; label: string; icon?: LucideIcon }[]; value: T; onChange: (v: T) => void; disabled?: boolean; size?: 'sm' | 'md'
}) {
  const id = useId()
  return (
    <div role="radiogroup" className="inline-flex max-w-full overflow-x-auto rounded-xl border border-line bg-raised p-1 scroll-thin">
      {options.map((o) => {
        const on = o.value === value
        return (
          <button key={o.value} role="radio" aria-checked={on} disabled={disabled} onClick={() => onChange(o.value)}
            className={cn('relative flex items-center gap-1.5 rounded-lg whitespace-nowrap transition-colors disabled:opacity-50', size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-[13px]', on ? 'text-ink' : 'text-muted hover:text-ink')}>
            {on && <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-lg border border-line bg-surface shadow-sm" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
            <span className="relative flex items-center gap-1.5">{o.icon && <o.icon className="size-3.5" />}{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}

const fieldCls = 'h-10 w-full rounded-xl border border-line bg-raised px-3 text-sm text-ink placeholder:text-faint transition focus:border-accent/60 focus:outline-none disabled:opacity-50'

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(fieldCls, props.className)} />
}

export function Select<T extends string | number>({ value, onChange, options, disabled, className, label }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; disabled?: boolean; className?: string; label: string
}) {
  return (
    <select aria-label={label} value={value} disabled={disabled} className={cn(fieldCls, 'appearance-none pr-8', className)}
      onChange={(e) => { const o = options.find((x) => String(x.value) === e.target.value); if (o) onChange(o.value) }}>
      {options.map((o) => <option key={String(o.value)} value={o.value} className="bg-surface">{o.label}</option>)}
    </select>
  )
}

export function Stepper({ value, onChange, min, max, step = 1, unit, label }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number; unit?: string; label: string }) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, v)))
  return (
    <div className="inline-flex items-center rounded-xl border border-line bg-raised" role="group" aria-label={label}>
      <button aria-label={`Decrease ${label}`} onClick={() => set(value - step)} disabled={value <= min} className="grid size-9 place-items-center text-muted hover:text-ink disabled:opacity-30">−</button>
      <span className="tabular min-w-14 text-center text-sm">{value}{unit && <span className="ml-0.5 text-muted">{unit}</span>}</span>
      <button aria-label={`Increase ${label}`} onClick={() => set(value + step)} disabled={value >= max} className="grid size-9 place-items-center text-muted hover:text-ink disabled:opacity-30">+</button>
    </div>
  )
}

export function Row({ title, hint, children, disabled }: { title: string; hint?: string; children: ReactNode; disabled?: boolean }) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-t border-line py-3.5 first:border-t-0 first:pt-0 last:pb-0', disabled && 'opacity-50')}>
      <div className="min-w-0 flex-1 basis-56">
        <div className="text-sm font-medium">{title}</div>
        {hint && <div className="mt-0.5 text-[13px] leading-snug text-muted">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}

/* ---------- Feedback ---------- */

export function EmptyState({ icon: Icon, title, body, action, compact }: { icon: LucideIcon; title: string; body: string; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={cn('flex flex-col items-center justify-center text-center', compact ? 'py-8' : 'py-14')}>
      <span className="mb-4 grid size-12 place-items-center rounded-2xl border border-line bg-raised text-faint"><Icon className="size-5" /></span>
      <h4 className="text-sm font-semibold">{title}</h4>
      <p className="mt-1 max-w-sm text-[13px] leading-relaxed text-muted">{body}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-raised', className)} />
}

export function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    ref.current?.focus()
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
          <motion.div
            ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}
            initial={{ y: 12, scale: 0.98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 8, scale: 0.98 }}
            className="card relative max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl p-6 outline-none"
          >
            <button onClick={onClose} aria-label="Close" className="absolute right-4 top-4 text-faint hover:text-ink"><X className="size-4" /></button>
            <h2 className="pr-6 text-lg font-semibold tracking-tight">{title}</h2>
            <div className="mt-3">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function ConfirmDialog({ open, title, body, confirmLabel, danger, onConfirm, onCancel }: {
  open: boolean; title: string; body: string; confirmLabel: string; danger?: boolean; onConfirm: () => void; onCancel: () => void
}) {
  return (
    <Modal open={open} onClose={onCancel} title={title}>
      <p className="text-sm leading-relaxed text-muted">{body}</p>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </Modal>
  )
}

export function ProgressRing({ value, size = 160, stroke = 10, children, tone = 'accent' }: { value: number; size?: number; stroke?: number; children?: ReactNode; tone?: 'accent' | 'ok' | 'warn' }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const color = tone === 'ok' ? 'var(--c-ok)' : tone === 'warn' ? 'var(--c-warn)' : 'url(#ring-grad)'
  return (
    <div className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="var(--c-accent)" /><stop offset="1" stopColor="var(--c-cyan)" /></linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--c-raised)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - Math.min(1, Math.max(0, value)))} style={{ transition: 'stroke-dashoffset .5s ease' }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  )
}

/* ---------- Feature-aware wrappers ---------- */

export function FeatureNotice({ feature }: { feature: FeatureId }) {
  const f = useFeature(feature)
  if (f.usable) return null
  const cfg = {
    unavailable: { icon: PlugZap, tone: 'neutral' as Tone, label: 'Not connected' },
    connecting: { icon: Loader2, tone: 'info' as Tone, label: 'Connecting' },
    error: { icon: AlertTriangle, tone: 'danger' as Tone, label: 'Needs attention' },
    disabled: { icon: PlugZap, tone: 'warn' as Tone, label: 'Disabled' },
    available: { icon: PlugZap, tone: 'neutral' as Tone, label: '' },
    active: { icon: PlugZap, tone: 'neutral' as Tone, label: '' },
  }[f.status]
  const Icon = cfg.icon
  return (
    <div className={cn('mb-4 flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[13px]', toneBg[cfg.tone])} role="status">
      <Icon className={cn('mt-0.5 size-4 shrink-0', f.status === 'connecting' && 'animate-spin')} />
      <div><span className="font-medium">{cfg.label}</span><span className="opacity-80"> · {f.reason}</span></div>
    </div>
  )
}

/** Keeps a feature's UI visible but inert, with a clear explanation, whenever the feature isn't usable. */
export function FeatureGate({ feature, children, notice = true, className }: { feature: FeatureId; children: ReactNode; notice?: boolean; className?: string }) {
  const f = useFeature(feature)
  return (
    <div className={className}>
      {notice && <FeatureNotice feature={feature} />}
      <div inert={!f.usable} className={cn(!f.usable && 'pointer-events-none select-none opacity-40')}>{children}</div>
    </div>
  )
}

export function FeatureBadge({ feature }: { feature: FeatureId }) {
  const f = useFeature(feature)
  const map = {
    unavailable: ['neutral', 'Not connected'], connecting: ['info', 'Connecting'], error: ['danger', 'Error'],
    disabled: ['warn', 'Disabled'], available: ['ok', 'Ready'], active: ['ok', 'Active'],
  } as const
  const [tone, label] = map[f.status]
  return <Badge tone={tone} dot>{label}</Badge>
}
