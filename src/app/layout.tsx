import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import './globals.css'
import Header from '@/components/Header'
import { Footer } from '@/components/Footer'

export const metadata: Metadata = {
  title: 'Эксперты рядом',
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
        <Header />
        <main id="main-content" tabIndex={-1} className="site-main">{children}</main>
        <Footer />
      </body>
    </html>
  )
}
