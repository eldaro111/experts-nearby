export const siteConfig = {
  name: 'Эксперты Рядом',
  url: process.env.NEXT_PUBLIC_SITE_URL || 'https://nearbyexperts.ru',
  legalName: process.env.NEXT_PUBLIC_LEGAL_NAME || '',
  legalDetails: process.env.NEXT_PUBLIC_LEGAL_DETAILS || '',
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL || '',
  vk: process.env.NEXT_PUBLIC_VK_URL || '',
  telegram: process.env.NEXT_PUBLIC_TELEGRAM_URL || '',
}
export const LEGAL_TITLES: Record<string, string> = {
  ethics: 'Этика',
  'site-use': 'Использование сайта',
  privacy: 'Защита персональных данных',
  terms: 'Пользовательское соглашение',
}
export const PUBLICATION_KINDS: Record<string, string> = {
  news: 'Новости',
  event: 'События',
  exhibition: 'Выставки',
  seminar: 'Семинары',
  journal: 'Журналы',
}
