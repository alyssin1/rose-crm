import i18n from 'i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { initReactI18next } from 'react-i18next'
import pt from './locales/pt.json'
import en from './locales/en.json'
import ja from './locales/ja.json'
import it from './locales/it.json'

export const LANGS = [
  { code: 'pt', label: 'Português' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'it', label: 'Italiano' },
] as const

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { pt: { translation: pt }, en: { translation: en }, ja: { translation: ja }, it: { translation: it } },
    fallbackLng: 'pt',
    supportedLngs: ['pt', 'en', 'ja', 'it'],
    nonExplicitSupportedLngs: true,
    interpolation: { escapeValue: false },
    detection: { order: ['localStorage'], lookupLocalStorage: 'rose.lang' },
  })

i18n.on('languageChanged', (l) => {
  document.documentElement.lang = l
})

export default i18n
