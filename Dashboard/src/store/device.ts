import { create } from 'zustand'
import { emit } from '../lib/bus'
import { FEATURES, validateCommand, type FeatureId } from '../lib/features'
import { PROTOCOL_VERSION, type DeviceMessage, type FeatureReport, type JsonValue, type SystemInfo } from '../lib/protocol'
import { DeviceClient, type ConnectionStatus } from '../services/deviceClient'
import { demoControls } from '../services/demoDevice'
import { findAuthorizedPort, getSerialApi, requestSerialPort, unsupportedReason, type SerialPortLike } from '../services/webSerial'
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
  connection: { status: ConnectionStatus; error?: string; attempt: number; retryAt?: number; connectedAt?: number; lastSeen?: number; latencyMs?: number; messageCount: number }
  identity: { deviceId?: string; name?: string; firmware?: string; board?: string }
  /** Last state REPORTED by the device. Never written from user input or local preferences. */
  features: Partial<Record<FeatureId, FeatureReport>>
  system?: SystemInfo
  pending: Record<string, PendingCommand>
  log: LogEntry[]

  applyMode: () => void
  /** Wi-Fi / legacy bridge (WebSocket) connect. */
  connectLive: () => void
  /** Start a Web Serial connection on an already-chosen port (or the remembered authorized one). */
  connectSerial: (port?: SerialPortLike | null) => void
  /** Show the browser's port chooser, then connect. Must be called straight from a click handler. */
  pickAndConnectSerial: (opts?: { all?: boolean }) => Promise<void>
  /** Reconnect to the remembered authorized port (used when the ESP32 is plugged back in). */
  autoReconnectSerial: () => void
  /** User pressed Disconnect: closes the link and suppresses serial auto-reconnect until they connect again. */
  disconnect: () => void
  /** App teardown (not a user decision): closes the link without touching the auto-reconnect preference. */
  shutdown: () => void
  sendCommand: (feature: FeatureId, action: string, value?: JsonValue) => Promise<CommandResult>
}

const COMMAND_TIMEOUT_MS = 5000
const resolvers = new Map<string, (r: CommandResult) => void>()
let cmdSeq = 0
let baseline = false
/** Bumped on every connect/disconnect decision so late async results (getPorts) can't revive a stale connection. */
let connectSeq = 0
/** True after the user pressed Disconnect: don't auto-reconnect serial until they connect again. */
let userDisconnected = false

/** WebSocket URL for the legacy bridge or Wi-Fi. Native Web Serial has no URL (returns null). */
export function liveUrl(): string | null {
  const { transport, bridgePort, host, port, path } = usePrefs.getState().device
  if (transport === 'serial') return null
  if (transport === 'bridge') {
    // The legacy bridge only listens on this computer's loopback address.
    return Number.isInteger(bridgePort) && bridgePort >= 1024 && bridgePort <= 65535 ? `ws://127.0.0.1:${bridgePort}/ws` : null
  }
  const h = host.trim()
  if (!/^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(h)) return null
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null
  if (!/^\/[A-Za-z0-9/_-]*$/.test(path)) return null
  return `ws://${h}:${port}${path}`
}

/** Browsers block ws:// from an https:// page, so say so plainly instead of failing mysteriously. */
export function liveBlockedReason(): string | null {
  // Web Serial and ws://127.0.0.1 (the legacy bridge) are treated as secure by browsers; only Wi-Fi devices are blocked.
  if (usePrefs.getState().device.transport !== 'wifi') return null
  if (typeof location !== 'undefined' && location.protocol === 'https:')
    return 'This page is served over HTTPS, and browsers block connections to a local ws:// device from it. Open the dashboard locally with "npm run dev" (http://localhost:5173) to use Live Mode.'
  return null
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
          messageCount: status === 'connecting' ? 0 : prev.messageCount,
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
    onRx: () => set((s) => ({ connection: { ...s.connection, lastSeen: Date.now(), messageCount: s.connection.messageCount + 1 } })),
    onMessage: (msg) => handleMessage(msg),
  })

  const handleMessage = (msg: DeviceMessage) => {
    switch (msg.type) {
      case 'hello':
        set({ identity: { deviceId: msg.deviceId, name: msg.name, firmware: msg.firmware, board: msg.board }, features: msg.features, system: msg.system })
        baseline = true
        break
      case 'telemetry': {
        const prev = get().features
        const merged = { ...prev }
        for (const id of Object.keys(msg.features) as FeatureId[]) {
          const next = msg.features[id]!
          if (!prev[id] || JSON.stringify(prev[id]) !== JSON.stringify(next)) merged[id] = next
        }
        set({ features: merged, system: msg.system ?? get().system })
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
    connection: { status: 'idle', attempt: 0, messageCount: 0 },
    identity: {},
    features: {},
    pending: {},
    log: [],

    applyMode: () => {
      const { mode, demoProfile, heartbeatSec, refreshSec, device } = usePrefs.getState()
      const common = { heartbeatMs: heartbeatSec * 1000, refreshMs: refreshSec * 1000 }
      const seq = ++connectSeq
      set({ features: {}, system: undefined, identity: {}, pending: {} })
      if (mode === 'demo') {
        userDisconnected = false
        client.connect({ kind: 'demo', profile: demoProfile, ...common })
        return
      }
      if (device.transport === 'serial') {
        // Native Web Serial never touches WebSockets. Reconnect silently to an already-authorized ESP32 if there is one.
        const reason = unsupportedReason()
        if (reason) {
          client.disconnect()
          set((s) => ({ connection: { ...s.connection, status: 'error', attempt: 0, error: reason } }))
          return
        }
        if (device.autoConnect && !userDisconnected) void autoConnectSerial(seq)
        else client.disconnect()
        return
      }
      const url = liveUrl()
      const blocked = liveBlockedReason()
      if (blocked && device.autoConnect && url) {
        client.disconnect()
        set((s) => ({ connection: { ...s.connection, status: 'error', attempt: 0, error: blocked } }))
        return
      }
      if (device.autoConnect && url) client.connect({ kind: 'live', url, flavor: device.transport, ...common })
      else client.disconnect()
    },

    connectLive: () => {
      const { heartbeatSec, refreshSec, device } = usePrefs.getState()
      connectSeq++
      if (device.transport === 'serial') return get().connectSerial()
      const url = liveUrl()
      if (!url) {
        set((s) => ({ connection: { ...s.connection, status: 'error', attempt: 0, error: device.transport === 'bridge' ? 'Enter a valid bridge port (1024-65535).' : 'Enter a valid device address (hostname or IP), port and path.' } }))
        return
      }
      const blocked = liveBlockedReason()
      if (blocked) {
        set((s) => ({ connection: { ...s.connection, status: 'error', attempt: 0, error: blocked } }))
        return
      }
      client.connect({ kind: 'live', url, flavor: device.transport, heartbeatMs: heartbeatSec * 1000, refreshMs: refreshSec * 1000 })
    },

    connectSerial: (port) => {
      const { heartbeatSec, refreshSec, device } = usePrefs.getState()
      connectSeq++
      userDisconnected = false
      const reason = unsupportedReason()
      if (reason) {
        set((s) => ({ connection: { ...s.connection, status: 'error', attempt: 0, error: reason } }))
        return
      }
      set({ features: {}, system: undefined, identity: {}, pending: {} })
      client.connect({ kind: 'serial', port, hint: { vid: device.serialVid, pid: device.serialPid }, heartbeatMs: heartbeatSec * 1000, refreshMs: refreshSec * 1000 })
    },

    pickAndConnectSerial: async (opts) => {
      // requestPort() needs a user gesture, so it is the first thing that happens, before any other await.
      let port: SerialPortLike | null
      try {
        port = await requestSerialPort({ all: opts?.all })
      } catch (e) {
        set((s) => ({ connection: { ...s.connection, status: 'error', attempt: 0, error: e instanceof Error ? e.message : String(e) } }))
        return
      }
      if (!port) return // chooser cancelled: not an error
      const info = port.getInfo()
      const cur = usePrefs.getState().device
      usePrefs.getState().set({ device: { ...cur, serialVid: info.usbVendorId, serialPid: info.usbProductId } })
      get().connectSerial(port)
    },

    autoReconnectSerial: () => {
      const { mode, device } = usePrefs.getState()
      const st = get().connection.status
      if (mode !== 'live' || device.transport !== 'serial' || !device.autoConnect || userDisconnected) return
      if (st === 'connected' || st === 'connecting') return
      void autoConnectSerial(++connectSeq)
    },

    disconnect: () => {
      connectSeq++
      userDisconnected = true
      client.disconnect()
    },

    shutdown: () => {
      connectSeq++
      client.disconnect()
    },

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

  /** Reconnect to an already-authorized port without a user gesture. Quietly idles if there isn't one yet. */
  async function autoConnectSerial(seq: number) {
    const api = getSerialApi()
    if (!api) return
    const { device, heartbeatSec, refreshSec } = usePrefs.getState()
    let port: SerialPortLike | null = null
    try { port = await findAuthorizedPort(api, { vid: device.serialVid, pid: device.serialPid }) } catch { port = null }
    if (seq !== connectSeq) return // superseded by a newer connect/disconnect
    if (!port) { client.disconnect(); return }
    client.connect({ kind: 'serial', port, hint: { vid: device.serialVid, pid: device.serialPid }, heartbeatMs: heartbeatSec * 1000, refreshMs: refreshSec * 1000 })
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
      if (id === 'pressureSensing' && a.state.pressed !== b.state.pressed && typeof b.state.pressed === 'boolean') {
        logActivity({ category: 'device', title: b.state.pressed ? 'Pressure threshold crossed' : 'Pressure released', tone: b.state.pressed ? 'warn' : 'neutral' })
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
