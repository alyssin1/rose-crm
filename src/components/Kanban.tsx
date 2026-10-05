import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useData } from '../store/data'
import { addDays, dayDiff, dueTone, formatDue, startOfDay } from '../lib/dates'
import { tagIdsOf } from '../lib/views'
import type { List, Task } from '../lib/types'
import { Icon } from './Icon'
import { Popover } from './Popover'
import { confirmAsk, promptText } from './Dialogs'
import { openTaskMenu } from './TaskContextMenu'
import { NSelect } from './Select'

export type KanbanGroup = 'column' | 'date' | 'priority'

interface Bucket {
  id: string
  label: string
  column?: string // id da coluna (modo "seção")
  has: (t: Task) => boolean
  patch: () => Partial<Task> // o que mudar na tarefa quando ela cai neste balde
}

interface Props {
  list: List
  tasks: Task[]
  selectedId: string | null
  onSelect: (id: string | null) => void
}

const day = (n: number) => startOfDay(addDays(new Date(), n)).toISOString()

export function Kanban({ list, tasks, selectedId, onSelect }: Props) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language.slice(0, 2)
  const data = useData()
  const group = ((list.view_options.kanbanGroup as KanbanGroup) || 'column') as KanbanGroup
  const cols = data.columns.filter((c) => c.list_id === list.id).sort((a, b) => a.sort_order - b.sort_order)
  const colIds = new Set(cols.map((c) => c.id))
  const dragTask = useRef<string | null>(null)
  const dragCol = useRef<string | null>(null)
  const [overCard, setOverCard] = useState<string | null>(null)
  const [overBucket, setOverBucket] = useState<string | null>(null)
  const [addingCol, setAddingCol] = useState(false)
  const [colName, setColName] = useState('')
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  const buckets: Bucket[] = (() => {
    if (group === 'priority')
      return ([5, 3, 1, 0] as const).map((p) => ({ id: `p${p}`, label: t(`priority.${p}`), has: (x: Task) => x.priority === p, patch: () => ({ priority: p }) }))
    if (group === 'date') {
      const d = (x: Task) => (x.due_at ? dayDiff(new Date(x.due_at), new Date()) : null)
      return [
        { id: 'overdue', label: t('group.overdue'), has: (x) => d(x) !== null && d(x)! < 0, patch: () => ({ due_at: day(-1), all_day: true }) },
        { id: 'today', label: t('due.today'), has: (x) => d(x) === 0, patch: () => ({ due_at: day(0), all_day: true }) },
        { id: 'tomorrow', label: t('due.tomorrow'), has: (x) => d(x) === 1, patch: () => ({ due_at: day(1), all_day: true }) },
        { id: 'week', label: t('kanban.thisWeek'), has: (x) => d(x) !== null && d(x)! >= 2 && d(x)! <= 6, patch: () => ({ due_at: day(3), all_day: true }) },
        { id: 'later', label: t('kanban.later'), has: (x) => d(x) !== null && d(x)! > 6, patch: () => ({ due_at: day(7), all_day: true }) },
        { id: 'nodate', label: t('group.noDate'), has: (x) => d(x) === null, patch: () => ({ due_at: null, start_at: null }) },
      ]
    }
    const none: Bucket = { id: '__none', label: t('kanban.noSection'), has: (x) => !x.column_id || !colIds.has(x.column_id), patch: () => ({ column_id: null }) }
    return [none, ...cols.map((c) => ({ id: c.id, label: c.name, column: c.id, has: (x: Task) => x.column_id === c.id, patch: () => ({ column_id: c.id }) }))]
  })()

  // em "seção", a coluna "sem seção" só aparece se tiver tarefas ou se não houver colunas
  const visible = group === 'column' ? buckets.filter((b) => b.id !== '__none' || cols.length === 0 || tasks.some((x) => b.has(x))) : buckets

  const sorted = [...tasks].sort((a, b) => a.sort_order - b.sort_order)

  const dropOnBucket = async (b: Bucket, beforeId: string | null) => {
    const id = dragTask.current
    dragTask.current = null
    setOverCard(null)
    setOverBucket(null)
    if (!id) return
    const task = data.tasks.find((x) => x.id === id)
    if (task && !b.has(task)) await data.updateTask(id, b.patch())
    if (beforeId !== id) await data.reorderTasks(id, beforeId)
  }

  const addTo = async (b: Bucket) => {
    const title = (drafts[b.id] ?? '').trim()
    if (!title) return
    setDrafts((p) => ({ ...p, [b.id]: '' }))
    await data.addTask({ title, list_id: list.id, ...b.patch() })
  }

  const setGroup = (g: KanbanGroup) => data.updateList(list.id, { view_options: { ...list.view_options, kanbanGroup: g } })

  const createColumn = async () => {
    const n = colName.trim()
    setColName('')
    setAddingCol(false)
    if (n) await data.addColumn(list.id, n)
  }

  return (
    <div className="kanban">
      <div className="kanban-bar">
        <label>
          {t('kanban.groupBy')}
          <NSelect value={group} onChange={(e) => void setGroup(e.target.value as KanbanGroup)}>
            <option value="column">{t('kanban.g.column')}</option>
            <option value="date">{t('kanban.g.date')}</option>
            <option value="priority">{t('kanban.g.priority')}</option>
          </NSelect>
        </label>
      </div>

      <div className="kanban-board">
        {visible.map((b) => {
          const items = sorted.filter((x) => b.has(x))
          return (
            <section
              key={b.id}
              className={'kcol' + (overBucket === b.id ? ' over' : '')}
              onDragOver={(e) => {
                if (dragTask.current || dragCol.current) {
                  e.preventDefault()
                  if (dragTask.current) setOverBucket(b.id)
                }
              }}
              onDragLeave={() => setOverBucket((o) => (o === b.id ? null : o))}
              onDrop={(e) => {
                e.preventDefault()
                if (dragCol.current && b.column && dragCol.current !== b.column) {
                  void data.moveColumn(dragCol.current, b.column)
                  dragCol.current = null
                } else void dropOnBucket(b, null)
              }}
            >
              <header
                className="kcol-head"
                draggable={!!b.column}
                onDragStart={() => {
                  if (b.column) dragCol.current = b.column
                }}
                onDragEnd={() => (dragCol.current = null)}
              >
                <b>{b.label}</b>
                <span>{items.length}</span>
                <div className="grow" />
                {b.column && (
                  <Popover
                    align="right"
                    trigger={(_o, toggle) => <button className="icon-btn" onClick={toggle}><Icon name="more" size={15} /></button>}
                  >
                    {(close) => (
                      <div className="menu">
                        <button onClick={async () => { close(); const n = await promptText(t('kanban.renameColumn'), b.label); if (n?.trim()) void data.renameColumn(b.column!, n.trim()) }}>{t('list.rename')}</button>
                        <button className="danger" onClick={async () => { close(); if (await confirmAsk(t('kanban.confirmDeleteColumn', { name: b.label }))) void data.deleteColumn(b.column!) }}>{t('list.delete')}</button>
                      </div>
                    )}
                  </Popover>
                )}
              </header>

              <div className="kcol-body">
                {items.map((task) => (
                  <Card
                    key={task.id}
                    task={task}
                    lang={lang}
                    selected={task.id === selectedId}
                    over={overCard === task.id}
                    onSelect={onSelect}
                    onDragStart={() => (dragTask.current = task.id)}
                    onDragOverCard={() => dragTask.current && setOverCard(task.id)}
                    onDropCard={() => void dropOnBucket(b, task.id)}
                  />
                ))}
              </div>

              <input
                className="kcol-add"
                value={drafts[b.id] ?? ''}
                placeholder={'+ ' + t('kanban.addTask')}
                onChange={(e) => setDrafts((p) => ({ ...p, [b.id]: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && void addTo(b)}
              />
            </section>
          )
        })}

        {group === 'column' && (
          <div className="kcol add-col">
            {addingCol ? (
              <input
                autoFocus
                value={colName}
                placeholder={t('kanban.columnName')}
                onChange={(e) => setColName(e.target.value)}
                onBlur={createColumn}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void createColumn()
                  if (e.key === 'Escape') { setColName(''); setAddingCol(false) }
                }}
              />
            ) : (
              <button onClick={() => setAddingCol(true)}><Icon name="plus" size={14} /> {t('kanban.addColumn')}</button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Card({ task, lang, selected, over, onSelect, onDragStart, onDragOverCard, onDropCard }: {
  task: Task
  lang: string
  selected: boolean
  over: boolean
  onSelect: (id: string | null) => void
  onDragStart: () => void
  onDragOverCard: () => void
  onDropCard: () => void
}) {
  const { t } = useTranslation()
  const data = useData()
  const subs = data.tasks.filter((x) => x.parent_id === task.id && !x.deleted_at)
  const tagNames = tagIdsOf(data, task.id).map((id) => data.tags.find((x) => x.id === id)?.name).filter(Boolean) as string[]
  return (
    <article
      className={'kcard' + (selected ? ' sel' : '') + (task.status !== 0 ? ' done' : '') + (over ? ' drop-before' : '')}
      draggable
      onClick={() => onSelect(task.id)}
      onContextMenu={(e) => openTaskMenu(e, task.id)}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/rose-task', task.id)
        onDragStart()
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onDragOverCard()
      }}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onDropCard()
      }}
    >
      <div className="kcard-top">
        <button
          className={`check p${task.priority}` + (task.status === 1 ? ' on' : task.status === 2 ? ' wont' : '')}
          onClick={(e) => {
            e.stopPropagation()
            void data.toggleDone(task)
          }}
          aria-label={t('task.complete')}
        >
          {task.status === 1 && <Icon name="check" size={11} />}
          {task.status === 2 && <Icon name="x" size={11} />}
        </button>
        <span className="title">{task.title || t('task.untitled')}</span>
      </div>
      {(task.due_at || subs.length > 0 || tagNames.length > 0) && (
        <div className="kcard-meta">
          {task.due_at && <span className={'due ' + dueTone(task)}>{formatDue(task, lang, t)}</span>}
          {subs.length > 0 && <span>{subs.filter((x) => x.status !== 0).length}/{subs.length}</span>}
          {tagNames.map((n) => <span key={n} className="tag">#{n}</span>)}
        </div>
      )}
    </article>
  )
}
