'use client'

import Link from 'next/link'
import { UiText } from '@/components/LocaleProvider'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState, type FocusEvent as ReactFocusEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import { ArrowUpRight, ChevronDown, Menu, Search, X, LayoutDashboard, CheckSquare, CalendarDays, FolderOpen, Bell, Sparkles, Settings, UserRound, LogOut, Gavel } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { showAppError } from '@/lib/appFeedback'
import { NotificationBell } from '@/components/NotificationBell'
import { AppFeedbackHost } from '@/components/AppFeedbackHost'
import { Brand } from '@/components/Brand'

type NavItem = { href: string; label: string; signedInOnly?: boolean }
type NavGroup = { id: 'projects' | 'partners'; label: string; items: NavItem[] }
type NavEntry = NavItem | NavGroup
type MenuId = NavGroup['id'] | 'account'

// ER-001: routes are unchanged; only grouping and user-facing labels changed.
// /auctions/my is intentionally not added under «Проекты»: it lists both own auctions
// and own bids, so «Мои предложения» would not describe it. It stays in the work bar.
const projectsGroup: NavGroup = {
  id: 'projects',
  label: 'Проекты',
  items: [
    { href: '/listings', label: 'Каталог проектов' },
    { href: '/listings/new', label: 'Создать проект' },
    { href: '/auctions', label: 'Рынок проектов' },
    { href: '/dashboard', label: 'Мои проекты', signedInOnly: true },
  ],
}
const partnersGroup: NavGroup = {
  id: 'partners',
  label: 'Вузам и стартапам',
  items: [
    { href: '/universities', label: 'Вузам' },
    { href: '/startups', label: 'Стартапам' },
  ],
}
const primaryNav: NavEntry[] = [
  { href: '/', label: 'Главная' },
  projectsGroup,
  { href: '/experts', label: 'Эксперты' },
  partnersGroup,
  { href: '/news', label: 'Новости' },
]
const workLinks = [
  { href: '/recommendations', label: 'Рекомендации', icon: Sparkles },
  { href: '/dashboard', label: 'Рабочий центр', icon: LayoutDashboard },
  { href: '/tasks', label: 'Мои задачи', icon: CheckSquare },
  { href: '/calendar', label: 'Календарь', icon: CalendarDays },
  { href: '/files', label: 'Файлы', icon: FolderOpen },
  { href: '/auctions/my', label: 'Мои объявления', icon: Gavel },
]
const accountLinks = [
  { href: '/profile', label: 'Мой профиль', icon: UserRound },
  { href: '/notifications', label: 'Уведомления', icon: Bell },
  { href: '/inquiries', label: 'Обращения', icon: UserRound },
  { href: '/settings', label: 'Настройки', icon: Settings },
]

const isGroup = (entry: NavEntry): entry is NavGroup => 'items' in entry

/** Arrow/Home/End movement between links of an open dropdown (disclosure pattern; Tab also works). */
function moveFocus(event: ReactKeyboardEvent<HTMLElement>) {
  const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End']
  if (!keys.includes(event.key)) return
  const links = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a, button:not([disabled])'))
  if (!links.length) return
  event.preventDefault()
  const index = links.indexOf(document.activeElement as HTMLElement)
  const next = event.key === 'Home' ? 0
    : event.key === 'End' ? links.length - 1
      : event.key === 'ArrowDown' ? (index + 1) % links.length
        : (index - 1 + links.length) % links.length
  links[next].focus()
}

export default function Header() {
  const pathname = usePathname()
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [mobileGroup, setMobileGroup] = useState<NavGroup['id'] | null>(null)
  const [signingOut, setSigningOut] = useState(false)
  const headerRef = useRef<HTMLElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  const triggerRefs = useRef<Partial<Record<MenuId, HTMLButtonElement | null>>>({})
  const focusFirstItem = useRef(false)

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
        setOpenMenu(null)
        setMobileOpen(false)
      }
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (openMenu) triggerRefs.current[openMenu]?.focus()
      else if (mobileOpen) menuButton.current?.focus()
      setOpenMenu(null)
      setMobileOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [openMenu, mobileOpen])

  // Keyboard opening (ArrowDown on a trigger) moves focus into the panel once it is rendered.
  useEffect(() => {
    if (!openMenu || !focusFirstItem.current) return
    focusFirstItem.current = false
    document.getElementById(`${openMenu}-navigation`)?.querySelector<HTMLElement>('a, button')?.focus()
  }, [openMenu])

  const visibleItems = (group: NavGroup) => group.items.filter((item) => !item.signedInOnly || user)
  const closeMenus = () => { setOpenMenu(null); setMobileOpen(false) }
  const toggleMenu = (id: MenuId) => setOpenMenu((current) => current === id ? null : id)
  const isActive = (href: string) => pathname === href || (href !== '/' && pathname.startsWith(`${href}/`))
  const groupActive = (group: NavGroup) => visibleItems(group).some(({ href }) => isActive(href))
  const triggerKeyDown = (id: MenuId) => (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown') return
    event.preventDefault()
    focusFirstItem.current = true
    if (openMenu === id) document.getElementById(`${id}-navigation`)?.querySelector<HTMLElement>('a, button')?.focus()
    else setOpenMenu(id)
  }
  const closeOnFocusLeave = (event: ReactFocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpenMenu(null)
  }
  const toggleMobile = () => {
    if (!mobileOpen) setMobileGroup([projectsGroup, partnersGroup].find(groupActive)?.id ?? null)
    setOpenMenu(null)
    setMobileOpen(!mobileOpen)
  }
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

  const desktopEntry = (entry: NavEntry) => {
    if (!isGroup(entry)) {
      const active = isActive(entry.href)
      return <Link key={entry.href} href={entry.href} onClick={closeMenus} className={`nav-link ${active ? 'is-active' : ''}`} aria-current={active ? 'page' : undefined}><UiText text={entry.label}/></Link>
    }
    const open = openMenu === entry.id
    return (
      <div key={entry.id} className="nav-group" onBlur={closeOnFocusLeave}>
        <button
          ref={(node) => { triggerRefs.current[entry.id] = node }}
          type="button"
          className={`nav-link nav-trigger ${groupActive(entry) ? 'is-active' : ''}`}
          onClick={() => toggleMenu(entry.id)}
          onKeyDown={triggerKeyDown(entry.id)}
          aria-expanded={open}
          aria-controls={`${entry.id}-navigation`}
        >
          <UiText text={entry.label}/><ChevronDown size={15} aria-hidden="true" />
        </button>
        {open && <div id={`${entry.id}-navigation`} className="nav-dropdown" onKeyDown={moveFocus}>
          {visibleItems(entry).map(({ href, label }) => <Link key={href} href={href} onClick={closeMenus} className={isActive(href) ? 'is-active' : ''} aria-current={pathname === href ? 'page' : undefined}><UiText text={label}/></Link>)}
        </div>}
      </div>
    )
  }

  const mobileLink = ({ href, label }: NavItem, nested = false) => {
    const active = isActive(href)
    return <Link key={href} href={href} onClick={closeMenus} className={`${nested ? 'mobile-subitem ' : ''}${active ? 'is-active' : ''}`} aria-current={active ? 'page' : undefined}><UiText text={label}/><ArrowUpRight size={17} aria-hidden="true" /></Link>
  }

  return (
    <>
      <AppFeedbackHost />
      <a href="#main-content" className="skip-link">Перейти к содержимому</a>
      <header ref={headerRef} className="site-header">
        <div className="header-inner">
          <Link href="/" onClick={closeMenus} className="brand-link" aria-label="Эксперты Рядом — главная"><Brand /></Link>
          <nav className="desktop-nav" aria-label="Основная навигация">
            {primaryNav.map(desktopEntry)}
          </nav>
          <div className="header-actions">
            <Link href="/search" onClick={closeMenus} className="icon-button" aria-label="Поиск по платформе"><Search size={21} /></Link>
            {user ? <>
              <NotificationBell />
              <div className="account-nav" onBlur={closeOnFocusLeave}>
                <button ref={(node) => { triggerRefs.current.account = node }} className="account-trigger" onClick={() => toggleMenu('account')} onKeyDown={triggerKeyDown('account')} aria-expanded={openMenu === 'account'} aria-controls="account-navigation" aria-label="Меню аккаунта">
                  <span className="account-avatar">{(user.email || 'Э').charAt(0).toUpperCase()}</span><ChevronDown size={16} />
                </button>
                {openMenu === 'account' && <div id="account-navigation" className="account-dropdown" onKeyDown={moveFocus}>
                  <p className="account-email">{user.email}</p>
                  {accountLinks.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={closeMenus}><Icon size={18} /><UiText text={label}/></Link>)}
                  <button onClick={handleLogout} disabled={signingOut}><LogOut size={18} /><UiText text={signingOut ? 'Выходим…' : 'Выйти'}/></button>
                </div>}
              </div>
            </> : <Link href="/auth" onClick={closeMenus} className="header-login"><UiText text={"Войти"}/><ArrowUpRight size={17} /></Link>}
            <button ref={menuButton} type="button" className="icon-button mobile-menu-toggle" onClick={toggleMobile} aria-label={mobileOpen ? 'Закрыть навигацию' : 'Открыть навигацию'} aria-expanded={mobileOpen} aria-controls="mobile-navigation">{mobileOpen ? <X size={23} /> : <Menu size={23} />}</button>
          </div>
        </div>
        {user && <nav className="work-nav" aria-label="Рабочие разделы"><div className="work-nav-inner">{workLinks.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={closeMenus} className={isActive(href) ? 'is-active' : ''} aria-current={isActive(href) ? 'page' : undefined}><Icon size={17} /><UiText text={label}/></Link>)}</div></nav>}
        {mobileOpen && <nav id="mobile-navigation" className="mobile-navigation" aria-label="Мобильная навигация">
          {primaryNav.map((entry) => {
            if (!isGroup(entry)) return mobileLink(entry)
            const expanded = mobileGroup === entry.id
            return (
              <div key={entry.id} className="mobile-group">
                <button type="button" className={`mobile-group-trigger ${groupActive(entry) ? 'is-active' : ''}`} onClick={() => setMobileGroup(expanded ? null : entry.id)} aria-expanded={expanded} aria-controls={`mobile-${entry.id}-navigation`}>
                  <UiText text={entry.label}/><ChevronDown size={18} aria-hidden="true" />
                </button>
                {expanded && <div id={`mobile-${entry.id}-navigation`} className="mobile-submenu">{visibleItems(entry).map((item) => mobileLink(item, true))}</div>}
              </div>
            )
          })}
          {mobileLink({ href: '/search', label: 'Поиск' })}
          {user && accountLinks.map(({ href, label }) => <Link key={href} href={href} onClick={closeMenus}><UiText text={label}/></Link>)}
        </nav>}
      </header>
    </>
  )
}
