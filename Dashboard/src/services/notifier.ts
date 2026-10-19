import { on } from '../lib/bus'
import { getFeature, useDevice } from '../store/device'
import { usePrefs, type WearableEventKey } from '../store/prefs'
import { toast } from '../store/toasts'

let audio: AudioContext | null = null

export function chime() {
  if (!usePrefs.getState().notifications.sound) return
  try {
    audio ??= new AudioContext()
    const t = audio.currentTime
    ;[660, 880].forEach((f, i) => {
      const o = audio!.createOscillator()
      const g = audio!.createGain()
      o.frequency.value = f
      o.connect(g).connect(audio!.destination)
      g.gain.setValueAtTime(0.0001, t + i * 0.16)
      g.gain.exponentialRampToValueAtTime(0.12, t + i * 0.16 + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.16 + 0.35)
      o.start(t + i * 0.16)
      o.stop(t + i * 0.16 + 0.4)
    })
  } catch { /* audio unavailable */ }
}

export function notify(tone: 'info' | 'ok' | 'warn' | 'danger', title: string, detail?: string, opts: { sound?: boolean } = {}) {
  const n = usePrefs.getState().notifications
  if (n.inApp) toast({ tone, title, detail })
  if (opts.sound !== false) chime()
  if (n.browser && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try { new Notification(title, { body: detail, silent: true }) } catch { /* ignore */ }
  }
}

async function haptic(key: WearableEventKey) {
  const { wearable } = usePrefs.getState()
  if (!wearable.events[key]) return
  const f = getFeature('wearable')
  if (!f.usable || f.state.connected !== true) return // never pretend to buzz a wristband that isn't there
  await useDevice.getState().sendCommand('wearable', 'vibrate', wearable.patterns[key])
}

export function startNotifier(): () => void {
  const offs = [
    on('focus.finished', () => { notify('ok', 'Focus session complete', 'Time to step away for a break.'); void haptic('breakReminder') }),
    on('break.finished', () => { notify('info', 'Break finished', 'Ready for your next focus session?'); void haptic('sessionComplete') }),
    on('security.alert', (p) => {
      const n = usePrefs.getState().notifications
      if (!n.security) return
      notify('danger', 'Security alert', String(p?.reason ?? ''))
      void haptic('securityAlert')
    }),
  ]
  return () => offs.forEach((f) => f())
}
