'use client'

import Link from 'next/link'
import { UiText } from '@/components/LocaleProvider'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { ArrowUpRight, ChevronDown, Menu, Search, X, LayoutDashboard, CheckSquare, CalendarDays, FolderOpen, Bell, Sparkles, Settings, UserRound, LogOut, Gavel } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { showAppError } from '@/lib/appFeedback'
import { NotificationBell } from '@/components/NotificationBell'
import { AppFeedbackHost } from '@/components/AppFeedbackHost'
import { Brand } from '@/components/Brand'

const primaryLinks = [
  { href: '/listings', label: 'Проекты' },
  { href: '/experts', label: 'Эксперты' },
  { href: '/auctions', label: 'Аукционы' },
  { href: '/startups', label: 'Стартапам' },
  { href: '/help', label: 'Помощь' },
  { href: '/universities', label: 'ВУЗам' },
  { href: '/news', label: 'События и новости' },
]
const workLinks = [
  { href: '/recommendations', label: 'Рекомендации', icon: Sparkles },
  { href: '/dashboard', label: 'Рабочий центр', icon: LayoutDashboard },
  { href: '/tasks', label: 'Мои задачи', icon: CheckSquare },
  { href: '/calendar', label: 'Календарь', icon: CalendarDays },
  { href: '/files', label: 'Файлы', icon: FolderOpen },
  { href: '/auctions/my', label: 'Мои аукционы', icon: Gavel },
]
const accountLinks = [
  { href: '/profile', label: 'Мой профиль', icon: UserRound },
  { href: '/notifications', label: 'Уведомления', icon: Bell },
  { href: '/inquiries', label: 'Обращения', icon: UserRound },
  { href: '/settings', label: 'Настройки', icon: Settings },
]

export default function Header() {
  const pathname = usePathname()
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [accountOpen, setAccountOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const headerRef = useRef<HTMLElement>(null)
  const accountButton = useRef<HTMLButtonElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let active = true
    supabase.auth.getUser().then(({ data }) => {
      if (active) setUser(data.user || null)
    }).catch(() => { /* Public navigation stays available when auth is offline. */ })
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setUser(session?.user || null)
    })
    return () => { active = false; data.subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (!headerRef.current?.contains(event.target as Node)) {
        setAccountOpen(false)
        setMobileOpen(false)
      }
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (accountOpen) accountButton.current?.focus()
      else if (mobileOpen) menuButton.current?.focus()
      setAccountOpen(false)
      setMobileOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [accountOpen, mobileOpen])

  const closeMenus = () => { setAccountOpen(false); setMobileOpen(false) }
  const isActive = (href: string) => pathname === href || (href !== '/' && pathname.startsWith(`${href}/`))
  const handleLogout = async () => {
    if (signingOut) return
    setSigningOut(true)
    try {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      closeMenus()
      router.replace('/auth')
    } catch (error) {
      showAppError(error, 'Не удалось выйти. Повторите попытку.', 'Выход из аккаунта')
    } finally { setSigningOut(false) }
  }

  return (
    <>
      <AppFeedbackHost />
      <a href="#main-content" className="skip-link">Перейти к содержимому</a>
      <header ref={headerRef} className="site-header">
        <div className="header-inner">
          <Link href="/" onClick={closeMenus} className="brand-link" aria-label="Эксперты Рядом — главная"><Brand /></Link>
          <nav className="desktop-nav" aria-label="Основная навигация">
            <Link href="/" onClick={closeMenus} className={`nav-link ${pathname === '/' ? 'is-active' : ''}`} aria-current={pathname === '/' ? 'page' : undefined}><UiText text={"Главная"}/></Link>
            {primaryLinks.map(({ href, label }) => <Link key={href} href={href} onClick={closeMenus} className={`nav-link ${isActive(href) ? 'is-active' : ''}`} aria-current={isActive(href) ? 'page' : undefined}><UiText text={label}/></Link>)}
          </nav>
          <div className="header-actions">
            <Link href="/search" onClick={closeMenus} className="icon-button" aria-label="Поиск по платформе"><Search size={21} /></Link>
            {user ? <>
              <NotificationBell />
              <div className="account-nav" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setAccountOpen(false) }}>
                <button ref={accountButton} className="account-trigger" onClick={() => setAccountOpen(!accountOpen)} aria-expanded={accountOpen} aria-controls="account-navigation" aria-label="Меню аккаунта">
                  <span className="account-avatar">{(user.email || 'Э').charAt(0).toUpperCase()}</span><ChevronDown size={16} />
                </button>
                {accountOpen && <div id="account-navigation" className="account-dropdown">
                  <p className="account-email">{user.email}</p>
                  {accountLinks.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={closeMenus}><Icon size={18} /><UiText text={label}/></Link>)}
                  <button onClick={handleLogout} disabled={signingOut}><LogOut size={18} /><UiText text={signingOut ? 'Выходим…' : 'Выйти'}/></button>
                </div>}
              </div>
            </> : <Link href="/auth" onClick={closeMenus} className="header-login"><UiText text={"Войти"}/><ArrowUpRight size={17} /></Link>}
            <button ref={menuButton} type="button" className="icon-button mobile-menu-toggle" onClick={() => setMobileOpen(!mobileOpen)} aria-label={mobileOpen ? 'Закрыть навигацию' : 'Открыть навигацию'} aria-expanded={mobileOpen} aria-controls="mobile-navigation">{mobileOpen ? <X size={23} /> : <Menu size={23} />}</button>
          </div>
        </div>
        {user && <nav className="work-nav" aria-label="Рабочие разделы"><div className="work-nav-inner">{workLinks.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={closeMenus} className={isActive(href) ? 'is-active' : ''} aria-current={isActive(href) ? 'page' : undefined}><Icon size={17} /><UiText text={label}/></Link>)}</div></nav>}
        {mobileOpen && <nav id="mobile-navigation" className="mobile-navigation" aria-label="Мобильная навигация">
          {[{ href: '/', label: 'Главная' }, ...primaryLinks, { href: '/listings/new', label: 'Создать проект' }, { href: '/search', label: 'Поиск' }].map(({ href, label }) => <Link key={href} href={href} onClick={closeMenus} className={isActive(href) ? 'is-active' : ''} aria-current={isActive(href) ? 'page' : undefined}>{label}<ArrowUpRight size={17} /></Link>)}
          {user && accountLinks.map(({ href, label }) => <Link key={href} href={href} onClick={closeMenus}><UiText text={label}/></Link>)}
        </nav>}
      </header>
    </>
  )
}
