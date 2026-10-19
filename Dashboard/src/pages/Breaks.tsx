import { BellRing, Coffee, History, Timer } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartTip, Stat, TimerPanel } from '../components/shared'
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, Row, Select, Stepper, Toggle } from '../components/ui/primitives'
import { HAPTIC_PATTERNS } from '../lib/features'
import { dailyStats, fmtDuration, fmtTime, todayStat } from '../lib/stats'
import { useFeature } from '../store/device'
import { toast } from '../store/toasts'
import { useActiveProfile, usePrefs } from '../store/prefs'
import { phaseLabel, useSession, useSessions } from '../store/session'

export default function Breaks() {
  const profile = useActiveProfile()
  const update = usePrefs((s) => s.updateProfile)
  const breaks = usePrefs((s) => s.breaks)
  const notif = usePrefs((s) => s.notifications)
  const wearable = usePrefs((s) => s.wearable)
  const set = usePrefs((s) => s.set)
  const sessions = useSessions()
  const cycle = useSession((s) => s.cycle)
  const wear = useFeature('wearable')
  const week = dailyStats(sessions)
  const today = todayStat(sessions)
  const breaksToday = sessions.filter((s) => s.kind !== 'focus' && s.startedAt >= week[week.length - 1].date).length
  const rate = today.sessions ? Math.round((today.completed / today.sessions) * 100) : null
  const untilLong = breaks.longEvery - (cycle % breaks.longEvery)

  const enableBrowser = async (v: boolean) => {
    if (!v) return set({ notifications: { ...notif, browser: false } })
    if (typeof Notification === 'undefined') return toast({ tone: 'warn', title: 'Not supported', detail: 'This browser does not support desktop notifications.' })
    const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
    if (perm === 'granted') set({ notifications: { ...notif, browser: true } })
    else toast({ tone: 'warn', title: 'Notifications blocked', detail: 'Allow notifications for this site in your browser settings.' })
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Break Management" subtitle="Protect your focus and your health with sessions that know when to stop." />

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader title="Current session" subtitle={`${profile.name} profile`} icon={Timer} />
          <div className="flex justify-center py-2"><TimerPanel size={200} /></div>
          <p className="mt-4 text-center text-[13px] text-muted">
            {breaks.longEvery > 0 && <>Long break after <b className="text-ink">{untilLong}</b> more focus session{untilLong === 1 ? '' : 's'}.</>}
          </p>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader title="Today" subtitle="Based on sessions you've run in this dashboard" icon={Coffee} />
          <div className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            <Stat label="Focus" value={fmtDuration(today.focusMin)} />
            <Stat label="Sessions" value={today.sessions} hint={rate !== null ? `${rate}% completed` : undefined} />
            <Stat label="Breaks" value={breaksToday} />
            <Stat label="Long break in" value={untilLong} hint="focus sessions" />
          </div>
          <div className="mt-6 h-48">
            {week.some((d) => d.focusMin + d.breakMin > 0) ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={week} margin={{ left: -18, right: 4 }}>
                  <CartesianGrid vertical={false} stroke="var(--c-line)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'var(--c-muted)', fontSize: 12 }} />
                  <YAxis tickLine={false} axisLine={false} tick={{ fill: 'var(--c-muted)', fontSize: 12 }} />
                  <Tooltip cursor={{ fill: 'var(--c-raised)' }} content={<ChartTip unit=" min" />} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12, color: 'var(--c-muted)' }} />
                  <Bar dataKey="focusMin" name="Focus" stackId="a" fill="var(--c-accent)" maxBarSize={30} />
                  <Bar dataKey="breakMin" name="Breaks" stackId="a" fill="var(--c-ok)" radius={[5, 5, 0, 0]} maxBarSize={30} />
                </BarChart>
              </ResponsiveContainer>
            ) : <EmptyState compact icon={Coffee} title="No sessions yet" body="Your daily summary builds from real focus and break sessions." />}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Intervals" subtitle={`Applies to the ${profile.name} profile`} icon={Timer} />
          <Row title="Work interval"><Stepper label="work interval" value={profile.focusMin} min={5} max={120} step={5} unit="m" onChange={(v) => update(profile.id, { focusMin: v })} /></Row>
          <Row title="Short break"><Stepper label="short break" value={profile.shortBreakMin} min={1} max={30} unit="m" onChange={(v) => update(profile.id, { shortBreakMin: v })} /></Row>
          <Row title="Long break"><Stepper label="long break" value={profile.longBreakMin} min={5} max={60} step={5} unit="m" onChange={(v) => update(profile.id, { longBreakMin: v })} /></Row>
          <Row title="Long break every" hint="Number of focus sessions between long breaks."><Stepper label="long break interval" value={breaks.longEvery} min={2} max={8} unit="×" onChange={(v) => set({ breaks: { ...breaks, longEvery: v } })} /></Row>
          <Row title="Start breaks automatically"><Toggle label="Start breaks automatically" checked={breaks.autoStartBreak} onChange={(v) => set({ breaks: { ...breaks, autoStartBreak: v } })} /></Row>
          <Row title="Start focus after a break"><Toggle label="Start focus after a break" checked={breaks.autoStartFocus} onChange={(v) => set({ breaks: { ...breaks, autoStartFocus: v } })} /></Row>
        </Card>

        <Card>
          <CardHeader title="Reminders" subtitle="How you'd like to be nudged." icon={BellRing} />
          <Row title="Heads-up before a break" hint="Shown this long before a focus session ends. Set to 0 to disable.">
            <Stepper label="heads-up" value={breaks.warnMin} min={0} max={10} unit="m" onChange={(v) => set({ breaks: { ...breaks, warnMin: v } })} />
          </Row>
          <Row title="In-app alerts"><Toggle label="In-app alerts" checked={notif.inApp} onChange={(v) => set({ notifications: { ...notif, inApp: v } })} /></Row>
          <Row title="Sound"><Toggle label="Sound" checked={notif.sound} onChange={(v) => set({ notifications: { ...notif, sound: v } })} /></Row>
          <Row title="Desktop notifications" hint="Needs your browser's permission."><Toggle label="Desktop notifications" checked={notif.browser} onChange={enableBrowser} /></Row>
          <Row title="Vibrate wristband at break time" hint={wear.usable && wear.state.connected === true ? 'Wristband connected.' : 'Takes effect when a wristband is connected.'}>
            <div className="flex items-center gap-3">
              <Select label="Break pattern" className="w-36" value={wearable.patterns.breakReminder} options={HAPTIC_PATTERNS.map((p) => ({ value: p.id, label: p.label }))}
                onChange={(v) => set({ wearable: { ...wearable, patterns: { ...wearable.patterns, breakReminder: v } } })} />
              <Toggle label="Vibrate wristband at break time" checked={wearable.events.breakReminder} onChange={(v) => set({ wearable: { ...wearable, events: { ...wearable.events, breakReminder: v } } })} />
            </div>
          </Row>
        </Card>
      </div>

      <Card>
        <CardHeader title="Session history" subtitle="Your most recent sessions" icon={History}
          action={sessions.length > 0 && <Button size="sm" variant="ghost" onClick={() => useSession.getState().clearHistory(usePrefs.getState().mode)}>Clear</Button>} />
        {sessions.length === 0 ? (
          <EmptyState compact icon={History} title="No sessions recorded" body="Start a focus session. Completed and ended sessions are saved here." />
        ) : (
          <div className="overflow-x-auto scroll-thin">
            <table className="w-full min-w-[480px] text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-wider text-muted"><th className="pb-2 font-medium">Session</th><th className="pb-2 font-medium">Started</th><th className="pb-2 text-right font-medium">Length</th><th className="pb-2 text-right font-medium">Result</th></tr></thead>
              <tbody>
                {sessions.slice(0, 12).map((s) => (
                  <tr key={s.id} className="border-t border-line">
                    <td className="py-2.5 font-medium">{phaseLabel(s.kind)}</td>
                    <td className="py-2.5 text-muted">{new Date(s.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {fmtTime(s.startedAt)}</td>
                    <td className="tabular py-2.5 text-right">{fmtDuration(s.actualMs / 60000)} <span className="text-faint">/ {fmtDuration(s.plannedMs / 60000)}</span></td>
                    <td className="py-2.5 text-right">{s.completed ? <Badge tone="ok">Completed</Badge> : <Badge tone="warn">Ended early</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
