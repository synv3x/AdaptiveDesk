import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { emit } from '../lib/bus'
import { logActivity } from './activity'
import { usePrefs, type AppMode } from './prefs'

export type Phase = 'idle' | 'focus' | 'shortBreak' | 'longBreak'

export interface SessionRecord {
  id: string
  kind: Exclude<Phase, 'idle'>
  profileId: string
  startedAt: number
  plannedMs: number
  actualMs: number
  completed: boolean
}

interface Timer {
  phase: Phase
  running: boolean
  endsAt: number | null
  remainingMs: number
  plannedMs: number
  startedAt: number | null
  profileId: string
  /** Which log (demo/live) this session belongs to. */
  source: AppMode
}

interface SessionState {
  timer: Timer
  /** Focus sessions completed since the last long break. */
  cycle: number
  history: Record<AppMode, SessionRecord[]>

  start: (phase: Exclude<Phase, 'idle'>) => void
  pause: () => void
  resume: () => void
  stop: () => void
  skip: () => void
  tick: () => void
  clearHistory: (mode: AppMode) => void
  setHistory: (mode: AppMode, h: SessionRecord[]) => void
}

const idleTimer = (): Timer => ({ phase: 'idle', running: false, endsAt: null, remainingMs: 0, plannedMs: 0, startedAt: null, profileId: '', source: 'live' })
const MIN_RECORD_MS = 10_000

export function nextBreakKind(cycle: number): 'shortBreak' | 'longBreak' {
  const every = usePrefs.getState().breaks.longEvery
  return cycle > 0 && cycle % every === 0 ? 'longBreak' : 'shortBreak'
}

export function phaseLabel(p: Phase): string {
  return { idle: 'Ready', focus: 'Focus', shortBreak: 'Short break', longBreak: 'Long break' }[p]
}

export const useSession = create<SessionState>()(
  persist(
    (set, get) => {
      const record = (completed: boolean) => {
        const { timer, history } = get()
        if (timer.phase === 'idle' || !timer.startedAt) return
        const actualMs = completed ? timer.plannedMs : Math.max(0, timer.plannedMs - (timer.running && timer.endsAt ? Math.max(0, timer.endsAt - Date.now()) : timer.remainingMs))
        if (!completed && actualMs < MIN_RECORD_MS) return
        const rec: SessionRecord = { id: `${timer.startedAt}`, kind: timer.phase, profileId: timer.profileId, startedAt: timer.startedAt, plannedMs: timer.plannedMs, actualMs, completed }
        set({ history: { ...history, [timer.source]: [rec, ...history[timer.source]].slice(0, 1000) } })
      }

      return {
        timer: idleTimer(),
        cycle: 0,
        history: { demo: [], live: [] },

        start: (phase) => {
          const p = usePrefs.getState()
          const profile = p.profiles.find((x) => x.id === p.activeProfileId) ?? p.profiles[0]
          const min = phase === 'focus' ? profile.focusMin : phase === 'shortBreak' ? profile.shortBreakMin : profile.longBreakMin
          const ms = min * 60_000
          if (get().timer.phase !== 'idle') record(false)
          set({ timer: { phase, running: true, endsAt: Date.now() + ms, remainingMs: ms, plannedMs: ms, startedAt: Date.now(), profileId: profile.id, source: p.mode } })
          logActivity({ category: phase === 'focus' ? 'focus' : 'break', title: `${phaseLabel(phase)} started`, detail: `${min} min · ${profile.name} profile` })
          emit(phase === 'focus' ? 'focus.started' : 'break.started')
        },

        pause: () => {
          const { timer } = get()
          if (!timer.running || !timer.endsAt) return
          set({ timer: { ...timer, running: false, remainingMs: Math.max(0, timer.endsAt - Date.now()), endsAt: null } })
        },

        resume: () => {
          const { timer } = get()
          if (timer.phase === 'idle' || timer.running) return
          set({ timer: { ...timer, running: true, endsAt: Date.now() + timer.remainingMs } })
        },

        stop: () => {
          const { timer } = get()
          if (timer.phase === 'idle') return
          record(false)
          logActivity({ category: timer.phase === 'focus' ? 'focus' : 'break', title: `${phaseLabel(timer.phase)} ended early` })
          set({ timer: idleTimer() })
        },

        skip: () => {
          const { timer, cycle } = get()
          if (timer.phase === 'idle') return
          record(false)
          set({ timer: idleTimer() })
          if (timer.phase === 'focus') get().start(nextBreakKind(cycle))
          else get().start('focus')
        },

        tick: () => {
          const { timer, cycle } = get()
          if (!timer.running || !timer.endsAt || Date.now() < timer.endsAt) return
          record(true)
          const finished = timer.phase
          const prefs = usePrefs.getState()
          set({ timer: idleTimer(), cycle: finished === 'focus' ? cycle + 1 : finished === 'longBreak' ? 0 : cycle })
          logActivity({ category: finished === 'focus' ? 'focus' : 'break', title: `${phaseLabel(finished)} completed`, tone: 'ok' })
          if (finished === 'focus') {
            emit('focus.finished')
            if (prefs.breaks.autoStartBreak) get().start(nextBreakKind(get().cycle))
          } else {
            emit('break.finished')
            if (prefs.breaks.autoStartFocus) get().start('focus')
          }
        },

        clearHistory: (mode) => set((s) => ({ history: { ...s.history, [mode]: [] } })),
        setHistory: (mode, h) => set((s) => ({ history: { ...s.history, [mode]: h } })),
      }
    },
    { name: 'adaptivedesk.session', version: 1 },
  ),
)

export function useSessions(): SessionRecord[] {
  const mode = usePrefs((s) => s.mode)
  return useSession((s) => s.history[mode])
}
