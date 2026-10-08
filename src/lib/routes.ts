// Endereço de cada aba do Rose: /tarefas/hoje, /calendario, /mesa… (compartilhável, funciona com voltar/avançar e F5).
import type { View } from './types'

export type Section = 'home' | 'tasks' | 'calendar' | 'matrix' | 'pomodoro' | 'habits' | 'countdown' | 'stats' | 'mesa'

const SECTION: Record<Section, string> = {
  home: 'inicio',
  tasks: 'tarefas',
  calendar: 'calendario',
  matrix: 'matriz',
  pomodoro: 'pomodoro',
  habits: 'habitos',
  countdown: 'contagem',
  stats: 'estatisticas',
  mesa: 'mesa',
}
const BY_SLUG = Object.fromEntries(Object.entries(SECTION).map(([k, v]) => [v, k as Section])) as Record<string, Section>

const VIEW: Record<string, string> = {
  all: 'todas',
  today: 'hoje',
  next7: '7-dias',
  inbox: 'caixa-de-entrada',
  summary: 'resumo',
  completed: 'concluidas',
  trash: 'lixeira',
}
const VIEW_BY_SLUG = Object.fromEntries(Object.entries(VIEW).map(([k, v]) => [v, k])) as Record<string, 'all' | 'today' | 'next7' | 'inbox' | 'summary' | 'completed' | 'trash'>
const REF: Record<string, 'list' | 'tag' | 'filter'> = { lista: 'list', etiqueta: 'tag', filtro: 'filter' }
const REF_SLUG = { list: 'lista', tag: 'etiqueta', filter: 'filtro' } as const

/** caminho da aba atual (as visões de Tarefas entram no caminho; nas outras abas só a aba) */
export function toPath(section: Section, view: View): string {
  const base = '/' + SECTION[section]
  if (section !== 'tasks') return base
  if ('id' in view) return `${base}/${REF_SLUG[view.type]}/${encodeURIComponent(view.id)}`
  return `${base}/${VIEW[view.type]}`
}

/** aba e visão de um caminho; null quando o caminho não é de nenhuma aba (ex.: "/") */
export function fromPath(pathname: string): { section: Section; view: View } | null {
  const seg = pathname.split('/').filter(Boolean).map(decodeURIComponent)
  const section = BY_SLUG[seg[0] ?? '']
  if (!section) return null
  let view: View = { type: 'all' }
  if (section === 'tasks' && seg[1]) {
    if (REF[seg[1]] && seg[2]) view = { type: REF[seg[1]], id: seg[2] }
    else if (VIEW_BY_SLUG[seg[1]]) view = { type: VIEW_BY_SLUG[seg[1]] }
  }
  return { section, view }
}
