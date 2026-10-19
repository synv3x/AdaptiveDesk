import { motion } from 'motion/react'
import { BookOpen, Briefcase, Gamepad2, Keyboard, Pause, Play, Plus, SkipBack, SkipForward, Sparkles, Trash2, Volume2, type LucideIcon } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ChartTip, Stat, TimerPanel } from '../components/shared'
import { Badge, Button, Card, CardHeader, EmptyState, FeatureBadge, FeatureGate, PageHeader, Row, Select, Slider, Stepper, TextInput, Toggle, cn } from '../components/ui/primitives'
import { LIGHT_SCENES } from '../lib/features'
import { MAPPING_ACTIONS } from '../lib/automation'
import { dailyStats, fmtDuration, todayStat } from '../lib/stats'
import { setActiveProfile } from '../services/runtime'
import { runCommand, useFeature } from '../store/device'
import { CONTROLS, usePrefs, type ProfileIcon } from '../store/prefs'
import { useSessions } from '../store/session'
import { Timer } from 'lucide-react'

const ICONS: Record<ProfileIcon, LucideIcon> = { briefcase: Briefcase, book: BookOpen, gamepad: Gamepad2, sparkles: Sparkles }

function ControlRow({ id, label, hint, feature }: { id: (typeof CONTROLS)[number]['id']; label: string; hint: string; feature: (typeof CONTROLS)[number]['feature'] }) {
  const f = useFeature(feature)
  const value = usePrefs((s) => s.mappings[id])
  const set = usePrefs((s) => s.set)
  const mappings = usePrefs((s) => s.mappings)
  return (
    <Row title={label} hint={`${hint}${f.usable ? '' : ' · Inactive until connected'}`}>
      <div className="flex items-center gap-3">
        <FeatureBadge feature={feature} />
        <Select label={`${label} action`} className="w-56" value={value} options={MAPPING_ACTIONS.map((a) => ({ value: a.id, label: a.label }))}
          onChange={(v) => set({ mappings: { ...mappings, [id]: v } })} />
      </div>
    </Row>
  )
}

export default function Productivity() {
  const profiles = usePrefs((s) => s.profiles)
  const activeId = usePrefs((s) => s.activeProfileId)
  const update = usePrefs((s) => s.updateProfile)
  const macros = usePrefs((s) => s.macros)
  const set = usePrefs((s) => s.set)
  const sessions = useSessions()
  const media = useFeature('mediaControl')
  const lighting = useFeature('ambientLighting')
  const active = profiles.find((p) => p.id === activeId) ?? profiles[0]
  const week = dailyStats(sessions)
  const today = todayStat(sessions)
  const volume = typeof media.state.volume === 'number' ? media.state.volume : 0
  const playing = media.state.playing === true

  return (
    <div className="space-y-6">
      <PageHeader title="Productivity Hub" subtitle="Profiles, focus sessions, shortcuts and media, all in one place." />

      <section aria-label="Profiles" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {profiles.map((p) => {
          const Icon = ICONS[p.icon]
          const on = p.id === activeId
          return (
            <button key={p.id} onClick={() => setActiveProfile(p.id)} aria-pressed={on}
              className={cn('card relative rounded-2xl p-4 text-left transition hover:border-accent/40', on && 'border-accent/60')}>
              {on && <motion.span layoutId="profile-ring" className="pointer-events-none absolute inset-0 rounded-2xl ring-1 ring-accent/50 shadow-[0_0_40px_-12px_var(--c-accent)]" />}
              <span className={cn('grid size-10 place-items-center rounded-xl', on ? 'bg-accent text-white' : 'bg-raised text-muted')}><Icon className="size-5" /></span>
              <div className="mt-3 flex items-center gap-2 font-semibold">{p.name}{on && <Badge tone="info">Active</Badge>}</div>
              <div className="mt-0.5 text-[13px] leading-snug text-muted">{p.description}</div>
              <div className="tabular mt-3 text-xs text-faint">{p.focusMin} / {p.shortBreakMin} / {p.longBreakMin} min</div>
            </button>
          )
        })}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title={`Customize ${active.name}`} subtitle="Changes save automatically." icon={Sparkles} />
          <Row title="Name"><TextInput aria-label="Profile name" className="w-48" value={active.name} maxLength={20} onChange={(e) => update(active.id, { name: e.target.value || active.name })} /></Row>
          <Row title="Focus length"><Stepper label="focus length" value={active.focusMin} min={5} max={120} step={5} unit="m" onChange={(v) => update(active.id, { focusMin: v })} /></Row>
          <Row title="Short break"><Stepper label="short break" value={active.shortBreakMin} min={1} max={30} unit="m" onChange={(v) => update(active.id, { shortBreakMin: v })} /></Row>
          <Row title="Long break"><Stepper label="long break" value={active.longBreakMin} min={5} max={60} step={5} unit="m" onChange={(v) => update(active.id, { longBreakMin: v })} /></Row>
          <Row title="Apply lighting preset" hint={lighting.usable ? 'Sent to your desk when you switch to this profile.' : 'Takes effect once lighting is connected.'}>
            <Toggle label="Apply lighting preset" checked={active.lighting.apply} onChange={(v) => update(active.id, { lighting: { ...active.lighting, apply: v } })} />
          </Row>
          {active.lighting.apply && (
            <>
              <Row title="Lights on"><Toggle label="Lights on" checked={active.lighting.enabled} onChange={(v) => update(active.id, { lighting: { ...active.lighting, enabled: v } })} /></Row>
              <Row title="Brightness" hint="Used only if your lighting supports dimming."><div className="w-48"><Slider label="Preset brightness" value={active.lighting.brightness} onCommit={(v) => update(active.id, { lighting: { ...active.lighting, brightness: v } })} /></div></Row>
              <Row title="Scene" hint="Used only if your lighting supports scenes.">
                <Select label="Scene" className="w-40" value={active.lighting.scene} options={LIGHT_SCENES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) }))} onChange={(v) => update(active.id, { lighting: { ...active.lighting, scene: v } })} />
              </Row>
            </>
          )}
        </Card>

        <Card>
          <CardHeader title="Focus session" subtitle={`${active.name} profile`} icon={Timer} />
          <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
            <TimerPanel size={170} />
            <div className="grid w-full grid-cols-2 gap-4 sm:grid-cols-1">
              <Stat label="Today" value={fmtDuration(today.focusMin)} hint={`${today.sessions} focus session${today.sessions === 1 ? '' : 's'}`} />
              <Stat label="Completed" value={`${today.completed}`} hint="Sessions finished today" />
            </div>
          </div>
          <div className="mt-6 border-t border-line pt-4">
            <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted">Last 7 days</div>
            {week.some((d) => d.focusMin > 0) ? (
              <div className="h-32">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={week} margin={{ left: -24, right: 4 }}>
                    <CartesianGrid vertical={false} stroke="var(--c-line)" />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: 'var(--c-muted)', fontSize: 11 }} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fill: 'var(--c-muted)', fontSize: 11 }} />
                    <Tooltip cursor={{ fill: 'var(--c-raised)' }} content={<ChartTip unit=" min" />} />
                    <Bar dataKey="focusMin" name="Focus" fill="var(--c-accent)" radius={[5, 5, 1, 1]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : <p className="text-[13px] text-muted">Your activity overview appears after your first focus session.</p>}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Media controls" subtitle="Playback and volume for your computer." icon={Volume2} action={<FeatureBadge feature="mediaControl" />} />
        <FeatureGate feature="mediaControl">
          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-2">
              <Button aria-label="Previous track" icon={SkipBack} onClick={() => void runCommand('mediaControl', 'previous')} />
              <Button variant="primary" aria-label={playing ? 'Pause' : 'Play'} icon={playing ? Pause : Play} loading={media.pending} onClick={() => void runCommand('mediaControl', 'playPause')} />
              <Button aria-label="Next track" icon={SkipForward} onClick={() => void runCommand('mediaControl', 'next')} />
            </div>
            <div className="min-w-48 flex-1"><Slider label="Volume" value={volume} onCommit={(v) => void runCommand('mediaControl', 'setVolume', v)} /></div>
          </div>
        </FeatureGate>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Control mapping" subtitle="Choose what each physical control does." icon={Keyboard} />
          {CONTROLS.map((c) => <ControlRow key={c.id} {...c} />)}
          <p className="mt-4 text-xs leading-relaxed text-faint">Press-style controls run their action from the dashboard. Dial actions such as volume are handled on the console once supported.</p>
        </Card>

        <Card>
          <CardHeader title="Shortcuts & macros" subtitle="Key combinations you use often." icon={Keyboard}
            action={<Badge tone="neutral">Saved locally</Badge>} />
          {macros.length === 0 && <EmptyState compact icon={Keyboard} title="No macros yet" body="Add a shortcut to keep it handy." />}
          <ul className="space-y-2.5">
            {macros.map((m) => (
              <li key={m.id} className="flex items-center gap-2">
                <TextInput aria-label="Macro name" value={m.name} maxLength={32} onChange={(e) => set({ macros: macros.map((x) => (x.id === m.id ? { ...x, name: e.target.value } : x)) })} />
                <TextInput aria-label="Key combination" className="w-40 font-mono text-[13px]" value={m.keys} maxLength={32} placeholder="Ctrl+Alt+K" onChange={(e) => set({ macros: macros.map((x) => (x.id === m.id ? { ...x, keys: e.target.value } : x)) })} />
                <Button variant="ghost" size="sm" aria-label={`Delete ${m.name}`} icon={Trash2} onClick={() => set({ macros: macros.filter((x) => x.id !== m.id) })} />
              </li>
            ))}
          </ul>
          <Button className="mt-4" size="sm" icon={Plus} onClick={() => set({ macros: [...macros, { id: `m${Date.now()}`, name: 'New macro', keys: '' }] })}>Add macro</Button>
          <p className="mt-4 text-xs leading-relaxed text-faint">Macros are stored in this browser. Sending them from your console needs keyboard support in the console firmware, which isn't available yet.</p>
        </Card>
      </div>
    </div>
  )
}
