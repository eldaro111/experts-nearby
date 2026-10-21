'use client'
import { useId } from 'react'
import { STARTUP_STAGES, STARTUP_TERMS, type StartupFieldsValue } from '@/lib/startups'
export function StartupFields({ value, onChange }: { value: StartupFieldsValue; onChange: (value: StartupFieldsValue) => void }) {
  const id = useId()
  return <section className="rounded-2xl border border-blue-100 bg-blue-50/50 p-5 space-y-4">
    <div><label className="filter-label" htmlFor={`${id}-kind`}>Тип проекта</label>
      <select id={`${id}-kind`} value={value.project_kind} onChange={e => onChange(e.target.value === 'startup' ? { project_kind: 'startup', startup_stage: value.startup_stage || 'idea', participation_terms: value.participation_terms || 'paid' } : { project_kind: 'project', startup_stage: null, participation_terms: null })} className="w-full">
        <option value="project">Инженерная задача</option><option value="startup">Стартап — поиск команды</option>
      </select></div>
    {value.project_kind === 'startup' && <><div className="grid gap-4 sm:grid-cols-2">
      <div><label className="filter-label" htmlFor={`${id}-stage`}>Стадия стартапа</label><select id={`${id}-stage`} className="w-full" value={value.startup_stage || 'idea'} onChange={e => onChange({ ...value, startup_stage: e.target.value as StartupFieldsValue['startup_stage'] })}>{Object.entries(STARTUP_STAGES).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></div>
      <div><label className="filter-label" htmlFor={`${id}-terms`}>Условия участия</label><select id={`${id}-terms`} className="w-full" value={value.participation_terms || 'paid'} onChange={e => onChange({ ...value, participation_terms: e.target.value as StartupFieldsValue['participation_terms'] })}>{Object.entries(STARTUP_TERMS).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></div>
    </div><p className="text-sm text-slate-600">В описании укажите продукт, ближайшую цель, задачи участников и ожидаемое время в неделю. Для поиска сооснователя добавьте роль «Сооснователь».</p>
    <p className="text-sm text-slate-600">Оплату, долю и права на результат согласуйте до начала работы. Выбор условия в карточке не оформляет договор и не передаёт долю.</p></>}
  </section>
}
