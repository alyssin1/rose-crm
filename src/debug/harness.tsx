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
import '../styles/mobile.css'
import '../styles/fixes.css'
import '../styles/gcal.css'
import '../styles/gcal2.css'
import { DataCtx } from '../store/data'
import { Calendar } from '../components/Calendar'
import { Summary } from '../components/Summary'
import { TaskDetail } from '../components/TaskDetail'
import { Search } from '../components/Search'
import { TaskList } from '../components/TaskList'
import { StickyLayer } from '../components/Sticky'
import { Mesa } from '../components/Mesa'
import '../styles/mesa.css'
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
  { ...base, id: 't7', title: 'Com descrição', content: '<p>Olá <b>mundo</b></p>', list_id: 'work', due_at: at(0, 15), all_day: false, priority: 5, close_request: { by: 'g', at: at(0, 10) } },
  { ...base, id: 's1', title: 'Subtarefa 1', list_id: 'work', parent_id: 't7', sort_order: 1, due_at: null, all_day: true },
  { ...base, id: 's2', title: 'Subtarefa 2', list_id: 'work', parent_id: 't7', sort_order: 2, due_at: null, all_day: true, status: 1 },
  { ...base, id: 's3', title: 'Neta (nível 2)', list_id: 'work', parent_id: 's1', sort_order: 1, due_at: null, all_day: true },
  { ...base, id: 'n1', title: 'Sem data A', list_id: 'inbox', sort_order: 10, due_at: null, all_day: true },
  { ...base, id: 'n2', title: 'Sem data B', list_id: 'inbox', sort_order: 20, due_at: null, all_day: true },
  { ...base, id: 'm1', title: '[revisar] Parceiro X — Fechar a proposta de valor e levar na call', list_id: 'inbox', sort_order: 30, due_at: null, all_day: true },
  { ...base, id: 'm2', title: '[revisar] Domínios — Enviar a lista de domínios migrados', list_id: 'work', sort_order: 31, due_at: null, all_day: true, priority: 3 },
  { ...base, id: 'm3', title: 'Resolver Padrão dos SKUs na Buygoods', list_id: 'work', sort_order: 32, due_at: at(1, 0), all_day: true, priority: 5 },
  { ...base, id: 'm4', title: 'Atrasada de ontem', list_id: 'work', sort_order: 33, due_at: at(-4, 0), all_day: true, priority: 1 },
  { ...base, id: 'e1', title: 'Daily do time', list_id: null, source: 'google', start_at: at(1, 10), due_at: at(1, 10, 30), all_day: false },
] as unknown as Task[]

function Harness() {
  const [tasks, setTasks] = useState<Task[]>(initial)
  const [sel, setSel] = useState<string | null>(null)
  const c = new URLSearchParams(location.search).get('c') ?? 'calendar'
  const api = {
    friends: [{ id: 'f1', requester: 'u', addressee: 'g', status: 'accepted', created_at: '' }],
    peers: [{ user_id: 'g', display_name: 'Gabriel Teste', avatar_url: null, email: 'gabriel@exemplo.com' }],
    members: [{ task_id: 't7', user_id: 'g', added_by: 'u' }],
    mentions: [], notes: [{ id: 'n1', user_id: 'u', content: '<p>Nota de teste</p>', color: 'yellow', x: 40, y: 60, w: 260, h: 200, z: 1, is_open: true }], updateNote: async () => {}, addMember: async () => {}, removeMember: async () => {}, resolveClose: async () => {}, mentionInNote: async () => {}, dismissMention: async () => {},
    ready: true, denied: false, online: true, pending: 0, error: null, clearError: () => {}, userId: 'u', lists, tags: [], tasks, taskTags: [], filters: [], templates: [], profile: null,
    google: { connected: false }, googleCalendars: [], inbox: lists[0],
    addTask: async (t: Partial<Task>) => { const nt = { ...base, id: 'n' + Math.random(), title: '', list_id: 'inbox', due_at: null, all_day: true, ...t } as Task; setTasks((p) => [nt, ...p]); return nt },
    updateTask: async (id: string, patch: Partial<Task>) => setTasks((p) => p.map((x) => (x.id === id ? { ...x, ...patch } : x))),
    toggleDone: async () => {}, setWontDo: async () => {}, trashTask: async () => {}, restoreTask: async () => {}, purgeTask: async () => {}, emptyTrash: async () => {}, duplicateTask: async (t: Task) => t,
    reorderTasks: async (moved: string, before: string | null, parent: string | null = null) =>
      setTasks((p) => {
        const sib = p.filter((x) => (x.parent_id ?? null) === parent && x.id !== moved).sort((a, b) => a.sort_order - b.sort_order)
        const i = before ? sib.findIndex((x) => x.id === before) : sib.length
        const prev = sib[i - 1]?.sort_order ?? (sib[i]?.sort_order ?? 0) - 2048
        const next = sib[i]?.sort_order ?? prev + 2048
        return p.map((x) => (x.id === moved ? { ...x, sort_order: (prev + next) / 2 } : x))
      }), addList: async () => lists[0], updateList: async () => {}, deleteList: async () => {}, ensureTag: async () => ({ id: 'x', name: 'x' }), setTaskTags: async () => {}, deleteTag: async () => {},
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
          {c === 'sticky' && <StickyLayer />}
          {c === 'mesa' && <Mesa selectedId={sel} onSelect={setSel} />}
          {c === 'tasks' && <TaskList view={{ type: 'all' }} selectedId={sel} onSelect={setSel} />}
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
