/** Tiny typed event bus connecting device events, timers and the automation engine. */
export type BusEvent =
  | 'presence.arrived'
  | 'presence.left'
  | 'workspaceAction.pressed'
  | 'control.activated'
  | 'focus.started'
  | 'focus.finished'
  | 'break.started'
  | 'break.finished'
  | 'profile.changed'
  | 'security.alert'

type Handler = (payload?: Record<string, unknown>) => void
const handlers = new Map<BusEvent, Set<Handler>>()

export function on(event: BusEvent, fn: Handler): () => void {
  if (!handlers.has(event)) handlers.set(event, new Set())
  handlers.get(event)!.add(fn)
  return () => handlers.get(event)?.delete(fn)
}

export function emit(event: BusEvent, payload?: Record<string, unknown>) {
  handlers.get(event)?.forEach((fn) => {
    try { fn(payload) } catch (e) { console.error('[bus]', event, e) }
  })
}

export const ALL_BUS_EVENTS: BusEvent[] = [
  'presence.arrived', 'presence.left', 'workspaceAction.pressed', 'control.activated',
  'focus.started', 'focus.finished', 'break.started', 'break.finished', 'profile.changed', 'security.alert',
]
