import { BellRing, Cpu, FlaskConical, Gauge, Plug, SlidersVertical, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { runCommand, useDevice, useFeature } from '../store/device'
import { usePrefs } from '../store/prefs'
import { ConnectEsp32Button } from './SerialPanel'
import { Badge, Button, Card, CardHeader, EmptyState, FeatureGate, Slider, Toggle, cn } from './ui/primitives'

const PRESETS = [
  { name: 'Cyan', hex: '#00a0ff' }, { name: 'Violet', hex: '#8b5cf6' }, { name: 'Green', hex: '#22c55e' },
  { name: 'Amber', hex: '#f59e0b' }, { name: 'Red', hex: '#ef4444' }, { name: 'White', hex: '#ffffff' },
]

const num = (v: unknown, fallback = 0) => (typeof v === 'number' ? v : fallback)

/** Rolling window of the last few seconds of REAL reported values. Cleared whenever the device isn't usable. */
function useHistory(value: number | null, max = 80) {
  const [points, setPoints] = useState<number[]>([])
  useEffect(() => {
    if (value === null) { setPoints([]); return }
    setPoints((p) => [...p.slice(-(max - 1)), value])
  }, [value, max])
  return points
}

function Sparkline({ points, threshold }: { points: number[]; threshold: number }) {
  const w = 200, h = 40
  const path = points.map((v, i) => `${(i / Math.max(1, 79)) * w},${h - (v / 100) * h}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-10 w-full" preserveAspectRatio="none" aria-hidden>
      <line x1="0" x2={w} y1={h - (threshold / 100) * h} y2={h - (threshold / 100) * h} stroke="var(--c-warn)" strokeDasharray="3 3" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      {points.length > 1 && <polyline points={path} fill="none" stroke="var(--c-cyan)" strokeWidth="1.8" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
    </svg>
  )
}

function Meter({ value, marker, tone = 'accent' }: { value: number; marker?: number; tone?: 'accent' | 'warn' }) {
  return (
    <div className="relative h-3 overflow-hidden rounded-full bg-raised">
      <div className={cn('h-full rounded-full transition-[width] duration-100', tone === 'warn' ? 'bg-warn' : 'bg-gradient-to-r from-accent to-cyan')} style={{ width: `${value}%` }} />
      {marker !== undefined && <div className="absolute inset-y-0 w-0.5 bg-ink/70" style={{ left: `${marker}%` }} title={`Threshold ${marker}%`} />}
    </div>
  )
}

function ColorControl({ color, enabled }: { color: string; enabled: boolean }) {
  const [draft, setDraft] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const send = (hex: string) => {
    setDraft(hex)
    clearTimeout(timer.current)
    // Debounced so dragging the picker doesn't flood the device with commands.
    timer.current = setTimeout(() => { void runCommand('ambientLighting', 'setColor', hex).finally(() => setDraft(null)) }, 200)
  }
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="relative size-9 cursor-pointer overflow-hidden rounded-xl border border-line" title="Pick a colour">
        <input type="color" aria-label="LED colour" value={draft ?? color} onChange={(e) => send(e.target.value)} className="absolute -inset-2 size-14 cursor-pointer border-0 bg-transparent p-0" />
      </label>
      {PRESETS.map((p) => (
        <button key={p.hex} aria-label={`Set LED colour to ${p.name}`} title={p.name} onClick={() => send(p.hex)}
          className={cn('size-7 rounded-full border-2 transition hover:scale-110', color.toLowerCase() === p.hex ? 'border-ink' : 'border-line')} style={{ background: p.hex, opacity: enabled ? 1 : 0.6 }} />
      ))}
    </div>
  )
}

export default function HardwareDemo() {
  const mode = usePrefs((s) => s.mode)
  const transport = usePrefs((s) => s.device.transport)
  const connError = useDevice((s) => s.connection.error)
  const slide = useFeature('slideControl')
  const pressure = useFeature('pressureSensing')
  const light = useFeature('ambientLighting')
  const buzzer = useFeature('audioAlert')
  const any = slide.usable || pressure.usable || buzzer.usable || light.usable

  const pos = slide.usable ? num(slide.state.position) : null
  const value = pressure.usable ? num(pressure.state.value) : null
  const threshold = num(pressure.state.threshold, 40)
  const pressed = pressure.state.pressed === true
  const history = useHistory(value)

  const ledOn = light.state.enabled === true
  const color = typeof light.state.color === 'string' ? light.state.color : '#00a0ff'
  const brightness = num(light.state.brightness)
  const physical = light.state.brightnessSource === 'physical'
  const muted = buzzer.state.muted === true
  const sounding = buzzer.state.active === true

  return (
    <Card aria-label="Hardware demo">
      <CardHeader icon={Cpu} title="Hardware demo" subtitle="Slide control, pressure pad, RGB light and buzzer, live from the console."
        action={mode === 'demo' ? <Badge tone="info"><FlaskConical className="size-3.5" />Simulated</Badge> : <Badge tone={any ? 'ok' : 'neutral'} dot>{any ? 'Live hardware' : 'Waiting for device'}</Badge>} />

      {!any ? (
        <EmptyState icon={Plug} title="No hardware connected" body={mode === 'live' ? (connError && transport === 'serial' ? connError : `${slide.reason ?? 'Connect your AdaptiveDesk to see live readings here.'}`) : 'The demo device is not running.'}
          action={mode === 'live' ? (transport === 'serial' ? <ConnectEsp32Button size="sm" /> : <Link to="/settings"><Button variant="primary" size="sm" icon={Plug}>Connect device</Button></Link>) : undefined} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <section className="rounded-2xl border border-line bg-raised/40 p-4" aria-label="Slide control">
            <FeatureGate feature="slideControl">
              <div className="mb-3 flex items-center gap-2 text-sm font-medium"><SlidersVertical className="size-4 text-accent" />Slide control → brightness</div>
              <div className="flex items-end justify-between"><div className="tabular text-4xl font-semibold tracking-tight">{pos ?? '--'}<span className="text-lg text-muted">%</span></div>
                <div className="text-right text-[13px] text-muted">LED brightness<div className="tabular text-base text-ink">{light.usable ? `${brightness}%` : '--'}</div></div></div>
              <div className="mt-3"><Meter value={pos ?? 0} /></div>
              {typeof slide.state.raw === 'number' && <div className="mt-2 text-xs text-faint">ADC raw {slide.state.raw}</div>}
            </FeatureGate>
          </section>

          <section className="rounded-2xl border border-line bg-raised/40 p-4" aria-label="Pressure sensing">
            <FeatureGate feature="pressureSensing">
              <div className="mb-3 flex items-center justify-between gap-2"><div className="flex items-center gap-2 text-sm font-medium"><Gauge className="size-4 text-accent" />Pressure</div>
                {pressure.usable && <Badge tone={pressed ? 'warn' : 'neutral'} dot>{pressed ? 'Pressed' : 'Released'}</Badge>}</div>
              <div className="tabular text-4xl font-semibold tracking-tight">{value ?? '--'}<span className="text-lg text-muted">%</span></div>
              <div className="mt-3"><Meter value={value ?? 0} marker={threshold} tone={pressed ? 'warn' : 'accent'} /></div>
              <div className="mt-2"><Sparkline points={history} threshold={threshold} /></div>
              <div className="mt-3 text-xs font-medium uppercase tracking-wider text-muted">Buzzer threshold</div>
              <Slider label="Pressure threshold" min={5} max={95} value={threshold} onCommit={(v) => void runCommand('pressureSensing', 'setThreshold', v)} />
              {typeof pressure.state.raw === 'number' && <div className="mt-1 text-xs text-faint">ADC raw {pressure.state.raw}</div>}
            </FeatureGate>
          </section>

          <section className="rounded-2xl border border-line bg-raised/40 p-4" aria-label="RGB light">
            <FeatureGate feature="ambientLighting">
              <div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2 text-sm font-medium"><span className="size-4 rounded-full border border-line" style={{ background: ledOn ? color : 'transparent' }} />RGB light</div>
                <Toggle label="RGB light" checked={ledOn} pending={light.pending} onChange={(v) => void runCommand('ambientLighting', 'setEnabled', v)} /></div>
              <div className="flex items-center gap-4">
                <div className="size-16 shrink-0 rounded-2xl border border-line transition" style={{ background: ledOn ? color : 'var(--c-raised)', opacity: ledOn ? 0.25 + (physical ? brightness : 100) / 133 : 1, boxShadow: ledOn ? `0 0 ${10 + brightness / 2}px ${color}` : 'none' }} />
                <div className="text-sm"><div className="font-medium">{ledOn ? 'On' : 'Off'} · <span className="font-mono text-[13px] uppercase">{color}</span></div>
                  <div className="text-[13px] text-muted">Brightness {brightness}%{physical ? ' (slide control)' : ''}</div></div>
              </div>
              <div className="mt-4"><ColorControl color={color} enabled={ledOn} /></div>
            </FeatureGate>
          </section>

          <section className="rounded-2xl border border-line bg-raised/40 p-4" aria-label="Buzzer">
            <FeatureGate feature="audioAlert">
              <div className="mb-3 flex items-center justify-between gap-2"><div className="flex items-center gap-2 text-sm font-medium"><BellRing className="size-4 text-accent" />Buzzer</div>
                {buzzer.usable && <Badge tone={sounding ? 'danger' : muted ? 'warn' : 'neutral'} dot>{sounding ? 'Sounding' : muted ? 'Muted' : 'Idle'}</Badge>}</div>
              <p className="text-[13px] leading-relaxed text-muted">Sounds while pressure stays above the threshold.</p>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <Button icon={Volume2} disabled={muted} loading={buzzer.pending} onClick={() => void runCommand('audioAlert', 'test')}>Test buzzer</Button>
                <div className="flex items-center gap-2 text-sm"><Toggle label="Mute buzzer" checked={muted} onChange={(v) => void runCommand('audioAlert', 'setMuted', v)} /><span className="flex items-center gap-1.5 text-muted">{muted && <VolumeX className="size-4" />}Mute</span></div>
              </div>
            </FeatureGate>
          </section>
        </div>
      )}
      <p className="mt-4 text-xs text-faint">{mode === 'demo' ? 'All values here are simulated by Demo Mode.' : 'Values and states are exactly what your console reports. Controls take effect only when the console confirms them.'}</p>
    </Card>
  )
}
