import type { Priority } from './types'
import { addDays, startOfDay } from './dates'

const TODAY = ['hoje', 'today', 'oggi', '今日']
const TOMORROW = ['amanhã', 'amanha', 'tomorrow', 'domani', '明日']

export interface QuickAdd {
  title: string
  tagNames: string[]
  priority: Priority | null
  due: Date | null
}

/** Entrada rápida estilo TickTick: "#etiqueta", "!"/"!!"/"!!!" (prioridade) e hoje/amanhã. */
export function parseQuickAdd(input: string): QuickAdd {
  const tagNames: string[] = []
  let priority: Priority | null = null
  let due: Date | null = null
  const kept: string[] = []
  for (const word of input.trim().split(/\s+/)) {
    const lower = word.toLowerCase()
    if (/^#[^\s#]+$/.test(word)) tagNames.push(word.slice(1))
    else if (/^!{1,3}$/.test(word)) priority = ([1, 3, 5] as const)[word.length - 1]
    else if (TODAY.includes(lower)) due = startOfDay(new Date())
    else if (TOMORROW.includes(lower)) due = addDays(startOfDay(new Date()), 1)
    else kept.push(word)
  }
  return { title: kept.join(' ').trim(), tagNames, priority, due }
}
