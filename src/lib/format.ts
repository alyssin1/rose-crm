/** Preferências de formatação (Configurações → Data e hora). Módulo simples: o app re-renderiza quando o perfil muda. */
export type DateFormat = 'auto' | 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD'

let time12 = false
let dateFormat: DateFormat = 'auto'

export const setFormat = (p?: { time_format?: string; date_format?: string } | null) => {
  time12 = p?.time_format === '12h'
  dateFormat = (['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'].includes(p?.date_format ?? '') ? p!.date_format : 'auto') as DateFormat
}
export const is12h = () => time12
export const getDateFormat = () => dateFormat

const pad = (n: number) => String(n).padStart(2, '0')

export function formatTime(d: Date): string {
  if (!time12) return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const h = d.getHours() % 12 || 12
  return `${h}:${pad(d.getMinutes())} ${d.getHours() < 12 ? 'AM' : 'PM'}`
}

/** Data numérica no formato escolhido; null quando o formato é "automático" (quem chama usa o Intl do idioma). */
export function formatNumericDate(d: Date): string | null {
  const y = String(d.getFullYear())
  if (dateFormat === 'DD/MM/YYYY') return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${y}`
  if (dateFormat === 'MM/DD/YYYY') return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${y}`
  if (dateFormat === 'YYYY-MM-DD') return `${y}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return null
}

/** Semana ISO do ano. */
export function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const day = t.getUTCDay() || 7
  t.setUTCDate(t.getUTCDate() + 4 - day)
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1))
  return Math.ceil(((t.getTime() - y0.getTime()) / 86400000 + 1) / 7)
}
