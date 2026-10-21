export const STARTUP_STAGES = { idea: 'Идея', prototype: 'Прототип', pilot: 'Пилот', sales: 'Продажи' } as const
export const STARTUP_TERMS = { paid: 'Оплачиваемая работа', educational: 'Учебный проект', volunteer: 'Без оплаты', equity: 'Доля по отдельному соглашению' } as const
export type StartupFieldsValue = {
  project_kind: 'project' | 'startup'
  startup_stage: keyof typeof STARTUP_STAGES | null
  participation_terms: keyof typeof STARTUP_TERMS | null
}
export const EMPTY_STARTUP: StartupFieldsValue = { project_kind: 'project', startup_stage: null, participation_terms: null }
export function startupPayload(value: StartupFieldsValue): StartupFieldsValue {
  return value.project_kind === 'startup' ? { project_kind: 'startup', startup_stage: value.startup_stage, participation_terms: value.participation_terms } : { ...EMPTY_STARTUP }
}
