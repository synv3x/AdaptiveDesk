import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { HapticPatternId } from '../lib/features'

export type AppMode = 'demo' | 'live'
export type ThemePref = 'dark' | 'light' | 'system'
export type DemoProfile = 'full' | 'minimal'
export type ProfileIcon = 'briefcase' | 'book' | 'gamepad' | 'sparkles'

export interface WorkProfile {
  id: string
  name: string
  icon: ProfileIcon
  description: string
  focusMin: number
  shortBreakMin: number
  longBreakMin: number
  lighting: { apply: boolean; enabled: boolean; brightness: number; scene: string }
}

export interface Macro {
  id: string
  name: string
  keys: string
}

export type WearableEventKey = 'breakReminder' | 'sessionComplete' | 'securityAlert'

export const DEFAULT_PROFILES: WorkProfile[] = [
  { id: 'work', name: 'Work', icon: 'briefcase', description: 'Balanced focus with regular breaks.', focusMin: 25, shortBreakMin: 5, longBreakMin: 15, lighting: { apply: true, enabled: true, brightness: 70, scene: 'focus' } },
  { id: 'study', name: 'Study', icon: 'book', description: 'Longer deep-work blocks, calm lighting.', focusMin: 45, shortBreakMin: 10, longBreakMin: 20, lighting: { apply: true, enabled: true, brightness: 55, scene: 'calm' } },
  { id: 'gaming', name: 'Gaming', icon: 'gamepad', description: 'Relaxed intervals and ambient glow.', focusMin: 60, shortBreakMin: 10, longBreakMin: 20, lighting: { apply: true, enabled: true, brightness: 90, scene: 'alert' } },
  { id: 'custom', name: 'Custom', icon: 'sparkles', description: 'Your own rhythm. Edit anything.', focusMin: 30, shortBreakMin: 5, longBreakMin: 15, lighting: { apply: false, enabled: true, brightness: 60, scene: 'warm' } },
]

export const CONTROLS = [
  { id: 'workspaceAction', label: 'Workspace Action', hint: 'Primary press control', feature: 'workspaceAction' },
  { id: 'dialA', label: 'Dial A', hint: 'Rotary control', feature: 'productivityControls' },
  { id: 'dialB', label: 'Dial B', hint: 'Rotary control', feature: 'productivityControls' },
  { id: 'slider', label: 'Slide Control', hint: 'Linear control', feature: 'productivityControls' },
  { id: 'touch', label: 'Touch Pad', hint: 'Capacitive control', feature: 'productivityControls' },
] as const
export type ControlId = (typeof CONTROLS)[number]['id']

interface Prefs {
  mode: AppMode
  userName: string
  theme: ThemePref
  reduceMotion: boolean
  device: {
    /** serial = native Web Serial (default), bridge = legacy Node bridge, wifi = WebSocket to the ESP32 */
    transport: 'serial' | 'bridge' | 'wifi'
    /** Remembered USB identity of the ESP32 so we reconnect to the right authorized port. */
    serialVid?: number
    serialPid?: number
    bridgePort: number
    host: string
    port: number
    path: string
    autoConnect: boolean
  }
  heartbeatSec: number
  refreshSec: number
  demoProfile: DemoProfile
  notifications: { inApp: boolean; browser: boolean; sound: boolean; security: boolean }
  profiles: WorkProfile[]
  activeProfileId: string
  breaks: { longEvery: number; autoStartBreak: boolean; autoStartFocus: boolean; warnMin: number }
  wearable: { events: Record<WearableEventKey, boolean>; patterns: Record<WearableEventKey, HapticPatternId>; intensity: 'low' | 'medium' | 'high' }
  mappings: Record<ControlId, string>
  macros: Macro[]

  set: (patch: Partial<Prefs>) => void
  setMode: (m: AppMode) => void
  updateProfile: (id: string, patch: Partial<Omit<WorkProfile, 'id'>>) => void
  resetAll: () => void
}

const defaults = (): Omit<Prefs, 'set' | 'setMode' | 'updateProfile' | 'resetAll'> => ({
  mode: 'live',
  userName: '',
  theme: 'dark',
  reduceMotion: false,
  device: { transport: 'serial', bridgePort: 8787, host: '', port: 81, path: '/ws', autoConnect: true },
  heartbeatSec: 5,
  refreshSec: 0,
  demoProfile: 'full',
  notifications: { inApp: true, browser: false, sound: true, security: true },
  profiles: DEFAULT_PROFILES,
  activeProfileId: 'work',
  breaks: { longEvery: 4, autoStartBreak: false, autoStartFocus: false, warnMin: 2 },
  wearable: {
    events: { breakReminder: true, sessionComplete: true, securityAlert: true },
    patterns: { breakReminder: 'double', sessionComplete: 'gentle', securityAlert: 'urgent' },
    intensity: 'medium',
  },
  mappings: { workspaceAction: 'toggleFocus', dialA: 'volume', dialB: 'brightness', slider: 'none', touch: 'mediaPlayPause' },
  macros: [
    { id: 'm1', name: 'Quick screenshot', keys: 'Win+Shift+S' },
    { id: 'm2', name: 'Mute microphone', keys: 'Ctrl+Shift+M' },
  ],
})

export const usePrefs = create<Prefs>()(
  persist(
    (set) => ({
      ...defaults(),
      set: (patch) => set(patch),
      setMode: (mode) => set({ mode }),
      updateProfile: (id, patch) =>
        set((s) => ({ profiles: s.profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
      resetAll: () => set(defaults()),
    }),
    {
      name: 'adaptivedesk.prefs',
      version: 3,
      // v1: Wi-Fi only. v2: added the 'usb' bridge. v3: native Web Serial is the default USB transport and the bridge is legacy.
      migrate: (persisted) => {
        const p = persisted as { device?: Record<string, unknown> }
        const d = { ...(p.device ?? {}) }
        const bridgePort = typeof d.bridgePort === 'number' ? d.bridgePort : typeof d.usbPort === 'number' ? d.usbPort : 8787
        delete d.usbPort
        const transport = d.transport === 'wifi' || (d.transport === undefined && d.host) ? 'wifi' : d.transport === 'bridge' ? 'bridge' : 'serial'
        p.device = { ...d, transport, bridgePort }
        return p as never
      },
    },
  ),
)

export function useActiveProfile(): WorkProfile {
  return usePrefs((s) => s.profiles.find((p) => p.id === s.activeProfileId) ?? s.profiles[0])
}
