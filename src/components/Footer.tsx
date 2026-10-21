import Link from 'next/link'
import { LanguageSwitcher, UiText } from '@/components/LocaleProvider'
import { LEGAL_TITLES, siteConfig } from '@/lib/siteConfig'
import { safeWebUrl } from '@/lib/profileOptions'
export function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-content">
        <div className="footer-inner">
          <div>
            <Link href="/" className="font-semibold text-slate-900">
              Эксперты Рядом
            </Link>
            <p>
              <UiText text="Инженеры. Команды. Результат." />
            </p>
          </div>
          <nav aria-label="Навигация в подвале">
            <Link href="/startups">Стартапам</Link>
            <Link href="/help">Инструкции</Link>
            <Link href="/help/faq">FAQ</Link>
            <Link href="/universities">
              <UiText text="ВУЗам" />
            </Link>
            <Link href="/news">
              <UiText text="События и новости" />
            </Link>
            <Link href="/experts">
              <UiText text="Эксперты" />
            </Link>
          </nav>
        </div>
        <nav className="legal-links" aria-label="Юридические документы">
          {Object.entries(LEGAL_TITLES).map(([slug, title]) => (
            <Link key={slug} href={`/legal/${slug}`}>
              <UiText text={title} />
            </Link>
          ))}
        </nav>
        {siteConfig.legalDetails && (
          <p className="text-xs text-slate-500 py-3">
            {siteConfig.legalDetails}
          </p>
        )}
        <div className="footer-bottom">
          <LanguageSwitcher />
          <span>
            © {new Date().getFullYear()}{' '}
            {siteConfig.legalName || siteConfig.name}
          </span>
          <div className="flex gap-4">
            {safeWebUrl(siteConfig.vk) && (
              <a
                href={safeWebUrl(siteConfig.vk)!}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Сообщество ВКонтакте"
              >
                ВКонтакте
              </a>
            )}
            {safeWebUrl(siteConfig.telegram) && (
              <a
                href={safeWebUrl(siteConfig.telegram)!}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Сообщество Telegram"
              >
                Telegram
              </a>
            )}
            {siteConfig.contactEmail && (
              <a href={`mailto:${siteConfig.contactEmail}`}>
                {siteConfig.contactEmail}
              </a>
            )}
          </div>
        </div>
      </div>
    </footer>
  )
}
