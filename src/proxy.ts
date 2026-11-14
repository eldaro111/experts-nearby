import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { PASSWORD_STEP_COOKIE } from '@/lib/authReturn'
import { safeInternalPath } from '@/lib/safeRedirect'

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

  // Надо сменить пароль по recovery или установить его (новый пользователь по magiclink/invite) —
  // пускаем только в /auth*. `?next=` запрошенной страницы отбрасывается: он не должен подменять
  // продолжение шага (онбординг или выбранный раздел). Продолжение берётся из cookie, которую
  // ставит /auth/callback, и принимается только как путь этого сайта вне /auth. Остальные
  // параметры (в том числе служебные параметры Next) остаются как были.
  if ((needsPwReset || needsPwSetup) && !allowed) {
    const url = req.nextUrl.clone()
    url.pathname = '/auth/set-password'
    url.searchParams.delete('next')
    const next = safeInternalPath(req.cookies.get(PASSWORD_STEP_COOKIE)?.value)
    if (next) url.searchParams.set('next', next)
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!api).*)'],
}
