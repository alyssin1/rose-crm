import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useData } from '../store/data'
import { addDays, isoDay, sameDay, startOfDay } from '../lib/dates'
import { habitStats, isActive, isDone, logMap, valueOn } from '../lib/habits'
import type { Habit } from '../lib/types'
import { Icon } from './Icon'

const COLORS = ['#d62f45', '#f5a524', '#2fb67c', '#4c8dff', '#9b6bff', '#18a9c4', '#e86fb0', '#8d909c']

export function Habits({ weekStart = 0, onToggleSidebar }: { weekStart?: number; onToggleSidebar: () => void }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language.slice(0, 2)
  const data = useData()
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState<Habit | 'new' | null>(null)
  const [month, setMonth] = useState(startOfDay(new Date()))
  const today = startOfDay(new Date())
  const m = useMemo(() => logMap(data.habitLogs), [data.habitLogs])
  const habits = data.habits.filter((h) => !h.archived).sort((a, b) => a.sort_order - b.sort_order)
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6))
  const sel = habits.find((h) => h.id === selected) ?? null
  const col = (h: Habit) => h.color ?? 'var(--accent)'

  /** clique: hábito simples alterna; de contagem avança 1 até a meta e volta a zero */
  const bump = (h: Habit, d: Date) => {
    const iso = isoDay(d)
    const v = valueOn(m, h, iso)
    void data.setHabitValue(h.id, iso, h.kind === 'boolean' ? (v >= 1 ? 0 : 1) : v >= h.goal ? 0 : v + 1)
  }

  const doneToday = habits.filter((h) => isActive(h, today) && isDone(h, valueOn(m, h, isoDay(today)))).length
  const dueToday = habits.filter((h) => isActive(h, today)).length

  return (
    <section className="habits">
      <div className="habits-main">
        <header className="tasks-head">
          <button className="icon-btn" onClick={onToggleSidebar} title={t('common.toggleSidebar')}><Icon name="sidebar" size={18} /></button>
          <h2>{t('habit.title')}</h2>
          <span className="habit-today">{doneToday}/{dueToday} {t('habit.today').toLowerCase()}</span>
          <div className="grow" />
          <button className="icon-btn boxed" title={t('habit.new')} onClick={() => setEditing('new')}><Icon name="plus" size={16} /></button>
        </header>

        {habits.length === 0 ? (
          <div className="empty">
            <p>{t('habit.empty')}</p>
            <button className="btn-primary" onClick={() => setEditing('new')}>{t('habit.new')}</button>
          </div>
        ) : (
          <div className="habit-grid">
            <div className="habit-head">
              <span />
              {days.map((d) => (
                <span key={d.toISOString()} className={sameDay(d, today) ? 'today' : ''}>
                  <small>{new Intl.DateTimeFormat(lang, { weekday: 'narrow' }).format(d)}</small>
                  <b>{d.getDate()}</b>
                </span>
              ))}
            </div>
            {habits.map((h) => {
              const st = habitStats(h, m)
              return (
                <div key={h.id} className={'habit-row' + (h.id === selected ? ' sel' : '')}>
                  <button className="habit-name" onClick={() => setSelected(h.id === selected ? null : h.id)}>
                    <span className="habit-emoji" style={{ background: `color-mix(in srgb, ${col(h)} 22%, transparent)` }}>{h.emoji ?? '✓'}</span>
                    <span className="habit-title">{h.name}</span>
                    {st.current > 0 && <span className="streak" title={t('habit.streak')}><Icon name="flame" size={13} /> {st.current}</span>}
                  </button>
                  {days.map((d) => {
                    const v = valueOn(m, h, isoDay(d))
                    const active = isActive(h, d)
                    const done = isDone(h, v)
                    return (
                      <button
                        key={d.toISOString()}
                        className={'habit-cell' + (done ? ' done' : '') + (!active ? ' off' : '')}
                        style={done ? { background: col(h), borderColor: col(h) } : v > 0 ? { borderColor: col(h) } : undefined}
                        onClick={() => bump(h, d)}
                        title={`${h.name} · ${isoDay(d)}`}
                        aria-label={`${h.name} ${isoDay(d)}`}
                        aria-pressed={done}
                      >
                        {done ? <Icon name="check" size={14} /> : h.kind === 'count' && v > 0 ? <small>{v}/{h.goal}</small> : null}
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {sel && (
        <aside className="habit-detail">
          <div className="habit-detail-top">
            <span className="habit-emoji big" style={{ background: `color-mix(in srgb, ${col(sel)} 22%, transparent)` }}>{sel.emoji ?? '✓'}</span>
            <div className="grow"><b>{sel.name}</b><small>{sel.kind === 'count' ? `${t('habit.goalPer', { n: sel.goal })} ${sel.unit ?? ''}` : t('habit.daily')}</small></div>
            <button className="icon-btn" title={t('list.rename')} onClick={() => setEditing(sel)}><Icon name="more" size={16} /></button>
          </div>
          <Stats habit={sel} />
          <MonthCal habit={sel} month={month} setMonth={setMonth} weekStart={weekStart} lang={lang} bump={bump} />
        </aside>
      )}

      {editing && <HabitDialog habit={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onDeleted={() => setSelected(null)} />}
    </section>
  )

  function Stats({ habit }: { habit: Habit }) {
    const s = habitStats(habit, m)
    return (
      <div className="habit-stats">
        <div><small>{t('habit.streak')}</small><b>{s.current}</b></div>
        <div><small>{t('habit.best')}</small><b>{s.best}</b></div>
        <div><small>{t('habit.total')}</small><b>{s.total}</b></div>
        <div><small>{t('habit.rate30')}</small><b>{Math.round(s.rate30 * 100)}%</b></div>
      </div>
    )
  }
}

function MonthCal({ habit, month, setMonth, weekStart, lang, bump }: { habit: Habit; month: Date; setMonth: (d: Date) => void; weekStart: number; lang: string; bump: (h: Habit, d: Date) => void }) {
  const data = useData()
  const m = useMemo(() => logMap(data.habitLogs), [data.habitLogs])
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const lead = (first.getDay() - weekStart + 7) % 7
  const cells = Array.from({ length: 42 }, (_, i) => addDays(first, i - lead))
  const wd = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(lang, { weekday: 'narrow' }).format(addDays(new Date(2023, 0, 1 + weekStart), i)))
  const today = startOfDay(new Date())
  const c = habit.color ?? 'var(--accent)'
  return (
    <div className="habit-cal">
      <div className="dp-month">
        <b>{new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric' }).format(first)}</b>
        <span>
          <button onClick={() => setMonth(new Date(first.getFullYear(), first.getMonth() - 1, 1))}><Icon name="left" size={14} /></button>
          <button onClick={() => setMonth(new Date(first.getFullYear(), first.getMonth() + 1, 1))}><Icon name="right" size={14} /></button>
        </span>
      </div>
      <div className="dp-grid">
        {wd.map((w, i) => <i key={i}>{w}</i>)}
        {cells.map((d) => {
          const v = valueOn(m, habit, isoDay(d))
          const out = d.getMonth() !== first.getMonth()
          const done = isDone(habit, v)
          return (
            <button
              key={d.toISOString()}
              className={(out ? 'out ' : '') + (sameDay(d, today) ? 'today ' : '') + (isActive(habit, d) ? '' : 'inactive')}
              style={done ? { background: c, color: '#fff' } : v > 0 ? { boxShadow: `inset 0 0 0 2px ${c}` } : undefined}
              onClick={() => d <= today && bump(habit, d)}
              disabled={d > today}
            >
              {d.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function HabitDialog({ habit, onClose, onDeleted }: { habit: Habit | null; onClose: () => void; onDeleted: () => void }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language.slice(0, 2)
  const data = useData()
  const [name, setName] = useState(habit?.name ?? '')
  const [emoji, setEmoji] = useState(habit?.emoji ?? '')
  const [color, setColor] = useState(habit?.color ?? COLORS[0])
  const [kind, setKind] = useState<'boolean' | 'count'>(habit?.kind ?? 'boolean')
  const [goal, setGoal] = useState(habit?.goal ?? 1)
  const [unit, setUnit] = useState(habit?.unit ?? '')
  const [days, setDays] = useState<number[]>(habit?.days ?? [0, 1, 2, 3, 4, 5, 6])
  const [time, setTime] = useState(habit?.reminder_time ?? '')

  const save = async () => {
    const patch = { name: name.trim(), emoji: emoji.trim() || null, color, kind, goal: kind === 'count' ? Math.max(1, goal) : 1, unit: kind === 'count' ? unit.trim() || null : null, days: days.length ? days : [0, 1, 2, 3, 4, 5, 6], reminder_time: time || null }
    if (!patch.name) return
    if (habit) await data.updateHabit(habit.id, patch)
    else await data.addHabit(patch)
    onClose()
  }

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{habit ? t('habit.edit') : t('habit.new')}</h3>
        <div className="row2">
          <input style={{ width: 64, textAlign: 'center' }} value={emoji} maxLength={4} placeholder="🙂" onChange={(e) => setEmoji(e.target.value)} aria-label="emoji" />
          <input autoFocus style={{ flex: 1 }} value={name} placeholder={t('habit.namePh')} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} />
        </div>
        <div className="swatches">
          {COLORS.map((c) => <button key={c} className={'swatch' + (c === color ? ' on' : '')} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />)}
        </div>
        <label className="field">{t('habit.type')}</label>
        <div className="chips">
          <button className={kind === 'boolean' ? 'on' : ''} onClick={() => setKind('boolean')}>{t('habit.yesNo')}</button>
          <button className={kind === 'count' ? 'on' : ''} onClick={() => setKind('count')}>{t('habit.count')}</button>
        </div>
        {kind === 'count' && (
          <div className="row2">
            <input type="number" min={1} style={{ width: 80 }} value={goal} onChange={(e) => setGoal(Number(e.target.value))} aria-label={t('habit.goal')} />
            <input style={{ flex: 1 }} value={unit} placeholder={t('habit.unitPh')} onChange={(e) => setUnit(e.target.value)} />
          </div>
        )}
        <label className="field">{t('habit.days')}</label>
        <div className="chips">
          {[0, 1, 2, 3, 4, 5, 6].map((d) => (
            <button key={d} className={days.includes(d) ? 'on' : ''} onClick={() => setDays((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d]))}>
              {new Intl.DateTimeFormat(lang, { weekday: 'short' }).format(new Date(2023, 0, 1 + d))}
            </button>
          ))}
        </div>
        <label className="field">{t('habit.reminder')}</label>
        <input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={{ width: 130 }} />
        <div className="modal-actions">
          {habit && (
            <>
              <button className="danger" onClick={async () => { if (window.confirm(t('list.confirmDelete', { name: habit.name }))) { await data.deleteHabit(habit.id); onDeleted(); onClose() } }}>{t('list.delete')}</button>
              <button onClick={async () => { await data.updateHabit(habit.id, { archived: true }); onDeleted(); onClose() }}>{t('habit.archive')}</button>
            </>
          )}
          <div className="grow" />
          <button onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn-primary" disabled={!name.trim()} onClick={() => void save()}>{t('common.save')}</button>
        </div>
      </div>
    </div>
  )
}
