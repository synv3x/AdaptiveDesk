import { create } from 'zustand'
import { emit } from '../lib/bus'
import { FEATURES, validateCommand, type FeatureId } from '../lib/features'
import { PROTOCOL_VERSION, type DeviceMessage, type FeatureReport, type JsonValue, type SystemInfo } from '../lib/protocol'
import { DeviceClient, type ConnectionStatus } from '../services/deviceClient'
import { demoControls } from '../services/demoDevice'
import { logActivity } from './activity'
import { usePrefs } from './prefs'
import { toast } from './toasts'

export interface PendingCommand {
  requestId: string
  feature: FeatureId
  action: string
  value?: JsonValue
  sentAt: number
  status: 'pending' | 'acknowledged' | 'rejected' | 'timeout' | 'failed'
  error?: string
}

export interface CommandResult { ok: boolean; error?: string }

export interface LogEntry { ts: number; dir: 'tx' | 'rx' | 'sys'; text: string }

interface DeviceState {
  connection: { status: ConnectionStatus; error?: string; attempt: number; retryAt?: number; connectedAt?: number; lastSeen?: number; latencyMs?: number }
  identity: { deviceId?: string; name?: string; firmware?: string; board?: string }
  /** Last state REPORTED by the device. Never written from user input or local preferences. */
  features: Partial<Record<FeatureId, FeatureReport>>
  system?: SystemInfo
  pending: Record<string, PendingCommand>
  log: LogEntry[]

  applyMode: () => void
  connectLive: () => void
  disconnect: () => void
  sendCommand: (feature: FeatureId, action: string, value?: JsonValue) => Promise<CommandResult>
}

const COMMAND_TIMEOUT_MS = 5000
const resolvers = new Map<string, (r: CommandResult) => void>()
let cmdSeq = 0
let baseline = false

export function liveUrl(): string | null {
  const { host, port, path } = usePrefs.getState().device
  const h = host.trim()
  if (!/^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(h)) return null
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  if (!/^\/[A-Za-z0-9/_-]*$/.test(path)) return null
  return `ws://${h}:${port}${path}`
}

export const useDevice = create<DeviceState>()((set, get) => {
  const settle = (id: string, status: PendingCommand['status'], error?: string) => {
    const cur = get().pending[id]
    if (!cur || cur.status !== 'pending') return
    set((s) => ({ pending: { ...s.pending, [id]: { ...cur, status, error } } }))
    resolvers.get(id)?.({ ok: status === 'acknowledged', error })
    resolvers.delete(id)
    setTimeout(() => set((s) => { const { [id]: _drop, ...rest } = s.pending; return { pending: rest } }), 4000)
  }

  const client = new DeviceClient({
    onStatus: (status, info) => {
      const prev = get().connection
      const wasConnected = prev.status === 'connected'
      const now = Date.now()
      set({
        connection: {
          ...prev,
          status,
          attempt: info.attempt,
          retryAt: info.retryAt,
          error: status === 'connected' ? undefined : info.error ?? (status === 'idle' ? undefined : prev.error),
          connectedAt: status === 'connected' ? now : wasConnected ? undefined : prev.connectedAt,
          latencyMs: status === 'connected' ? prev.latencyMs : undefined,
        },
      })
      if (status === 'connected') {
        baseline = false
        logActivity({ category: 'device', title: 'Device connected', tone: 'ok' })
      }
      if (wasConnected && status !== 'connected') {
        baseline = false
        // Commands in flight can no longer be confirmed; they are never replayed on reconnect.
        for (const p of Object.values(get().pending)) settle(p.requestId, 'failed', 'Connection lost before the device responded')
        if (status !== 'idle') logActivity({ category: 'device', title: 'Device went offline', detail: info.error, tone: 'warn' })
        else logActivity({ category: 'device', title: 'Disconnected' })
      }
      if (status !== 'connected') set({ features: {}, system: undefined })
    },
    onLatency: (ms) => set((s) => ({ connection: { ...s.connection, latencyMs: ms } })),
    onLog: (dir, text) => set((s) => ({ log: [...s.log.slice(-199), { ts: Date.now(), dir, text }] })),
    onMessage: (msg) => {
      set((s) => ({ connection: { ...s.connection, lastSeen: Date.now() } }))
      handleMessage(msg)
    },
  })

  const handleMessage = (msg: DeviceMessage) => {
    switch (msg.type) {
      case 'hello':
        set({ identity: { deviceId: msg.deviceId, name: msg.name, firmware: msg.firmware, board: msg.board }, features: msg.features, system: msg.system })
        baseline = true
        break
      case 'telemetry': {
        const prev = get().features
        set({ features: { ...prev, ...msg.features }, system: msg.system ?? get().system })
        if (baseline) diff(prev, msg.features)
        baseline = true
        break
      }
      case 'ack':
        settle(msg.requestId, msg.ok ? 'acknowledged' : 'rejected', msg.error)
        break
      case 'event':
        handleDeviceEvent(msg)
        break
      case 'pong':
        break
    }
  }

  return {
    connection: { status: 'idle', attempt: 0 },
    identity: {},
    features: {},
    pending: {},
    log: [],

    applyMode: () => {
      const { mode, demoProfile, heartbeatSec, refreshSec, device } = usePrefs.getState()
      const common = { heartbeatMs: heartbeatSec * 1000, refreshMs: refreshSec * 1000 }
      set({ features: {}, system: undefined, identity: {}, pending: {} })
      if (mode === 'demo') {
        client.connect({ kind: 'demo', profile: demoProfile, ...common })
        return
      }
      const url = liveUrl()
      if (device.autoConnect && url) client.connect({ kind: 'live', url, ...common })
      else client.disconnect()
    },

    connectLive: () => {
      const { heartbeatSec, refreshSec } = usePrefs.getState()
      const url = liveUrl()
      if (!url) {
        set({ connection: { status: 'error', attempt: 0, error: 'Enter a valid device address (hostname or IP), port and path.' } })
        return
      }
      client.connect({ kind: 'live', url, heartbeatMs: heartbeatSec * 1000, refreshMs: refreshSec * 1000 })
    },

    disconnect: () => client.disconnect(),

    sendCommand: (feature, action, value) => {
      const err = validateCommand(feature, action, value)
      if (err) return Promise.resolve({ ok: false, error: err })
      const view = resolveFeature(feature, get().connection.status, get().features[feature])
      if (!view.usable) return Promise.resolve({ ok: false, error: view.reason ?? 'Feature unavailable' })

      const requestId = `cmd-${Date.now().toString(36)}-${(cmdSeq++).toString(36)}`
      const sent = client.send({ protocolVersion: PROTOCOL_VERSION, type: 'command', requestId, feature, action, ...(value !== undefined ? { value } : {}) })
      if (!sent) return Promise.resolve({ ok: false, error: 'Not connected' })

      set((s) => ({ pending: { ...s.pending, [requestId]: { requestId, feature, action, value, sentAt: Date.now(), status: 'pending' } } }))
      return new Promise<CommandResult>((resolve) => {
        resolvers.set(requestId, resolve)
        setTimeout(() => settle(requestId, 'timeout', 'The device did not respond in time'), COMMAND_TIMEOUT_MS)
      })
    },
  }

  /** Compare successive device reports and log only what the device itself changed. */
  function diff(prev: DeviceState['features'], next: Partial<Record<FeatureId, FeatureReport>>) {
    for (const id of Object.keys(next) as FeatureId[]) {
      const a = prev[id]
      const b = next[id]!
      const label = FEATURES[id].label
      if (a && a.available !== b.available) {
        logActivity({ category: 'device', title: `${label} ${b.available ? 'is now available' : 'became unavailable'}`, tone: b.available ? 'ok' : 'warn' })
      }
      if (!a || !b.available) continue
      if (id === 'workspacePresence' && a.state.value !== b.state.value && typeof b.state.value === 'boolean') {
        logActivity({ category: 'presence', title: b.state.value ? 'You arrived at your workspace' : 'You left your workspace', tone: 'neutral' })
        emit(b.state.value ? 'presence.arrived' : 'presence.left')
      }
      if (id === 'workstationLock' && a.state.locked !== b.state.locked && typeof b.state.locked === 'boolean') {
        logActivity({ category: 'security', title: b.state.locked ? 'Workstation reported locked' : 'Workstation reported unlocked', detail: 'Confirmed by the device', tone: b.state.locked ? 'ok' : 'neutral' })
      }
      if (id === 'privacyProtection' && a.state.enabled !== b.state.enabled && typeof b.state.enabled === 'boolean') {
        logActivity({ category: 'security', title: `Privacy protection ${b.state.enabled ? 'enabled' : 'disabled'}`, tone: b.state.enabled ? 'ok' : 'warn' })
      }
      if (id === 'ambientLighting' && a.state.enabled !== b.state.enabled && typeof b.state.enabled === 'boolean') {
        logActivity({ category: 'device', title: `Ambient lighting turned ${b.state.enabled ? 'on' : 'off'}` })
      }
      if (id === 'wearable' && a.state.connected !== b.state.connected && typeof b.state.connected === 'boolean') {
        logActivity({ category: 'device', title: b.state.connected ? 'Wristband connected' : 'Wristband disconnected', tone: b.state.connected ? 'ok' : 'warn' })
      }
    }
  }

  function handleDeviceEvent(msg: Extract<DeviceMessage, { type: 'event' }>) {
    switch (msg.event) {
      case 'workspaceAction.pressed':
        logActivity({ category: 'device', title: 'Workspace Action pressed' })
        emit('workspaceAction.pressed')
        break
      case 'control.activated':
        logActivity({ category: 'device', title: 'Physical control used', detail: msg.detail })
        emit('control.activated', { control: msg.detail })
        break
      case 'auth.success':
        logActivity({ category: 'security', title: 'Fingerprint verified', tone: 'ok' })
        break
      case 'auth.failed':
        logActivity({ category: 'security', title: 'Fingerprint not recognised', tone: 'danger' })
        emit('security.alert', { reason: 'Fingerprint not recognised' })
        break
      default:
        break // unknown events are visible in Advanced Diagnostics only
    }
  }
})

export interface FeatureView {
  status: 'unavailable' | 'connecting' | 'available' | 'active' | 'disabled' | 'error'
  usable: boolean
  reason?: string
  state: Record<string, JsonValue>
}

/** Single source of truth for "can the UI offer this feature right now?". */
export function resolveFeature(id: FeatureId, conn: ConnectionStatus, report?: FeatureReport): FeatureView {
  const { mode } = usePrefs.getState()
  if (conn !== 'connected') {
    if (conn === 'connecting' || conn === 'reconnecting')
      return { status: 'connecting', usable: false, state: {}, reason: conn === 'reconnecting' ? 'Device offline. Reconnecting…' : 'Connecting to your AdaptiveDesk…' }
    return { status: 'unavailable', usable: false, state: {}, reason: mode === 'live' ? 'Connect your AdaptiveDesk to use this feature.' : 'Demo device is not running.' }
  }
  if (!report || !report.available) return { status: 'unavailable', usable: false, state: {}, reason: `${FEATURES[id].label} hasn't been connected to your console yet.` }
  if (report.status === 'error') return { status: 'error', usable: false, state: report.state, reason: report.error ?? 'The device reported a problem with this feature.' }
  if (report.status === 'disabled') return { status: 'disabled', usable: false, state: report.state, reason: 'Disabled on the device.' }
  if (report.status === 'connecting') return { status: 'connecting', usable: false, state: report.state, reason: 'Starting up…' }
  return { status: report.status === 'active' ? 'active' : 'available', usable: true, state: report.state }
}

export function useFeature(id: FeatureId): FeatureView & { pending: boolean } {
  const conn = useDevice((s) => s.connection.status)
  const report = useDevice((s) => s.features[id])
  const pending = useDevice((s) => Object.values(s.pending).some((p) => p.feature === id && p.status === 'pending'))
  usePrefs((s) => s.mode) // re-render when the mode changes the wording
  return { ...resolveFeature(id, conn, report), pending }
}

export function getFeature(id: FeatureId): FeatureView {
  const s = useDevice.getState()
  return resolveFeature(id, s.connection.status, s.features[id])
}

/** Convenience wrapper that surfaces failures to the user. Success is NOT announced; the device's own report is. */
export async function runCommand(feature: FeatureId, action: string, value?: JsonValue): Promise<CommandResult> {
  const res = await useDevice.getState().sendCommand(feature, action, value)
  if (!res.ok) toast({ tone: 'danger', title: `${FEATURES[feature].label}: command failed`, detail: res.error })
  return res
}

export { demoControls }
