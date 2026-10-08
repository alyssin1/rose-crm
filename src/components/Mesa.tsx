import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useData } from '../store/data'
import { addDays, dayDiff, hhmm, isoDay, startOfDay } from '../lib/dates'
import type { Task } from '../lib/types'
import { Icon } from './Icon'

/** Rascunho criado pela rotina diária do Meetily: aprovar = tirar o prefixo. */
const DRAFT = /^\[revisar\]\s*/i
const isDraft = (x: Task) => DRAFT.test(x.title)
const clean = (x: Task) => x.title.replace(DRAFT, '')

const mondayOf = (d: Date) => addDays(startOfDay(d), -((d.getDay() + 6) % 7))
/** De segunda a quinta a Mesa mostra a semana corrente; de sexta a domingo, a próxima. */
const targetMonday = (now: Date) => mondayOf([5, 6, 0].includes(now.getDay()) ? addDays(now, 3) : now)

type Filter = 'triage' | 'pending' | 'week' | 'all'

export function Mesa({ selectedId, onSelect, onToggleSidebar }: { selectedId: string | null; onSelect: (id: string) => void; onToggleSidebar?: () => void }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language.slice(0, 2)
  const data = useData()
  const [offset, setOffset] = useState(0)
  const [filter, setFilter] = useState<Filter>('triage')

  const today = startOfDay(new Date())
  const ini = useMemo(() => addDays(targetMonday(new Date()), offset * 7), [offset])
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(ini, i)), [ini])
  const fim = days[6]
  const inWeek = (d: Date | null) => !!d && dayDiff(d, ini) >= 0 && dayDiff(d, fim) <= 0
  const dueDay = (x: Task) => (x.due_at ? startOfDay(new Date(x.due_at)) : null)
  const weekKey = isoDay(ini) // identifica a semana mostrada
  const isPending = (x: Task) => x.week_in === weekKey // puxada com "Entra", esperando o dia

  const fmtDay = new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' })
  const fmtWd0 = new Intl.DateTimeFormat(lang, { weekday: 'short' })
  const fmtWd = { format: (d: Date) => { const s = fmtWd0.format(d); return s.charAt(0).toUpperCase() + s.slice(1) } }
  const fmtWdLong0 = new Intl.DateTimeFormat(lang, { weekday: 'long' })
  const fmtWdLong = { format: (d: Date) => { const s = fmtWdLong0.format(d); return s.charAt(0).toUpperCase() + s.slice(1) } }

  // tarefas que são minhas: sem eventos do Google, sem subtarefas, sem notas, só abertas
  const mine = useMemo(
    () => data.tasks.filter((x) => x.source !== 'google' && !x.deleted_at && !x.parent_id && x.status === 0 && x.kind !== 'note'),
    [data.tasks],
  )
  // eventos só da(s) agenda(s) do meu e-mail; agendas de outras pessoas (Allan, Bruno…) ficam de fora
  const events = useMemo(() => {
    const own = new Set(data.googleCalendars.filter((g) => g.access_role === 'owner').map((g) => g.google_calendar_id))
    return data.tasks.filter((x) => x.source === 'google' && !!x.google_calendar_id && own.has(x.google_calendar_id) && !x.deleted_at && x.status === 0 && (x.start_at ?? x.due_at))
  }, [data.tasks, data.googleCalendars])
  const evStart = (x: Task) => new Date((x.start_at ?? x.due_at) as string)

  const drafts = mine.filter(isDraft).length
  const undated = mine.filter((x) => !x.due_at).length
  const overdue = mine.filter((x) => { const d = dueDay(x); return !!d && dayDiff(d, today) < 0 }).length
  const pending = mine.filter(isPending).length

  const focus = mine.filter((x) => x.priority === 5 && inWeek(dueDay(x))).sort((a, b) => (a.due_at ?? '').localeCompare(b.due_at ?? ''))

  const shown = useMemo(() => {
    const keep = (x: Task) => {
      if (filter === 'all') return true
      if (filter === 'pending') return isPending(x)
      const d = dueDay(x)
      if (filter === 'week') return inWeek(d)
      return isDraft(x) || !d || dayDiff(d, today) < 0 // precisam de triagem
    }
    return mine.filter(keep)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine, filter, ini, weekKey])

  const groups = useMemo(() => {
    const m = new Map<string, Task[]>()
    for (const x of shown) {
      const k = x.list_id ?? 'none'
      m.set(k, [...(m.get(k) ?? []), x])
    }
    const name = (k: string) => data.lists.find((l) => l.id === k)?.name ?? t('mesa.noList')
    return [...m.entries()]
      .map(([k, v]) => ({ k, label: name(k), tasks: v.sort((a, b) => Number(isDraft(b)) - Number(isDraft(a)) || b.priority - a.priority || (a.due_at ?? '9').localeCompare(b.due_at ?? '9')) }))
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [shown, data.lists, t])

  // "Entra": puxa a tarefa para a semana; ela vai para a aba "Definir dia" até você escolher o dia
  const pull = (x: Task) => data.updateTask(x.id, { week_in: isPending(x) ? null : weekKey })
  const enter = (x: Task, d: Date) => data.updateTask(x.id, { title: clean(x), due_at: startOfDay(d).toISOString(), all_day: true, week_in: null })
  const out = (x: Task) => data.updateTask(x.id, { title: clean(x), due_at: null, week_in: null })
  const approve = (x: Task) => data.updateTask(x.id, { title: clean(x) })

  const dueText = (x: Task) => {
    const d = dueDay(x)
    if (isPending(x) && (!d || !inWeek(d))) return t('mesa.pending')
    if (!d) return t('mesa.undated')
    const diff = dayDiff(d, today)
    return diff < 0 ? `${t('mesa.overdue')} · ${fmtDay.format(d)}` : fmtDay.format(d)
  }

  const Row = ({ x }: { x: Task }) => {
    const rec = !!x.repeat_rule
    const d = dueDay(x)
    return (
      <div className={'ms-row' + (selectedId === x.id ? ' sel' : '')}>
        <div className="ms-line">
          <span className={'ms-pri p' + x.priority} />
          <button className="ms-title" onClick={() => onSelect(x.id)}>{clean(x)}</button>
          <span className={'ms-meta' + (d && dayDiff(d, today) < 0 ? ' late' : '')}>
            {isDraft(x) && <span className="ms-draft">{t('mesa.draft')}</span>}
            {dueText(x)}
          </span>
          <div className="ms-acts">
            {!rec && <button className={isPending(x) ? 'on' : ''} title={t('mesa.inHint')} onClick={() => void pull(x)}>{t('mesa.in')}</button>}
            {!rec && <button title={t('mesa.outHint')} onClick={() => void out(x)}>{t('mesa.out')}</button>}
            {isDraft(x) && <button title={t('mesa.approveHint')} onClick={() => void approve(x)}>{t('mesa.approve')}</button>}
            <button title={t('mesa.doneHint')} onClick={() => void data.toggleDone(x)}>{t('mesa.done')}</button>
            <button title={t('mesa.cancelHint')} onClick={() => void data.setWontDo(x)}>{t('mesa.cancel')}</button>
          </div>
        </div>
        {isPending(x) && (
          <div className="ms-days">
            {days.map((dd) => (
              <button key={dd.toISOString()} className={d && dayDiff(d, dd) === 0 ? 'on' : ''} onClick={() => void enter(x, dd)} title={fmtWdLong.format(dd)}>
                <small>{fmtWd.format(dd)}</small>
                <b>{dd.getDate()}</b>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  const weekLabel = t('mesa.week', { a: fmtDay.format(ini), b: fmtDay.format(fim) })
  const FILTERS: [Filter, string][] = [['triage', 'mesa.fTriage'], ['pending', 'mesa.fPending'], ['week', 'mesa.fWeek'], ['all', 'mesa.fAll']]

  return (
    <section className="mesa">
      <header className="tasks-head">
        {onToggleSidebar && <button className="icon-btn" onClick={onToggleSidebar} title={t('common.toggleSidebar')}><Icon name="sidebar" size={18} /></button>}
        <h2>{t('mesa.title')}</h2>
        <span className="ms-week">{weekLabel}</span>
        <div className="grow" />
        <button className="icon-btn boxed" title={t('mesa.prev')} onClick={() => setOffset(offset - 1)}><Icon name="up" size={16} className="ms-prev" /></button>
        <button className="icon-btn boxed" title={t('mesa.next')} onClick={() => setOffset(offset + 1)}><Icon name="up" size={16} className="ms-next" /></button>
      </header>

      <div className="ms-count">
        <span><b>{drafts}</b> {t('mesa.cDrafts')}</span>
        <span><b>{undated}</b> {t('mesa.cUndated')}</span>
        <span><b>{overdue}</b> {t('mesa.cOverdue')}</span>
      </div>

      <h3 className="ms-sec">{t('mesa.focus')} <small>{t('mesa.focusHint')}</small></h3>
      {focus.length === 0 ? (
        <p className="ms-empty">{t('mesa.focusEmpty')}</p>
      ) : (
        <div className="ms-focus">
          {focus.map((x) => (
            <button key={x.id} className="ms-fcard" onClick={() => onSelect(x.id)}>
              <small>{fmtWdLong.format(dueDay(x) as Date)} · {fmtDay.format(dueDay(x) as Date)}</small>
              <b>{clean(x)}</b>
              <span>{x.list_id ? data.lists.find((l) => l.id === x.list_id)?.name : t('mesa.noList')}</span>
            </button>
          ))}
        </div>
      )}

      <h3 className="ms-sec">{t('mesa.agenda')}</h3>
      {!data.google.connected && <p className="ms-empty">{t('mesa.noGoogle')}</p>}
      <div className="ms-agenda">
        {days.map((d) => {
          const ev = events.filter((x) => dayDiff(evStart(x), d) === 0).sort((a, b) => evStart(a).getTime() - evStart(b).getTime())
          return (
            <div key={d.toISOString()} className={'ms-ag' + (dayDiff(d, today) === 0 ? ' today' : '')}>
              <b>{fmtWd.format(d)} <span>{d.getDate()}</span></b>
              {ev.length === 0 ? <em>{t('mesa.noEvents')}</em> : ev.map((x) => (
                <button key={x.id} onClick={() => onSelect(x.id)}><i>{x.all_day ? t('mesa.allDay') : hhmm(evStart(x))}</i>{x.title}</button>
              ))}
            </div>
          )
        })}
      </div>

      <h3 className="ms-sec">{t('mesa.mine')}</h3>
      <div className="ms-filters">
        {FILTERS.map(([k, key]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{t(key)}{k === 'pending' && pending > 0 && <small className="ms-n">{pending}</small>}</button>)}
        <span className="ms-total">{shown.length}</span>
      </div>
      {groups.length === 0 ? (
        <p className="ms-empty">{filter === 'pending' ? t('mesa.pendingEmpty') : t('mesa.clean')}</p>
      ) : groups.map((g) => (
        <div key={g.k} className="ms-group">
          <h4>{g.label} <small>{g.tasks.length}</small></h4>
          {g.tasks.map((x) => <Row key={x.id} x={x} />)}
        </div>
      ))}

      <h3 className="ms-sec">{t('mesa.days')}</h3>
      <div className="ms-week-grid">
        {days.map((d) => {
          const ts = mine.filter((x) => { const dd = dueDay(x); return !!dd && dayDiff(dd, d) === 0 })
          const ev = events.filter((x) => dayDiff(evStart(x), d) === 0).length
          return (
            <article key={d.toISOString()} className={'ms-day' + (dayDiff(d, today) === 0 ? ' today' : '') + (ts.length === 0 && ev === 0 ? ' free' : '')}>
              <header>
                <b>{fmtWdLong.format(d)}</b>
                <span>{fmtDay.format(d)}</span>
                <em>{ts.length === 0 && ev === 0 ? t('mesa.free') : t('mesa.load', { n: ts.length, e: ev })}</em>
              </header>
              {ts.map((x) => (
                <button key={x.id} className={'ms-dt' + (selectedId === x.id ? ' sel' : '')} onClick={() => onSelect(x.id)}>
                  <span className={'ms-pri p' + x.priority} />{clean(x)}
                </button>
              ))}
            </article>
          )
        })}
      </div>
    </section>
  )
}
