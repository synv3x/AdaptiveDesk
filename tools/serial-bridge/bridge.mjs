#!/usr/bin/env node
import readline from 'node:readline'
import { SerialPort } from 'serialport'
import { createBridge, DEFAULT_ORIGINS } from './lib/bridge.mjs'

const HELP = `AdaptiveDesk USB bridge

Usage:  node bridge.mjs [--port COM5|auto] [--baud 115200] [--ws-port 8787] [--allow-origin URL]
        node bridge.mjs --list

  --port        Windows COM port of the ESP32 (default: auto-detect, or env ADAPTIVEDESK_PORT)
  --baud        Serial speed. Must match the firmware (default 115200)
  --ws-port     Local WebSocket port the dashboard connects to (default 8787)
  --allow-origin  Extra browser origin allowed to connect (default: localhost + the project's GitHub Pages)
  --list        Show serial ports and exit

While running, type + Enter:  p = release the COM port (to upload firmware / use Serial Monitor)
                              r = take the port back    l = list ports    q = quit`

// USB-serial chips found on ESP32 dev boards: CP210x, CH340/CH9102, FTDI, native Espressif USB
const LIKELY = [['10c4', 'CP210x'], ['1a86', 'CH340/CH9102'], ['0403', 'FTDI'], ['303a', 'Espressif USB']]
const likely = (p) => LIKELY.find(([vid]) => p.vendorId?.toLowerCase() === vid)?.[1]

function args(argv) {
  const a = { port: process.env.ADAPTIVEDESK_PORT ?? 'auto', baud: 115200, wsPort: 8787, origins: [], list: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i]
    const v = () => argv[++i]
    if (k === '--port') a.port = v()
    else if (k === '--baud') a.baud = Number(v())
    else if (k === '--ws-port') a.wsPort = Number(v())
    else if (k === '--allow-origin') a.origins.push(v())
    else if (k === '--list') a.list = true
    else if (k === '-h' || k === '--help') a.help = true
    else { console.error(`Unknown option ${k}\n`); a.help = true }
  }
  return a
}

async function printPorts() {
  const ports = await SerialPort.list()
  if (!ports.length) {
    console.log('No serial ports found. Plug in the ESP32 with a DATA-capable USB cable (some cables are charge-only).')
    console.log('If it is plugged in but missing, install the USB driver (CP210x or CH340) and check Device Manager > Ports (COM & LPT).')
    return ports
  }
  console.log('Serial ports:')
  for (const p of ports) {
    const chip = likely(p)
    console.log(`  ${p.path.padEnd(8)} ${chip ? `<- likely ESP32 (${chip})` : ''}  ${[p.friendlyName, p.manufacturer].filter(Boolean).join(' · ')}  ${p.vendorId ? `[${p.vendorId}:${p.productId}]` : ''}`)
  }
  return ports
}

const ts = () => new Date().toLocaleTimeString()
const log = (m) => console.log(`${ts()} ${m}`)

const a = args(process.argv.slice(2))
if (a.help) { console.log(HELP); process.exit(0) }
if (a.list) { await printPorts(); process.exit(0) }
if (!Number.isInteger(a.baud) || a.baud < 1200 || !Number.isInteger(a.wsPort) || a.wsPort < 1024 || a.wsPort > 65535) {
  console.error('Invalid --baud or --ws-port.'); process.exit(2)
}

let path = a.port
if (path === 'auto') {
  const ports = await SerialPort.list()
  const cands = ports.filter(likely)
  if (cands.length === 1) { path = cands[0].path; log(`[bridge] auto-selected ${path} (${likely(cands[0])})`) }
  else {
    await printPorts()
    console.error(cands.length === 0 ? '\nNo likely ESP32 port found.' : '\nMore than one likely ESP32 port.')
    console.error('Choose one:  npm start -- --port COM5     (or set ADAPTIVEDESK_PORT=COM5)')
    process.exit(1)
  }
}
if (!/^(COM\d+|\/dev\/[\w./-]+)$/i.test(path)) { console.error(`"${path}" doesn't look like a serial port name (e.g. COM5).`); process.exit(2) }

const openPort = () =>
  new Promise((resolve, reject) => {
    const p = new SerialPort({ path, baudRate: a.baud, autoOpen: false })
    p.open((err) => {
      if (err) return reject(err)
      // Keep DTR/RTS low so opening the port doesn't hold the ESP32 in reset or bootloader mode.
      p.set({ dtr: false, rts: false }, () => resolve(p))
    })
  })

const b = createBridge({ openPort, portLabel: path, wsPort: a.wsPort, log, origins: [...DEFAULT_ORIGINS, ...a.origins] })

try {
  await b.start()
} catch (e) {
  console.error(e.message)
  process.exit(1)
}
log(`[bridge] Using ${path} at ${a.baud} baud. Dashboard: Settings > Device & Network > USB. Ctrl+C to quit.`)

const shutdown = async () => { await b.stop(); process.exit(0) }
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

if (process.stdin.isTTY) {
  const rl = readline.createInterface({ input: process.stdin })
  rl.on('line', async (l) => {
    const c = l.trim().toLowerCase()
    if (c === 'p') b.pause()
    else if (c === 'r') b.resume()
    else if (c === 'l') await printPorts()
    else if (c === 'q') await shutdown()
    else if (c) console.log('Commands: p = release port, r = resume, l = list ports, q = quit')
  })
}
