'use client'

import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { RefreshCw } from 'lucide-react'
import { useLocale, useT } from '@/components/LocaleProvider'
import type { ProjectMember, Task } from '../types'
import { BacklogPanel } from './BacklogPanel'
import { SettingsPanel } from './SettingsPanel'
import { SprintsPanel } from './SprintsPanel'
import { StagesPanel } from './StagesPanel'
import { MODE_TEXT } from './text'
import { NoticeBox, errorNotice } from './shared'
import type { PlanningController } from './usePlanning'

type Tab = 'settings' | 'backlog' | 'sprints'

/**
 * Planning section of the project workspace (ER-012). Works on top of the existing tasks: the board,
 * the Gantt chart, the calendar and files are unchanged. Scrum adds a separate «Бэклог / Спринты»
 * switch; other modes show the rules and stages only.
 */
export function ProjectPlanning({ planning, projectId, members, tasks, onOpenTask }: {
  planning: PlanningController
  projectId: string
  members: ProjectMember[]
  tasks: Task[]
  onOpenTask: (taskId: string) => void
}) {
  const t = useT()
  const locale = useLocale()
  const id = useId()
  const [chosen, setChosen] = useState<Tab | null>(null)
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({ settings: null, backlog: null, sprints: null })
  const data = planning.data

  const header = (
    <div className="planning-head">
      <div>
        <p className="eyebrow">{t('Планирование')}</p>
        <h2 className="text-xl font-semibold">{t('Режим работы, бэклог и спринты')}</h2>
      </div>
      {planning.status === 'ready' && data && (
        <div className="planning-head-side">
          <span className="planning-mode-badge">{t(MODE_TEXT[data.settings.mode].label)}</span>
          <button type="button" className="action-secondary planning-button" disabled={planning.refreshing || Boolean(planning.busy)} onClick={() => void planning.refresh()}>
            <RefreshCw size={16} aria-hidden="true" className={planning.refreshing ? 'planning-spin' : ''} /> {t(planning.refreshing ? 'Обновляем…' : 'Обновить')}
          </button>
        </div>
      )}
    </div>
  )

  if (planning.status !== 'ready' || !data) {
    const message = {
      loading: 'Загружаем планирование…',
      unavailable: 'Планирование пока недоступно на сервере: обновление базы данных ещё не применено. Доска, Гант, календарь и файлы работают как раньше.',
      forbidden: 'Нет доступа к планированию проекта. Возможно, Ваше участие в проекте прекращено.',
      session_changed: 'Аккаунт изменился в другой вкладке или Вы вышли. Данные планирования скрыты — обновите страницу.',
      error: 'Не удалось загрузить планирование.',
      ready: '',
    }[planning.status]
    return (
      <div className="planning-panel" aria-busy={planning.status === 'loading' || undefined}>
        {header}
        <div className={`planning-state-box is-${planning.status}`} role={planning.status === 'loading' ? 'status' : 'alert'}>
          <p>{t(message)}</p>
          {planning.status === 'error' && planning.error && <p className="planning-notice-detail">{t(errorNotice(planning.error)?.text ?? '')}</p>}
          {(planning.status === 'error' || planning.status === 'forbidden') && <button type="button" className="action-secondary planning-button" onClick={() => void planning.refresh()}>{t('Повторить')}</button>}
          {planning.status === 'session_changed' && <button type="button" className="action-primary planning-button" onClick={() => window.location.reload()}>{t('Обновить страницу')}</button>}
        </div>
      </div>
    )
  }

  const scrum = data.settings.mode === 'scrum' && data.sprintsAvailable
  const showSprints = data.sprintsAvailable && (scrum || data.sprints.length > 0)
  const tabs: Tab[] = ['settings', ...(scrum ? ['backlog' as const] : []), ...(showSprints ? ['sprints' as const] : [])]
  const tab: Tab = chosen && tabs.includes(chosen) ? chosen : scrum ? 'backlog' : 'settings'
  const label: Record<Tab, string> = { settings: 'Режим и правила', backlog: 'Бэклог', sprints: 'Спринты' }
  const props = { planning, data, projectId, members, tasks, onOpenTask }

  const onTabKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = tabs.indexOf(tab)
    const next = event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length]
      : event.key === 'ArrowLeft' ? tabs[(index - 1 + tabs.length) % tabs.length]
        : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1] : null
    if (!next) return
    event.preventDefault()
    setChosen(next)
    tabRefs.current[next]?.focus()
  }

  return (
    <div className="planning-panel">
      {header}
      <p className="planning-hint planning-sync">
        {t('Данные на')} {new Date(data.loadedAt).toLocaleTimeString(locale === 'en' ? 'en-GB' : 'ru-RU', { hour: '2-digit', minute: '2-digit' })}. {t('Изменения других участников появятся после обновления: автоматической синхронизации здесь нет.')}
      </p>
      {planning.error && <NoticeBox notice={{ tone: 'warning', text: 'Не удалось обновить данные — показаны прежние.', detail: errorNotice(planning.error)?.text }} />}

      {tabs.length > 1 && (
        <div className="planning-tabs" role="tablist" aria-label={t('Разделы планирования')}>
          {tabs.map((item) => (
            <button
              key={item}
              ref={(node) => { tabRefs.current[item] = node }}
              type="button"
              role="tab"
              id={`${id}-tab-${item}`}
              aria-selected={tab === item}
              aria-controls={`${id}-panel`}
              tabIndex={tab === item ? 0 : -1}
              className="planning-tab"
              onClick={() => setChosen(item)}
              onKeyDown={onTabKey}
            >
              {t(label[item])}
            </button>
          ))}
        </div>
      )}

      {/* The first interaction pins the shown tab: saving Scrum mode must not switch the person away. */}
      <div id={`${id}-panel`} role={tabs.length > 1 ? 'tabpanel' : undefined} aria-labelledby={tabs.length > 1 ? `${id}-tab-${tab}` : undefined} className="planning-tab-panel" onFocusCapture={() => { if (!chosen) setChosen(tab) }} onPointerDownCapture={() => { if (!chosen) setChosen(tab) }}>
        {tab === 'settings' && (
          <>
            <SettingsPanel {...props} />
            <StagesPanel planning={planning} data={data} projectId={projectId} tasks={tasks} />
          </>
        )}
        {tab === 'backlog' && <BacklogPanel {...props} />}
        {tab === 'sprints' && <SprintsPanel {...props} />}
      </div>
    </div>
  )
}
