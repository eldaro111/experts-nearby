'use client'

import { useId, useState } from 'react'
import { useT } from '@/components/LocaleProvider'
import * as P from '@/lib/planning'
import { boardStatusLabel } from '@/lib/taskLabels'
import { CATEGORY_TEXT } from './text'
import { NoticeBox, errorNotice, type Notice, type PanelProps } from './shared'

type Form = { stage: P.ProjectStage | null; name: string; category: P.StageCategory; status: string; policy: string; wip: string }

const emptyForm = (): Form => ({ stage: null, name: '', category: 'doing', status: '', policy: '', wip: '' })
const formOf = (stage: P.ProjectStage): Form => ({ stage, name: stage.name, category: stage.category, status: stage.status_value ?? '', policy: stage.policy, wip: stage.wip_limit === null ? '' : String(stage.wip_limit) })

export function StagesPanel({ planning, data, projectId, tasks }: Pick<PanelProps, 'planning' | 'data' | 'projectId' | 'tasks'>) {
  const t = useT()
  const id = useId()
  const { caps } = planning
  const stages = data.stages
  const [form, setForm] = useState<Form | null>(null)
  const [archiving, setArchiving] = useState<{ stage: P.ProjectStage; target: string } | null>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const used = (stageId: string) => tasks.filter((task) => task.stage_id === stageId).length
  const taskView = tasks.map((task) => ({ stage_id: task.stage_id ?? null, status: task.status }))

  const report = (result: P.Result<unknown> | null, success: string) => {
    if (!result) return false
    setNotice(result.ok ? { tone: 'success', text: success } : errorNotice(result.error))
    return result.ok
  }

  const submit = async () => {
    if (!form) return
    const name = form.name.trim()
    if (!name || name.length > 60) { setNotice({ tone: 'error', text: 'Название этапа: от 1 до 60 символов.' }); return }
    const status = form.category === 'done' ? null : form.status.trim() || null
    if (status && status.length > 60) { setNotice({ tone: 'error', text: 'Статус этапа: до 60 символов.' }); return }
    const wip = P.parseWipLimit(form.wip)
    if (!wip.ok) { setNotice({ tone: 'error', text: wip.message }); return }
    const position = form.stage ? form.stage.position : (stages.length ? Math.max(...stages.map((s) => s.position)) + 1 : 0)
    const draft: P.StageDraft = { id: form.stage?.id ?? null, version: form.stage?.version ?? 0, name, position, category: form.category, status_value: status, policy: form.policy, wip_limit: wip.value }
    const result = await planning.perform('stage', (db) => P.saveStage(db, projectId, data.settings.version, draft))
    if (report(result, form.stage ? 'Этап сохранён.' : 'Этап добавлен.')) setForm(null)
  }

  // Active positions are unique: swap through a free position, each step with fresh versions.
  const swap = async (index: number, delta: -1 | 1) => {
    const a = stages[index]
    const b = stages[index + delta]
    if (!a || !b) return
    const free = Math.max(...stages.map((s) => s.position)) + 1
    const result = await planning.perform('stage-order', async (db) => {
      const draftOf = (stage: P.ProjectStage, position: number): P.StageDraft => ({ id: stage.id, version: stage.version, name: stage.name, position, category: stage.category, status_value: stage.status_value, policy: stage.policy, wip_limit: stage.wip_limit })
      const version = async () => { const s = await P.loadSettings(db, projectId); return s.ok ? s.data.version : null }
      const step1 = await P.saveStage(db, projectId, data.settings.version, draftOf(a, free))
      if (!step1.ok) return step1
      const v2 = await version()
      if (v2 === null) return { ok: false as const, error: { kind: 'unknown' as const, code: '', message: 'Перестановка прервана: проверьте порядок этапов.' } }
      const step2 = await P.saveStage(db, projectId, v2, draftOf(b, a.position))
      if (!step2.ok) return step2
      const v3 = await version()
      if (v3 === null) return { ok: false as const, error: { kind: 'unknown' as const, code: '', message: 'Перестановка прервана: проверьте порядок этапов.' } }
      return P.saveStage(db, projectId, v3, draftOf(step1.data, b.position))
    })
    report(result, 'Порядок этапов изменён.')
  }

  const archive = async () => {
    if (!archiving) return
    const needsTarget = used(archiving.stage.id) > 0
    if (needsTarget && !archiving.target) { setNotice({ tone: 'error', text: 'Выберите этап, куда перенести задачи.' }); return }
    const result = await planning.perform('stage-archive', (db) => P.archiveStage(db, projectId, data.settings.version, archiving.stage, archiving.target || null))
    if (report(result, 'Этап перенесён в архив.')) setArchiving(null)
  }

  return (
    <div className="planning-subblock" aria-labelledby={`${id}-title`}>
      <h4 id={`${id}-title`} className="planning-subtitle">{t('Этапы и WIP-лимиты')}</h4>
      {data.settings.mode === 'simple' && <p className="planning-hint">{t('В простом режиме доска использует статусы без этапов. Этапы появятся автоматически при выборе Kanban, Scrum или своего процесса.')}</p>}
      {stages.length === 0 ? (
        <p className="planning-hint">{t('Этапов пока нет.')}</p>
      ) : (
        <ol className="planning-stages">
          {stages.map((stage, index) => {
            const wip = P.wipState(stage, taskView, data.settings)
            const count = used(stage.id)
            return (
              <li key={stage.id} className={`planning-stage ${wip.over ? 'is-over' : ''}`}>
                <div className="planning-stage-head">
                  <strong>{stage.name}</strong>
                  {CATEGORY_TEXT[stage.category] !== stage.name && <span className="planning-tag">{t(CATEGORY_TEXT[stage.category])}</span>}
                  {stage.status_value && <span className="planning-tag">{t('статус')}: {boardStatusLabel(stage.status_value)}</span>}
                  <span className={`planning-wip ${wip.over ? 'is-over' : ''}`}>
                    {wip.applies
                      ? <>{t('В работе')}: {wip.count} / {wip.limit}{wip.over && <> — {t(wip.strict ? 'превышен строгий лимит' : 'превышен лимит (мягкий режим)')}</>}</>
                      : <>{t('Незавершённых')}: {wip.count}{stage.wip_limit !== null && data.settings.mode === 'simple' ? <> · {t('лимит не действует в простом режиме')}</> : null}</>}
                  </span>
                </div>
                {stage.policy && <p className="planning-policy">{stage.policy}</p>}
                {caps.canManage && (
                  <div className="planning-row-actions">
                    <button type="button" className="planning-link" disabled={Boolean(planning.busy)} onClick={() => { setNotice(null); setArchiving(null); setForm(formOf(stage)) }}>{t('Изменить')}</button>
                    <button type="button" className="planning-link" disabled={index === 0 || Boolean(planning.busy)} aria-label={`${t('Переместить этап выше')}: ${stage.name}`} onClick={() => void swap(index, -1)}>{t('Выше')}</button>
                    <button type="button" className="planning-link" disabled={index === stages.length - 1 || Boolean(planning.busy)} aria-label={`${t('Переместить этап ниже')}: ${stage.name}`} onClick={() => void swap(index, 1)}>{t('Ниже')}</button>
                    <button type="button" className="planning-link is-danger" disabled={Boolean(planning.busy) || stages.length < 2} onClick={() => { setNotice(null); setForm(null); setArchiving({ stage, target: '' }) }}>{t('В архив')}</button>
                  </div>
                )}
                {archiving?.stage.id === stage.id && (
                  <div className="planning-inline-form" role="group" aria-label={t('Архивирование этапа')}>
                    <p>{t('Этап исчезнет с доски, история сохранится.')} {count > 0 && t('В этапе есть задачи — выберите, куда их перенести.')}</p>
                    {count > 0 && (
                      <label className="planning-field">
                        <span className="planning-label">{t('Перенести задачи в этап')}</span>
                        <select value={archiving.target} onChange={(e) => setArchiving({ ...archiving, target: e.target.value })}>
                          <option value="">{t('Выберите этап')}</option>
                          {stages.filter((other) => other.id !== stage.id).map((other) => <option key={other.id} value={other.id}>{other.name}</option>)}
                        </select>
                      </label>
                    )}
                    <div className="planning-actions">
                      <button type="button" className="action-primary planning-button" disabled={Boolean(planning.busy)} onClick={() => void archive()}>{t('Перенести в архив')}</button>
                      <button type="button" className="action-secondary planning-button" onClick={() => setArchiving(null)}>{t('Отмена')}</button>
                    </div>
                  </div>
                )}
                {form?.stage?.id === stage.id && <StageForm form={form} setForm={setForm} locked={count > 0} busy={Boolean(planning.busy)} onSubmit={submit} />}
              </li>
            )
          })}
        </ol>
      )}
      {caps.canManage && !form?.stage && (
        form ? <StageForm form={form} setForm={setForm} locked={false} busy={Boolean(planning.busy)} onSubmit={submit} />
          : <button type="button" className="action-secondary planning-button" disabled={Boolean(planning.busy)} onClick={() => { setNotice(null); setArchiving(null); setForm(emptyForm()) }}>{t('Добавить этап')}</button>
      )}
      <NoticeBox notice={notice} />
    </div>
  )
}

function StageForm({ form, setForm, locked, busy, onSubmit }: { form: Form; setForm: (form: Form | null) => void; locked: boolean; busy: boolean; onSubmit: () => void }) {
  const t = useT()
  const id = useId()
  return (
    <form className="planning-inline-form" onSubmit={(event) => { event.preventDefault(); onSubmit() }} aria-label={t(form.stage ? 'Изменение этапа' : 'Новый этап')}>
      <div className="planning-grid">
        <label className="planning-field">
          <span className="planning-label">{t('Название')}</span>
          <input autoFocus value={form.name} maxLength={60} required onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="planning-field">
          <span className="planning-label">{t('Категория')}</span>
          <select value={form.category} disabled={locked} onChange={(e) => setForm({ ...form, category: e.target.value as P.StageCategory })}>
            {(['todo', 'doing', 'done'] as const).map((category) => <option key={category} value={category}>{t(CATEGORY_TEXT[category])}</option>)}
          </select>
        </label>
        <label className="planning-field">
          <span className="planning-label">{t('Статус задач в этапе (необязательно)')}</span>
          <input id={`${id}-status`} value={form.category === 'done' ? '' : form.status} maxLength={60} disabled={locked || form.category === 'done'} placeholder={t('например, review')} onChange={(e) => setForm({ ...form, status: e.target.value })} />
        </label>
        <label className="planning-field">
          <span className="planning-label">{t('WIP-лимит (необязательно)')}</span>
          <input inputMode="numeric" value={form.wip} onChange={(e) => setForm({ ...form, wip: e.target.value })} />
        </label>
      </div>
      {locked && <p className="planning-hint">{t('В этапе есть задачи: категорию и статус изменить нельзя. Создайте новый этап и перенесите задачи при архивировании этого.')}</p>}
      <p className="planning-hint">{t('Завершена только задача со статусом «Готово»; этап «Готово» может быть только один.')}</p>
      <label className="planning-field">
        <span className="planning-label">{t('Правила этапа')}</span>
        <textarea rows={2} maxLength={P.POLICY_MAX} value={form.policy} onChange={(e) => setForm({ ...form, policy: e.target.value })} />
      </label>
      <div className="planning-actions">
        <button type="submit" className="action-primary planning-button" disabled={busy}>{t(busy ? 'Сохраняем…' : 'Сохранить этап')}</button>
        <button type="button" className="action-secondary planning-button" onClick={() => setForm(null)}>{t('Отмена')}</button>
      </div>
    </form>
  )
}
