import { SerialPortMock } from 'serialport'

/**
 * SIMULATED ESP32 for tests. Mirrors the firmware's serial behaviour (NDJSON, '{' = protocol, '[' = debug,
 * streams only while the host keeps talking, same command validation). This is a stand-in for hardware: it
 * proves the bridge and dashboard logic, NOT the real firmware or wiring.
 */
export function createSimDevice(path = 'COM_SIM') {
  const st = { color: '#00a0ff', on: true, muted: false, thr: 40, slider: 63, fsr: 0, testUntil: 0 }
  const received = [] // every protocol line the device got from the host
  let lastRx = 0
  let wasActive = false
  let silent = false // simulate a dead/unplugged-but-port-still-open board
  let binding = null
  let timer = null
  const active = () => lastRx !== 0 && Date.now() - lastRx < 4000

  SerialPortMock.binding.createPort(path, { echo: false, record: true })

  const features = () => {
    const pressed = st.fsr >= st.thr
    return {
      ambientLighting: { available: true, enabled: st.on, color: st.color, brightness: st.slider, brightnessSource: 'physical' },
      slideControl: { available: true, position: st.slider, raw: 2500 },
      pressureSensing: { available: true, value: st.fsr, raw: 1000, pressed, threshold: st.thr },
      audioAlert: { available: true, active: (pressed && !st.muted) || Date.now() < st.testUntil, muted: st.muted },
    }
  }
  const state = (type, extra = {}) => ({ protocolVersion: 1, type, deviceId: 'adaptivedesk-main', ...extra, features: features(), system: { uptimeMs: Math.round(process.uptime() * 1000), freeHeap: 200000 } })
  const emit = (o) => {
    if (silent || !binding) return
    // emitData throws once the port is closed (bridge paused/stopped): that is expected, swallow it.
    try {
      Promise.resolve(binding.emitData(Buffer.from((typeof o === 'string' ? o : JSON.stringify(o)) + '\n'))).catch(() => {})
    } catch { /* port closed */ }
  }

  function onHostLine(line) {
    if (line[0] !== '{') return
    let m
    try { m = JSON.parse(line) } catch { return }
    if (m.protocolVersion !== 1) return
    received.push(m)
    lastRx = Date.now()
    if (!wasActive) { wasActive = true; emit(state('hello', { name: 'AdaptiveDesk Console', firmware: 'sim', board: 'ESP32 DevKit V1' })) }
    if (m.type === 'ping') return emit({ protocolVersion: 1, type: 'pong', timestamp: m.timestamp })
    if (m.type === 'requestState') return emit(state('telemetry', { timestamp: Date.now() }))
    if (m.type !== 'command') return
    let ok = true, error
    const k = `${m.feature}.${m.action}`
    if (k === 'ambientLighting.setEnabled' && typeof m.value === 'boolean') st.on = m.value
    else if (k === 'ambientLighting.setColor' && /^#[0-9a-fA-F]{6}$/.test(m.value)) st.color = m.value.toLowerCase()
    else if (k === 'ambientLighting.setBrightness') { ok = false; error = 'Brightness is set by the slide control on the console' }
    else if (k === 'pressureSensing.setThreshold' && Number.isInteger(m.value) && m.value >= 5 && m.value <= 95) st.thr = m.value
    else if (k === 'audioAlert.setMuted' && typeof m.value === 'boolean') st.muted = m.value
    else if (k === 'audioAlert.test') { if (st.muted) { ok = false; error = 'Buzzer is muted' } else st.testUntil = Date.now() + 400 }
    else { ok = false; error = 'Unsupported command' }
    emit({ protocolVersion: 1, type: 'ack', requestId: m.requestId, ok, ...(error ? { error } : {}) })
    if (ok) emit(state('telemetry', { timestamp: Date.now() }))
  }

  let hostBuf = ''
  const onHostBytes = (buf) => {
    hostBuf += buf.toString()
    let i
    while ((i = hostBuf.indexOf('\n')) >= 0) { onHostLine(hostBuf.slice(0, i).replace(/\r$/, '')); hostBuf = hostBuf.slice(i + 1) }
  }

  return {
    path, st, received,
    /** Pass to createBridge({ openPort }). */
    async openPort() {
      const port = new SerialPortMock({ path, baudRate: 115200, autoOpen: false })
      await new Promise((res, rej) => port.open((e) => (e ? rej(e) : res())))
      binding = port.port
      const origWrite = binding.write.bind(binding)
      binding.write = async (buf) => { await origWrite(buf); onHostBytes(buf) }
      // the board's own debug chatter, which the bridge must not forward as protocol
      emit('[boot] AdaptiveDesk demo firmware sim')
      clearInterval(timer)
      timer = setInterval(() => { if (active()) emit(state('telemetry', { timestamp: Date.now() })); else wasActive = false }, 125)
      return port
    },
    setSilent(v) { silent = v },
    debugLine(s) { emit(s) },
    stop() { clearInterval(timer) },
  }
}
