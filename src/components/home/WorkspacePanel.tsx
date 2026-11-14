'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowUpRight, ChevronRight, ListChecks, MessagesSquare, Search, UsersRound, type LucideIcon } from 'lucide-react'
import { UiText, useT } from '@/components/LocaleProvider'
import { Modal } from '@/components/ui/Modal'
import { supabase } from '@/lib/supabaseClient'
import { logAppError } from '@/lib/appFeedback'
import {
  loadAccessibleProject,
  loadMemberProjects,
  loadOwnedProjects,
  mergeProjects,
  readCurrentProjectId,
  rememberCurrentProject,
  type MyProject,
} from '@/lib/myProjects'
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

// Two independent paged lists: own projects and participation (see src/lib/myProjects.ts).
type Kind = 'owned' | 'member'
type Section = {
  items: MyProject[]
  next: number | null
  loading: boolean
  loaded: boolean
  error: string | null
  /** Offset of the request that failed, for «Повторить». */
  failedOffset: number | null
}
const SECTION: Section = { items: [], next: null, loading: true, loaded: false, error: null, failedOffset: null }
const KINDS: Kind[] = ['owned', 'member']
const LOADERS = { owned: loadOwnedProjects, member: loadMemberProjects }
const SEARCH_DELAY_MS = 300

/** What the first, unfiltered pages say: used for the panel line and for opening a shortcut. */
type Overview = {
  /** The remembered project, verified with the server; null when none or no longer available. */
  current: MyProject | null
  /** The only accessible project, when exactly one exists. */
  single: MyProject | null
  /** No accessible projects at all. */
  none: boolean
  /** More than one project (a choice is possible). */
  several: boolean
  failed: boolean
}

export function WorkspacePanel() {
  const t = useT()
  const router = useRouter()
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' })
  const [sections, setSections] = useState<Record<Kind, Section>>({ owned: SECTION, member: SECTION })
  const [overview, setOverview] = useState<Overview | null>(null)
  const [current, setCurrent] = useState<MyProject | null>(null)
  const [dialog, setDialog] = useState<DialogState>(null)
  const [pending, setPending] = useState<Destination | null>(null)
  const [query, setQuery] = useState('')
  const [activeQuery, setActiveQuery] = useState('')
  // Each section answers only its latest request; older answers (previous search) are dropped.
  const tokens = useRef<Record<Kind, number>>({ owned: 0, member: 0 })
  const overviewPromise = useRef<Promise<Overview> | null>(null)

  const userId = auth.status === 'user' ? auth.userId : null

  const loadSection = useCallback(async (kind: Kind, user: string, offset: number, text: string) => {
    const token = (tokens.current[kind] += 1)
    setSections((all) => ({
      ...all,
      [kind]: offset === 0 ? { ...SECTION, loading: true } : { ...all[kind], loading: true, error: null, failedOffset: null },
    }))
    const page = await LOADERS[kind](user, { offset, query: text })
    if (token !== tokens.current[kind]) return null
    if (page.error) logAppError('Ошибка загрузки проектов для главной страницы', page.error)
    setSections((all) => {
      const before = all[kind]
      const section: Section = page.error
        ? { ...before, loading: false, error: page.error, failedOffset: offset }
        : { items: mergeProjects(offset === 0 ? [] : before.items, page.items), next: page.next, loading: false, loaded: true, error: null, failedOffset: null }
      return { ...all, [kind]: section }
    })
    return page
  }, [])

  // First pages without a filter, plus a check of the remembered project.
  const loadOverview = useCallback((user: string) => {
    const run = async (): Promise<Overview> => {
      const remembered = readCurrentProjectId(user)
      const [owned, member, checked] = await Promise.all([
        loadSection('owned', user, 0, ''),
        loadSection('member', user, 0, ''),
        remembered ? loadAccessibleProject(user, remembered) : Promise.resolve({ project: null, error: null }),
      ])
      // A remembered project that is no longer available is forgotten, not replaced by another one.
      if (remembered && !checked.error && !checked.project) rememberCurrentProject(user, null)
      const failed = !owned || !member || Boolean(owned.error || member.error)
      const items = failed ? [] : [...owned!.items, ...member!.items]
      const complete = !failed && owned!.next === null && member!.next === null
      const result: Overview = {
        current: checked.project,
        single: complete && items.length === 1 ? items[0] : null,
        none: complete && items.length === 0,
        several: !failed && (items.length > 1 || !complete),
        failed,
      }
      setOverview(result)
      setCurrent(checked.project)
      return result
    }
    overviewPromise.current = run()
    return overviewPromise.current
  }, [loadSection])

  useEffect(() => {
    let active = true
    const apply = (id: string | undefined) => {
      if (!active) return
      setAuth((before) => (before.status === 'user' && before.userId === id ? before : id ? { status: 'user', userId: id } : { status: 'guest' }))
      if (!id) { setOverview(null); setCurrent(null); overviewPromise.current = null }
    }
    supabase.auth.getSession().then(({ data }) => apply(data.session?.user?.id))
    const { data } = supabase.auth.onAuthStateChange((_event, session) => apply(session?.user?.id))
    return () => { active = false; data.subscription.unsubscribe() }
  }, [])

  // Deferred to a timer: loading starts after this render, not synchronously inside the effect.
  useEffect(() => {
    if (!userId) return
    const timer = window.setTimeout(() => void loadOverview(userId), 0)
    return () => window.clearTimeout(timer)
  }, [userId, loadOverview])

  const choose = useCallback((project: MyProject) => {
    if (!userId) return
    rememberCurrentProject(userId, project.id)
    setCurrent(project)
  }, [userId])

  const open = useCallback(async (destination: Destination) => {
    if (auth.status === 'loading' || pending) return
    if (auth.status === 'guest') {
      // After sign-in (and, for new accounts, onboarding) the person returns here and the same shortcut continues.
      router.push(signInHref(`/?workspace=${destination}`))
      return
    }
    setPending(destination)
    const known = await (overviewPromise.current ?? loadOverview(auth.userId))
    setPending(null)
    // The only project needs no choice; several projects need an explicit one. Nothing is chosen at random.
    const target = current ?? known.current ?? known.single
    if (target) {
      choose(target)
      router.push(DESTINATIONS[destination].href(target.id))
      return
    }
    setDialog({ destination })
  }, [auth, pending, current, loadOverview, choose, router])

  // Return from sign-in: /?workspace=plan continues the shortcut once, then the parameter is removed.
  const resumed = useRef(false)
  useEffect(() => {
    if (resumed.current || auth.status === 'loading') return
    const params = new URLSearchParams(window.location.search)
    const requested = params.get('workspace')
    if (!params.has('workspace')) return
    resumed.current = true
    params.delete('workspace')
    const rest = params.toString()
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`)
    // Deferred: the shortcut runs after this render, not inside the effect.
    if (auth.status === 'user' && isDestination(requested)) window.setTimeout(() => void open(requested), 0)
  }, [auth, open])

  // Server-side title search while the picker is open.
  useEffect(() => {
    if (!dialog || !userId) return
    const text = query.trim()
    if (text === activeQuery) return
    const timer = window.setTimeout(() => {
      setActiveQuery(text)
      for (const kind of KINDS) void loadSection(kind, userId, 0, text)
    }, SEARCH_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [dialog, userId, query, activeQuery, loadSection])

  const closeDialog = () => {
    setDialog(null)
    // The next opening starts from the full lists again.
    if (activeQuery && userId) {
      setQuery('')
      setActiveQuery('')
      for (const kind of KINDS) void loadSection(kind, userId, 0, '')
    } else {
      setQuery('')
    }
  }

  const retry = (kind: Kind) => {
    if (!userId) return
    const offset = sections[kind].failedOffset ?? 0
    void loadSection(kind, userId, offset, activeQuery)
  }

  const dialogDestination = dialog?.destination ? DESTINATIONS[dialog.destination] : null
  const allLoaded = sections.owned.loaded && sections.member.loaded
  const anyError = Boolean(sections.owned.error || sections.member.error)
  const shown = sections.owned.items.length + sections.member.items.length
  const noProjects = !activeQuery && allLoaded && !anyError && shown === 0 && sections.owned.next === null && sections.member.next === null
  const searching = query.trim() !== activeQuery

  const renderItem = (project: MyProject) => {
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
          <Link href={DESTINATIONS[dialog.destination].href(project.id)} className="project-picker-item" onClick={() => choose(project)}>
            <span className="min-w-0">{meta}</span><ChevronRight size={18} aria-hidden="true" />
          </Link>
        ) : (
          <button type="button" className="project-picker-item" aria-pressed={project.id === current?.id} onClick={() => { choose(project); closeDialog() }}>
            <span className="min-w-0">{meta}</span><ChevronRight size={18} aria-hidden="true" />
          </button>
        )}
      </li>
    )
  }

  const renderSection = (kind: Kind) => {
    const section = sections[kind]
    const heading = kind === 'owned' ? 'Мои проекты' : 'Участвую'
    const moreLabel = kind === 'member' && activeQuery ? 'Искать дальше' : 'Показать ещё'
    return (
      <section className="project-picker-section" data-section={kind} aria-labelledby={`project-picker-${kind}`} aria-busy={section.loading || undefined}>
        <h3 id={`project-picker-${kind}`} className="project-picker-heading">
          <UiText text={heading} />
          {section.loaded && <span className="project-picker-count">{section.items.length}{section.next !== null ? '+' : ''}</span>}
        </h3>
        {section.items.length > 0 && <ul className="project-picker-list">{section.items.map(renderItem)}</ul>}
        {section.loading && (
          <p className="project-picker-note" role="status"><UiText text={section.items.length ? 'Загружаем ещё…' : 'Загружаем…'} /></p>
        )}
        {!section.loading && section.error && (
          <div className="project-picker-error" role="alert">
            <p><UiText text={section.items.length ? 'Не удалось загрузить следующие проекты.' : 'Не удалось загрузить проекты.'} /> <UiText text="Проверьте соединение и повторите." /></p>
            <button type="button" className="action-secondary min-h-10 px-3" onClick={() => retry(kind)}><UiText text="Повторить" /></button>
          </div>
        )}
        {!section.loading && !section.error && section.loaded && section.items.length === 0 && section.next === null && (
          <p className="project-picker-note"><UiText text={activeQuery ? 'Совпадений нет.' : kind === 'owned' ? 'Вы пока не создали проектов.' : 'Вы пока не участвуете в чужих проектах.'} /></p>
        )}
        {!section.loading && !section.error && section.next !== null && (
          <button type="button" className="project-picker-more" onClick={() => userId && void loadSection(kind, userId, section.next ?? 0, activeQuery)}>
            <UiText text={moreLabel} />
          </button>
        )}
        {!section.loading && !section.error && kind === 'member' && activeQuery && section.next !== null && (
          <p className="project-picker-note"><UiText text="Участие просматривается порциями; часть проектов ещё не проверена." /></p>
        )}
      </section>
    )
  }

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
              aria-haspopup={auth.status === 'user' && !current && !overview?.single ? 'dialog' : undefined}
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
        {auth.status === 'user' && overview && !overview.none && !overview.failed && (
          <>
            <span className="min-w-0 truncate">
              {current
                ? <><UiText text="Проект:" /> <strong>{current.title}</strong></>
                : overview.single
                  ? <><UiText text="Проект:" /> <strong>{overview.single.title}</strong></>
                  : <UiText text="Проект не выбран" />}
            </span>
            {overview.several && (
              <button type="button" className="workspace-current-change" onClick={() => setDialog({ destination: null })}>
                <UiText text={current ? 'Сменить' : 'Выбрать'} />
              </button>
            )}
          </>
        )}
        {auth.status === 'user' && overview?.none && <UiText text="У Вас пока нет проектов с рабочей зоной." />}
      </p>

      <Link href="/dashboard" className="workspace-link"><UiText text="Открыть рабочий центр" /><ArrowUpRight size={21} aria-hidden="true" /></Link>

      <Modal
        open={dialog !== null}
        onClose={closeDialog}
        className="project-picker"
        title={dialogDestination ? `${t(dialogDestination.title)}: ${t('выберите проект')}` : t('Выберите проект')}
        description={t(dialogDestination ? dialogDestination.pickerHint : 'Быстрые переходы на главной будут открывать этот проект.')}
      >
        {noProjects ? (
          <div className="project-picker-state">
            <p><UiText text="У Вас пока нет проектов с рабочей зоной. Создайте свой проект или найдите подходящий и отправьте отклик." /></p>
            <div className="flex flex-wrap gap-2">
              <Link href="/listings/new" className="action-primary"><UiText text="Создать проект" /></Link>
              <Link href="/listings" className="action-secondary"><UiText text="Найти проект" /></Link>
            </div>
          </div>
        ) : (
          <>
            <div className="project-picker-search">
              <label htmlFor="project-picker-search"><UiText text="Поиск по названию" /></label>
              <div className="project-picker-search-field">
                <Search size={17} aria-hidden="true" />
                <input
                  id="project-picker-search"
                  type="search"
                  autoComplete="off"
                  value={query}
                  maxLength={120}
                  onChange={(event) => setQuery(event.target.value)}
                  aria-describedby="project-picker-search-state"
                />
              </div>
              <p id="project-picker-search-state" className="project-picker-note" aria-live="polite">
                {searching
                  ? <UiText text="Ищем…" />
                  : activeQuery
                    ? <>{t('Найдено')}: {shown}{sections.owned.next !== null || sections.member.next !== null ? '+' : ''}</>
                    : null}
              </p>
            </div>
            {KINDS.map((kind) => <div key={kind}>{renderSection(kind)}</div>)}
          </>
        )}
      </Modal>
    </>
  )
}
