import { AnimatePresence, motion } from 'motion/react'
import {
  Activity, AlarmClock, CircleCheck, FlaskConical, LayoutDashboard, Menu, Moon, Radio, Settings, ShieldCheck, Sun, Timer, TriangleAlert, Watch, Workflow, X, Info, type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { switchMode } from '../../services/runtime'
import { useDevice } from '../../store/device'
import { usePrefs } from '../../store/prefs'
import { useToasts } from '../../store/toasts'
import { cn, Segmented, StatusDot, type Tone } from '../ui/primitives'

export const NAV: { to: string; label: string; icon: LucideIcon; short: string }[] = [
  { to: '/', label: 'Overview', short: 'Home', icon: LayoutDashboard },
  { to: '/security', label: 'Workspace Security', short: 'Security', icon: ShieldCheck },
  { to: '/productivity', label: 'Productivity Hub', short: 'Productivity', icon: Timer },
  { to: '/automation', label: 'Automation Studio', short: 'Automation', icon: Workflow },
  { to: '/breaks', label: 'Break Management', short: 'Breaks', icon: AlarmClock },
  { to: '/wearable', label: 'Wearable Companion', short: 'Wearable', icon: Watch },
  { to: '/insights', label: 'Activity & Insights', short: 'Insights', icon: Activity },
  { to: '/settings', label: 'Settings', short: 'Settings', icon: Settings },
]
const MOBILE_PRIMARY = ['/', '/productivity', '/breaks', '/security']

export function useConnectionSummary(): { tone: Tone; label: string; detail: string; pulse: boolean } {
  const conn = useDevice((s) => s.connection)
  const mode = usePrefs((s) => s.mode)
  const device = usePrefs((s) => s.device)
  const linkName = device.transport === 'serial' ? 'USB' : device.transport === 'bridge' ? 'USB bridge' : 'Wi-Fi'
  const target = device.transport === 'serial' ? 'USB (Web Serial)' : device.transport === 'bridge' ? 'USB bridge' : device.host
  if (mode === 'demo') {
    if (conn.status === 'connected') return { tone: 'info', label: 'Demo device', detail: 'Simulated · no hardware', pulse: true }
    return { tone: 'warn', label: 'Demo reconnecting', detail: 'Simulated connection lost', pulse: false }
  }
  switch (conn.status) {
    case 'connected': return { tone: 'ok', label: 'Connected', detail: `${linkName}${conn.latencyMs != null ? ` · ${conn.latencyMs} ms` : ''}`, pulse: true }
    case 'connecting': return { tone: 'info', label: 'Connecting…', detail: target || 'AdaptiveDesk', pulse: true }
    case 'reconnecting': return { tone: 'warn', label: 'Offline', detail: device.transport === 'serial' ? 'Waiting for the ESP32' : 'Reconnecting automatically', pulse: false }
    case 'error': return { tone: 'danger', label: 'Connection error', detail: conn.error ?? 'Check settings', pulse: false }
    default: return { tone: 'neutral', label: 'Not connected', detail: device.transport === 'serial' ? 'Click Connect ESP32' : target ? 'Open Settings to connect' : 'No device configured', pulse: false }
  }
}

function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-8 place-items-center rounded-[10px] bg-gradient-to-br from-accent to-cyan shadow-[0_6px_18px_-6px_var(--c-accent)]">
        <svg viewBox="0 0 32 32" className="size-5"><path d="M8 22 16 8l8 14" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" /><circle cx="16" cy="22" r="2.2" fill="#fff" /></svg>
      </span>
      <span className="text-[15px] font-semibold tracking-tight">AdaptiveDesk</span>
    </div>
  )
}

function Sidebar() {
  const c = useConnectionSummary()
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-surface/70 px-4 py-5 backdrop-blur-xl lg:flex">
      <div className="px-2 pb-6"><Logo /></div>
      <nav className="flex flex-1 flex-col gap-0.5" aria-label="Primary">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'}
            className={({ isActive }) => cn('group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors', isActive ? 'text-ink' : 'text-muted hover:bg-raised/60 hover:text-ink')}>
            {({ isActive }) => (
              <>
                {isActive && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-xl border border-line bg-raised" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
                {isActive && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r bg-gradient-to-b from-accent to-cyan" />}
                <n.icon className={cn('relative size-[18px]', isActive && 'text-accent')} />
                <span className="relative">{n.label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <NavLink to="/settings" className="card mt-4 flex items-center gap-3 rounded-xl p-3 transition hover:border-accent/40">
        <StatusDot tone={c.tone} pulse={c.pulse} />
        <div className="min-w-0"><div className="truncate text-[13px] font-medium">{c.label}</div><div className="truncate text-xs text-muted">{c.detail}</div></div>
      </NavLink>
    </aside>
  )
}

function ThemeButton() {
  const theme = usePrefs((s) => s.theme)
  const set = usePrefs((s) => s.set)
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  const Icon = dark ? Sun : Moon
  return (
    <button aria-label={`Switch to ${dark ? 'light' : 'dark'} theme`} onClick={() => set({ theme: dark ? 'light' : 'dark' })} data-theme-pref={theme}
      className="grid size-9 place-items-center rounded-xl border border-line bg-raised text-muted transition hover:text-ink">
      <Icon className="size-4" />
    </button>
  )
}

function TopBar() {
  const mode = usePrefs((s) => s.mode)
  const c = useConnectionSummary()
  const loc = useLocation()
  const current = NAV.find((n) => (n.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(n.to)))
  return (
    <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-line bg-bg/75 px-4 backdrop-blur-xl sm:px-6 lg:px-8">
      <div className="flex items-center gap-3 lg:hidden"><Logo /></div>
      <div className="hidden text-sm font-medium text-muted lg:block">{current?.label}</div>
      <div className="flex items-center gap-2 sm:gap-3">
        <Segmented size="sm" value={mode} onChange={switchMode}
          options={[{ value: 'live', label: 'Live', icon: Radio }, { value: 'demo', label: 'Demo', icon: FlaskConical }]} />
        <NavLink to="/settings" className="hidden items-center gap-2 rounded-xl border border-line bg-raised px-3 py-2 text-[13px] sm:flex">
          <StatusDot tone={c.tone} pulse={c.pulse} /><span>{c.label}</span>
        </NavLink>
        <ThemeButton />
      </div>
    </header>
  )
}

function DemoBanner() {
  const mode = usePrefs((s) => s.mode)
  if (mode !== 'demo') return null
  return (
    <div className="flex items-center justify-center gap-2 border-b border-accent/25 bg-accent/10 px-4 py-2 text-center text-xs text-accent">
      <FlaskConical className="size-3.5 shrink-0" />
      <span><b className="font-semibold">Demo Mode.</b> Everything you see is simulated. No hardware is connected, and nothing here reflects a real device.</span>
    </div>
  )
}

function MobileNav() {
  const [more, setMore] = useState(false)
  const loc = useLocation()
  const primary = NAV.filter((n) => MOBILE_PRIMARY.includes(n.to))
  const rest = NAV.filter((n) => !MOBILE_PRIMARY.includes(n.to))
  const moreActive = rest.some((n) => loc.pathname.startsWith(n.to))
  return (
    <>
      <AnimatePresence>
        {more && (
          <motion.div className="fixed inset-0 z-40 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-black/55" onClick={() => setMore(false)} />
            <motion.div initial={{ y: 40 }} animate={{ y: 0 }} exit={{ y: 40 }} className="card absolute inset-x-3 bottom-24 rounded-2xl p-2">
              {rest.map((n) => (
                <NavLink key={n.to} to={n.to} onClick={() => setMore(false)}
                  className={({ isActive }) => cn('flex items-center gap-3 rounded-xl px-4 py-3 text-sm', isActive ? 'bg-raised text-ink' : 'text-muted')}>
                  <n.icon className="size-[18px]" />{n.label}
                </NavLink>
              ))}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/90 px-2 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
        <div className="mx-auto flex max-w-md items-center justify-around py-1.5">
          {primary.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} onClick={() => setMore(false)}
              className={({ isActive }) => cn('flex min-w-16 flex-col items-center gap-1 rounded-xl px-3 py-1.5 text-[11px]', isActive ? 'text-accent' : 'text-muted')}>
              <n.icon className="size-5" />{n.short}
            </NavLink>
          ))}
          <button onClick={() => setMore((v) => !v)} aria-expanded={more}
            className={cn('flex min-w-16 flex-col items-center gap-1 rounded-xl px-3 py-1.5 text-[11px]', moreActive || more ? 'text-accent' : 'text-muted')}>
            {more ? <X className="size-5" /> : <Menu className="size-5" />}More
          </button>
        </div>
      </nav>
    </>
  )
}

function Toaster() {
  const { toasts, dismiss } = useToasts()
  const icon = { info: Info, ok: CircleCheck, warn: TriangleAlert, danger: TriangleAlert }
  const color = { info: 'text-accent', ok: 'text-ok', warn: 'text-warn', danger: 'text-danger' }
  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => {
          const Icon = icon[t.tone]
          return (
            <motion.div key={t.id} layout initial={{ opacity: 0, y: -12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }}
              className="card pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl p-3.5 shadow-xl">
              <Icon className={cn('mt-0.5 size-4 shrink-0', color[t.tone])} />
              <div className="min-w-0 flex-1"><div className="text-sm font-medium">{t.title}</div>{t.detail && <div className="mt-0.5 text-[13px] text-muted">{t.detail}</div>}</div>
              <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="text-faint hover:text-ink"><X className="size-4" /></button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}

export default function Shell() {
  const loc = useLocation()
  return (
    <div className="ambient min-h-screen">
      <Sidebar />
      <div className="lg:pl-64">
        <TopBar />
        <DemoBanner />
        <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 sm:px-6 sm:pt-8 lg:px-8 lg:pb-12">
          <motion.div key={loc.pathname} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
            <Outlet />
          </motion.div>
        </main>
      </div>
      <MobileNav />
      <Toaster />
    </div>
  )
}
