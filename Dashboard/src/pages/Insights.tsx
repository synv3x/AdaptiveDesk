import { Activity, FlaskConical, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ActivityList, CATEGORY_META, ChartTip, Stat } from '../components/shared'
import { Badge, Button, Card, CardHeader, ConfirmDialog, EmptyState, PageHeader, Segmented } from '../components/ui/primitives'
import { useNow } from '../hooks/useNow'
import { dailyStats, fmtDuration, hourlyBuckets } from '../lib/stats'
import { useActivity, useEvents, type ActivityCategory } from '../store/activity'
import { usePrefs } from '../store/prefs'
import { useSessions } from '../store/session'

const CATS = Object.keys(CATEGORY_META).filter((c) => c !== 'system') as ActivityCategory[]

export default function Insights() {
  const mode = usePrefs((s) => s.mode)
  const events = useEvents()
  const sessions = useSessions()
  const now = useNow(60_000)
  const [filter, setFilter] = useState<'all' | ActivityCategory>('all')
  const [confirm, setConfirm] = useState(false)

  const week = useMemo(() => dailyStats(sessions), [sessions, now])
  const hourly = useMemo(() => hourlyBuckets(events).map((b) => ({ label: b.label, ...b.counts })), [events, now])
  const weekAgo = Date.now() - 7 * 86_400_000
  const count = (cat: ActivityCategory, since = weekAgo) => events.filter((e) => e.category === cat && e.ts >= since).length
  const focus = week.reduce((a, d) => a + d.focusMin, 0)
  const breaks = sessions.filter((s) => s.kind !== 'focus' && s.startedAt >= weekAgo).length
  const mix = CATS.map((c) => ({ name: CATEGORY_META[c].label, value: events.filter((e) => e.category === c).length, color: CATEGORY_META[c].color })).filter((m) => m.value > 0)
  const filtered = filter === 'all' ? events : events.filter((e) => e.category === filter)
  const hasHourly = hourly.some((h) => CATS.some((c) => (h as unknown as Record<string, number>)[c] > 0))

  return (
    <div className="space-y-6">
      <PageHeader title="Activity & Insights" subtitle={mode === 'live' ? 'Everything here comes from real sessions and real device events. Nothing is estimated or filled in.' : 'You are viewing simulated sample data from Demo Mode.'}
        actions={mode === 'demo' ? <Badge tone="info"><FlaskConical className="size-3.5" />Sample data</Badge> : <Badge tone="ok" dot>Real data only</Badge>} />

      <Card>
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Focus · 7d" value={fmtDuration(focus)} />
          <Stat label="Breaks · 7d" value={breaks} />
          <Stat label="Presence · 7d" value={count('presence')} />
          <Stat label="Security · 7d" value={count('security')} />
          <Stat label="Automations · 7d" value={count('automation')} />
          <Stat label="Device · 7d" value={count('device')} />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Focus & breaks" subtitle="Minutes per day, last 7 days" icon={Activity} />
          <div className="h-60">
            {focus > 0 || breaks > 0 ? (
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
            ) : <EmptyState compact icon={Activity} title="No sessions yet" body="Run a focus session and it shows up here." />}
          </div>
        </Card>

        <Card>
          <CardHeader title="Workspace activity" subtitle="Events per hour, last 24 hours" icon={Activity} />
          <div className="h-60">
            {hasHourly ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={hourly} margin={{ left: -22, right: 4 }}>
                  <CartesianGrid vertical={false} stroke="var(--c-line)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} interval={3} tick={{ fill: 'var(--c-muted)', fontSize: 11 }} />
                  <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: 'var(--c-muted)', fontSize: 11 }} />
                  <Tooltip content={<ChartTip />} />
                  {(['focus', 'presence', 'device', 'automation'] as ActivityCategory[]).map((c) => (
                    <Area key={c} type="monotone" dataKey={c} name={CATEGORY_META[c].label} stackId="1" stroke={CATEGORY_META[c].color} fill={CATEGORY_META[c].color} fillOpacity={0.22} />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            ) : <EmptyState compact icon={Activity} title="No activity in the last 24 hours" body={mode === 'live' ? 'Events appear as your desk reports them.' : 'Interact with the demo to generate activity.'} />}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Event mix" subtitle="Everything recorded" />
          {mix.length > 0 ? (
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={mix} dataKey="value" nameKey="name" innerRadius={52} outerRadius={78} paddingAngle={3} stroke="none">
                    {mix.map((m) => <Cell key={m.name} fill={m.color} />)}
                  </Pie>
                  <Tooltip content={<ChartTip />} />
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 12, color: 'var(--c-muted)' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          ) : <EmptyState compact icon={Activity} title="Nothing recorded" body="Your event mix appears here." />}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Event log" subtitle="Presence, security, automation and device events" action={events.length > 0 && <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setConfirm(true)}>Clear</Button>} />
          <div className="mb-4"><Segmented size="sm" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All' }, ...CATS.map((c) => ({ value: c, label: CATEGORY_META[c].label }))]} /></div>
          <div className="max-h-96 overflow-y-auto pr-1 scroll-thin">
            <ActivityList events={filtered} limit={60} empty={{ title: 'No matching events', body: events.length ? 'Try a different filter.' : mode === 'live' ? 'Real events will be recorded as they happen.' : 'Interact with the demo to create events.' }} />
          </div>
        </Card>
      </div>

      <ConfirmDialog open={confirm} title={`Clear ${mode === 'demo' ? 'demo' : 'live'} event log?`} confirmLabel="Clear log" danger onCancel={() => setConfirm(false)}
        body="This removes the recorded events for the current mode. Session history is kept." onConfirm={() => { useActivity.getState().clear(mode); setConfirm(false) }} />
    </div>
  )
}
