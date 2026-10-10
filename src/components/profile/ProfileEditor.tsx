'use client'

import { UiText } from '@/components/LocaleProvider'
import { useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { FormField } from '@/components/FormField'
import { TimezoneSelect } from '@/components/TimezoneSelect'
import { UniversityFields } from '@/components/UniversityFields'
import { PortfolioFiles } from './PortfolioFiles'
import {
  EMPTY_UNIVERSITY_PATH,
  EXPERIENCE_OPTIONS,
  SPECIALIZATIONS,
  safeWebUrl,
  validateDisplayName,
  type LanguageSkill,
  type PriceUnit,
  type UniversityPath,
} from '@/lib/profileOptions'

type ProfileRecord = Record<string, unknown>
const list = (value: unknown) =>
  Array.isArray(value)
    ? value.map(String)
    : typeof value === 'string'
      ? value
          .split(/[,;\n]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : []
const parseList = (value: string) =>
  value
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
export function ProfileEditor({
  userId,
  initial = {},
  onSaved,
  onCancel,
}: {
  userId: string
  initial?: ProfileRecord
  onSaved: (profile: ProfileRecord) => void
  onCancel?: () => void
}) {
  const [name, setName] = useState(String(initial.display_name || ''))
  const [city, setCity] = useState(String(initial.city || ''))
  const [timezone, setTimezone] = useState(String(initial.timezone || ''))
  const [availability, setAvailability] = useState(
    String(initial.availability_hours ?? ''),
  )
  const [roles, setRoles] = useState(list(initial.roles).join(', '))
  const [skills, setSkills] = useState(list(initial.skills).join(', '))
  const [format, setFormat] = useState(String(initial.work_format || ''))
  const [experience, setExperience] = useState(
    String(initial.experience_years || 'unspecified'),
  )
  const [priceUnit, setPriceUnit] = useState<PriceUnit>(
    (initial.price_unit as PriceUnit) || 'negotiable',
  )
  const [price, setPrice] = useState(String(initial.price_from ?? ''))
  const [about, setAbout] = useState(String(initial.about || ''))
  const [links, setLinks] = useState(
    Object.entries((initial.links || {}) as Record<string, unknown>)
      .filter(([, value]) => value)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n'),
  )
  const [portfolioLinks, setPortfolioLinks] = useState(
    list(initial.portfolio_links).join('\n'),
  )
  const [languages, setLanguages] = useState<LanguageSkill[]>(
    Array.isArray(initial.languages)
      ? (initial.languages as LanguageSkill[])
      : [],
  )
  const [university, setUniversity] = useState<UniversityPath>({
    university_id: (initial.university_id as string) || null,
    school_id: (initial.school_id as string) || null,
    study_group_id: (initial.study_group_id as string) || null,
  })
  const [academicRole, setAcademicRole] = useState(
    String(initial.academic_role || ''),
  )
  const [savedOnce, setSavedOnce] = useState(Boolean(initial.user_id))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (saving) return
    const nameError = validateDisplayName(name)
    if (nameError) {
      setError(nameError)
      return
    }
    if (
      priceUnit !== 'negotiable' &&
      (!price.trim() || !Number.isFinite(Number(price)) || Number(price) < 0)
    ) {
      setError('Укажите стоимость в рублях или выберите «По договорённости».')
      return
    }
    if (academicRole && !university.university_id) {
      setError('Выберите вуз или укажите «Не указывать» в связи с вузом.')
      return
    }
    const contactLinks: Record<string, string> = {}
    for (const [index, line] of links
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
      .entries()) {
      const named = line.match(/^([^:/]+):\s+(.+)$/)
      const url = safeWebUrl(named ? named[2] : line)
      if (!url) {
        setError(
          'В контактах допускаются только корректные ссылки http или https.',
        )
        return
      }
      contactLinks[named ? named[1] : `Ссылка ${index + 1}`] = url
    }
    const portfolio = portfolioLinks
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    if (portfolio.some((url) => !safeWebUrl(url))) {
      setError('Проверьте ссылки на портфолио.')
      return
    }
    if (
      languages.some(
        (l) =>
          l.language.trim().length < 2 ||
          (l.certificate_url && !safeWebUrl(l.certificate_url)),
      )
    ) {
      setError('Укажите язык и корректную ссылку на сертификат.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const payload = {
        user_id: userId,
        display_name: name.normalize('NFKC').trim().replace(/\s+/g, ' '),
        city: city.trim() || null,
        timezone: timezone || null,
        availability_hours: availability.trim() ? Number(availability) : null,
        roles: parseList(roles),
        skills: parseList(skills),
        work_format: format || null,
        experience_years: experience,
        price_unit: priceUnit,
        price_from: priceUnit === 'negotiable' ? null : Number(price),
        about: about.trim() || null,
        links: contactLinks,
        portfolio_links: portfolio.map((url) => safeWebUrl(url)),
        languages: languages.map((l) => ({
          language: l.language.trim(),
          level: l.level,
          certificate_url: l.certificate_url
            ? safeWebUrl(l.certificate_url)
            : '',
        })),
        ...(academicRole ? university : EMPTY_UNIVERSITY_PATH),
        academic_role: academicRole || null,
      }
      const { data, error: issue } = await supabase
        .from('profiles')
        .upsert(payload, { onConflict: 'user_id' })
        .select('*')
        .single()
      if (issue) throw issue
      setSavedOnce(true)
      onSaved(data)
    } catch (issue) {
      setError(
        issue && typeof issue === 'object' && 'message' in issue
          ? String(issue.message)
          : 'Не удалось сохранить профиль. Повторите попытку.',
      )
    } finally {
      setSaving(false)
    }
  }
  function editLanguage(
    index: number,
    field: keyof LanguageSkill,
    value: string,
  ) {
    setLanguages((items) =>
      items.map((item, i) =>
        i === index ? { ...item, [field]: value } : item,
      ),
    )
  }
  return (
    <form
      onSubmit={save}
      className="profile-editor space-y-6"
      aria-busy={saving}
    >
      <fieldset disabled={saving} className="space-y-6 min-w-0">
        <div className="grid gap-4 md:grid-cols-2">
          <FormField label="Имя и фамилия">
            <input
              required
              maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Иван Иванов"
              autoComplete="name"
            />
          </FormField>
          <FormField label="Город">
            <input
              value={city}
              maxLength={100}
              onChange={(e) => setCity(e.target.value)}
              placeholder="Новосибирск"
              autoComplete="address-level2"
            />
          </FormField>
          <FormField label="Часовой пояс">
            <TimezoneSelect value={timezone} onChange={setTimezone} />
          </FormField>
          <FormField label="Доступность, часов в неделю (необязательно)">
            <input
              type="number"
              min={0}
              max={168}
              step={1}
              value={availability}
              onChange={(e) => setAvailability(e.target.value)}
              placeholder="Например, 10"
            />
          </FormField>
          <FormField label="Формат работы">
            <select value={format} onChange={(e) => setFormat(e.target.value)}>
              <option value="">
                <UiText text={'Не указан'} />
              </option>
              <option value="remote">
                <UiText text={'Удалённо'} />
              </option>
              <option value="onsite">
                <UiText text={'Очно'} />
              </option>
              <option value="hybrid">
                <UiText text={'Гибрид'} />
              </option>
            </select>
          </FormField>
          <FormField label="Опыт работы">
            <select
              value={experience}
              onChange={(e) => setExperience(e.target.value)}
            >
              {EXPERIENCE_OPTIONS.map(([key, label]) => (
                <option key={key} value={key}>
                  <UiText text={label} />
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Условия работы">
            <select
              value={priceUnit}
              onChange={(e) => setPriceUnit(e.target.value as PriceUnit)}
            >
              <option value="negotiable">
                <UiText text={'По договорённости'} />
              </option>
              <option value="project">
                <UiText text={'Стоимость проекта'} />
              </option>
              <option value="consultation">
                <UiText text={'Стоимость консультации'} />
              </option>
            </select>
          </FormField>
          {priceUnit !== 'negotiable' && (
            <FormField label="Стоимость от, ₽">
              <input
                type="number"
                required
                min={0}
                max={1000000000}
                step="0.01"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="Например, 15000"
              />
            </FormField>
          )}
          <FormField
            label="Специализации (через запятую)"
            className="md:col-span-2"
          >
            <input
              value={roles}
              onChange={(e) => setRoles(e.target.value)}
              placeholder="Инженер, технический переводчик, технический писатель"
            />
          </FormField>
          <div className="md:col-span-2 flex flex-wrap gap-2">
            {SPECIALIZATIONS.map((role) => (
              <button
                key={role}
                type="button"
                className="skill-tag"
                onClick={() =>
                  setRoles([...new Set([...parseList(roles), role])].join(', '))
                }
              >
                + {role}
              </button>
            ))}
          </div>
          <FormField label="Навыки (через запятую)" className="md:col-span-2">
            <input
              value={skills}
              onChange={(e) => setSkills(e.target.value)}
              placeholder="CAD, электроника, техническая документация"
            />
          </FormField>
        </div>
        <section className="border-t pt-5 space-y-4">
          <h3 className="text-lg font-semibold">
            <UiText text={'Образование и вуз'} />
          </h3>
          <FormField label="Ваша связь с вузом">
            <select
              value={academicRole}
              onChange={(e) => setAcademicRole(e.target.value)}
            >
              <option value="">
                <UiText text={'Не указывать'} />
              </option>
              <option value="student">
                <UiText text={'Студент'} />
              </option>
              <option value="graduate">
                <UiText text={'Выпускник'} />
              </option>
              <option value="teacher">
                <UiText text={'Преподаватель / исследователь'} />
              </option>
              <option value="representative">
                <UiText text={'Представитель вуза'} />
              </option>
            </select>
          </FormField>
          {academicRole && (
            <>
              <UniversityFields
                value={university}
                onChange={setUniversity}
                allowCreate
              />
              <p className="text-xs text-slate-500">
                Принадлежность указана пользователем. Выбор роли представителя
                не предоставляет административных прав. Эти сведения видны
                вместе с профилем.
              </p>
            </>
          )}
        </section>
        <section className="border-t pt-5 space-y-4">
          <h3 className="text-lg font-semibold">
            <UiText text={'Языки'} />
          </h3>
          {languages.map((language, index) => (
            <div key={index} className="rounded-xl border p-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label="Язык">
                  <input
                    required
                    maxLength={60}
                    value={language.language}
                    onChange={(e) =>
                      editLanguage(index, 'language', e.target.value)
                    }
                    placeholder="Английский"
                  />
                </FormField>
                <FormField label="Уровень">
                  <select
                    value={language.level}
                    onChange={(e) =>
                      editLanguage(index, 'level', e.target.value)
                    }
                  >
                    {['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'native'].map(
                      (level) => (
                        <option key={level} value={level}>
                          {level === 'native' ? 'Родной' : level}
                        </option>
                      ),
                    )}
                  </select>
                </FormField>
              </div>
              <FormField label="Ссылка на официальный сертификат (необязательно)">
                <input
                  value={language.certificate_url}
                  onChange={(e) =>
                    editLanguage(index, 'certificate_url', e.target.value)
                  }
                  placeholder="https://…"
                />
              </FormField>
              <p className="text-xs text-slate-500">
                <UiText
                  text={
                    language.certificate_url
                      ? 'Документ указан пользователем. Подлинность ещё не проверена.'
                      : 'Уровень не подтверждён сертификатом.'
                  }
                />
              </p>
              <button
                type="button"
                className="text-sm text-red-700 underline"
                onClick={() =>
                  setLanguages((items) => items.filter((_, i) => i !== index))
                }
              >
                <UiText text={'Удалить язык'} />
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={languages.length >= 10}
            className="action-secondary"
            onClick={() =>
              setLanguages([
                ...languages,
                { language: '', level: 'B1', certificate_url: '' },
              ])
            }
          >
            <UiText text={'Добавить язык'} />
          </button>
        </section>
        <FormField label="О себе">
          <textarea
            value={about}
            onChange={(e) => setAbout(e.target.value)}
            rows={4}
            placeholder="Опыт, специализация, выполненные задачи"
          />
        </FormField>
        <FormField label="Контакты и ссылки">
          <textarea
            value={links}
            onChange={(e) => setLinks(e.target.value)}
            rows={3}
            placeholder={'https://…\nTelegram: https://t.me/…'}
          />
        </FormField>
        <FormField label="Ссылки на портфолио (необязательно)">
          <textarea
            value={portfolioLinks}
            onChange={(e) => setPortfolioLinks(e.target.value)}
            rows={3}
            placeholder="По одной ссылке на строку"
          />
        </FormField>
      </fieldset>
      {savedOnce ? (
        <PortfolioFiles userId={userId} editable />
      ) : (
        <p className="rounded-lg bg-blue-50 p-4 text-sm text-blue-800">
          Сохраните профиль, затем добавьте PDF-документы в разделе «Мой
          профиль».
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-3 border-t pt-5">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="action-secondary"
          >
            <UiText text={'Отмена'} />
          </button>
        )}
        <button type="submit" disabled={saving} className="action-primary">
          <UiText text={saving ? 'Сохраняем…' : 'Сохранить профиль'} />
        </button>
      </div>
    </form>
  )
}
