import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { ACTIONS, DEFAULT_RULES, TRIGGERS, type Rule } from '../lib/automation'
import type { FeatureId } from '../lib/features'
import { useDevice, resolveFeature } from './device'

interface AutomationState {
  rules: Rule[]
  update: (id: string, patch: Partial<Rule>) => void
  add: (rule: Rule) => void
  remove: (id: string) => void
  restoreDefaults: () => void
}

export const useAutomation = create<AutomationState>()(
  persist(
    (set) => ({
      rules: DEFAULT_RULES,
      update: (id, patch) => set((s) => ({ rules: s.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),
      add: (rule) => set((s) => ({ rules: [...s.rules, rule] })),
      remove: (id) => set((s) => ({ rules: s.rules.filter((r) => r.id !== id) })),
      restoreDefaults: () => set({ rules: DEFAULT_RULES }),
    }),
    { name: 'adaptivedesk.automation', version: 1 },
  ),
)

export interface RuleAvailability { runnable: boolean; missing: FeatureId[] }

/** A rule only runs when every feature it depends on is connected and usable. */
export function ruleAvailability(rule: Rule, conn: string, features: ReturnType<typeof useDevice.getState>['features']): RuleAvailability {
  const need = [...TRIGGERS[rule.trigger.type].requires, ...ACTIONS[rule.action.type].requires]
  const missing = [...new Set(need)].filter((id) => !resolveFeature(id, conn as never, features[id]).usable)
  return { runnable: missing.length === 0, missing }
}

export function useRuleAvailability(rule: Rule): RuleAvailability {
  const conn = useDevice((s) => s.connection.status)
  const features = useDevice((s) => s.features)
  return ruleAvailability(rule, conn, features)
}
