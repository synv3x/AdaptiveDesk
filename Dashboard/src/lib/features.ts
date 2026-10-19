import {
  BellRing, Fingerprint, Gauge, SlidersVertical, Lightbulb, Lock, MousePointerClick, ScanEye, ShieldCheck,
  SlidersHorizontal, Volume2, Watch, type LucideIcon,
} from 'lucide-react'

/**
 * Hardware abstraction (dashboard side).
 *
 * The dashboard only ever talks about LOGICAL features. Which physical part (and which GPIO)
 * backs a feature is decided by the firmware, which reports availability through `hello` /
 * `telemetry`. To wire up a new component later, implement the feature in firmware and report
 * `available: true` for it. No dashboard change is needed.
 */

export const FEATURE_IDS = [
  'workspacePresence',
  'ambientLighting',
  'workspaceAction',
  'privacyProtection',
  'workstationLock',
  'userAuthentication',
  'mediaControl',
  'productivityControls',
  'wearable',
  'slideControl',
  'pressureSensing',
  'audioAlert',
] as const

export type FeatureId = (typeof FEATURE_IDS)[number]

export function isFeatureId(v: unknown): v is FeatureId {
  return typeof v === 'string' && (FEATURE_IDS as readonly string[]).includes(v)
}

export type ActionSpec =
  | { type: 'none'; sensitive?: boolean }
  | { type: 'boolean'; sensitive?: boolean }
  | { type: 'number'; min: number; max: number; sensitive?: boolean }
  | { type: 'enum'; values: readonly string[]; sensitive?: boolean }
  | { type: 'color'; sensitive?: boolean }

export interface FeatureDef {
  id: FeatureId
  label: string
  description: string
  group: 'Workspace' | 'Security' | 'Productivity' | 'Wearable'
  icon: LucideIcon
  /** Commands the dashboard is allowed to send. Anything else is rejected before transmission. */
  actions: Record<string, ActionSpec>
}

export const HAPTIC_PATTERNS = [
  { id: 'gentle', label: 'Gentle tap', hint: 'One soft pulse' },
  { id: 'double', label: 'Double tap', hint: 'Two short pulses' },
  { id: 'triple', label: 'Triple tap', hint: 'Three short pulses' },
  { id: 'long', label: 'Long press', hint: 'One sustained pulse' },
  { id: 'urgent', label: 'Urgent', hint: 'Rapid repeating pulses' },
] as const
export type HapticPatternId = (typeof HAPTIC_PATTERNS)[number]['id']

export const LIGHT_SCENES = ['focus', 'calm', 'warm', 'alert'] as const

export const FEATURES: Record<FeatureId, FeatureDef> = {
  workspacePresence: {
    id: 'workspacePresence', label: 'Workspace Presence', group: 'Workspace', icon: ScanEye,
    description: 'Detects whether someone is at the desk.',
    actions: {},
  },
  ambientLighting: {
    id: 'ambientLighting', label: 'Ambient Lighting', group: 'Workspace', icon: Lightbulb,
    description: 'Desk lighting that follows your profile.',
    actions: {
      setEnabled: { type: 'boolean' },
      setBrightness: { type: 'number', min: 0, max: 100 },
      setScene: { type: 'enum', values: LIGHT_SCENES },
      setColor: { type: 'color' },
    },
  },
  workspaceAction: {
    id: 'workspaceAction', label: 'Workspace Action', group: 'Productivity', icon: MousePointerClick,
    description: 'A physical control you can map to any action.',
    actions: {},
  },
  privacyProtection: {
    id: 'privacyProtection', label: 'Privacy Protection', group: 'Security', icon: ShieldCheck,
    description: 'Protects your screen when you step away.',
    actions: { setEnabled: { type: 'boolean', sensitive: true } },
  },
  workstationLock: {
    id: 'workstationLock', label: 'Workstation Lock', group: 'Security', icon: Lock,
    description: 'Locks the connected computer.',
    actions: { lock: { type: 'none', sensitive: true } },
  },
  userAuthentication: {
    id: 'userAuthentication', label: 'User Authentication', group: 'Security', icon: Fingerprint,
    description: 'Fingerprint verification at the desk.',
    actions: {},
  },
  mediaControl: {
    id: 'mediaControl', label: 'Media Control', group: 'Productivity', icon: Volume2,
    description: 'Playback and volume for the connected computer.',
    actions: {
      playPause: { type: 'none' },
      next: { type: 'none' },
      previous: { type: 'none' },
      setVolume: { type: 'number', min: 0, max: 100 },
    },
  },
  productivityControls: {
    id: 'productivityControls', label: 'Productivity Controls', group: 'Productivity', icon: SlidersHorizontal,
    description: 'Dials, sliders and touch controls on the desk console.',
    actions: {},
  },
  wearable: {
    id: 'wearable', label: 'Wearable Companion', group: 'Wearable', icon: Watch,
    description: 'Wristband for haptic notifications.',
    actions: {
      startPairing: { type: 'none' },
      stopPairing: { type: 'none' },
      disconnect: { type: 'none', sensitive: true },
      vibrate: { type: 'enum', values: HAPTIC_PATTERNS.map((p) => p.id) },
      setIntensity: { type: 'enum', values: ['low', 'medium', 'high'] },
    },
  },
  slideControl: {
    id: 'slideControl', label: 'Slide Control', group: 'Productivity', icon: SlidersVertical,
    description: 'A physical slider on the desk console.',
    actions: {},
  },
  pressureSensing: {
    id: 'pressureSensing', label: 'Pressure Sensing', group: 'Productivity', icon: Gauge,
    description: 'Detects how hard something presses on the pad.',
    actions: { setThreshold: { type: 'number', min: 5, max: 95 } },
  },
  audioAlert: {
    id: 'audioAlert', label: 'Audio Alert', group: 'Productivity', icon: BellRing,
    description: 'Buzzer for pressure and notification alerts.',
    actions: { test: { type: 'none' }, setMuted: { type: 'boolean' } },
  },
}

export const FEATURE_LIST = FEATURE_IDS.map((id) => FEATURES[id])

/** Validate a command against the allow-list. Returns an error string or null. */
export function validateCommand(feature: string, action: string, value: unknown): string | null {
  if (!isFeatureId(feature)) return `Unknown feature "${feature}"`
  const spec = FEATURES[feature].actions[action]
  if (!spec) return `"${action}" is not a supported action for ${FEATURES[feature].label}`
  switch (spec.type) {
    case 'none':
      return value === undefined ? null : 'This action takes no value'
    case 'boolean':
      return typeof value === 'boolean' ? null : 'Expected true or false'
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) && value >= spec.min && value <= spec.max
        ? null : `Expected a number between ${spec.min} and ${spec.max}`
    case 'enum':
      return typeof value === 'string' && spec.values.includes(value) ? null : `Expected one of: ${spec.values.join(', ')}`
    case 'color':
      return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? null : 'Expected a colour like #00a0ff'
  }
}

export function isSensitive(feature: FeatureId, action: string): boolean {
  return Boolean(FEATURES[feature].actions[action]?.sensitive)
}
