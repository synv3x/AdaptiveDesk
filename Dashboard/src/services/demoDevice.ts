import { PROTOCOL_VERSION } from '../lib/protocol'
import { validateCommand, type FeatureId } from '../lib/features'
import type { DemoProfile } from '../store/prefs'
import type { Transport, TransportCallbacks } from './deviceClient'

/**
 * Simulated AdaptiveDesk console used by Demo Mode ONLY.
 * It speaks the same wire protocol as real firmware, so the exact same client, parser,
 * stores and UI are exercised. Nothing here is ever used in Live Mode.
 */

interface DemoState {
  presence: boolean
  lighting: { enabled: boolean; brightness: number; scene: string }
  presses: number
  privacy: boolean
  locked: boolean
  auth: { lastResult: 'success' | 'failed' | null; lastAt: number | null }
  media: { volume: number; playing: boolean }
  wearable: { connected: boolean; pairing: boolean; battery: number; intensity: string }
  lastControl: string | null
  bootedAt: number
}

const fresh = (): DemoState => ({
  presence: true,
  lighting: { enabled: true, brightness: 70, scene: 'focus' },
  presses: 0,
  privacy: true,
  locked: false,
  auth: { lastResult: null, lastAt: null },
  media: { volume: 42, playing: false },
  wearable: { connected: false, pairing: false, battery: 82, intensity: 'medium' },
  lastControl: null,
  bootedAt: Date.now(),
})

// State survives simulated reconnects, and resets when Demo Mode is restarted.
let persisted: DemoState = fresh()
let blockedUntil = 0
let active: DemoDevice | null = null
let activeTransport: DemoTransport | null = null

const rand = (a: number, b: number) => a + Math.random() * (b - a)

class DemoDevice {
  private timers: ReturnType<typeof setTimeout>[] = []
  private intervals: ReturnType<typeof setInterval>[] = []

  constructor(private profile: DemoProfile, private emit: (obj: unknown) => void) {}

  private get s() { return persisted }

  private features() {
    const full = this.profile === 'full'
    const s = this.s
    return {
      workspacePresence: { available: full, value: s.presence },
      ambientLighting: { available: true, enabled: s.lighting.enabled, brightness: s.lighting.brightness, scene: s.lighting.scene, scenes: ['focus', 'calm', 'warm', 'alert'] },
      workspaceAction: { available: true, pressCount: s.presses },
      privacyProtection: { available: full, enabled: s.privacy },
      workstationLock: { available: full, locked: s.locked },
      userAuthentication: { available: full, lastResult: s.auth.lastResult, lastAt: s.auth.lastAt },
      mediaControl: { available: full, volume: s.media.volume, playing: s.media.playing },
      productivityControls: { available: full, lastControl: s.lastControl },
      wearable: {
        available: full,
        connected: s.wearable.connected,
        pairing: s.wearable.pairing,
        intensity: s.wearable.intensity,
        intensityLevels: ['low', 'medium', 'high'],
        ...(s.wearable.connected ? { battery: Math.round(s.wearable.battery) } : {}),
      },
    }
  }

  private system() {
    return { ssid: 'Demo Network', rssi: Math.round(-52 + rand(-4, 4)), uptimeMs: Date.now() - this.s.bootedAt, freeHeap: 182000 }
  }

  private base(type: string) { return { protocolVersion: PROTOCOL_VERSION, type } }

  hello() {
    this.emit({ ...this.base('hello'), deviceId: 'demo-device', name: 'AdaptiveDesk Demo', firmware: 'demo', board: 'Simulated', features: this.features(), system: this.system() })
  }
  telemetry() {
    this.emit({ ...this.base('telemetry'), deviceId: 'demo-device', timestamp: Date.now(), features: this.features(), system: this.system() })
  }
  event(event: string, feature?: FeatureId, detail?: string) {
    this.emit({ ...this.base('event'), event, feature, detail, timestamp: Date.now() })
  }

  start() {
    this.hello()
    this.intervals.push(setInterval(() => this.telemetry(), 2000))
    // Gentle, believable drift: presence changes occasionally, battery drains slowly.
    const flip = () => {
      if (this.profile === 'full') {
        this.s.presence = !this.s.presence
        this.telemetry()
      }
      this.timers.push(setTimeout(flip, rand(45000, 90000)))
    }
    this.timers.push(setTimeout(flip, rand(30000, 50000)))
    this.intervals.push(setInterval(() => { if (this.s.wearable.connected) this.s.wearable.battery = Math.max(5, this.s.wearable.battery - 0.1) }, 20000))
  }

  stop() {
    this.timers.forEach(clearTimeout)
    this.intervals.forEach(clearInterval)
  }

  handle(raw: string) {
    let msg: Record<string, unknown>
    try { msg = JSON.parse(raw) } catch { return }
    if (msg.type === 'ping') this.emit({ ...this.base('pong'), timestamp: msg.timestamp })
    else if (msg.type === 'requestState') this.telemetry()
    else if (msg.type === 'command') this.command(msg)
  }

  private command(msg: Record<string, unknown>) {
    const requestId = String(msg.requestId ?? '')
    const feature = String(msg.feature)
    const action = String(msg.action)
    const err = validateCommand(feature, action, msg.value)
    const reply = (ok: boolean, error?: string) => this.emit({ ...this.base('ack'), requestId, ok, error })
    this.timers.push(setTimeout(() => {
      if (err) return reply(false, err)
      const f = this.features()[feature as keyof ReturnType<DemoDevice['features']>]
      if (!f?.available) return reply(false, 'Feature not available on this device')
      const v = msg.value
      const s = this.s
      switch (`${feature}.${action}`) {
        case 'ambientLighting.setEnabled': s.lighting.enabled = v as boolean; break
        case 'ambientLighting.setBrightness': s.lighting.brightness = v as number; break
        case 'ambientLighting.setScene': s.lighting.scene = v as string; break
        case 'privacyProtection.setEnabled': s.privacy = v as boolean; break
        case 'workstationLock.lock': s.locked = true; break
        case 'mediaControl.playPause': s.media.playing = !s.media.playing; break
        case 'mediaControl.setVolume': s.media.volume = v as number; break
        case 'wearable.startPairing':
          if (s.wearable.connected) return reply(false, 'Already paired')
          s.wearable.pairing = true
          this.timers.push(setTimeout(() => { s.wearable.pairing = false; s.wearable.connected = true; this.telemetry() }, 3500))
          break
        case 'wearable.stopPairing': s.wearable.pairing = false; break
        case 'wearable.disconnect': s.wearable.connected = false; s.wearable.pairing = false; break
        case 'wearable.setIntensity': s.wearable.intensity = v as string; break
        case 'wearable.vibrate': if (!s.wearable.connected) return reply(false, 'Wristband not connected'); break
        default: break // next / previous: accepted, no state to report
      }
      reply(true)
      this.telemetry()
    }, rand(150, 450)))
  }

  // Demo tools
  simulatePresence(present: boolean) { this.s.presence = present; this.telemetry() }
  pressButton() { this.s.presses++; this.event('workspaceAction.pressed', 'workspaceAction'); this.telemetry() }
  turnControl(id: string) { this.s.lastControl = id; this.event('control.activated', 'productivityControls', id); this.telemetry() }
  scanFingerprint(ok: boolean) {
    const s = this.s
    s.auth = { lastResult: ok ? 'success' : 'failed', lastAt: Date.now() }
    if (ok) s.locked = false
    this.event(ok ? 'auth.success' : 'auth.failed', 'userAuthentication')
    this.telemetry()
  }
}

export class DemoTransport implements Transport {
  private device: DemoDevice | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  constructor(private profile: DemoProfile, private cb: TransportCallbacks) {}

  open() {
    this.timer = setTimeout(() => {
      if (Date.now() < blockedUntil) return this.cb.onClose('Device unreachable (simulated)')
      this.device = new DemoDevice(this.profile, (obj) => this.cb.onMessage(JSON.stringify(obj)))
      active = this.device
      activeTransport = this
      this.cb.onOpen()
      this.device.start()
    }, 350)
  }
  close() {
    clearTimeout(this.timer)
    this.device?.stop()
    if (active === this.device) active = null
    if (activeTransport === this) activeTransport = null
    this.device = null
  }
  /** Simulate the link dropping: the client sees a close and starts reconnecting. */
  drop() {
    this.close()
    this.cb.onClose('Connection lost (simulated)')
  }
  send(data: string) { this.device?.handle(data) }
}

/** Demo-only helpers surfaced in Settings → Demo tools. */
export const demoControls = {
  isRunning: () => active !== null,
  reset: () => { persisted = fresh(); blockedUntil = 0 },
  simulatePresence: (p: boolean) => active?.simulatePresence(p),
  pressButton: () => active?.pressButton(),
  turnControl: (id: string) => active?.turnControl(id),
  scanFingerprint: (ok: boolean) => active?.scanFingerprint(ok),
  dropConnection(ms = 8000) {
    blockedUntil = Date.now() + ms
    activeTransport?.drop()
  },
}
