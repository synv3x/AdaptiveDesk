import { afterEach, describe, expect, it, vi } from 'vitest'
import { FakePort, FakeSerialApi } from '../test/fakeSerial'
import {
  ESP32_USB_FILTERS, NOT_FOUND_MESSAGE, UNPLUGGED_MESSAGE, WebSerialTransport, describeOpenError,
  findAuthorizedPort, requestSerialPort, unsupportedReason, type WebSerialOptions,
} from './webSerial'

afterEach(() => vi.unstubAllGlobals())

function setup(opts: Partial<WebSerialOptions> = {}) {
  const api = new FakeSerialApi()
  const port = new FakePort()
  api.ports.push(port)
  const ev = { opens: 0, msgs: [] as string[], info: [] as string[], closes: [] as string[] }
  const t = new WebSerialTransport({ port, serial: api, keepaliveMs: 20, ...opts }, {
    onOpen: () => { ev.opens++ },
    onMessage: (d) => ev.msgs.push(String(d)),
    onClose: (r) => ev.closes.push(r),
    onInfo: (x) => ev.info.push(x),
  })
  return { api, port, t, ev }
}
const opened = async (s: ReturnType<typeof setup>) => { s.t.open(); await vi.waitFor(() => expect(s.ev.opens).toBe(1)) }
const parse = (lines: string[]) => lines.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>)

describe('WebSerialTransport: opening', () => {
  it('opens at 115200, keeps DTR/RTS low, reports open once and pings immediately', async () => {
    const s = setup()
    await opened(s)
    expect(s.port.lastBaud).toBe(115200)
    expect(s.port.signals[0]).toEqual({ dataTerminalReady: false, requestToSend: false })
    await vi.waitFor(() => expect(s.port.written.length).toBeGreaterThan(0))
    const first = parse(s.port.written)[0]
    expect(first).toMatchObject({ protocolVersion: 1, type: 'ping' })
    expect(typeof first.timestamp).toBe('number')
    s.t.close()
  })

  it('keeps pinging so the firmware keeps streaming', async () => {
    const s = setup()
    await opened(s)
    await vi.waitFor(() => expect(parse(s.port.written).filter((m) => m.type === 'ping').length).toBeGreaterThanOrEqual(4))
    s.t.close()
  })

  it('recovers when the port was left open (InvalidStateError)', async () => {
    const s = setup()
    await s.port.open({ baudRate: 9600 }) // stale open from a previous page session
    await opened(s)
    expect(s.port.openCalls).toBe(2)
    expect(s.port.closeCalls).toBe(1)
    s.t.close()
  })

  it.each([
    ['NetworkError', /Serial Monitor/],
    ['InvalidStateError', /already open/],
    ['SecurityError', /blocked/],
  ])('explains %s clearly', async (name, expected) => {
    const s = setup()
    s.port.openError = new DOMException('boom', name)
    s.t.open()
    await vi.waitFor(() => expect(s.ev.closes.length).toBe(1))
    expect(s.ev.closes[0]).toMatch(expected)
    expect(s.ev.opens).toBe(0)
  })

  it('reports when no authorized port exists', async () => {
    const s = setup({ port: null })
    s.api.ports.length = 0
    s.t.open()
    await vi.waitFor(() => expect(s.ev.closes).toEqual([NOT_FOUND_MESSAGE]))
  })

  it('reports an unsupported browser', async () => {
    const s = setup({ serial: null })
    s.t.open()
    await vi.waitFor(() => expect(s.ev.closes.length).toBe(1))
    expect(s.ev.closes[0]).toMatch(/Web Serial/)
  })
})

describe('WebSerialTransport: reading', () => {
  it('buffers partial lines, handles several lines per read and CRLF, and separates debug text', async () => {
    const s = setup()
    await opened(s)
    s.port.push('{"a":1}\n{"b":')
    s.port.push('2}\r\n[boot] hello\n{"c":3}\n')
    await vi.waitFor(() => expect(s.ev.msgs).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']))
    expect(s.ev.info).toEqual(['[boot] hello'])
    s.t.close()
  })

  it('reassembles multi-byte characters split across reads', async () => {
    const s = setup()
    await opened(s)
    s.port.push(new Uint8Array([...new TextEncoder().encode('[usb] caf'), 0xc3]))
    s.port.push(new Uint8Array([0xa9, 0x0a]))
    await vi.waitFor(() => expect(s.ev.info).toEqual(['[usb] café']))
    s.t.close()
  })

  it('ignores blank lines and tolerates junk glued in front of a protocol line', async () => {
    const s = setup()
    await opened(s)
    s.port.push('\n\r\nÿþ{"protocolVersion":1,"type":"pong"}\n')
    await vi.waitFor(() => expect(s.ev.msgs).toEqual(['{"protocolVersion":1,"type":"pong"}']))
    s.t.close()
  })

  it('drops a runaway line without a newline instead of growing forever', async () => {
    const s = setup()
    await opened(s)
    s.port.push('x'.repeat(9000))
    s.port.push('\n{"ok":true}\n')
    await vi.waitFor(() => expect(s.ev.msgs).toEqual(['{"ok":true}']))
    s.t.close()
  })

  it('keeps reading after a recoverable stream error', async () => {
    const s = setup()
    await opened(s)
    s.port.softError()
    await new Promise((r) => setTimeout(r, 20))
    s.port.push('{"after":1}\n')
    await vi.waitFor(() => expect(s.ev.msgs).toEqual(['{"after":1}']))
    expect(s.ev.closes).toEqual([])
    s.t.close()
  })
})

describe('WebSerialTransport: writing', () => {
  it('writes one JSON object per line and never lets a message contain a newline', async () => {
    const s = setup({ keepaliveMs: 100000 })
    await opened(s)
    s.port.written.length = 0
    s.t.send('{"protocolVersion":1,"type":"command","requestId":"x\n{evil}"}')
    await vi.waitFor(() => expect(s.port.written.length).toBe(1))
    const text = s.port.written.join('')
    expect(text.endsWith('\n')).toBe(true)
    expect(text.slice(0, -1)).not.toContain('\n')
    s.t.close()
  })

  it('drops lines the firmware would reject (over 500 bytes)', async () => {
    const s = setup({ keepaliveMs: 100000 })
    await opened(s)
    await vi.waitFor(() => expect(s.port.written.length).toBe(1)) // the opening ping
    s.t.send('{"x":"' + 'a'.repeat(600) + '"}')
    await new Promise((r) => setTimeout(r, 30))
    expect(s.port.written.length).toBe(1)
    s.t.close()
  })

  it('is a no-op before the port is open', () => {
    const s = setup()
    expect(() => s.t.send('{}')).not.toThrow()
    expect(s.port.written).toEqual([])
  })
})

describe('WebSerialTransport: closing and unplugging', () => {
  it('close() is silent, cancels the reader, releases every lock, closes the port once and stops pinging', async () => {
    const s = setup()
    await opened(s)
    s.t.close()
    await vi.waitFor(() => expect(s.port.closeCalls).toBe(1))
    expect(s.port.isOpen).toBe(false)
    expect(s.port.locked).toBe(false)
    const n = s.port.written.length
    await new Promise((r) => setTimeout(r, 80))
    expect(s.port.written.length).toBe(n) // keep-alive stopped
    expect(s.ev.closes).toEqual([]) // intentional close does not report a disconnect
    s.t.close() // idempotent
    expect(s.port.closeCalls).toBe(1)
  })

  it('close() while the port is still opening still ends with the port closed', async () => {
    const s = setup()
    s.t.open()
    s.t.close()
    await vi.waitFor(() => expect(s.port.openCalls === 0 || s.port.closeCalls >= 1).toBe(true))
    await new Promise((r) => setTimeout(r, 50))
    expect(s.port.isOpen).toBe(false)
    expect(s.port.locked).toBe(false)
    expect(s.ev.opens).toBe(0)
  })

  it('a new transport can reopen the same port straight after close()', async () => {
    const a = setup()
    await opened(a)
    a.t.close()
    const ev2 = { opens: 0, closes: [] as string[] }
    const t2 = new WebSerialTransport({ port: a.port, serial: a.api, keepaliveMs: 20 }, { onOpen: () => { ev2.opens++ }, onMessage: () => {}, onClose: (r) => ev2.closes.push(r) })
    t2.open()
    await vi.waitFor(() => expect(ev2.opens).toBe(1))
    expect(ev2.closes).toEqual([])
    expect(a.port.openCalls).toBe(2)
    t2.close()
  })

  it('unplugging reports one clear close, releases locks and stops all activity', async () => {
    const s = setup()
    await opened(s)
    s.port.unplug()
    await vi.waitFor(() => expect(s.ev.closes).toEqual([UNPLUGGED_MESSAGE]))
    await vi.waitFor(() => expect(s.port.closeCalls).toBe(1))
    expect(s.port.locked).toBe(false)
    s.t.send('{"late":1}')
    await new Promise((r) => setTimeout(r, 60))
    expect(s.ev.closes.length).toBe(1)
  })

  it("reacts to the browser's disconnect event for its own port only", async () => {
    const s = setup()
    await opened(s)
    s.api.emit('disconnect', new FakePort())
    await new Promise((r) => setTimeout(r, 20))
    expect(s.ev.closes).toEqual([])
    s.api.emit('disconnect', s.port)
    await vi.waitFor(() => expect(s.ev.closes).toEqual([UNPLUGGED_MESSAGE]))
    expect(s.api.listenerCount('disconnect')).toBe(0) // listener cleaned up
  })

  it('removes its event listener on close()', async () => {
    const s = setup()
    await opened(s)
    expect(s.api.listenerCount('disconnect')).toBe(1)
    s.t.close()
    expect(s.api.listenerCount('disconnect')).toBe(0)
  })
})

describe('port selection helpers', () => {
  it('finds the remembered port by USB id and never grabs an unrelated device', async () => {
    const api = new FakeSerialApi()
    const ch340 = new FakePort({ usbVendorId: 0x1a86, usbProductId: 0x7523 })
    const other = new FakePort({ usbVendorId: 0x10c4, usbProductId: 0xea60 })
    api.ports.push(other, ch340)
    expect(await findAuthorizedPort(api, { vid: 0x1a86, pid: 0x7523 })).toBe(ch340)
    expect(await findAuthorizedPort(api, { vid: 0x0403, pid: 0x6001 })).toBeNull()
    expect(await findAuthorizedPort(api, undefined)).toBeNull() // two ports, no hint: ambiguous
    api.ports.splice(0, 1)
    expect(await findAuthorizedPort(api, undefined)).toBe(ch340) // exactly one port, no hint
    expect(await findAuthorizedPort(api, { vid: 1 }, ch340)).toBe(ch340) // preferred object wins
  })

  it('requestSerialPort passes ESP32 filters, can show all ports, and treats cancel as null', async () => {
    const api = new FakeSerialApi()
    vi.stubGlobal('navigator', { serial: api })
    expect(await requestSerialPort()).toBeNull() // dialog cancelled
    expect(api.requestCalls[0]).toEqual({ filters: ESP32_USB_FILTERS })
    expect(ESP32_USB_FILTERS).toContainEqual({ usbVendorId: 0x1a86, usbProductId: 0x7523 })
    const port = new FakePort()
    api.requestResult = port
    expect(await requestSerialPort({ all: true })).toBe(port)
    expect(api.requestCalls[1]).toEqual({})
    api.requestResult = new DOMException('blocked', 'SecurityError')
    await expect(requestSerialPort()).rejects.toThrow()
  })

  it('explains missing Web Serial support, including the Brave flag', () => {
    vi.stubGlobal('navigator', {})
    expect(unsupportedReason()).toMatch(/brave:\/\/flags\/#brave-web-serial-api/)
    vi.stubGlobal('navigator', { serial: new FakeSerialApi() })
    expect(unsupportedReason()).toBeNull()
  })

  it('describeOpenError falls back to the original message', () => {
    expect(describeOpenError(new Error('weird'))).toContain('weird')
  })
})
