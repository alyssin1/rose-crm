import type { Task } from './types'

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
export const addDays = (d: Date, n: number) => {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}
export const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
export const dayDiff = (a: Date, b: Date) => Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / 86400000)

export const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

export type DueTone = 'none' | 'overdue' | 'today' | 'future'

export function dueTone(task: Task, now = new Date()): DueTone {
  if (!task.due_at) return 'none'
  const due = new Date(task.due_at)
  if (task.all_day ? startOfDay(due) < startOfDay(now) : due < now) return 'overdue'
  return sameDay(due, now) ? 'today' : 'future'
}

type T = (k: string, o?: Record<string, unknown>) => string

export function formatDue(task: Task, lang: string, t: T, now = new Date()): string {
  if (!task.due_at) return ''
  const due = new Date(task.due_at)
  const diff = dayDiff(due, now)
  let day: string
  if (diff === 0) day = t('due.today')
  else if (diff === 1) day = t('due.tomorrow')
  else if (diff === -1) day = t('due.yesterday')
  else {
    const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
    if (due.getFullYear() !== now.getFullYear()) opts.year = 'numeric'
    day = new Intl.DateTimeFormat(lang, opts).format(due)
  }
  return task.all_day ? day : `${day} ${hhmm(due)}`
}

export const weekdayName = (d: Date, lang: string) => {
  const s = new Intl.DateTimeFormat(lang, { weekday: 'long' }).format(d)
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ---------- repetição (subconjunto de RRULE: FREQ + INTERVAL) ----------
export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'

export const buildRule = (freq: Freq, interval = 1) => `FREQ=${freq};INTERVAL=${interval}`

export function parseRule(rule: string | null): { freq: Freq; interval: number } | null {
  if (!rule) return null
  const f = /FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)/.exec(rule)?.[1] as Freq | undefined
  if (!f) return null
  return { freq: f, interval: Number(/INTERVAL=(\d+)/.exec(rule)?.[1] ?? 1) }
}

export function nextDue(task: Task, now = new Date()): Date | null {
  const r = parseRule(task.repeat_rule)
  if (!r || !task.due_at) return null
  const base = task.repeat_from === 'completion' ? now : new Date(task.due_at)
  const d = new Date(task.due_at)
  const step = (x: Date) => {
    const y = new Date(x)
    if (r.freq === 'DAILY') y.setDate(y.getDate() + r.interval)
    else if (r.freq === 'WEEKLY') y.setDate(y.getDate() + 7 * r.interval)
    else if (r.freq === 'MONTHLY') y.setMonth(y.getMonth() + r.interval)
    else y.setFullYear(y.getFullYear() + r.interval)
    return y
  }
  let n = task.repeat_from === 'completion' ? new Date(base.getFullYear(), base.getMonth(), base.getDate(), d.getHours(), d.getMinutes()) : d
  n = step(n)
  // pula ocorrências já passadas
  let guard = 0
  while (startOfDay(n) <= startOfDay(now) && task.repeat_from !== 'completion' && guard++ < 1000) n = step(n)
  return n
}

/** YYYY-MM-DD no fuso local (usado em hábitos e contagens regressivas). */
export const isoDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
export const fromIsoDay = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
