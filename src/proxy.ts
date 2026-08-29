import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

const PUBLIC_FILE = /\.(.*)$/

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  // статика
  if (
    pathname.startsWith('/_next') ||
    pathname === '/favicon.ico' ||
    PUBLIC_FILE.test(pathname)
  ) {
    return NextResponse.next()
  }

  const needsPwReset = req.cookies.get('needs_pw_reset')?.value === '1'
  const needsPwSetup = req.cookies.get('needs_pw_setup')?.value === '1'

  const allowed =
    pathname === '/auth' ||
    pathname.startsWith('/auth/') ||
    pathname === '/auth/callback'

  // если надо сменить пароль по recovery — пускаем только в auth
  if (needsPwReset && !allowed) {
    const url = req.nextUrl.clone()
    url.pathname = '/auth/reset-password'
    return NextResponse.redirect(url)
  }

  // если надо установить пароль (новый юзер по magiclink) — пускаем только в auth
  if (needsPwSetup && !allowed) {
    const url = req.nextUrl.clone()
    url.pathname = '/auth/set-password'
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api).*)'],
}