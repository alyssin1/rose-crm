// Harness de desenvolvimento: renderiza componentes com dados falsos (sem Supabase, sem login).
// Acesse /debug.html?c=calendar|summary|detail|search|settings
import React, { useState } from 'react'
import ReactDOM from 'react-dom/client'
import '../i18n'
import '../styles/tokens.css'
import '../styles/app.css'
import '../styles/extra.css'
import '../styles/phase2.css'
import '../styles/phase3.css'
import { DataCtx } from '../store/data'
import { Calendar } from '../components/Calendar'
import { Summary } from '../components/Summary'
import { TaskDetail } from '../components/TaskDetail'
import { Search } from '../components/Search'
import type { List, Task } from '../lib/types'

const now = new Date()
const at = (dayOffset: number, h: number, m = 0) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, h, m).toISOString()
const base = {
  user_id: 'u', parent_id: null, column_id: null, kind: 'task', content: '', status: 0, priority: 0, start_at: null, timezone: null, duration_minutes: null, reminders: [], repeat_rule: null,
  repeat_from: null, pinned: false, sort_order: 0, completed_at: null, deleted_at: null, google_calendar_id: null, google_event_id: null, google_etag: null, google_synced_at: null, source: 'rose',
  created_at: at(-3, 8), updated_at: at(-1, 8),
} as const

const lists: List[] = [
  { id: 'inbox', user_id: 'u', folder_id: null, name: 'Inbox', emoji: null, color: null, is_inbox: true, view_mode: 'list', view_options: {}, sort_order: 0, archived: false },
  { id: 'work', user_id: 'u', folder_id: null, name: 'Trabalho', emoji: '💼', color: '#4c8dff', is_inbox: false, view_mode: 'list', view_options: {}, sort_order: 1, archived: false },
]

const initial: Task[] = [
  { ...base, id: 't1', title: 'Dia inteiro hoje', list_id: 'inbox', due_at: at(0, 0), all_day: true },
  { ...base, id: 't2', title: 'Reunião 09h', list_id: 'work', due_at: at(0, 9), all_day: false, duration_minutes: 90 },
  { ...base, id: 't3', title: 'Sobreposta 09:30', list_id: 'inbox', due_at: at(0, 9, 30), all_day: false },
  { ...base, id: 't4', title: 'Intervalo', list_id: 'work', start_at: at(1, 14), due_at: at(1, 16), all_day: false },
  { ...base, id: 't5', title: 'Viagem (3 dias)', list_id: 'work', start_at: at(2, 0), due_at: at(4, 0), all_day: true },
  { ...base, id: 't6', title: 'Concluída', list_id: 'inbox', due_at: at(-1, 0), all_day: true, status: 1, completed_at: at(-1, 12) },
  { ...base, id: 't7', title: 'Com descrição', content: '<p>Olá <b>mundo</b></p>', list_id: 'work', due_at: at(0, 15), all_day: false, priority: 5 },
] as unknown as Task[]

function Harness() {
  const [tasks, setTasks] = useState<Task[]>(initial)
  const [sel, setSel] = useState<string | null>(null)
  const c = new URLSearchParams(location.search).get('c') ?? 'calendar'
  const api = {
    ready: true, denied: false, online: true, pending: 0, error: null, clearError: () => {}, userId: 'u', lists, tags: [], tasks, taskTags: [], filters: [], templates: [], profile: null,
    google: { connected: false }, googleCalendars: [], inbox: lists[0],
    addTask: async (t: Partial<Task>) => { const nt = { ...base, id: 'n' + Math.random(), title: '', list_id: 'inbox', due_at: null, all_day: true, ...t } as Task; setTasks((p) => [nt, ...p]); return nt },
    updateTask: async (id: string, patch: Partial<Task>) => setTasks((p) => p.map((x) => (x.id === id ? { ...x, ...patch } : x))),
    toggleDone: async () => {}, setWontDo: async () => {}, trashTask: async () => {}, restoreTask: async () => {}, purgeTask: async () => {}, emptyTrash: async () => {}, duplicateTask: async (t: Task) => t,
    reorderTasks: async () => {}, addList: async () => lists[0], updateList: async () => {}, deleteList: async () => {}, ensureTag: async () => ({ id: 'x', name: 'x' }), setTaskTags: async () => {}, deleteTag: async () => {},
    addFilter: async () => {}, deleteFilter: async () => {}, updateProfile: async () => {}, saveTemplate: async () => {}, deleteTemplate: async () => {}, createFromTemplate: async (): Promise<Task> => initial[0],
    listActivity: async () => [], listAttachments: async () => [], uploadAttachment: async () => null, deleteAttachment: async () => {}, attachmentUrl: async () => null,
    storeGoogleToken: async () => {}, disconnectGoogle: async () => {}, toggleGoogleCalendar: async () => {}, syncGoogle: async () => null,
  }
  return (
    <DataCtx.Provider value={api as never}>
      <div className="shell side-closed" style={{ gridTemplateColumns: '0 1fr' }}>
        <nav className="rail" />
        <main className={'main' + (sel ? ' with-detail' : '')}>
          {c === 'calendar' && <Calendar selectedId={sel} onSelect={setSel} onToggleSidebar={() => {}} />}
          {c === 'summary' && <Summary onToggleSidebar={() => {}} />}
          {c === 'search' && <Search onClose={() => {}} onOpenTask={() => {}} onOpenView={() => {}} />}
          {sel && c === 'calendar' && <TaskDetail taskId={sel} onClose={() => setSel(null)} />}
          {c === 'detail' && <TaskDetail taskId="t7" onClose={() => {}} />}
        </main>
      </div>
    </DataCtx.Provider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Harness />
  </React.StrictMode>,
)
