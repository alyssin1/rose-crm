import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { idbGet, idbSet } from '../lib/idb'
import { nextDue } from '../lib/dates'
import type { Activity, Attachment, Column, Countdown, FilterDef, Folder, FocusSession, Habit, HabitLog, FilterRules, GoogleCalendar, GoogleStatus, List, Profile, StickyNote, Tag, Task, TaskTag, Template } from '../lib/types'

type NewTask = Partial<Task> & { title: string }

interface Match {
  col: string
  val?: unknown
  notNull?: boolean
}
interface Op {
  table: string
  kind: 'insert' | 'update' | 'delete'
  row?: unknown
  patch?: Record<string, unknown>
  match?: Match[]
}

interface DataApi {
  ready: boolean
  denied: boolean
  online: boolean
  pending: number
  error: string | null
  clearError: () => void
  userId: string
  lists: List[]
  tags: Tag[]
  tasks: Task[]
  taskTags: TaskTag[]
  filters: FilterDef[]
  templates: Template[]
  profile: Profile | null
  google: GoogleStatus
  googleCalendars: GoogleCalendar[]
  columns: Column[]
  folders: Folder[]
  notes: StickyNote[]
  sessions: FocusSession[]
  habits: Habit[]
  habitLogs: HabitLog[]
  countdowns: Countdown[]
  inbox: List | undefined
  addTask: (t: NewTask, tagIds?: string[]) => Promise<Task>
  updateTask: (id: string, patch: Partial<Task>) => Promise<void>
  reorderTasks: (movedId: string, beforeId: string | null, parentId?: string | null) => Promise<void>
  toggleDone: (task: Task) => Promise<void>
  setWontDo: (task: Task) => Promise<void>
  trashTask: (id: string) => Promise<void>
  restoreTask: (id: string) => Promise<void>
  purgeTask: (id: string) => Promise<void>
  emptyTrash: () => Promise<void>
  duplicateTask: (task: Task) => Promise<Task>
  addList: (name: string, emoji?: string | null, color?: string | null) => Promise<List>
  updateList: (id: string, patch: Partial<List>) => Promise<void>
  deleteList: (id: string) => Promise<void>
  ensureTag: (name: string) => Promise<Tag>
  setTaskTags: (taskId: string, tagIds: string[]) => Promise<void>
  deleteTag: (id: string) => Promise<void>
  addFilter: (name: string, rules: FilterRules) => Promise<void>
  deleteFilter: (id: string) => Promise<void>
  updateFilter: (id: string, patch: Partial<FilterDef>) => Promise<void>
  updateTag: (id: string, patch: Partial<Tag>) => Promise<void>
  addFolder: (name: string) => Promise<Folder>
  updateFolder: (id: string, patch: Partial<Folder>) => Promise<void>
  deleteFolder: (id: string) => Promise<void>
  updateProfile: (patch: Partial<Profile>) => Promise<void>
  saveTemplate: (task: Task) => Promise<void>
  deleteTemplate: (id: string) => Promise<void>
  createFromTemplate: (tpl: Template, listId?: string | null) => Promise<Task>
  listActivity: (taskId: string) => Promise<Activity[]>
  listAttachments: (taskId: string) => Promise<Attachment[]>
  uploadAttachment: (taskId: string, file: File) => Promise<Attachment | null>
  deleteAttachment: (att: Attachment) => Promise<void>
  attachmentUrl: (att: Attachment) => Promise<string | null>
  storeGoogleToken: (refresh: string, scopes: string, email: string) => Promise<void>
  disconnectGoogle: () => Promise<void>
  toggleGoogleCalendar: (id: string, enabled: boolean) => Promise<void>
  syncGoogle: (manual?: boolean) => Promise<string | null>
  rsvpEvent: (taskId: string, response: 'accepted' | 'declined' | 'tentative') => Promise<string | null>
  /** muda o horário de uma série do Google: "este e os seguintes" ou "todos os eventos" */
  editRecurring: (taskId: string, scope: 'following' | 'all', start: string, end: string) => Promise<string | null>
  syncAvailable: boolean
  addColumn: (listId: string, name: string) => Promise<Column>
  renameColumn: (id: string, name: string) => Promise<void>
  deleteColumn: (id: string) => Promise<void>
  moveColumn: (id: string, beforeId: string | null) => Promise<void>
  addNote: (color?: string) => Promise<StickyNote>
  updateNote: (id: string, patch: Partial<StickyNote>) => Promise<void>
  deleteNote: (id: string) => Promise<void>
  addSession: (s: Omit<FocusSession, 'id' | 'user_id'>) => Promise<void>
  deleteSession: (id: string) => Promise<void>
  addHabit: (h: Partial<Habit> & { name: string }) => Promise<Habit>
  updateHabit: (id: string, patch: Partial<Habit>) => Promise<void>
  deleteHabit: (id: string) => Promise<void>
  setHabitValue: (habitId: string, day: string, value: number) => Promise<void>
  addCountdown: (c: Partial<Countdown> & { name: string; target_date: string }) => Promise<Countdown>
  updateCountdown: (id: string, patch: Partial<Countdown>) => Promise<void>
  deleteCountdown: (id: string) => Promise<void>
}

const Ctx = createContext<DataApi | null>(null)
export const DataCtx = Ctx // usado só pelo harness de testes (src/debug)
export const useData = () => {
  const c = useContext(Ctx)
  if (!c) throw new Error('DataProvider ausente')
  return c
}

type Row = { id: string }
const upsertById = <T extends Row>(arr: T[], row: T) => (arr.some((x) => x.id === row.id) ? arr.map((x) => (x.id === row.id ? row : x)) : [row, ...arr])

const isNetworkError = (msg: string) => !navigator.onLine || /failed to fetch|networkerror|network request|load failed|fetch failed/i.test(msg)

async function exec(op: Op): Promise<{ error: { message: string } | null }> {
  try {
    const t = supabase.from(op.table)
    let q: any // eslint-disable-line @typescript-eslint/no-explicit-any
    if (op.kind === 'insert') q = t.insert(op.row as never)
    else {
      q = op.kind === 'update' ? t.update((op.patch ?? {}) as never) : t.delete()
      for (const m of op.match ?? []) q = m.notNull ? q.not(m.col, 'is', null) : q.eq(m.col, m.val)
    }
    const { error } = await q
    return { error }
  } catch (e) {
    return { error: { message: e instanceof Error ? e.message : String(e) } }
  }
}

/** Carrega tarefas em páginas de 1000 (limite do PostgREST): todas as do Rose + eventos do Google numa janela de datas. */
async function loadTasks(): Promise<{ data: Task[] | null; error: { message: string } | null }> {
  const out: Task[] = []
  const from = new Date(Date.now() - 60 * 86400000).toISOString()
  const to = new Date(Date.now() + 240 * 86400000).toISOString()
  const pages = async (build: (a: number, b: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>) => {
    for (let a = 0; ; a += 1000) {
      const { data, error } = await build(a, a + 999)
      if (error) return error
      out.push(...((data ?? []) as Task[]))
      if (!data || data.length < 1000) return null
    }
  }
  const e1 = await pages((a, b) => supabase.from('rose_tasks').select('*').neq('source', 'google').order('created_at').range(a, b))
  if (e1) return { data: null, error: e1 }
  const e2 = await pages((a, b) => supabase.from('rose_tasks').select('*').eq('source', 'google').gte('due_at', from).lte('due_at', to).order('due_at').range(a, b))
  if (e2) return { data: null, error: e2 }
  return { data: out, error: null }
}

const EMPTY_GOOGLE: GoogleStatus = { connected: false }

export function DataProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [denied, setDenied] = useState(false)
  const [online, setOnline] = useState(navigator.onLine)
  const [pending, setPending] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [lists, setLists] = useState<List[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [tasks, setTasks] = useState<Task[]>([])
  const [taskTags, setTaskTags_] = useState<TaskTag[]>([])
  const [filters, setFilters] = useState<FilterDef[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [profile, setProfile] = useState<Profile | null>(null)
  const [google, setGoogle] = useState<GoogleStatus>(EMPTY_GOOGLE)
  const [googleCalendars, setGoogleCalendars] = useState<GoogleCalendar[]>([])
  const [syncAvailable, setSyncAvailable] = useState(true) // false depois que o servidor de sincronização falha: para de insistir sozinho
  const [columns, setColumns] = useState<Column[]>([])
  const [notes, setNotes] = useState<StickyNote[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [sessions, setSessions] = useState<FocusSession[]>([])
  const [habits, setHabits] = useState<Habit[]>([])
  const [habitLogs, setHabitLogs] = useState<HabitLog[]>([])
  const [countdowns, setCountdowns] = useState<Countdown[]>([])
  const queue = useRef<Op[]>([])
  const flushing = useRef(false)

  const fail = useCallback((msg: string) => setError(msg), [])

  // ---------- carga ----------
  const loadAll = useCallback(async () => {
    const [l, t, tg, tt, f, tp, pr, gc, gs, co, sn, fs, hb, hl, cd, fo] = await Promise.all([
      supabase.from('rose_lists').select('*').order('sort_order'),
      loadTasks(),
      supabase.from('rose_tags').select('*').order('name'),
      supabase.from('rose_task_tags').select('*'),
      supabase.from('rose_filters').select('*').order('sort_order'),
      supabase.from('rose_templates').select('*').order('created_at', { ascending: false }),
      supabase.from('rose_profiles').select('*').maybeSingle(),
      supabase.from('rose_google_calendars').select('*').order('name'),
      supabase.rpc('rose_google_status'),
      supabase.from('rose_columns').select('*').order('sort_order'),
      supabase.from('rose_sticky_notes').select('*').order('z'),
      supabase.from('rose_focus_sessions').select('*').order('started_at', { ascending: false }).limit(1000),
      supabase.from('rose_habits').select('*').order('sort_order'),
      supabase.from('rose_habit_logs').select('*').order('day', { ascending: false }).limit(5000),
      supabase.from('rose_countdowns').select('*').order('target_date'),
      supabase.from('rose_folders').select('*').order('sort_order'),
    ])
    const err = l.error || t.error || tg.error || tt.error || f.error
    if (err) return fail(err.message)
    setLists(l.data as List[])
    setTasks(t.data as Task[])
    setTags(tg.data as Tag[])
    setTaskTags_(tt.data as TaskTag[])
    setFilters(f.data as FilterDef[])
    if (!tp.error) setTemplates(tp.data as Template[])
    if (pr.data) setProfile(pr.data as Profile)
    if (!gc.error) setGoogleCalendars(gc.data as GoogleCalendar[])
    if (!gs.error && gs.data) setGoogle(gs.data as GoogleStatus)
    if (!co.error) setColumns(co.data as Column[])
    if (!sn.error) setNotes(sn.data as StickyNote[])
    if (!fs.error) setSessions(fs.data as FocusSession[])
    if (!hb.error) setHabits(hb.data as Habit[])
    if (!hl.error) setHabitLogs(hl.data as HabitLog[])
    if (!cd.error) setCountdowns(cd.data as Countdown[])
    if (!fo.error) setFolders(fo.data as Folder[])
  }, [fail])

  // ---------- fila offline ----------
  const persistQueue = useCallback(() => {
    setPending(queue.current.length)
    void idbSet(`outbox:${userId}`, queue.current)
  }, [userId])

  const flush = useCallback(async () => {
    if (flushing.current || !queue.current.length || !navigator.onLine) return
    flushing.current = true
    let sent = false
    while (queue.current.length) {
      const { error: e } = await exec(queue.current[0])
      if (e && isNetworkError(e.message)) break
      if (e) fail(e.message) // erro do servidor: descarta a operação
      queue.current.shift()
      sent = true
      persistQueue()
    }
    flushing.current = false
    if (sent && !queue.current.length) await loadAll()
  }, [fail, loadAll, persistQueue])

  const mutate = useCallback(
    async (op: Op) => {
      if (queue.current.length || !navigator.onLine) {
        queue.current.push(op)
        persistQueue()
        void flush()
        return
      }
      const { error: e } = await exec(op)
      if (!e) return
      if (isNetworkError(e.message)) {
        queue.current.push(op)
        persistQueue()
      } else {
        fail(e.message)
        await loadAll()
      }
    },
    [fail, flush, loadAll, persistQueue],
  )

  // ---------- inicialização (cache → rede) ----------
  useEffect(() => {
    let alive = true
    ;(async () => {
      const cached = await idbGet<{ lists: List[]; tags: Tag[]; tasks: Task[]; taskTags: TaskTag[]; filters: FilterDef[]; templates: Template[]; profile: Profile | null; columns?: Column[]; notes?: StickyNote[]; sessions?: FocusSession[]; habits?: Habit[]; habitLogs?: HabitLog[]; countdowns?: Countdown[]; folders?: Folder[] }>(`cache:${userId}`)
      queue.current = (await idbGet<Op[]>(`outbox:${userId}`)) ?? []
      setPending(queue.current.length)
      if (cached && alive) {
        setLists(cached.lists ?? [])
        setTags(cached.tags ?? [])
        setTasks(cached.tasks ?? [])
        setTaskTags_(cached.taskTags ?? [])
        setFilters(cached.filters ?? [])
        setTemplates(cached.templates ?? [])
        setProfile(cached.profile ?? null)
        setColumns(cached.columns ?? [])
        setNotes(cached.notes ?? [])
        setSessions(cached.sessions ?? [])
        setHabits(cached.habits ?? [])
        setHabitLogs(cached.habitLogs ?? [])
        setCountdowns(cached.countdowns ?? [])
        setFolders(cached.folders ?? [])
        setReady(true)
      }
      if (!navigator.onLine) return setReady(true)
      const { error: e } = await supabase.rpc('rose_bootstrap')
      if (!alive) return
      if (e) {
        if (e.code === '42501') setDenied(true)
        else if (!isNetworkError(e.message)) fail(e.message)
        return setReady(true)
      }
      await flush()
      if (!queue.current.length) await loadAll()
      if (alive) setReady(true)
    })()
    return () => {
      alive = false
    }
  }, [userId, loadAll, flush, fail])

  // cache local (debounce)
  useEffect(() => {
    if (!ready || denied) return
    const id = setTimeout(() => void idbSet(`cache:${userId}`, { lists, tags, tasks, taskTags, filters, templates, profile, columns, notes, sessions, habits, habitLogs, countdowns, folders }), 600)
    return () => clearTimeout(id)
  }, [ready, denied, userId, lists, tags, tasks, taskTags, filters, templates, profile, columns, notes, sessions, habits, habitLogs, countdowns, folders])

  // online/offline
  useEffect(() => {
    const on = () => {
      setOnline(true)
      void flush()
    }
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    const poll = setInterval(() => void flush(), 30000)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
      clearInterval(poll)
    }
  }, [flush])

  // ---------- Realtime: PC ↔ iPhone ao vivo ----------
  useEffect(() => {
    if (!ready || denied) return
    const apply =
      <T extends Row>(set: (f: (p: T[]) => T[]) => void) =>
      (p: { eventType: string; new: unknown; old: unknown }) => {
        if (p.eventType === 'DELETE') set((prev) => prev.filter((x) => x.id !== (p.old as Row).id))
        else set((prev) => upsertById(prev, p.new as T))
      }
    const ch = supabase
      .channel('rose-sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rose_tasks' }, apply<Task>(setTasks))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rose_lists' }, apply<List>(setLists))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rose_tags' }, apply<Tag>(setTags))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rose_filters' }, apply<FilterDef>(setFilters))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rose_columns' }, apply<Column>(setColumns))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rose_sticky_notes' }, apply<StickyNote>(setNotes))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rose_focus_sessions' }, apply<FocusSession>(setSessions))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rose_habits' }, apply<Habit>(setHabits))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rose_habit_logs' }, apply<HabitLog>(setHabitLogs))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rose_countdowns' }, apply<Countdown>(setCountdowns))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rose_task_tags' }, async () => {
        const { data } = await supabase.from('rose_task_tags').select('*')
        if (data) setTaskTags_(data as TaskTag[])
      })
      .subscribe()
    return () => {
      void supabase.removeChannel(ch)
    }
  }, [ready, denied])

  const inbox = useMemo(() => lists.find((l) => l.is_inbox), [lists])

  const eq = (col: string, val: unknown): Match => ({ col, val })

  const logActivity = useCallback(
    (taskId: string, action: string, detail: Record<string, unknown> = {}) =>
      mutate({ table: 'rose_task_activity', kind: 'insert', row: { id: crypto.randomUUID(), user_id: userId, task_id: taskId, action, detail } }),
    [mutate, userId],
  )

  const tasksRef = useRef<Task[]>([])
  tasksRef.current = tasks

  const patchTask = useCallback(
    async (id: string, patch: Partial<Task>) => {
      const prev = tasksRef.current.find((t) => t.id === id)
      setTasks((p) => p.map((t) => (t.id === id ? { ...t, ...patch, updated_at: new Date().toISOString() } : t)))
      await mutate({ table: 'rose_tasks', kind: 'update', patch: patch as Record<string, unknown>, match: [eq('id', id)] })
      if (!prev) return
      if (patch.title !== undefined && patch.title !== prev.title) void logActivity(id, 'title', { from: prev.title, to: patch.title })
      if (patch.due_at !== undefined && patch.due_at !== prev.due_at) void logActivity(id, 'due', { from: prev.due_at, to: patch.due_at })
      if (patch.priority !== undefined && patch.priority !== prev.priority) void logActivity(id, 'priority', { from: prev.priority, to: patch.priority })
      if (patch.list_id !== undefined && patch.list_id !== prev.list_id) void logActivity(id, 'list', { to: patch.list_id })
      if (patch.status !== undefined && patch.status !== prev.status) void logActivity(id, patch.status === 1 ? 'completed' : patch.status === 2 ? 'wontdo' : 'reopened')
      if (patch.pinned !== undefined && patch.pinned !== prev.pinned) void logActivity(id, patch.pinned ? 'pinned' : 'unpinned')
      if (patch.deleted_at !== undefined && !!patch.deleted_at !== !!prev.deleted_at) void logActivity(id, patch.deleted_at ? 'trashed' : 'restored')
    },
    [mutate, logActivity], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const api: DataApi = {
    ready,
    denied,
    online,
    pending,
    error,
    clearError: () => setError(null),
    userId,
    lists,
    tags,
    tasks,
    taskTags,
    filters,
    templates,
    profile,
    google,
    googleCalendars,
    syncAvailable,
    columns,
    folders,
    notes,
    sessions,
    habits,
    habitLogs,
    countdowns,
    inbox,

    async addTask(input, tagIds = []) {
      const now = new Date().toISOString()
      const task: Task = {
        id: crypto.randomUUID(),
        user_id: userId,
        list_id: inbox?.id ?? null,
        parent_id: null,
        column_id: null,
        kind: 'task',
        content: '',
        status: 0,
        priority: 0,
        start_at: null,
        due_at: null,
        all_day: true,
        timezone: null,
        duration_minutes: null,
        reminders: [],
        repeat_rule: null,
        repeat_from: null,
        pinned: false,
        sort_order: -Date.now(),
        completed_at: null,
        deleted_at: null,
        google_calendar_id: null,
        google_event_id: null,
        google_etag: null,
        google_synced_at: null,
        source: 'rose',
        created_at: now,
        updated_at: now,
        ...input,
      }
      setTasks((p) => [task, ...p])
      await mutate({ table: 'rose_tasks', kind: 'insert', row: task })
      void logActivity(task.id, 'created')
      if (tagIds.length) await api.setTaskTags(task.id, tagIds)
      return task
    },

    updateTask: patchTask,

    async reorderTasks(movedId, beforeId, parentId = null) {
      // coloca "movedId" antes de "beforeId" (ou no fim) entre os irmãos do mesmo pai, pelo ponto médio dos sort_order vizinhos
      const all = [...tasksRef.current].filter((t) => !t.deleted_at && (t.parent_id ?? null) === parentId).sort((a, b) => a.sort_order - b.sort_order)
      const without = all.filter((t) => t.id !== movedId)
      const idx = beforeId ? without.findIndex((t) => t.id === beforeId) : without.length
      const prev = without[idx - 1]?.sort_order ?? (without[idx]?.sort_order ?? 0) - 2048
      const next = without[idx]?.sort_order ?? prev + 2048
      await patchTask(movedId, { sort_order: Math.round((prev + next) / 2) })
    },

    async toggleDone(task) {
      if (task.status === 0) {
        const next = task.repeat_rule ? nextDue(task) : null
        if (next) return patchTask(task.id, { due_at: next.toISOString() }) // tarefa recorrente: avança a data
        return patchTask(task.id, { status: 1, completed_at: new Date().toISOString() })
      }
      return patchTask(task.id, { status: 0, completed_at: null })
    },

    setWontDo: (task) =>
      task.status === 2 ? patchTask(task.id, { status: 0, completed_at: null }) : patchTask(task.id, { status: 2, completed_at: new Date().toISOString() }),

    trashTask: (id) => patchTask(id, { deleted_at: new Date().toISOString() }),
    restoreTask: (id) => patchTask(id, { deleted_at: null }),

    async purgeTask(id) {
      setTasks((p) => p.filter((t) => t.id !== id && t.parent_id !== id))
      await mutate({ table: 'rose_tasks', kind: 'delete', match: [eq('id', id)] })
    },

    async emptyTrash() {
      setTasks((p) => p.filter((t) => !t.deleted_at))
      await mutate({ table: 'rose_tasks', kind: 'delete', match: [{ col: 'deleted_at', notNull: true }] })
    },

    async duplicateTask(task) {
      const { id: _id, created_at: _c, updated_at: _u, completed_at: _d, google_event_id: _g, google_etag: _e, google_synced_at: _s, ...rest } = task
      const copy = await api.addTask({ ...rest, title: task.title, status: 0, source: 'rose' })
      const tgs = taskTags.filter((x) => x.task_id === task.id).map((x) => x.tag_id)
      if (tgs.length) await api.setTaskTags(copy.id, tgs)
      for (const s of tasksRef.current.filter((x) => x.parent_id === task.id && !x.deleted_at)) {
        await api.addTask({ title: s.title, parent_id: copy.id, list_id: s.list_id, sort_order: s.sort_order })
      }
      return copy
    },

    async addList(name, emoji = null, color = null) {
      const list: List = {
        id: crypto.randomUUID(),
        user_id: userId,
        folder_id: null,
        name,
        emoji,
        color,
        is_inbox: false,
        view_mode: 'list',
        view_options: {},
        sort_order: Date.now(),
        archived: false,
      }
      setLists((p) => [...p, list])
      await mutate({ table: 'rose_lists', kind: 'insert', row: list })
      return list
    },

    async updateList(id, patch) {
      setLists((p) => p.map((l) => (l.id === id ? { ...l, ...patch } : l)))
      await mutate({ table: 'rose_lists', kind: 'update', patch: patch as Record<string, unknown>, match: [eq('id', id)] })
    },

    async deleteList(id) {
      // tarefas da lista vão para a Lixeira (como no TickTick)
      const now = new Date().toISOString()
      setTasks((p) => p.map((t) => (t.list_id === id ? { ...t, deleted_at: now, list_id: inbox?.id ?? null } : t)))
      setLists((p) => p.filter((l) => l.id !== id))
      await mutate({ table: 'rose_tasks', kind: 'update', patch: { deleted_at: now, list_id: inbox?.id ?? null }, match: [eq('list_id', id)] })
      await mutate({ table: 'rose_lists', kind: 'delete', match: [eq('id', id)] })
    },

    async ensureTag(name) {
      const found = tags.find((t) => t.name.toLowerCase() === name.toLowerCase())
      if (found) return found
      const tag: Tag = { id: crypto.randomUUID(), user_id: userId, parent_id: null, name, color: null, sort_order: Date.now() }
      setTags((p) => [...p, tag])
      await mutate({ table: 'rose_tags', kind: 'insert', row: tag })
      return tag
    },

    async setTaskTags(taskId, tagIds) {
      setTaskTags_((p) => [...p.filter((x) => x.task_id !== taskId), ...tagIds.map((tag_id) => ({ task_id: taskId, tag_id, user_id: userId }))])
      await mutate({ table: 'rose_task_tags', kind: 'delete', match: [eq('task_id', taskId)] })
      for (const tag_id of tagIds) await mutate({ table: 'rose_task_tags', kind: 'insert', row: { task_id: taskId, tag_id, user_id: userId } })
    },

    async deleteTag(id) {
      setTags((p) => p.filter((t) => t.id !== id))
      setTaskTags_((p) => p.filter((x) => x.tag_id !== id))
      await mutate({ table: 'rose_tags', kind: 'delete', match: [eq('id', id)] })
    },

    async addFilter(name, rules) {
      const f: FilterDef = { id: crypto.randomUUID(), user_id: userId, name, rules, sort_order: Date.now() }
      setFilters((p) => [...p, f])
      await mutate({ table: 'rose_filters', kind: 'insert', row: f })
    },

    async deleteFilter(id) {
      setFilters((p) => p.filter((f) => f.id !== id))
      await mutate({ table: 'rose_filters', kind: 'delete', match: [eq('id', id)] })
    },

    async updateFilter(id, patch) {
      setFilters((p) => p.map((f) => (f.id === id ? { ...f, ...patch } : f)))
      await mutate({ table: 'rose_filters', kind: 'update', patch: patch as Record<string, unknown>, match: [eq('id', id)] })
    },

    async updateTag(id, patch) {
      setTags((p) => p.map((x) => (x.id === id ? { ...x, ...patch } : x)))
      await mutate({ table: 'rose_tags', kind: 'update', patch: patch as Record<string, unknown>, match: [eq('id', id)] })
    },

    async addFolder(name) {
      const f: Folder = { id: crypto.randomUUID(), user_id: userId, name, sort_order: Date.now(), collapsed: false }
      setFolders((p) => [...p, f])
      await mutate({ table: 'rose_folders', kind: 'insert', row: f })
      return f
    },

    async updateFolder(id, patch) {
      setFolders((p) => p.map((x) => (x.id === id ? { ...x, ...patch } : x)))
      await mutate({ table: 'rose_folders', kind: 'update', patch: patch as Record<string, unknown>, match: [eq('id', id)] })
    },

    async deleteFolder(id) {
      setFolders((p) => p.filter((x) => x.id !== id))
      setLists((p) => p.map((l) => (l.folder_id === id ? { ...l, folder_id: null } : l))) // listas saem da pasta, não são apagadas
      await mutate({ table: 'rose_folders', kind: 'delete', match: [eq('id', id)] })
    },

    async updateProfile(patch) {
      setProfile((p) => (p ? { ...p, ...patch } : p))
      await mutate({ table: 'rose_profiles', kind: 'update', patch: patch as Record<string, unknown>, match: [eq('user_id', userId)] })
    },

    async saveTemplate(task) {
      const subs = tasksRef.current.filter((x) => x.parent_id === task.id && !x.deleted_at).map((x) => x.title)
      const tpl: Template = {
        id: crypto.randomUUID(),
        name: task.title || 'Template',
        payload: {
          title: task.title,
          content: task.content,
          priority: task.priority,
          reminders: task.reminders,
          repeat_rule: task.repeat_rule,
          repeat_from: task.repeat_from,
          list_id: task.list_id,
          subtasks: subs,
          tagIds: taskTags.filter((x) => x.task_id === task.id).map((x) => x.tag_id),
        },
        created_at: new Date().toISOString(),
      }
      setTemplates((p) => [tpl, ...p])
      await mutate({ table: 'rose_templates', kind: 'insert', row: { id: tpl.id, user_id: userId, name: tpl.name, payload: tpl.payload } })
    },

    async deleteTemplate(id) {
      setTemplates((p) => p.filter((x) => x.id !== id))
      await mutate({ table: 'rose_templates', kind: 'delete', match: [eq('id', id)] })
    },

    async createFromTemplate(tpl, listId) {
      const p = tpl.payload
      const task = await api.addTask(
        { title: p.title, content: p.content, priority: p.priority, reminders: p.reminders, repeat_rule: p.repeat_rule, repeat_from: p.repeat_from, list_id: listId ?? p.list_id ?? inbox?.id ?? null },
        p.tagIds.filter((id) => tags.some((t) => t.id === id)),
      )
      for (const s of p.subtasks) await api.addTask({ title: s, parent_id: task.id, list_id: task.list_id, sort_order: Date.now() })
      return task
    },

    async listActivity(taskId) {
      const { data } = await supabase.from('rose_task_activity').select('*').eq('task_id', taskId).order('created_at', { ascending: false }).limit(100)
      return (data ?? []) as Activity[]
    },

    async listAttachments(taskId) {
      const { data } = await supabase.from('rose_attachments').select('*').eq('task_id', taskId).order('created_at')
      return (data ?? []) as Attachment[]
    },

    async uploadAttachment(taskId, file) {
      if (file.size > 10 * 1024 * 1024) {
        fail('10 MB max')
        return null
      }
      const path = `${userId}/${taskId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.\-]+/g, '_')}`
      const up = await supabase.storage.from('rose-attachments').upload(path, file, { contentType: file.type || undefined })
      if (up.error) {
        fail(up.error.message)
        return null
      }
      const row = { id: crypto.randomUUID(), user_id: userId, task_id: taskId, name: file.name, storage_path: path, mime: file.type || null, size_bytes: file.size }
      const ins = await supabase.from('rose_attachments').insert(row).select().single()
      if (ins.error) {
        fail(ins.error.message)
        return null
      }
      void logActivity(taskId, 'attached', { name: file.name })
      return ins.data as Attachment
    },

    async deleteAttachment(att) {
      await supabase.storage.from('rose-attachments').remove([att.storage_path])
      await supabase.from('rose_attachments').delete().eq('id', att.id)
    },

    async attachmentUrl(att) {
      const { data } = await supabase.storage.from('rose-attachments').createSignedUrl(att.storage_path, 300)
      return data?.signedUrl ?? null
    },

    async storeGoogleToken(refresh, scopes, email) {
      const { error: e } = await supabase.rpc('rose_store_google_token', { p_refresh: refresh, p_scopes: scopes, p_email: email })
      if (e) return fail(e.message)
      setGoogle({ connected: true, email, scopes })
    },

    async disconnectGoogle() {
      const { error: e } = await supabase.rpc('rose_google_disconnect')
      if (e) return fail(e.message)
      setGoogle(EMPTY_GOOGLE)
      setGoogleCalendars([])
    },

    async toggleGoogleCalendar(id, enabled) {
      setGoogleCalendars((p) => p.map((c) => (c.id === id ? { ...c, enabled } : c)))
      await mutate({ table: 'rose_google_calendars', kind: 'update', patch: { enabled }, match: [eq('id', id)] })
    },

    async rsvpEvent(taskId, response) {
      const { error: e } = await supabase.functions.invoke('rose-google-sync', { body: { action: 'rsvp', taskId, response } })
      if (e) {
        try {
          const b = await (e as { context?: Response }).context?.json()
          if (b?.error) return String(b.error)
        } catch {
          /* sem corpo */
        }
        return e.message
      }
      setTasks((p) => p.map((x) => (x.id === taskId && x.google_meta ? { ...x, google_meta: { ...x.google_meta, attendees: x.google_meta.attendees.map((a) => (a.self ? { ...a, status: response } : a)) } } : x)))
      return null
    },

    async editRecurring(taskId, scope, start, end) {
      const { error: e } = await supabase.functions.invoke('rose-google-sync', { body: { action: 'recurring', taskId, scope, start, end } })
      if (e) {
        try {
          const b = await (e as { context?: Response }).context?.json()
          if (b?.error) return String(b.error)
        } catch {
          /* sem corpo */
        }
        return e.message
      }
      const { data: rows } = await loadTasks() // a série inteira mudou: recarrega as ocorrências
      if (rows) setTasks(rows)
      return null
    },

    async syncGoogle(manual = true) {
      if (!manual && !syncAvailable) return null
      const { error: e } = await supabase.functions.invoke('rose-google-sync', { body: { action: 'sync' } })
      if (e) {
        setSyncAvailable(false) // não repete a cada 5 min; o botão "Sincronizar" continua tentando
        // a função devolve {error: "..."}: mostra o motivo real em vez de "non-2xx"
        try {
          const body = await (e as { context?: Response }).context?.json()
          if (body?.error) return String(body.error)
        } catch {
          /* sem corpo legível */
        }
        return e.message
      }
      setSyncAvailable(true)
      await loadAll()
      return null
    },

    async addColumn(listId, name) {
      const col: Column = { id: crypto.randomUUID(), user_id: userId, list_id: listId, name, sort_order: Date.now() }
      setColumns((p) => [...p, col])
      await mutate({ table: 'rose_columns', kind: 'insert', row: col })
      return col
    },

    async renameColumn(id, name) {
      setColumns((p) => p.map((c) => (c.id === id ? { ...c, name } : c)))
      await mutate({ table: 'rose_columns', kind: 'update', patch: { name }, match: [eq('id', id)] })
    },

    async deleteColumn(id) {
      setColumns((p) => p.filter((c) => c.id !== id))
      setTasks((p) => p.map((t) => (t.column_id === id ? { ...t, column_id: null } : t)))
      await mutate({ table: 'rose_columns', kind: 'delete', match: [eq('id', id)] }) // tarefas voltam a "sem seção" (FK on delete set null)
    },

    async moveColumn(id, beforeId) {
      const moved = columns.find((c) => c.id === id)
      if (!moved) return
      const siblings = columns.filter((c) => c.list_id === moved.list_id && c.id !== id).sort((a, b) => a.sort_order - b.sort_order)
      const idx = beforeId ? siblings.findIndex((c) => c.id === beforeId) : siblings.length
      const prev = siblings[idx - 1]?.sort_order ?? (siblings[idx]?.sort_order ?? 0) - 2048
      const next = siblings[idx]?.sort_order ?? prev + 2048
      const order = Math.round((prev + next) / 2)
      setColumns((p) => p.map((c) => (c.id === id ? { ...c, sort_order: order } : c)))
      await mutate({ table: 'rose_columns', kind: 'update', patch: { sort_order: order }, match: [eq('id', id)] })
    },

    async addNote(color = 'yellow') {
      const offset = (notes.length % 6) * 28
      const note: StickyNote = { id: crypto.randomUUID(), user_id: userId, content: '', color, x: 80 + offset, y: 110 + offset, w: 260, h: 280, z: Date.now() % 100000000, is_open: true }
      setNotes((p) => [...p, note])
      await mutate({ table: 'rose_sticky_notes', kind: 'insert', row: note })
      return note
    },

    async updateNote(id, patch) {
      setNotes((p) => p.map((n) => (n.id === id ? { ...n, ...patch } : n)))
      await mutate({ table: 'rose_sticky_notes', kind: 'update', patch: patch as Record<string, unknown>, match: [eq('id', id)] })
    },

    async deleteNote(id) {
      setNotes((p) => p.filter((n) => n.id !== id))
      await mutate({ table: 'rose_sticky_notes', kind: 'delete', match: [eq('id', id)] })
    },

    async addSession(sess) {
      const row: FocusSession = { id: crypto.randomUUID(), user_id: userId, ...sess }
      setSessions((p) => [row, ...p])
      await mutate({ table: 'rose_focus_sessions', kind: 'insert', row })
    },

    async deleteSession(id) {
      setSessions((p) => p.filter((x) => x.id !== id))
      await mutate({ table: 'rose_focus_sessions', kind: 'delete', match: [eq('id', id)] })
    },

    async addHabit(h) {
      const habit: Habit = { id: crypto.randomUUID(), user_id: userId, emoji: null, color: null, kind: 'boolean', goal: 1, unit: null, days: [0, 1, 2, 3, 4, 5, 6], reminder_time: null, archived: false, sort_order: Date.now(), ...h }
      setHabits((p) => [...p, habit])
      await mutate({ table: 'rose_habits', kind: 'insert', row: habit })
      return habit
    },

    async updateHabit(id, patch) {
      setHabits((p) => p.map((x) => (x.id === id ? { ...x, ...patch } : x)))
      await mutate({ table: 'rose_habits', kind: 'update', patch: patch as Record<string, unknown>, match: [eq('id', id)] })
    },

    async deleteHabit(id) {
      setHabits((p) => p.filter((x) => x.id !== id))
      setHabitLogs((p) => p.filter((x) => x.habit_id !== id))
      await mutate({ table: 'rose_habits', kind: 'delete', match: [eq('id', id)] })
    },

    async setHabitValue(habitId, day, value) {
      // um registro por hábito/dia: remove o existente e, se value > 0, grava o novo
      setHabitLogs((p) => [...p.filter((x) => !(x.habit_id === habitId && x.day === day)), ...(value > 0 ? [{ id: 'tmp-' + habitId + day, user_id: userId, habit_id: habitId, day, value }] : [])])
      await mutate({ table: 'rose_habit_logs', kind: 'delete', match: [eq('habit_id', habitId), eq('day', day)] })
      if (value > 0) await mutate({ table: 'rose_habit_logs', kind: 'insert', row: { id: crypto.randomUUID(), user_id: userId, habit_id: habitId, day, value } })
    },

    async addCountdown(c) {
      const cd: Countdown = { id: crypto.randomUUID(), user_id: userId, emoji: null, color: null, repeat_yearly: false, pinned: false, note: null, ...c }
      setCountdowns((p) => [...p, cd])
      await mutate({ table: 'rose_countdowns', kind: 'insert', row: cd })
      return cd
    },

    async updateCountdown(id, patch) {
      setCountdowns((p) => p.map((x) => (x.id === id ? { ...x, ...patch } : x)))
      await mutate({ table: 'rose_countdowns', kind: 'update', patch: patch as Record<string, unknown>, match: [eq('id', id)] })
    },

    async deleteCountdown(id) {
      setCountdowns((p) => p.filter((x) => x.id !== id))
      await mutate({ table: 'rose_countdowns', kind: 'delete', match: [eq('id', id)] })
    },
  }

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}
