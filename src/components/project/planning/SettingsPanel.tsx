'use client'

import { useId, useState } from 'react'
import { useT } from '@/components/LocaleProvider'
import * as P from '@/lib/planning'
import { MODE_TEXT, ROLE_TEXT } from './text'
import { NoticeBox, errorNotice, useMemberName, type Notice, type PanelProps } from './shared'

const pick = (s: P.PlanningSettings): P.SettingsDraft => ({ mode: s.mode, goal: s.goal, definition_of_done: s.definition_of_done, wip_mode: s.wip_mode, delegate_to_roles: s.delegate_to_roles })
const same = (a: P.SettingsDraft, b: P.SettingsDraft) => a.mode === b.mode && a.goal === b.goal && a.definition_of_done === b.definition_of_done && a.wip_mode === b.wip_mode && a.delegate_to_roles === b.delegate_to_roles

export function SettingsPanel({ planning, data, projectId, members, tasks }: PanelProps) {
  const t = useT()
  const id = useId()
  const { caps } = planning
  const server = data.settings
  // The draft remembers the version it was started from: a save never silently overwrites newer data.
  const [edit, setEdit] = useState<{ draft: P.SettingsDraft; base: number } | null>(null)
  const [conflict, setConflict] = useState(false)
  const [notice, setNotice] = useState<Notice>(null)
  const draft = edit?.draft ?? pick(server)
  const dirty = Boolean(edit) && !same(draft, pick(server))
  const activeSprint = data.sprints.find((sprint) => sprint.state === 'active')
  const overWip = data.stages.filter((stage) => {
    const state = P.wipState(stage, tasks.map((task) => ({ stage_id: task.stage_id ?? null, status: task.status })), { mode: draft.mode, wip_mode: 'soft' })
    return state.over
  })

  const change = (patch: Partial<P.SettingsDraft>) => {
    setNotice(null)
    setEdit({ draft: { ...draft, ...patch }, base: edit?.base ?? server.version })
  }

  const save = async (base: number) => {
    if (!edit) return
    if (draft.goal.length > P.GOAL_MAX || draft.definition_of_done.length > P.DOD_MAX) {
      setNotice({ tone: 'error', text: 'Цель — до 4000 символов, критерии готовности — до 8000.' })
      return
    }
    const result = await planning.perform('settings', (db) => P.saveSettings(db, projectId, base, draft))
    if (!result) return
    if (result.ok) {
      setEdit(null)
      setConflict(false)
      setNotice({ tone: 'success', text: 'Настройки планирования сохранены.' })
    } else {
      setConflict(result.error.kind === 'conflict')
      setNotice(errorNotice(result.error))
    }
  }

  return (
    <div className="planning-block" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`} className="planning-block-title">{t('Режим и правила')}</h3>
      {!caps.canManage && (
        <p className="planning-hint">{t(caps.readOnly ? 'Только чтение: проект завершён.' : 'Настройки меняет автор проекта, а при включённом делегировании — Product Owner или Scrum Master.')}</p>
      )}

      <fieldset className="planning-modes" disabled={!caps.canManage || Boolean(planning.busy)}>
        <legend className="planning-label">{t('Режим работы')}</legend>
        {P.PLANNING_MODES.map((mode) => (
          <label key={mode} className={`planning-mode ${draft.mode === mode ? 'is-selected' : ''}`}>
            <input type="radio" name={`${id}-mode`} value={mode} checked={draft.mode === mode} onChange={() => change({ mode })} />
            <span><strong>{t(MODE_TEXT[mode].label)}</strong><span>{t(MODE_TEXT[mode].description)}</span></span>
          </label>
        ))}
      </fieldset>
      {activeSprint && draft.mode !== 'scrum' && (
        <p className="planning-warning" role="note">{t('Пока идёт спринт, выйти из режима Scrum нельзя: сначала завершите или отмените активный спринт.')}</p>
      )}
      {draft.mode === 'scrum' && !data.sprintsAvailable && (
        <p className="planning-warning" role="note">{t('Бэклог и спринты пока недоступны на сервере: вторая часть обновления базы данных ещё не применена.')}</p>
      )}

      <div className="planning-grid">
        <label className="planning-field">
          <span className="planning-label">{t('Цель проекта')}</span>
          <textarea value={draft.goal} maxLength={P.GOAL_MAX} rows={3} disabled={!caps.canManage || Boolean(planning.busy)} onChange={(e) => change({ goal: e.target.value })} placeholder={t('Чего команда должна достичь')} />
        </label>
        <label className="planning-field">
          <span className="planning-label">{t('Критерии готовности (Definition of Done)')}</span>
          <textarea value={draft.definition_of_done} maxLength={P.DOD_MAX} rows={3} disabled={!caps.canManage || Boolean(planning.busy)} onChange={(e) => change({ definition_of_done: e.target.value })} placeholder={t('Когда задача считается выполненной')} />
          <span className="planning-hint">{t('Текст для команды: сервер не проверяет его автоматически. Задача завершена, когда её статус — «Готово».')}</span>
        </label>
      </div>

      <fieldset className="planning-inline" disabled={!caps.canManage || Boolean(planning.busy) || draft.mode === 'simple'}>
        <legend className="planning-label">{t('WIP-лимиты этапов')}</legend>
        <label><input type="radio" name={`${id}-wip`} checked={draft.wip_mode === 'soft'} onChange={() => change({ wip_mode: 'soft' })} /> {t('Мягкие: превышение разрешено и показывается')}</label>
        <label><input type="radio" name={`${id}-wip`} checked={draft.wip_mode === 'strict'} onChange={() => change({ wip_mode: 'strict' })} /> {t('Строгие: сервер не пускает задачу в заполненный этап')}</label>
        {draft.mode === 'simple' && <p className="planning-hint">{t('В простом режиме WIP-лимиты не действуют.')}</p>}
        {draft.wip_mode === 'strict' && overWip.length > 0 && (
          <p className="planning-warning" role="note">{t('Сначала устраните превышения WIP: строгий режим нельзя включить, пока этап переполнен.')}</p>
        )}
      </fieldset>

      <label className="planning-check">
        <input type="checkbox" checked={draft.delegate_to_roles} disabled={!caps.canChangeDelegation || Boolean(planning.busy)} onChange={(e) => change({ delegate_to_roles: e.target.checked })} />
        <span>{t('Делегировать управление планированием Product Owner и Scrum Master')}{!caps.canChangeDelegation && <span className="planning-hint"> {t('(меняет только автор)')}</span>}</span>
      </label>

      {caps.canManage && (
        <div className="planning-actions">
          <button type="button" className="action-primary planning-button" disabled={!dirty || Boolean(planning.busy)} onClick={() => void save(edit?.base ?? server.version)}>
            {t(planning.busy === 'settings' ? 'Сохраняем…' : 'Сохранить настройки')}
          </button>
          {edit && <button type="button" className="action-secondary planning-button" disabled={Boolean(planning.busy)} onClick={() => { setEdit(null); setConflict(false); setNotice(null) }}>{t('Отменить изменения')}</button>}
        </div>
      )}
      <NoticeBox notice={notice}>
        {conflict && edit && (
          <>
            <button type="button" className="action-primary planning-button" disabled={Boolean(planning.busy)} onClick={() => { setEdit({ draft: edit.draft, base: server.version }); void save(server.version) }}>{t('Сохранить мои значения поверх новых')}</button>
            <button type="button" className="action-secondary planning-button" onClick={() => { setEdit(null); setConflict(false); setNotice(null) }}>{t('Взять актуальные значения')}</button>
          </>
        )}
      </NoticeBox>
      {conflict && edit && (
        <p className="planning-hint">{t('Сейчас на сервере')}: {t(MODE_TEXT[server.mode].label)} · {t(server.wip_mode === 'strict' ? 'строгие WIP' : 'мягкие WIP')} · {t(server.delegate_to_roles ? 'делегирование включено' : 'делегирование выключено')}</p>
      )}

      <RolesBlock planning={planning} data={data} projectId={projectId} members={members} />
    </div>
  )
}

function RolesBlock({ planning, data, projectId, members }: Pick<PanelProps, 'planning' | 'data' | 'projectId' | 'members'>) {
  const t = useT()
  const id = useId()
  const name = useMemberName(members)
  const [notice, setNotice] = useState<Notice>(null)
  const { caps } = planning
  const holder = (role: P.PlanningRoleName) => data.roles.find((item) => item.role === role)?.user_id ?? null
  const developers = new Set(data.roles.filter((item) => item.role === 'developer').map((item) => item.user_id))

  // Replacing a unique holder is one atomic server operation.
  const assignLead = async (role: 'product_owner' | 'scrum_master', userId: string) => {
    const previous = holder(role)
    if (previous === (userId || null)) return
    const result = await planning.perform(`role-${role}`, (db) => P.replaceLead(db, projectId, data.settings.version, role, userId || null))
    if (!result) return
    setNotice(result.ok ? { tone: 'success', text: 'Роль сохранена.' } : errorNotice(result.error))
  }

  const toggleDeveloper = async (userId: string, assigned: boolean) => {
    const result = await planning.perform(`role-dev-${userId}`, (db) => P.setRole(db, projectId, data.settings.version, userId, 'developer', assigned))
    if (!result) return
    setNotice(result.ok ? { tone: 'success', text: 'Роль сохранена.' } : errorNotice(result.error))
  }

  return (
    <div className="planning-subblock">
      <h4 className="planning-subtitle">{t('Роли команды')}</h4>
      <p className="planning-hint">{t('Product Owner всегда может менять порядок бэклога. Управлять настройками и спринтами Product Owner и Scrum Master могут только при включённом делегировании. Роль действует, пока человек остаётся участником проекта.')}</p>
      {caps.canAssignRoles ? (
        <div className="planning-grid">
          {(['product_owner', 'scrum_master'] as const).map((role) => (
            <label key={role} className="planning-field">
              <span className="planning-label">{t(ROLE_TEXT[role])}</span>
              <select value={holder(role) ?? ''} disabled={Boolean(planning.busy)} onChange={(e) => void assignLead(role, e.target.value)}>
                <option value="">{t('Не назначен')}</option>
                {members.map((member) => <option key={member.user_id} value={member.user_id}>{member.display_name || t('Участник без имени')}</option>)}
              </select>
            </label>
          ))}
          <fieldset className="planning-field">
            <legend className="planning-label">{t(ROLE_TEXT.developer)}</legend>
            {members.map((member) => (
              <label key={member.user_id} className="planning-check">
                <input type="checkbox" id={`${id}-${member.user_id}`} checked={developers.has(member.user_id)} disabled={Boolean(planning.busy)} onChange={(e) => void toggleDeveloper(member.user_id, e.target.checked)} />
                <span>{member.display_name || t('Участник без имени')}</span>
              </label>
            ))}
          </fieldset>
        </div>
      ) : (
        <dl className="planning-dl">
          <div><dt>{t(ROLE_TEXT.product_owner)}</dt><dd>{name(holder('product_owner'))}</dd></div>
          <div><dt>{t(ROLE_TEXT.scrum_master)}</dt><dd>{name(holder('scrum_master'))}</dd></div>
          <div><dt>{t(ROLE_TEXT.developer)}</dt><dd>{developers.size ? [...developers].map((user) => name(user)).join(', ') : t('Не назначены')}</dd></div>
        </dl>
      )}
      <NoticeBox notice={notice} />
    </div>
  )
}
