'use client'

import { UiText } from '@/components/LocaleProvider'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import { GraduationCap, ArrowUpRight, BookOpen, UsersRound } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState, PageLoading } from '@/components/PageState'
import { UniversityFields } from '@/components/UniversityFields'
import { supabase } from '@/lib/supabaseClient'
import {
  EMPTY_UNIVERSITY_PATH,
  EXPERIENCE_LABELS,
  priceLabel,
  type UniversityPath,
  type ProfileExtras,
} from '@/lib/profileOptions'
type Project = UniversityPath & {
  id: string
  title: string
  description: string
  roles_needed: string[]
  university_name: string
  school_name: string
  study_group_name: string
  completed_at: string | null
}
type Expert = ProfileExtras & {
  user_id: string
  display_name: string
  skills: string[]
  roles: string[]
  university_name: string
  school_name: string
  study_group_name: string
}
export function UniversityDirectory({
  universityId,
}: {
  universityId?: string
}) {
  const [path, setPath] = useState<UniversityPath>({
    ...EMPTY_UNIVERSITY_PATH,
    university_id: universityId || null,
  })
  const [projects, setProjects] = useState<Project[]>([]),
    [experts, setExperts] = useState<Expert[]>([])
  const [tab, setTab] = useState<'projects' | 'people'>('projects'),
    [query, setQuery] = useState(''),
    [role, setRole] = useState('')
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0),
    [name, setName] = useState('')
  useEffect(() => {
    let active = true
    async function load() {
      setLoading(true)
      setError('')
      try {
        const [p, e, u] = await Promise.all([
          supabase
            .from('university_projects')
            .select('*')
            .order('created_at', { ascending: false }),
          supabase
            .from('profiles_public')
            .select('*')
            .not('university_id', 'is', null)
            .order('display_name'),
          universityId
            ? supabase
                .from('universities')
                .select('name')
                .eq('id', universityId)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        ])
        if (p.error || e.error || u.error) throw p.error || e.error || u.error
        if (universityId && !u.data) throw new Error('Вуз не найден')
        if (active) {
          setProjects(p.data || [])
          setExperts(e.data || [])
          setName(u.data?.name || '')
        }
      } catch {
        if (active)
          setError(
            'Не удалось загрузить раздел вузов. Проверьте соединение и повторите попытку.',
          )
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [attempt, universityId])
  function matches(item: UniversityPath) {
    return (
      (!path.university_id || item.university_id === path.university_id) &&
      (!path.school_id || item.school_id === path.school_id) &&
      (!path.study_group_id || item.study_group_id === path.study_group_id)
    )
  }
  const q = query.trim().toLocaleLowerCase('ru')
  const filteredProjects = projects.filter(
    (p) =>
      matches(p) &&
      !p.completed_at &&
      `${p.title} ${p.description} ${(p.roles_needed || []).join(' ')}`
        .toLocaleLowerCase('ru')
        .includes(q),
  )
  const filteredExperts = experts.filter(
    (p) =>
      matches(p) &&
      (!role || p.academic_role === role) &&
      `${p.display_name} ${p.expert_code} ${(p.roles || []).join(' ')} ${(p.skills || []).join(' ')}`
        .toLocaleLowerCase('ru')
        .includes(q),
  )
  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Учёба. Практика. Инженерные команды."
        title={name || 'ВУЗам'}
        description="Находите проекты, студентов и специалистов своего вуза. Выбирайте направление, инженерную школу и учебную группу."
      >
        <Link href="/auth?mode=signup" className="action-primary">
          <GraduationCap size={19} />
          <UiText text={'Зарегистрироваться'} />
        </Link>
        <Link href="/profile" className="action-secondary">
          <UiText text={'Указать свой вуз'} />
        </Link>
      </PageHeader>
      {!universityId && (
        <div className="grid md:grid-cols-3 gap-4 mb-7">
          <div className="pilot-info-card">
            <GraduationCap />
            <h2>
              <UiText text={'Студентам'} />
            </h2>
            <p>
              <UiText
                text={'Практические задачи, портфолио и работа в команде.'}
              />
            </p>
          </div>
          <div className="pilot-info-card">
            <BookOpen />
            <h2>
              <UiText text={'Преподавателям'} />
            </h2>
            <p>
              <UiText text={'Проекты по направлениям и учебным группам.'} />
            </p>
          </div>
          <div className="pilot-info-card">
            <UsersRound />
            <h2>
              <UiText text={'Бизнесу'} />
            </h2>
            <p>
              <UiText text={'Поиск специалистов и сотрудничество с вузами.'} />
            </p>
          </div>
        </div>
      )}
      <section className="filter-panel space-y-4" aria-label="Фильтры вузов">
        <UniversityFields
          value={path}
          onChange={setPath}
          lockedUniversity={Boolean(universityId)}
        />
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="university-query" className="filter-label">
              <UiText text={'Поиск по задачам и специализациям'} />
            </label>
            <input
              id="university-query"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              type="search"
              className="w-full"
              placeholder="Робототехника, перевод, документация…"
            />
          </div>
          {tab === 'people' && (
            <div>
              <label htmlFor="academic-role-filter" className="filter-label">
                <UiText text={'Участники'} />
              </label>
              <select
                id="academic-role-filter"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full"
              >
                <option value="">
                  <UiText text={'Все участники'} />
                </option>
                <option value="student">
                  <UiText text={'Студенты'} />
                </option>
                <option value="graduate">
                  <UiText text={'Выпускники'} />
                </option>
                <option value="teacher">
                  <UiText text={'Преподаватели / исследователи'} />
                </option>
                <option value="representative">
                  <UiText text={'Представители вузов'} />
                </option>
              </select>
            </div>
          )}
        </div>
        <button
          onClick={() => {
            setPath({
              ...EMPTY_UNIVERSITY_PATH,
              university_id: universityId || null,
            })
            setQuery('')
            setRole('')
          }}
          className="text-sm text-blue-700 underline"
        >
          <UiText text={'Сбросить фильтры'} />
        </button>
      </section>
      <div className="flex flex-wrap gap-3 my-6">
        <button
          onClick={() => setTab('projects')}
          aria-pressed={tab === 'projects'}
          className={tab === 'projects' ? 'action-primary' : 'action-secondary'}
        >
          <UiText text={'Проекты'} />
          {!loading && !error ? ` · ${filteredProjects.length}` : ''}
        </button>
        <button
          onClick={() => setTab('people')}
          aria-pressed={tab === 'people'}
          className={tab === 'people' ? 'action-primary' : 'action-secondary'}
        >
          <UiText text={'Студенты и специалисты'} />
          {!loading && !error ? ` · ${filteredExperts.length}` : ''}
        </button>
        <Link href="/listings/new" className="action-secondary">
          <UiText text={'Добавить проект вуза'} />
        </Link>
      </div>
      {loading ? (
        <PageLoading />
      ) : error ? (
        <EmptyState title="Раздел временно недоступен" description={error}>
          <button
            onClick={() => setAttempt((n) => n + 1)}
            className="action-primary"
          >
            <UiText text={'Повторить'} />
          </button>
        </EmptyState>
      ) : tab === 'projects' ? (
        filteredProjects.length ? (
          <div className="grid md:grid-cols-2 gap-5">
            {filteredProjects.map((p) => (
              <article className="expert-card" key={p.id}>
                <p className="text-xs text-blue-700 mb-2">
                  <Link href={`/universities/${p.university_id}`}>
                    {p.university_name}
                  </Link>
                  {p.school_name ? ` · ${p.school_name}` : ''}
                  {p.study_group_name ? ` · ${p.study_group_name}` : ''}
                </p>
                <h2 className="text-xl font-semibold">
                  <Link href={`/listings/${p.id}`}>{p.title}</Link>
                </h2>
                <p className="text-sm text-slate-600 leading-7 my-4 line-clamp-4">
                  {p.description}
                </p>
                <div className="flex gap-2 flex-wrap">
                  {(p.roles_needed || []).map((role) => (
                    <span key={role} className="skill-tag">
                      {role}
                    </span>
                  ))}
                </div>
                <Link href={`/listings/${p.id}`} className="text-link mt-5">
                  <UiText text={'Подробнее о проекте'} />
                  <ArrowUpRight size={16} />
                </Link>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="Подходящих проектов пока нет"
            description="Измените фильтры или опубликуйте проект и укажите вуз."
          />
        )
      ) : filteredExperts.length ? (
        <div className="grid md:grid-cols-2 gap-5">
          {filteredExperts.map((p) => (
            <article key={p.user_id} className="expert-card">
              <p className="text-xs text-blue-700 mb-2">{p.expert_code}</p>
              <h2 className="text-xl font-semibold">
                <Link href={`/users/${p.user_id}`}>
                  {p.display_name || 'Профиль не заполнен'}
                </Link>
              </h2>
              <Link
                href={`/universities/${p.university_id}`}
                className="text-sm text-blue-700 mt-3"
              >
                {p.university_name}
              </Link>
              <p className="text-sm text-slate-500">
                {[p.school_name, p.study_group_name]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
              <p className="text-xs text-slate-500 mt-1">
                <UiText text={'Принадлежность указана пользователем'} />
              </p>
              <p className="text-sm my-4">
                {EXPERIENCE_LABELS[p.experience_years || 'unspecified']} ·{' '}
                {priceLabel(p)}
              </p>
              <div className="flex flex-wrap gap-2">
                {(p.roles || []).map((r) => (
                  <span key={r} className="skill-tag">
                    {r}
                  </span>
                ))}
              </div>
              <Link href={`/users/${p.user_id}`} className="text-link mt-5">
                <UiText text={'Открыть профиль'} />
                <ArrowUpRight size={16} />
              </Link>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title="Подходящих участников пока нет"
          description="Заполните профиль и укажите вуз, чтобы вас могли найти."
        />
      )}
    </div>
  )
}
