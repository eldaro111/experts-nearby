'use client'

import Link from 'next/link'
import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowUpRight, BellRing, RotateCcw, Sparkles, X } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { PageHeader } from '@/components/PageHeader'
import { EmptyState, PageLoading } from '@/components/PageState'
import { UiText, useT } from '@/components/LocaleProvider'
import { priceLabel } from '@/lib/profileOptions'
import { logAppError } from '@/lib/appFeedback'

type Kind = 'projects' | 'experts'
type Suggestion = {
  project_id: string
  expert_id: string
  project_title: string
  project_description: string | null
  expert_name: string
  expert_code: string
  price_from: number | null
  price_unit: string
  matched_skills: string[]
  matched_roles: string[]
  university_match: boolean
}
type Project = { id: string; title: string }

export default function RecommendationsPage() {
  return (
    <Suspense fallback={<PageLoading />}>
      <Recommendations />
    </Suspense>
  )
}
function Recommendations() {
  const params = useSearchParams(),
    router = useRouter(),
    t = useT()
  const kind: Kind = params.get('kind') === 'experts' ? 'experts' : 'projects'
  const projectId = params.get('project') || ''
  const [items, setItems] = useState<Suggestion[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [userId, setUserId] = useState<string | null>(null)
  const [emptyProfile, setEmptyProfile] = useState(false)
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(''),
    [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const navigate = (next: Kind, project = '') =>
    router.replace(
      `/recommendations?kind=${next}${project ? `&project=${encodeURIComponent(project)}` : ''}`,
    )
  const load = useCallback(
    async (active: () => boolean) => {
      setLoading(true)
      setItems([])
      setError('')
      try {
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser()
        if (authError && authError.name !== 'AuthSessionMissingError')
          throw authError
        if (!active()) return
        setUserId(user?.id || null)
        if (!user) {
          setItems([])
          return
        }
        const { error: refreshError } = await supabase.rpc(
          'refresh_my_recommendations',
        )
        if (refreshError) throw refreshError
        const [suggestions, owned, profile] = await Promise.all([
          supabase.rpc('get_my_recommendations', {
            p_kind: kind,
            p_project: projectId || null,
          }),
          supabase
            .from('listings')
            .select('id,title')
            .eq('created_by', user.id)
            .eq('visibility', 'public')
            .is('completed_at', null)
            .order('created_at', { ascending: false })
            .limit(20),
          supabase
            .from('profiles')
            .select('roles,skills')
            .eq('user_id', user.id)
            .maybeSingle(),
        ])
        if (suggestions.error || owned.error || profile.error)
          throw suggestions.error || owned.error || profile.error
        if (active()) {
          setItems(suggestions.data || [])
          setProjects(owned.data || [])
          setEmptyProfile(
            !profile.data?.roles?.length && !profile.data?.skills?.length,
          )
        }
      } catch (issue) {
        logAppError('Рекомендации', issue)
        if (active())
          setError(
            'Не удалось загрузить рекомендации. Повторите попытку позже.',
          )
      } finally {
        if (active()) setLoading(false)
      }
    },
    [kind, projectId],
  )
  useEffect(() => {
    let active = true
    void load(() => active)
    return () => {
      active = false
    }
  }, [load, attempt])
  async function dismiss(item: Suggestion) {
    if (busy) return
    const key = `${item.project_id}:${item.expert_id}`
    setBusy(key)
    setError('')
    try {
      const { error: issue } = await supabase.rpc('dismiss_my_recommendation', {
        p_project: item.project_id,
        p_expert: item.expert_id,
        p_kind: kind,
      })
      if (issue) throw issue
      setItems((current) =>
        current.filter((row) => `${row.project_id}:${row.expert_id}` !== key),
      )
    } catch (issue) {
      logAppError('Скрытие рекомендации', issue)
      setError('Не удалось скрыть рекомендацию. Повторите попытку.')
    } finally {
      setBusy('')
    }
  }
  async function restore() {
    if (busy) return
    setBusy('restore')
    setError('')
    try {
      const { error: issue } = await supabase.rpc(
        'restore_my_recommendations',
        { p_kind: kind },
      )
      if (issue) throw issue
      setAttempt((n) => n + 1)
    } catch (issue) {
      logAppError('Восстановление рекомендаций', issue)
      setError('Не удалось вернуть скрытые рекомендации.')
    } finally {
      setBusy('')
    }
  }
  return (
    <div className="page-shell">
      <PageHeader
        eyebrow="Подходящие задачи и люди"
        title="Рекомендации"
        description="Проекты для ваших навыков и специалисты для вашей команды. Каждая рекомендация сопровождается объяснением."
      >
        <Link href="/settings#notifications" className="action-secondary">
          <BellRing size={18} />
          <UiText text="Настроить оповещения" />
        </Link>
      </PageHeader>
      <div
        className="flex flex-wrap gap-3 mb-6"
        aria-label={t('Тип рекомендаций')}
      >
        <button
          className={
            kind === 'projects' ? 'action-primary' : 'action-secondary'
          }
          aria-pressed={kind === 'projects'}
          disabled={Boolean(busy)}
          onClick={() => navigate('projects')}
        >
          <UiText text="Проекты для меня" />
        </button>
        <button
          className={kind === 'experts' ? 'action-primary' : 'action-secondary'}
          aria-pressed={kind === 'experts'}
          disabled={Boolean(busy)}
          onClick={() => navigate('experts')}
        >
          <UiText text="Специалисты для проектов" />
        </button>
      </div>
      <div className="rounded-2xl border border-blue-100 bg-blue-50 p-5 mb-6 flex items-start gap-3">
        <Sparkles className="shrink-0 text-blue-600" size={22} />
        <div className="text-sm leading-6 text-blue-900">
          <p>
            <UiText text="Подбор учитывает навыки, специализации и общий вуз. Это рекомендация для знакомства, а не подтверждение квалификации." />
          </p>
          <p className="mt-1">
            <UiText text="Не более трёх новых оповещений за 24 часа. Повторные уведомления об одной паре проект–специалист не отправляются." />
          </p>
        </div>
      </div>
      {error && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800 mb-5"
        >
          {t(error)}{' '}
          <button
            className="underline ml-2"
            disabled={Boolean(busy)}
            onClick={() => setAttempt((n) => n + 1)}
          >
            <UiText text="Повторить" />
          </button>
        </div>
      )}
      {loading ? (
        <PageLoading label="Подбираем рекомендации…" />
      ) : !userId ? (
        <EmptyState
          title="Войдите, чтобы получить подборку"
          description="Заполните навыки в профиле или опубликуйте проект — мы подберём подходящие варианты."
        >
          <Link className="action-primary" href="/auth">
            <UiText text="Войти" />
          </Link>
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-4 justify-between mb-6">
            {kind === 'experts' && (
              <div className="min-w-0 w-full sm:w-auto sm:min-w-72">
                <label htmlFor="recommended-project" className="filter-label">
                  <UiText text="Ваш проект" />
                </label>
                <select
                  id="recommended-project"
                  className="w-full"
                  value={projectId}
                  disabled={Boolean(busy)}
                  onChange={(e) => navigate(kind, e.target.value)}
                >
                  <option value="">{t('Все мои проекты')}</option>
                  {projects.map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.title}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => setAttempt((n) => n + 1)}
                className="action-secondary"
                disabled={Boolean(busy)}
              >
                <RotateCcw size={16} />
                <UiText text="Обновить подборку" />
              </button>
              <button
                onClick={restore}
                className="text-sm text-blue-700 underline min-h-11"
                disabled={Boolean(busy)}
              >
                <UiText text="Вернуть скрытые рекомендации" />
              </button>
            </div>
          </div>
          {kind === 'projects' && emptyProfile && (
            <p className="rounded-xl border bg-white p-4 mb-5 text-sm">
              <UiText text="Добавьте навыки и специализации, чтобы подборка стала точнее." />{' '}
              <Link className="text-blue-700 underline" href="/profile">
                <UiText text="Заполнить профиль" />
              </Link>
            </p>
          )}
          {!items.length && !error ? (
            <EmptyState
              title="Подходящих рекомендаций пока нет"
              description={
                kind === 'projects'
                  ? 'Добавьте навыки в профиль. Здесь появятся открытые проекты с совпадающими требованиями.'
                  : 'Опубликуйте проект и укажите нужные навыки и роли. Подборка обновится, когда появятся подходящие специалисты.'
              }
            >
              <Link
                href={kind === 'projects' ? '/profile' : '/listings/new'}
                className="action-primary"
              >
                <UiText
                  text={
                    kind === 'projects' ? 'Заполнить профиль' : 'Создать проект'
                  }
                />
              </Link>
            </EmptyState>
          ) : (
            <div className="grid md:grid-cols-2 gap-5">
              {items.map((item) => {
                const key = `${item.project_id}:${item.expert_id}`
                return (
                  <article key={key} className="expert-card min-w-0">
                    <div className="flex items-start gap-3 justify-between">
                      <div className="min-w-0">
                        <p className="eyebrow mb-2">
                          <UiText
                            text={
                              kind === 'projects'
                                ? 'Подходящий проект'
                                : 'Подходящий специалист'
                            }
                          />
                        </p>
                        <h2 className="text-xl font-semibold break-words">
                          {kind === 'projects'
                            ? item.project_title
                            : item.expert_name}
                        </h2>
                      </div>
                      <button
                        className="icon-button shrink-0"
                        disabled={Boolean(busy)}
                        onClick={() => dismiss(item)}
                        aria-label={`${t('Скрыть рекомендацию')}: ${kind === 'projects' ? item.project_title : item.expert_name}`}
                      >
                        <X size={18} />
                      </button>
                    </div>
                    {kind === 'projects' ? (
                      <p className="text-sm text-slate-600 leading-7 my-4 line-clamp-3">
                        {item.project_description}
                      </p>
                    ) : (
                      <div className="text-sm text-slate-600 my-4">
                        <p>
                          {item.expert_code} · {priceLabel(item)}
                        </p>
                        <p className="mt-2">
                          <UiText text="Для проекта" />:{' '}
                          <Link
                            className="text-blue-700 underline"
                            href={`/listings/${item.project_id}`}
                          >
                            {item.project_title}
                          </Link>
                        </p>
                      </div>
                    )}
                    <div className="rounded-xl bg-slate-50 p-4 space-y-3 mb-5">
                      <h3 className="text-sm font-semibold">
                        <UiText text="Почему рекомендуем" />
                      </h3>
                      {item.matched_skills.length > 0 && (
                        <div>
                          <p className="text-xs text-slate-500 mb-2">
                            <UiText text="Совпадают навыки" />
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {item.matched_skills.map((tag) => (
                              <span className="skill-tag" key={tag}>
                                {tag}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      {item.matched_roles.length > 0 && (
                        <p className="text-sm">
                          <UiText text="Совпадают специализации" />:{' '}
                          {item.matched_roles.join(', ')}
                        </p>
                      )}
                      {item.university_match && (
                        <p className="text-sm text-blue-700">
                          <UiText text="Указан общий вуз" />
                        </p>
                      )}
                    </div>
                    <div className="mt-auto flex flex-wrap gap-3">
                      <Link
                        href={
                          kind === 'projects'
                            ? `/listings/${item.project_id}`
                            : `/users/${item.expert_id}`
                        }
                        className="action-primary"
                      >
                        <UiText
                          text={
                            kind === 'projects'
                              ? 'Посмотреть проект'
                              : 'Посмотреть профиль'
                          }
                        />
                        <ArrowUpRight size={17} />
                      </Link>
                      {kind === 'experts' && (
                        <Link
                          href={`/users/${item.expert_id}#contact`}
                          className="action-secondary"
                        >
                          <UiText text="Предложить сотрудничество" />
                        </Link>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          )}
          <p className="text-xs text-slate-500 mt-6">
            <UiText text="Показаны до 50 подходящих вариантов. Закрытые, завершённые проекты и уже отправленные отклики исключены." />
          </p>
        </>
      )}
    </div>
  )
}
