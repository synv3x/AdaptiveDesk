import { Fingerprint, Lock, LockOpen, ScanEye, ShieldAlert, ShieldCheck, Timer } from 'lucide-react'
import { useState } from 'react'
import { LockButton } from '../components/LockButton'
import { ActivityList } from '../components/shared'
import { Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, FeatureBadge, FeatureGate, PageHeader, Row, Select, Toggle } from '../components/ui/primitives'
import { FEATURES } from '../lib/features'
import { fmtRelative } from '../lib/stats'
import { useEvents } from '../store/activity'
import { ruleAvailability, useAutomation } from '../store/automation'
import { runCommand, useDevice, useFeature } from '../store/device'
import { usePrefs } from '../store/prefs'

const TIMEOUTS = [10, 30, 60, 120, 300, 600].map((s) => ({ value: s, label: s < 60 ? `${s} seconds` : `${s / 60} minute${s > 60 ? 's' : ''}` }))

export default function Security() {
  const lock = useFeature('workstationLock')
  const privacy = useFeature('privacyProtection')
  const auth = useFeature('userAuthentication')
  const events = useEvents().filter((e) => e.category === 'security')
  const rules = useAutomation()
  const rule = rules.rules.find((r) => r.id === 'auto-lock')
  const conn = useDevice((s) => s.connection.status)
  const features = useDevice((s) => s.features)
  const notif = usePrefs((s) => s.notifications)
  const wearableEvents = usePrefs((s) => s.wearable.events)
  const setPrefs = usePrefs((s) => s.set)
  const wearable = usePrefs((s) => s.wearable)
  const [confirm, setConfirm] = useState<null | 'privacyOff' | 'autoLockOn'>(null)

  const avail = rule ? ruleAvailability(rule, conn, features) : null
  const locked = lock.usable ? lock.state.locked : undefined
  const privacyOn = privacy.state.enabled === true
  const lastResult = auth.state.lastResult
  const lastAt = typeof auth.state.lastAt === 'number' ? auth.state.lastAt : null

  return (
    <div className="space-y-6">
      <PageHeader title="Workspace Security" subtitle="Protect your screen and your work when you step away. Status is only shown when your desk reports it."
        actions={<LockButton variant="primary" />} />

      <Card className="relative overflow-hidden">
        <div className={`pointer-events-none absolute -right-16 -top-16 size-56 rounded-full blur-3xl ${locked === true ? 'bg-ok/15' : 'bg-accent/10'}`} />
        <div className="relative flex flex-wrap items-center gap-5">
          <span className={`grid size-14 place-items-center rounded-2xl border border-line bg-raised ${locked === true ? 'text-ok' : 'text-muted'}`}>
            {locked === true ? <Lock className="size-6" /> : <LockOpen className="size-6" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium uppercase tracking-wider text-muted">Workstation</div>
            <div className="mt-1 text-2xl font-semibold tracking-tight">
              {!lock.usable ? 'Status unavailable' : locked === true ? 'Locked' : locked === false ? 'Unlocked' : 'Unknown'}
            </div>
            <p className="mt-1 text-sm text-muted">
              {!lock.usable ? lock.reason : locked === true ? 'Confirmed by your desk.' : 'Reported by your desk. A lock request is only counted once the device confirms it.'}
            </p>
          </div>
          <FeatureBadge feature="workstationLock" />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Privacy protection" subtitle="Keeps your screen private when you're away." icon={ShieldCheck} action={<FeatureBadge feature="privacyProtection" />} />
          <FeatureGate feature="privacyProtection">
            <Row title="Privacy protection" hint={privacy.usable ? (privacyOn ? 'Enabled on your desk' : 'Currently off') : 'Waiting for device'}>
              <Toggle label="Privacy protection" checked={privacyOn} pending={privacy.pending}
                onChange={(v) => (v ? void runCommand('privacyProtection', 'setEnabled', true) : setConfirm('privacyOff'))} />
            </Row>
          </FeatureGate>
        </Card>

        <Card>
          <CardHeader title="Fingerprint authentication" subtitle="Verify your identity at the desk." icon={Fingerprint} action={<FeatureBadge feature="userAuthentication" />} />
          <FeatureGate feature="userAuthentication">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-medium">{lastResult === 'success' ? 'Last attempt verified' : lastResult === 'failed' ? 'Last attempt not recognised' : 'No attempts yet'}</div>
                <div className="text-[13px] text-muted">{lastAt ? fmtRelative(lastAt) : 'Waiting for the first scan'}</div>
              </div>
              {lastResult && <Badge tone={lastResult === 'success' ? 'ok' : 'danger'} dot>{lastResult === 'success' ? 'Verified' : 'Failed'}</Badge>}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-faint">This dashboard never receives fingerprint data, only a success or failure result.</p>
          </FeatureGate>
        </Card>
      </div>

      <Card>
        <CardHeader title="Automatic locking" subtitle="Lock your computer when you leave your desk for too long." icon={ScanEye}
          action={rule && avail && <Badge tone={rule.enabled ? (avail.runnable ? 'ok' : 'warn') : 'neutral'} dot>{rule.enabled ? (avail.runnable ? 'Active' : 'Inactive') : 'Off'}</Badge>} />
        {!rule || !avail ? (
          <EmptyState compact icon={ShieldAlert} title="Automatic locking rule not found" body="The built-in rule was removed from Automation Studio." action={<Button size="sm" onClick={rules.restoreDefaults}>Restore default rules</Button>} />
        ) : (
          <>
            {!avail.runnable && (
              <div className="mb-4 rounded-xl border border-warn/25 bg-warn/10 px-3.5 py-2.5 text-[13px] text-warn">
                Inactive until connected: {avail.missing.map((m) => FEATURES[m].label).join(', ')}. Nothing will be locked automatically.
              </div>
            )}
            <Row title="Presence-based locking" hint="Starts counting when your desk reports you've left.">
              <Toggle label="Presence-based locking" checked={rule.enabled} onChange={(v) => (v ? setConfirm('autoLockOn') : rules.update(rule.id, { enabled: false }))} />
            </Row>
            <Row title="Absence timeout" hint="How long you must be away before the lock request is sent." disabled={!rule.enabled}>
              <Select label="Absence timeout" className="w-40" value={rule.condition.seconds ?? 60} options={TIMEOUTS}
                onChange={(v) => rules.update(rule.id, { condition: { ...rule.condition, seconds: v } })} />
            </Row>
            <p className="mt-3 flex items-center gap-1.5 text-xs text-faint"><Timer className="size-3.5" /> The timer cancels the moment you return, and is never resumed after a reconnection.</p>
          </>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Security events" subtitle="Authentication and lock history" icon={ShieldAlert} />
          <ActivityList events={events} limit={8} empty={{ title: 'No security events', body: 'Fingerprint scans, lock confirmations and privacy changes will be recorded here.' }} />
        </Card>
        <Card>
          <CardHeader title="Security preferences" subtitle="How you want to be told." />
          <Row title="Security alerts" hint="Show an alert when authentication fails.">
            <Toggle label="Security alerts" checked={notif.security} onChange={(v) => setPrefs({ notifications: { ...notif, security: v } })} />
          </Row>
          <Row title="Vibrate wristband on alerts" hint="Requires a connected wristband.">
            <Toggle label="Wristband security alerts" checked={wearableEvents.securityAlert}
              onChange={(v) => setPrefs({ wearable: { ...wearable, events: { ...wearableEvents, securityAlert: v } } })} />
          </Row>
          <p className="mt-4 text-xs leading-relaxed text-faint">Locking and disabling privacy protection always ask for confirmation. Commands are never replayed after a reconnection.</p>
        </Card>
      </div>

      <ConfirmDialog open={confirm === 'privacyOff'} title="Turn off privacy protection?" confirmLabel="Turn off" danger
        body="Your screen will no longer be protected when you step away." onCancel={() => setConfirm(null)}
        onConfirm={() => { setConfirm(null); void runCommand('privacyProtection', 'setEnabled', false) }} />
      <ConfirmDialog open={confirm === 'autoLockOn'} title="Enable automatic locking?" confirmLabel="Enable"
        body="Your computer will be sent a lock request when you've been away longer than the timeout. It only runs while your desk is connected and reporting presence."
        onCancel={() => setConfirm(null)} onConfirm={() => { setConfirm(null); if (rule) rules.update(rule.id, { enabled: true }) }} />
    </div>
  )
}
