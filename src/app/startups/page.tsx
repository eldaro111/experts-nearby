'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { PageHeader } from '@/components/PageHeader'
import { PageLoading, EmptyState } from '@/components/PageState'
import { UniversityFields } from '@/components/UniversityFields'
import { EMPTY_UNIVERSITY_PATH } from '@/lib/profileOptions'
import { STARTUP_STAGES, STARTUP_TERMS, type StartupFieldsValue } from '@/lib/startups'
import { supabase } from '@/lib/supabaseClient'

type Startup = StartupFieldsValue & { id: string; title: string; description: string; roles_needed: string[] | string; skills: string[] | string; university_id: string | null; school_id: string | null; study_group_id: string | null }
export default function StartupsPage() {
  const [items, setItems] = useState<Startup[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  useEffect(() => { const timer = setTimeout(() => { setSearch(query.trim()); setPage(0) }, 350); return () => clearTimeout(timer) }, [query])
  const [stage, setStage] = useState('')
  const [terms, setTerms] = useState('')
  const [university, setUniversity] = useState(EMPTY_UNIVERSITY_PATH)
  const [page, setPage] = useState(0)
  const [more, setMore] = useState(false)
  useEffect(() => {
    let active = true
    const run = async () => {
      setLoading(true); setError(false)
      try {
        const { data, error: failure } = await supabase.rpc('search_startups', {
          p_query: search, p_stage: stage || null, p_terms: terms || null,
          p_university: university.university_id, p_school: university.school_id,
          p_group: university.study_group_id, p_offset: page * 24,
        })
        if (failure) throw failure
        if (active) { setItems((data || []).slice(0,24) as Startup[]); setMore((data?.length || 0) > 24) }
      } catch { if (active) setError(true) }
      finally { if (active) setLoading(false) }
    }
    void run()
    return () => { active = false }
  }, [search, stage, terms, university, attempt, page])
  const visible = items
  return <div className="page-shell">
    <PageHeader eyebrow="От идеи к первой команде" title="Стартапам" description="Найдите сооснователя, специалиста или команду, к которой хотите присоединиться. Студенческие инициативы — тоже стартапы.">
      <Link href="/listings/new?kind=startup" className="action-primary inline-flex items-center rounded-xl px-5 py-3">Опубликовать стартап</Link>
    </PageHeader>
    <div className="grid gap-4 md:grid-cols-3 mb-8">{['Опишите продукт, стадию и ближайшую цель.', 'Укажите роли, навыки и условия участия.', 'Рассмотрите отклики и пригласите участников в рабочую зону.'].map((text,i) => <div key={text} className="rounded-2xl border bg-white p-5"><span className="font-semibold text-blue-700">0{i+1}</span><p className="mt-2 text-slate-600">{text}</p></div>)}</div>
    <section className="filter-panel space-y-4" aria-label="Фильтры стартапов">
      <div className="grid gap-4 md:grid-cols-2"><div><label htmlFor="startup-stage" className="filter-label">Стадия</label><select id="startup-stage" className="w-full" value={stage} onChange={e=>{setStage(e.target.value);setPage(0)}}><option value="">Все стадии</option>{Object.entries(STARTUP_STAGES).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></div>
      <div><label htmlFor="startup-terms" className="filter-label">Условия участия</label><select id="startup-terms" className="w-full" value={terms} onChange={e=>{setTerms(e.target.value);setPage(0)}}><option value="">Все условия</option>{Object.entries(STARTUP_TERMS).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></div></div>
      <UniversityFields value={university} onChange={value=>{setUniversity(value);setPage(0)}} />
      <div><label htmlFor="startup-query" className="filter-label">Название, роль или навык</label><input id="startup-query" type="search" className="w-full" placeholder="Например, сооснователь или CAD" value={query} onChange={e=>setQuery(e.target.value)} /></div>
      <button type="button" className="text-blue-700 min-h-11" onClick={()=>{setStage('');setTerms('');setQuery('');setUniversity(EMPTY_UNIVERSITY_PATH);setPage(0)}}>Сбросить фильтры</button>
    </section>
    {loading ? <PageLoading label="Загружаем стартапы…" /> : error ? <EmptyState title="Не удалось загрузить стартапы" description="Попробуйте ещё раз. Если ошибка повторяется, сообщите администратору."><button className="text-link min-h-11" onClick={()=>setAttempt(attempt+1)}>Повторить загрузку</button></EmptyState> : <>
      <p className="my-5 text-sm text-slate-600" aria-live="polite">На странице {page+1}: {visible.length} стартапов</p>
      {!visible.length && <EmptyState title="Стартапов по этим условиям нет" description="Измените фильтры, перейдите на следующую страницу или опубликуйте свою инициативу." />}
      <div className="grid gap-5 md:grid-cols-2">{visible.map(item=><article className="listing-card" key={item.id}>
        <div className="flex flex-wrap gap-2 mb-4"><span className="skill-tag">{item.startup_stage && STARTUP_STAGES[item.startup_stage]}</span><span className="skill-tag">{item.participation_terms && STARTUP_TERMS[item.participation_terms]}</span>{item.university_id && <span className="skill-tag">Проект вуза</span>}</div>
        <h2><Link href={`/listings/${item.id}`}>{item.title}</Link></h2><p className="line-clamp-3 text-slate-600 mb-4">{item.description}</p>
        <p className="text-sm mb-4">В команду: {Array.isArray(item.roles_needed) ? item.roles_needed.join(', ') || 'Роли уточняются' : item.roles_needed || 'Роли уточняются'}</p>
        <Link className="text-link min-h-11" href={`/listings/${item.id}`}>Подробнее и откликнуться →</Link>
      </article>)}</div>
      <nav aria-label="Страницы стартапов" className="flex gap-5 my-6"><button className="min-h-11 text-blue-700 disabled:text-slate-400" disabled={page===0} onClick={()=>setPage(page-1)}>Назад</button><button className="min-h-11 text-blue-700 disabled:text-slate-400" disabled={!more} onClick={()=>setPage(page+1)}>Далее</button></nav>
    </>}
    <p className="text-sm text-slate-600 mt-8">Перед откликом ознакомьтесь с условиями. Участие за долю требует отдельного соглашения сторон. <Link href="/help/startups" className="text-blue-700 underline">Как собрать команду</Link></p>
  </div>
}
