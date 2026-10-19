import type { BusEvent } from './bus'
import type { FeatureId, HapticPatternId } from './features'

/** Automation vocabulary: Trigger → Condition → Action. Everything is expressed in logical features. */

export type TriggerType =
  | 'presence.left' | 'presence.arrived' | 'workspaceAction.pressed' | 'control.activated'
  | 'focus.started' | 'focus.finished' | 'break.finished' | 'profile.changed'

export interface TriggerDef { label: string; sentence: string; event: BusEvent; requires: FeatureId[] }

export const TRIGGERS: Record<TriggerType, TriggerDef> = {
  'presence.left': { label: 'You leave your workspace', sentence: 'When you leave your workspace', event: 'presence.left', requires: ['workspacePresence'] },
  'presence.arrived': { label: 'You return to your workspace', sentence: 'When you return to your workspace', event: 'presence.arrived', requires: ['workspacePresence'] },
  'workspaceAction.pressed': { label: 'Workspace Action is pressed', sentence: 'When the Workspace Action is pressed', event: 'workspaceAction.pressed', requires: ['workspaceAction'] },
  'control.activated': { label: 'A productivity control is used', sentence: 'When a productivity control is used', event: 'control.activated', requires: ['productivityControls'] },
  'focus.started': { label: 'A focus session starts', sentence: 'When a focus session starts', event: 'focus.started', requires: [] },
  'focus.finished': { label: 'A focus session finishes', sentence: 'When a focus session finishes', event: 'focus.finished', requires: [] },
  'break.finished': { label: 'A break finishes', sentence: 'When a break finishes', event: 'break.finished', requires: [] },
  'profile.changed': { label: 'Productivity profile changes', sentence: 'When the productivity profile changes', event: 'profile.changed', requires: [] },
}

export type ConditionType = 'always' | 'absenceTimeout' | 'profileIs' | 'sessionIs'
export const CONDITION_LABELS: Record<ConditionType, string> = {
  always: 'Always',
  absenceTimeout: 'Absence timeout is reached',
  profileIs: 'Active profile is…',
  sessionIs: 'Timer state is…',
}

export type ActionType =
  | 'lockWorkstation' | 'vibrateWristband' | 'lightingOn' | 'lightingOff' | 'lightingToggle'
  | 'applyProfileLighting' | 'toggleFocus' | 'startBreak' | 'mediaPlayPause' | 'runAssigned'

export interface ActionDef { label: string; requires: FeatureId[]; sensitive?: boolean }

export const ACTIONS: Record<ActionType, ActionDef> = {
  lockWorkstation: { label: 'Lock the computer', requires: ['workstationLock'], sensitive: true },
  vibrateWristband: { label: 'Vibrate the wristband', requires: ['wearable'] },
  lightingOn: { label: 'Turn ambient lighting on', requires: ['ambientLighting'] },
  lightingOff: { label: 'Turn ambient lighting off', requires: ['ambientLighting'] },
  lightingToggle: { label: 'Toggle ambient lighting', requires: ['ambientLighting'] },
  applyProfileLighting: { label: 'Apply the profile’s lighting', requires: ['ambientLighting'] },
  toggleFocus: { label: 'Start or stop a focus session', requires: [] },
  startBreak: { label: 'Start a break', requires: [] },
  mediaPlayPause: { label: 'Play or pause media', requires: ['mediaControl'] },
  runAssigned: { label: 'Run the control’s assigned action', requires: [] },
}

/** Actions that can be assigned to a physical control (Productivity → Controls). */
export const MAPPING_ACTIONS: { id: string; label: string; action?: ActionType; continuous?: boolean }[] = [
  { id: 'none', label: 'Not assigned' },
  { id: 'toggleFocus', label: 'Start / stop focus session', action: 'toggleFocus' },
  { id: 'startBreak', label: 'Start a break', action: 'startBreak' },
  { id: 'mediaPlayPause', label: 'Play / pause media', action: 'mediaPlayPause' },
  { id: 'lightingToggle', label: 'Toggle ambient lighting', action: 'lightingToggle' },
  { id: 'volume', label: 'Adjust volume', continuous: true },
  { id: 'brightness', label: 'Adjust lighting brightness', continuous: true },
]

export interface Rule {
  id: string
  name: string
  description: string
  enabled: boolean
  trigger: { type: TriggerType }
  condition: { type: ConditionType; seconds?: number; profileId?: string; state?: 'focus' | 'break' | 'idle' }
  action: { type: ActionType; pattern?: HapticPatternId; control?: string }
}

export const DEFAULT_RULES: Rule[] = [
  { id: 'auto-lock', name: 'Lock when I walk away', description: 'Locks your computer once you have been away longer than the timeout.', enabled: false,
    trigger: { type: 'presence.left' }, condition: { type: 'absenceTimeout', seconds: 60 }, action: { type: 'lockWorkstation' } },
  { id: 'break-haptic', name: 'Nudge me when it’s break time', description: 'Vibrates your wristband when a focus session finishes.', enabled: false,
    trigger: { type: 'focus.finished' }, condition: { type: 'always' }, action: { type: 'vibrateWristband', pattern: 'double' } },
  { id: 'profile-lighting', name: 'Match lighting to my profile', description: 'Updates ambient lighting whenever you switch productivity profiles.', enabled: true,
    trigger: { type: 'profile.changed' }, condition: { type: 'always' }, action: { type: 'applyProfileLighting' } },
  { id: 'welcome-lighting', name: 'Welcome back lighting', description: 'Turns the lights on when you sit back down.', enabled: false,
    trigger: { type: 'presence.arrived' }, condition: { type: 'always' }, action: { type: 'lightingOn' } },
  { id: 'press-action', name: 'Workspace Action shortcut', description: 'Runs whatever action you assigned to the Workspace Action control.', enabled: true,
    trigger: { type: 'workspaceAction.pressed' }, condition: { type: 'always' }, action: { type: 'runAssigned', control: 'workspaceAction' } },
  { id: 'control-action', name: 'Productivity control shortcuts', description: 'Runs the action assigned to the control you used.', enabled: true,
    trigger: { type: 'control.activated' }, condition: { type: 'always' }, action: { type: 'runAssigned' } },
]
