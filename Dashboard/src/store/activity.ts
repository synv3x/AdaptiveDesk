import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { usePrefs, type AppMode } from './prefs'

export type ActivityCategory = 'presence' | 'security' | 'automation' | 'device' | 'focus' | 'break' | 'system'

export interface ActivityEvent {
  id: string
  ts: number
  category: ActivityCategory
  title: string
  detail?: string
  ruleId?: string
  tone?: 'neutral' | 'ok' | 'warn' | 'danger'
}

const CAP = 500

interface ActivityState {
  /** Demo and Live logs are stored separately and never mix. */
  events: Record<AppMode, ActivityEvent[]>
  add: (source: AppMode, e: Omit<ActivityEvent, 'id' | 'ts'> & { ts?: number }) => void
  clear: (source: AppMode) => void
  replace: (source: AppMode, events: ActivityEvent[]) => void
}

let seq = 0
export const useActivity = create<ActivityState>()(
  persist(
    (set) => ({
      events: { demo: [], live: [] },
      add: (source, e) =>
        set((s) => ({
          events: {
            ...s.events,
            [source]: [{ ...e, id: `${Date.now()}-${seq++}`, ts: e.ts ?? Date.now() }, ...s.events[source]].slice(0, CAP),
          },
        })),
      clear: (source) => set((s) => ({ events: { ...s.events, [source]: [] } })),
      replace: (source, events) => set((s) => ({ events: { ...s.events, [source]: events } })),
    }),
    { name: 'adaptivedesk.activity', version: 1 },
  ),
)

/** Log an event into the log for the currently active mode. */
export function logActivity(e: Omit<ActivityEvent, 'id' | 'ts'>) {
  useActivity.getState().add(usePrefs.getState().mode, e)
}

export function useEvents(): ActivityEvent[] {
  const mode = usePrefs((s) => s.mode)
  return useActivity((s) => s.events[mode])
}
