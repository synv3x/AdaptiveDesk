// SIMULATED tests: bridge + mock serial port + simulated ESP32 (see sim-device.mjs). No hardware involved.
import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import WebSocket from 'ws'
import { createBridge } from '../lib/bridge.mjs'
import { createSimDevice } from './sim-device.mjs'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const WS_PORT = 18787
const waitFor = async (fn, ms = 4000, what = 'condition') => {
  const t = Date.now()
  while (Date.now() - t < ms) { if (await fn()) return; await sleep(25) }
  assert.fail(`timed out waiting for ${what}`)
}

function client(headers) {
  const ws = new WebSocket(`ws://127.0.0.1:${WS_PORT}/ws`, { headers })
  const msgs = []
  let closed = null
  ws.on('message', (d) => msgs.push(JSON.parse(String(d))))
  ws.on('close', (code, reason) => { closed = { code, reason: String(reason) } })
  ws.on('unexpected-response', (_req, res) => { closed = { code: res.statusCode, reason: 'http' } })
  ws.on('error', () => {})
  return { ws, msgs, get closed() { return closed }, open: () => new Promise((r) => ws.once('open', r)) }
}

describe('serial bridge (simulated ESP32)', () => {
  const logs = []
  const dev = createSimDevice('COM_SIM')
  let bridge
  let failOpens = 0
  const openPort = async () => { if (failOpens-- > 0) throw new Error('Opening COM_SIM: Access denied'); return dev.openPort() }

  before(async () => {
    failOpens = 2 // first two opens fail, like a busy port
    bridge = createBridge({ openPort, portLabel: 'COM_SIM', wsPort: WS_PORT, log: (m) => logs.push(m), aliveMs: 700, keepaliveMs: 100, retryMs: 100 })
    await bridge.start()
  })
  after(async () => { dev.stop(); await bridge.stop() })

  it('retries a busy port with a helpful message, then goes live', async () => {
    await waitFor(() => bridge.state === 'live', 5000, 'live')
    assert.ok(logs.some((l) => /in use by another program.*Serial Monitor/i.test(l)), 'busy-port hint logged')
  })

  it('does not forward firmware debug lines to the dashboard, but logs them', async () => {
    const c = client(); await c.open()
    dev.debugLine('[status] usb=bridge-active slider=63%')
    await sleep(300)
    assert.ok(c.msgs.length > 0 && c.msgs.every((m) => m.protocolVersion === 1))
    assert.ok(logs.some((l) => l.includes('[esp32] [status]')))
    c.ws.close()
  })

  it('sends hello + telemetry to a new client immediately and streams ~8 Hz', async () => {
    const c = client(); await c.open()
    await waitFor(() => c.msgs.some((m) => m.type === 'hello'), 1000, 'hello')
    const before = c.msgs.filter((m) => m.type === 'telemetry').length
    await sleep(1000)
    const rate = c.msgs.filter((m) => m.type === 'telemetry').length - before
    assert.ok(rate >= 6 && rate <= 14, `telemetry rate ${rate}/s`)
    c.ws.close()
  })

  it('relays commands to the device and the device state comes back', async () => {
    const c = client(); await c.open()
    c.ws.send(JSON.stringify({ protocolVersion: 1, type: 'command', requestId: 'r1', feature: 'ambientLighting', action: 'setColor', value: '#ef4444' }))
    await waitFor(() => c.msgs.some((m) => m.type === 'ack' && m.requestId === 'r1' && m.ok), 2000, 'ack')
    assert.equal(dev.st.color, '#ef4444')
    await waitFor(() => c.msgs.some((m) => m.type === 'telemetry' && m.features.ambientLighting.color === '#ef4444'), 2000, 'reported colour')

    c.ws.send(JSON.stringify({ protocolVersion: 1, type: 'command', requestId: 'r2', feature: 'pressureSensing', action: 'setThreshold', value: 55 }))
    c.ws.send(JSON.stringify({ protocolVersion: 1, type: 'command', requestId: 'r3', feature: 'audioAlert', action: 'setMuted', value: true }))
    c.ws.send(JSON.stringify({ protocolVersion: 1, type: 'command', requestId: 'r4', feature: 'audioAlert', action: 'test' }))
    await waitFor(() => c.msgs.some((m) => m.type === 'ack' && m.requestId === 'r4'), 2000, 'ack r4')
    assert.equal(dev.st.thr, 55)
    assert.equal(dev.st.muted, true)
    assert.deepEqual(c.msgs.find((m) => m.requestId === 'r4'), { protocolVersion: 1, type: 'ack', requestId: 'r4', ok: false, error: 'Buzzer is muted' })
    c.ws.close()
  })

  it('streams real sensor changes from the device', async () => {
    const c = client(); await c.open()
    dev.st.slider = 20; dev.st.fsr = 80; dev.st.muted = false
    await waitFor(() => c.msgs.some((m) => m.type === 'telemetry' && m.features.slideControl.position === 20 && m.features.pressureSensing.pressed), 2000, 'sensor update')
    c.ws.close()
  })

  it('never forwards malformed, oversized, unknown or smuggled messages', async () => {
    const c = client(); await c.open()
    const n = dev.received.length
    c.ws.send('not json')
    c.ws.send(JSON.stringify({ protocolVersion: 2, type: 'ping', timestamp: 1 }))
    c.ws.send(JSON.stringify({ protocolVersion: 1, type: 'reboot' }))
    c.ws.send(JSON.stringify({ protocolVersion: 1, type: 'ping', timestamp: 'x'.repeat(2000) }))
    c.ws.send(Buffer.from([1, 2, 3]))
    // newline smuggling: a string containing "\n{...}" must stay inside one JSON string
    c.ws.send(JSON.stringify({ protocolVersion: 1, type: 'command', requestId: 'evil\n{"protocolVersion":1,"type":"command","requestId":"x","feature":"audioAlert","action":"test"}', feature: 'audioAlert', action: 'nope' }))
    await sleep(500)
    const fresh = dev.received.slice(n).filter((m) => !(m.type === 'ping' && m.timestamp === -1)) // ignore the bridge's own keep-alives
    assert.equal(fresh.length, 1, `only the single (re-serialised) command should arrive, got ${JSON.stringify(fresh)}`)
    assert.equal(fresh[0].action, 'nope')
    assert.ok(!dev.received.some((m) => m.requestId === 'x'), 'smuggled command must not exist')
    c.ws.close()
  })

  it('rejects browsers from foreign origins but allows localhost', async () => {
    const bad = client({ Origin: 'https://evil.example' }); await sleep(400)
    assert.ok(bad.closed, 'foreign origin refused')
    const good = client({ Origin: 'http://localhost:5173' }); await good.open()
    await waitFor(() => good.msgs.length > 0, 1000, 'messages for localhost origin')
    good.ws.close()
  })

  it('closes dashboards with a clear reason when the ESP32 goes silent, and recovers', async () => {
    const c = client(); await c.open()
    await waitFor(() => c.msgs.length > 0, 1000, 'first message')
    dev.setSilent(true)
    await waitFor(() => c.closed !== null, 3000, 'close on silence')
    assert.equal(c.closed.code, 1013)
    assert.match(c.closed.reason, /No data from ESP32 on COM_SIM/)
    // while silent, a new dashboard is refused with the same helpful reason
    const late = client(); await waitFor(() => late.closed !== null, 2000, 'refused while down')
    assert.match(late.closed.reason, /No data from ESP32/)
    dev.setSilent(false)
    await waitFor(() => bridge.state === 'live', 4000, 'recovery')
    const ok = client(); await ok.open(); await waitFor(() => ok.msgs.length > 0, 1000, 'data after recovery'); ok.ws.close()
  })

  it('pause releases the port and resume takes it back', async () => {
    const c = client(); await c.open(); await waitFor(() => c.msgs.length > 0, 1000, 'data')
    bridge.pause()
    assert.equal(bridge.state, 'paused')
    await waitFor(() => c.closed !== null, 1000, 'client closed on pause')
    assert.match(c.closed.reason, /paused/i)
    const n = dev.received.length
    await sleep(400)
    assert.equal(dev.received.length, n, 'no writes while paused (port released)')
    bridge.resume()
    await waitFor(() => bridge.state === 'live', 4000, 'live after resume')
  })
})
