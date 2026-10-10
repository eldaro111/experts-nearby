export const EXPERIENCE_OPTIONS = [
  ['unspecified', 'Не указано'],
  ['none', 'Нет опыта'],
  ['under_1', 'До 1 года'],
  ['1_3', 'От 1 до 3 лет'],
  ['3_5', 'От 3 до 5 лет'],
  ['over_5', 'Более 5 лет'],
] as const
export const EXPERIENCE_LABELS: Record<string, string> = Object.fromEntries([
  ...EXPERIENCE_OPTIONS,
  ['junior', 'Junior (ранее указано)'],
  ['middle', 'Middle (ранее указано)'],
  ['senior', 'Senior (ранее указано)'],
  ['expert', 'Expert (ранее указано)'],
])
export const SPECIALIZATIONS = [
  'Инженер-конструктор',
  'Инженер-электронщик',
  'Программист',
  'Технолог',
  'Исследователь',
  'Технический переводчик',
  'Технический писатель',
]
export const TIMEZONES = [
  ['Europe/Kaliningrad', 'UTC+2 · Калининград'],
  ['Europe/Moscow', 'UTC+3 · Москва, Санкт-Петербург'],
  ['Europe/Samara', 'UTC+4 · Самара'],
  ['Asia/Yekaterinburg', 'UTC+5 · Екатеринбург'],
  ['Asia/Omsk', 'UTC+6 · Омск'],
  ['Asia/Novosibirsk', 'UTC+7 · Новосибирск'],
  ['Asia/Tomsk', 'UTC+7 · Томск'],
  ['Asia/Krasnoyarsk', 'UTC+7 · Красноярск'],
  ['Asia/Irkutsk', 'UTC+8 · Иркутск'],
  ['Asia/Yakutsk', 'UTC+9 · Якутск'],
  ['Asia/Vladivostok', 'UTC+10 · Владивосток'],
  ['Asia/Magadan', 'UTC+11 · Магадан'],
  ['Asia/Kamchatka', 'UTC+12 · Камчатка'],
  ['UTC', 'UTC · Всемирное время'],
  ['Europe/London', 'Лондон'],
  ['Europe/Berlin', 'Берлин'],
  ['Europe/Lisbon', 'Лиссабон'],
  ['Asia/Almaty', 'Алматы'],
  ['Asia/Tashkent', 'Ташкент'],
  ['Asia/Dubai', 'Дубай'],
  ['Asia/Shanghai', 'Пекин'],
  ['Asia/Tokyo', 'Токио'],
  ['America/New_York', 'Нью-Йорк'],
  ['America/Los_Angeles', 'Лос-Анджелес'],
] as const
export type PriceUnit = 'negotiable' | 'project' | 'consultation'
export type LanguageSkill = {
  language: string
  level: string
  certificate_url: string
}
export type UniversityPath = {
  university_id: string | null
  school_id: string | null
  study_group_id: string | null
}
export const EMPTY_UNIVERSITY_PATH: UniversityPath = {
  university_id: null,
  school_id: null,
  study_group_id: null,
}
export type ProfileExtras = UniversityPath & {
  expert_code?: string
  experience_years?: string | null
  price_from?: number | string | null
  price_unit?: PriceUnit | null
  languages?: LanguageSkill[]
  academic_role?: string | null
}
export function priceLabel(profile: {
  price_from?: number | string | null
  price_unit?: string | null
}) {
  const amount = Number(profile.price_from)
  if (
    profile.price_from == null ||
    !Number.isFinite(amount) ||
    amount < 0 ||
    !['project', 'consultation'].includes(profile.price_unit || '')
  )
    return 'По договорённости'
  return `От ${amount.toLocaleString('ru-RU')} ₽ / ${profile.price_unit === 'project' ? 'проект' : 'консультация'}`
}
export function comparePrices(
  a: { price_from?: number | string | null },
  b: { price_from?: number | string | null },
  direction: 'asc' | 'desc',
) {
  const av = a.price_from == null ? null : Number(a.price_from)
  const bv = b.price_from == null ? null : Number(b.price_from)
  if (av === null || !Number.isFinite(av))
    return bv === null || !Number.isFinite(bv) ? 0 : 1
  if (bv === null || !Number.isFinite(bv)) return -1
  return direction === 'asc' ? av - bv : bv - av
}
export function validateDisplayName(value: string): string | null {
  const name = value.normalize('NFKC').trim().replace(/\s+/g, ' ')
  if (name.length < 2 || name.length > 100)
    return 'Укажите имя и фамилию: от 2 до 100 символов.'
  if (!/^[A-Za-zА-Яа-яЁё]+(?:[ '\-][A-Za-zА-Яа-яЁё]+)*$/.test(name))
    return 'Используйте буквы. Между частями имени допустимы пробел, дефис и апостроф; цифры и другие символы запрещены.'
  if (
    /(^|[ '\-])(хуй[а-яё]*|ху[яеёюй][а-яё]*|пизд[а-яё]*|бляд[а-яё]*|блять|ебан[а-яё]*|ёбан[а-яё]*|пидор[а-яё]*|pid[o0]r\w*|fuck\w*|shit)([ '\-]|$)/iu.test(
      name,
    )
  )
    return 'Укажите настоящее имя без оскорбительных выражений.'
  return null
}
export function safeWebUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const text = value.trim()
    const url = new URL(
      /^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`,
    )
    return ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null
  } catch {
    return null
  }
}
export const PORTFOLIO_LIMIT = 15 * 1024 * 1024
