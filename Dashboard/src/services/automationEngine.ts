import { ACTIONS, MAPPING_ACTIONS, TRIGGERS, type ActionType, type Rule } from '../lib/automation'
import { ALL_BUS_EVENTS, on, type BusEvent } from '../lib/bus'
import type { JsonValue } from '../lib/protocol'
import { logActivity } from '../store/activity'
import { ruleAvailability, useAutomation } from '../store/automation'
import { getFeature, useDevice, type CommandResult } from '../store/device'
import { usePrefs } from '../store/prefs'
import { nextBreakKind, useSession } from '../store/session'

export interface ActionOutcome { ok: boolean; detail: string }

const fromResult = (res: CommandResult, okText: string): ActionOutcome => ({ ok: res.ok, detail: res.ok ? okText : res.error ?? 'Command failed' })

async function send(feature: Parameters<ReturnType<typeof useDevice.getState>['sendCommand']>[0], action: string, value?: JsonValue) {
  return useDevice.getState().sendCommand(feature, action, value)
}

/**
 * Execute one automation/shortcut action.
 * Device commands report "acknowledged", never "done": real state comes back through telemetry.
 */
export async function executeAction(type: ActionType, ctx: { rule?: Rule; control?: string } = {}): Promise<ActionOutcome> {
  const prefs = usePrefs.getState()
  const session = useSession.getState()
  switch (type) {
    case 'lockWorkstation':
      return fromResult(await send('workstationLock', 'lock'), 'Lock request acknowledged. Waiting for the device to report the workstation as locked.')
    case 'vibrateWristband':
      return fromResult(await send('wearable', 'vibrate', ctx.rule?.action.pattern ?? 'gentle'), 'Vibration request acknowledged by the device.')
    case 'lightingOn':
      return fromResult(await send('ambientLighting', 'setEnabled', true), 'Lighting request acknowledged.')
    case 'lightingOff':
      return fromResult(await send('ambientLighting', 'setEnabled', false), 'Lighting request acknowledged.')
    case 'lightingToggle': {
      const cur = getFeature('ambientLighting').state.enabled
      return fromResult(await send('ambientLighting', 'setEnabled', cur !== true), 'Lighting request acknowledged.')
    }
    case 'applyProfileLighting': {
      const profile = prefs.profiles.find((p) => p.id === prefs.activeProfileId)
      if (!profile?.lighting.apply) return { ok: true, detail: 'This profile has no lighting preset.' }
      const first = await send('ambientLighting', 'setEnabled', profile.lighting.enabled)
      if (!first.ok || !profile.lighting.enabled) return fromResult(first, 'Lighting request acknowledged.')
      const state = getFeature('ambientLighting').state
      if (typeof state.brightness === 'number') await send('ambientLighting', 'setBrightness', profile.lighting.brightness)
      if (Array.isArray(state.scenes) && state.scenes.includes(profile.lighting.scene)) await send('ambientLighting', 'setScene', profile.lighting.scene)
      return { ok: true, detail: `Sent ${profile.name} lighting to the device.` }
    }
    case 'toggleFocus':
      if (session.timer.phase === 'focus') session.stop()
      else session.start('focus')
      return { ok: true, detail: session.timer.phase === 'focus' ? 'Focus session stopped.' : 'Focus session started.' }
    case 'startBreak':
      session.start(nextBreakKind(session.cycle))
      return { ok: true, detail: 'Break started.' }
    case 'mediaPlayPause':
      return fromResult(await send('mediaControl', 'playPause'), 'Media request acknowledged.')
    case 'runAssigned': {
      const control = ctx.control ?? ctx.rule?.action.control
      const mapped = control ? MAPPING_ACTIONS.find((m) => m.id === prefs.mappings[control as keyof typeof prefs.mappings]) : undefined
      if (!mapped?.action) return { ok: true, detail: mapped?.continuous ? 'This control adjusts a value on the device itself.' : 'No action is assigned to this control.' }
      return executeAction(mapped.action, ctx)
    }
  }
}

async function fire(rule: Rule, payload?: Record<string, unknown>) {
  const control = typeof payload?.control === 'string' ? payload.control : undefined
  const out = await executeAction(rule.action.type, { rule, control })
  logActivity({
    category: 'automation',
    ruleId: rule.id,
    title: out.ok ? `“${rule.name}” ran` : `“${rule.name}” could not complete`,
    detail: out.detail,
    tone: out.ok ? 'neutral' : 'warn',
  })
}

function conditionHolds(rule: Rule): boolean {
  const c = rule.condition
  const { activeProfileId } = usePrefs.getState()
  const phase = useSession.getState().timer.phase
  switch (c.type) {
    case 'always': return true
    case 'absenceTimeout': return true
    case 'profileIs': return activeProfileId === c.profileId
    case 'sessionIs': return c.state === 'focus' ? phase === 'focus' : c.state === 'break' ? phase === 'shortBreak' || phase === 'longBreak' : phase === 'idle'
  }
}

export function startAutomationEngine(): () => void {
  const absenceTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const cancelAbsence = () => { absenceTimers.forEach(clearTimeout); absenceTimers.clear() }

  const handle = (event: BusEvent, payload?: Record<string, unknown>) => {
    if (event === 'presence.arrived') cancelAbsence()
    const dev = useDevice.getState()
    for (const rule of useAutomation.getState().rules) {
      if (!rule.enabled || TRIGGERS[rule.trigger.type].event !== event) continue
      if (!ruleAvailability(rule, dev.connection.status, dev.features).runnable) continue

      if (rule.condition.type === 'absenceTimeout' && event === 'presence.left') {
        const connectedAt = dev.connection.connectedAt
        clearTimeout(absenceTimers.get(rule.id))
        absenceTimers.set(rule.id, setTimeout(() => {
          absenceTimers.delete(rule.id)
          const now = useDevice.getState()
          const current = useAutomation.getState().rules.find((r) => r.id === rule.id)
          // Re-verify everything at fire time: same connection session, still absent, rule still enabled and runnable.
          if (!current?.enabled || now.connection.connectedAt !== connectedAt) return
          if (getFeature('workspacePresence').state.value !== false) return
          if (!ruleAvailability(current, now.connection.status, now.features).runnable) return
          void fire(current, payload)
        }, (rule.condition.seconds ?? 60) * 1000))
        continue
      }
      if (conditionHolds(rule)) void fire(rule, payload)
    }
  }

  const offs = ALL_BUS_EVENTS.map((ev) => on(ev, (p) => handle(ev, p)))
  return () => { offs.forEach((f) => f()); cancelAbsence() }
}

export const actionLabel = (t: ActionType) => ACTIONS[t].label
