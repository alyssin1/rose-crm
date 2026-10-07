import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useData } from '../store/data'
import { addDays, hhmm, sameDay, startOfDay } from '../lib/dates'
import { isoWeek } from '../lib/format'
import { shade } from '../lib/gcolors'
import type { Task } from '../lib/types'
import { Avatar, Icon } from './Icon'
import { Popover } from './Popover'
import { openTaskMenu } from './TaskContextMenu'
import { NSelect } from './Select'
import { EventPopup, nameOf } from './EventPopup'

export type CalMode = 'year' | 'month' | 'week' | 'day' | 'agenda' | 'multiday' | 'multiweek'
const MODES: CalMode[] = ['year', 'month', 'week', 'day', 'agenda', 'multiday', 'multiweek']
const HOUR_H = 48
const SNAP = 15 // minutos
const INDENT = 22 // recuo (px) de um evento que começa dentro de outro mais longo, como no Google
const LANE_H = 24 // altura de cada faixa na vista mensal
const PALETTE = ['#d62f45', '#4c8dff', '#2fb67c', '#f5a524', '#9b6bff', '#18a9c4', '#e86fb0', '#8d909c']

interface Props {
  selectedId: string | null
  onSelect: (id: string | null) => void
  onToggleSidebar?: () => void
  weekStart?: number
  showWeekNumbers?: boolean
  onSearch?: () => void
  onSettings?: () => void
  userName?: string
}

interface Ev {
  task: Task
  start: Date
  end: Date
  allDay: boolean
}

/** gesto em andamento na grade de horas */
interface Gesture {
  kind: 'move' | 'resize' | 'create'
  id?: string
  x0: number
  y0: number
  moved: boolean
  day: Date
  grab: number // minutos entre o início do evento e o ponto agarrado
  dur: number
  anchor: number
}
interface Preview {
  id?: string
  day: Date
  s: number // minutos desde 0h
  e: number
}

const rangeOf = (task: Task): Ev | null => {
  if (!task.due_at) return null
  const due = new Date(task.due_at)
  const start = task.start_at ? new Date(task.start_at) : due
  const allDay = task.all_day
  const end = task.start_at ? due : allDay ? due : new Date(due.getTime() + (task.duration_minutes ?? 60) * 60000)
  return { task, start: start <= end ? start : end, end: start <= end ? end : start, allDay }
}

/** último dia ocupado (um evento que termina 0h não ocupa o dia seguinte) */
const lastDay = (ev: Ev) => (ev.allDay || ev.end.getHours() || ev.end.getMinutes() || sameDay(ev.start, ev.end) ? startOfDay(ev.end) : addDays(startOfDay(ev.end), -1))
const overlapsDay = (ev: Ev, day: Date) => {
  const d = startOfDay(day).getTime()
  return d >= startOfDay(ev.start).getTime() && d <= lastDay(ev).getTime()
}
/** ocupa a faixa de "dia inteiro" (dia inteiro ou mais de um dia) */
const isBar = (ev: Ev) => ev.allDay || !sameDay(ev.start, lastDay(ev))
const minOf = (d: Date) => d.getHours() * 60 + d.getMinutes()
const atMin = (day: Date, m: number) => {
  const d = new Date(day)
  d.setHours(0, m, 0, 0)
  return d
}

/** minha resposta ao convite (só quando sou convidado, não organizador) */
const rsvpOf = (task: Task) => {
  const me = task.google_meta?.attendees?.find((a) => a.self)
  if (!me || me.organizer) return ''
  return me.status === 'needsAction' ? ' needs' : me.status === 'declined' ? ' declined' : me.status === 'tentative' ? ' maybe' : ''
}

export function Calendar({ selectedId, onSelect, onToggleSidebar, weekStart = 0, showWeekNumbers = false, onSearch, onSettings, userName = '' }: Props) {
  void onToggleSidebar
  const { t, i18n } = useTranslation()
  const lang = i18n.language.slice(0, 2)
  const data = useData()
  const phone = window.matchMedia('(max-width: 820px)').matches
  const modeKey = phone ? 'rose.cal.mode.m' : 'rose.cal.mode' // o celular guarda a própria visão (padrão Mês, como no app do Google)
  const [mode, setMode] = useState<CalMode>(() => {
    try {
      return (localStorage.getItem(modeKey) as CalMode) || 'month'
    } catch {
      return 'month'
    }
  })
  const [cursor, setCursor] = useState(startOfDay(new Date()))
  const [multiDays, setMultiDays] = useState(3)
  const [multiWeeks, setMultiWeeks] = useState(2)
  const [quick, setQuick] = useState<{ date: Date; end?: Date; x: number; y: number } | null>(null)
  const [draft, setDraft] = useState('')
  const [showDone, setShowDone] = useState(true)
  const [chips, setChips] = useState(true)
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(id)
  }, [])
  const today = startOfDay(now)
  const [hidden, setHidden] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem('rose.cal.hidden') ?? '[]') as string[])
    } catch {
      return new Set()
    }
  })
  const [popup, setPopup] = useState<{ id: string; x: number; y: number } | null>(null)
  const suppressClick = useRef(false)
  const openEvent = (e: React.MouseEvent, task: Task) => {
    e.stopPropagation()
    if (suppressClick.current) return
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
      localStorage.setItem(modeKey, m)
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
    return out.sort((a, b) => a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.tasks, showDone, hidden])

  const hashColor = (key: string) => {
    let h = 0
    for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0
    return PALETTE[h % PALETTE.length]
  }
  const owner = data.googleCalendars.find((g) => g.access_role === 'owner')?.google_calendar_id ?? ''
  const calOf = (task: Task) => (task.google_calendar_id ? data.googleCalendars.find((c) => c.google_calendar_id === task.google_calendar_id) : undefined)
  /** cor base (paleta da API ou da lista) */
  const baseColor = (task: Task) => {
    const g = calOf(task)
    if (g?.background_color) return g.background_color
    const list = data.lists.find((l) => l.id === task.list_id)
    return list?.color ?? hashColor(list?.id ?? task.google_calendar_id ?? 'x')
  }
  /** variáveis de cor como o Google exibe (claro/escuro) */
  const colorVars = (task: Task) => {
    const s = shade(baseColor(task), task.google_meta?.colorId)
    return { ['--c' as string]: s.light, ['--cd' as string]: s.dark }
  }
  const popupColor = (task: Task) => {
    const s = shade(baseColor(task), task.google_meta?.colorId)
    return document.documentElement.dataset.theme === 'light' ? s.light : s.dark
  }
  /** só dá para mover eventos do Rose ou de agendas do Google em que tenho escrita */
  const editable = (task: Task) => task.source !== 'google' || ['owner', 'writer'].includes(calOf(task)?.access_role ?? '')

  // ---------- navegação ----------
  const step = (dir: 1 | -1) => {
    const c = new Date(cursor)
    if (mode === 'year') c.setFullYear(c.getFullYear() + dir)
    else if (mode === 'month') c.setMonth(c.getMonth() + dir)
    else if (mode === 'week') c.setDate(c.getDate() + 7 * dir)
    else if (mode === 'day') c.setDate(c.getDate() + dir)
    else if (mode === 'agenda') c.setDate(c.getDate() + 30 * dir)
    else if (mode === 'multiday') c.setDate(c.getDate() + multiDays * dir)
    else c.setDate(c.getDate() + 7 * multiWeeks * dir)
    setCursor(c)
  }

  const weekFirst = (d: Date) => addDays(d, -((d.getDay() - weekStart + 7) % 7))
  const fmt = (o: Intl.DateTimeFormatOptions, d = cursor) => new Intl.DateTimeFormat(lang, o).format(d)
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

  const title = (() => {
    if (mode === 'year') return String(cursor.getFullYear())
    if (mode === 'month' || mode === 'agenda') return cap(fmt({ month: 'long', year: 'numeric' }))
    if (mode === 'day') return cap(fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))
    const first = mode === 'multiday' ? cursor : weekFirst(cursor)
    const len = mode === 'week' ? 7 : mode === 'multiday' ? multiDays : multiWeeks * 7
    const last = addDays(first, len - 1)
    if (first.getMonth() === last.getMonth()) return cap(fmt({ month: 'long', year: 'numeric' }, first))
    return `${cap(fmt({ month: 'short' }, first))} – ${fmt({ month: 'short', year: 'numeric' }, last)}`
  })()

  // ---------- criação / movimentação ----------
  const openQuick = (date: Date, e: { clientX: number; clientY: number }, end?: Date) => {
    setDraft('')
    setPopup(null)
    setQuick(phone
      ? { date, end, x: 8, y: Math.max(8, window.innerHeight - 330) }
      : { date, end, x: Math.max(8, Math.min(e.clientX + 12, window.innerWidth - 420)), y: Math.max(8, Math.min(e.clientY - 40, window.innerHeight - 220)) })
  }

  const createQuick = async (more = false) => {
    const v = draft.trim()
    const q = quick
    setQuick(null)
    if (!q || (!v && !more)) return
    const hasTime = !!q.end || q.date.getHours() !== 0 || q.date.getMinutes() !== 0
    const task = await data.addTask(
      q.end
        ? { title: v, list_id: data.inbox?.id ?? null, start_at: q.date.toISOString(), due_at: q.end.toISOString(), all_day: false }
        : { title: v, list_id: data.inbox?.id ?? null, due_at: q.date.toISOString(), all_day: !hasTime },
    )
    onSelect(task.id)
  }

  const moveTo = (id: string, target: Date, keepTime: boolean) => {
    const task = data.tasks.find((x) => x.id === id)
    if (!task?.due_at || !editable(task)) return
    const ev = rangeOf(task)!
    const next = new Date(target)
    if (keepTime) next.setHours(ev.start.getHours(), ev.start.getMinutes(), 0, 0)
    const delta = next.getTime() - ev.start.getTime()
    const patch: Partial<Task> = { due_at: new Date(new Date(task.due_at).getTime() + delta).toISOString() }
    if (task.start_at) patch.start_at = new Date(new Date(task.start_at).getTime() + delta).toISOString()
    void data.updateTask(id, patch)
  }

  const dragProps = (task: Task) =>
    editable(task)
      ? { draggable: true, onDragStart: (e: React.DragEvent) => e.dataTransfer.setData('text/rose-task', task.id) }
      : {}

  // ---------- gestos na grade de horas (mover, redimensionar, criar arrastando) ----------
  const gesture = useRef<Gesture | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const previewRef = useRef<Preview | null>(null)
  previewRef.current = preview

  const [recur, setRecur] = useState<{ task: Task; s: Date; e: Date; choice: 'this' | 'following' | 'all'; busy: boolean; err: string | null } | null>(null)
  const applyRecur = async () => {
    if (!recur) return
    const { task, s, e, choice } = recur
    if (choice === 'this') {
      void data.updateTask(task.id, { start_at: s.toISOString(), due_at: e.toISOString(), all_day: false })
      setRecur(null)
      setPreview(null)
      return
    }
    setRecur({ ...recur, busy: true, err: null })
    const err = await data.editRecurring(task.id, choice, s.toISOString(), e.toISOString())
    if (err) setRecur({ ...recur, busy: false, err })
    else {
      setRecur(null)
      setPreview(null)
    }
  }

  const pointAt = (x: number, y: number) => {
    const col = document.elementsFromPoint(x, y).find((el) => (el as HTMLElement).dataset?.day) as HTMLElement | undefined
    if (!col) return null
    const r = col.getBoundingClientRect()
    return { day: new Date(Number(col.dataset.day)), min: ((y - r.top) / HOUR_H) * 60 }
  }
  const snap = (m: number) => Math.round(m / SNAP) * SNAP

  const commit = (g: Gesture, p: Preview, x: number, y: number) => {
    if (g.kind === 'create') {
      openQuick(atMin(p.day, p.s), { clientX: x, clientY: y }, atMin(p.day, p.e))
      return
    }
    const task = data.tasks.find((k) => k.id === g.id)
    if (!task) return
    const s = atMin(p.day, p.s)
    const e = atMin(p.day, p.e)
    if (task.source === 'google' && task.google_meta?.recurrence?.length) {
      // série recorrente: pergunta o alcance, como o Google (o evento fica no lugar novo enquanto isso)
      setPreview(p)
      setRecur({ task, s, e, choice: 'this', busy: false, err: null })
      return
    }
    if (task.source !== 'google' && !task.start_at) {
      // tarefa do Rose: o prazo é o início e a duração fica em duration_minutes
      void data.updateTask(task.id, g.kind === 'resize' ? { duration_minutes: p.e - p.s } : { due_at: s.toISOString(), all_day: false })
    } else void data.updateTask(task.id, { start_at: s.toISOString(), due_at: e.toISOString(), all_day: false })
  }

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const g = gesture.current
      if (!g) return
      if (!g.moved && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < 5) return
      g.moved = true
      const pt = pointAt(e.clientX, e.clientY)
      if (!pt) return
      if (g.kind === 'move') {
        const s = Math.max(0, Math.min(1440 - g.dur, snap(pt.min - g.grab)))
        setPreview({ id: g.id, day: pt.day, s, e: s + g.dur })
      } else if (g.kind === 'resize') {
        const p = previewRef.current
        if (!p) return
        setPreview({ ...p, e: Math.max(p.s + SNAP, Math.min(1440, snap(pt.min))) })
      } else {
        const m = Math.max(0, Math.min(1440, snap(pt.min)))
        setPreview({ day: g.day, s: Math.min(g.anchor, m), e: Math.max(g.anchor + SNAP, m) })
      }
    }
    const up = (e: PointerEvent) => {
      const g = gesture.current
      gesture.current = null
      if (!g) return
      const p = previewRef.current
      setPreview(null)
      if (g.kind === 'create') {
        const s = g.anchor
        commit(g, g.moved && p ? p : { day: g.day, s, e: Math.min(1440, s + 60) }, e.clientX, e.clientY)
        return
      }
      if (g.moved) {
        suppressClick.current = true
        setTimeout(() => (suppressClick.current = false), 0)
        if (p) commit(g, p, e.clientX, e.clientY)
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.tasks])

  const startMove = (e: React.PointerEvent, ev: Ev, day: Date) => {
    if (e.button !== 0 || !editable(ev.task)) return
    e.stopPropagation()
    const pt = pointAt(e.clientX, e.clientY)
    const s = minOf(ev.start)
    gesture.current = { kind: 'move', id: ev.task.id, x0: e.clientX, y0: e.clientY, moved: false, day, grab: (pt?.min ?? s) - s, dur: Math.max(SNAP, (ev.end.getTime() - ev.start.getTime()) / 60000), anchor: 0 }
  }
  const startResize = (e: React.PointerEvent, ev: Ev, day: Date) => {
    if (e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const s = minOf(ev.start)
    gesture.current = { kind: 'resize', id: ev.task.id, x0: e.clientX, y0: e.clientY, moved: true, day, grab: 0, dur: 0, anchor: 0 }
    setPreview({ id: ev.task.id, day, s, e: s + (ev.end.getTime() - ev.start.getTime()) / 60000 })
  }
  const startCreate = (e: React.PointerEvent, day: Date) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('.cal-ev')) return
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const anchor = Math.floor((((e.clientY - r.top) / HOUR_H) * 60) / SNAP) * SNAP
    gesture.current = { kind: 'create', x0: e.clientX, y0: e.clientY, moved: false, day, grab: 0, dur: 0, anchor }
  }

  // ---------- peças ----------
  const label = (task: Task) => task.title || t('calendar.untitled')

  /** faixa (dia inteiro / vários dias) ou item com hora na vista mensal */
  const bar = (ev: Ev, key: string, style: React.CSSProperties, contStart = false, contEnd = false) => {
    const task = ev.task
    const solid = isBar(ev) || phone
    return (
      <div
        key={key}
        className={'cal-chip' + (task.status !== 0 ? ' done' : '') + (selectedId === task.id ? ' sel' : '') + (solid ? ' solid' : ' timed') + rsvpOf(task) + (contStart ? ' cont-s' : '') + (contEnd ? ' cont-e' : '')}
        style={{ ...colorVars(task), ...style }}
        onClick={(e) => openEvent(e, task)}
        onContextMenu={(e) => openTaskMenu(e, task.id)}
        {...dragProps(task)}
        title={label(task)}
      >
        {!solid && <i className="cal-dot" />}
        {!phone && !ev.allDay && (!solid || !contStart) && <small className="cal-time">{hhmm(ev.start)}</small>}
        <span>{label(task)}</span>
      </div>
    )
  }

  /** distribui faixas numa semana: cada evento ocupa colunas [a, b] na primeira linha livre */
  const weekLanes = (first: Date, len: number, list: Ev[]) => {
    const items = list
      .map((ev) => {
        const a = Math.max(0, Math.round((startOfDay(ev.start).getTime() - first.getTime()) / 86400000))
        const b = Math.min(len - 1, Math.round((lastDay(ev).getTime() - first.getTime()) / 86400000))
        return { ev, a, b, lane: 0, contS: startOfDay(ev.start) < first, contE: lastDay(ev) > addDays(first, len - 1) }
      })
      .filter((x) => x.b >= 0 && x.a <= len - 1)
      .sort((x, y) => Number(isBar(y.ev)) - Number(isBar(x.ev)) || x.a - y.a || y.b - y.a - (x.b - x.a) || x.ev.start.getTime() - y.ev.start.getTime())
    const used: boolean[][] = []
    for (const it of items) {
      let lane = 0
      while (Array.from({ length: it.b - it.a + 1 }, (_, i) => used[lane]?.[it.a + i]).some(Boolean)) lane++
      used[lane] ??= []
      for (let c = it.a; c <= it.b; c++) used[lane][c] = true
      it.lane = lane
    }
    return items
  }

  const monthRef = useRef<HTMLDivElement>(null)
  const [monthH, setMonthH] = useState(600)
  useLayoutEffect(() => {
    const el = monthRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setMonthH(el.clientHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [mode])

  const monthGrid = (first: Date, weeks: number) => {
    const rowH = (monthH - 32) / weeks
    const laneH = phone ? 15 : LANE_H
    const fit = Math.max(1, Math.floor((rowH - (phone ? 26 : 30)) / laneH)) // faixas que cabem abaixo do número do dia
    return (
      <div className="cal-month gm" ref={monthRef} style={{ gridTemplateRows: `32px repeat(${weeks}, 1fr)` }}>
        <div className="gm-head">
          {Array.from({ length: 7 }, (_, i) => addDays(first, i)).map((d) => (
            <div key={'h' + d.getDay()} className={'cal-wd' + (phone && d.getDay() === today.getDay() ? ' today' : '')}>{fmt({ weekday: phone ? 'narrow' : 'short' }, d)}</div>
          ))}
        </div>
        {Array.from({ length: weeks }, (_, w) => {
          const wf = addDays(first, w * 7)
          const days = Array.from({ length: 7 }, (_, i) => addDays(wf, i))
          const items = weekLanes(wf, 7, events.filter((ev) => days.some((d) => overlapsDay(ev, d))))
          const perCol = days.map((_, c) => items.filter((it) => it.a <= c && it.b >= c))
          const over = perCol.map((l) => l.length > fit)
          const limit = (c: number) => (over[c] ? fit - 1 : fit)
          return (
            <div key={w} className="gm-week" style={{ gridTemplateRows: `${phone ? 26 : 30}px repeat(${Math.max(fit, 1)}, ${laneH}px) 1fr` }}>
              {days.map((d, c) => (
                <div
                  key={'bg' + c}
                  className={'cal-cell' + (d.getMonth() !== cursor.getMonth() && mode === 'month' ? ' out' : '') + (sameDay(d, today) ? ' today' : '')}
                  style={{ gridColumn: c + 1, gridRow: '1 / -1' }}
                  onClick={(e) => openQuick(new Date(d.getFullYear(), d.getMonth(), d.getDate()), e)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    const id = e.dataTransfer.getData('text/rose-task')
                    if (id) moveTo(id, d, true)
                  }}
                >
                  <b className="cal-daynum" onClick={(e) => { e.stopPropagation(); setCursor(d); changeMode('day') }}>
                    {d.getDate() === 1 && !phone ? fmt({ day: 'numeric', month: 'short' }, d) : d.getDate()}
                    {showWeekNumbers && c === 0 && <em className="cal-wk" title="ISO">W{isoWeek(addDays(d, 3))}</em>}
                  </b>
                </div>
              ))}
              {items
                .filter((it) => Array.from({ length: it.b - it.a + 1 }, (_, i) => it.lane < limit(it.a + i)).every(Boolean))
                .map((it) => bar(it.ev, it.ev.task.id + w, { gridColumn: `${it.a + 1} / ${it.b + 2}`, gridRow: it.lane + 2 }, it.contS, it.contE))}
              {perCol.map((l, c) =>
                over[c] ? (
                  <button key={'m' + c} className="cal-more" style={{ gridColumn: c + 1, gridRow: fit + 1 }} onClick={(e) => { e.stopPropagation(); setCursor(days[c]); changeMode('day') }}>
                    {phone ? '•••' : t('calendar.more', { n: l.filter((it) => it.lane >= limit(c)).length + l.filter((it) => it.lane < limit(c) && Array.from({ length: it.b - it.a + 1 }, (_, i) => it.lane >= limit(it.a + i)).some(Boolean)).length })}
                  </button>
                ) : null,
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

  const timeGrid = (days: Date[]) => {
    const hours = Array.from({ length: 24 }, (_, h) => h)
    const bars = weekLanes(days[0], days.length, events.filter((ev) => isBar(ev) && days.some((d) => overlapsDay(ev, d))))
    const lanes = bars.reduce((m, b) => Math.max(m, b.lane + 1), 0)
    return (
      <div className="cal-time">
        <div className="cal-time-head" style={{ gridTemplateColumns: `66px repeat(${days.length}, 1fr)` }}>
          <div className="cal-gmt">{gmt}</div>
          {days.map((d) => (
            <div key={d.toISOString()} className={'cal-th' + (sameDay(d, today) ? ' today' : '')}>
              <small>{fmt({ weekday: 'short' }, d)}</small>
              <b onClick={() => { setCursor(d); changeMode('day') }}>{d.getDate()}</b>
            </div>
          ))}
          <div className="cal-allday-label" />
          <div className="cal-allrow" style={{ gridColumn: `2 / span ${days.length}`, gridTemplateColumns: `repeat(${days.length}, 1fr)`, gridTemplateRows: `repeat(${Math.max(1, lanes)}, ${LANE_H}px)` }}>
            {days.map((d, c) => (
              <div
                key={'ad' + c}
                className="cal-allday"
                style={{ gridColumn: c + 1, gridRow: '1 / -1' }}
                onClick={(e) => openQuick(d, e)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  const id = e.dataTransfer.getData('text/rose-task')
                  const task = data.tasks.find((x) => x.id === id)
                  if (task && editable(task)) void data.updateTask(id, { due_at: new Date(d).toISOString(), start_at: null, all_day: true })
                }}
              />
            ))}
            {bars.map((it) => bar(it.ev, it.ev.task.id, { gridColumn: `${it.a + 1} / ${it.b + 2}`, gridRow: it.lane + 1 }, it.contS, it.contE))}
          </div>
        </div>
        <div className="cal-time-body" ref={(el) => { if (el && !el.dataset.init) { el.dataset.init = '1'; el.scrollTop = 7 * HOUR_H } }}>
          <div className="cal-time-grid" style={{ gridTemplateColumns: `66px repeat(${days.length}, 1fr)`, height: 24 * HOUR_H }}>
            <div className="cal-hours">
              {hours.map((h) => <span key={h} style={{ top: h * HOUR_H }}>{h === 0 ? '' : h === 12 ? t('calendar.noon') : `${String(h).padStart(2, '0')}:00`}</span>)}
            </div>
            {days.map((d) => {
              let list = events.filter((ev) => !isBar(ev) && sameDay(ev.start, d))
              // pré-visualização do arraste: o evento acompanha o ponteiro (inclusive para outro dia)
              if (preview?.id) {
                const src = events.find((ev) => ev.task.id === preview.id)
                list = list.filter((ev) => ev.task.id !== preview.id)
                if (src && sameDay(preview.day, d)) list.push({ ...src, start: atMin(d, preview.s), end: atMin(d, preview.e) })
              }
              const ghost = (preview && !preview.id && sameDay(preview.day, d) && preview) || (quick?.end && sameDay(quick.date, d) ? { s: minOf(quick.date), e: minOf(quick.end) || 1440 } : null)
              return (
                <div key={d.toISOString()} className="cal-col" data-day={d.getTime()} onPointerDown={(e) => startCreate(e, d)}>
                  {hours.map((h) => <i key={h} className="cal-line" style={{ top: h * HOUR_H }} />)}
                  {sameDay(d, today) && <i className="cal-now" style={{ top: (minOf(now) / 60) * HOUR_H }}><em>{hhmm(now)}</em></i>}
                  {layout(list).map(({ ev, left, width, indent, z, ring }) => {
                    const top = (minOf(ev.start) / 60) * HOUR_H + 1
                    const durMin = (ev.end.getTime() - ev.start.getTime()) / 60000
                    const h = Math.max(20, (durMin / 60) * HOUR_H - 2)
                    const oneLine = durMin <= 30
                    const dragging = preview?.id === ev.task.id
                    return (
                      <div
                        key={ev.task.id}
                        className={'cal-ev' + (ev.task.status !== 0 ? ' done' : '') + (selectedId === ev.task.id ? ' sel' : '') + rsvpOf(ev.task) + (ring ? ' ring' : '') + (dragging ? ' dragging' : '') + (editable(ev.task) ? ' editable' : '')}
                        style={{
                          top,
                          height: h,
                          left: `calc(${indent}px + (100% - 12px - ${indent}px) * ${left})`,
                          width: `calc((100% - 12px - ${indent}px) * ${width})`,
                          zIndex: dragging ? 50 : z,
                          ...colorVars(ev.task),
                        }}
                        onPointerDown={(e) => startMove(e, ev, d)}
                        onClick={(e) => openEvent(e, ev.task)}
                        onContextMenu={(e) => openTaskMenu(e, ev.task.id)}
                      >
                        {oneLine ? (
                          <b>{label(ev.task)}, <span>{hhmm(ev.start)}</span></b>
                        ) : (
                          <>
                            <b>{label(ev.task)}</b>
                            <small>{hhmm(ev.start)} – {hhmm(ev.end)}</small>
                          </>
                        )}
                        {editable(ev.task) && <i className="cal-ev-rs" onPointerDown={(e) => startResize(e, ev, d)} />}
                      </div>
                    )
                  })}
                  {ghost && (
                    <div className="cal-ev ghost" style={{ top: (ghost.s / 60) * HOUR_H + 1, height: Math.max(20, ((ghost.e - ghost.s) / 60) * HOUR_H - 2), left: 0, width: 'calc(100% - 12px)', zIndex: 60 }}>
                      <b>{draft || t('calendar.untitled')}</b>
                      <small>{hhmm(atMin(d, ghost.s))} – {hhmm(atMin(d, ghost.e))}</small>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  const agenda = () => {
    const days = Array.from({ length: 30 }, (_, i) => addDays(cursor, i)).filter((d) => events.some((ev) => overlapsDay(ev, d)))
    if (!days.length) return <p className="empty">{t('calendar.emptyAgenda')}</p>
    return (
      <div className="cal-sched">
        {days.map((d) => {
          const list = events.filter((ev) => overlapsDay(ev, d)).sort((a, b) => Number(isBar(b)) - Number(isBar(a)) || a.start.getTime() - b.start.getTime())
          const isToday = sameDay(d, today)
          const nowIdx = isToday ? list.findIndex((ev) => !isBar(ev) && ev.start > now) : -1
          return (
            <div key={d.toISOString()} className={'cs-day' + (isToday ? ' today' : '')}>
              <button className="cs-date" onClick={() => { setCursor(d); changeMode('day') }}>
                <b>{d.getDate()}</b>
                <small>{fmt({ month: 'short' }, d).replace('.', '')}, {fmt({ weekday: 'short' }, d).replace('.', '')}</small>
              </button>
              <div className="cs-list">
                {list.map((ev, i) => (
                  <div key={ev.task.id}>
                    {i === nowIdx && <i className="cs-now" />}
                    <div className={'cs-item' + rsvpOf(ev.task) + (ev.task.status !== 0 ? ' done' : '') + (selectedId === ev.task.id ? ' sel' : '')} style={colorVars(ev.task)} onClick={(e) => openEvent(e, ev.task)} onContextMenu={(e) => openTaskMenu(e, ev.task.id)}>
                      <i className="cs-dot" />
                      <span className="cs-time">{isBar(ev) ? t('calendar.allDay') : ev.end.getTime() > ev.start.getTime() ? `${hhmm(ev.start)} – ${hhmm(ev.end)}` : hhmm(ev.start)}</span>
                      <b>{label(ev.task)}</b>
                      {ev.task.google_meta?.location && <small>{ev.task.google_meta.location}</small>}
                    </div>
                  </div>
                ))}
                {isToday && nowIdx === -1 && <i className="cs-now" />}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  const year = () => (
    <div className="cal-year gy">
      {Array.from({ length: 12 }, (_, m) => {
        const first = new Date(cursor.getFullYear(), m, 1)
        const gridFirst = weekFirst(first)
        return (
          <div key={m} className="cal-mini">
            <button className="cal-mini-title" onClick={() => { setCursor(first); changeMode('month') }}>{cap(fmt({ month: 'long' }, first))}</button>
            <div className="cal-mini-grid">
              {Array.from({ length: 7 }, (_, i) => addDays(gridFirst, i)).map((d, i) => <i key={'w' + i}>{fmt({ weekday: 'narrow' }, d).toUpperCase()}</i>)}
              {Array.from({ length: 42 }, (_, i) => addDays(gridFirst, i)).map((d) => (
                <button key={d.toISOString()} className={(d.getMonth() !== m ? 'out ' : '') + (sameDay(d, today) && d.getMonth() === m ? 'today' : '')} onClick={() => { setCursor(d); changeMode('day') }}>
                  {d.getDate()}
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )

  const body = (() => {
    if (mode === 'month') {
      const first = weekFirst(new Date(cursor.getFullYear(), cursor.getMonth(), 1))
      const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0)
      const weeks = Math.ceil((last.getTime() - first.getTime()) / 86400000 / 7 + 0.01)
      return monthGrid(first, phone ? 6 : Math.max(5, Math.min(6, weeks)))
    }
    if (mode === 'multiweek') return monthGrid(weekFirst(cursor), multiWeeks)
    if (mode === 'week') return timeGrid(Array.from({ length: 7 }, (_, i) => addDays(weekFirst(cursor), i)))
    if (mode === 'day') return timeGrid([cursor])
    if (mode === 'multiday') return timeGrid(Array.from({ length: multiDays }, (_, i) => addDays(cursor, i)))
    if (mode === 'agenda') return agenda()
    return year()
  })()

  return (
    <section className="calendar gcal">
      {asideOpen && (
        <aside className="cal-aside">
          {phone && (
            <>
              <div className="mcal-brand">Rose <span>{t('nav.calendar')}</span></div>
              <nav className="mcal-views">
                {([['agenda', 'vSchedule'], ['day', 'vDay'], ['multiday', 'v3day'], ['week', 'vWeek'], ['month', 'vMonth']] as const).map(([m, ic]) => (
                  <button key={m} className={mode === m ? 'on' : ''} onClick={() => { changeMode(m); if (m === 'multiday') setMultiDays(3); setAsideOpen(false) }}>
                    <Icon name={ic} size={24} />
                    <span>{m === 'multiday' ? t('calendar.threeDays') : t(`calendar.mode.${m}`)}</span>
                  </button>
                ))}
              </nav>
              {owner && (
                <div className="mcal-acct">
                  <b><Avatar url={data.profile?.avatar_url} name={userName || owner} /></b>
                  <span>{owner}</span>
                </div>
              )}
            </>
          )}
          {!phone && (<>
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
          </>)}

          <div className="cal-cals">
            <h4>{t('calendar.myCals')}</h4>
            {data.lists.filter((l) => !l.archived).map((l) => {
              const k = 'l:' + l.id
              const c = shade(l.color ?? hashColor(l.id)).dark
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
                    const s = shade(g.background_color ?? '#039be5')
                    return (
                      <label key={k} className="cal-chk" style={{ ['--c' as string]: s.light, ['--cd' as string]: s.dark }}>
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

      {asideOpen && <div className="cal-aside-back" onClick={() => setAsideOpen(false)} />}
      <div className="cal-main">
        {phone && (
          <>
            <header className="mcal-head">
              <button className="mcal-pill ham" onClick={() => setAsideOpen((o) => !o)} aria-label={t('common.toggleSidebar')}><Icon name="menu" size={24} /></button>
              <button className="mcal-title" onClick={() => setChips((c) => !c)}>
                {cap(fmt(cursor.getFullYear() === today.getFullYear() ? { month: 'long' } : { month: 'long', year: 'numeric' }))}
                <Icon name={chips ? 'up' : 'down'} size={18} />
              </button>
              <div className="grow" />
              <div className="mcal-pill">
                {onSearch && <button onClick={onSearch} aria-label={t('nav.search')}><Icon name="search" size={24} /></button>}
                <button onClick={() => setCursor(today)} aria-label={t('calendar.today')}><i className="mcal-todayic">{today.getDate()}</i></button>
              </div>
              {onSettings && <button className="mcal-avatar" onClick={onSettings} aria-label={t('settings.title')}><Avatar url={data.profile?.avatar_url} name={userName || owner || '?'} /></button>}
            </header>
            {chips && (
              <div className="mcal-chips" ref={(el) => { const on = el?.querySelector<HTMLElement>('.on'); if (el && on) el.scrollLeft = on.offsetLeft - 12 }}>
                {Array.from({ length: 25 }, (_, i) => new Date(cursor.getFullYear(), cursor.getMonth() - 6 + i, 1)).map((m, i) => (
                  <span key={m.toISOString()} className="mcal-chipwrap">
                    {m.getMonth() === 0 && i > 0 && <b className="mcal-year">{m.getFullYear()}</b>}
                    <button className={m.getMonth() === cursor.getMonth() && m.getFullYear() === cursor.getFullYear() ? 'on' : ''} onClick={() => setCursor(m)}>
                      {cap(fmt({ month: 'short' }, m).replace('.', ''))}
                    </button>
                  </span>
                ))}
              </div>
            )}
          </>
        )}
        {!phone && <header className="cal-head">
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
        </header>}

        <div className="cal-body">{body}</div>

        {phone ? (
          <button className="mcal-fab" aria-label={t('calendar.create')} onClick={(e) => openQuick(new Date(today.getFullYear(), today.getMonth(), today.getDate()), e)}><Icon name="plus" size={28} /></button>
        ) : (
          <div className="cal-modes">
            {MODES.map((m) => (
              <button key={m} className={mode === m ? 'on' : ''} onClick={() => changeMode(m)}>{t(`calendar.mode.${m}`)}</button>
            ))}
          </div>
        )}
      </div>

      {quick && (
        <>
          <div className="cq-scrim" onPointerDown={() => setQuick(null)} />
          <div className="cal-quick gq" style={{ left: quick.x, top: quick.y }} role="dialog">
            <div className="gq-bar"><button className="icon-btn round" onClick={() => setQuick(null)} aria-label="×"><Icon name="x" size={18} /></button></div>
            <input
              autoFocus
              className="gq-title"
              value={draft}
              placeholder={t('calendar.addTitle')}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void createQuick()
                if (e.key === 'Escape') setQuick(null)
              }}
            />
            <div className="gq-row">
              <Icon name="clock" size={18} />
              <span>
                {cap(fmt({ weekday: 'long', day: 'numeric', month: 'long' }, quick.date))}
                {quick.end ? ` · ${hhmm(quick.date)} – ${hhmm(quick.end)}` : quick.date.getHours() || quick.date.getMinutes() ? ` · ${hhmm(quick.date)}` : ''}
              </span>
            </div>
            <div className="gq-row">
              <Icon name="inbox" size={18} />
              <span>{t('nav.inbox')}</span>
            </div>
            <div className="gq-foot">
              <button className="gq-more" onClick={() => void createQuick(true)}>{t('calendar.moreOptions')}</button>
              <button className="gq-save" onClick={() => void createQuick()} disabled={!draft.trim()}>{t('calendar.save')}</button>
            </div>
          </div>
        </>
      )}
      {recur && (
        <div className="rec-scrim" onPointerDown={(e) => { if (e.target === e.currentTarget && !recur.busy) { setRecur(null); setPreview(null) } }}>
          <div className="rec-dlg" role="dialog" aria-modal="true" aria-labelledby="rec-title">
            <h3 id="rec-title">{t('calendar.recurTitle')}</h3>
            {(['this', 'following', 'all'] as const).map((c) => (
              <label key={c} className="rec-opt">
                <input type="radio" name="rec" checked={recur.choice === c} onChange={() => setRecur({ ...recur, choice: c })} disabled={recur.busy} />
                <i />
                <span>{t(`calendar.recur.${c}`)}</span>
              </label>
            ))}
            {recur.err && <p className="rec-err">{recur.err}</p>}
            <div className="rec-foot">
              <button className="gq-more" disabled={recur.busy} onClick={() => { setRecur(null); setPreview(null) }}>{t('common.cancel')}</button>
              <button className="gq-save" disabled={recur.busy} onClick={() => void applyRecur()}>{recur.busy ? '…' : 'OK'}</button>
            </div>
          </div>
        </div>
      )}
      {popup && (() => {
        const task = data.tasks.find((x) => x.id === popup.id)
        return task ? <EventPopup task={task} color={popupColor(task)} x={popup.x} y={popup.y} onClose={() => setPopup(null)} onEdit={() => onSelect(task.id)} /> : null
      })()}
    </section>
  )
}

/**
 * Sobreposição como no Google Calendar:
 * - eventos que começam juntos (até 45 min de diferença) dividem a largura em colunas que se sobrepõem
 *   (o primeiro ocupa 1,7× a sua fração e o seguinte começa na sua fração);
 * - um evento que começa depois, dentro de outro, entra recuado 22px por cima dele.
 */
function layout(list: Ev[]) {
  const sorted = [...list].sort((a, b) => a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime())
  interface Placed {
    ev: Ev
    group: number
    indent: number
    z: number
  }
  const placed: Placed[] = []
  const groups: { indent: number; start: number; members: Placed[] }[] = []
  const NEAR = 45 * 60000
  sorted.forEach((ev, i) => {
    const s = ev.start.getTime()
    const over = placed.filter((p) => p.ev.end.getTime() > s && p.ev.start.getTime() < ev.end.getTime())
    const near = over.filter((p) => s - groups[p.group].start < NEAR).sort((a, b) => b.indent - a.indent)[0]
    let p: Placed
    if (near) {
      p = { ev, group: near.group, indent: near.indent, z: i + 1 }
      groups[near.group].members.push(p)
    } else {
      const indent = over.length ? Math.max(...over.map((o) => o.indent)) + INDENT : 0
      p = { ev, group: groups.length, indent, z: i + 1 }
      groups.push({ indent, start: s, members: [p] })
    }
    placed.push(p)
  })
  return placed.map((p) => {
    const g = groups[p.group]
    const n = g.members.length
    const k = g.members.indexOf(p)
    const left = k / n
    const width = k === n - 1 ? 1 / n : Math.min(1 - left, 1.7 / n)
    const ring = n > 1 || p.indent > 0 || placed.some((o) => o !== p && o.ev.end > p.ev.start && o.ev.start < p.ev.end)
    return { ev: p.ev, left, width, indent: p.indent, z: p.z, ring }
  })
}
