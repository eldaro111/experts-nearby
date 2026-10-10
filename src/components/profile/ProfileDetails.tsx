'use client'

import { UiText } from '@/components/LocaleProvider'
import { safeWebUrl, type LanguageSkill } from '@/lib/profileOptions'
export function LanguageDetails({
  languages,
}: {
  languages?: LanguageSkill[]
}) {
  if (!languages?.length) return null
  return (
    <section className="mt-5">
      <h3 className="font-semibold mb-2">
        <UiText text={'Языки'} />
      </h3>
      <ul className="space-y-2">
        {languages.map((language, index) => (
          <li key={index} className="rounded-lg border p-3 text-sm">
            <b>
              {language.language} ·{' '}
              {language.level === 'native' ? 'Родной' : language.level}
            </b>
            {safeWebUrl(language.certificate_url) ? (
              <>
                <a
                  className="ml-3 text-blue-700 underline"
                  href={safeWebUrl(language.certificate_url)!}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <UiText text={'Сертификат'} />
                </a>
                <p className="text-xs text-slate-500 mt-1">
                  <UiText
                    text={
                      'Документ указан пользователем, подлинность не проверена.'
                    }
                  />
                </p>
              </>
            ) : (
              <p className="text-xs text-slate-500 mt-1">
                <UiText text={'Не подтверждён сертификатом.'} />
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
