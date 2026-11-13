'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUpRight, ChevronRight, ListChecks, MessagesSquare, UsersRound, type LucideIcon } from 'lucide-react'
import { UiText, useT } from '@/components/LocaleProvider'
import { Modal } from '@/components/ui/Modal'
import { supabase } from '@/lib/supabaseClient'
import { logAppError } from '@/lib/appFeedback'
import { loadMyProjects, readCurrentProjectId, rememberCurrentProject, type MyProject } from '@/lib/myProjects'
import { signInHref } from '@/lib/safeRedirect'

// Shortcuts of the blue panel on the home page. Each one opens an existing page of a concrete project:
// - team:      participants on the project overview (/listings/[id]#members)
// - plan:      task board, calendar and Gantt in the workspace (/projects/[id]#plan)
// - materials: files and documents in the workspace (/projects/[id]#materials); the team chat is the
//              «Чат команды» button on the same page.
type Destination = 'team' | 'plan' | 'materials'

const DESTINATIONS: Record<Destination, { title: string; text: string; pickerHint: string; icon: LucideIcon; href: (projectId: string) => string }> = {
  team: {
    title: 'Команда',
    text: 'Роли, участники и приглашения',
    pickerHint: 'Откроется список участников проекта.',
    icon: UsersRound,
    href: (id) => `/listings/${id}#members`,
  },
  plan: {
    title: 'План работ',
    text: 'Задачи, сроки и общий прогресс',
    pickerHint: 'Откроются задачи, календарь и диаграмма Ганта проекта.',
    icon: ListChecks,
    href: (id) => `/projects/${id}#plan`,
  },
  materials: {
    title: 'Обсуждения и материалы',
    text: 'Чат, файлы и история решений',
    pickerHint: 'Откроются файлы и документы рабочей зоны; чат команды — кнопка на той же странице.',
    icon: MessagesSquare,
    href: (id) => `/projects/${id}#materials`,
  },
}
const ORDER: Destination[] = ['team', 'plan', 'materials']
const isDestination = (value: string | null): value is Destination => value === 'team' || value === 'plan' || value === 'materials'

type AuthState = { status: 'loading' } | { status: 'guest' } | { status: 'user'; userId: string }
// `destination: null` — the person only changes the current project.
type DialogState = { destination: Destination | null } | null

export function WorkspacePanel() {
  const t = useT()
  const router = useRouter()
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' })
  const [projects, setProjects] = useState<MyProject[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [pending, setPending] = useState<Destination | null>(null)
  const [retrying, setRetrying] = useState(false)
  const loading = useRef<Promise<MyProject[] | null> | null>(null)

  const fetchProjects = useCallback((userId: string) => {
    if (!loading.current) {
      loading.current = loadMyProjects(userId).then(({ projects: list, error }) => {
        loading.current = null
        if (error) {
          logAppError('Ошибка загрузки проектов для главной страницы', error)
          setLoadError(error)
          setProjects(null)
          return null
        }
        setLoadError(null)
        setProjects(list)
        // A remembered project that is no longer available is forgotten, not replaced by another one.
        const remembered = readCurrentProjectId(userId)
        const valid = remembered && list.some((project) => project.id === remembered) ? remembered : null
        if (remembered && !valid) rememberCurrentProject(userId, null)
        setCurrentId(valid)
        return list
      })
    }
    return loading.current
  }, [])

  useEffect(() => {
    let active = true
    const apply = (userId: string | undefined) => {
      if (!active) return
      setAuth(userId ? { status: 'user', userId } : { status: 'guest' })
      if (!userId) { setProjects(null); setCurrentId(null) }
    }
    supabase.auth.getSession().then(({ data }) => apply(data.session?.user?.id))
    const { data } = supabase.auth.onAuthStateChange((_event, session) => apply(session?.user?.id))
    return () => { active = false; data.subscription.unsubscribe() }
  }, [])

  const userId = auth.status === 'user' ? auth.userId : null
  useEffect(() => { if (userId) void fetchProjects(userId) }, [userId, fetchProjects])

  // The only project needs no choice; several projects need an explicit one.
  const resolveCurrent = (list: MyProject[], selected: string | null) =>
    list.find((project) => project.id === selected) || (list.length === 1 ? list[0] : null)

  const open = useCallback(async (destination: Destination) => {
    if (auth.status === 'loading' || pending) return
    if (auth.status === 'guest') {
      // After sign-in the person returns here and the same shortcut continues.
      router.push(signInHref(`/?workspace=${destination}`))
      return
    }
    setPending(destination)
    const list = projects ?? await fetchProjects(auth.userId)
    setPending(null)
    if (!list) { setDialog({ destination }); return }
    const current = resolveCurrent(list, readCurrentProjectId(auth.userId))
    if (current) {
      rememberCurrentProject(auth.userId, current.id)
      router.push(DESTINATIONS[destination].href(current.id))
      return
    }
    setDialog({ destination })
  }, [auth, pending, projects, fetchProjects, router])

  // Return from sign-in: /?workspace=plan continues the shortcut once, then the parameter is removed.
  const resumed = useRef(false)
  useEffect(() => {
    if (resumed.current || auth.status === 'loading') return
    const params = new URLSearchParams(window.location.search)
    const requested = params.get('workspace')
    if (!params.has('workspace')) return
    resumed.current = true
    params.delete('workspace')
    const query = params.toString()
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`)
    // Deferred: the shortcut runs after this render, not inside the effect.
    if (auth.status === 'user' && isDestination(requested)) window.setTimeout(() => void open(requested), 0)
  }, [auth, open])

  const choose = (project: MyProject) => {
    if (!userId) return
    rememberCurrentProject(userId, project.id)
    setCurrentId(project.id)
  }

  const current = projects ? resolveCurrent(projects, currentId) : null
  const dialogDestination = dialog?.destination ? DESTINATIONS[dialog.destination] : null

  return (
    <>
      <div className="workspace-features">
        {ORDER.map((key) => {
          const { title, text, icon: Icon } = DESTINATIONS[key]
          return (
            <button
              key={key}
              type="button"
              className="workspace-feature"
              data-workspace-shortcut={key}
              aria-busy={pending === key || undefined}
              aria-haspopup={auth.status === 'user' && !current ? 'dialog' : undefined}
              onClick={() => void open(key)}
            >
              <span className="workspace-feature-icon"><Icon size={21} aria-hidden="true" /></span>
              <span className="workspace-feature-text"><strong><UiText text={title} /></strong><span><UiText text={pending === key ? 'Открываем…' : text} /></span></span>
              <ChevronRight className="workspace-feature-arrow" size={18} aria-hidden="true" />
            </button>
          )
        })}
      </div>

      <p className="workspace-current" aria-live="polite">
        {auth.status === 'guest' && <UiText text="После входа откроется выбранный раздел Вашего проекта." />}
        {auth.status === 'user' && projects && projects.length > 0 && (
          <>
            <span className="min-w-0 truncate">
              {current
                ? <><UiText text="Проект:" /> <strong>{current.title}</strong></>
                : <UiText text="Проект не выбран" />}
            </span>
            {projects.length > 1 && (
              <button type="button" className="workspace-current-change" onClick={() => setDialog({ destination: null })}>
                <UiText text={current ? 'Сменить' : 'Выбрать'} />
              </button>
            )}
          </>
        )}
        {auth.status === 'user' && projects && projects.length === 0 && <UiText text="У Вас пока нет проектов с рабочей зоной." />}
      </p>

      <Link href="/dashboard" className="workspace-link"><UiText text="Открыть рабочий центр" /><ArrowUpRight size={21} aria-hidden="true" /></Link>

      <Modal
        open={dialog !== null}
        onClose={() => setDialog(null)}
        className="project-picker"
        title={t(dialogDestination ? `${dialogDestination.title}: выберите проект` : 'Выберите проект')}
        description={t(dialogDestination ? dialogDestination.pickerHint : 'Быстрые переходы на главной будут открывать этот проект.')}
      >
        {loadError || !projects ? (
          <div className="project-picker-state" role="alert">
            <p><UiText text="Не удалось загрузить Ваши проекты. Проверьте соединение и повторите." /></p>
            <button
              type="button"
              className="action-primary disabled:opacity-60"
              disabled={retrying}
              aria-busy={retrying || undefined}
              onClick={async () => {
                if (!userId) return
                setRetrying(true)
                await fetchProjects(userId)
                setRetrying(false)
              }}
            >
              <UiText text={retrying ? 'Загружаем…' : 'Повторить'} />
            </button>
          </div>
        ) : projects.length === 0 ? (
          <div className="project-picker-state">
            <p><UiText text="У Вас пока нет проектов с рабочей зоной. Создайте свой проект или найдите подходящий и отправьте отклик." /></p>
            <div className="flex flex-wrap gap-2">
              <Link href="/listings/new" className="action-primary"><UiText text="Создать проект" /></Link>
              <Link href="/listings" className="action-secondary"><UiText text="Найти проект" /></Link>
            </div>
          </div>
        ) : (
          <ul className="project-picker-list">
            {projects.map((project) => {
              const meta = (
                <>
                  <span className="project-picker-title">{project.title}</span>
                  <span className="project-picker-meta">
                    <UiText text={project.role === 'owner' ? 'Вы автор' : 'Вы участник'} />
                    {project.completedAt && <> · <UiText text="Завершён" /></>}
                    {project.id === current?.id && <> · <UiText text="Выбран сейчас" /></>}
                  </span>
                </>
              )
              return (
                <li key={project.id}>
                  {dialog?.destination ? (
                    <Link
                      href={DESTINATIONS[dialog.destination].href(project.id)}
                      className="project-picker-item"
                      onClick={() => choose(project)}
                    >
                      <span className="min-w-0">{meta}</span><ChevronRight size={18} aria-hidden="true" />
                    </Link>
                  ) : (
                    <button type="button" className="project-picker-item" aria-pressed={project.id === current?.id} onClick={() => { choose(project); setDialog(null) }}>
                      <span className="min-w-0">{meta}</span><ChevronRight size={18} aria-hidden="true" />
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Modal>
    </>
  )
}
