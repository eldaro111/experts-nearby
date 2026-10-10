'use client'
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { english } from '@/lib/translations'
type Locale = 'ru' | 'en'
const Context = createContext<{
  locale: Locale
  setLocale: (locale: Locale) => void
}>({ locale: 'ru', setLocale: () => {} })
export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('ru')
  useEffect(() => {
    try {
      if (localStorage.getItem('experts-locale') === 'en') setLocaleState('en')
    } catch {}
  }, [])
  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])
  function setLocale(value: Locale) {
    setLocaleState(value)
    try {
      localStorage.setItem('experts-locale', value)
    } catch {}
  }
  return (
    <Context.Provider value={{ locale, setLocale }}>
      {children}
    </Context.Provider>
  )
}
export function useT() {
  const { locale } = useContext(Context)
  return (text: string) => (locale === 'en' ? english[text] || text : text)
}
export function UiText({ text }: { text: string }) {
  const t = useT()
  return <>{t(text)}</>
}
export function LanguageSwitcher() {
  const { locale, setLocale } = useContext(Context)
  return (
    <div>
      <label htmlFor="site-language" className="sr-only">
        Язык интерфейса / Interface language
      </label>
      <select
        id="site-language"
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
        className="text-sm"
      >
        <option value="ru">Русский</option>
        <option value="en">English (beta)</option>
      </select>
      {locale === 'en' && (
        <p className="text-xs text-slate-500 mt-2 max-w-xs">
          Core interface in English. Some workspace text is still in Russian.
          User content and legal documents keep their original language.
        </p>
      )}
    </div>
  )
}
