// ER-002: time zone parsing, labels, offsets and comparison.
//
// Rules (EXPERTS_ROADMAP_CODEX.md, section 8):
// - stored values are never rewritten; this module only interprets them;
// - IANA identifiers are compared after an explicit alias table (not substring search);
// - a fixed-offset legacy value such as «UTC+3» stays a legacy value — it is never mapped to a city;
// - an empty value never matches anything;
// - the UTC offset is computed for a given date, never stored or hard-coded in labels.

/** Curated zones with Russian names. Order defines the default list order. */
const CURATED: ReadonlyArray<readonly [zone: string, label: string, keywords?: string]> = [
  ['Europe/Kaliningrad', 'Калининград'],
  ['Europe/Moscow', 'Москва', 'мск санкт-петербург спб петербург'],
  ['Europe/Kirov', 'Киров'],
  ['Europe/Volgograd', 'Волгоград'],
  ['Europe/Astrakhan', 'Астрахань'],
  ['Europe/Saratov', 'Саратов'],
  ['Europe/Ulyanovsk', 'Ульяновск'],
  ['Europe/Samara', 'Самара', 'ижевск'],
  ['Asia/Yekaterinburg', 'Екатеринбург', 'челябинск тюмень пермь уфа'],
  ['Asia/Omsk', 'Омск'],
  ['Asia/Novosibirsk', 'Новосибирск'],
  ['Asia/Barnaul', 'Барнаул'],
  ['Asia/Tomsk', 'Томск'],
  ['Asia/Novokuznetsk', 'Новокузнецк', 'кемерово'],
  ['Asia/Krasnoyarsk', 'Красноярск'],
  ['Asia/Irkutsk', 'Иркутск', 'улан-удэ'],
  ['Asia/Chita', 'Чита'],
  ['Asia/Yakutsk', 'Якутск', 'благовещенск'],
  ['Asia/Khandyga', 'Хандыга'],
  ['Asia/Vladivostok', 'Владивосток', 'хабаровск'],
  ['Asia/Ust-Nera', 'Усть-Нера'],
  ['Asia/Sakhalin', 'Южно-Сахалинск', 'сахалин'],
  ['Asia/Magadan', 'Магадан'],
  ['Asia/Srednekolymsk', 'Среднеколымск'],
  ['Asia/Kamchatka', 'Петропавловск-Камчатский', 'камчатка'],
  ['Asia/Anadyr', 'Анадырь', 'чукотка'],
  ['UTC', 'Всемирное время (UTC)', 'utc gmt гринвич'],
  ['Europe/Minsk', 'Минск', 'беларусь'],
  ['Europe/Kyiv', 'Киев', 'украина'],
  ['Asia/Almaty', 'Алматы', 'казахстан астана'],
  ['Asia/Tashkent', 'Ташкент', 'узбекистан'],
  ['Asia/Bishkek', 'Бишкек', 'киргизия кыргызстан'],
  ['Asia/Dushanbe', 'Душанбе', 'таджикистан'],
  ['Asia/Baku', 'Баку', 'азербайджан'],
  ['Asia/Yerevan', 'Ереван', 'армения'],
  ['Asia/Tbilisi', 'Тбилиси', 'грузия'],
  ['Europe/Istanbul', 'Стамбул', 'турция'],
  ['Europe/London', 'Лондон', 'великобритания'],
  ['Europe/Berlin', 'Берлин', 'германия'],
  ['Europe/Paris', 'Париж', 'франция'],
  ['Europe/Lisbon', 'Лиссабон', 'португалия'],
  ['Asia/Dubai', 'Дубай', 'оаэ эмираты'],
  ['Asia/Kolkata', 'Индия', 'дели мумбаи'],
  ['Asia/Shanghai', 'Пекин', 'китай шанхай'],
  ['Asia/Singapore', 'Сингапур'],
  ['Asia/Tokyo', 'Токио', 'япония'],
  ['America/New_York', 'Нью-Йорк', 'сша'],
  ['America/Chicago', 'Чикаго', 'сша'],
  ['America/Los_Angeles', 'Лос-Анджелес', 'сша'],
]

/**
 * Agreed alias canonicalization: every name in a group compares equal to the first one.
 * Engines disagree on canonical names (e.g. ICU may report Europe/Kiev), so this table is explicit.
 */
const ALIAS_GROUPS: ReadonlyArray<ReadonlyArray<string>> = [
  ['UTC', 'Etc/UTC', 'Etc/UCT', 'UCT', 'Etc/Universal', 'Universal', 'Etc/Zulu', 'Zulu', 'Etc/GMT', 'GMT', 'Etc/GMT0', 'GMT0', 'Etc/GMT+0', 'GMT+0', 'Etc/GMT-0', 'GMT-0', 'Etc/Greenwich', 'Greenwich'],
  ['Europe/Kyiv', 'Europe/Kiev'],
  ['Europe/Moscow', 'W-SU'],
  ['Asia/Kolkata', 'Asia/Calcutta'],
  ['Asia/Ho_Chi_Minh', 'Asia/Saigon'],
  ['Asia/Kathmandu', 'Asia/Katmandu'],
  ['Asia/Yangon', 'Asia/Rangoon'],
  ['Asia/Ulaanbaatar', 'Asia/Ulan_Bator'],
  ['Asia/Dhaka', 'Asia/Dacca'],
  ['Asia/Thimphu', 'Asia/Thimbu'],
  ['Asia/Macau', 'Asia/Macao'],
  ['Asia/Jerusalem', 'Asia/Tel_Aviv', 'Israel'],
  ['Asia/Shanghai', 'Asia/Chongqing', 'Asia/Chungking', 'Asia/Harbin', 'PRC'],
  ['Asia/Urumqi', 'Asia/Kashgar'],
  ['Asia/Tokyo', 'Japan'],
  ['Asia/Singapore', 'Singapore'],
  ['Asia/Seoul', 'ROK'],
  ['Asia/Taipei', 'ROC'],
  ['Asia/Hong_Kong', 'Hongkong'],
  ['Asia/Tehran', 'Iran'],
  ['Europe/Istanbul', 'Asia/Istanbul', 'Turkey'],
  ['Europe/London', 'GB', 'GB-Eire', 'Europe/Belfast'],
  ['Europe/Dublin', 'Eire'],
  ['Europe/Lisbon', 'Portugal'],
  ['Europe/Warsaw', 'Poland'],
  ['Europe/Chisinau', 'Europe/Tiraspol'],
  ['Europe/Uzhgorod'],
  ['Atlantic/Faroe', 'Atlantic/Faeroe'],
  ['America/Nuuk', 'America/Godthab'],
  ['America/Argentina/Buenos_Aires', 'America/Buenos_Aires'],
  ['America/Indiana/Indianapolis', 'America/Indianapolis', 'America/Fort_Wayne', 'US/East-Indiana'],
  ['America/Kentucky/Louisville', 'America/Louisville'],
  ['America/New_York', 'US/Eastern', 'EST5EDT'],
  ['America/Chicago', 'US/Central', 'CST6CDT'],
  ['America/Denver', 'US/Mountain', 'MST7MDT', 'Navajo', 'America/Shiprock'],
  ['America/Los_Angeles', 'US/Pacific', 'PST8PDT'],
  ['America/Anchorage', 'US/Alaska'],
  ['Pacific/Honolulu', 'US/Hawaii'],
  ['Pacific/Kanton', 'Pacific/Enderbury'],
  ['Pacific/Pohnpei', 'Pacific/Ponape'],
  ['Pacific/Chuuk', 'Pacific/Truk', 'Pacific/Yap'],
  ['Australia/Sydney', 'Australia/NSW', 'Australia/ACT', 'Australia/Canberra'],
]

const aliasToCanonical = new Map<string, string>()
for (const group of ALIAS_GROUPS) for (const name of group) aliasToCanonical.set(name.toLowerCase(), group[0])

const curatedByZone = new Map(CURATED.map(([zone, label, keywords]) => [zone, { label, keywords: keywords || '' }]))

/** Formatter cache; falls back to any alias the engine accepts. */
const formatterCache = new Map<string, Intl.DateTimeFormat | null>()
function offsetFormatter(canonical: string): Intl.DateTimeFormat | null {
  if (formatterCache.has(canonical)) return formatterCache.get(canonical) || null
  const group = ALIAS_GROUPS.find((names) => names[0] === canonical) || [canonical]
  let formatter: Intl.DateTimeFormat | null = null
  for (const name of group) {
    try {
      formatter = new Intl.DateTimeFormat('en-US', { timeZone: name, timeZoneName: 'shortOffset' })
      break
    } catch { /* try the next alias */ }
  }
  formatterCache.set(canonical, formatter)
  return formatter
}

let engineZones: string[] | null = null
function knownEngineZones(): string[] {
  if (engineZones) return engineZones
  try {
    engineZones = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') || []
  } catch {
    engineZones = []
  }
  return engineZones
}

export type ParsedTimezone =
  | { kind: 'empty' }
  | { kind: 'iana'; zone: string; raw: string }
  | { kind: 'legacy'; key: string; raw: string }

/** Interprets a stored value without changing it. Unknown text (e.g. «UTC+3», «МСК») stays legacy. */
export function parseTimezone(value: string | null | undefined): ParsedTimezone {
  const raw = (value ?? '').trim()
  if (!raw) return { kind: 'empty' }
  const alias = aliasToCanonical.get(raw.toLowerCase())
  if (alias) return { kind: 'iana', zone: alias, raw }
  if (/^[A-Za-z_]+(\/[A-Za-z0-9_+\-]+)+$/.test(raw)) {
    const exact = knownEngineZones().find((zone) => zone.toLowerCase() === raw.toLowerCase())
    const candidate = curatedByZone.has(raw) ? raw : exact || raw
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: candidate })
      return { kind: 'iana', zone: aliasToCanonical.get(candidate.toLowerCase()) || canonicalCase(candidate), raw }
    } catch { /* not a zone the engine knows: keep as legacy */ }
  }
  return { kind: 'legacy', key: raw.replace(/\s+/g, ' ').toUpperCase(), raw }
}

function canonicalCase(zone: string) {
  return knownEngineZones().find((known) => known.toLowerCase() === zone.toLowerCase())
    || CURATED.find(([known]) => known.toLowerCase() === zone.toLowerCase())?.[0]
    || zone
}

/** Two stored values describe the same project time zone. Empty never matches. */
export function sameTimezone(a: string | null | undefined, b: string | null | undefined) {
  const left = parseTimezone(a)
  const right = parseTimezone(b)
  if (left.kind === 'empty' || right.kind === 'empty') return false
  if (left.kind === 'iana' && right.kind === 'iana') return left.zone === right.zone
  if (left.kind === 'legacy' && right.kind === 'legacy') return left.key === right.key
  return false
}

/** «UTC+7», «UTC+5:30», «UTC» for the given moment; null if the engine cannot compute it. */
export function utcOffsetLabel(zone: string, at: Date = new Date()): string | null {
  const formatter = offsetFormatter(zone)
  if (!formatter) return null
  const part = formatter.formatToParts(at).find((item) => item.type === 'timeZoneName')?.value || ''
  const match = part.match(/^GMT(?:([+-])(\d{1,2})(?::(\d{2}))?)?$/)
  if (!match) return null
  if (!match[1] || (Number(match[2]) === 0 && (!match[3] || match[3] === '00'))) return 'UTC'
  return `UTC${match[1] === '-' ? '−' : '+'}${Number(match[2])}${match[3] && match[3] !== '00' ? `:${match[3]}` : ''}`
}

function englishCity(zone: string) {
  const last = zone.split('/').at(-1) || zone
  return last.replace(/_/g, ' ')
}

export function zoneName(zone: string) {
  return curatedByZone.get(zone)?.label || englishCity(zone)
}

/** Human label of a stored value at a date: «Томск · UTC+7», legacy values as entered. */
export function formatTimezone(value: string | null | undefined, at: Date = new Date()): string {
  const parsed = parseTimezone(value)
  if (parsed.kind === 'empty') return ''
  if (parsed.kind === 'legacy') return parsed.raw
  const offset = utcOffsetLabel(parsed.zone, at)
  if (parsed.zone === 'UTC') return 'Всемирное время (UTC)'
  return offset ? `${zoneName(parsed.zone)} · ${offset}` : zoneName(parsed.zone)
}

export type TimezoneOption = {
  value: string
  label: string
  offset: string | null
  detail: string
  search: string
  curated: boolean
  legacy?: boolean
}

export function normalizeSearch(text: string) {
  return text.toLowerCase().replace(/ё/g, 'е').replace(/[−–]/g, '-').replace(/[_/]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function offsetSearchTerms(offset: string | null) {
  if (!offset) return ''
  const plain = offset.replace('−', '-')
  const short = plain.replace('UTC', '')
  return `${plain} gmt${short} ${short}`
}

/** Curated zones first, then every other zone the engine reports, deduplicated by alias. */
export function buildTimezoneOptions(at: Date = new Date()): TimezoneOption[] {
  const seen = new Set<string>()
  const options: TimezoneOption[] = []
  const add = (zone: string, curated: boolean) => {
    const parsed = parseTimezone(zone)
    if (parsed.kind !== 'iana' || seen.has(parsed.zone)) return
    const offset = utcOffsetLabel(parsed.zone, at)
    if (!offset && !curated) return
    seen.add(parsed.zone)
    const info = curatedByZone.get(parsed.zone)
    const label = zoneName(parsed.zone)
    options.push({
      value: parsed.zone,
      label,
      offset,
      detail: parsed.zone,
      curated,
      search: normalizeSearch(`${label} ${info?.keywords || ''} ${parsed.zone} ${englishCity(parsed.zone)} ${offsetSearchTerms(offset)}`),
    })
  }
  for (const [zone] of CURATED) add(zone, true)
  const rest = knownEngineZones().filter((zone) => !zone.startsWith('Etc/') || zone === 'Etc/UTC')
  rest.sort((a, b) => englishCity(a).localeCompare(englishCity(b)))
  for (const zone of rest) add(zone, false)
  return options
}

export function legacyOption(value: string): TimezoneOption {
  return { value, label: value, offset: null, detail: 'Ранее указанное значение', curated: false, legacy: true, search: normalizeSearch(value) }
}

/** Every query word must appear in the option's search text. */
export function matchesTimezoneQuery(option: TimezoneOption, query: string) {
  const words = normalizeSearch(query).split(' ').filter(Boolean)
  return words.every((word) => option.search.includes(word))
}

/** Device zone for an optional suggestion; the user can always change it. */
export function deviceTimezone(): string | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    const parsed = parseTimezone(zone)
    return parsed.kind === 'iana' ? parsed.zone : null
  } catch {
    return null
  }
}
