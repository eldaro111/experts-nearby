'use client'
import { useState } from 'react'
import Link from 'next/link'
import { PageHeader } from '@/components/PageHeader'
import { faq } from '@/lib/helpContent'
export default function FAQPage() {
 const [query,setQuery]=useState('')
 const found=faq.filter(item=>item.join(' ').toLocaleLowerCase('ru').includes(query.trim().toLocaleLowerCase('ru')))
 return <div className="page-shell max-w-4xl"><Link className="text-link mb-5" href="/help">← Все инструкции</Link><PageHeader eyebrow="Помощь" title="Частые вопросы" description="Ответы по работе сайта и действия при типовых ошибках." />
 <label className="filter-label" htmlFor="faq-search">Найти ответ</label><input className="w-full mb-5" id="faq-search" type="search" placeholder="Например, пароль или портфолио" value={query} onChange={e=>setQuery(e.target.value)} />
 <p className="text-sm text-slate-500 mb-4" aria-live="polite">Найдено ответов: {found.length}</p>
 <div className="space-y-3">{found.map(([question,answer])=><details key={question} className="rounded-xl border bg-white p-5"><summary className="cursor-pointer font-semibold min-h-8">{question}</summary><p className="mt-3 leading-7 text-slate-600">{answer}</p></details>)}</div>
 {!found.length && <p className="rounded-xl border p-6">Ответ не найден. Попробуйте другое слово или <button className="text-blue-700 underline" onClick={()=>setQuery('')}>сбросьте поиск</button>.</p>}</div>
}
