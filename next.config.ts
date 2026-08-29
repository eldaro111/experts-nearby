import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Не раскрываем служебный заголовок X-Powered-By.
  poweredByHeader: false,

  // Явно фиксируем корень проекта для Turbopack.
  turbopack: {
    root: process.cwd(),
  },
}

export default nextConfig