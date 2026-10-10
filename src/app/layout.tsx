import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import './globals.css'
import Header from '@/components/Header'
import { LocaleProvider } from '@/components/LocaleProvider'
import { siteConfig } from '@/lib/siteConfig'
import { Footer } from '@/components/Footer'

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: { default: 'Эксперты Рядом', template: '%s | Эксперты Рядом' },
  openGraph: { siteName: 'Эксперты Рядом', locale: 'ru_RU', type: 'website' },
  description: 'Платформа для поиска экспертов, проектных команд и инженерных задач',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode
}>) {
  return (
    <html lang="ru">
      <body className="min-h-screen antialiased">
        <LocaleProvider>
        <Header />
        <main id="main-content" tabIndex={-1} className="site-main">{children}</main>
        <Footer />
        </LocaleProvider>
      </body>
    </html>
  )
}
