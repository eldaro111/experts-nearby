import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/PageHeader'
import { guides } from '@/lib/helpContent'
export function generateStaticParams() { return guides.map(({slug})=>({slug})) }
export async function generateMetadata({params}: {params: Promise<{slug:string}>}) { const {slug}=await params; return {title: `${guides.find(g=>g.slug===slug)?.title || 'Инструкция'} — Эксперты Рядом`} }
export default async function GuidePage({params}: {params: Promise<{slug:string}>}) {
 const {slug}=await params; const guide=guides.find(g=>g.slug===slug); if(!guide) notFound()
 return <div className="page-shell max-w-4xl"><Link className="text-link mb-5" href="/help">← Все инструкции</Link><PageHeader eyebrow="Пошаговая инструкция" title={guide.title} description={guide.summary} />
 <ol className="space-y-4">{guide.steps.map(([title,body],i)=><li className="rounded-2xl border bg-white p-6" key={title}><h2 className="text-lg font-semibold"><span className="text-blue-600 mr-3">{i+1}.</span>{title}</h2><p className="mt-3 text-slate-600 leading-7">{body}</p></li>)}</ol>
 <nav className="flex flex-wrap gap-5 mt-8" aria-label="Следующие действия">{guide.links.map(([href,label])=><Link className="text-link min-h-11" key={href} href={href}>{label} →</Link>)}<Link className="text-link min-h-11" href="/help/faq">FAQ →</Link></nav></div>
}
