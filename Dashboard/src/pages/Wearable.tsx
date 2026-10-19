import { BatteryCharging, BatteryFull, BatteryLow, BatteryMedium, Bluetooth, BluetoothSearching, History, Vibrate, Watch } from 'lucide-react'
import { ActivityList } from '../components/shared'
import { Badge, Button, Card, CardHeader, ConfirmDialog, FeatureBadge, FeatureGate, PageHeader, Row, Segmented, Select, Toggle } from '../components/ui/primitives'
import { HAPTIC_PATTERNS, type HapticPatternId } from '../lib/features'
import { runCommand, useFeature } from '../store/device'
import { useEvents } from '../store/activity'
import { usePrefs, type WearableEventKey } from '../store/prefs'
import { useState } from 'react'

const EVENT_ROWS: { key: WearableEventKey; title: string; hint: string }[] = [
  { key: 'breakReminder', title: 'Break reminders', hint: 'When a focus session ends.' },
  { key: 'sessionComplete', title: 'Break finished', hint: 'When it’s time to get back to work.' },
  { key: 'securityAlert', title: 'Security alerts', hint: 'When authentication fails.' },
]

export default function Wearable() {
  const f = useFeature('wearable')
  const wearable = usePrefs((s) => s.wearable)
  const set = usePrefs((s) => s.set)
  const events = useEvents().filter((e) => e.title.startsWith('Wristband'))
  const [confirmDisc, setConfirmDisc] = useState(false)

  const connected = f.usable && f.state.connected === true
  const pairing = f.usable && f.state.pairing === true
  const battery = typeof f.state.battery === 'number' ? f.state.battery : null
  const levels = Array.isArray(f.state.intensityLevels) ? (f.state.intensityLevels as string[]) : []
  const BatteryIcon = battery === null ? BatteryMedium : f.state.charging === true ? BatteryCharging : battery > 66 ? BatteryFull : battery > 25 ? BatteryMedium : BatteryLow

  const patternSet = (k: WearableEventKey, p: HapticPatternId) => set({ wearable: { ...wearable, patterns: { ...wearable.patterns, [k]: p } } })

  return (
    <div className="space-y-6">
      <PageHeader title="Wearable Companion" subtitle="A quiet tap on the wrist for breaks and alerts. Everything here reflects what your wristband actually reports." />

      <Card className="relative overflow-hidden">
        <div className="pointer-events-none absolute -left-10 -top-16 size-56 rounded-full bg-cyan/10 blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-6">
          <div className={`grid size-20 place-items-center rounded-3xl border border-line bg-raised ${connected ? 'text-accent' : 'text-faint'}`}>
            {pairing ? <BluetoothSearching className="size-9 animate-pulse" /> : <Watch className="size-9" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight">{connected ? 'Wristband connected' : pairing ? 'Searching for your wristband…' : f.usable ? 'Wristband not paired' : 'Wristband unavailable'}</h2>
              <FeatureBadge feature="wearable" />
            </div>
            <p className="mt-1 max-w-lg text-sm text-muted">
              {connected ? 'Haptic alerts will be sent to your wrist.' : pairing ? 'Keep your wristband close and awake. Pairing only completes when the device confirms it.'
                : f.usable ? 'Pair your wristband to receive haptic alerts.' : f.reason}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {connected && (
              <div className="flex items-center gap-2 rounded-xl border border-line bg-raised px-3.5 py-2 text-sm">
                <BatteryIcon className="size-5 text-ok" />
                <span className="tabular">{battery !== null ? `${battery}%` : 'Battery not reported'}</span>
              </div>
            )}
            {connected ? <Button variant="danger" onClick={() => setConfirmDisc(true)}>Disconnect</Button>
              : pairing ? <Button loading={f.pending} onClick={() => void runCommand('wearable', 'stopPairing')}>Cancel pairing</Button>
              : <Button variant="primary" icon={Bluetooth} disabled={!f.usable} loading={f.pending} onClick={() => void runCommand('wearable', 'startPairing')} title={f.usable ? undefined : f.reason}>Pair wristband</Button>}
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Notification preferences" subtitle="Choose what reaches your wrist." icon={Vibrate} />
          <FeatureGate feature="wearable" notice={false}>
            {EVENT_ROWS.map((r) => (
              <Row key={r.key} title={r.title} hint={r.hint}>
                <div className="flex items-center gap-3">
                  <Select label={`${r.title} pattern`} className="w-36" value={wearable.patterns[r.key]} options={HAPTIC_PATTERNS.map((p) => ({ value: p.id, label: p.label }))} onChange={(v) => patternSet(r.key, v)} />
                  <Toggle label={r.title} checked={wearable.events[r.key]} onChange={(v) => set({ wearable: { ...wearable, events: { ...wearable.events, [r.key]: v } } })} />
                </div>
              </Row>
            ))}
          </FeatureGate>
          {!f.usable && <p className="mt-3 text-xs text-faint">Preferences are saved now and take effect once the wristband is connected.</p>}
        </Card>

        <Card>
          <CardHeader title="Haptic patterns" subtitle="Feel each pattern before you choose it." icon={Vibrate} />
          <FeatureGate feature="wearable">
            <ul className="space-y-2">
              {HAPTIC_PATTERNS.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-line bg-raised px-3.5 py-2.5">
                  <div><div className="text-sm font-medium">{p.label}</div><div className="text-xs text-muted">{p.hint}</div></div>
                  <Button size="sm" disabled={!connected} onClick={() => void runCommand('wearable', 'vibrate', p.id)}>Test</Button>
                </li>
              ))}
            </ul>
            <div className="mt-4">
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Vibration intensity</div>
              {levels.length > 0 ? (
                <Segmented value={typeof f.state.intensity === 'string' ? f.state.intensity : 'medium'} options={levels.map((l) => ({ value: l, label: l[0].toUpperCase() + l.slice(1) }))}
                  onChange={(v) => void runCommand('wearable', 'setIntensity', v)} />
              ) : <p className="text-[13px] text-muted">Your wristband doesn’t report adjustable intensity.</p>}
            </div>
          </FeatureGate>
        </Card>
      </div>

      <Card>
        <CardHeader title="Connection history" subtitle="Pairing and connection events" icon={History} action={<Badge>{events.length} event{events.length === 1 ? '' : 's'}</Badge>} />
        <ActivityList events={events} limit={8} empty={{ title: 'No connection history', body: 'When your wristband connects or disconnects, it will be recorded here.' }} />
      </Card>

      <ConfirmDialog open={confirmDisc} title="Disconnect wristband?" confirmLabel="Disconnect" danger onCancel={() => setConfirmDisc(false)}
        body="You won't receive haptic alerts until you pair again."
        onConfirm={() => { setConfirmDisc(false); void runCommand('wearable', 'disconnect') }} />
    </div>
  )
}
