import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useData } from '../store/data'
import { dayDiff, dueTone, formatDue, startOfDay, weekdayName } from '../lib/dates'
import { parseQuickAdd } from '../lib/parse'
import { groupTasks, selectTasks, sortTasks, tagIdsOf, type Group } from '../lib/views'
import { DEFAULT_VIEW_OPTIONS, viewKey, type Task, type View, type ViewOptions } from '../lib/types'
import { Icon } from './Icon'
import { Popover } from './Popover'
import { Kanban } from './Kanban'
import { Timeline } from './Timeline'

const loadOpts = (key: string): ViewOptions => {
  try {
    return { ...DEFAULT_VIEW_OPTIONS, ...JSON.parse(localStorage.getItem('rose.view.' + key) ?? '{}') }
  } catch {
    return DEFAULT_VIEW_OPTIONS
  }
}

interface Props {
  view: View
  selectedId: string | null
  onSelect: (id: string | null) => void
  onToggleSidebar: () => void
}

export function TaskList({ view, selectedId, onSelect, onToggleSidebar }: Props) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language.slice(0, 2)
  const data = useData()
  const key = viewKey(view)
  const [optsByKey, setOptsByKey] = useState<Record<string, ViewOptions>>({})
  const opts = optsByKey[key] ?? loadOpts(key)
  const setOpts = (patch: Partial<ViewOptions>) => {
    const next = { ...opts, ...patch }
    setOptsByKey((p) => ({ ...p, [key]: next }))
    try {
      localStorage.setItem('rose.view.' + key, JSON.stringify(next))
    } catch {
      /* sem storage */
    }
  }

  const list = data.lists.find((l) => 'id' in view && view.type === 'list' && l.id === view.id)
  const tag = data.tags.find((x) => 'id' in view && view.type === 'tag' && x.id === view.id)
  const filter = data.filters.find((x) => 'id' in view && view.type === 'filter' && x.id === view.id)
  const title =
    view.type === 'list' ? list?.name ?? '' : view.type === 'tag' ? '#' + (tag?.name ?? '') : view.type === 'filter' ? filter?.name ?? '' : t(`nav.${view.type}`)
  const target = view.type === 'list' ? list : data.inbox
  const targetName = target?.is_inbox ? t('nav.inbox') : target?.name ?? t('nav.inbox')
  const viewList = view.type === 'list' ? list : view.type === 'inbox' ? data.inbox : undefined
  const mode = viewList?.view_mode ?? 'list'

  const label = (k: string, d?: Date) => {
    if (k === 'day' && d) {
      const diff = dayDiff(d, new Date())
      const rest = diff === 0 ? t('due.today') : diff === 1 ? t('due.tomorrow') : new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' }).format(d)
      return `${weekdayName(d, lang)}, ${rest}`
    }
    if (k.startsWith('priority')) return t(`priority.${k.slice(8)}`)
    return t(`group.${k}`)
  }

  const groups: Group[] = useMemo(() => {
    const sel = selectTasks(view, data, opts)
    if (view.type === 'completed') {
      const g: Group[] = []
      for (const task of sel) {
        const d = startOfDay(new Date(task.completed_at ?? task.updated_at))
        const id = d.toISOString()
        const found = g.find((x) => x.id === id)
        if (found) found.tasks.push(task)
        else g.push({ id, label: label('day', d), date: d, tasks: [task] })
      }
      return g
    }
    if (view.type === 'trash') return sel.length ? [{ id: 'trash', label: '', tasks: sel }] : []
    const sorted = sortTasks(sel, opts, data)
    return groupTasks(sorted, view.type === 'today' ? { ...opts, groupBy: 'none' } : opts, data, label)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, data.tasks, data.lists, data.tags, data.taskTags, data.filters, opts, lang])

  const dragId = useRef<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const drop = async (targetId: string, group: Group) => {
    const id = dragId.current
    dragId.current = null
    setOverId(null)
    if (!id || id === targetId) return
    const moved = data.tasks.find((x) => x.id === id)
    if (!moved) return
    const patch: Partial<Task> = {}
    if (opts.groupBy === 'date' && group.date) {
      const d = new Date(group.date)
      if (moved.due_at && !moved.all_day) {
        const old = new Date(moved.due_at)
        d.setHours(old.getHours(), old.getMinutes())
      }
      if (!moved.due_at || startOfDay(new Date(moved.due_at)).getTime() !== startOfDay(d).getTime()) patch.due_at = d.toISOString()
    } else if (opts.groupBy === 'date' && group.id === 'nodate' && moved.due_at) {
      patch.due_at = null
      patch.start_at = null
    } else if (opts.groupBy === 'list' && group.id !== 'none' && group.id !== moved.list_id) patch.list_id = group.id
    else if (opts.groupBy === 'priority' && group.id.startsWith('p')) {
      const p = Number(group.id.slice(1)) as Task['priority']
      if (p !== moved.priority) patch.priority = p
    }
    if (Object.keys(patch).length) await data.updateTask(id, patch)
    await data.reorderTasks(id, targetId)
  }

  const total = groups.reduce((n, g) => n + g.tasks.length, 0)
  const [draft, setDraft] = useState('')
  const canAdd = !['completed', 'trash', 'summary', 'filter'].includes(view.type)

  const add = async () => {
    const q = parseQuickAdd(draft)
    if (!q.title) return
    setDraft('')
    const patch: Partial<Task> = { title: q.title, list_id: target?.id ?? data.inbox?.id ?? null }
    if (q.priority !== null) patch.priority = q.priority
    const due = q.due ?? (view.type === 'today' || view.type === 'next7' ? startOfDay(new Date()) : null)
    if (due) {
      patch.due_at = due.toISOString()
      patch.all_day = true
    }
    const tagIds = (await Promise.all(q.tagNames.map((n) => data.ensureTag(n)))).map((x) => x.id)
    if (view.type === 'tag' && tag && !tagIds.includes(tag.id)) tagIds.push(tag.id)
    await data.addTask({ ...patch, title: q.title }, tagIds)
  }

  return (
    <section className="tasks">
      <header className="tasks-head">
        <button className="icon-btn" onClick={onToggleSidebar} title={t('common.toggleSidebar')}><Icon name="sidebar" size={18} /></button>
        <h2>{list?.emoji ? `${list.emoji} ` : ''}{title}</h2>
        <div className="grow" />

        {!['completed', 'trash', 'summary'].includes(view.type) && mode === 'list' && (
          <Popover
            align="right"
            trigger={(_o, toggle) => <button className="icon-btn" onClick={toggle} title={t('sort.title')}><Icon name="sort" size={17} /></button>}
          >
            {() => (
              <div className="menu wide">
                <Select label={t('sort.groupBy')} value={opts.groupBy} onChange={(v) => setOpts({ groupBy: v as ViewOptions['groupBy'] })} options={['date', 'list', 'priority', 'tag', 'none'].map((v) => [v, t(`sort.g.${v}`)])} />
                <Select label={t('sort.orderBy')} value={opts.orderBy} onChange={(v) => setOpts({ orderBy: v as ViewOptions['orderBy'] })} options={['date', 'modified', 'created', 'title', 'tag', 'priority'].map((v) => [v, t(`sort.o.${v}`)])} />
                <Select label={t('sort.order')} value={opts.desc ? 'desc' : 'asc'} onChange={(v) => setOpts({ desc: v === 'desc' })} options={[['asc', t('sort.asc')], ['desc', t('sort.desc')]]} />
              </div>
            )}
          </Popover>
        )}

        <Popover
          align="right"
          trigger={(_o, toggle) => <button className="icon-btn" onClick={toggle} title={t('common.more')}><Icon name="more" size={17} /></button>}
        >
          {(close) => (
            <div className="menu">
              {!['completed', 'trash', 'summary'].includes(view.type) && (
                <>
                  <div className="menu-title">{t('view.title')}</div>
                  <div className="view-switch">
                    {(['list', 'kanban', 'timeline'] as const).map((m) => (
                      <button
                        key={m}
                        className={mode === m ? 'on' : ''}
                        disabled={!viewList}
                        title={t(`view.${m}`) + (viewList ? '' : ` — ${t('view.onlyLists')}`)}
                        onClick={() => { if (viewList) { void data.updateList(viewList.id, { view_mode: m }); close() } }}
                      >
                        <Icon name={m === 'list' ? 'list' : m} size={16} />
                      </button>
                    ))}
                  </div>
                  <button onClick={() => { setOpts({ showCompleted: !opts.showCompleted }); close() }}>
                    <Icon name="checkSquare" size={15} /> {t('view.showCompleted')} {opts.showCompleted && <Icon name="check" size={14} />}
                  </button>
                  <button onClick={() => { setOpts({ showDetails: !opts.showDetails }); close() }}>
                    <Icon name="list" size={15} /> {t('view.showDetails')} {opts.showDetails && <Icon name="check" size={14} />}
                  </button>
                </>
              )}
              {view.type === 'trash' && total > 0 && (
                <button className="danger" onClick={() => { close(); if (window.confirm(t('trash.confirmEmpty'))) void data.emptyTrash() }}>
                  <Icon name="trash" size={15} /> {t('trash.empty')}
                </button>
              )}
              {canAdd && data.templates.length > 0 && (
                <>
                  <div className="menu-title">{t('template.create')}</div>
                  {data.templates.map((tpl) => (
                    <div key={tpl.id} className="tpl-row">
                      <button onClick={async () => { close(); const task = await data.createFromTemplate(tpl, target?.id); onSelect(task.id) }}>{tpl.name}</button>
                      <button className="icon-btn" title={t('list.delete')} onClick={() => data.deleteTemplate(tpl.id)}><Icon name="x" size={12} /></button>
                    </div>
                  ))}
                </>
              )}
              <button onClick={() => { close(); window.print() }}><Icon name="print" size={15} /> {t('detail.print')}</button>
            </div>
          )}
        </Popover>
      </header>

      {viewList && mode === 'kanban' ? (
        <Kanban list={viewList} tasks={selectTasks(view, data, opts)} selectedId={selectedId} onSelect={onSelect} />
      ) : viewList && mode === 'timeline' ? (
        <Timeline list={viewList} tasks={selectTasks(view, data, opts)} selectedId={selectedId} onSelect={onSelect} />
      ) : (
        <>
      {canAdd && (
        <div className="add-task">
          <Icon name="plus" size={16} />
          <input
            value={draft}
            placeholder={t('task.addPlaceholder', { list: targetName })}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void add()}
          />
        </div>
      )}

      <div className="task-scroll">
        {total === 0 && <p className="empty">{view.type === 'trash' ? t('trash.empty0') : view.type === 'completed' ? t('task.emptyCompleted') : t('task.empty')}</p>}
        {groups.map((g) => (
          <GroupBlock key={g.id} g={g} view={view} opts={opts} selectedId={selectedId} onSelect={onSelect} dnd={{ dragId, overId, setOverId, drop }} />
        ))}
      </div>
        </>
      )}
    </section>
  )
}

function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[][] }) {
  return (
    <label className="menu-select">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  )
}

interface Dnd {
  dragId: React.MutableRefObject<string | null>
  overId: string | null
  setOverId: (id: string | null) => void
  drop: (targetId: string, group: Group) => Promise<void>
}

function GroupBlock({ g, view, opts, selectedId, onSelect, dnd }: { g: Group; view: View; opts: ViewOptions; selectedId: string | null; onSelect: (id: string | null) => void; dnd: Dnd }) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <div className="group">
      {g.label && (
        <button className="group-head" onClick={() => setCollapsed(!collapsed)}>
          <Icon name={collapsed ? 'right' : 'down'} size={13} /> <b>{g.label}</b> <span>{g.tasks.length}</span>
        </button>
      )}
      {!collapsed && g.tasks.map((task) => <Row key={task.id} task={task} view={view} opts={opts} selected={task.id === selectedId} onSelect={onSelect} dnd={dnd} group={g} />)}
    </div>
  )
}

function Row({ task, view, opts, selected, onSelect, dnd, group }: { task: Task; view: View; opts: ViewOptions; selected: boolean; onSelect: (id: string | null) => void; dnd: Dnd; group: Group }) {
  const { t, i18n } = useTranslation()
  const data = useData()
  const tone = dueTone(task)
  const list = data.lists.find((l) => l.id === task.list_id)
  const subs = data.tasks.filter((x) => x.parent_id === task.id && !x.deleted_at)
  const tagNames = tagIdsOf(data, task.id).map((id) => data.tags.find((x) => x.id === id)?.name).filter(Boolean) as string[]
  const showList = view.type !== 'list' && view.type !== 'inbox'

  return (
    <div
      className={'task-row' + (selected ? ' selected' : '') + (task.status !== 0 ? ' done' : '') + (dnd.overId === task.id ? ' drop-before' : '')}
      onClick={() => onSelect(task.id)}
      draggable={view.type !== 'trash' && view.type !== 'completed'}
      onDragStart={(e) => {
        dnd.dragId.current = task.id
        e.dataTransfer.setData('text/rose-task', task.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(e) => {
        if (!dnd.dragId.current) return
        e.preventDefault()
        if (dnd.overId !== task.id) dnd.setOverId(task.id)
      }}
      onDragEnd={() => dnd.setOverId(null)}
      onDrop={(e) => {
        e.preventDefault()
        void dnd.drop(task.id, group)
      }}
    >
      <button
        className={`check p${task.priority}` + (task.status === 1 ? ' on' : task.status === 2 ? ' wont' : '')}
        onClick={(e) => {
          e.stopPropagation()
          if (view.type !== 'trash') void data.toggleDone(task)
        }}
        aria-label={t('task.complete')}
      >
        {task.status === 1 && <Icon name="check" size={11} />}
        {task.status === 2 && <Icon name="x" size={11} />}
      </button>
      {task.pinned && <Icon name="pin" size={12} className="pin" />}
      <span className="title">{task.title || t('task.untitled')}</span>
      {opts.showDetails && (
        <span className="meta">
          {subs.length > 0 && <span className="subs">{subs.filter((x) => x.status !== 0).length}/{subs.length}</span>}
          {tagNames.map((n) => <span key={n} className="tag">#{n}</span>)}
          {showList && list && <span className="list-name">{list.emoji} {list.is_inbox ? t('nav.inbox') : list.name}</span>}
          {task.due_at && <span className={'due ' + tone}>{formatDue(task, i18n.language.slice(0, 2), t)}</span>}
          {task.repeat_rule && <Icon name="repeat" size={12} />}
        </span>
      )}
      {view.type === 'trash' && (
        <span className="trash-actions" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => data.restoreTask(task.id)}>{t('trash.restore')}</button>
          <button className="danger" onClick={() => data.purgeTask(task.id)}>{t('trash.purge')}</button>
        </span>
      )}
    </div>
  )
}
