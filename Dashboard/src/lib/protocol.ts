import { isFeatureId, type FeatureId } from './features'

/** AdaptiveDesk wire protocol, v1. JSON text frames over WebSocket. */
export const PROTOCOL_VERSION = 1
export const MAX_MESSAGE_BYTES = 16 * 1024

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue }

export type ReportedStatus = 'active' | 'disabled' | 'connecting' | 'error'

/** What the device says about one feature. `state` holds feature-specific fields. */
export interface FeatureReport {
  available: boolean
  status?: ReportedStatus
  error?: string
  state: Record<string, JsonValue>
}

export interface SystemInfo {
  ssid?: string
  rssi?: number
  uptimeMs?: number
  freeHeap?: number
}

export type DeviceMessage =
  | { type: 'hello'; deviceId: string; name?: string; firmware?: string; board?: string; features: Partial<Record<FeatureId, FeatureReport>>; system?: SystemInfo }
  | { type: 'telemetry'; deviceId: string; timestamp?: number; features: Partial<Record<FeatureId, FeatureReport>>; system?: SystemInfo }
  | { type: 'ack'; requestId: string; ok: boolean; error?: string }
  | { type: 'event'; event: string; feature?: FeatureId; detail?: string; timestamp?: number }
  | { type: 'pong'; timestamp?: number }

export type HostMessage =
  | { protocolVersion: 1; type: 'command'; requestId: string; feature: FeatureId; action: string; value?: JsonValue }
  | { protocolVersion: 1; type: 'ping'; timestamp: number }
  | { protocolVersion: 1; type: 'requestState' }

export type ParseResult = { ok: true; msg: DeviceMessage } | { ok: false; error: string }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown, max = 120): string | undefined => (typeof v === 'string' ? v.slice(0, max) : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

function sanitizeJson(v: unknown, depth = 0): JsonValue | undefined {
  if (depth > 4) return undefined
  if (v === null || typeof v === 'boolean') return v
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  if (typeof v === 'string') return v.slice(0, 200)
  if (Array.isArray(v)) return v.slice(0, 32).map((x) => sanitizeJson(x, depth + 1)).filter((x): x is JsonValue => x !== undefined)
  if (isObj(v)) {
    const out: Record<string, JsonValue> = {}
    for (const [k, val] of Object.entries(v).slice(0, 32)) {
      const s = sanitizeJson(val, depth + 1)
      if (s !== undefined) out[k] = s
    }
    return out
  }
  return undefined
}

function parseFeatures(raw: unknown): Partial<Record<FeatureId, FeatureReport>> {
  const out: Partial<Record<FeatureId, FeatureReport>> = {}
  if (!isObj(raw)) return out
  for (const [id, val] of Object.entries(raw)) {
    if (!isFeatureId(id) || !isObj(val)) continue // unknown features are ignored, never trusted
    const { available, status, error, ...rest } = val
    const state: Record<string, JsonValue> = {}
    for (const [k, v] of Object.entries(rest)) {
      const s = sanitizeJson(v)
      if (s !== undefined) state[k] = s
    }
    out[id] = {
      available: available === true,
      status: status === 'active' || status === 'disabled' || status === 'connecting' || status === 'error' ? status : undefined,
      error: str(error),
      state,
    }
  }
  return out
}

function parseSystem(raw: unknown): SystemInfo | undefined {
  if (!isObj(raw)) return undefined
  return { ssid: str(raw.ssid, 64), rssi: num(raw.rssi), uptimeMs: num(raw.uptimeMs), freeHeap: num(raw.freeHeap) }
}

export function parseDeviceMessage(data: unknown): ParseResult {
  if (typeof data !== 'string') return { ok: false, error: 'Binary frames are not supported' }
  if (data.length > MAX_MESSAGE_BYTES) return { ok: false, error: 'Message too large' }
  let json: unknown
  try { json = JSON.parse(data) } catch { return { ok: false, error: 'Malformed JSON' } }
  if (!isObj(json)) return { ok: false, error: 'Message must be an object' }
  if (json.protocolVersion !== PROTOCOL_VERSION) return { ok: false, error: `Unsupported protocol version ${String(json.protocolVersion)}` }

  switch (json.type) {
    case 'hello':
    case 'telemetry': {
      const deviceId = str(json.deviceId, 64)
      if (!deviceId) return { ok: false, error: `${json.type} missing deviceId` }
      const features = parseFeatures(json.features)
      const system = parseSystem(json.system)
      if (json.type === 'hello') {
        return { ok: true, msg: { type: 'hello', deviceId, name: str(json.name, 64), firmware: str(json.firmware, 32), board: str(json.board, 64), features, system } }
      }
      return { ok: true, msg: { type: 'telemetry', deviceId, timestamp: num(json.timestamp), features, system } }
    }
    case 'ack': {
      const requestId = str(json.requestId, 64)
      if (!requestId || typeof json.ok !== 'boolean') return { ok: false, error: 'Invalid ack' }
      return { ok: true, msg: { type: 'ack', requestId, ok: json.ok, error: str(json.error) } }
    }
    case 'event': {
      const event = str(json.event, 64)
      if (!event) return { ok: false, error: 'Invalid event' }
      return { ok: true, msg: { type: 'event', event, feature: isFeatureId(json.feature) ? json.feature : undefined, detail: str(json.detail, 200), timestamp: num(json.timestamp) } }
    }
    case 'pong':
      return { ok: true, msg: { type: 'pong', timestamp: num(json.timestamp) } }
    default:
      return { ok: false, error: `Unsupported message type "${String(json.type)}"` }
  }
}

export function encode(msg: HostMessage): string {
  return JSON.stringify(msg)
}
