import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useData } from '../store/data'
import { addDays, dayDiff, startOfDay } from '../lib/dates'
import type { List, Task } from '../lib/types'

type Zoom = 'day' | 'week' | 'month'
const PX: Record<Zoom, number> = { day: 44, week: 18, month: 6 }
const LEFT = 240
const ROW = 34
const PRIORITY_COLOR: Record<number, string> = { 5: 'var(--p-high)', 3: 'var(--p-med)', 1: 'var(--p-low)', 0: 'var(--accent)' }

interface Props {
  list: List
  tasks: Task[]
  selectedId: string | null
  onSelect: (id: string | null) => void
}

interface Span {
  start: Date
  end: Date // inclusivo (dia final)
}

const spanOf = (t: Task): Span | null => {
  if (!t.due_at) return null
  const end = startOfDay(new Date(t.due_at))
  const start = startOfDay(new Date(t.start_at ?? t.due_at))
  return start <= end ? { start, end } : { start: end, end: start }
}

export function Timeline({ list, tasks, selectedId, onSelect }: Props) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language.slice(0, 2)
  const data = useData()
  const [zoom, setZoom] = useState<Zoom>('day')
  const [drag, setDrag] = useState<{ id: string; mode: 'move' | 'left' | 'right'; dd: number } | null>(null)
  const scroller = useRef<HTMLDivElement | null>(null)
  const startX = useRef(0)
  const px = PX[zoom]
  const today = startOfDay(new Date())

  const spans = useMemo(() => new Map(tasks.map((x) => [x.id, spanOf(x)])), [tasks])

  // intervalo visível: cobre as tarefas e sempre inclui hoje −14 … +90
  const [origin, total] = useMemo(() => {
    let lo = addDays(today, -14)
    let hi = addDays(today, 90)
    for (const s of spans.values()) {
      if (!s) continue
      if (s.start < lo) lo = addDays(s.start, -7)
      if (s.end > hi) hi = addDays(s.end, 14)
    }
    const days = Math.min(900, dayDiff(hi, lo) + 1)
    return [lo, days] as const
  }, [spans, today])

  const cols = data.columns.filter((c) => c.list_id === list.id).sort((a, b) => a.sort_order - b.sort_order)
  const sections = useMemo(() => {
    const byStart = (a: Task, b: Task) => (spans.get(a.id)?.start.getTime() ?? Infinity) - (spans.get(b.id)?.start.getTime() ?? Infinity) || a.sort_order - b.sort_order
    if (!cols.length) return [{ id: 'all', name: '', items: [...tasks].sort(byStart) }]
    const known = new Set(cols.map((c) => c.id))
    const out = cols.map((c) => ({ id: c.id, name: c.name, items: tasks.filter((x) => x.column_id === c.id).sort(byStart) }))
    const rest = tasks.filter((x) => !x.column_id || !known.has(x.column_id)).sort(byStart)
    return rest.length ? [{ id: 'none', name: t('kanban.noSection'), items: rest }, ...out] : out
  }, [tasks, cols, spans, t])

  const colorOf = (task: Task) => (task.priority ? PRIORITY_COLOR[task.priority] : list.color ?? PRIORITY_COLOR[0])
  const idx = (d: Date) => dayDiff(d, origin)

  // ---------- arrastar / redimensionar ----------
  const begin = (e: React.PointerEvent, id: string, mode: 'move' | 'left' | 'right') => {
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    startX.current = e.clientX
    setDrag({ id, mode, dd: 0 })
  }
  const move = (e: React.PointerEvent) => {
    if (!drag) return
    const dd = Math.round((e.clientX - startX.current) / px)
    if (dd !== drag.dd) setDrag({ ...drag, dd })
  }
  const end = async () => {
    const d = drag
    setDrag(null)
    if (!d || d.dd === 0) return
    const task = tasks.find((x) => x.id === d.id)
    const s = task && spans.get(task.id)
    if (!task || !s || !task.due_at) return
    const shift = (iso: string, n: number) => {
      const x = new Date(iso)
      x.setDate(x.getDate() + n)
      return x.toISOString()
    }
    const patch: Partial<Task> = {}
    if (d.mode === 'move') {
      patch.due_at = shift(task.due_at, d.dd)
      if (task.start_at) patch.start_at = shift(task.start_at, d.dd)
    } else if (d.mode === 'right') {
      const nd = shift(task.due_at, d.dd)
      if (startOfDay(new Date(nd)) < s.start) return
      patch.due_at = nd
    } else {
      const base = task.start_at ?? task.due_at
      const ns = shift(base, d.dd)
      if (startOfDay(new Date(ns)) > s.end) return
      patch.start_at = ns
    }
    await data.updateTask(task.id, patch)
  }

  const setDate = (task: Task, dayIndex: number) => {
    if (task.due_at) return
    void data.updateTask(task.id, { due_at: addDays(origin, dayIndex).toISOString(), all_day: true })
  }

  const scrollToday = () => {
    if (scroller.current) scroller.current.scrollLeft = Math.max(0, idx(today) * px - 120)
  }

  // ---------- cabeçalho ----------
  const months: { label: string; left: number; width: number }[] = []
  for (let i = 0; i < total; ) {
    const d = addDays(origin, i)
    const first = new Date(d.getFullYear(), d.getMonth() + 1, 1)
    const len = Math.min(total - i, dayDiff(first, d))
    months.push({ label: new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric' }).format(d), left: i * px, width: len * px })
    i += len
  }
  const days = Array.from({ length: total }, (_, i) => addDays(origin, i))
  const width = total * px

  return (
    <div className="timeline">
      <div className="tl-bar">
        <div className="tl-zoom">
          {(['day', 'week', 'month'] as const).map((z) => (
            <button key={z} className={zoom === z ? 'on' : ''} onClick={() => setZoom(z)}>{t(`timeline.${z}`)}</button>
          ))}
        </div>
        <button className="tl-today" onClick={scrollToday}>{t('calendar.today')}</button>
      </div>

      <div
        className="tl-scroll"
        ref={(el) => {
          scroller.current = el
          if (el && !el.dataset.init) {
            el.dataset.init = '1'
            el.scrollLeft = Math.max(0, idx(today) * px - 120)
          }
        }}
      >
        <div className="tl-inner" style={{ width: LEFT + width }}>
          <div className="tl-head">
            <div className="tl-corner">{t('timeline.tasks')}</div>
            <div className="tl-dates" style={{ width }}>
              <div className="tl-months">
                {months.map((m, i) => <span key={i} style={{ left: m.left, width: m.width }}>{m.width > 60 ? m.label : ''}</span>)}
              </div>
              {zoom !== 'month' && (
                <div className="tl-days">
                  {days.map((d, i) => {
                    const show = zoom === 'day' || d.getDay() === 1
                    return (
                      <span key={i} className={(dayDiff(d, today) === 0 ? 'today ' : '') + (d.getDay() % 6 === 0 && zoom === 'day' ? 'wk' : '')} style={{ left: i * px, width: px }}>
                        {show ? d.getDate() : ''}
                      </span>
                    )
                  })}
                </div>
              )}
            </div>
          </div>

          {sections.map((sec) => (
            <div key={sec.id}>
              {sec.name && <div className="tl-section"><div className="tl-left"><b>{sec.name}</b> <span>{sec.items.length}</span></div></div>}
              {sec.items.map((task) => {
                const s = spans.get(task.id)
                const live = drag?.id === task.id ? drag : null
                let a = s ? idx(s.start) : 0
                let b = s ? idx(s.end) : 0
                if (live && s) {
                  if (live.mode === 'move') { a += live.dd; b += live.dd }
                  else if (live.mode === 'left') a = Math.min(a + live.dd, b)
                  else b = Math.max(b + live.dd, a)
                }
                return (
                  <div key={task.id} className={'tl-row' + (task.id === selectedId ? ' sel' : '') + (task.status !== 0 ? ' done' : '')} style={{ height: ROW }}>
                    <div className="tl-left" onClick={() => onSelect(task.id)} title={task.title}>{task.title || t('task.untitled')}</div>
                    <div
                      className={'tl-track' + (zoom === 'day' ? ' grid' : '')}
                      style={{ width, backgroundSize: `${px}px 100%` }}
                      onClick={(e) => {
                        if (task.due_at) return
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                        setDate(task, Math.floor((e.clientX - rect.left) / px))
                      }}
                    >
                      {!s && <em className="tl-hint">{t('timeline.clickToSchedule')}</em>}
                      {s && (
                        <div
                          className="tl-bar-item"
                          style={{ left: a * px + 1, width: (b - a + 1) * px - 2, background: colorOf(task) }}
                          onPointerDown={(e) => begin(e, task.id, 'move')}
                          onPointerMove={move}
                          onPointerUp={() => void end()}
                          onClick={(e) => { e.stopPropagation(); onSelect(task.id) }}
                        >
                          <i className="h l" onPointerDown={(e) => begin(e, task.id, 'left')} onPointerMove={move} onPointerUp={() => void end()} />
                          <span>{(b - a + 1) * px > 70 ? task.title : ''}</span>
                          <i className="h r" onPointerDown={(e) => begin(e, task.id, 'right')} onPointerMove={move} onPointerUp={() => void end()} />
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ))}

          {idx(today) >= 0 && <div className="tl-now" style={{ left: LEFT + idx(today) * px + px / 2 }} />}
          {tasks.length === 0 && <p className="empty">{t('task.empty')}</p>}
        </div>
      </div>
    </div>
  )
}
