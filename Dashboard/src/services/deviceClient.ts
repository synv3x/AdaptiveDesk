import { encode, parseDeviceMessage, PROTOCOL_VERSION, type DeviceMessage, type HostMessage } from '../lib/protocol'
import { DemoTransport } from './demoDevice'
import { WebSerialTransport, type PortHint, type SerialPortLike } from './webSerial'
import type { DemoProfile } from '../store/prefs'

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error'

export interface TransportCallbacks {
  onOpen: () => void
  onMessage: (data: unknown) => void
  onClose: (reason: string) => void
  /** Non-protocol text from the device (firmware debug output). Optional. */
  onInfo?: (text: string) => void
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
  /** Called for every valid message from the device (including pongs), for statistics. */
  onRx: () => void
}

export type ConnectOptions =
  /** WebSocket: either the legacy local serial bridge or a Wi-Fi device. */
  | { kind: 'live'; url: string; flavor: 'bridge' | 'wifi'; heartbeatMs: number; refreshMs: number }
  /** Native Web Serial straight to the ESP32 over USB. */
  | { kind: 'serial'; port?: SerialPortLike | null; hint?: PortHint; heartbeatMs: number; refreshMs: number }
  | { kind: 'demo'; profile: DemoProfile; heartbeatMs: number; refreshMs: number }

const CONNECT_TIMEOUT_MS = 6000
const CONFIRM_TIMEOUT_MS = 8000 // after the socket opens, the device must actually say something
const BACKOFF_MS = [1000, 2000, 4000, 8000, 15000]

class WebSocketTransport implements Transport {
  private ws: WebSocket | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private done = false
  private opened = false
  constructor(private url: string, private flavor: 'bridge' | 'wifi', private cb: TransportCallbacks) {}

  open() {
    try {
      this.ws = new WebSocket(this.url)
    } catch (e) {
      this.finish(e instanceof Error ? e.message : 'Could not open connection')
      return
    }
    this.timer = setTimeout(() => this.finish(this.unreachable()), CONNECT_TIMEOUT_MS)
    this.ws.onopen = () => { clearTimeout(this.timer); this.opened = true; this.cb.onOpen() }
    this.ws.onmessage = (ev) => this.cb.onMessage(ev.data)
    this.ws.onerror = () => { /* onclose follows with details */ }
    this.ws.onclose = (ev) => this.finish(ev.reason || (this.opened ? 'Connection to the console was lost.' : this.unreachable()))
  }
  private unreachable() {
    return this.flavor === 'bridge'
      ? "Can't reach the USB bridge on this computer. Start it in a terminal: cd tools/serial-bridge, then npm start (plug in the ESP32 first)."
      : "Couldn't reach the console. Check its power, that it's on the same Wi-Fi as this computer, and that the address matches its Serial Monitor."
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
  /** True once the transport is open (commands may be written). 'connected' additionally requires the device to have spoken. */
  private transportOpen = false
  private confirmed = false
  private confirmTimer: ReturnType<typeof setTimeout> | undefined
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
    if (!this.transportOpen || !this.transport) return false
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
    this.transportOpen = false
    this.confirmed = false
    clearTimeout(this.confirmTimer)
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
      onInfo: guard((text) => this.h.onLog('sys', `esp32: ${text}`)),
    }
    if (opts.kind === 'demo') this.transport = new DemoTransport(opts.profile, cb)
    else if (opts.kind === 'serial') this.transport = new WebSerialTransport({ port: opts.port, hint: opts.hint }, cb)
    else this.transport = new WebSocketTransport(opts.url, opts.flavor, cb)
    this.h.onLog('sys', opts.kind === 'live' ? `Connecting to ${opts.url}` : opts.kind === 'serial' ? 'Opening USB serial port' : 'Starting demo device')
    this.transport.open()
  }

  private handleOpen(opts: ConnectOptions) {
    this.lastRx = Date.now()
    this.transportOpen = true
    this.confirmed = false
    this.h.onLog('sys', 'Link open, waiting for the device to answer')
    // A bridge or proxy can accept the socket while nothing is behind it, so 'connected' waits for a real device message.
    this.confirmTimer = setTimeout(() => {
      if (this.confirmed) return
      this.h.onLog('sys', 'Link opened but the device sent nothing')
      this.transport?.close()
      this.handleClose(opts.kind === 'serial'
        ? "The serial port opened, but the ESP32 isn't answering. Check that it's running the AdaptiveDesk firmware (press its EN button), and that the baud rate is 115200."
        : opts.kind === 'live' && opts.flavor === 'bridge'
          ? 'The USB bridge is running but the ESP32 is not answering. Check the cable and that the board has the AdaptiveDesk firmware.'
          : 'Connected, but the console did not answer.')
    }, CONFIRM_TIMEOUT_MS)
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
    this.h.onRx()
    if (!this.confirmed) {
      this.confirmed = true
      clearTimeout(this.confirmTimer)
      this.attempt = 0
      this.setStatus('connected')
      this.h.onLog('sys', 'Connected')
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
