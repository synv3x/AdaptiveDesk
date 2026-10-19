import { Plug, Unplug, Usb } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNow } from '../hooks/useNow'
import { describePort, getSerialApi, unsupportedReason } from '../services/webSerial'
import { useDevice } from '../store/device'
import { usePrefs } from '../store/prefs'
import { Button, Row, StatusDot, Toggle, type Tone } from './ui/primitives'

/** The one button that opens the browser's port chooser. It calls requestPort() directly from the click. */
export function ConnectEsp32Button({ size = 'md', variant = 'primary' }: { size?: 'sm' | 'md'; variant?: 'primary' | 'secondary' }) {
  const status = useDevice((s) => s.connection.status)
  const reason = unsupportedReason()
  return (
    <Button size={size} variant={variant} icon={Usb} disabled={!!reason} loading={status === 'connecting'}
      title={reason ?? undefined} onClick={() => void useDevice.getState().pickAndConnectSerial()}>
      Connect ESP32
    </Button>
  )
}

const STATUS: Record<string, { tone: Tone; label: string }> = {
  idle: { tone: 'neutral', label: 'Not connected' },
  connecting: { tone: 'info', label: 'Opening the port…' },
  connected: { tone: 'ok', label: 'Connected' },
  reconnecting: { tone: 'warn', label: 'Waiting for the ESP32…' },
  error: { tone: 'danger', label: 'Error' },
}

function Code({ children }: { children: string }) {
  return <code className="rounded bg-raised px-1.5 py-0.5 font-mono text-[12px] text-ink">{children}</code>
}

/** Settings → Device & Network → USB (Web Serial). Holds no connection logic of its own: re-renders never open or close the port. */
export function SerialConnectionCard() {
  const conn = useDevice((s) => s.connection)
  const device = usePrefs((s) => s.device)
  const setPrefs = usePrefs((s) => s.set)
  const now = useNow(500)
  const reason = unsupportedReason()
  const [authorized, setAuthorized] = useState(0)

  // Passive check for already-authorized ports (no prompt, no connection side effects).
  useEffect(() => {
    const api = getSerialApi()
    if (!api) return
    let live = true
    const refresh = () => { api.getPorts().then((p) => { if (live) setAuthorized(p.length) }, () => {}) }
    refresh()
    api.addEventListener('connect', refresh)
    api.addEventListener('disconnect', refresh)
    return () => { live = false; api.removeEventListener('connect', refresh); api.removeEventListener('disconnect', refresh) }
  }, [conn.status])

  const st = STATUS[conn.status] ?? STATUS.idle
  const active = conn.status === 'connected' || conn.status === 'connecting' || conn.status === 'reconnecting'
  const ago = conn.lastSeen ? `${Math.max(0, (now - conn.lastSeen) / 1000).toFixed(1)} s ago` : '—'

  if (reason) {
    return (
      <div className="rounded-xl border border-warn/25 bg-warn/10 px-4 py-3.5 text-[13px] leading-relaxed text-warn" role="alert">
        <div className="font-medium">Web Serial isn't available here</div>
        <div className="mt-1 opacity-90">{reason}</div>
        <div className="mt-2 opacity-90">Alternatives: use Chrome or Edge, switch to <b>Wi-Fi</b>, or pick <b>USB bridge (legacy)</b> above.</div>
      </div>
    )
  }

  return (
    <>
      <ol className="space-y-2 text-[13px] leading-relaxed text-muted">
        <li><b className="text-ink">1.</b> Plug the ESP32 into this computer with a <i>data</i> USB cable.</li>
        <li><b className="text-ink">2.</b> Close PlatformIO Serial Monitor and any other program using the port. Only one program can open it.</li>
        <li><b className="text-ink">3.</b> Click <b className="text-ink">Connect ESP32</b> and choose the port (for example <Code>USB-SERIAL CH340</Code>). Your choice is remembered, so next time it reconnects by itself.</li>
      </ol>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {active ? (
          <Button icon={Unplug} onClick={() => useDevice.getState().disconnect()}>Disconnect</Button>
        ) : (
          <>
            <ConnectEsp32Button />
            {authorized > 0 && <Button icon={Plug} onClick={() => useDevice.getState().connectSerial()}>Reconnect to last ESP32</Button>}
          </>
        )}
        {!active && (
          <button className="text-[13px] text-accent hover:underline" onClick={() => void useDevice.getState().pickAndConnectSerial({ all: true })}>
            My ESP32 isn't listed
          </button>
        )}
      </div>

      <dl className="mt-5 grid gap-x-8 gap-y-2.5 text-sm sm:grid-cols-2" aria-label="Serial connection status">
        <div className="flex items-center justify-between"><dt className="text-muted">Status</dt><dd className="flex items-center gap-2"><StatusDot tone={st.tone} pulse={conn.status === 'connected'} />{st.label}</dd></div>
        <div className="flex justify-between"><dt className="text-muted">Port</dt><dd className="font-mono text-[13px]">{device.serialVid !== undefined ? `USB ${describePort({ vid: device.serialVid, pid: device.serialPid })}` : 'Not chosen yet'}</dd></div>
        <div className="flex justify-between"><dt className="text-muted">Last message</dt><dd className="tabular">{conn.status === 'connected' ? ago : '—'}</dd></div>
        <div className="flex justify-between"><dt className="text-muted">Messages received</dt><dd className="tabular">{conn.messageCount.toLocaleString()}</dd></div>
        <div className="flex justify-between"><dt className="text-muted">Round trip</dt><dd className="tabular">{conn.status === 'connected' && conn.latencyMs != null ? `${conn.latencyMs} ms` : '—'}</dd></div>
        <div className="flex justify-between"><dt className="text-muted">Baud rate</dt><dd className="tabular">115200</dd></div>
      </dl>

      {conn.error && conn.status !== 'connected' && (
        <div className="mt-4 rounded-xl border border-warn/25 bg-warn/10 px-3.5 py-3 text-[13px] leading-relaxed text-warn" role="alert">
          <div className="font-medium">{conn.status === 'reconnecting' ? 'Lost the ESP32. Retrying automatically.' : 'Couldn’t connect.'}</div>
          <div className="mt-0.5 opacity-90">{conn.error}</div>
        </div>
      )}

      <div className="mt-4">
        <Row title="Reconnect automatically" hint="Reopen the remembered ESP32 when this page loads or the cable is plugged back in.">
          <Toggle label="Reconnect automatically" checked={device.autoConnect} onChange={(v) => setPrefs({ device: { ...device, autoConnect: v } })} />
        </Row>
      </div>
    </>
  )
}
