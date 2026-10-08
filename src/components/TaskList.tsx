import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useData } from '../store/data'
import { dayDiff, dueTone, formatDue, startOfDay, weekdayName } from '../lib/dates'
import { parseQuickAdd } from '../lib/parse'
import { groupTasks, selectTasks, sortTasks, tagIdsOf, type Group } from '../lib/views'
import { ALL_COLS, DEFAULT_VIEW_OPTIONS, viewKey, type ColKey, type Tag, type Task, type View, type ViewOptions } from '../lib/types'
import { formatNumericDate } from '../lib/format'
import { Icon } from './Icon'
import { Popover } from './Popover'
import { Kanban } from './Kanban'
import { Timeline } from './Timeline'
import { confirmAsk } from './Dialogs'
import { openTaskMenu } from './TaskContextMenu'
import { NSelect } from './Select'
import { RowPeople } from './Social'
import { ListIcon } from './ListIcon'

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
  onToggleSidebar?: () => void
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
  const [over, setOver] = useState<Over | null>(null)
  const expanded = useExpanded()
  const drop = async (targetId: string, group: Group, how: DropMode) => {
    const id = dragId.current
    dragId.current = null
    setOver(null)
    if (!id || id === targetId) return
    const moved = data.tasks.find((x) => x.id === id)
    const target = data.tasks.find((x) => x.id === targetId)
    if (!moved || !target) return
    // não deixa uma tarefa virar filha de uma das suas próprias subtarefas
    for (let p: Task | undefined = target; p; p = data.tasks.find((x) => x.id === p!.parent_id)) if (p.id === id) return
    const parentId = how === 'child' ? target.id : target.parent_id
    const patch: Partial<Task> = {}
    if (parentId !== moved.parent_id) patch.parent_id = parentId
    if (how === 'child') expanded.open(target.id)
    // a regra do grupo (data/lista/prioridade) só vale quando a tarefa fica no nível de cima
    if (parentId) {
      /* subtarefa: herda só a posição */
    } else if (opts.groupBy === 'date' && group.date) {
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
    if (how === 'child') return data.reorderTasks(id, null, target.id) // vai para o fim das subtarefas
    const sibs = data.tasks.filter((x) => !x.deleted_at && x.parent_id === parentId && x.id !== id).sort((a, b) => a.sort_order - b.sort_order)
    const before = how === 'before' ? targetId : sibs[sibs.findIndex((x) => x.id === targetId) + 1]?.id ?? null
    await data.reorderTasks(id, before, parentId)
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
        {onToggleSidebar && <button className="icon-btn" onClick={onToggleSidebar} title={t('common.toggleSidebar')}><Icon name="sidebar" size={18} /></button>}
        <h2>{list?.emoji ? <><ListIcon emoji={list.emoji} color={list.color} size={20} />{' '}</> : null}{title}</h2>
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
                  {opts.showDetails && (
                    <>
                      <div className="menu-label">{t('view.fields')}</div>
                      {ALL_COLS.map((c) => (
                        <button key={c} onClick={() => setOpts({ cols: opts.cols.includes(c) ? opts.cols.filter((x) => x !== c) : ALL_COLS.filter((x) => x === c || opts.cols.includes(x)) })}>
                          <Icon name={COL_ICON[c]} size={15} /> {t(`view.col.${c}`)} {opts.cols.includes(c) && <Icon name="check" size={14} />}
                        </button>
                      ))}
                    </>
                  )}
                </>
              )}
              {view.type === 'trash' && total > 0 && (
                <button className="danger" onClick={async () => { close(); if (await confirmAsk(t('trash.confirmEmpty'))) void data.emptyTrash() }}>
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
        {total > 0 && opts.showDetails && view.type !== 'trash' && <ColsHeader cols={opts.cols} />}
        {total === 0 && <p className="empty">{view.type === 'trash' ? t('trash.empty0') : view.type === 'completed' ? t('task.emptyCompleted') : t('task.empty')}</p>}
        {groups.map((g) => (
          <GroupBlock key={g.id} g={g} view={view} opts={opts} selectedId={selectedId} onSelect={onSelect} dnd={{ dragId, over, setOver, drop, expanded }} />
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
      <NSelect value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </NSelect>
    </label>
  )
}

type DropMode = 'before' | 'after' | 'child'
interface Over {
  id: string
  how: DropMode
}
interface Dnd {
  dragId: React.MutableRefObject<string | null>
  over: Over | null
  setOver: (o: Over | null) => void
  drop: (targetId: string, group: Group, how: DropMode) => Promise<void>
  expanded: Expanded
}

interface Expanded {
  has: (id: string) => boolean
  toggle: (id: string) => void
  open: (id: string) => void
}
/** quais tarefas estão com as subtarefas abertas (recolhidas por padrão; lembrado neste aparelho) */
function useExpanded(): Expanded {
  const [set, setSet] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('rose.expanded') ?? '[]') as string[])
    } catch {
      return new Set()
    }
  })
  const save = (n: Set<string>) => {
    setSet(n)
    try {
      localStorage.setItem('rose.expanded', JSON.stringify([...n]))
    } catch {
      /* sem storage */
    }
  }
  return {
    has: (id) => set.has(id),
    toggle: (id) => {
      const n = new Set(set)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      save(n)
    },
    open: (id) => {
      if (!set.has(id)) save(new Set(set).add(id))
    },
  }
}

const INDENT = 24 // recuo de cada nível de subtarefa
const CHILD_DX = 30 // arrastar este tanto para a direita = virar subtarefa
let dragX0 = 0
let armed = false // o arraste só começa pela alça

function GroupBlock({ g, view, opts, selectedId, onSelect, dnd }: { g: Group; view: View; opts: ViewOptions; selectedId: string | null; onSelect: (id: string | null) => void; dnd: Dnd }) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <div className="group">
      {g.label && (
        <button className="group-head" onClick={() => setCollapsed(!collapsed)}>
          <Icon name={collapsed ? 'right' : 'down'} size={13} /> <b>{g.label}</b> <span>{g.tasks.length}</span>
        </button>
      )}
      {!collapsed && g.tasks.map((task) => <Row key={task.id} task={task} view={view} opts={opts} selected={task.id === selectedId} selectedId={selectedId} onSelect={onSelect} dnd={dnd} group={g} />)}
    </div>
  )
}

const COL_ICON: Record<ColKey, 'flag' | 'calendar' | 'tag' | 'list'> = { priority: 'flag', start: 'calendar', due: 'calendar', tags: 'tag', list: 'list' }

/** data numérica no formato escolhido nas configurações (ou o padrão do idioma) */
const dayStr = (iso: string, lang: string) => {
  const d = new Date(iso)
  return formatNumericDate(d) ?? new Intl.DateTimeFormat(lang, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d)
}
const fullDate = (iso: string, lang: string) => new Intl.DateTimeFormat(lang, { dateStyle: 'full', timeStyle: 'short' }).format(new Date(iso))

/** linha de títulos das colunas (acima dos grupos) */
function ColsHeader({ cols }: { cols: ColKey[] }) {
  const { t } = useTranslation()
  return (
    <div className="task-cols">
      <span className="name">{t('view.col.task')}</span>
      <span className="cells">
        {ALL_COLS.filter((c) => cols.includes(c)).map((c) => <span key={c} className={'cell ' + c}>{t(`view.col.${c}`)}</span>)}
      </span>
    </div>
  )
}

function Row({ task, view, opts, selected, onSelect, dnd, group, depth = 0, selectedId }: { task: Task; view: View; opts: ViewOptions; selected: boolean; onSelect: (id: string | null) => void; dnd: Dnd; group: Group; depth?: number; selectedId?: string | null }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language.slice(0, 2)
  const data = useData()
  const canDrag = view.type !== 'trash' && view.type !== 'completed'
  const kids = data.tasks.filter((x) => x.parent_id === task.id && !x.deleted_at && (opts.showCompleted || x.status === 0)).sort((a, b) => a.sort_order - b.sort_order)
  const open = kids.length > 0 && dnd.expanded.has(task.id)
  const how = dnd.over?.id === task.id ? dnd.over.how : null
  const tone = dueTone(task)
  const list = data.lists.find((l) => l.id === task.list_id)
  const tagObjs = tagIdsOf(data, task.id).map((id) => data.tags.find((x) => x.id === id)).filter(Boolean) as Tag[]
  const tagNames = tagObjs.map((x) => x.name)

  return (
    <>
    <div
      className={'task-row' + (selected ? ' selected' : '') + (task.status !== 0 ? ' done' : '') + (how ? ' drop-' + how : '')}
      style={depth ? { ['--depth' as string]: depth } : undefined}
      onClick={() => onSelect(task.id)}
      onContextMenu={(e) => openTaskMenu(e, task.id)}
      draggable={canDrag}
      onDragStart={(e) => {
        if (!armed) return e.preventDefault() // só a alça arrasta; o resto da linha abre o detalhe
        dnd.dragId.current = task.id
        dragX0 = e.clientX
        e.dataTransfer.setData('text/rose-task', task.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(e) => {
        if (!dnd.dragId.current || dnd.dragId.current === task.id) return
        e.preventDefault()
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
        const h: DropMode = e.clientX - dragX0 > CHILD_DX ? 'child' : e.clientY < r.top + r.height / 2 ? 'before' : 'after'
        if (dnd.over?.id !== task.id || dnd.over.how !== h) dnd.setOver({ id: task.id, how: h })
      }}
      onDragEnd={() => {
        armed = false
        dnd.setOver(null)
      }}
      onDrop={(e) => {
        e.preventDefault()
        void dnd.drop(task.id, group, how ?? 'before')
      }}
    >
      {canDrag && (
        <span className="grip" onPointerDown={() => (armed = true)} onPointerUp={() => (armed = false)} onClick={(e) => e.stopPropagation()} aria-hidden>
          <Icon name="grip" size={12} />
        </span>
      )}
      {kids.length > 0 ? (
        <button className={'sub-toggle' + (open ? ' open' : '')} onClick={(e) => { e.stopPropagation(); dnd.expanded.toggle(task.id) }} aria-label={t('detail.subtasks')} aria-expanded={open}>
          <Icon name="right" size={12} />
        </button>
      ) : null}
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
      {kids.length > 0 && (
        <button className="sub-count" onClick={(e) => { e.stopPropagation(); dnd.expanded.toggle(task.id) }} title={t('detail.subtasks')}>
          <Icon name="subtask" size={12} /> {data.tasks.filter((x) => x.parent_id === task.id && !x.deleted_at && x.status !== 0).length}/{data.tasks.filter((x) => x.parent_id === task.id && !x.deleted_at).length}
        </button>
      )}
      <RowPeople task={task} />
      {task.repeat_rule && <Icon name="repeat" size={12} className="repeat" />}
      {opts.showDetails && (
        <span className="cells">
          {opts.cols.includes('priority') && (
            <span className={`cell priority p${task.priority}`}>
              {task.priority > 0 ? <><Icon name="flag" size={13} /> {t(`priority.${task.priority}`)}</> : <span className="empty-cell">–</span>}
            </span>
          )}
          {opts.cols.includes('start') && <span className="cell start" title={task.start_at ? fullDate(task.start_at, lang) : undefined}>{task.start_at ? dayStr(task.start_at, lang) : <span className="empty-cell">–</span>}</span>}
          {opts.cols.includes('due') && (
            <span className={'cell due ' + tone} title={task.due_at ? formatDue(task, lang, t) : undefined}>{task.due_at ? dayStr(task.due_at, lang) : <span className="empty-cell">–</span>}</span>
          )}
          {opts.cols.includes('tags') && (
            <span className="cell tags" title={tagNames.map((n) => '#' + n).join(' ')}>
              {tagNames.length ? <>{tagObjs.slice(0, 2).map((tg) => <span key={tg.id} className="tag">{tg.color && <i className="tag-dot" style={{ background: tg.color }} />}#{tg.name}</span>)}{tagNames.length > 2 && <span className="tag more">+{tagNames.length - 2}</span>}</> : <span className="empty-cell">–</span>}
            </span>
          )}
          {opts.cols.includes('list') && (
            <span className="cell list" title={list ? (list.is_inbox ? t('nav.inbox') : list.name) : undefined}>
              {list ? <>{list.emoji ? <ListIcon emoji={list.emoji} color={list.color} size={14} /> : <i className="list-dot" style={{ background: list.color ?? 'var(--text-dim)' }} />} {list.is_inbox ? t('nav.inbox') : list.name}</> : <span className="empty-cell">–</span>}
            </span>
          )}
        </span>
      )}
      {view.type === 'trash' && (
        <span className="trash-actions" onClick={(e) => e.stopPropagation()}>
          <button onClick={() => data.restoreTask(task.id)}>{t('trash.restore')}</button>
          <button className="danger" onClick={() => data.purgeTask(task.id)}>{t('trash.purge')}</button>
        </span>
      )}
      <button className="row-more" onClick={(e) => { e.stopPropagation(); openTaskMenu(e, task.id) }} aria-label={t('common.more')}><Icon name="more" size={12} /></button>
    </div>
    {open && kids.map((k) => <Row key={k.id} task={k} view={view} opts={opts} selected={k.id === selectedId} selectedId={selectedId} onSelect={onSelect} dnd={dnd} group={group} depth={depth + 1} />)}
    </>
  )
}

/** Lista agrupada (por data) reutilizável fora da TaskList, usada nos quadrantes da Matriz. */
export function TaskGroups({ tasks, selectedId, onSelect }: { tasks: Task[]; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language.slice(0, 2)
  const data = useData()
  const dragId = useRef<string | null>(null)
  const [over, setOver] = useState<Over | null>(null)
  const expanded = useExpanded()
  const label = (k: string, d?: Date) => {
    if (k === 'day' && d) {
      const diff = dayDiff(d, new Date())
      const rest = diff === 0 ? t('due.today') : diff === 1 ? t('due.tomorrow') : new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' }).format(d)
      return `${weekdayName(d, lang)}, ${rest}`
    }
    return t(`group.${k}`)
  }
  const opts: ViewOptions = { ...DEFAULT_VIEW_OPTIONS, cols: ['priority', 'due'] } // quadrantes são estreitos: poucas colunas
  const groups = groupTasks(sortTasks(tasks, opts, data), opts, data, label)
  const view: View = { type: 'all' }
  const dnd: Dnd = { dragId, over, setOver, drop: async () => {}, expanded }
  return (
    <>
      {groups.map((g) => (
        <GroupBlock key={g.id} g={g} view={view} opts={opts} selectedId={selectedId} onSelect={onSelect} dnd={dnd} />
      ))}
    </>
  )
}
