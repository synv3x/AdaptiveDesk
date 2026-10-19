import { motion } from 'motion/react'
import { ArrowRight, Coffee, FlaskConical, Gauge, Lightbulb, Play, ScanEye, ShieldCheck, Sparkles, Timer, Watch, Wifi } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ActivityList, ChartTip, LightingControl, Stat, TimerPanel } from '../components/shared'
import { LockButton } from '../components/LockButton'
import { Badge, Button, Card, CardHeader, EmptyState, FeatureBadge, Segmented, Skeleton, StatusDot, type Tone } from '../components/ui/primitives'
import { useConnectionSummary } from '../components/layout/Shell'
import { fmtDuration, dailyStats, todayStat } from '../lib/stats'
import { FEATURE_IDS } from '../lib/features'
import { fmtClock, useNow, useTimerView } from '../hooks/useNow'
import { switchMode, setActiveProfile } from '../services/runtime'
import { useEvents } from '../store/activity'
import { useDevice, useFeature } from '../store/device'
import { useActiveProfile, usePrefs } from '../store/prefs'
import { nextBreakKind, phaseLabel, useSession, useSessions } from '../store/session'

function greeting(h: number) {
  return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

function StatusCard({ icon: Icon, title, value, sub, tone = 'neutral', badge }: { icon: typeof Timer; title: string; value: string; sub: string; tone?: Tone; badge?: React.ReactNode }) {
  return (
    <Card className="p-5 sm:p-5">
      <div className="flex items-start justify-between">
        <span className="grid size-9 place-items-center rounded-xl bg-accent/10 text-accent"><Icon className="size-[18px]" /></span>
        {badge}
      </div>
      <div className="mt-4 text-xs font-medium uppercase tracking-wider text-muted">{title}</div>
      <div className={`mt-1 text-xl font-semibold tracking-tight ${tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'danger' ? 'text-danger' : ''}`}>{value}</div>
      <div className="mt-0.5 text-[13px] text-muted">{sub}</div>
    </Card>
  )
}

export default function Overview() {
  const now = useNow(30_000)
  const name = usePrefs((s) => s.userName)
  const mode = usePrefs((s) => s.mode)
  const profile = useActiveProfile()
  const profiles = usePrefs((s) => s.profiles)
  const conn = useConnectionSummary()
  const status = useDevice((s) => s.connection.status)
  const events = useEvents()
  const sessions = useSessions()
  const { timer, remaining } = useTimerView()
  const cycle = useSession((s) => s.cycle)
  const presence = useFeature('workspacePresence')
  const privacy = useFeature('privacyProtection')
  const wearable = useFeature('wearable')
  const lighting = useFeature('ambientLighting')
  const features = useDevice((s) => s.features)
  const system = useDevice((s) => s.system)
  const lastSeen = useDevice((s) => s.connection.lastSeen)
  const week = dailyStats(sessions)
  const today = todayStat(sessions)
  const hasData = week.some((d) => d.focusMin > 0)

  const liveDown = mode === 'live' && status !== 'connected'
  const available = FEATURE_IDS.filter((id) => features[id]?.available).length

  const presenceVal = presence.state.value
  const rssi = system?.rssi
  const wifi = rssi == null ? 'n/a' : rssi > -60 ? 'Strong' : rssi > -72 ? 'Good' : 'Weak'

  const breakIn = timer.phase === 'focus' ? fmtClock(remaining) : null

  return (
    <div className="space-y-6">
      <motion.section initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="card relative overflow-hidden rounded-3xl p-6 sm:p-8">
        <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-accent/15 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 left-1/3 size-64 rounded-full bg-cyan/10 blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-6">
          <div className="max-w-xl">
            <Badge tone={conn.tone} dot>{conn.label}</Badge>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
              {greeting(new Date(now).getHours())}{name ? `, ${name}` : ''}
            </h1>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">
              {liveDown
                ? status === 'reconnecting' ? 'Your AdaptiveDesk is offline. Reconnecting automatically.' : 'Connect your AdaptiveDesk to bring your workspace to life. Your focus timer and automations work in the meantime.'
                : mode === 'demo' ? 'You’re exploring AdaptiveDesk with a simulated device.' : `Your workspace is ready. ${profile.name} profile is active.`}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              {liveDown ? (
                <>
                  <Link to="/settings"><Button variant="primary" icon={Wifi}>Connect device</Button></Link>
                  <Button icon={FlaskConical} onClick={() => switchMode('demo')}>Explore demo</Button>
                </>
              ) : (
                <Link to="/productivity"><Button variant="primary" icon={ArrowRight}>Open Productivity Hub</Button></Link>
              )}
            </div>
          </div>
        </div>
      </motion.section>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatusCard icon={Gauge} title="Workspace" value={liveDown ? 'Offline' : 'Ready'} sub={liveDown ? 'Device not connected' : `${available} of ${FEATURE_IDS.length} features connected`} tone={liveDown ? 'neutral' : 'ok'} />
        <StatusCard icon={ShieldCheck} title="Privacy protection" badge={<FeatureBadge feature="privacyProtection" />}
          value={privacy.usable ? (privacy.state.enabled === true ? 'Enabled' : 'Off') : 'Unavailable'} tone={privacy.usable && privacy.state.enabled === true ? 'ok' : 'neutral'}
          sub={privacy.usable ? 'Reported by your desk' : 'Not connected yet'} />
        <StatusCard icon={ScanEye} title="Presence" badge={<FeatureBadge feature="workspacePresence" />}
          value={presence.usable ? (presenceVal === true ? 'At your desk' : presenceVal === false ? 'Away' : 'Unknown') : 'Unavailable'}
          sub={presence.usable ? 'Live from presence sensing' : 'Not connected yet'} />
        <StatusCard icon={Sparkles} title="Profile" value={profile.name} sub={`${profile.focusMin} min focus · ${profile.shortBreakMin} min breaks`}
          badge={<Link to="/productivity" className="text-xs text-accent hover:underline">Edit</Link>} />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Focus session" subtitle={timer.phase === 'idle' ? 'No session running' : `${phaseLabel(timer.phase)} in progress`} icon={Timer}
            action={<Link to="/breaks" className="text-[13px] text-accent hover:underline">Break settings</Link>} />
          <div className="grid items-center gap-6 sm:grid-cols-[auto_1fr]">
            <TimerPanel size={170} />
            <div className="grid grid-cols-2 gap-5">
              <Stat label="Today’s focus" value={fmtDuration(today.focusMin)} hint={`${today.sessions} session${today.sessions === 1 ? '' : 's'}`} icon={Timer} />
              <Stat label="Next break" value={breakIn ?? '--:--'} hint={breakIn ? `${nextBreakKind(cycle) === 'longBreak' ? 'Long' : 'Short'} break after this session` : 'Starts after a focus session'} icon={Coffee} />
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader title="Ambient lighting" subtitle={lighting.usable ? profile.lighting.apply ? `Follows ${profile.name} profile` : 'Manual' : 'Desk lighting'} icon={Lightbulb} />
          <LightingControl compact />
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Focus time this week" subtitle="Minutes of focus per day" icon={Timer} />
          {hasData ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={week} margin={{ left: -18, right: 4, top: 4 }}>
                  <defs><linearGradient id="barg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--c-cyan)" /><stop offset="1" stopColor="var(--c-accent)" /></linearGradient></defs>
                  <CartesianGrid vertical={false} stroke="var(--c-line)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'var(--c-muted)', fontSize: 12 }} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fill: 'var(--c-muted)', fontSize: 12 }} />
                  <Tooltip cursor={{ fill: 'var(--c-raised)' }} content={<ChartTip unit=" min" />} />
                  <Bar dataKey="focusMin" name="Focus" fill="url(#barg)" radius={[6, 6, 2, 2]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState icon={Timer} title="No focus sessions yet" body="Complete a focus session and your week will take shape here." action={<Button variant="primary" size="sm" icon={Play} onClick={() => useSession.getState().start('focus')}>Start focus</Button>} />
          )}
        </Card>

        <Card>
          <CardHeader title="Quick actions" subtitle="One tap away" />
          <div className="space-y-2.5">
            <Button className="w-full justify-start" icon={Play} variant="primary" onClick={() => useSession.getState().start('focus')} disabled={timer.phase === 'focus'}>Start focus session</Button>
            <Button className="w-full justify-start" icon={Coffee} onClick={() => useSession.getState().start(nextBreakKind(cycle))}>Take a break</Button>
            <LockButton />
            <div className="pt-2">
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Profile</div>
              <Segmented size="sm" value={profile.id} onChange={setActiveProfile} options={profiles.map((p) => ({ value: p.id, label: p.name }))} />
            </div>
          </div>
        </Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Wearable" subtitle="Companion wristband" icon={Watch} action={<FeatureBadge feature="wearable" />} />
          {wearable.usable && wearable.state.connected === true ? (
            <Stat label="Battery" value={typeof wearable.state.battery === 'number' ? `${wearable.state.battery}%` : 'Not reported'} hint="Wristband connected" />
          ) : (
            <p className="text-[13px] leading-relaxed text-muted">{wearable.usable ? 'Your wristband is not paired.' : wearable.reason}</p>
          )}
          <Link to="/wearable" className="mt-4 inline-flex items-center gap-1 text-[13px] text-accent hover:underline">Manage wearable <ArrowRight className="size-3.5" /></Link>
        </Card>
        <Card>
          <CardHeader title="System health" subtitle="Connection and sync" icon={Wifi} />
          {liveDown && status === 'idle' ? (
            <p className="text-[13px] text-muted">Nothing to report until a device is connected.</p>
          ) : status === 'connecting' ? (
            <div className="space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-4 w-3/4" /></div>
          ) : (
            <dl className="space-y-2.5 text-sm">
              <div className="flex justify-between"><dt className="text-muted">Connection</dt><dd className="flex items-center gap-2"><StatusDot tone={conn.tone} />{conn.label}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Features connected</dt><dd className="tabular">{status === 'connected' ? `${available} / ${FEATURE_IDS.length}` : '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Wi-Fi signal</dt><dd>{status === 'connected' ? wifi : '—'}</dd></div>
              <div className="flex justify-between"><dt className="text-muted">Last update</dt><dd className="tabular">{lastSeen ? new Date(lastSeen).toLocaleTimeString() : '—'}</dd></div>
            </dl>
          )}
        </Card>
        <Card>
          <CardHeader title="Recent activity" icon={ArrowRight} action={<Link to="/insights" className="text-[13px] text-accent hover:underline">All</Link>} />
          <ActivityList events={events} limit={5} empty={{ title: 'Nothing yet', body: mode === 'live' ? 'Real events from your workspace will appear here.' : 'Interact with the demo to see events.' }} />
        </Card>
      </section>
    </div>
  )
}
