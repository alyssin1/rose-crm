export type Priority = 0 | 1 | 3 | 5 // nenhuma / baixa / média / alta (mesma escala do TickTick)

export interface Task {
  id: string
  user_id: string
  list_id: string | null
  parent_id: string | null
  column_id: string | null
  kind: 'task' | 'checklist' | 'note'
  title: string
  content: string
  status: 0 | 1 | 2 // aberta · concluída · não farei
  priority: Priority
  start_at: string | null
  due_at: string | null
  all_day: boolean
  timezone: string | null
  duration_minutes: number | null
  reminders: string[] // 'on_time' | '5m' | '30m' | '1h' | '1d'
  repeat_rule: string | null // ex.: FREQ=WEEKLY;INTERVAL=1
  repeat_from: 'due' | 'completion' | null
  pinned: boolean
  sort_order: number
  completed_at: string | null
  deleted_at: string | null
  google_calendar_id: string | null
  google_event_id: string | null
  google_etag: string | null
  google_synced_at: string | null
  source: 'rose' | 'google'
  google_meta?: GoogleMeta | null
  /** Mesa da Semana: segunda-feira (AAAA-MM-DD) da semana para a qual a tarefa foi puxada com "Entra"; null = não puxada */
  week_in?: string | null
  /** pedido de conclusão feito por um participante (o dono aceita ou recusa) */
  close_request?: { by: string; at: string; status?: number } | null
  created_at: string
  updated_at: string
}

export interface List {
  id: string
  user_id: string
  folder_id: string | null
  name: string
  emoji: string | null
  color: string | null
  is_inbox: boolean
  view_mode: 'list' | 'kanban' | 'timeline'
  view_options: Record<string, unknown>
  sort_order: number
  archived: boolean
}

export interface Folder {
  id: string
  user_id: string
  name: string
  sort_order: number
  collapsed: boolean
}

export interface Tag {
  id: string
  user_id: string
  parent_id: string | null
  name: string
  color: string | null
  sort_order: number
}

export interface TaskTag {
  task_id: string
  tag_id: string
  user_id: string
}

export interface FilterRules {
  listIds?: string[]
  tagIds?: string[]
  priorities?: number[]
  date?: 'any' | 'today' | 'next7' | 'overdue' | 'nodate'
  status?: 'open' | 'done' | 'all'
}

export interface FilterDef {
  id: string
  user_id: string
  name: string
  rules: FilterRules
  sort_order: number
}

export interface Profile {
  user_id: string
  display_name: string | null
  avatar_url: string | null
  email?: string | null
  lang: 'pt' | 'en' | 'ja' | 'it'
  theme: 'dark' | 'light' | 'system'
  time_format: '24h' | '12h'
  date_format: string
  week_start: number
  show_week_numbers: boolean
  per_task_timezone: boolean
  features: Record<string, boolean>
  settings: Record<string, unknown>
}

export interface Attachment {
  id: string
  user_id: string
  task_id: string
  name: string
  storage_path: string
  mime: string | null
  size_bytes: number | null
  created_at: string
}

export interface Activity {
  id: string
  task_id: string
  action: string
  detail: Record<string, unknown>
  created_at: string
}

export interface Template {
  id: string
  name: string
  payload: {
    title: string
    content: string
    priority: Priority
    reminders: string[]
    repeat_rule: string | null
    repeat_from: 'due' | 'completion' | null
    list_id: string | null
    subtasks: string[]
    tagIds: string[]
  }
  created_at: string
}

export interface Column {
  id: string
  user_id: string
  list_id: string
  name: string
  sort_order: number
}

/** amizade: convite (pending) → aceito (accepted) */
export interface Friend {
  id: string
  requester: string
  addressee: string
  status: 'pending' | 'accepted'
  created_at: string
}
/** pessoa visível para mim (eu, amigos, convites, quem divide tarefa comigo) */
export interface Peer {
  user_id: string
  display_name: string | null
  avatar_url: string | null
  email: string | null
}
export interface TaskMember {
  task_id: string
  user_id: string
  added_by: string | null
}
export interface NoteMention {
  note_id: string
  user_id: string
  dismissed: boolean
}

export interface StickyNote {
  id: string
  user_id: string
  content: string
  color: string
  x: number
  y: number
  w: number
  h: number
  z: number
  is_open: boolean
}

export interface FocusSession {
  id: string
  user_id: string
  task_id: string | null
  kind: 'pomodoro' | 'stopwatch'
  started_at: string
  duration_seconds: number
  planned_seconds: number | null
  completed: boolean
}

export interface Habit {
  id: string
  user_id: string
  name: string
  emoji: string | null
  color: string | null
  kind: 'boolean' | 'count'
  goal: number
  unit: string | null
  days: number[]
  reminder_time: string | null
  archived: boolean
  sort_order: number
}

export interface HabitLog {
  id: string
  user_id: string
  habit_id: string
  day: string // YYYY-MM-DD
  value: number
}

export interface Countdown {
  id: string
  user_id: string
  name: string
  emoji: string | null
  color: string | null
  target_date: string // YYYY-MM-DD
  repeat_yearly: boolean
  pinned: boolean
  note: string | null
}

export interface GoogleCalendar {
  id: string
  user_id: string
  google_calendar_id: string
  name: string | null
  color: string | null
  background_color: string | null
  enabled: boolean
  access_role: string | null
  last_synced_at: string | null
}

export interface GoogleStatus {
  connected: boolean
  email?: string
  scopes?: string
}

export type View =
  | { type: 'all' | 'today' | 'next7' | 'inbox' | 'summary' | 'completed' | 'trash' }
  | { type: 'list' | 'tag' | 'filter'; id: string }

/** colunas da lista de tarefas (menu "Campos") */
export type ColKey = 'priority' | 'start' | 'due' | 'tags' | 'list'
export const ALL_COLS: ColKey[] = ['priority', 'start', 'due', 'tags', 'list']

export interface ViewOptions {
  cols: ColKey[]
  groupBy: 'date' | 'list' | 'priority' | 'tag' | 'none'
  orderBy: 'date' | 'modified' | 'created' | 'title' | 'tag' | 'priority'
  desc: boolean
  showCompleted: boolean
  showDetails: boolean
}

export const DEFAULT_VIEW_OPTIONS: ViewOptions = {
  cols: ALL_COLS,
  groupBy: 'date',
  orderBy: 'date',
  desc: false,
  showCompleted: false,
  showDetails: true,
}

export const viewKey = (v: View) => ('id' in v ? `${v.type}:${v.id}` : v.type)

export interface GoogleMeta {
  htmlLink: string | null
  /** cor própria do evento (1–11 do Google); null = cor da agenda */
  colorId?: string | null
  location: string | null
  meet: string | null
  phone: { label: string; pin: string | null } | null
  organizer: { email: string | null; name: string | null; self: boolean } | null
  attendees: { email: string; name: string | null; status: 'accepted' | 'declined' | 'tentative' | 'needsAction'; organizer: boolean; self: boolean; optional: boolean }[]
  recurrence: string[] | null
  reminders: number[]
}
