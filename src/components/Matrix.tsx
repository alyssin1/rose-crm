import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useData } from '../store/data'
import { addDays, dayDiff, dueTone, formatDue, startOfDay } from '../lib/dates'
import { tagIdsOf } from '../lib/views'
import type { Priority, Task } from '../lib/types'
import { Icon } from './Icon'
import { Popover } from './Popover'

export interface MatrixRules {
  urgentDays: number // urgente = vence em até N dias (atrasadas incluídas)
  importantMin: 3 | 5 // importante = prioridade ≥ N (5 = só alta · 3 = média ou alta)
}
export const DEFAULT_MATRIX: MatrixRules = { urgentDays: 0, importantMin: 5 }

type Quad = 'do' | 'plan' | 'delegate' | 'drop'
const QUADS: { id: Quad; urgent: boolean; important: boolean; color: string }[] = [
  { id: 'do', urgent: true, important: true, color: 'var(--p-high)' },
  { id: 'plan', urgent: false, important: true, color: 'var(--p-med)' },
  { id: 'delegate', urgent: true, important: false, color: 'var(--p-low)' },
  { id: 'drop', urgent: false, important: false, color: 'var(--silver-500)' },
]

export const isUrgent = (t: Task, r: MatrixRules) => !!t.due_at && dayDiff(new Date(t.due_at), new Date()) <= r.urgentDays
export const isImportant = (t: Task, r: MatrixRules) => t.priority >= r.importantMin

interface Props {
  selectedId: string | null
  onSelect: (id: string | null) => void
  onToggleSidebar?: () => void
}

export function Matrix({ selectedId, onSelect, onToggleSidebar }: Props) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language.slice(0, 2)
  const data = useData()
  const rules: MatrixRules = { ...DEFAULT_MATRIX, ...((data.profile?.settings?.matrix as Partial<MatrixRules>) ?? {}) }
  const [listId, setListId] = useState('')
  const [tagId, setTagId] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [over, setOver] = useState<Quad | null>(null)
  const dragId = useRef<string | null>(null)

  const setRules = (patch: Partial<MatrixRules>) => data.updateProfile({ settings: { ...(data.profile?.settings ?? {}), matrix: { ...rules, ...patch } } })

  const pool = data.tasks.filter(
    (x) =>
      !x.deleted_at && !x.parent_id && x.kind !== 'note' && x.source !== 'google' && (showDone || x.status === 0) && (!listId || x.list_id === listId) && (!tagId || tagIdsOf(data, x.id).includes(tagId)),
  )
  const quadOf = (x: Task): Quad => {
    const u = isUrgent(x, rules)
    const i = isImportant(x, rules)
    return u && i ? 'do' : i ? 'plan' : u ? 'delegate' : 'drop'
  }

  /** O que mudar numa tarefa para ela passar a pertencer ao quadrante. */
  const patchFor = (x: Partial<Task>, q: (typeof QUADS)[number]): Partial<Task> => {
    const patch: Partial<Task> = {}
    const prio = x.priority ?? 0
    if (q.important && prio < rules.importantMin) patch.priority = rules.importantMin as Priority
    if (!q.important && prio >= rules.importantMin) patch.priority = 0
    const dueDiff = x.due_at ? dayDiff(new Date(x.due_at), new Date()) : null
    const urgentNow = dueDiff !== null && dueDiff <= rules.urgentDays
    if (q.urgent && !urgentNow) {
      patch.due_at = startOfDay(new Date()).toISOString()
      patch.all_day = true
    }
    if (!q.urgent && urgentNow) {
      patch.due_at = startOfDay(addDays(new Date(), rules.urgentDays + 1)).toISOString()
      patch.all_day = true
    }
    return patch
  }

  const drop = async (q: (typeof QUADS)[number]) => {
    const id = dragId.current
    dragId.current = null
    setOver(null)
    const task = data.tasks.find((x) => x.id === id)
    if (!task) return
    const patch = patchFor(task, q)
    if (Object.keys(patch).length) await data.updateTask(task.id, patch)
  }

  const add = async (q: (typeof QUADS)[number]) => {
    const title = (drafts[q.id] ?? '').trim()
    if (!title) return
    setDrafts((p) => ({ ...p, [q.id]: '' }))
    const base: Partial<Task> = { title, list_id: listId || data.inbox?.id || null }
    const task = await data.addTask({ ...patchFor({ priority: 0, due_at: null }, q), ...base, title })
    const tg = tagId
    if (tg) await data.setTaskTags(task.id, [tg])
  }

  return (
    <section className="matrix">
      <header className="tasks-head">
        {onToggleSidebar && <button className="icon-btn" onClick={onToggleSidebar} title={t('common.toggleSidebar')}><Icon name="sidebar" size={18} /></button>}
        <h2>{t('matrix.title')}</h2>
        <div className="grow" />
        <select value={listId} onChange={(e) => setListId(e.target.value)} aria-label={t('nav.lists')}>
          <option value="">{t('summary.allLists')}</option>
          {data.lists.map((l) => <option key={l.id} value={l.id}>{l.is_inbox ? t('nav.inbox') : l.name}</option>)}
        </select>
        {data.tags.length > 0 && (
          <select value={tagId} onChange={(e) => setTagId(e.target.value)} aria-label={t('nav.tags')}>
            <option value="">{t('matrix.allTags')}</option>
            {data.tags.map((g) => <option key={g.id} value={g.id}>#{g.name}</option>)}
          </select>
        )}
        <Popover
          align="right"
          trigger={(_o, toggle) => <button className="icon-btn" onClick={toggle} title={t('matrix.rules')}><Icon name="filter" size={16} /></button>}
        >
          {() => (
            <div className="menu wide">
              <div className="menu-title">{t('matrix.rules')}</div>
              <label className="menu-select">
                <span>{t('matrix.urgent')}</span>
                <select value={rules.urgentDays} onChange={(e) => void setRules({ urgentDays: Number(e.target.value) })}>
                  <option value={0}>{t('matrix.u0')}</option>
                  <option value={1}>{t('matrix.u1')}</option>
                  <option value={3}>{t('matrix.u3')}</option>
                  <option value={7}>{t('matrix.u7')}</option>
                </select>
              </label>
              <label className="menu-select">
                <span>{t('matrix.important')}</span>
                <select value={rules.importantMin} onChange={(e) => void setRules({ importantMin: Number(e.target.value) as 3 | 5 })}>
                  <option value={5}>{t('matrix.i5')}</option>
                  <option value={3}>{t('matrix.i3')}</option>
                </select>
              </label>
              <label className="menu-check"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> {t('view.showCompleted')}</label>
            </div>
          )}
        </Popover>
      </header>

      <div className="matrix-grid">
        <div className="mx-axis top-u">{t('matrix.urgentShort')}</div>
        <div className="mx-axis top-n">{t('matrix.notUrgentShort')}</div>
        <div className="mx-axis left-i">{t('matrix.importantShort')}</div>
        <div className="mx-axis left-n">{t('matrix.notImportantShort')}</div>

        {[QUADS[0], QUADS[1], QUADS[2], QUADS[3]].map((q) => {
          const items = pool.filter((x) => quadOf(x) === q.id).sort((a, b) => (a.due_at ?? '9').localeCompare(b.due_at ?? '9') || b.priority - a.priority || a.sort_order - b.sort_order)
          return (
            <div
              key={q.id}
              className={`mx-q q-${q.id}` + (over === q.id ? ' over' : '')}
              style={{ ['--q' as string]: q.color }}
              onDragOver={(e) => {
                e.preventDefault()
                setOver(q.id)
              }}
              onDragLeave={() => setOver((o) => (o === q.id ? null : o))}
              onDrop={(e) => {
                e.preventDefault()
                void drop(q)
              }}
            >
              <header>
                <b>{t(`matrix.q.${q.id}.name`)}</b>
                <small>{t(`matrix.q.${q.id}.desc`)}</small>
                <span>{items.length}</span>
              </header>
              <div className="mx-list">
                {items.map((x) => (
                  <div
                    key={x.id}
                    className={'mx-task' + (x.id === selectedId ? ' sel' : '') + (x.status !== 0 ? ' done' : '')}
                    draggable
                    onDragStart={() => (dragId.current = x.id)}
                    onClick={() => onSelect(x.id)}
                  >
                    <button
                      className={`check p${x.priority}` + (x.status === 1 ? ' on' : x.status === 2 ? ' wont' : '')}
                      onClick={(e) => {
                        e.stopPropagation()
                        void data.toggleDone(x)
                      }}
                      aria-label={t('task.complete')}
                    >
                      {x.status === 1 && <Icon name="check" size={11} />}
                    </button>
                    <span className="title">{x.title || t('task.untitled')}</span>
                    {x.due_at && <span className={'due ' + dueTone(x)}>{formatDue(x, lang, t)}</span>}
                  </div>
                ))}
              </div>
              <input
                value={drafts[q.id] ?? ''}
                placeholder={'+ ' + t('kanban.addTask')}
                onChange={(e) => setDrafts((p) => ({ ...p, [q.id]: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && void add(q)}
              />
            </div>
          )
        })}
      </div>
    </section>
  )
}
