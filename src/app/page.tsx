import Link from 'next/link'
import { ArrowRight, ArrowUpRight, BriefcaseBusiness, UsersRound, ListChecks, Files, MessagesSquare, Fingerprint, Gavel, Layers3, CalendarDays, Check, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'

const workflow = [
  { number: '01', title: 'Опишите задачу', text: 'Укажите требования, нужные навыки и ожидаемый результат.' },
  { number: '02', title: 'Соберите команду', text: 'Сравните отклики и пригласите подходящих специалистов.' },
  { number: '03', title: 'Работайте вместе', text: 'Ведите задачи, обсуждения и материалы в закрытой рабочей зоне.' },
  { number: '04', title: 'Подтвердите результат', text: 'Зафиксируйте вклад участников и оставьте отзыв о работе.' },
]
const tools = [
  { icon: ListChecks, title: 'Задачи и сроки', text: 'План работ, исполнители и прогресс команды.', href: '/tasks' },
  { icon: Files, title: 'Файлы и документы', text: 'Материалы проекта с доступом для участников.', href: '/files' },
  { icon: CalendarDays, title: 'Общий календарь', text: 'События и дедлайны всех ваших проектов.', href: '/calendar' },
  { icon: Fingerprint, title: 'Вклад и репутация', text: 'Подтверждённая работа и отзывы участников.', href: '/profile' },
]

export default function Home() {
  return (
    <div className="home">
      <section className="home-hero">
        <div className="hero-copy">
          <p className="eyebrow"><span className="eyebrow-line" />Платформа инженерных проектов</p>
          <h1>Сложные задачи.<br /><span>Нужные люди.</span><br />Общий результат.</h1>
          <p className="hero-description">Находите экспертов, собирайте команды и доводите технические проекты до внедрения — в одной рабочей среде.</p>
          <div className="hero-actions">
            <Button asChild className="action-primary"><Link href="/listings/new"><Plus size={19} />Создать проект</Link></Button>
            <Button asChild variant="outline" className="action-secondary"><Link href="/experts">Найти эксперта<ArrowUpRight size={18} /></Link></Button>
          </div>
          <div className="hero-note"><span><Check size={16} />Проектные команды</span><span><Check size={16} />Закрытая рабочая зона</span></div>
        </div>
        <div className="hero-workspace">
          <div className="workspace-topline"><span><Layers3 size={19} />Рабочая среда</span><span className="workspace-index">ЭР / 01</span></div>
          <h2>От первого отклика<br />до готового решения.</h2>
          <p className="workspace-description">Весь контекст проекта — рядом.</p>
          <div className="workspace-features">
            <div><span className="workspace-feature-icon"><UsersRound size={21} /></span><div><strong>Команда</strong><p>Роли, участники и приглашения</p></div></div>
            <div><span className="workspace-feature-icon"><ListChecks size={21} /></span><div><strong>План работ</strong><p>Задачи, сроки и общий прогресс</p></div></div>
            <div><span className="workspace-feature-icon"><MessagesSquare size={21} /></span><div><strong>Обсуждения и материалы</strong><p>Чат, файлы и история решений</p></div></div>
          </div>
          <Link href="/dashboard" className="workspace-link">Открыть рабочий центр<ArrowUpRight size={21} /></Link>
        </div>
      </section>
      <section className="entry-points" aria-label="С чего начать">
        <Link href="/listings" className="entry-point"><span className="entry-icon"><BriefcaseBusiness size={24} /></span><div><span className="entry-label">Для специалистов</span><h2>Найти проект</h2><p>Задачи, которым нужен ваш опыт</p></div><ArrowUpRight className="entry-arrow" size={21} /></Link>
        <Link href="/experts" className="entry-point"><span className="entry-icon"><UsersRound size={24} /></span><div><span className="entry-label">Для авторов проектов</span><h2>Собрать команду</h2><p>Эксперты под конкретный результат</p></div><ArrowUpRight className="entry-arrow" size={21} /></Link>
        <Link href="/auctions" className="entry-point"><span className="entry-icon"><Gavel size={24} /></span><div><span className="entry-label">Для заказчиков и команд</span><h2>Открыть аукционы</h2><p>Заказы и решения для внедрения</p></div><ArrowUpRight className="entry-arrow" size={21} /></Link>
      </section>
      <section className="home-section">
        <div className="section-heading"><div><p className="eyebrow">Как это работает</p><h2>Чёткий путь к результату</h2></div><p>Поиск команды и совместная работа<br className="hidden sm:block" />становятся одним процессом.</p></div>
        <div className="workflow-grid">{workflow.map((step) => <article key={step.number}><span className="step-number">{step.number}</span><h3>{step.title}</h3><p>{step.text}</p></article>)}</div>
      </section>
      <section className="workspace-section">
        <div className="workspace-section-copy"><p className="eyebrow">После знакомства — работа</p><h2>Команда собрана.<br /><span>Дальше — по делу.</span></h2><p>Не теряйте договорённости между поиском исполнителей и выполнением проекта. Задачи, сроки, файлы и вклад участников связаны друг с другом.</p><Link href="/dashboard" className="text-link">Перейти в рабочий центр<ArrowRight size={19} /></Link></div>
        <div className="tool-grid">{tools.map(({ icon: Icon, title, text, href }) => <Link href={href} key={title} className="tool-card"><Icon size={25} strokeWidth={1.6} /><h3>{title}</h3><p>{text}</p><ArrowUpRight className="tool-arrow" size={18} /></Link>)}</div>
      </section>
      <section className="home-cta"><div><p className="eyebrow">Следующий шаг</p><h2>Есть задача? Найдутся эксперты.</h2><p>Опишите проект и начните собирать команду.</p></div><Button asChild className="action-primary"><Link href="/listings/new">Создать проект<ArrowRight size={19} /></Link></Button></section>
    </div>
  )
}
