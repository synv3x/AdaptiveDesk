import type { ActivityCategory, ActivityEvent } from '../store/activity'
import type { SessionRecord } from '../store/session'

const DAY = 86_400_000
const startOfDay = (ts: number) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime() }

export interface DayStat { date: number; label: string; focusMin: number; breakMin: number; sessions: number; completed: number }

export function dailyStats(sessions: SessionRecord[], days = 7): DayStat[] {
  const today = startOfDay(Date.now())
  const out: DayStat[] = []
  for (let i = days - 1; i >= 0; i--) {
    const date = today - i * DAY
    out.push({ date, label: new Date(date).toLocaleDateString(undefined, { weekday: 'short' }), focusMin: 0, breakMin: 0, sessions: 0, completed: 0 })
  }
  for (const s of sessions) {
    const d = out.find((x) => x.date === startOfDay(s.startedAt))
    if (!d) continue
    const min = s.actualMs / 60_000
    if (s.kind === 'focus') { d.focusMin += min; d.sessions++; if (s.completed) d.completed++ } else d.breakMin += min
  }
  return out.map((d) => ({ ...d, focusMin: Math.round(d.focusMin), breakMin: Math.round(d.breakMin) }))
}

export function todayStat(sessions: SessionRecord[]): DayStat {
  return dailyStats(sessions, 1)[0]
}

export interface HourBucket { label: string; start: number; counts: Record<ActivityCategory, number>; total: number }

export function hourlyBuckets(events: ActivityEvent[], hours = 24): HourBucket[] {
  const hourStart = Math.floor(Date.now() / 3_600_000) * 3_600_000
  const buckets: HourBucket[] = []
  for (let i = hours - 1; i >= 0; i--) {
    const start = hourStart - i * 3_600_000
    buckets.push({ label: new Date(start).toLocaleTimeString(undefined, { hour: 'numeric' }), start, counts: { presence: 0, security: 0, automation: 0, device: 0, focus: 0, break: 0, system: 0 }, total: 0 })
  }
  for (const e of events) {
    const b = buckets.find((x) => e.ts >= x.start && e.ts < x.start + 3_600_000)
    if (b) { b.counts[e.category]++; b.total++ }
  }
  return buckets
}

export const fmtDuration = (min: number) => {
  const m = Math.round(min)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60 ? `${m % 60}m` : ''}`.trim()
}

export const fmtTime = (ts: number) => new Date(ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })

export function fmtRelative(ts: number, now = Date.now()) {
  const s = Math.round((now - ts) / 1000)
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
