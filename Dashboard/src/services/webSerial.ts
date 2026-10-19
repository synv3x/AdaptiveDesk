import type { Transport, TransportCallbacks } from './deviceClient'

/**
 * Native Web Serial transport: the browser talks to the ESP32 over USB, no bridge program needed.
 * Wire format is the same newline-delimited JSON the bridge relayed ('{' lines are protocol,
 * anything else is firmware debug text).
 *
 * Types are declared locally so the project doesn't depend on Web Serial typings, and so tests can
 * inject a fake `navigator.serial`.
 */

export const SERIAL_BAUD = 115200
/** The firmware only streams while the host keeps talking (it pauses after 4 s of silence), so we ping every second. */
export const KEEPALIVE_MS = 1000
const MAX_LINE = 8192
const MAX_OUT = 500 // the firmware ignores lines longer than 512 bytes
const TEARDOWN_STEP_MS = 1500

export interface SerialPortInfo { usbVendorId?: number; usbProductId?: number }
export interface SerialPortLike {
  readable: ReadableStream<Uint8Array> | null
  writable: WritableStream<Uint8Array> | null
  open(o: { baudRate: number; bufferSize?: number }): Promise<void>
  close(): Promise<void>
  getInfo(): SerialPortInfo
  setSignals?(s: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void>
}
export interface SerialApiLike {
  requestPort(o?: { filters?: SerialPortInfo[] }): Promise<SerialPortLike>
  getPorts(): Promise<SerialPortLike[]>
  addEventListener(type: 'connect' | 'disconnect', fn: (e: Event) => void): void
  removeEventListener(type: 'connect' | 'disconnect', fn: (e: Event) => void): void
}
export interface PortHint { vid?: number; pid?: number }

/** USB-serial chips found on ESP32 boards: CH340, CH9102, CP210x, FTDI, native ESP32-S3 USB. */
export const ESP32_USB_FILTERS: SerialPortInfo[] = [
  { usbVendorId: 0x1a86, usbProductId: 0x7523 },
  { usbVendorId: 0x1a86, usbProductId: 0x55d4 },
  { usbVendorId: 0x10c4, usbProductId: 0xea60 },
  { usbVendorId: 0x0403, usbProductId: 0x6001 },
  { usbVendorId: 0x303a },
]

export function getSerialApi(): SerialApiLike | null {
  const nav = (globalThis as { navigator?: { serial?: SerialApiLike } }).navigator
  return nav?.serial ?? null
}

export const webSerialSupported = () => getSerialApi() !== null

/** Human explanation for why Web Serial can't be used here, or null when it can. */
export function unsupportedReason(): string | null {
  if (getSerialApi()) return null
  if ((globalThis as { isSecureContext?: boolean }).isSecureContext === false)
    return 'Web Serial only works on a secure page. Open the dashboard at http://localhost:5173 (npm run dev) or over HTTPS.'
  return "This browser doesn't support Web Serial. Use Chrome or Edge. In Brave, open brave://flags/#brave-web-serial-api, set it to Enabled, relaunch Brave, then reload this page."
}

export const describePort = (hint: PortHint) =>
  hint.vid === undefined ? 'unknown device' : `${hint.vid.toString(16).toUpperCase().padStart(4, '0')}:${(hint.pid ?? 0).toString(16).toUpperCase().padStart(4, '0')}`

const errName = (e: unknown) => (e as { name?: string } | null)?.name ?? ''
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function describeOpenError(e: unknown): string {
  switch (errName(e)) {
    case 'NetworkError':
      return "Couldn't open the serial port. Another program is probably using it: close PlatformIO Serial Monitor, Arduino IDE, the old serial bridge, or another browser tab. Also check the USB cable."
    case 'InvalidStateError':
      return 'The serial port is already open somewhere else (another tab or window). Close it and try again.'
    case 'SecurityError':
    case 'NotAllowedError':
      return 'The browser blocked access to the serial port. Click Connect ESP32 again and allow it.'
    case 'NotFoundError':
      return 'The ESP32 was not found. Plug it in and click Connect ESP32.'
    default:
      return `Couldn't open the serial port: ${errText(e)}`
  }
}

export const NOT_FOUND_MESSAGE = 'No authorized ESP32 found. Plug it in and click Connect ESP32 to choose its port.'
export const UNPLUGGED_MESSAGE = 'The ESP32 was unplugged or the USB connection was lost. Plug it back in; the dashboard reconnects automatically.'

/** Ask the user to pick a port. MUST be called directly from a click handler. Returns null if the dialog was cancelled. */
export async function requestSerialPort(opts: { all?: boolean } = {}): Promise<SerialPortLike | null> {
  const api = getSerialApi()
  if (!api) throw new Error(unsupportedReason() ?? 'Web Serial is not available.')
  try {
    return await api.requestPort(opts.all ? {} : { filters: ESP32_USB_FILTERS })
  } catch (e) {
    if (errName(e) === 'NotFoundError') return null // user closed the chooser (or nothing matched the filter)
    throw e
  }
}

/** Find a previously authorized port without any user gesture. */
export async function findAuthorizedPort(api: SerialApiLike, hint?: PortHint, preferred?: SerialPortLike | null): Promise<SerialPortLike | null> {
  const ports = await api.getPorts()
  if (preferred && ports.includes(preferred)) return preferred
  if (hint?.vid !== undefined) {
    return ports.find((p) => {
      const i = p.getInfo()
      return i.usbVendorId === hint.vid && (hint.pid === undefined || i.usbProductId === hint.pid)
    }) ?? null // never grab an unrelated device when we know which one we want
  }
  return ports.length === 1 ? ports[0] : null
}

const settle = <T>(p: Promise<T>, ms = TEARDOWN_STEP_MS) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms)
    p.then(() => { clearTimeout(t); resolve() }, () => { clearTimeout(t); resolve() })
  })

// A port can't be reopened until the previous owner released its stream locks and closed it.
const teardowns = new WeakMap<object, Promise<void>>()

export interface WebSerialOptions {
  port?: SerialPortLike | null
  hint?: PortHint
  baudRate?: number
  keepaliveMs?: number
  /** Injectable for tests; defaults to navigator.serial. */
  serial?: SerialApiLike | null
}

export class WebSerialTransport implements Transport {
  private api: SerialApiLike | null
  private port: SerialPortLike | null = null
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null
  private readDone: Promise<void> = Promise.resolve()
  private writeChain: Promise<void> = Promise.resolve()
  private keepalive: ReturnType<typeof setInterval> | undefined
  private buffer = ''
  private ended = false // set by close() or by an unexpected end; after that no more callbacks
  private onDisconnect: ((e: Event) => void) | null = null
  private encoder = new TextEncoder()

  constructor(private o: WebSerialOptions, private cb: TransportCallbacks) {
    this.api = o.serial !== undefined ? o.serial : getSerialApi()
  }

  open() { void this.run() }

  /** Intentional close: silent (no onClose), releases reader/writer locks and the port. */
  close() {
    if (this.ended) return
    this.ended = true
    this.stopKeepalive()
    this.unlisten()
    void this.teardown()
  }

  send(data: string) {
    const w = this.writer
    if (this.ended || !w) return
    const line = data.replace(/[\r\n]+/g, ' ')
    if (line.length > MAX_OUT) return
    const bytes = this.encoder.encode(line + '\n')
    this.writeChain = this.writeChain.then(() => w.write(bytes)).catch((e) => {
      this.finish(`Couldn't write to the ESP32 (${errText(e)}). ${UNPLUGGED_MESSAGE}`)
    })
  }

  // ---------------------------------------------------------------- internals

  private async run() {
    const api = this.api
    if (!api) return this.finish(unsupportedReason() ?? 'Web Serial is not available.')
    let port: SerialPortLike | null
    try {
      port = await findAuthorizedPort(api, this.o.hint, this.o.port)
    } catch (e) {
      return this.finish(describeOpenError(e))
    }
    if (this.ended) return
    if (!port) return this.finish(NOT_FOUND_MESSAGE)
    this.port = port

    await settle(teardowns.get(port) ?? Promise.resolve(), 4000)
    if (this.ended) return

    try {
      await this.openPort(port)
    } catch (e) {
      if (this.ended) { await this.teardown(); return }
      return this.finish(describeOpenError(e))
    }
    if (this.ended) { await this.teardown(); return } // closed while the port was still opening

    this.onDisconnect = (e) => {
      const t = (e as { target?: unknown; port?: unknown }).target ?? (e as { port?: unknown }).port
      if (t === port) this.finish(UNPLUGGED_MESSAGE)
    }
    api.addEventListener('disconnect', this.onDisconnect)

    this.cb.onOpen()
    this.sendKeepalive()
    this.keepalive = setInterval(() => this.sendKeepalive(), this.o.keepaliveMs ?? KEEPALIVE_MS)
    this.readDone = this.readLoop(port)
  }

  private async openPort(port: SerialPortLike) {
    const opts = { baudRate: this.o.baudRate ?? SERIAL_BAUD, bufferSize: 4096 }
    try {
      await port.open(opts)
    } catch (e) {
      if (errName(e) !== 'InvalidStateError') throw e
      // Already open (e.g. left open by a previous page session): release it and try once more.
      try { await port.close() } catch { /* still locked elsewhere */ }
      await port.open(opts)
    }
    // Keep DTR/RTS low so opening the port doesn't hold the ESP32 in reset or the bootloader.
    try { await port.setSignals?.({ dataTerminalReady: false, requestToSend: false }) } catch { /* not supported by this adapter */ }
    if (!port.readable || !port.writable) throw new Error('The port opened without usable streams.')
    this.writer = port.writable.getWriter()
  }

  private sendKeepalive() {
    this.send(JSON.stringify({ protocolVersion: 1, type: 'ping', timestamp: Date.now() }))
  }

  private async readLoop(port: SerialPortLike) {
    const decoder = new TextDecoder('utf-8', { fatal: false })
    let errorsInARow = 0
    let reason = UNPLUGGED_MESSAGE
    outer: while (!this.ended && port.readable) {
      const reader = port.readable.getReader()
      this.reader = reader
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break outer // stream closed: the device is gone
          if (value && value.length) { errorsInARow = 0; this.onText(decoder.decode(value, { stream: true })) }
        }
      } catch (e) {
        // Fatal errors (device lost) null out port.readable and end the loop. Non-fatal ones (framing, buffer
        // overrun) leave a fresh readable behind, so we simply keep reading.
        if (this.ended) break
        if (++errorsInARow > 5) { reason = `Serial read keeps failing: ${errText(e)}`; break }
      } finally {
        try { reader.releaseLock() } catch { /* already released */ }
        if (this.reader === reader) this.reader = null
      }
    }
    if (!this.ended) this.finish(reason)
  }

  /** Buffer partial lines, handle several lines per chunk, forward protocol lines, surface debug lines. */
  private onText(text: string) {
    this.buffer += text
    let i: number
    while ((i = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, i).replace(/\r$/, '').trim()
      this.buffer = this.buffer.slice(i + 1)
      if (line) this.onLine(line)
    }
    if (this.buffer.length > MAX_LINE) this.buffer = '' // runaway data without a newline
  }

  private onLine(line: string) {
    if (line[0] === '{') return this.cb.onMessage(line)
    // Boot noise from the ROM bootloader can glue a few junk characters in front of a real line.
    const k = line.indexOf('{"protocolVersion"')
    if (k > 0 && k <= 8 && line.endsWith('}')) return this.cb.onMessage(line.slice(k))
    this.cb.onInfo?.(line.slice(0, 200))
  }

  private finish(reason: string) {
    if (this.ended) return
    this.ended = true
    this.stopKeepalive()
    this.unlisten()
    void this.teardown()
    this.cb.onClose(reason)
  }

  private stopKeepalive() {
    clearInterval(this.keepalive)
    this.keepalive = undefined
  }

  private unlisten() {
    if (this.onDisconnect) this.api?.removeEventListener('disconnect', this.onDisconnect)
    this.onDisconnect = null
  }

  /** Cancel the reader, wait for the read loop, close the writer, release locks, close the port. Safe to call repeatedly. */
  private teardown(): Promise<void> {
    const port = this.port
    if (!port) return Promise.resolve()
    const next = (teardowns.get(port) ?? Promise.resolve()).then(async () => {
      const reader = this.reader
      const writer = this.writer
      if (reader) await settle(reader.cancel())
      await settle(this.readDone)
      await settle(this.writeChain)
      if (writer) {
        await settle(writer.close())
        try { writer.releaseLock() } catch { /* already released */ }
        if (this.writer === writer) this.writer = null
      }
      await settle(port.close())
    })
    teardowns.set(port, next)
    return next
  }
}
