import { addDays, fromIsoDay, isoDay, startOfDay } from './dates'
import type { Habit, HabitLog } from './types'

export type LogMap = Map<string, number> // "habitId|YYYY-MM-DD" → valor

export const logMap = (logs: HabitLog[]): LogMap => new Map(logs.map((l) => [`${l.habit_id}|${l.day}`, l.value]))
export const valueOn = (m: LogMap, h: Habit, iso: string) => m.get(`${h.id}|${iso}`) ?? 0
export const isDone = (h: Habit, value: number) => value >= h.goal
/** O hábito conta nesse dia da semana? (0 = domingo) */
export const isActive = (h: Habit, d: Date) => h.days.includes(d.getDay())

export interface HabitStats {
  current: number
  best: number
  total: number // dias concluídos
  rate30: number // 0..1 nos últimos 30 dias ativos
}

/** Sequência: dias ativos consecutivos concluídos. Dias inativos não quebram nem contam; "hoje" ainda em aberto não quebra. */
export function habitStats(h: Habit, m: LogMap, today = startOfDay(new Date())): HabitStats {
  const created = [...m.keys()].filter((k) => k.startsWith(h.id + '|')).map((k) => k.split('|')[1]).sort()
  const first = created.length ? fromIsoDay(created[0]) : today
  let total = 0
  let best = 0
  let run = 0
  for (let d = first; d <= today; d = addDays(d, 1)) {
    if (!isActive(h, d)) continue
    if (isDone(h, valueOn(m, h, isoDay(d)))) {
      run++
      total++
      best = Math.max(best, run)
    } else if (isoDay(d) !== isoDay(today)) run = 0 // hoje em aberto não zera a sequência
  }
  let current = 0
  for (let d = today, guard = 0; guard < 4000; d = addDays(d, -1), guard++) {
    if (d < first) break
    if (!isActive(h, d)) continue
    if (isDone(h, valueOn(m, h, isoDay(d)))) current++
    else if (isoDay(d) === isoDay(today)) continue
    else break
  }
  let active = 0
  let done = 0
  for (let i = 0; i < 30; i++) {
    const d = addDays(today, -i)
    if (!isActive(h, d)) continue
    active++
    if (isDone(h, valueOn(m, h, isoDay(d)))) done++
  }
  return { current, best, total, rate30: active ? done / active : 0 }
}
