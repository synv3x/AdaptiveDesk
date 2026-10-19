import { Bell, Cpu, Download, FlaskConical, MonitorCog, Palette, Plug, Radio, RefreshCw, Terminal, Trash2, Unplug, User, Wifi } from 'lucide-react'
import { useState } from 'react'
import { Badge, Button, Card, CardHeader, ConfirmDialog, PageHeader, Row, Segmented, Select, StatusDot, TextInput, Toggle } from '../components/ui/primitives'
import { useConnectionSummary } from '../components/layout/Shell'
import { SerialConnectionCard } from '../components/SerialPanel'
import { FEATURE_LIST } from '../lib/features'
import { PROTOCOL_VERSION } from '../lib/protocol'
import { demoControls } from '../services/demoDevice'
import { resetDemoData, switchMode } from '../services/runtime'
import { useActivity } from '../store/activity'
import { liveUrl, resolveFeature, useDevice } from '../store/device'
import { usePrefs, type DemoProfile, type ThemePref } from '../store/prefs'
import { useSession } from '../store/session'
import { toast } from '../store/toasts'

type Transport = 'serial' | 'wifi' | 'bridge'
type Tab = 'general' | 'device' | 'notifications' | 'manage' | 'diagnostics'
const TABS: { value: Tab; label: string }[] = [
  { value: 'general', label: 'General' }, { value: 'device', label: 'Device & Network' }, { value: 'notifications', label: 'Notifications' },
  { value: 'manage', label: 'Device management' }, { value: 'diagnostics', label: 'Advanced' },
]

function General() {
  const p = usePrefs()
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="General" icon={User} />
        <Row title="Your name" hint="Used in your greeting."><TextInput aria-label="Your name" className="w-48" maxLength={24} placeholder="Optional" value={p.userName} onChange={(e) => p.set({ userName: e.target.value })} /></Row>
      </Card>
      <Card>
        <CardHeader title="Appearance" icon={Palette} />
        <Row title="Theme"><Segmented<ThemePref> value={p.theme} onChange={(v) => p.set({ theme: v })} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'system', label: 'System' }]} /></Row>
        <Row title="Reduce motion" hint="Minimizes animations."><Toggle label="Reduce motion" checked={p.reduceMotion} onChange={(v) => p.set({ reduceMotion: v })} /></Row>
      </Card>
    </div>
  )
}

function DeviceTab() {
  const p = usePrefs()
  const conn = useDevice((s) => s.connection)
  const system = useDevice((s) => s.system)
  const c = useConnectionSummary()
  const [portText, setPortText] = useState(String(p.device.port))
  const dev = (patch: Partial<typeof p.device>) => p.set({ device: { ...p.device, ...patch } })
  const valid = p.device.transport === 'serial' ? true : liveUrl() !== null
  const busy = conn.status === 'connecting' || conn.status === 'reconnecting'
  const live = p.mode === 'live'
  const serial = p.device.transport === 'serial'
  const bridge = p.device.transport === 'bridge'
  const [bridgeText, setBridgeText] = useState(String(p.device.bridgePort))

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Mode" subtitle="Live talks to your real AdaptiveDesk. Demo uses a simulated device. They never share data." icon={Radio} />
        <Segmented value={p.mode} onChange={switchMode} options={[{ value: 'live', label: 'Live', icon: Radio }, { value: 'demo', label: 'Demo', icon: FlaskConical }]} />
      </Card>

      {live ? (
        <>
          <Card>
            <CardHeader title="Connection type" subtitle="USB (Web Serial) talks to the ESP32 straight from the browser: no Wi-Fi and no extra program." icon={Plug} />
            <Segmented<Transport> value={p.device.transport}
              onChange={(v) => { if (v !== p.device.transport) { useDevice.getState().disconnect(); dev({ transport: v }) } }}
              options={[{ value: 'serial', label: 'USB · Web Serial (recommended)' }, { value: 'wifi', label: 'Wi-Fi' }, { value: 'bridge', label: 'USB bridge (legacy)' }]} />
          </Card>
          {serial ? (
            <Card>
              <CardHeader title="USB connection (Web Serial)" subtitle="Chrome, Edge or Brave with Web Serial enabled." icon={Plug}
                action={<div className="flex items-center gap-2 text-sm"><StatusDot tone={c.tone} pulse={c.pulse} />{c.label}</div>} />
              <SerialConnectionCard />
            </Card>
          ) : (
          <Card>
            <CardHeader title={bridge ? 'USB bridge (legacy)' : 'Your AdaptiveDesk (Wi-Fi)'}
              subtitle={bridge ? 'A small Node program on this computer relays the ESP32 to the dashboard. Prefer Web Serial.' : 'Enter the address your console prints in its Serial Monitor.'} icon={Plug}
              action={<div className="flex items-center gap-2 text-sm"><StatusDot tone={c.tone} pulse={c.pulse} />{c.label}</div>} />
            {bridge ? (
              <>
                <ol className="space-y-2.5 text-[13px] leading-relaxed text-muted">
                  <li><b className="text-ink">1.</b> Plug the ESP32 into this computer with a <i>data</i> USB cable.</li>
                  <li><b className="text-ink">2.</b> Close PlatformIO's Serial Monitor. Only one program can use the COM port.</li>
                  <li><b className="text-ink">3.</b> In a terminal: <code className="rounded bg-raised px-1.5 py-0.5 font-mono text-[12px] text-ink">cd tools/serial-bridge</code> then <code className="rounded bg-raised px-1.5 py-0.5 font-mono text-[12px] text-ink">npm install</code> (first time only), then <code className="rounded bg-raised px-1.5 py-0.5 font-mono text-[12px] text-ink">npm start -- --port COM5</code> (use your COM number).</li>
                  <li><b className="text-ink">4.</b> Click <b className="text-ink">Connect</b> below.</li>
                </ol>
                <div className="mt-4">
                  <Row title="Bridge port" hint="Only change this if you started the bridge with --ws-port."><TextInput aria-label="Bridge port" className="w-28" inputMode="numeric" value={bridgeText} onChange={(e) => { setBridgeText(e.target.value); const n = Number(e.target.value); if (Number.isInteger(n)) dev({ bridgePort: n }) }} /></Row>
                  <Row title="Connect automatically" hint="When the dashboard opens."><Toggle label="Connect automatically" checked={p.device.autoConnect} onChange={(v) => dev({ autoConnect: v })} /></Row>
                </div>
              </>
            ) : (
              <>
                <Row title="Address" hint="Hostname or IP, e.g. adaptivedesk.local or 192.168.1.50"><TextInput aria-label="Device address" className="w-64" placeholder="192.168.1.50" value={p.device.host} onChange={(e) => dev({ host: e.target.value })} /></Row>
                <Row title="Port"><TextInput aria-label="Port" className="w-28" inputMode="numeric" value={portText} onChange={(e) => { setPortText(e.target.value); const n = Number(e.target.value); if (Number.isInteger(n)) dev({ port: n }) }} /></Row>
                <Row title="Path"><TextInput aria-label="Path" className="w-28" value={p.device.path} onChange={(e) => dev({ path: e.target.value })} /></Row>
                <Row title="Connect automatically" hint="When the dashboard opens."><Toggle label="Connect automatically" checked={p.device.autoConnect} onChange={(v) => dev({ autoConnect: v })} /></Row>
              </>
            )}
            <div className="mt-5 flex flex-wrap items-center gap-3">
              {conn.status === 'connected' || busy ? <Button icon={Unplug} onClick={() => useDevice.getState().disconnect()}>Disconnect</Button>
                : <Button variant="primary" icon={Plug} disabled={!valid} onClick={() => useDevice.getState().connectLive()}>Connect</Button>}
              {!valid && <span className="text-[13px] text-muted">{bridge ? 'Enter a valid bridge port.' : 'Enter a valid address, port and path to connect.'}</span>}
            </div>
            {conn.error && conn.status !== 'connected' && (
              <div className="mt-4 rounded-xl border border-warn/25 bg-warn/10 px-3.5 py-3 text-[13px] leading-relaxed text-warn" role="alert">
                <div className="font-medium">{conn.status === 'reconnecting' ? 'Can’t reach your console. Retrying automatically.' : 'Couldn’t connect.'}</div>
                <div className="mt-0.5 opacity-90">{conn.error}</div>
              </div>
            )}
          </Card>
          )}
        </>
      ) : (
        <Card>
          <CardHeader title="Demo device" subtitle="A simulated console for demonstrations." icon={FlaskConical} action={<Badge tone="info">Simulated</Badge>} />
          <Row title="Simulated hardware" hint="Minimal shows how the dashboard looks when most hardware isn't connected yet.">
            <Select<DemoProfile> label="Simulated hardware" className="w-48" value={p.demoProfile} options={[{ value: 'full', label: 'Full console' }, { value: 'minimal', label: 'Minimal (light + button)' }]}
              onChange={(v) => { p.set({ demoProfile: v }); setTimeout(() => useDevice.getState().applyMode(), 0) }} />
          </Row>
          <div className="mt-4 text-xs font-medium uppercase tracking-wider text-muted">Trigger simulated events</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => demoControls.simulatePresence(false)}>Leave desk</Button>
            <Button size="sm" onClick={() => demoControls.simulatePresence(true)}>Return to desk</Button>
            <Button size="sm" onClick={() => demoControls.pressButton()}>Press Workspace Action</Button>
            <Button size="sm" onClick={() => demoControls.turnControl('dialA')}>Turn Dial A</Button>
            <Button size="sm" onClick={() => demoControls.pressPad()}>Press pressure pad</Button>
            <Button size="sm" onClick={() => demoControls.scanFingerprint(true)}>Fingerprint OK</Button>
            <Button size="sm" onClick={() => demoControls.scanFingerprint(false)}>Fingerprint fails</Button>
            <Button size="sm" onClick={() => demoControls.dropConnection(6000)}>Drop connection</Button>
          </div>
          <div className="mt-4"><Button size="sm" variant="danger" icon={RefreshCw} onClick={() => { resetDemoData(); useDevice.getState().applyMode(); toast({ tone: 'info', title: 'Demo data reset' }) }}>Reset demo data</Button></div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Wi-Fi (optional)" subtitle="Only needed for the Wi-Fi connection type." icon={Wifi} />
          <p className="text-[13px] leading-relaxed text-muted">Your console's Wi-Fi network is set in its firmware configuration file, not in this dashboard. Credentials are never sent to or stored by the dashboard.</p>
          <div className="mt-3 rounded-xl border border-line bg-raised px-3.5 py-2.5 text-sm">
            {conn.status === 'connected' ? <>Console network: <b>{system?.ssid ?? 'not reported'}</b></> : <span className="text-muted">Connect to see the console's network.</span>}
          </div>
        </Card>
        <Card>
          <CardHeader title="Refresh" subtitle="Applies the next time you connect." icon={RefreshCw} />
          <Row title="Connection check" hint="How often the dashboard confirms the device is still there."><Select label="Connection check" className="w-32" value={p.heartbeatSec} options={[3, 5, 10, 15].map((s) => ({ value: s, label: `${s} s` }))} onChange={(v) => p.set({ heartbeatSec: v })} /></Row>
          <Row title="Full state refresh" hint="Extra safety net on top of live updates."><Select label="Full state refresh" className="w-32" value={p.refreshSec} options={[{ value: 0, label: 'Off' }, ...[5, 15, 30, 60].map((s) => ({ value: s, label: `${s} s` }))]} onChange={(v) => p.set({ refreshSec: v })} /></Row>
        </Card>
      </div>
    </div>
  )
}

function Notifications() {
  const p = usePrefs()
  const n = p.notifications
  const enableBrowser = async (v: boolean) => {
    if (!v) return p.set({ notifications: { ...n, browser: false } })
    if (typeof Notification === 'undefined') return toast({ tone: 'warn', title: 'Not supported in this browser' })
    const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
    if (perm === 'granted') p.set({ notifications: { ...n, browser: true } })
    else toast({ tone: 'warn', title: 'Notifications blocked', detail: 'Allow them for this site in your browser settings.' })
  }
  return (
    <Card>
      <CardHeader title="Notifications" icon={Bell} />
      <Row title="In-app alerts"><Toggle label="In-app alerts" checked={n.inApp} onChange={(v) => p.set({ notifications: { ...n, inApp: v } })} /></Row>
      <Row title="Sound"><Toggle label="Sound" checked={n.sound} onChange={(v) => p.set({ notifications: { ...n, sound: v } })} /></Row>
      <Row title="Desktop notifications" hint="Requires your browser's permission."><Toggle label="Desktop notifications" checked={n.browser} onChange={enableBrowser} /></Row>
      <Row title="Security alerts"><Toggle label="Security alerts" checked={n.security} onChange={(v) => p.set({ notifications: { ...n, security: v } })} /></Row>
    </Card>
  )
}

function Manage() {
  const identity = useDevice((s) => s.identity)
  const status = useDevice((s) => s.connection.status)
  const set = usePrefs((s) => s.set)
  const [confirm, setConfirm] = useState<null | 'forget' | 'reset'>(null)

  const exportData = () => {
    const { device, ...prefs } = usePrefs.getState()
    const data = { exportedAt: new Date().toISOString(), prefs: { ...prefs, device: { ...device } }, sessions: useSession.getState().history, activity: useActivity.getState().events }
    const blob = new Blob([JSON.stringify(data, (_k, v) => (typeof v === 'function' ? undefined : v), 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `adaptivedesk-export-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="Firmware" subtitle="Reported by the device" icon={Cpu} />
        {status === 'connected' ? (
          <dl className="space-y-2.5 text-sm">
            <div className="flex justify-between"><dt className="text-muted">Device</dt><dd>{identity.name ?? 'AdaptiveDesk'}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Firmware version</dt><dd>{identity.firmware ?? 'Not reported'}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Protocol</dt><dd>v{PROTOCOL_VERSION}</dd></div>
          </dl>
        ) : <p className="text-[13px] text-muted">Connect your device to see its firmware information.</p>}
      </Card>
      <Card>
        <CardHeader title="Your data" subtitle="Stored only in this browser." icon={MonitorCog} />
        <div className="flex flex-wrap gap-2">
          <Button icon={Download} onClick={exportData}>Export data</Button>
          <Button icon={Unplug} onClick={() => setConfirm('forget')}>Forget device address</Button>
          <Button variant="danger" icon={Trash2} onClick={() => setConfirm('reset')}>Reset dashboard</Button>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-faint">Exports contain preferences, sessions and activity. They never include Wi-Fi credentials or fingerprint data, which the dashboard never receives.</p>
      </Card>
      <ConfirmDialog open={confirm === 'forget'} title="Forget this device?" confirmLabel="Forget" danger onCancel={() => setConfirm(null)}
        body="The saved address is removed and the connection is closed." onConfirm={() => { useDevice.getState().disconnect(); set({ device: { ...usePrefs.getState().device, host: '' } }); setConfirm(null) }} />
      <ConfirmDialog open={confirm === 'reset'} title="Reset the dashboard?" confirmLabel="Reset everything" danger onCancel={() => setConfirm(null)}
        body="All preferences, rules, sessions and activity stored in this browser are deleted. Your device is not affected."
        onConfirm={() => { Object.keys(localStorage).filter((k) => k.startsWith('adaptivedesk.')).forEach((k) => localStorage.removeItem(k)); location.reload() }} />
    </div>
  )
}

function Diagnostics() {
  const { connection, features, log, pending, identity, system } = useDevice()
  const [open, setOpen] = useState(false)
  const url = liveUrl()
  return (
    <Card>
      <CardHeader title="Advanced diagnostics" subtitle="Technical details for troubleshooting. Not needed for everyday use." icon={Terminal}
        action={<Button size="sm" onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : 'Show'}</Button>} />
      {open && (
        <div className="space-y-6 text-sm">
          <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
            <div className="flex justify-between"><dt className="text-muted">Status</dt><dd className="font-mono text-[13px]">{connection.status}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Latency</dt><dd className="font-mono text-[13px]">{connection.latencyMs ?? '—'} ms</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Endpoint</dt><dd className="truncate font-mono text-[13px]">{url ?? '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Retry attempt</dt><dd className="font-mono text-[13px]">{connection.attempt}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Device ID</dt><dd className="font-mono text-[13px]">{identity.deviceId ?? '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Board</dt><dd className="font-mono text-[13px]">{identity.board ?? '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Wi-Fi RSSI</dt><dd className="font-mono text-[13px]">{system?.rssi ?? '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-muted">Pending commands</dt><dd className="font-mono text-[13px]">{Object.values(pending).filter((p) => p.status === 'pending').length}</dd></div>
          </dl>

          <div>
            <h4 className="mb-2 font-medium">Capability registry</h4>
            <div className="overflow-x-auto scroll-thin">
              <table className="w-full min-w-[420px] text-[13px]">
                <thead><tr className="text-left text-xs uppercase tracking-wider text-muted"><th className="pb-2 font-medium">Feature</th><th className="pb-2 font-medium">Status</th><th className="pb-2 font-medium">Reported state</th></tr></thead>
                <tbody>
                  {FEATURE_LIST.map((f) => {
                    const v = resolveFeature(f.id, connection.status, features[f.id])
                    return (
                      <tr key={f.id} className="border-t border-line align-top">
                        <td className="py-2 pr-3 font-medium">{f.label}<div className="font-mono text-[11px] text-faint">{f.id}</div></td>
                        <td className="py-2 pr-3"><Badge tone={v.usable ? 'ok' : v.status === 'error' ? 'danger' : 'neutral'}>{v.status}</Badge></td>
                        <td className="py-2 font-mono text-[12px] text-muted">{v.usable ? JSON.stringify(v.state) : v.reason}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between"><h4 className="font-medium">Protocol log</h4>
              <Button size="sm" variant="ghost" onClick={() => useDevice.setState({ log: [] })}>Clear</Button></div>
            <div className="max-h-72 overflow-auto rounded-xl border border-line bg-bg p-3 font-mono text-[12px] leading-relaxed scroll-thin">
              {log.length === 0 ? <span className="text-faint">No messages yet.</span> : log.slice().reverse().map((l, i) => (
                <div key={i} className="whitespace-pre-wrap break-all">
                  <span className="text-faint">{new Date(l.ts).toLocaleTimeString()} </span>
                  <span className={l.dir === 'tx' ? 'text-accent' : l.dir === 'rx' ? 'text-ok' : 'text-warn'}>{l.dir === 'tx' ? '→' : l.dir === 'rx' ? '←' : '•'} </span>{l.text}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}

export default function Settings() {
  const [tab, setTab] = useState<Tab>('general')
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" subtitle="Preferences are saved in this browser. Device settings are only confirmed once your console reports them." />
      <Segmented value={tab} onChange={setTab} options={TABS} />
      {tab === 'general' && <General />}
      {tab === 'device' && <DeviceTab />}
      {tab === 'notifications' && <Notifications />}
      {tab === 'manage' && <Manage />}
      {tab === 'diagnostics' && <Diagnostics />}
    </div>
  )
}
