import {
  Activity as ActivityIcon, Coffee, Cpu, Pause, Play, ScanEye, ShieldCheck, SkipForward, Square, Workflow, Timer as TimerIcon, type LucideIcon,
} from 'lucide-react'
import { fmtRelative } from '../lib/stats'
import { useTimerView, fmtClock } from '../hooks/useNow'
import { runCommand, useFeature } from '../store/device'
import { type ActivityCategory, type ActivityEvent } from '../store/activity'
import { useActiveProfile } from '../store/prefs'
import { nextBreakKind, phaseLabel, useSession } from '../store/session'
import { Button, cn, EmptyState, FeatureGate, ProgressRing, Toggle, Slider, type Tone } from './ui/primitives'

export const CATEGORY_META: Record<ActivityCategory, { label: string; icon: LucideIcon; color: string }> = {
  presence: { label: 'Presence', icon: ScanEye, color: 'var(--c-cyan)' },
  security: { label: 'Security', icon: ShieldCheck, color: 'var(--c-danger)' },
  automation: { label: 'Automation', icon: Workflow, color: 'var(--c-warn)' },
  device: { label: 'Device', icon: Cpu, color: 'var(--c-muted)' },
  focus: { label: 'Focus', icon: TimerIcon, color: 'var(--c-accent)' },
  break: { label: 'Break', icon: Coffee, color: 'var(--c-ok)' },
  system: { label: 'System', icon: ActivityIcon, color: 'var(--c-faint)' },
}

const dotTone: Record<NonNullable<ActivityEvent['tone']>, string> = { neutral: 'text-muted', ok: 'text-ok', warn: 'text-warn', danger: 'text-danger' }

export function ActivityList({ events, limit, empty }: { events: ActivityEvent[]; limit?: number; empty?: { title: string; body: string } }) {
  const list = limit ? events.slice(0, limit) : events
  if (list.length === 0) {
    return <EmptyState compact icon={ActivityIcon} title={empty?.title ?? 'No activity yet'} body={empty?.body ?? 'Events from your workspace will appear here as they happen.'} />
  }
  return (
    <ol className="relative">
      {list.map((e, i) => {
        const M = CATEGORY_META[e.category]
        return (
          <li key={e.id} className="relative flex gap-3.5 pb-4 last:pb-0">
            {i < list.length - 1 && <span className="absolute left-[15px] top-8 bottom-0 w-px bg-line" />}
            <span className={cn('relative grid size-8 shrink-0 place-items-center rounded-full border border-line bg-raised', dotTone[e.tone ?? 'neutral'])}><M.icon className="size-3.5" /></span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex items-baseline justify-between gap-3">
                <p className="truncate text-sm font-medium">{e.title}</p>
                <time className="shrink-0 text-xs text-faint" dateTime={new Date(e.ts).toISOString()}>{fmtRelative(e.ts)}</time>
              </div>
              {e.detail && <p className="mt-0.5 text-[13px] leading-snug text-muted">{e.detail}</p>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

/** Shared focus/break timer. State lives in the session store, so it survives page changes and refreshes. */
export function TimerPanel({ size = 190, compact }: { size?: number; compact?: boolean }) {
  const { timer, remaining, progress } = useTimerView()
  const s = useSession()
  const profile = useActiveProfile()
  const idle = timer.phase === 'idle'
  const brk = timer.phase !== 'focus' && !idle
  const nextBreak = nextBreakKind(s.cycle)
  return (
    <div className={cn('flex items-center gap-6', compact ? 'flex-col sm:flex-row' : 'flex-col')}>
      <ProgressRing value={idle ? 0 : progress} size={size} tone={brk ? 'ok' : 'accent'}>
        <div className="text-center">
          <div className="tabular text-4xl font-semibold tracking-tight">{idle ? `${profile.focusMin}:00` : fmtClock(remaining)}</div>
          <div className="mt-1 text-xs uppercase tracking-wider text-muted">{idle ? 'Ready to focus' : `${phaseLabel(timer.phase)}${timer.running ? '' : ' · paused'}`}</div>
        </div>
      </ProgressRing>
      <div className={cn('flex flex-wrap justify-center gap-2', compact && 'sm:justify-start')}>
        {idle ? (
          <>
            <Button variant="primary" icon={Play} onClick={() => s.start('focus')}>Start focus</Button>
            <Button icon={Coffee} onClick={() => s.start(nextBreak)}>{nextBreak === 'longBreak' ? 'Long break' : 'Short break'}</Button>
          </>
        ) : (
          <>
            <Button variant="primary" icon={timer.running ? Pause : Play} onClick={timer.running ? s.pause : s.resume}>{timer.running ? 'Pause' : 'Resume'}</Button>
            <Button icon={SkipForward} onClick={s.skip}>Skip</Button>
            <Button variant="ghost" icon={Square} onClick={s.stop} aria-label="End session">End</Button>
          </>
        )}
      </div>
    </div>
  )
}

/** Ambient lighting controls. Every value shown is what the device last reported. */
export function LightingControl({ compact }: { compact?: boolean }) {
  const f = useFeature('ambientLighting')
  const enabled = f.state.enabled === true
  const brightness = typeof f.state.brightness === 'number' ? f.state.brightness : null
  const scenes = Array.isArray(f.state.scenes) ? (f.state.scenes as string[]) : []
  const scene = typeof f.state.scene === 'string' ? f.state.scene : null
  const physical = f.state.brightnessSource === 'physical'
  return (
    <FeatureGate feature="ambientLighting">
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium">{f.usable ? (enabled ? 'On' : 'Off') : 'Unavailable'}</div>
            <div className="text-[13px] text-muted">{f.usable ? 'As reported by your desk' : 'Waiting for device'}</div>
          </div>
          <Toggle label="Ambient lighting" checked={enabled} pending={f.pending} onChange={(v) => void runCommand('ambientLighting', 'setEnabled', v)} />
        </div>
        {brightness !== null && (
          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Brightness{physical && <span className="ml-2 normal-case tracking-normal text-faint">set by the slide control on your desk</span>}</div>
            <Slider label="Brightness" value={brightness} disabled={!enabled || physical} onCommit={(v) => void runCommand('ambientLighting', 'setBrightness', v)} />
          </div>
        )}
        {!compact && scenes.length > 0 && (
          <div>
            <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Scene</div>
            <div className="flex flex-wrap gap-2">
              {scenes.map((sc) => (
                <button key={sc} disabled={!enabled} onClick={() => void runCommand('ambientLighting', 'setScene', sc)}
                  className={cn('rounded-lg border px-3 py-1.5 text-[13px] capitalize transition disabled:opacity-50', scene === sc ? 'border-accent/60 bg-accent/10 text-accent' : 'border-line bg-raised text-muted hover:text-ink')}>{sc}</button>
              ))}
            </div>
          </div>
        )}
        {f.usable && brightness === null && scenes.length === 0 && <p className="text-xs text-faint">Your lighting supports on and off.</p>}
      </div>
    </FeatureGate>
  )
}

export function Stat({ label, value, hint, icon: Icon, tone }: { label: string; value: React.ReactNode; hint?: string; icon?: LucideIcon; tone?: Tone }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted">{Icon && <Icon className="size-3.5" />}{label}</div>
      <div className={cn('tabular mt-1.5 text-2xl font-semibold tracking-tight', tone === 'ok' && 'text-ok', tone === 'warn' && 'text-warn', tone === 'danger' && 'text-danger')}>{value}</div>
      {hint && <div className="mt-0.5 text-[13px] text-muted">{hint}</div>}
    </div>
  )
}

export function ChartTip({ active, payload, label, unit }: { active?: boolean; payload?: { name?: string; value?: number; color?: string }[]; label?: string; unit?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div className="card rounded-xl px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 font-medium">{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 text-muted"><span className="size-2 rounded-full" style={{ background: p.color }} />{p.name}: <span className="tabular text-ink">{p.value}{unit}</span></div>
      ))}
    </div>
  )
}
