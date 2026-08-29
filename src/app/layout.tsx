import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import './globals.css'
import Header from '@/components/Header'

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
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased">
        <Header />
        <main>{children}</main>
      </body>
    </html>
  )
}