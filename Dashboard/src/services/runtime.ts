import { emit } from '../lib/bus'
import { useActivity, type ActivityCategory, type ActivityEvent } from '../store/activity'
import { useDevice } from '../store/device'
import { usePrefs, type AppMode } from '../store/prefs'
import { useSession, type SessionRecord } from '../store/session'
import { demoControls } from './demoDevice'
import { startAutomationEngine } from './automationEngine'
import { notify, startNotifier } from './notifier'

/** Starts all background behaviour. Returns a cleanup function (safe under React StrictMode). */
export function startRuntime(): () => void {
  const stopEngine = startAutomationEngine()
  const stopNotifier = startNotifier()
  let warned = ''

  const ticker = setInterval(() => {
    const s = useSession.getState()
    s.tick()
    const { timer } = useSession.getState()
    // Gentle heads-up shortly before a focus session ends.
    const warnMs = usePrefs.getState().breaks.warnMin * 60_000
    if (timer.phase === 'focus' && timer.running && timer.endsAt && warnMs > 0 && timer.plannedMs > warnMs * 2) {
      const left = timer.endsAt - Date.now()
      const key = String(timer.startedAt)
      if (left <= warnMs && left > 0 && warned !== key) {
        warned = key
        notify('info', 'Break coming up', `About ${Math.ceil(left / 60_000)} min left in this focus session.`, { sound: false })
      }
    }
  }, 500)

  // Theme
  const applyTheme = () => {
    const { theme, reduceMotion } = usePrefs.getState()
    const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
    document.documentElement.classList.toggle('reduce-motion', reduceMotion)
  }
  applyTheme()
  const unsubTheme = usePrefs.subscribe(applyTheme)
  const mq = matchMedia('(prefers-color-scheme: dark)')
  mq.addEventListener('change', applyTheme)

  // Start the connection for whichever mode was last used.
  if (usePrefs.getState().mode === 'demo') ensureDemoData()
  useDevice.getState().applyMode()

  return () => {
    clearInterval(ticker)
    stopEngine()
    stopNotifier()
    unsubTheme()
    mq.removeEventListener('change', applyTheme)
    useDevice.getState().disconnect()
  }
}

export function switchMode(mode: AppMode) {
  if (usePrefs.getState().mode === mode) return
  useSession.getState().stop() // a timer belongs to one mode's history
  usePrefs.getState().setMode(mode)
  if (mode === 'demo') {
    demoControls.reset()
    ensureDemoData()
  }
  useDevice.getState().applyMode()
}

export function setActiveProfile(id: string) {
  if (usePrefs.getState().activeProfileId === id) return
  usePrefs.getState().set({ activeProfileId: id })
  emit('profile.changed', { profileId: id })
}

/* ---------- Demo sample data (stored in the demo log only) ---------- */

const rnd = (a: number, b: number) => Math.floor(a + Math.random() * (b - a + 1))

export function ensureDemoData(force = false) {
  const act = useActivity.getState()
  const ses = useSession.getState()
  if (!force && (act.events.demo.length > 0 || ses.history.demo.length > 0)) return
  const sessions: SessionRecord[] = []
  const events: ActivityEvent[] = []
  let n = 0
  const ev = (ts: number, category: ActivityCategory, title: string, detail?: string, tone?: ActivityEvent['tone']) =>
    events.push({ id: `demo-${n++}`, ts, category, title, detail, tone })

  const now = Date.now()
  for (let d = 6; d >= 0; d--) {
    const day = new Date(now - d * 86_400_000)
    day.setHours(9, rnd(0, 20), 0, 0)
    let t = day.getTime()
    const count = d === 0 ? rnd(2, 3) : rnd(3, 6)
    ev(t - 60_000, 'presence', 'You arrived at your workspace')
    for (let i = 0; i < count; i++) {
      if (t > now - 5 * 60_000) break
      const focusMin = [25, 25, 45][rnd(0, 2)]
      const completed = Math.random() > 0.12
      const actual = completed ? focusMin : rnd(8, focusMin - 3)
      sessions.push({ id: `df-${d}-${i}`, kind: 'focus', profileId: 'work', startedAt: t, plannedMs: focusMin * 60000, actualMs: actual * 60000, completed })
      ev(t, 'focus', 'Focus started', `${focusMin} min · Work profile`)
      t += actual * 60000
      ev(t, 'focus', completed ? 'Focus completed' : 'Focus ended early', undefined, completed ? 'ok' : undefined)
      if (t > now - 5 * 60_000) break
      const longB = i % 4 === 3
      const bMin = longB ? 15 : 5
      sessions.push({ id: `db-${d}-${i}`, kind: longB ? 'longBreak' : 'shortBreak', profileId: 'work', startedAt: t, plannedMs: bMin * 60000, actualMs: bMin * 60000, completed: true })
      ev(t, 'break', longB ? 'Long break started' : 'Short break started')
      if (Math.random() > 0.6) ev(t + 60_000, 'presence', 'You left your workspace')
      if (Math.random() > 0.6) ev(t + 3 * 60_000, 'presence', 'You arrived at your workspace')
      t += bMin * 60000
    }
    if (d % 2 === 0) ev(t - 40 * 60_000, 'security', 'Fingerprint verified', undefined, 'ok')
    if (d === 3) ev(t - 20 * 60_000, 'security', 'Fingerprint not recognised', undefined, 'danger')
    if (d % 3 === 0) ev(t - 30 * 60_000, 'automation', '“Match lighting to my profile” ran', 'Sent Work lighting to the device.')
  }
  events.sort((a, b) => b.ts - a.ts)
  ses.setHistory('demo', sessions.sort((a, b) => b.startedAt - a.startedAt))
  act.replace('demo', events)
}

export function resetDemoData() {
  useActivity.getState().clear('demo')
  useSession.getState().clearHistory('demo')
  demoControls.reset()
  ensureDemoData(true)
}
