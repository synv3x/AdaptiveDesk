import { useEffect, useState } from 'react'
import { useSession } from '../store/session'

export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

export const fmtClock = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export function useTimerView() {
  const timer = useSession((s) => s.timer)
  const now = useNow(250)
  const remaining = timer.phase === 'idle' ? 0 : timer.running && timer.endsAt ? Math.max(0, timer.endsAt - now) : timer.remainingMs
  const progress = timer.plannedMs > 0 ? 1 - remaining / timer.plannedMs : 0
  return { timer, remaining, progress }
}
