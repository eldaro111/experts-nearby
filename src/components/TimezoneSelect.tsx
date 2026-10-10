'use client'

import { UiText } from '@/components/LocaleProvider'
import { TIMEZONES } from '@/lib/profileOptions'
export function TimezoneSelect({
  value,
  onChange,
  id,
}: {
  value: string
  onChange: (value: string) => void
  id?: string
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full"
    >
      <option value="">
        <UiText text={'Не указан'} />
      </option>
      {value && !TIMEZONES.some(([zone]) => zone === value) && (
        <option value={value}>{value} (ранее указано)</option>
      )}
      {TIMEZONES.map(([zone, label]) => (
        <option key={zone} value={zone}>
          {label}
        </option>
      ))}
    </select>
  )
}
