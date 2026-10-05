import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useData } from '../store/data'
import { addDays, hhmm, sameDay, startOfDay } from '../lib/dates'
import { isoWeek } from '../lib/format'
import type { Task } from '../lib/types'
import { Icon } from './Icon'
import { Popover } from './Popover'
import { openTaskMenu } from './TaskContextMenu'
import { NSelect } from './Select'
import { EventPopup, nameOf } from './EventPopup'

export type CalMode = 'year' | 'month' | 'week' | 'day' | 'agenda' | 'multiday' | 'multiweek'
const MODES: CalMode[] = ['year', 'month', 'week', 'day', 'agenda', 'multiday', 'multiweek']
const HOUR_H = 48
/** Cor do texto sobre um fundo hex: escuro em fundos claros (como o Google Calendar). */
const onColor = (hex: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return '#fff'
  const n = parseInt(m[1], 16)
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  return lum > 0.62 ? '#1f2328' : '#fff'
}
const PALETTE = ['#d62f45', '#4c8dff', '#2fb67c', '#f5a524', '#9b6bff', '#18a9c4', '#e86fb0', '#8d909c']

interface Props {
  selectedId: string | null
  onSelect: (id: string | null) => void
  onToggleSidebar?: () => void
  weekStart?: number
  showWeekNumbers?: boolean
}

interface Ev {
  task: Task
  start: Date
  end: Date
  allDay: boolean
}

const rangeOf = (task: Task): Ev | null => {
  if (!task.due_at) return null
  const due = new Date(task.due_at)
  const start = task.start_at ? new Date(task.start_at) : due
  const allDay = task.all_day
  const end = task.start_at ? due : allDay ? due : new Date(due.getTime() + (task.duration_minutes ?? 60) * 60000)
  return { task, start: start <= end ? start : end, end: start <= end ? end : start, allDay }
}

const overlapsDay = (ev: Ev, day: Date) => {
  const s = startOfDay(ev.start).getTime()
  const e = startOfDay(ev.end).getTime()
  const d = startOfDay(day).getTime()
  return d >= s && d <= e
}

export function Calendar({ selectedId, onSelect, onToggleSidebar, weekStart = 0, showWeekNumbers = false }: Props) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language.slice(0, 2)
  const data = useData()
  const [mode, setMode] = useState<CalMode>(() => {
    try {
      return (localStorage.getItem('rose.cal.mode') as CalMode) || 'month'
    } catch {
      return 'month'
    }
  })
  const [cursor, setCursor] = useState(startOfDay(new Date()))
  const [multiDays, setMultiDays] = useState(3)
  const [multiWeeks, setMultiWeeks] = useState(2)
  const [quick, setQuick] = useState<{ date: Date; x: number; y: number } | null>(null)
  const [draft, setDraft] = useState('')
  const [showDone, setShowDone] = useState(true)
  const today = startOfDay(new Date())
  const [hidden, setHidden] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('rose.cal.hidden') ?? '[]') as string[])
    } catch {
      return new Set()
    }
  })
  const [popup, setPopup] = useState<{ id: string; x: number; y: number } | null>(null)
  const openEvent = (e: React.MouseEvent, task: Task) => {
    e.stopPropagation()
    if (task.source === 'google') setPopup({ id: task.id, x: e.clientX + 8, y: e.clientY - 12 })
    else onSelect(task.id)
  }
  const [asideOpen, setAsideOpen] = useState(() => !window.matchMedia('(max-width: 820px)').matches)
  const [mini, setMini] = useState(new Date(cursor.getFullYear(), cursor.getMonth(), 1))
  useEffect(() => setMini(new Date(cursor.getFullYear(), cursor.getMonth(), 1)), [cursor])
  const keyOf = (task: Task) => (task.google_calendar_id ? 'g:' + task.google_calendar_id : 'l:' + (task.list_id ?? ''))
  const toggleHidden = (k: string) =>
    setHidden((prev) => {
      const n = new Set(prev)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      try {
        localStorage.setItem('rose.cal.hidden', JSON.stringify([...n]))
      } catch {
        /* sem storage */
      }
      return n
    })

  const changeMode = (m: CalMode) => {
    setMode(m)
    try {
      localStorage.setItem('rose.cal.mode', m)
    } catch {
      /* sem storage */
    }
  }

  const events = useMemo(() => {
    const out: Ev[] = []
    for (const task of data.tasks) {
      if (task.deleted_at || task.parent_id || task.kind === 'note') continue
      if (!showDone && task.status !== 0) continue
      if (hidden.has(keyOf(task))) continue
      const ev = rangeOf(task)
      if (ev) out.push(ev)
    }
    return out.sort((a, b) => a.start.getTime() - b.start.getTime())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.tasks, showDone, hidden])

  const hashColor = (key: string) => {
    let h = 0
    for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0
    return PALETTE[h % PALETTE.length]
  }
  const color = (task: Task) => {
    if (task.google_calendar_id) {
      const g = data.googleCalendars.find((c) => c.google_calendar_id === task.google_calendar_id)
      if (g?.background_color) return g.background_color
    }
    const list = data.lists.find((l) => l.id === task.list_id)
    if (list?.color) return list.color
    const key = list?.id ?? task.google_calendar_id ?? 'x'
    let h = 0
    for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0
    return PALETTE[h % PALETTE.length]
  }

  // ---------- navegação ----------
  const step = (dir: 1 | -1) => {
    const c = new Date(cursor)
    if (mode === 'year') c.setFullYear(c.getFullYear() + dir)
    else if (mode === 'month') c.setMonth(c.getMonth() + dir)
    else if (mode === 'week') c.setDate(c.getDate() + 7 * dir)
    else if (mode === 'day') c.setDate(c.getDate() + dir)
    else if (mode === 'agenda') c.setDate(c.getDate() + 14 * dir)
    else if (mode === 'multiday') c.setDate(c.getDate() + multiDays * dir)
    else c.setDate(c.getDate() + 7 * multiWeeks * dir)
    setCursor(c)
  }

  const weekFirst = (d: Date) => addDays(d, -((d.getDay() - weekStart + 7) % 7))
  const fmt = (o: Intl.DateTimeFormatOptions, d = cursor) => new Intl.DateTimeFormat(lang, o).format(d)
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

  const title = (() => {
    if (mode === 'year') return String(cursor.getFullYear())
    if (mode === 'month') return cap(fmt({ month: 'long', year: 'numeric' }))
    if (mode === 'day') return cap(fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))
    const first = mode === 'multiday' ? cursor : mode === 'agenda' ? cursor : weekFirst(cursor)
    const len = mode === 'week' ? 7 : mode === 'multiday' ? multiDays : mode === 'agenda' ? 14 : multiWeeks * 7
    const last = addDays(first, len - 1)
    return `${fmt({ day: 'numeric', month: 'short' }, first)} – ${fmt({ day: 'numeric', month: 'short', year: 'numeric' }, last)}`
  })()

  // ---------- criação / movimentação ----------
  const openQuick = (date: Date, e: React.MouseEvent) => {
    setDraft('')
    setQuick({ date, x: Math.min(e.clientX, window.innerWidth - 260), y: Math.min(e.clientY, window.innerHeight - 90) })
  }

  const createQuick = async () => {
    const v = draft.trim()
    const q = quick
    setQuick(null)
    if (!v || !q) return
    const hasTime = q.date.getHours() !== 0 || q.date.getMinutes() !== 0
    const task = await data.addTask({ title: v, list_id: data.inbox?.id ?? null, due_at: q.date.toISOString(), all_day: !hasTime })
    onSelect(task.id)
  }

  const moveTo = (id: string, target: Date, keepTime: boolean) => {
    const task = data.tasks.find((x) => x.id === id)
    if (!task?.due_at) return
    const old = new Date(task.due_at)
    const next = new Date(target)
    if (keepTime) next.setHours(old.getHours(), old.getMinutes(), 0, 0)
    const delta = next.getTime() - old.getTime()
    const patch: Partial<Task> = { due_at: next.toISOString() }
    if (task.start_at) patch.start_at = new Date(new Date(task.start_at).getTime() + delta).toISOString()
    void data.updateTask(id, patch)
  }

  const dragProps = (task: Task) => ({
    draggable: true,
    onDragStart: (e: React.DragEvent) => e.dataTransfer.setData('text/rose-task', task.id),
  })

  // ---------- peças ----------
  const chip = (ev: Ev, day: Date, compact = false) => {
    const task = ev.task
    const c = color(task)
    const startsHere = sameDay(ev.start, day)
    return (
      <div
        key={task.id + day.toISOString()}
        className={'cal-chip' + (task.status !== 0 ? ' done' : '') + (selectedId === task.id ? ' sel' : '') + (ev.allDay || compact || !sameDay(ev.start, ev.end) ? ' solid' : ' timed')}
        style={{ ['--c' as string]: c, ['--fg' as string]: onColor(c) }}
        onClick={(e) => openEvent(e, task)}
        onContextMenu={(e) => openTaskMenu(e, task.id)}
        {...dragProps(task)}
        title={task.title}
      >
        {!(ev.allDay || compact || !sameDay(ev.start, ev.end)) && <i className="cal-dot" />}
        {!ev.allDay && startsHere && !compact && <small className="cal-time">{hhmm(ev.start)}</small>}
        <span>{task.title || t('task.untitled')}</span>
      </div>
    )
  }

  const monthGrid = (first: Date, weeks: number) => {
    const cells = Array.from({ length: weeks * 7 }, (_, i) => addDays(first, i))
    return (
      <div className="cal-month" style={{ gridTemplateRows: `auto repeat(${weeks}, 1fr)` }}>
        {cells.slice(0, 7).map((d) => (
          <div key={'h' + d.getDay()} className="cal-wd">{fmt({ weekday: 'short' }, d)}</div>
        ))}
        {cells.map((d) => {
          const list = events.filter((ev) => overlapsDay(ev, d))
          const max = weeks > 3 ? 3 : 5
          return (
            <div
              key={d.toISOString()}
              className={'cal-cell' + (d.getMonth() !== cursor.getMonth() && mode === 'month' ? ' out' : '') + (sameDay(d, today) ? ' today' : '')}
              onClick={(e) => openQuick(new Date(d.getFullYear(), d.getMonth(), d.getDate()), e)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const id = e.dataTransfer.getData('text/rose-task')
                if (id) moveTo(id, d, true)
              }}
            >
              <b className="cal-daynum">{d.getDate() === 1 ? fmt({ day: 'numeric', month: 'short' }, d) : d.getDate()}{showWeekNumbers && d.getDay() === (weekStart % 7) && <em className="cal-wk" title="ISO">W{isoWeek(addDays(d, 3))}</em>}</b>
              {list.slice(0, max).map((ev) => chip(ev, d))}
              {list.length > max && (
                <button className="cal-more" onClick={(e) => { e.stopPropagation(); setCursor(d); changeMode('day') }}>+{list.length - max}</button>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  const gmt = (() => {
    const o = -new Date().getTimezoneOffset()
    const h = Math.floor(Math.abs(o) / 60)
    return `GMT${o < 0 ? '-' : '+'}${String(h).padStart(2, '0')}`
  })()
  const range = (a: Date, b: Date) => {
    const f = (d: Date) => (d.getMinutes() ? hhmm(d) : hhmm(d))
    return `${f(a)} – ${f(b)}`
  }

  const timeGrid = (days: Date[]) => {
    const hours = Array.from({ length: 24 }, (_, h) => h)
    return (
      <div className="cal-time">
        <div className="cal-time-head" style={{ gridTemplateColumns: `66px repeat(${days.length}, 1fr)` }}>
          <div className="cal-gmt">{gmt}</div>
          {days.map((d) => (
            <div key={d.toISOString()} className={'cal-th' + (sameDay(d, today) ? ' today' : '')}>
              <small>{fmt({ weekday: 'short' }, d)}</small>
              <b>{d.getDate()}</b>
            </div>
          ))}
          <div className="cal-allday-label">{t('calendar.allDay')}</div>
          {days.map((d) => (
            <div
              key={'ad' + d.toISOString()}
              className="cal-allday"
              onClick={(e) => openQuick(d, e)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                const id = e.dataTransfer.getData('text/rose-task')
                const task = data.tasks.find((x) => x.id === id)
                if (task) {
                  const dd = new Date(d)
                  void data.updateTask(id, { due_at: dd.toISOString(), start_at: null, all_day: true })
                }
              }}
            >
              {events.filter((ev) => (ev.allDay || !sameDay(ev.start, ev.end)) && overlapsDay(ev, d)).map((ev) => chip(ev, d, true))}
            </div>
          ))}
        </div>
        <div className="cal-time-body" ref={(el) => { if (el && !el.dataset.init) { el.dataset.init = "1"; el.scrollTop = 7 * HOUR_H } }}>
          <div className="cal-time-grid" style={{ gridTemplateColumns: `66px repeat(${days.length}, 1fr)`, height: 24 * HOUR_H }}>
            <div className="cal-hours">
              {hours.map((h) => <span key={h} style={{ top: h * HOUR_H }}>{h === 0 ? '' : h === 12 ? t('calendar.noon') : `${String(h).padStart(2, '0')}:00`}</span>)}
            </div>
            {days.map((d) => {
              const list = events.filter((ev) => !ev.allDay && sameDay(ev.start, ev.end) && sameDay(ev.start, d))
              return (
                <div
                  key={d.toISOString()}
                  className="cal-col"
                  onClick={(e) => {
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                    const mins = Math.floor(((e.clientY - rect.top) / HOUR_H) * 4) * 15
                    const dd = new Date(d)
                    dd.setHours(0, mins, 0, 0)
                    openQuick(dd, e)
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    const id = e.dataTransfer.getData('text/rose-task')
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                    const mins = Math.floor(((e.clientY - rect.top) / HOUR_H) * 4) * 15
                    const dd = new Date(d)
                    dd.setHours(0, mins, 0, 0)
                    const task = data.tasks.find((x) => x.id === id)
                    if (!task) return
                    const patch: Partial<Task> = { due_at: dd.toISOString(), all_day: false, start_at: null }
                    void data.updateTask(id, patch)
                  }}
                >
                  {hours.map((h) => <i key={h} className="cal-line" style={{ top: h * HOUR_H }} />)}
                  {sameDay(d, today) && <i className="cal-now" style={{ top: ((new Date().getHours() * 60 + new Date().getMinutes()) / 60) * HOUR_H }}><em>{hhmm(new Date())}</em></i>}
                  {layout(list).map(({ ev, col, cols }) => {
                    const top = ((ev.start.getHours() * 60 + ev.start.getMinutes()) / 60) * HOUR_H + 1
                    const durMin = (ev.end.getTime() - ev.start.getTime()) / 60000
                    const h = Math.max(22, (durMin / 60) * HOUR_H - 2)
                    const oneLine = durMin <= 30
                    const c = color(ev.task)
                    return (
                      <div
                        key={ev.task.id}
                        className={'cal-ev' + (ev.task.status !== 0 ? ' done' : '') + (selectedId === ev.task.id ? ' sel' : '')}
                        style={{ top, height: h, left: `calc((100% - 12px) * ${col / cols})`, width: `calc((100% - 12px) / ${cols} - 2px)`, ['--c' as string]: c, ['--fg' as string]: onColor(c) }}
                        onClick={(e) => openEvent(e, ev.task)}
                        onContextMenu={(e) => openTaskMenu(e, ev.task.id)}
                        {...dragProps(ev.task)}
                      >
                        {oneLine ? (
                          <b>{ev.task.title || t('task.untitled')}, <span>{hhmm(ev.start)}</span></b>
                        ) : (
                          <>
                            <b>{ev.task.title || t('task.untitled')}</b>
                            <small>{range(ev.start, ev.end)}</small>
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  const body = (() => {
    if (mode === 'month') {
      const first = weekFirst(new Date(cursor.getFullYear(), cursor.getMonth(), 1))
      const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0)
      const weeks = Math.ceil((last.getTime() - first.getTime()) / 86400000 / 7 + 0.01)
      return monthGrid(first, Math.max(5, Math.min(6, weeks)))
    }
    if (mode === 'multiweek') return monthGrid(weekFirst(cursor), multiWeeks)
    if (mode === 'week') return timeGrid(Array.from({ length: 7 }, (_, i) => addDays(weekFirst(cursor), i)))
    if (mode === 'day') return timeGrid([cursor])
    if (mode === 'multiday') return timeGrid(Array.from({ length: multiDays }, (_, i) => addDays(cursor, i)))
    if (mode === 'agenda') {
      const days = Array.from({ length: 14 }, (_, i) => addDays(cursor, i)).filter((d) => events.some((ev) => overlapsDay(ev, d)))
      if (!days.length) return <p className="empty">{t('calendar.emptyAgenda')}</p>
      return (
        <div className="cal-agenda">
          {days.map((d) => (
            <div key={d.toISOString()} className="cal-ag-day">
              <div className={'cal-ag-date' + (sameDay(d, today) ? ' today' : '')}><b>{d.getDate()}</b><small>{fmt({ weekday: 'short' }, d)}</small></div>
              <div className="cal-ag-list">
                {events.filter((ev) => overlapsDay(ev, d)).map((ev) => (
                  <div key={ev.task.id} className={'cal-ag-item' + (selectedId === ev.task.id ? ' sel' : '')} style={{ borderLeftColor: color(ev.task) }} onClick={(e) => openEvent(e, ev.task)}>
                    <small>{ev.allDay ? t('calendar.allDay') : `${hhmm(ev.start)} - ${hhmm(ev.end)}`}</small>
                    <b>{ev.task.title || t('task.untitled')}</b>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )
    }
    // ano
    return (
      <div className="cal-year">
        {Array.from({ length: 12 }, (_, m) => {
          const first = new Date(cursor.getFullYear(), m, 1)
          const gridFirst = weekFirst(first)
          return (
            <div key={m} className="cal-mini">
              <button className="cal-mini-title" onClick={() => { setCursor(first); changeMode('month') }}>{cap(fmt({ month: 'long' }, first))}</button>
              <div className="cal-mini-grid">
                {Array.from({ length: 42 }, (_, i) => addDays(gridFirst, i)).map((d) => {
                  const inMonth = d.getMonth() === m
                  const has = inMonth && events.some((ev) => overlapsDay(ev, d))
                  return (
                    <button key={d.toISOString()} className={(inMonth ? '' : 'out ') + (sameDay(d, today) ? 'today ' : '') + (has ? 'has' : '')} onClick={() => { setCursor(d); changeMode('day') }}>
                      {inMonth ? d.getDate() : ''}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    )
  })()

  return (
    <section className="calendar gcal">
      {asideOpen && (
        <aside className="cal-aside">
          <button className="cal-create" onClick={(e) => openQuick(new Date(today.getFullYear(), today.getMonth(), today.getDate()), e)}>
            <Icon name="plus" size={20} /> {t('calendar.create')}
          </button>

          <div className="mini">
            <div className="mini-head">
              <b>{cap(fmt({ month: 'long', year: 'numeric' }, mini))}</b>
              <button className="icon-btn round" onClick={() => setMini(new Date(mini.getFullYear(), mini.getMonth() - 1, 1))} aria-label="‹"><Icon name="left" size={14} /></button>
              <button className="icon-btn round" onClick={() => setMini(new Date(mini.getFullYear(), mini.getMonth() + 1, 1))} aria-label="›"><Icon name="right" size={14} /></button>
            </div>
            <div className="mini-grid">
              {Array.from({ length: 7 }, (_, i) => addDays(weekFirst(mini), i)).map((d) => <i key={'w' + d.getDay()}>{fmt({ weekday: 'narrow' }, d).toUpperCase()}</i>)}
              {Array.from({ length: 42 }, (_, i) => addDays(weekFirst(mini), i)).map((d) => (
                <button
                  key={d.toISOString()}
                  className={(d.getMonth() !== mini.getMonth() ? 'out ' : '') + (sameDay(d, today) ? 'today ' : '') + (sameDay(d, cursor) && !sameDay(d, today) ? 'cur' : '')}
                  onClick={() => setCursor(startOfDay(d))}
                >
                  {d.getDate()}
                </button>
              ))}
            </div>
          </div>

          <div className="cal-cals">
            <h4>{t('calendar.myCals')}</h4>
            {data.lists.filter((l) => !l.archived).map((l) => {
              const k = 'l:' + l.id
              const c = l.color ?? hashColor(l.id)
              return (
                <label key={k} className="cal-chk" style={{ ['--c' as string]: c }}>
                  <input type="checkbox" checked={!hidden.has(k)} onChange={() => toggleHidden(k)} />
                  <i />
                  <span>{l.is_inbox ? t('nav.inbox') : l.name}</span>
                </label>
              )
            })}
            {[
              { title: t('calendar.google'), items: data.googleCalendars.filter((g) => g.access_role === 'owner') },
              { title: t('calendar.other'), items: data.googleCalendars.filter((g) => g.access_role !== 'owner') },
            ].map((grp) =>
              grp.items.length ? (
                <div key={grp.title}>
                  <h4>{grp.title}</h4>
                  {grp.items.map((g) => {
                    const k = 'g:' + g.google_calendar_id
                    return (
                      <label key={k} className="cal-chk" style={{ ['--c' as string]: g.background_color ?? 'var(--accent)' }}>
                        <input
                          type="checkbox"
                          checked={g.enabled && !hidden.has(k)}
                          onChange={async () => {
                            if (!g.enabled) {
                              await data.toggleGoogleCalendar(g.id, true)
                              if (hidden.has(k)) toggleHidden(k)
                              void data.syncGoogle(true)
                            } else toggleHidden(k)
                          }}
                        />
                        <i />
                        <span title={g.name ?? ''}>{g.name?.includes('@') ? nameOf(null, g.name) : g.name}</span>
                      </label>
                    )
                  })}
                </div>
              ) : null,
            )}
          </div>
        </aside>
      )}

      <div className="cal-main">
      <header className="cal-head">
        <button className="icon-btn" onClick={() => setAsideOpen((o) => !o)} title={t('common.toggleSidebar')}><Icon name="sidebar" size={20} /></button>
        <button className="cal-today" onClick={() => setCursor(today)}>{t('calendar.today')}</button>
        <button className="icon-btn round" onClick={() => step(-1)} aria-label="‹"><Icon name="left" size={18} /></button>
        <button className="icon-btn round" onClick={() => step(1)} aria-label="›"><Icon name="right" size={18} /></button>
        <h2>{title}</h2>
        <div className="grow" />
        <NSelect value={mode} onChange={(e) => changeMode(e.target.value as CalMode)} className="cal-mode-sel">
          {MODES.map((m) => <option key={m} value={m}>{t(`calendar.mode.${m}`)}</option>)}
        </NSelect>
        <Popover
          align="right"
          trigger={(_o, toggle) => <button className="icon-btn" onClick={toggle} title={t('common.more')}><Icon name="more" size={18} /></button>}
        >
          {(close) => (
            <div className="menu wide">
              <button onClick={() => { setShowDone(!showDone); close() }}><Icon name="checkSquare" size={15} /> {t('view.showCompleted')} {showDone && <Icon name="check" size={14} />}</button>
              {mode === 'multiday' && (
                <label className="menu-select"><span>{t('calendar.days')}</span>
                  <NSelect value={multiDays} onChange={(e) => setMultiDays(Number(e.target.value))}>{[2, 3, 4, 5, 6].map((n) => <option key={n}>{n}</option>)}</NSelect>
                </label>
              )}
              {mode === 'multiweek' && (
                <label className="menu-select"><span>{t('calendar.weeks')}</span>
                  <NSelect value={multiWeeks} onChange={(e) => setMultiWeeks(Number(e.target.value))}>{[2, 3, 4, 5].map((n) => <option key={n}>{n}</option>)}</NSelect>
                </label>
              )}
              <button onClick={() => { close(); window.print() }}><Icon name="print" size={15} /> {t('detail.print')}</button>
            </div>
          )}
        </Popover>
      </header>

      <div className="cal-body">{body}</div>

      <div className="cal-modes">
        {MODES.map((m) => (
          <button key={m} className={mode === m ? 'on' : ''} onClick={() => changeMode(m)}>{t(`calendar.mode.${m}`)}</button>
        ))}
      </div>

      {quick && (
        <div className="cal-quick" style={{ left: quick.x, top: quick.y }} onMouseDown={(e) => e.stopPropagation()}>
          <small>{fmt({ weekday: 'short', day: 'numeric', month: 'short' }, quick.date)}{quick.date.getHours() || quick.date.getMinutes() ? ` · ${hhmm(quick.date)}` : ''}</small>
          <input
            autoFocus
            value={draft}
            placeholder={t('calendar.newPh')}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void createQuick()
              if (e.key === 'Escape') setQuick(null)
            }}
            onBlur={() => setTimeout(() => setQuick(null), 150)}
          />
        </div>
      )}
      </div>
      {popup && (() => {
        const task = data.tasks.find((x) => x.id === popup.id)
        return task ? <EventPopup task={task} color={color(task)} x={popup.x} y={popup.y} onClose={() => setPopup(null)} onEdit={() => onSelect(task.id)} /> : null
      })()}
    </section>
  )
}

/** Distribui eventos sobrepostos em colunas lado a lado. */
function layout(list: Ev[]) {
  const sorted = [...list].sort((a, b) => a.start.getTime() - b.start.getTime())
  const out: { ev: Ev; col: number; cols: number }[] = []
  let cluster: { ev: Ev; col: number }[] = []
  let clusterEnd = 0
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((c) => c.col + 1))
    cluster.forEach((c) => out.push({ ...c, cols }))
    cluster = []
  }
  for (const ev of sorted) {
    if (cluster.length && ev.start.getTime() >= clusterEnd) flush()
    const used = new Set(cluster.filter((c) => c.ev.end.getTime() > ev.start.getTime()).map((c) => c.col))
    let col = 0
    while (used.has(col)) col++
    cluster.push({ ev, col })
    clusterEnd = Math.max(clusterEnd, ev.end.getTime())
  }
  flush()
  return out
}
