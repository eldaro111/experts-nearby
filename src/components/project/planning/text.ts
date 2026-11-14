// Labels and formatting of the planning interface. Every label passes through useT() at render time;
// English entries live in src/lib/translations.ts.
import type { PlanningMode, PlanningRoleName, SprintOutcome, SprintState, StageCategory } from '@/lib/planning'

export const MODE_TEXT: Record<PlanningMode, { label: string; description: string }> = {
  simple: { label: 'Простой', description: 'Доска «Нужно сделать / В работе / Готово». Этапы и WIP-лимиты не действуют.' },
  kanban: { label: 'Kanban', description: 'Этапы с правилами и WIP-лимитами, без спринтов.' },
  scrum: { label: 'Scrum', description: 'Бэклог и спринты: цель, даты, состав, явный старт и завершение с решением по каждой задаче.' },
  custom: { label: 'Свой процесс', description: 'Собственные этапы и правила без спринтов.' },
}

export const ROLE_TEXT: Record<PlanningRoleName, string> = {
  product_owner: 'Product Owner',
  scrum_master: 'Scrum Master',
  developer: 'Разработчик',
}

export const CATEGORY_TEXT: Record<StageCategory, string> = { todo: 'К выполнению', doing: 'В работе', done: 'Готово' }

export const STATE_TEXT: Record<SprintState, string> = { planned: 'Планируется', active: 'Идёт', completed: 'Завершён', cancelled: 'Отменён' }

export const OUTCOME_TEXT: Record<SprintOutcome, string> = {
  done: 'Выполнена',
  backlog: 'Возвращена в бэклог',
  moved: 'Перенесена в спринт',
  removed: 'Исключена из спринта',
  deleted: 'Задача удалена',
}

const EVENT_TEXT: Record<string, string> = {
  created: 'Спринт создан',
  updated: 'Изменены название, цель или даты',
  started: 'Спринт начат',
  scope_added: 'Задачи добавлены в спринт',
  scope_removed: 'Задача исключена из спринта',
  task_changed: 'Задача спринта изменена',
  task_deleted: 'Задача спринта удалена',
  completed: 'Спринт завершён',
  cancelled: 'Спринт отменён',
}
/** «Спринт 3: Name»; a name equal to the default «Спринт 3» is not repeated. */
export function sprintTitle(sprint: { number: number; name: string }, t: (text: string) => string) {
  const label = `${t('Спринт')} ${sprint.number}`
  const name = sprint.name.trim()
  const defaults = ['Спринт', 'Sprint'].map((word) => `${word} ${sprint.number}`)
  return name === label || defaults.includes(name) ? label : `${label}: ${name}`
}

/** Unknown kinds (older or newer servers) get a neutral text; the stored history is never changed. */
export const eventText = (kind: string) => EVENT_TEXT[kind] ?? 'Событие спринта'

type Locale = 'ru' | 'en'
const numberLocale = (locale: Locale) => (locale === 'en' ? 'en-GB' : 'ru-RU')

export const formatNumber = (value: number, locale: Locale) => new Intl.NumberFormat(numberLocale(locale), { maximumFractionDigits: 2 }).format(value)

/** «5 SP»; NULL is «not estimated», never zero. */
export const formatPoints = (value: number | null, locale: Locale, notEstimated: string) => (value === null ? notEstimated : `${formatNumber(value, locale)} SP`)
export const formatHours = (value: number | null, locale: Locale, notEstimated: string) => (value === null ? notEstimated : `${formatNumber(value, locale)} ${locale === 'en' ? 'h' : 'ч'}`)

export function formatMoment(value: string | null, locale: Locale, empty: string) {
  if (!value) return empty
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return empty
  return date.toLocaleString(numberLocale(locale), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
