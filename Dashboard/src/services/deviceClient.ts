import { encode, parseDeviceMessage, PROTOCOL_VERSION, type DeviceMessage, type HostMessage } from '../lib/protocol'
import { DemoTransport } from './demoDevice'
import type { DemoProfile } from '../store/prefs'

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error'

export interface TransportCallbacks {
  onOpen: () => void
  onMessage: (data: unknown) => void
  onClose: (reason: string) => void
}
export interface Transport {
  open(): void
  close(): void
  send(data: string): void
}

export interface ClientHandlers {
  onStatus: (s: ConnectionStatus, info: { error?: string; attempt: number; retryAt?: number }) => void
  onMessage: (msg: DeviceMessage) => void
  onLog: (dir: 'tx' | 'rx' | 'sys', text: string) => void
  onLatency: (ms: number) => void
}

export type ConnectOptions =
  | { kind: 'live'; url: string; heartbeatMs: number; refreshMs: number }
  | { kind: 'demo'; profile: DemoProfile; heartbeatMs: number; refreshMs: number }

const CONNECT_TIMEOUT_MS = 6000
const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000]

class WebSocketTransport implements Transport {
  private ws: WebSocket | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private done = false
  constructor(private url: string, private cb: TransportCallbacks) {}

  open() {
    try {
      this.ws = new WebSocket(this.url)
    } catch (e) {
      this.finish(e instanceof Error ? e.message : 'Could not open connection')
      return
    }
    this.timer = setTimeout(() => this.finish('Connection timed out'), CONNECT_TIMEOUT_MS)
    this.ws.onopen = () => { clearTimeout(this.timer); this.cb.onOpen() }
    this.ws.onmessage = (ev) => this.cb.onMessage(ev.data)
    this.ws.onerror = () => { /* onclose follows with details */ }
    this.ws.onclose = (ev) => this.finish(ev.reason || (ev.wasClean ? 'Connection closed' : 'Device unreachable'))
  }
  private finish(reason: string) {
    if (this.done) return
    this.done = true
    clearTimeout(this.timer)
    this.detach()
    this.cb.onClose(reason)
  }
  private detach() {
    if (!this.ws) return
    this.ws.onopen = this.ws.onmessage = this.ws.onerror = this.ws.onclose = null
    try { this.ws.close() } catch { /* ignore */ }
    this.ws = null
  }
  close() {
    this.done = true
    clearTimeout(this.timer)
    this.detach()
  }
  send(data: string) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(data)
  }
}

/**
 * Connection manager: reconnect with backoff, heartbeat watchdog, malformed-message handling.
 * It knows nothing about stores or UI; it reports through ClientHandlers.
 */
export class DeviceClient {
  private transport: Transport | null = null
  private opts: ConnectOptions | null = null
  private status: ConnectionStatus = 'idle'
  private attempt = 0
  private lastRx = 0
  private heartbeat: ReturnType<typeof setInterval> | undefined
  private refresh: ReturnType<typeof setInterval> | undefined
  private retry: ReturnType<typeof setTimeout> | undefined
  private generation = 0

  constructor(private h: ClientHandlers) {}

  connect(opts: ConnectOptions) {
    this.disconnect()
    this.opts = opts
    this.attempt = 0
    this.openTransport()
  }

  disconnect() {
    this.generation++
    this.opts = null
    this.teardown()
    clearTimeout(this.retry)
    this.setStatus('idle')
  }

  isConnected() { return this.status === 'connected' }

  send(msg: HostMessage): boolean {
    if (this.status !== 'connected' || !this.transport) return false
    const raw = encode(msg)
    this.h.onLog('tx', raw)
    this.transport.send(raw)
    return true
  }

  private setStatus(s: ConnectionStatus, extra: { error?: string; retryAt?: number } = {}) {
    this.status = s
    this.h.onStatus(s, { attempt: this.attempt, ...extra })
  }

  private teardown() {
    clearInterval(this.heartbeat)
    clearInterval(this.refresh)
    this.transport?.close()
    this.transport = null
  }

  private openTransport() {
    const opts = this.opts
    if (!opts) return
    const gen = this.generation
    this.setStatus(this.attempt === 0 ? 'connecting' : 'reconnecting')
    const guard = <A extends unknown[]>(fn: (...a: A) => void) => (...a: A) => { if (gen === this.generation) fn(...a) }
    const cb: TransportCallbacks = {
      onOpen: guard(() => this.handleOpen(opts)),
      onMessage: guard((d) => this.handleMessage(d)),
      onClose: guard((reason) => this.handleClose(reason)),
    }
    this.transport = opts.kind === 'demo' ? new DemoTransport(opts.profile, cb) : new WebSocketTransport(opts.url, cb)
    this.h.onLog('sys', opts.kind === 'live' ? `Connecting to ${opts.url}` : 'Starting demo device')
    this.transport.open()
  }

  private handleOpen(opts: ConnectOptions) {
    this.attempt = 0
    this.lastRx = Date.now()
    this.setStatus('connected')
    this.h.onLog('sys', 'Connected')
    this.send({ protocolVersion: PROTOCOL_VERSION, type: 'requestState' })
    const staleMs = Math.max(opts.heartbeatMs * 3, 6000)
    this.heartbeat = setInterval(() => {
      if (Date.now() - this.lastRx > staleMs) {
        this.h.onLog('sys', 'Heartbeat timeout')
        this.transport?.close()
        this.handleClose('Device stopped responding')
        return
      }
      this.send({ protocolVersion: PROTOCOL_VERSION, type: 'ping', timestamp: Date.now() })
    }, opts.heartbeatMs)
    if (opts.refreshMs > 0) {
      this.refresh = setInterval(() => this.send({ protocolVersion: PROTOCOL_VERSION, type: 'requestState' }), opts.refreshMs)
    }
  }

  private handleMessage(data: unknown) {
    this.lastRx = Date.now()
    if (typeof data === 'string') this.h.onLog('rx', data.slice(0, 2000))
    const res = parseDeviceMessage(data)
    if (!res.ok) {
      this.h.onLog('sys', `Rejected message: ${res.error}`)
      return
    }
    if (res.msg.type === 'pong') {
      if (res.msg.timestamp) this.h.onLatency(Math.max(0, Date.now() - res.msg.timestamp))
      return
    }
    this.h.onMessage(res.msg)
  }

  private handleClose(reason: string) {
    if (!this.opts) return
    this.teardown()
    this.generation++ // ignore anything still in flight from the old transport
    this.h.onLog('sys', `Disconnected: ${reason}`)
    const delay = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)]
    this.attempt++
    this.setStatus('reconnecting', { error: reason, retryAt: Date.now() + delay })
    clearTimeout(this.retry)
    this.retry = setTimeout(() => this.openTransport(), delay)
  }
}
