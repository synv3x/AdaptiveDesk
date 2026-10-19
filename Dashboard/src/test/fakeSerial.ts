import type { SerialApiLike, SerialPortInfo, SerialPortLike } from '../services/webSerial'

/**
 * Test doubles for Web Serial. SIMULATED: they behave like the browser API (stream locks, errors on unplug,
 * port.close() rejecting while streams are locked) but there is no real hardware or browser involved.
 */

const dec = new TextDecoder()
const enc = new TextEncoder()

export class FakePort implements SerialPortLike {
  readable: ReadableStream<Uint8Array> | null = null
  writable: WritableStream<Uint8Array> | null = null
  openCalls = 0
  closeCalls = 0
  lastBaud = 0
  signals: { dataTerminalReady?: boolean; requestToSend?: boolean }[] = []
  written: string[] = []
  onWrite: ((text: string) => void) | null = null
  openError: Error | null = null
  private ctl: ReadableStreamDefaultController<Uint8Array> | null = null

  constructor(public info: SerialPortInfo = { usbVendorId: 0x1a86, usbProductId: 0x7523 }) {}

  getInfo() { return this.info }

  async open(o: { baudRate: number }) {
    if (this.openError) throw this.openError
    if (this.readable) throw new DOMException('The port is already open.', 'InvalidStateError')
    this.openCalls++
    this.lastBaud = o.baudRate
    this.newStreams()
  }

  private newStreams() {
    this.readable = new ReadableStream<Uint8Array>({ start: (c) => { this.ctl = c } })
    this.writable = new WritableStream<Uint8Array>({
      write: (chunk) => {
        const text = dec.decode(chunk)
        this.written.push(text)
        this.onWrite?.(text)
      },
    })
  }

  async close() {
    if (this.readable?.locked || this.writable?.locked) throw new TypeError('Cannot close a port while its streams are locked.')
    this.closeCalls++
    this.readable = null
    this.writable = null
    this.ctl = null
  }

  async setSignals(s: { dataTerminalReady?: boolean; requestToSend?: boolean }) { this.signals.push(s) }

  get isOpen() { return this.readable !== null }
  get locked() { return !!(this.readable?.locked || this.writable?.locked) }

  /** Bytes arriving from the ESP32. */
  push(data: string | Uint8Array) {
    try { this.ctl?.enqueue(typeof data === 'string' ? enc.encode(data) : data) } catch { /* stream already closed */ }
  }

  /** The cable is pulled: a fatal read error, and the port's streams disappear. */
  unplug() {
    const c = this.ctl
    this.readable = null
    this.writable = null
    this.ctl = null
    try { c?.error(new DOMException('The device has been lost.', 'NetworkError')) } catch { /* ignore */ }
  }

  /** A recoverable error (e.g. framing): the old stream errors but the port hands out a fresh readable. */
  softError() {
    const c = this.ctl
    this.readable = new ReadableStream<Uint8Array>({ start: (n) => { this.ctl = n } })
    try { c?.error(new DOMException('Framing error', 'FramingError')) } catch { /* ignore */ }
  }
}

export class FakeSerialApi implements SerialApiLike {
  ports: FakePort[] = []
  requestResult: FakePort | Error | null = null
  requestCalls: ({ filters?: SerialPortInfo[] } | undefined)[] = []
  private listeners: Record<string, Set<(e: Event) => void>> = { connect: new Set(), disconnect: new Set() }

  async requestPort(o?: { filters?: SerialPortInfo[] }) {
    this.requestCalls.push(o)
    const r = this.requestResult
    if (r instanceof Error) throw r
    if (!r) throw new DOMException('No port selected by the user.', 'NotFoundError')
    if (!this.ports.includes(r)) this.ports.push(r)
    return r
  }
  async getPorts() { return [...this.ports] }
  addEventListener(type: 'connect' | 'disconnect', fn: (e: Event) => void) { this.listeners[type].add(fn) }
  removeEventListener(type: 'connect' | 'disconnect', fn: (e: Event) => void) { this.listeners[type].delete(fn) }
  listenerCount(type: 'connect' | 'disconnect') { return this.listeners[type].size }

  emit(type: 'connect' | 'disconnect', port: FakePort) {
    const ev = new Event(type)
    Object.defineProperty(ev, 'target', { value: port })
    this.listeners[type].forEach((fn) => fn(ev))
  }
}

/** Minimal stand-in for the AdaptiveDesk firmware's serial behaviour (hello on first host line, pong, acks, telemetry). */
export class FakeFirmware {
  active = false
  received: Record<string, unknown>[] = []
  state = { color: '#00a0ff', thr: 40, slider: 63, fsr: 0 }
  constructor(private port: FakePort) {
    port.onWrite = (t) => t.split('\n').filter(Boolean).forEach((l) => this.onLine(l))
  }
  private features() {
    return {
      ambientLighting: { available: true, enabled: true, color: this.state.color, brightness: this.state.slider, brightnessSource: 'physical' },
      slideControl: { available: true, position: this.state.slider },
      pressureSensing: { available: true, value: this.state.fsr, pressed: this.state.fsr >= this.state.thr, threshold: this.state.thr },
    }
  }
  private say(o: unknown) { this.port.push(JSON.stringify(o) + '\n') }
  telemetry() { this.say({ protocolVersion: 1, type: 'telemetry', deviceId: 'adaptivedesk-main', features: this.features() }) }
  private onLine(l: string) {
    if (l[0] !== '{') return
    const m = JSON.parse(l) as Record<string, unknown>
    this.received.push(m)
    if (!this.active) {
      this.active = true
      this.port.push('[usb] hello debug line\n')
      this.say({ protocolVersion: 1, type: 'hello', deviceId: 'adaptivedesk-main', firmware: 'fake', features: this.features() })
    }
    if (m.type === 'ping') this.say({ protocolVersion: 1, type: 'pong', timestamp: m.timestamp })
    else if (m.type === 'requestState') this.telemetry()
    else if (m.type === 'command') {
      const ok = m.feature === 'ambientLighting' && m.action === 'setColor'
      if (ok) this.state.color = String(m.value)
      this.say({ protocolVersion: 1, type: 'ack', requestId: m.requestId, ok, ...(ok ? {} : { error: 'Unsupported command' }) })
      if (ok) this.telemetry()
    }
  }
}
