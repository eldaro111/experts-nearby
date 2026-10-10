import Link from 'next/link'
import { UiText } from '@/components/LocaleProvider'
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
          <p className="eyebrow"><span className="eyebrow-line" /><UiText text={"Платформа инженерных проектов"}/></p>
          <h1><UiText text={"Сложные задачи."}/><br /><span><UiText text={"Нужные люди."}/></span><br /><UiText text={"Общий результат."}/></h1>
          <p className="hero-description"><UiText text={"Находите экспертов, собирайте команды и доводите технические проекты до внедрения — в одной рабочей среде."}/></p>
          <div className="hero-actions">
            <Button asChild className="action-primary"><Link href="/listings/new"><Plus size={19} /><UiText text={"Создать проект"}/></Link></Button>
            <Button asChild variant="outline" className="action-secondary"><Link href="/experts"><UiText text={"Найти эксперта"}/><ArrowUpRight size={18} /></Link></Button>
          </div>
          <div className="hero-note"><span><Check size={16} /><UiText text={"Проектные команды"}/></span><span><Check size={16} /><UiText text={"Закрытая рабочая зона"}/></span></div>
        </div>
        <div className="hero-workspace">
          <div className="workspace-topline"><span><Layers3 size={19} /><UiText text={"Рабочая среда"}/></span><span className="workspace-index">ЭР / 01</span></div>
          <h2><UiText text={"От первого отклика"}/><br /><UiText text={"до готового решения."}/></h2>
          <p className="workspace-description"><UiText text={"Весь контекст проекта — рядом."}/></p>
          <div className="workspace-features">
            <div><span className="workspace-feature-icon"><UsersRound size={21} /></span><div><strong><UiText text={"Команда"}/></strong><p><UiText text={"Роли, участники и приглашения"}/></p></div></div>
            <div><span className="workspace-feature-icon"><ListChecks size={21} /></span><div><strong><UiText text={"План работ"}/></strong><p><UiText text={"Задачи, сроки и общий прогресс"}/></p></div></div>
            <div><span className="workspace-feature-icon"><MessagesSquare size={21} /></span><div><strong><UiText text={"Обсуждения и материалы"}/></strong><p><UiText text={"Чат, файлы и история решений"}/></p></div></div>
          </div>
          <Link href="/dashboard" className="workspace-link"><UiText text={"Открыть рабочий центр"}/><ArrowUpRight size={21} /></Link>
        </div>
      </section>
      <section className="entry-points" aria-label="С чего начать">
        <Link href="/listings" className="entry-point"><span className="entry-icon"><BriefcaseBusiness size={24} /></span><div><span className="entry-label"><UiText text={"Для специалистов"}/></span><h2><UiText text={"Найти проект"}/></h2><p><UiText text={"Задачи, которым нужен ваш опыт"}/></p></div><ArrowUpRight className="entry-arrow" size={21} /></Link>
        <Link href="/experts" className="entry-point"><span className="entry-icon"><UsersRound size={24} /></span><div><span className="entry-label"><UiText text={"Для авторов проектов"}/></span><h2><UiText text={"Собрать команду"}/></h2><p><UiText text={"Эксперты под конкретный результат"}/></p></div><ArrowUpRight className="entry-arrow" size={21} /></Link>
        <Link href="/auctions" className="entry-point"><span className="entry-icon"><Gavel size={24} /></span><div><span className="entry-label"><UiText text={"Для заказчиков и команд"}/></span><h2><UiText text={"Открыть аукционы"}/></h2><p><UiText text={"Заказы и решения для внедрения"}/></p></div><ArrowUpRight className="entry-arrow" size={21} /></Link>
      </section>
      <section className="university-home-band"><div><p className="eyebrow">ВУЗам и инженерным школам</p><h2>Учебные проекты с практическим результатом</h2><p>Ваш вуз, направление и группа — в общей рабочей среде.</p></div><Link href="/universities" className="action-primary">Открыть раздел «ВУЗам»<ArrowUpRight size={18}/></Link></section>
      <section className="home-section">
        <div className="section-heading"><div><p className="eyebrow"><UiText text={"Как это работает"}/></p><h2><UiText text={"Чёткий путь к результату"}/></h2></div><p><UiText text={"Поиск команды и совместная работа"}/><br className="hidden sm:block" /><UiText text={"становятся одним процессом."}/></p></div>
        <div className="workflow-grid">{workflow.map((step) => <article key={step.number}><span className="step-number">{step.number}</span><h3><UiText text={step.title}/></h3><p><UiText text={step.text}/></p></article>)}</div>
      </section>
      <section className="workspace-section">
        <div className="workspace-section-copy"><p className="eyebrow"><UiText text={"После знакомства — работа"}/></p><h2><UiText text={"Команда собрана."}/><br /><span><UiText text={"Дальше — по делу."}/></span></h2><p><UiText text={"Не теряйте договорённости между поиском исполнителей и выполнением проекта. Задачи, сроки, файлы и вклад участников связаны друг с другом."}/></p><Link href="/dashboard" className="text-link"><UiText text={"Перейти в рабочий центр"}/><ArrowRight size={19} /></Link></div>
        <div className="tool-grid">{tools.map(({ icon: Icon, title, text, href }) => <Link href={href} key={title} className="tool-card"><Icon size={25} strokeWidth={1.6} /><h3><UiText text={title}/></h3><p><UiText text={text}/></p><ArrowUpRight className="tool-arrow" size={18} /></Link>)}</div>
      </section>
      <section className="home-cta"><div><p className="eyebrow"><UiText text={"Следующий шаг"}/></p><h2><UiText text={"Есть задача? Найдутся эксперты."}/></h2><p><UiText text={"Опишите проект и начните собирать команду."}/></p></div><Button asChild className="action-primary"><Link href="/listings/new"><UiText text={"Создать проект"}/><ArrowRight size={19} /></Link></Button></section>
    </div>
  )
}
