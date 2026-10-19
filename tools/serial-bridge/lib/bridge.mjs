import { WebSocketServer } from 'ws'

/**
 * AdaptiveDesk USB serial <-> WebSocket bridge.
 *
 * The ESP32 speaks the dashboard protocol as newline-delimited JSON over USB serial.
 * This relays it to/from the dashboard's existing WebSocket client, unchanged.
 *
 * Safety properties:
 *  - Listens on loopback only; browsers from other origins are rejected.
 *  - Only protocol-v1 JSON objects of known types cross the bridge, in each direction.
 *  - The dashboard is only allowed to connect while the ESP32 is actually answering, so a
 *    "connected" dashboard always means a live device (never a silent, dead link).
 */

const FROM_DEVICE = new Set(['hello', 'telemetry', 'ack', 'event', 'pong'])
const FROM_DASHBOARD = new Set(['command', 'ping', 'requestState'])
const MAX_LINE = 4096
const MAX_CLIENT_MSG = 1024
const KEEPALIVE_TS = -1 // marks the bridge's own pings so their pongs are swallowed, not shown to the dashboard

export const DEFAULT_ORIGINS = [/^https?:\/\/localhost(:\d+)?$/, /^https?:\/\/127\.0\.0\.1(:\d+)?$/, /^https:\/\/synv3x\.github\.io$/]

/**
 * @param {object} o
 * @param {() => Promise<import('node:events').EventEmitter & {write: Function, close: Function}>} o.openPort
 * @param {string} o.portLabel      shown in messages, e.g. "COM5"
 * @param {number} o.wsPort
 * @param {string} [o.host]
 * @param {(msg: string) => void} [o.log]
 * @param {number} [o.aliveMs]      how long the ESP32 may stay silent before the link counts as down
 * @param {number} [o.keepaliveMs]  keep-alive period sent to the ESP32 (it stops streaming without it)
 * @param {number} [o.retryMs]
 * @param {(RegExp|string)[]} [o.origins]
 */
export function createBridge(o) {
  const log = o.log ?? (() => {})
  const host = o.host ?? '127.0.0.1'
  const aliveMs = o.aliveMs ?? 3000
  const keepaliveMs = o.keepaliveMs ?? 1000
  const retryMs = o.retryMs ?? 2000
  const origins = o.origins ?? DEFAULT_ORIGINS

  let wss = null
  let port = null
  let state = 'stopped' // stopped | port-closed | waiting-esp | live | paused
  let paused = false
  let stopping = false
  let lastRx = 0
  let rxBuf = ''
  let hello = null
  let telemetry = null
  let retryTimer, keepTimer, aliveTimer, statTimer
  const stats = { linesIn: 0, linesOut: 0, badIn: 0 }

  const setState = (s, detail = '') => {
    if (s === state) return
    state = s
    log(`[bridge] ${s}${detail ? ': ' + detail : ''}`)
  }

  const isAlive = () => state === 'live'
  const closeClients = (reason) => {
    wss?.clients.forEach((c) => { try { c.close(1013, reason.slice(0, 120)) } catch { /* already closing */ } })
  }
  const downReason = () => `No data from ESP32 on ${o.portLabel}. Check the USB cable and that the board is running the AdaptiveDesk firmware.`

  // ---------- serial side

  function describeOpenError(err) {
    const m = String(err?.message ?? err)
    if (/access denied|busy|in use|permission/i.test(m))
      return `${m}. ${o.portLabel} is in use by another program. Close PlatformIO Serial Monitor, Arduino IDE, or another bridge (only one can own the port). Retrying…`
    if (/file not found|no such file|cannot find|not found/i.test(m))
      return `${m}. ${o.portLabel} doesn't exist. Is the board plugged in? Run "npm run ports" to see available ports. Retrying…`
    return `${m}. Retrying…`
  }

  async function connectPort() {
    if (stopping || paused || port) return
    try {
      const p = await o.openPort()
      if (stopping || paused) { try { p.close(() => {}) } catch { /* ignore */ } return }
      port = p
      rxBuf = ''
      lastRx = 0
      setState('waiting-esp', `opened ${o.portLabel}, waiting for the ESP32 to answer`)
      p.on('data', onData)
      p.on('error', (e) => log(`[serial] error: ${e?.message ?? e}`))
      p.on('close', () => onPortClosed(p))
      startKeepalive()
    } catch (err) {
      log(`[serial] ${describeOpenError(err)}`)
      setState('port-closed')
      scheduleRetry()
    }
  }

  function scheduleRetry() {
    clearTimeout(retryTimer)
    if (stopping || paused) return
    retryTimer = setTimeout(connectPort, retryMs)
  }

  function onPortClosed(p) {
    if (port !== p) return
    port = null
    clearInterval(keepTimer)
    hello = telemetry = null
    if (!paused && !stopping) {
      log(`[serial] ${o.portLabel} closed (unplugged or reset). Reconnecting…`)
      setState('port-closed')
      closeClients(`Lost ${o.portLabel}. Check the USB cable.`)
      scheduleRetry()
    }
  }

  function startKeepalive() {
    clearInterval(keepTimer)
    const send = () => writeLine({ protocolVersion: 1, type: 'ping', timestamp: KEEPALIVE_TS })
    send()
    keepTimer = setInterval(send, keepaliveMs)
  }

  function writeLine(obj) {
    if (!port) return false
    try {
      port.write(JSON.stringify(obj) + '\n')
      stats.linesOut++
      return true
    } catch (e) {
      log(`[serial] write failed: ${e?.message ?? e}`)
      return false
    }
  }

  function onData(chunk) {
    rxBuf += chunk.toString('utf8')
    let i
    while ((i = rxBuf.indexOf('\n')) >= 0) {
      const line = rxBuf.slice(0, i).replace(/\r$/, '')
      rxBuf = rxBuf.slice(i + 1)
      if (line.length) onLine(line)
    }
    if (rxBuf.length > MAX_LINE) rxBuf = '' // runaway garbage without newline
  }

  function onLine(line) {
    if (line[0] !== '{') {
      log(`[esp32] ${line}`) // firmware debug output: the bridge doubles as a serial monitor
      return
    }
    let msg
    try { msg = JSON.parse(line) } catch { stats.badIn++; return }
    if (msg?.protocolVersion !== 1 || !FROM_DEVICE.has(msg.type)) { stats.badIn++; return }
    stats.linesIn++
    lastRx = Date.now()
    if (msg.type === 'pong' && msg.timestamp === KEEPALIVE_TS) return
    if (msg.type === 'hello') hello = line
    if (msg.type === 'telemetry') telemetry = line
    if (state !== 'live' && (msg.type === 'hello' || msg.type === 'telemetry')) {
      setState('live', `ESP32 answering on ${o.portLabel}`)
      startAliveWatch()
    }
    wss?.clients.forEach((c) => { if (c.readyState === 1) c.send(line) })
  }

  function startAliveWatch() {
    clearInterval(aliveTimer)
    aliveTimer = setInterval(() => {
      if (state === 'live' && Date.now() - lastRx > aliveMs) {
        setState('waiting-esp', 'ESP32 stopped responding')
        closeClients(downReason())
      }
    }, 500)
  }

  // ---------- websocket side

  function originAllowed(origin) {
    if (!origin) return true // non-browser tools (curl, tests) have no Origin
    return origins.some((r) => (r instanceof RegExp ? r.test(origin) : r === origin))
  }

  function onClient(ws, req) {
    log(`[ws] dashboard connected from ${req.socket.remoteAddress}`)
    if (!isAlive()) {
      ws.close(1013, downReason().slice(0, 120))
      return
    }
    if (hello) ws.send(hello)
    if (telemetry) ws.send(telemetry)
    ws.on('message', (data, isBinary) => {
      if (isBinary || !isAlive()) return
      const text = data.toString('utf8')
      if (text.length > MAX_CLIENT_MSG) return
      let msg
      try { msg = JSON.parse(text) } catch { return }
      if (msg?.protocolVersion !== 1 || !FROM_DASHBOARD.has(msg.type)) return
      writeLine(msg) // re-serialised, so it can never contain a newline that smuggles a second line
    })
    ws.on('close', () => log('[ws] dashboard disconnected'))
    ws.on('error', () => {})
  }

  // ---------- lifecycle

  return {
    get state() { return state },
    get clients() { return wss?.clients.size ?? 0 },
    stats,

    start() {
      return new Promise((resolve, reject) => {
        stopping = false
        wss = new WebSocketServer({ host, port: o.wsPort, verifyClient: (info, cb) => {
          const ok = originAllowed(info.origin)
          if (!ok) log(`[ws] rejected connection from origin ${info.origin}`)
          cb(ok, 403, 'Origin not allowed')
        } })
        wss.on('connection', onClient)
        wss.once('listening', () => {
          log(`[bridge] WebSocket listening on ws://${host}:${o.wsPort}/ws`)
          setState('port-closed')
          connectPort()
          statTimer = setInterval(() => {
            if (state === 'live') log(`[bridge] live: ${stats.linesIn} msgs from ESP32, ${stats.linesOut} to ESP32, ${wss?.clients.size ?? 0} dashboard(s)${stats.badIn ? `, ${stats.badIn} bad lines ignored` : ''}`)
          }, 10000)
          resolve()
        })
        wss.once('error', (e) => {
          reject(e?.code === 'EADDRINUSE'
            ? new Error(`Port ${o.wsPort} is already in use. Is another bridge running? Use --ws-port to pick another (and set the same port in the dashboard).`)
            : e)
        })
      })
    },

    /** Release the COM port (for flashing or Serial Monitor) without quitting. */
    pause() {
      if (paused) return
      paused = true
      clearTimeout(retryTimer)
      clearInterval(keepTimer)
      clearInterval(aliveTimer)
      closeClients('Bridge paused: COM port released')
      const p = port
      port = null
      hello = telemetry = null
      if (p) { try { p.close(() => {}) } catch { /* ignore */ } }
      setState('paused', `${o.portLabel} released. Safe to upload firmware or open Serial Monitor. Type "r" to resume.`)
    },

    resume() {
      if (!paused) return
      paused = false
      setState('port-closed')
      connectPort()
    },

    async stop() {
      stopping = true
      clearTimeout(retryTimer)
      clearInterval(keepTimer)
      clearInterval(aliveTimer)
      clearInterval(statTimer)
      closeClients('Bridge stopped')
      const p = port
      port = null
      if (p) await new Promise((r) => { try { p.close(() => r()) } catch { r() } })
      await new Promise((r) => (wss ? wss.close(() => r()) : r()))
      state = 'stopped'
    },
  }
}
