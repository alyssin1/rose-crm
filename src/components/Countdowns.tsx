import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useData } from '../store/data'
import { dayDiff, fromIsoDay, isoDay, startOfDay } from '../lib/dates'
import type { Countdown } from '../lib/types'
import { Icon } from './Icon'

const COLORS = ['#d62f45', '#f5a524', '#2fb67c', '#4c8dff', '#9b6bff', '#18a9c4', '#e86fb0', '#8d909c']

/** Data efetiva: se repete todo ano, a próxima ocorrência (hoje conta). */
export function effectiveDate(c: Countdown, today = startOfDay(new Date())): Date {
  const base = fromIsoDay(c.target_date)
  if (!c.repeat_yearly) return base
  let d = new Date(today.getFullYear(), base.getMonth(), base.getDate())
  if (d < today) d = new Date(today.getFullYear() + 1, base.getMonth(), base.getDate())
  return d
}

export function Countdowns({ onToggleSidebar }: { onToggleSidebar: () => void }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language.slice(0, 2)
  const data = useData()
  const [editing, setEditing] = useState<Countdown | 'new' | null>(null)
  const today = startOfDay(new Date())

  const items = data.countdowns
    .map((c) => ({ c, diff: dayDiff(effectiveDate(c, today), today) }))
    .sort((a, b) => Number(b.c.pinned) - Number(a.c.pinned) || (a.diff >= 0 ? 0 : 1) - (b.diff >= 0 ? 0 : 1) || (a.diff >= 0 ? a.diff - b.diff : b.diff - a.diff))

  return (
    <section className="countdowns">
      <header className="tasks-head">
        <button className="icon-btn" onClick={onToggleSidebar} title={t('common.toggleSidebar')}><Icon name="sidebar" size={18} /></button>
        <h2>{t('countdown.title')}</h2>
        <div className="grow" />
        <button className="icon-btn boxed" title={t('countdown.new')} onClick={() => setEditing('new')}><Icon name="plus" size={16} /></button>
      </header>

      {items.length === 0 ? (
        <div className="empty">
          <p>{t('countdown.empty')}</p>
          <button className="btn-primary" onClick={() => setEditing('new')}>{t('countdown.new')}</button>
        </div>
      ) : (
        <div className="cd-grid">
          {items.map(({ c, diff }) => (
            <article key={c.id} className={'cd-card' + (diff < 0 ? ' past' : '')} style={{ ['--cd' as string]: c.color ?? 'var(--accent)' }} onClick={() => setEditing(c)}>
              {c.pinned && <Icon name="pin" size={13} className="cd-pin" />}
              <div className="cd-top"><span className="cd-emoji">{c.emoji ?? '⏳'}</span><b>{c.name}</b></div>
              <div className="cd-num">
                {diff === 0 ? <span className="cd-today">{t('countdown.today')}</span> : <><strong>{Math.abs(diff)}</strong><small>{t(diff > 0 ? 'countdown.daysLeft' : 'countdown.daysAgo', { count: Math.abs(diff) })}</small></>}
              </div>
              <div className="cd-date">
                {new Intl.DateTimeFormat(lang, { dateStyle: 'full' }).format(effectiveDate(c, today))}
                {c.repeat_yearly && <Icon name="repeat" size={12} />}
              </div>
              {c.note && <p className="cd-note">{c.note}</p>}
            </article>
          ))}
        </div>
      )}

      {editing && <CountdownDialog item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  )
}

function CountdownDialog({ item, onClose }: { item: Countdown | null; onClose: () => void }) {
  const { t } = useTranslation()
  const data = useData()
  const [name, setName] = useState(item?.name ?? '')
  const [emoji, setEmoji] = useState(item?.emoji ?? '')
  const [date, setDate] = useState(item?.target_date ?? isoDay(new Date()))
  const [color, setColor] = useState(item?.color ?? COLORS[0])
  const [yearly, setYearly] = useState(item?.repeat_yearly ?? false)
  const [pinned, setPinned] = useState(item?.pinned ?? false)
  const [note, setNote] = useState(item?.note ?? '')

  const save = async () => {
    if (!name.trim() || !date) return
    const patch = { name: name.trim(), emoji: emoji.trim() || null, color, target_date: date, repeat_yearly: yearly, pinned, note: note.trim() || null }
    if (item) await data.updateCountdown(item.id, patch)
    else await data.addCountdown(patch)
    onClose()
  }

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{item ? t('countdown.edit') : t('countdown.new')}</h3>
        <div className="row2">
          <input style={{ width: 64, textAlign: 'center' }} value={emoji} maxLength={4} placeholder="🎂" onChange={(e) => setEmoji(e.target.value)} aria-label="emoji" />
          <input autoFocus style={{ flex: 1 }} value={name} placeholder={t('countdown.namePh')} onChange={(e) => setName(e.target.value)} />
        </div>
        <label className="field">{t('countdown.date')}</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ width: 170 }} />
        <div className="swatches">
          {COLORS.map((c) => <button key={c} className={'swatch' + (c === color ? ' on' : '')} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />)}
        </div>
        <label className="menu-check"><input type="checkbox" checked={yearly} onChange={(e) => setYearly(e.target.checked)} /> {t('countdown.yearly')}</label>
        <label className="menu-check"><input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> {t('countdown.pinned')}</label>
        <textarea rows={2} value={note} placeholder={t('countdown.notePh')} onChange={(e) => setNote(e.target.value)} />
        <div className="modal-actions">
          {item && <button className="danger" onClick={async () => { if (window.confirm(t('list.confirmDelete', { name: item.name }))) { await data.deleteCountdown(item.id); onClose() } }}>{t('list.delete')}</button>}
          <div className="grow" />
          <button onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn-primary" disabled={!name.trim()} onClick={() => void save()}>{t('common.save')}</button>
        </div>
      </div>
    </div>
  )
}
