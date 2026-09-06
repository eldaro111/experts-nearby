import Link from 'next/link'

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div><Link href="/" className="font-semibold text-slate-900">Эксперты рядом</Link><p>Инженеры. Команды. Результат.</p></div>
        <nav aria-label="Навигация в подвале"><Link href="/listings">Проекты</Link><Link href="/experts">Эксперты</Link><Link href="/auctions">Аукционы</Link></nav>
        <span>От идеи до внедрения</span>
      </div>
    </footer>
  )
}
