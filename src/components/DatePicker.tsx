import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { addDays, hhmm, sameDay, startOfDay, buildRule, parseRule, type Freq } from '../lib/dates'
import type { Task } from '../lib/types'
import { Icon } from './Icon'
import { NSelect } from './Select'

type Patch = Pick<Task, 'due_at' | 'start_at' | 'all_day' | 'reminders' | 'repeat_rule' | 'repeat_from' | 'duration_minutes'>

const REMINDERS = ['on_time', '5m', '30m', '1h', '1d'] as const
const FREQS: Freq[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const fromYmd = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
const withTime = (d: Date, time: string | null) => {
  const x = startOfDay(d)
  if (time) {
    const [h, m] = time.split(':').map(Number)
    x.setHours(h, m)
  }
  return x
}

interface Props {
  task: Pick<Task, 'due_at' | 'start_at' | 'all_day' | 'reminders' | 'repeat_rule' | 'repeat_from' | 'duration_minutes'>
  weekStart?: number
  onApply: (p: Patch) => void
  onClose: () => void
}

export function DatePicker({ task, weekStart = 0, onApply, onClose }: Props) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language.slice(0, 2)
  const due = task.due_at ? new Date(task.due_at) : null
  const [tab, setTab] = useState<'date' | 'duration'>(task.start_at && task.due_at && task.start_at !== task.due_at ? 'duration' : 'date')
  const [date, setDate] = useState<Date | null>(due ? startOfDay(due) : null)
  const hm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
  const [time, setTime] = useState<string | null>(due && !task.all_day ? (task.start_at ? hm(new Date(task.start_at)) : hm(due)) : null)
  const [endTime, setEndTime] = useState<string | null>(due && !task.all_day && task.start_at ? hm(due) : null)
  const [endDate, setEndDate] = useState<Date | null>(due && task.start_at ? startOfDay(due) : null)
  const [startDate, setStartDate] = useState<Date | null>(task.start_at ? startOfDay(new Date(task.start_at)) : date)
  const [reminders, setReminders] = useState<string[]>(task.reminders)
  const rule = parseRule(task.repeat_rule)
  const [freq, setFreq] = useState<Freq | ''>(rule?.freq ?? '')
  const [interval, setInterval_] = useState(rule?.interval ?? 1)
  const [repeatFrom, setRepeatFrom] = useState<'due' | 'completion'>(task.repeat_from ?? 'due')
  const [open, setOpen] = useState<'time' | 'reminder' | 'repeat' | null>(null)
  const [view, setView] = useState(startOfDay(date ?? new Date()))
  const monthStart = new Date(view.getFullYear(), view.getMonth(), 1)

  const cells = useMemo(() => {
    const lead = (monthStart.getDay() - weekStart + 7) % 7
    const first = addDays(monthStart, -lead)
    return Array.from({ length: 42 }, (_, i) => addDays(first, i))
  }, [monthStart, weekStart])

  const weekdays = useMemo(
    () => Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(lang, { weekday: 'narrow' }).format(addDays(new Date(2023, 0, 1 + weekStart), i))),
    [lang, weekStart],
  )

  const today = startOfDay(new Date())
  const quick = [
    { k: 'today', icon: 'sun' as const, d: today },
    { k: 'tomorrow', icon: 'sun' as const, d: addDays(today, 1) },
    { k: 'nextWeek', icon: 'calendar' as const, d: addDays(today, ((8 - today.getDay()) % 7) || 7) },
    { k: 'nextMonth', icon: 'moon' as const, d: new Date(today.getFullYear(), today.getMonth() + 1, today.getDate()) },
  ]

  const pick = (d: Date) => {
    if (tab === 'duration') {
      if (!startDate || (startDate && endDate) || d < startDate) {
        setStartDate(d)
        setEndDate(null)
      } else setEndDate(d)
      return
    }
    setDate(d)
    setView(d)
  }

  const apply = () => {
    const rep = freq ? buildRule(freq, Math.max(1, interval)) : null
    const base = { reminders, repeat_rule: rep, repeat_from: rep ? repeatFrom : null }
    if (tab === 'duration' && startDate) {
      const end = endDate ?? startDate
      const hasTime = !!(time || endTime)
      const st = hasTime ? time ?? '00:00' : null
      const et = hasTime ? endTime ?? time ?? '23:59' : null
      const s = withTime(startDate, st)
      const e = withTime(end, et)
      return onApply({ ...base, start_at: s.toISOString(), due_at: (e < s ? s : e).toISOString(), all_day: !hasTime, duration_minutes: null })
    }
    if (!date) return onApply({ ...base, start_at: null, due_at: null, all_day: true, duration_minutes: null, reminders: [], repeat_rule: null, repeat_from: null })
    const d = withTime(date, time)
    onApply({ ...base, start_at: null, due_at: d.toISOString(), all_day: !time, duration_minutes: null })
  }

  const clear = () => onApply({ start_at: null, due_at: null, all_day: true, reminders: [], repeat_rule: null, repeat_from: null, duration_minutes: null })

  const inRange = (d: Date) => tab === 'duration' && startDate && endDate && d > startDate && d < endDate
  const selected = (d: Date) => (tab === 'duration' ? (startDate && sameDay(d, startDate)) || (endDate && sameDay(d, endDate)) : date && sameDay(d, date))

  return (
    <div className="datepicker" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="dp-tabs">
        <button className={tab === 'date' ? 'on' : ''} onClick={() => setTab('date')}>{t('date.tabDate')}</button>
        <button className={tab === 'duration' ? 'on' : ''} onClick={() => setTab('duration')}>{t('date.tabDuration')}</button>
      </div>

      <div className="dp-quick">
        {quick.map((q) => (
          <button key={q.k} title={t(`date.${q.k}`)} onClick={() => pick(q.d)}>
            <Icon name={q.icon} size={18} />
          </button>
        ))}
      </div>

      <div className="dp-month">
        <b>{new Intl.DateTimeFormat(lang, { month: 'long' }).format(monthStart)} {monthStart.getFullYear()}</b>
        <span>
          <button onClick={() => setView(new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 1))} aria-label="‹"><Icon name="left" size={14} /></button>
          <button onClick={() => setView(today)} aria-label="•">•</button>
          <button onClick={() => setView(new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1))} aria-label="›"><Icon name="right" size={14} /></button>
        </span>
      </div>

      <div className="dp-grid">
        {weekdays.map((w, i) => <i key={'w' + i}>{w}</i>)}
        {cells.map((d) => (
          <button
            key={d.toISOString()}
            className={[d.getMonth() !== monthStart.getMonth() ? 'out' : '', sameDay(d, today) ? 'today' : '', selected(d) ? 'sel' : '', inRange(d) ? 'range' : ''].join(' ')}
            onClick={() => pick(d)}
          >
            {d.getDate()}
          </button>
        ))}
      </div>

      <div className="dp-rows">
        <button className="dp-row" onClick={() => setOpen(open === 'time' ? null : 'time')}>
          <Icon name="clock" size={15} /> <span>{t('date.time')}</span>
          <em>{time ? hhmm(withTime(new Date(), time)) : ''}</em><Icon name="right" size={13} />
        </button>
        {open === 'time' && (
          <div className="dp-sub">
            <input type="time" value={time ?? ''} onChange={(e) => setTime(e.target.value || null)} aria-label={t('date.start')} />
            {tab === 'duration' && <><span>→</span><input type="time" value={endTime ?? ''} onChange={(e) => setEndTime(e.target.value || null)} aria-label={t('date.end')} /></>}
            {(time || endTime) && <button onClick={() => { setTime(null); setEndTime(null) }}>{t('date.allDay')}</button>}
          </div>
        )}

        <button className="dp-row" onClick={() => setOpen(open === 'reminder' ? null : 'reminder')}>
          <Icon name="bell" size={15} /> <span>{t('date.reminder')}</span>
          <em>{reminders.length ? reminders.length : t('date.none')}</em><Icon name="right" size={13} />
        </button>
        {open === 'reminder' && (
          <div className="dp-sub col">
            {REMINDERS.map((r) => (
              <label key={r}>
                <input type="checkbox" checked={reminders.includes(r)} onChange={(e) => setReminders(e.target.checked ? [...reminders, r] : reminders.filter((x) => x !== r))} />
                {t(`date.rem.${r}`)}
              </label>
            ))}
          </div>
        )}

        <button className="dp-row" onClick={() => setOpen(open === 'repeat' ? null : 'repeat')}>
          <Icon name="repeat" size={15} /> <span>{t('date.repeat')}</span>
          <em>{freq ? t(`date.freq.${freq}`) : t('date.none')}</em><Icon name="right" size={13} />
        </button>
        {open === 'repeat' && (
          <div className="dp-sub col">
            <NSelect value={freq} onChange={(e) => setFreq(e.target.value as Freq | '')}>
              <option value="">{t('date.none')}</option>
              {FREQS.map((f) => <option key={f} value={f}>{t(`date.freq.${f}`)}</option>)}
            </NSelect>
            {freq && (
              <>
                <label>{t('date.every')} <input type="number" min={1} value={interval} onChange={(e) => setInterval_(Number(e.target.value))} style={{ width: 56 }} /></label>
                <NSelect value={repeatFrom} onChange={(e) => setRepeatFrom(e.target.value as 'due' | 'completion')}>
                  <option value="due">{t('date.fromDue')}</option>
                  <option value="completion">{t('date.fromCompletion')}</option>
                </NSelect>
              </>
            )}
          </div>
        )}
      </div>

      <div className="dp-actions">
        <button onClick={clear}>{t('date.clear')}</button>
        <button className="btn-primary" onClick={apply}>{t('date.ok')}</button>
      </div>
    </div>
  )
}

export { ymd, fromYmd }
