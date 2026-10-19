import { ChevronDown, ChevronRight, Plus, RotateCcw, Trash2, Workflow, Zap } from 'lucide-react'
import { useState } from 'react'
import { ActivityList } from '../components/shared'
import { Badge, Button, Card, CardHeader, ConfirmDialog, PageHeader, Select, TextInput, Toggle, cn } from '../components/ui/primitives'
import { ACTIONS, CONDITION_LABELS, TRIGGERS, type ActionType, type ConditionType, type Rule, type TriggerType } from '../lib/automation'
import { FEATURES, HAPTIC_PATTERNS } from '../lib/features'
import { fmtRelative } from '../lib/stats'
import { useEvents } from '../store/activity'
import { useAutomation, useRuleAvailability } from '../store/automation'
import { CONTROLS, usePrefs } from '../store/prefs'

const opts = <T extends string>(rec: Record<T, { label: string }>) => (Object.keys(rec) as T[]).map((k) => ({ value: k, label: rec[k].label }))

function conditionText(r: Rule, profiles: { id: string; name: string }[]) {
  const c = r.condition
  switch (c.type) {
    case 'always': return 'Always'
    case 'absenceTimeout': return `Away for ${c.seconds != null && c.seconds >= 60 ? `${c.seconds / 60} min` : `${c.seconds ?? 60} s`}`
    case 'profileIs': return `Profile is ${profiles.find((p) => p.id === c.profileId)?.name ?? '…'}`
    case 'sessionIs': return `Timer is ${c.state ?? 'idle'}`
  }
}

function Block({ tag, text, tone }: { tag: string; text: string; tone: string }) {
  return (
    <div className="min-w-0 flex-1 rounded-xl border border-line bg-raised px-3.5 py-2.5">
      <div className={cn('text-[10px] font-semibold uppercase tracking-widest', tone)}>{tag}</div>
      <div className="mt-0.5 truncate text-[13px] font-medium" title={text}>{text}</div>
    </div>
  )
}

function RuleCard({ rule, onToggle }: { rule: Rule; onToggle: (v: boolean) => void }) {
  const { update, remove } = useAutomation()
  const profiles = usePrefs((s) => s.profiles)
  const avail = useRuleAvailability(rule)
  const events = useEvents()
  const [open, setOpen] = useState(false)
  const last = events.find((e) => e.ruleId === rule.id)
  const runs = events.filter((e) => e.ruleId === rule.id).length

  const setTrigger = (t: TriggerType) => {
    const cond = rule.condition.type === 'absenceTimeout' && t !== 'presence.left' ? { type: 'always' as const } : rule.condition
    update(rule.id, { trigger: { type: t }, condition: cond })
  }
  const setCondition = (type: ConditionType) =>
    update(rule.id, { condition: type === 'absenceTimeout' ? { type, seconds: 60 } : type === 'profileIs' ? { type, profileId: profiles[0].id } : type === 'sessionIs' ? { type, state: 'focus' } : { type } })
  const condOptions = (Object.keys(CONDITION_LABELS) as ConditionType[])
    .filter((c) => c !== 'absenceTimeout' || rule.trigger.type === 'presence.left')
    .map((c) => ({ value: c, label: CONDITION_LABELS[c] }))

  const badge = !rule.enabled ? <Badge>Off</Badge>
    : avail.runnable ? <Badge tone="ok" dot>Active</Badge>
    : <Badge tone="warn" dot>Inactive</Badge>

  return (
    <Card className={cn('p-5 sm:p-5', !rule.enabled && 'opacity-90')}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold tracking-tight">{rule.name}</h3>{badge}{ACTIONS[rule.action.type].sensitive && <Badge tone="danger">Sensitive</Badge>}</div>
          <p className="mt-1 text-[13px] text-muted">{rule.description}</p>
        </div>
        <Toggle label={`Enable ${rule.name}`} checked={rule.enabled} onChange={onToggle} />
      </div>

      <div className="mt-4 flex flex-col items-stretch gap-2 md:flex-row md:items-center">
        <Block tag="When" text={TRIGGERS[rule.trigger.type].label} tone="text-accent" />
        <ChevronRight className="hidden size-4 shrink-0 text-faint md:block" />
        <Block tag="If" text={conditionText(rule, profiles)} tone="text-cyan" />
        <ChevronRight className="hidden size-4 shrink-0 text-faint md:block" />
        <Block tag="Then" text={ACTIONS[rule.action.type].label} tone="text-ok" />
      </div>

      {rule.enabled && !avail.runnable && (
        <p className="mt-3 text-[13px] text-warn">Waiting for: {avail.missing.map((m) => FEATURES[m].label).join(', ')}. This rule will not run until they're connected.</p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-xs text-muted">
        <span>{last ? `Last ran ${fmtRelative(last.ts)} · ${runs} run${runs === 1 ? '' : 's'} logged` : 'Has not run yet'}</span>
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="inline-flex items-center gap-1 text-[13px] text-accent hover:underline">
          {open ? 'Close editor' : 'Edit rule'}<ChevronDown className={cn('size-3.5 transition', open && 'rotate-180')} />
        </button>
      </div>

      {open && (
        <div className="mt-4 grid gap-4 border-t border-line pt-4 sm:grid-cols-2 lg:grid-cols-3">
          <label className="block sm:col-span-2 lg:col-span-1"><span className="mb-1.5 block text-xs font-medium text-muted">Name</span>
            <TextInput value={rule.name} maxLength={50} onChange={(e) => update(rule.id, { name: e.target.value })} /></label>
          <label className="block sm:col-span-2"><span className="mb-1.5 block text-xs font-medium text-muted">Description</span>
            <TextInput value={rule.description} maxLength={140} onChange={(e) => update(rule.id, { description: e.target.value })} /></label>

          <div className="space-y-2"><span className="block text-xs font-medium text-accent">When</span>
            <Select label="Trigger" value={rule.trigger.type} options={opts(TRIGGERS)} onChange={setTrigger} /></div>

          <div className="space-y-2"><span className="block text-xs font-medium text-cyan">If</span>
            <Select label="Condition" value={rule.condition.type} options={condOptions} onChange={setCondition} />
            {rule.condition.type === 'absenceTimeout' && (
              <Select label="Absence timeout" value={rule.condition.seconds ?? 60} onChange={(v) => update(rule.id, { condition: { ...rule.condition, seconds: v } })}
                options={[10, 30, 60, 120, 300, 600].map((s) => ({ value: s, label: s < 60 ? `${s} seconds` : `${s / 60} min` }))} />
            )}
            {rule.condition.type === 'profileIs' && (
              <Select label="Profile" value={rule.condition.profileId ?? profiles[0].id} onChange={(v) => update(rule.id, { condition: { ...rule.condition, profileId: v } })} options={profiles.map((p) => ({ value: p.id, label: p.name }))} />
            )}
            {rule.condition.type === 'sessionIs' && (
              <Select label="Timer state" value={rule.condition.state ?? 'focus'} onChange={(v) => update(rule.id, { condition: { ...rule.condition, state: v } })}
                options={[{ value: 'focus', label: 'Focusing' }, { value: 'break', label: 'On a break' }, { value: 'idle', label: 'Idle' }]} />
            )}
          </div>

          <div className="space-y-2"><span className="block text-xs font-medium text-ok">Then</span>
            <Select label="Action" value={rule.action.type} options={opts(ACTIONS)} onChange={(t: ActionType) => update(rule.id, { action: { type: t, ...(t === 'vibrateWristband' ? { pattern: 'gentle' as const } : {}), ...(t === 'runAssigned' ? { control: 'workspaceAction' } : {}) } })} />
            {rule.action.type === 'vibrateWristband' && (
              <Select label="Pattern" value={rule.action.pattern ?? 'gentle'} onChange={(v) => update(rule.id, { action: { ...rule.action, pattern: v } })} options={HAPTIC_PATTERNS.map((p) => ({ value: p.id, label: p.label }))} />
            )}
            {rule.action.type === 'runAssigned' && rule.trigger.type !== 'control.activated' && (
              <Select label="Control" value={rule.action.control ?? 'workspaceAction'} onChange={(v) => update(rule.id, { action: { ...rule.action, control: v } })} options={CONTROLS.map((c) => ({ value: c.id, label: c.label }))} />
            )}
          </div>

          <div className="flex items-end sm:col-span-2 lg:col-span-3">
            <Button variant="danger" size="sm" icon={Trash2} onClick={() => remove(rule.id)}>Delete rule</Button>
          </div>
        </div>
      )}
    </Card>
  )
}

export default function Automation() {
  const { rules, update, add, restoreDefaults } = useAutomation()
  const events = useEvents().filter((e) => e.category === 'automation')
  const [pending, setPending] = useState<Rule | null>(null)

  const toggle = (r: Rule, v: boolean) => {
    if (v && ACTIONS[r.action.type].sensitive) setPending(r)
    else update(r.id, { enabled: v })
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Automation Studio" subtitle="Build rules that connect what happens at your desk to what your workspace does. Rules wait quietly until the hardware they need is connected."
        actions={<>
          <Button icon={RotateCcw} size="sm" onClick={restoreDefaults}>Restore defaults</Button>
          <Button variant="primary" size="sm" icon={Plus} onClick={() => add({ id: `rule-${Date.now()}`, name: 'New rule', description: 'Describe what this rule is for.', enabled: false, trigger: { type: 'focus.finished' }, condition: { type: 'always' }, action: { type: 'startBreak' } })}>New rule</Button>
        </>} />

      {rules.length === 0 ? (
        <Card><div className="py-10 text-center"><Workflow className="mx-auto mb-3 size-6 text-faint" /><p className="text-sm text-muted">No rules yet. Create one or restore the defaults.</p></div></Card>
      ) : (
        <div className="space-y-4">{rules.map((r) => <RuleCard key={r.id} rule={r} onToggle={(v) => toggle(r, v)} />)}</div>
      )}

      <Card>
        <CardHeader title="Execution history" subtitle="What rules did, and what the device said back." icon={Zap} />
        <ActivityList events={events} limit={10} empty={{ title: 'No rules have run yet', body: 'When a rule runs, the result is recorded here. "Acknowledged" means the device accepted the command, not that it finished.' }} />
      </Card>

      <ConfirmDialog open={!!pending} title="Enable a sensitive rule?" confirmLabel="Enable rule" danger onCancel={() => setPending(null)}
        body={`“${pending?.name}” can ${pending ? ACTIONS[pending.action.type].label.toLowerCase() : ''} automatically while your desk is connected. It never runs on its own after a reconnection.`}
        onConfirm={() => { if (pending) update(pending.id, { enabled: true }); setPending(null) }} />
    </div>
  )
}
