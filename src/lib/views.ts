import { addDays, dayDiff, startOfDay } from './dates'
import type { FilterDef, List, Tag, Task, TaskTag, View, ViewOptions } from './types'

export interface Ctx {
  tasks: Task[]
  lists: List[]
  tags: Tag[]
  taskTags: TaskTag[]
  filters: FilterDef[]
  inbox?: List
}

const live = (t: Task) => !t.deleted_at
const open = (t: Task) => t.status === 0
const done = (t: Task) => t.status !== 0

export const tagIdsOf = (c: Ctx, taskId: string) => c.taskTags.filter((x) => x.task_id === taskId).map((x) => x.tag_id)

function matchesDate(t: Task, kind: NonNullable<FilterDef['rules']['date']>, now = new Date()) {
  if (kind === 'any') return true
  if (kind === 'nodate') return !t.due_at
  if (!t.due_at) return false
  const d = dayDiff(new Date(t.due_at), now)
  if (kind === 'overdue') return d < 0
  if (kind === 'today') return d <= 0 // hoje inclui atrasadas, como no TickTick
  return d <= 6 // next7
}

/** Tarefas visíveis numa visão. Subtarefas não aparecem na raiz da lista. */
export function selectTasks(view: View, c: Ctx, opts: ViewOptions): Task[] {
  const root = c.tasks.filter((t) => live(t) && !t.parent_id && t.source !== 'google')
  let out: Task[]
  switch (view.type) {
    case 'all':
      out = root.filter(opts.showCompleted ? () => true : open)
      break
    case 'today':
      out = root.filter((t) => open(t) && matchesDate(t, 'today'))
      break
    case 'next7':
      out = root.filter((t) => open(t) && matchesDate(t, 'next7'))
      break
    case 'inbox':
      out = root.filter((t) => t.list_id === c.inbox?.id && (opts.showCompleted || open(t)))
      break
    case 'list':
      out = root.filter((t) => t.list_id === view.id && (opts.showCompleted || open(t)))
      break
    case 'tag':
      out = root.filter((t) => tagIdsOf(c, t.id).includes(view.id) && (opts.showCompleted || open(t)))
      break
    case 'filter': {
      const r = c.filters.find((f) => f.id === view.id)?.rules ?? {}
      out = root.filter((t) => {
        if (r.listIds?.length && !r.listIds.includes(t.list_id ?? '')) return false
        if (r.tagIds?.length && !tagIdsOf(c, t.id).some((x) => r.tagIds!.includes(x))) return false
        if (r.priorities?.length && !r.priorities.includes(t.priority)) return false
        if (r.date && !matchesDate(t, r.date)) return false
        if (r.status === 'done') return done(t)
        if (r.status === 'all') return true
        return open(t)
      })
      break
    }
    case 'completed':
      out = root.filter(done).sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? ''))
      break
    case 'trash':
      out = c.tasks.filter((t) => t.deleted_at && !t.parent_id).sort((a, b) => (b.deleted_at ?? '').localeCompare(a.deleted_at ?? ''))
      break
    default:
      out = []
  }
  return out
}

export function countFor(view: View, c: Ctx): number {
  return selectTasks(view, c, { groupBy: 'none', orderBy: 'date', desc: false, showCompleted: false, showDetails: true }).length
}

export function sortTasks(list: Task[], opts: ViewOptions, c: Ctx): Task[] {
  const dir = opts.desc ? -1 : 1
  const key = (t: Task): string | number => {
    switch (opts.orderBy) {
      case 'title':
        return t.title.toLowerCase()
      case 'priority':
        return -t.priority
      case 'modified':
        return t.updated_at
      case 'created':
        return t.created_at
      case 'tag':
        return tagIdsOf(c, t.id).map((id) => c.tags.find((x) => x.id === id)?.name ?? '').sort()[0] ?? '~'
      default:
        return t.due_at ? new Date(t.due_at).getTime() : Number.MAX_SAFE_INTEGER
    }
  }
  return [...list].sort((a, b) => {
    const ka = key(a)
    const kb = key(b)
    const cmp = ka < kb ? -1 : ka > kb ? 1 : 0
    return cmp * dir || a.sort_order - b.sort_order
  })
}

export interface Group {
  id: string
  label: string
  date?: Date
  tasks: Task[]
}

/** Agrupa conforme a opção "Agrupar por". `label` já vem traduzido por quem chama. */
export function groupTasks(list: Task[], opts: ViewOptions, c: Ctx, label: (k: string, d?: Date) => string): Group[] {
  const pinned = list.filter((t) => t.pinned)
  const rest = list.filter((t) => !t.pinned)
  const groups: Group[] = []
  if (pinned.length) groups.push({ id: 'pinned', label: label('pinned'), tasks: pinned })
  const push = (id: string, lbl: string, t: Task, date?: Date) => {
    const g = groups.find((x) => x.id === id)
    if (g) g.tasks.push(t)
    else groups.push({ id, label: lbl, date, tasks: [t] })
  }
  if (opts.groupBy === 'none') {
    if (rest.length) groups.push({ id: 'all', label: '', tasks: rest })
  } else if (opts.groupBy === 'list') {
    for (const t of rest) push(t.list_id ?? 'none', c.lists.find((l) => l.id === t.list_id)?.name ?? label('noList'), t)
  } else if (opts.groupBy === 'priority') {
    for (const t of rest) push(`p${t.priority}`, label(`priority${t.priority}`), t)
  } else if (opts.groupBy === 'tag') {
    for (const t of rest) {
      const ids = tagIdsOf(c, t.id)
      if (!ids.length) push('notag', label('noTag'), t)
      for (const id of ids) push(id, '#' + (c.tags.find((x) => x.id === id)?.name ?? ''), t)
    }
  } else {
    const today = startOfDay(new Date())
    for (const t of rest) {
      if (!t.due_at) push('nodate', label('noDate'), t)
      else {
        const d = startOfDay(new Date(t.due_at))
        if (d < today) push('overdue', label('overdue'), t)
        else push(d.toISOString(), label('day', d), t, d)
      }
    }
    const order = (g: Group) => (g.id === 'pinned' ? -2 : g.id === 'overdue' ? -1 : g.id === 'nodate' ? 1e15 : g.date ? g.date.getTime() : 0)
    groups.sort((a, b) => (order(a) - order(b)) * (opts.desc && a.id !== 'pinned' && b.id !== 'pinned' ? -1 : 1))
  }
  return groups
}

export { addDays }
