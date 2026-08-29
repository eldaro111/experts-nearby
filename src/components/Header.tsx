'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { NotificationBell } from '@/components/NotificationBell'
import { AppFeedbackHost } from '@/components/AppFeedbackHost'

type NavLink = {
  href: string
  label: string
}

type NavGroup = {
  key: string
  label: string
  links: NavLink[]
}

export default function Header() {
  const pathname = usePathname()
  const router = useRouter()
  const [user, setUser] = useState<any>(null)
  const [openGroup, setOpenGroup] = useState<string | null>(null)

  useEffect(() => {
    const getUser = async () => {
      const { data } = await supabase.auth.getUser()
      setUser(data?.user || null)
    }

    getUser()

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setUser(session?.user || null)
      }
    )

    return () => listener.subscription.unsubscribe()
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    setOpenGroup(null)
    router.replace('/auth')
  }

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/'
    return pathname === href || pathname.startsWith(`${href}/`)
  }

  const isGroupActive = (links: NavLink[]) => links.some((link) => isActive(link.href))

  const closeMenus = () => setOpenGroup(null)

  const workLinks: NavLink[] = [
    { href: '/tasks', label: 'Задачи' },
    { href: '/calendar', label: 'Календарь' },
    { href: '/files', label: 'Файлы' },
  ]

  const marketLinks: NavLink[] = [
    { href: '/listings', label: 'Проекты' },
    { href: '/listings/new', label: 'Создать проект' },
    { href: '/auctions', label: 'Аукционы' },
    { href: '/experts', label: 'Эксперты' },
  ]

  const accountLinks: NavLink[] = [
    { href: '/notifications', label: 'Уведомления' },
    { href: '/settings', label: 'Настройки' },
    { href: '/profile', label: 'Профиль' },
  ]

  const groups: NavGroup[] = [
    { key: 'work', label: 'Работа', links: workLinks },
    { key: 'market', label: 'Рынок', links: marketLinks },
    ...(user ? [{ key: 'account', label: 'Аккаунт', links: accountLinks }] : []),
  ]

  return (
    <>
      <AppFeedbackHost />
      <header className="w-full bg-white border-b shadow-sm mb-6">
      <div className="max-w-6xl mx-auto flex flex-col gap-3 py-4 px-4 md:flex-row md:items-center md:justify-between">
        <Link
          href="/"
          onClick={closeMenus}
          className="text-2xl font-bold text-blue-700 hover:text-blue-800 transition text-center md:text-left"
        >
          Эксперты рядом
        </Link>

        <nav className="flex gap-2 text-sm text-gray-600 items-center flex-wrap justify-center md:justify-end">
          <Link
            href="/"
            onClick={closeMenus}
            className={`px-3 py-2 rounded-lg hover:bg-blue-50 hover:text-blue-700 transition ${
              isActive('/') ? 'font-semibold text-blue-700 bg-blue-50' : ''
            }`}
          >
            Главная
          </Link>

          {user && (
            <Link
              href="/dashboard"
              onClick={closeMenus}
              className={`px-3 py-2 rounded-lg hover:bg-blue-50 hover:text-blue-700 transition ${
                isActive('/dashboard') ? 'font-semibold text-blue-700 bg-blue-50' : ''
              }`}
            >
              Дашборд
            </Link>
          )}

          <Link
            href="/search"
            onClick={closeMenus}
            className={`px-3 py-2 rounded-lg hover:bg-blue-50 hover:text-blue-700 transition ${
              isActive('/search') ? 'font-semibold text-blue-700 bg-blue-50' : ''
            }`}
          >
            Поиск
          </Link>

          {groups.map((group) => {
            const active = isGroupActive(group.links)
            const opened = openGroup === group.key

            return (
              <div key={group.key} className="relative">
                <button
                  type="button"
                  onClick={() => setOpenGroup(opened ? null : group.key)}
                  className={`px-3 py-2 rounded-lg hover:bg-blue-50 hover:text-blue-700 transition flex items-center gap-1 ${
                    active ? 'font-semibold text-blue-700 bg-blue-50' : ''
                  }`}
                  aria-expanded={opened}
                >
                  {group.label}
                  <span className="text-xs">{opened ? '▲' : '▼'}</span>
                </button>

                {opened && (
                  <div className="absolute right-0 mt-2 w-56 bg-white border rounded-xl shadow-lg p-2 z-50">
                    {group.links.map((link) => (
                      <Link
                        key={link.href}
                        href={link.href}
                        onClick={closeMenus}
                        className={`block px-3 py-2 rounded-lg hover:bg-blue-50 hover:text-blue-700 transition ${
                          isActive(link.href) ? 'font-semibold text-blue-700 bg-blue-50' : ''
                        }`}
                      >
                        {link.label}
                      </Link>
                    ))}

                    {group.key === 'account' && (
                      <button
                        onClick={handleLogout}
                        className="w-full text-left px-3 py-2 rounded-lg text-gray-600 hover:bg-red-50 hover:text-red-600 transition"
                      >
                        Выйти
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}

          {user ? (
            <NotificationBell />
          ) : (
            <Link
              href="/auth"
              onClick={closeMenus}
              className={`px-3 py-2 rounded-lg hover:bg-blue-50 hover:text-blue-700 transition ${
                isActive('/auth') ? 'font-semibold text-blue-700 bg-blue-50' : ''
              }`}
            >
              Войти
            </Link>
          )}
        </nav>
      </div>
      </header>
    </>
  )
}