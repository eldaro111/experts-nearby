import Link from 'next/link'
import { PageHeader } from '@/components/PageHeader'
import { guides } from '@/lib/helpContent'
export const metadata = { title: 'Инструкции — Эксперты Рядом' }
export default function HelpPage() {
 return <div className="page-shell"><PageHeader eyebrow="Помощь" title="Начните с вашей задачи" description="Пошаговые инструкции по поиску специалистов, участию в проектах и созданию команды." />
 <div className="grid gap-5 md:grid-cols-2">{guides.map((guide,i)=><Link href={`/help/${guide.slug}`} key={guide.slug} className="listing-card block hover:border-blue-400"><span className="text-blue-600 font-semibold">0{i+1}</span><h2 className="mt-4">{guide.title}</h2><p className="text-slate-600">{guide.summary}</p><span className="text-link mt-5">Открыть инструкцию →</span></Link>)}</div>
 <section className="mt-8 rounded-2xl border bg-blue-50 p-6"><h2 className="text-xl font-semibold">Вопросы и ошибки</h2><p className="my-3 text-slate-600">Письма, восстановление пароля, профиль, отклики, рекомендации и файлы.</p><Link href="/help/faq" className="text-link">Открыть FAQ →</Link></section></div>
}
