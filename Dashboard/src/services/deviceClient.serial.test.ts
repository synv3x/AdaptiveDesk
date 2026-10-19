import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROTOCOL_VERSION, type DeviceMessage } from '../lib/protocol'
import { FakeFirmware, FakePort, FakeSerialApi } from '../test/fakeSerial'
import { DeviceClient, type ConnectionStatus } from './deviceClient'

// SIMULATED: DeviceClient + the real WebSerialTransport against a fake navigator.serial and a fake firmware.

let api: FakeSerialApi
let wsCtor: ReturnType<typeof vi.fn>

beforeEach(() => {
  api = new FakeSerialApi()
  wsCtor = vi.fn(() => { throw new Error('WebSocket must not be used with native Web Serial') })
  vi.stubGlobal('navigator', { serial: api })
  vi.stubGlobal('WebSocket', wsCtor)
})
afterEach(() => vi.unstubAllGlobals())

function makeClient() {
  const log = { statuses: [] as { s: ConnectionStatus; error?: string }[], msgs: [] as DeviceMessage[], rx: 0, latency: [] as number[], sys: [] as string[] }
  const client = new DeviceClient({
    onStatus: (s, info) => log.statuses.push({ s, error: info.error }),
    onMessage: (m) => log.msgs.push(m),
    onLog: (dir, text) => { if (dir === 'sys') log.sys.push(text) },
    onLatency: (ms) => log.latency.push(ms),
    onRx: () => { log.rx++ },
  })
  return { client, log, status: () => log.statuses.at(-1)?.s }
}
const opts = (port?: FakePort) => ({ kind: 'serial' as const, port, hint: { vid: 0x1a86, pid: 0x7523 }, heartbeatMs: 5000, refreshMs: 0 })

describe('DeviceClient over native Web Serial', () => {
  it('connects only after the ESP32 answers, then streams parsed messages and statistics', async () => {
    const port = new FakePort()
    api.ports.push(port)
    const fw = new FakeFirmware(port)
    const { client, log, status } = makeClient()
    client.connect(opts(port))
    expect(status()).toBe('connecting')
    await vi.waitFor(() => expect(status()).toBe('connected'))
    expect(log.msgs[0]).toMatchObject({ type: 'hello', deviceId: 'adaptivedesk-main' })
    expect(log.sys.some((l) => l.startsWith('esp32: [usb]'))).toBe(true) // debug text is surfaced, not parsed

    fw.state.slider = 20
    fw.telemetry()
    await vi.waitFor(() => expect(log.msgs.some((m) => m.type === 'telemetry' && m.features.slideControl?.state.position === 20)).toBe(true))
    expect(log.rx).toBeGreaterThanOrEqual(3) // hello + telemetry + pong, counted
    expect(log.latency.length).toBeGreaterThan(0) // keep-alive pongs give a real round trip
    client.disconnect()
  })

  it('sends firmware-compatible commands and receives the ack', async () => {
    const port = new FakePort()
    api.ports.push(port)
    const fw = new FakeFirmware(port)
    const { client, log, status } = makeClient()
    client.connect(opts(port))
    await vi.waitFor(() => expect(status()).toBe('connected'))
    expect(client.send({ protocolVersion: PROTOCOL_VERSION, type: 'command', requestId: 'c1', feature: 'ambientLighting', action: 'setColor', value: '#ef4444' })).toBe(true)
    await vi.waitFor(() => expect(log.msgs.some((m) => m.type === 'ack' && m.requestId === 'c1' && m.ok)).toBe(true))
    expect(fw.state.color).toBe('#ef4444')
    const cmd = port.written.join('').split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((m) => m.type === 'command')
    expect(cmd).toEqual({ protocolVersion: 1, type: 'command', requestId: 'c1', feature: 'ambientLighting', action: 'setColor', value: '#ef4444' })
    client.disconnect()
  })

  it('never touches WebSocket, even across failures and retries', async () => {
    const { client, log, status } = makeClient()
    client.connect(opts()) // no authorized port at all
    await vi.waitFor(() => expect(status()).toBe('reconnecting'))
    expect(log.statuses.at(-1)?.error).toMatch(/No authorized ESP32/)
    client.disconnect()
    expect(wsCtor).not.toHaveBeenCalled()
  })

  it('Disconnect cancels the reader, releases locks, closes the port and stops all retries', async () => {
    const port = new FakePort()
    api.ports.push(port)
    new FakeFirmware(port)
    const { client, status } = makeClient()
    client.connect(opts(port))
    await vi.waitFor(() => expect(status()).toBe('connected'))
    client.disconnect()
    expect(status()).toBe('idle')
    await vi.waitFor(() => expect(port.closeCalls).toBe(1))
    expect(port.locked).toBe(false)
    expect(client.send({ protocolVersion: PROTOCOL_VERSION, type: 'requestState' })).toBe(false)
    await new Promise((r) => setTimeout(r, 1300)) // longer than the first backoff
    expect(port.openCalls).toBe(1) // nothing reopened it
  })

  it('handles unplug, then reconnects by itself when the board comes back', async () => {
    const port = new FakePort()
    api.ports.push(port)
    new FakeFirmware(port)
    const { client, log, status } = makeClient()
    client.connect(opts(port))
    await vi.waitFor(() => expect(status()).toBe('connected'))

    port.unplug()
    api.ports.length = 0
    await vi.waitFor(() => expect(status()).toBe('reconnecting'))
    expect(log.statuses.at(-1)?.error).toMatch(/unplugged/i)
    await vi.waitFor(() => expect(port.closeCalls).toBe(1))
    expect(port.locked).toBe(false)

    // Plugged back in: the browser hands out a (possibly new) port object with the same USB ids.
    const back = new FakePort()
    api.ports.push(back)
    new FakeFirmware(back)
    await vi.waitFor(() => expect(status()).toBe('connected'), { timeout: 6000 })
    expect(back.openCalls).toBe(1)
    client.disconnect()
  })

  it('a double connect (React StrictMode style) ends with exactly one open, healthy port', async () => {
    const port = new FakePort()
    api.ports.push(port)
    new FakeFirmware(port)
    const { client, status } = makeClient()
    client.connect(opts(port))
    client.disconnect()
    client.connect(opts(port))
    await vi.waitFor(() => expect(status()).toBe('connected'))
    expect(port.isOpen).toBe(true)
    expect(port.locked).toBe(true) // exactly one owner holds the streams
    expect(port.openCalls - port.closeCalls).toBe(1)
    client.disconnect()
  })

  it('reports a silent board with a helpful message instead of staying "connected"', async () => {
    vi.useFakeTimers()
    try {
      const port = new FakePort() // opens fine but nothing ever answers
      api.ports.push(port)
      const { client, log } = makeClient()
      client.connect(opts(port))
      await vi.advanceTimersByTimeAsync(8500)
      expect(log.statuses.some((s) => s.s === 'connected')).toBe(false)
      expect(log.statuses.at(-1)).toMatchObject({ s: 'reconnecting' })
      expect(log.statuses.at(-1)?.error).toMatch(/isn't answering.*firmware/)
      client.disconnect()
    } finally {
      vi.useRealTimers()
    }
  })
})
