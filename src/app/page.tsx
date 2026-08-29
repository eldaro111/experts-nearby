import Link from 'next/link'

const workflow = [
  {
    step: '01',
    title: 'Опишите задачу',
    text: 'Создайте проект или объявите аукцион с требованиями, сроком и ожидаемым результатом.',
  },
  {
    step: '02',
    title: 'Соберите команду',
    text: 'Получайте отклики, сравнивайте предложения и приглашайте подходящих экспертов.',
  },
  {
    step: '03',
    title: 'Ведите работу',
    text: 'Задачи, файлы, календарь, чат и вклад участников собраны в одной рабочей зоне.',
  },
  {
    step: '04',
    title: 'Зафиксируйте результат',
    text: 'История действий, подтверждённый вклад и отзывы сохраняют контекст и репутацию.',
  },
]

const capabilities = [
  ['Проекты', 'Публикация задач, отклики, приглашения и закрытая рабочая зона.'],
  ['Аукционы', 'Заказы на разработку и готовые решения для внедрения, пилота или лицензии.'],
  ['Эксперты', 'Поиск специалистов по навыкам, опыту, формату работы и рейтингу.'],
  ['Рабочий процесс', 'Задачи, сроки, календарь, файлы, чат и история действий.'],
  ['Репутация', 'Отзывы по завершённым проектам и прозрачный рейтинг участников.'],
  ['Личный центр', 'Дашборд, глобальный поиск, задачи, файлы и уведомления в одном месте.'],
]

export default function Home() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-8 sm:py-12">
      <section className="overflow-hidden rounded-3xl border border-blue-100 bg-gradient-to-br from-blue-50 via-white to-slate-50 shadow-sm">
        <div className="grid gap-10 px-6 py-10 md:px-10 md:py-14 lg:grid-cols-[1.2fr_0.8fr] lg:items-center lg:px-14 lg:py-16">
          <div>
            <div className="inline-flex rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-blue-700">
              Инженерная платформа полного цикла
            </div>

            <h1 className="mt-6 max-w-4xl text-4xl font-bold tracking-tight text-slate-950 sm:text-5xl lg:text-6xl">
              От технической задачи до работающей команды
            </h1>

            <p className="mt-6 max-w-3xl text-lg leading-8 text-slate-600">
              «Эксперты рядом» соединяет компании, исследовательские команды и инженеров:
              помогает найти исполнителей, выбрать предложение и довести проект до результата
              в единой рабочей среде.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/listings/new"
                className="rounded-xl bg-blue-700 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-800"
              >
                Создать проект
              </Link>
              <Link
                href="/experts"
                className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 transition hover:border-blue-300 hover:bg-blue-50"
              >
                Найти эксперта
              </Link>
              <Link
                href="/auctions"
                className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 transition hover:border-blue-300 hover:bg-blue-50"
              >
                Открыть рынок проектов
              </Link>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-lg shadow-blue-100/50 backdrop-blur">
            <p className="text-sm font-semibold text-blue-700">Сквозной сценарий платформы</p>
            <div className="mt-5 space-y-3">
              {['Задача или готовое решение', 'Отклики и предложения', 'Выбор команды', 'Рабочая зона проекта', 'Результат и репутация'].map((item, index) => (
                <div key={item} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-700 text-xs font-bold text-white">
                    {index + 1}
                  </div>
                  <div className="text-sm font-medium text-slate-800">{item}</div>
                </div>
              ))}
            </div>
            <Link
              href="/dashboard"
              className="mt-5 block rounded-xl bg-slate-950 px-4 py-3 text-center text-sm font-semibold text-white transition hover:bg-slate-800"
            >
              Перейти в рабочий центр
            </Link>
          </div>
        </div>
      </section>

      <section className="mt-8 grid gap-5 lg:grid-cols-2">
        <div className="rounded-2xl border bg-white p-7 shadow-sm">
          <p className="text-sm font-semibold text-blue-700">Для компаний и авторов проектов</p>
          <h2 className="mt-2 text-2xl font-bold text-slate-950">Найдите людей под конкретный результат</h2>
          <p className="mt-3 leading-7 text-slate-600">
            Публикуйте инженерные задачи, приглашайте специалистов, сравнивайте предложения и
            управляйте работой без разрыва между поиском команды и исполнением проекта.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/listings" className="text-sm font-semibold text-blue-700 hover:underline">Смотреть проекты →</Link>
            <Link href="/experts" className="text-sm font-semibold text-blue-700 hover:underline">Каталог экспертов →</Link>
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-7 shadow-sm">
          <p className="text-sm font-semibold text-emerald-700">Для экспертов и проектных команд</p>
          <h2 className="mt-2 text-2xl font-bold text-slate-950">Находите задачи и показывайте ценность</h2>
          <p className="mt-3 leading-7 text-slate-600">
            Откликайтесь на проекты, подавайте предложения на аукционах, ведите подтверждённый
            вклад и собирайте репутацию на основе реальной совместной работы.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link href="/auctions" className="text-sm font-semibold text-emerald-700 hover:underline">Открыть аукционы →</Link>
            <Link href="/profile" className="text-sm font-semibold text-emerald-700 hover:underline">Заполнить профиль →</Link>
          </div>
        </div>
      </section>

      <section className="mt-14">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-[0.14em] text-blue-700">Как это работает</p>
          <h2 className="mt-3 text-3xl font-bold text-slate-950">Один процесс вместо набора разрозненных сервисов</h2>
        </div>

        <div className="mt-7 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {workflow.map((item) => (
            <article key={item.step} className="rounded-2xl border bg-white p-6 shadow-sm">
              <div className="text-sm font-bold text-blue-700">{item.step}</div>
              <h3 className="mt-4 text-lg font-semibold text-slate-950">{item.title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-600">{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-14 rounded-3xl bg-slate-950 px-6 py-10 text-white md:px-10 md:py-12">
        <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-blue-300">Всё необходимое внутри</p>
            <h2 className="mt-3 text-3xl font-bold">Платформа для поиска, сделки и совместной работы</h2>
            <p className="mt-4 leading-7 text-slate-300">
              Каждый модуль связан с остальными: победитель аукциона попадает в проект,
              задачи и файлы видны в личном центре, а результат работы формирует репутацию.
            </p>
          </div>
          <Link
            href="/dashboard"
            className="shrink-0 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-blue-50"
          >
            Открыть дашборд
          </Link>
        </div>

        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {capabilities.map(([title, text]) => (
            <div key={title} className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <h3 className="font-semibold text-white">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-slate-300">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-10 flex flex-col gap-5 rounded-2xl border bg-white p-7 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-950">Готовы начать с реальной задачи?</h2>
          <p className="mt-1 text-sm text-slate-600">Создайте проект, найдите специалиста или опубликуйте заказ на рынке.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/listings/new" className="rounded-xl bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-800">Создать проект</Link>
          <Link href="/auctions/new" className="rounded-xl border px-4 py-2.5 text-sm font-semibold text-slate-800 hover:bg-slate-50">Создать аукцион</Link>
        </div>
      </section>
    </main>
  )
}