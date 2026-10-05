import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useData } from '../store/data'
import { hhmm, sameDay } from '../lib/dates'
import type { GoogleMeta, Task } from '../lib/types'
import { Icon } from './Icon'
import { confirmAsk } from './Dialogs'

interface Props {
  task: Task
  color: string
  x: number
  y: number
  onClose: () => void
  onEdit: () => void
}

const AVATARS = ['#5f6368', '#c2185b', '#e8710a', '#8e24aa', '#33691e', '#00796b', '#1a73e8', '#a52714']
const colorFor = (s: string) => {
  let h = 0
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return AVATARS[h % AVATARS.length]
}

/** Texto da recorrência a partir da RRULE do Google (ex.: "Semanalmente em terça, quarta..."). */
function recurrenceText(rec: string[] | null | undefined, lang: string, t: (k: string, o?: Record<string, unknown>) => string): string | null {
  const rule = rec?.find((r) => r.startsWith('RRULE:'))?.slice(6)
  if (!rule) return null
  const p = Object.fromEntries(rule.split(';').map((x) => x.split('=') as [string, string]))
  const interval = Number(p.INTERVAL ?? 1)
  const unit = { DAILY: 'daily', WEEKLY: 'weekly', MONTHLY: 'monthly', YEARLY: 'yearly' }[p.FREQ as string]
  if (!unit) return null
  let out = interval > 1 ? t(`ev.rec.every_${unit}`, { n: interval }) : t(`ev.rec.${unit}`)
  if (p.FREQ === 'WEEKLY' && p.BYDAY) {
    const idx: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 }
    const names = p.BYDAY.split(',').map((d) => new Intl.DateTimeFormat(lang, { weekday: 'long' }).format(new Date(2023, 0, 1 + (idx[d.replace(/[-+0-9]/g, '')] ?? 0))))
    out += ` ${t('ev.rec.on')} ${names.join(', ')}`
  }
  if (p.COUNT) out += `, ${t('ev.rec.count', { n: p.COUNT })}`
  return out
}

export function EventPopup({ task, color, x, y, onClose, onEdit }: Props) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language.slice(0, 2)
  const data = useData()
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  const [menu, setMenu] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const meta: GoogleMeta | null = task.google_meta ?? null

  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    setPos({ x: Math.max(8, Math.min(x, window.innerWidth - r.width - 8)), y: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) })
  }, [x, y, meta, menu])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
    }
  }, [onClose])

  const due = task.due_at ? new Date(task.due_at) : null
  const start = task.start_at ? new Date(task.start_at) : due
  const allDay = task.all_day
  const day = start ? new Intl.DateTimeFormat(lang, { weekday: 'long', month: 'long', day: 'numeric' }).format(start) : ''
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  const when = !start || !due ? '' : allDay ? (sameDay(start, due) ? cap(day) : `${cap(day)} – ${cap(new Intl.DateTimeFormat(lang, { weekday: 'long', month: 'long', day: 'numeric' }).format(due))}`) : `${cap(day)} · ${hhmm(start)} – ${hhmm(due)}`
  const rec = recurrenceText(meta?.recurrence, lang, t)
  const calName = data.googleCalendars.find((c) => c.google_calendar_id === task.google_calendar_id)?.name ?? ''
  const attendees = meta?.attendees ?? []
  const me = attendees.find((a) => a.self)
  const yes = attendees.filter((a) => a.status === 'accepted').length
  const no = attendees.filter((a) => a.status === 'declined').length
  const maybe = attendees.filter((a) => a.status === 'tentative').length
  const wait = attendees.filter((a) => a.status === 'needsAction').length
  const reminder = meta?.reminders?.[0]
  const remText = reminder == null ? null : reminder >= 1440 ? t('ev.remDays', { count: Math.round(reminder / 1440) }) : reminder >= 60 ? t('ev.remHours', { count: Math.round(reminder / 60) }) : t('ev.remMin', { count: reminder })

  const rsvp = async (r: 'accepted' | 'declined' | 'tentative') => {
    setBusy(true)
    setErr(await data.rsvpEvent(task.id, r))
    setBusy(false)
  }

  const copy = () => meta?.meet && void navigator.clipboard?.writeText(meta.meet)

  return (
    <div ref={ref} className="evp" style={{ left: pos.x, top: pos.y }} role="dialog" aria-label={task.title}>
      <div className="evp-bar">
        <button title={t('ev.edit')} onClick={() => { onClose(); onEdit() }}><Icon name="pencil" size={20} /></button>
        <button title={t('detail.delete')} onClick={async () => { if (await confirmAsk(t('ev.confirmDelete', { name: task.title }))) { void data.trashTask(task.id); onClose() } }}><Icon name="trash" size={20} /></button>
        <div className="evp-more">
          <button title={t('common.more')} onClick={() => setMenu((m) => !m)}><Icon name="moreV" size={20} /></button>
          {menu && (
            <div className="menu">
              {meta?.htmlLink && <a href={meta.htmlLink} target="_blank" rel="noopener noreferrer" onClick={() => setMenu(false)}>{t('ev.openGoogle')}</a>}
              <button onClick={() => { void navigator.clipboard?.writeText(`${location.origin}/#task=${task.id}`); setMenu(false) }}>{t('detail.copyLink')}</button>
            </div>
          )}
        </div>
        <button title="×" onClick={onClose}><Icon name="x" size={20} /></button>
      </div>

      <div className="evp-body">
        <div className="evp-row head">
          <i className="evp-sq" style={{ background: color }} />
          <div>
            <h3>{task.title || t('task.untitled')}</h3>
            <p>{when}</p>
            {rec && <p>{rec}</p>}
          </div>
        </div>

        {meta?.meet && (
          <div className="evp-row">
            <Icon name="video" size={20} className="evp-ic meet" />
            <div className="grow">
              <a href={meta.meet} target="_blank" rel="noopener noreferrer" className="evp-link">{t('ev.joinMeet')}</a>
              <small>{meta.meet.replace(/^https?:\/\//, '')}</small>
            </div>
            <button className="evp-ibtn" title={t('detail.copyLink')} onClick={copy}><Icon name="copy" size={20} /></button>
          </div>
        )}

        {meta?.phone && (
          <div className="evp-row">
            <Icon name="phone" size={20} className="evp-ic" />
            <div>
              <span className="evp-link">{t('ev.joinPhone')}</span>
              <small>{meta.phone.label}{meta.phone.pin ? ` PIN: ${meta.phone.pin}#` : ''}</small>
            </div>
          </div>
        )}

        {meta?.location && (
          <div className="evp-row">
            <Icon name="link" size={20} className="evp-ic" />
            <div><span>{meta.location}</span></div>
          </div>
        )}

        {task.content && !/^\s*<p>\s*<\/p>\s*$/.test(task.content) && (
          <div className="evp-row">
            <Icon name="note" size={20} className="evp-ic" />
            <div className="evp-desc" dangerouslySetInnerHTML={{ __html: task.content }} />
          </div>
        )}

        {attendees.length > 0 && (
          <div className="evp-row top">
            <Icon name="users" size={20} className="evp-ic" />
            <div className="grow">
              <b>{t('ev.guests', { count: attendees.length })}</b>
              <small>{[yes && t('ev.yes', { n: yes }), no && t('ev.no', { n: no }), maybe && t('ev.maybe', { n: maybe }), wait && t('ev.awaiting', { n: wait })].filter(Boolean).join(' · ')}</small>
              <ul className="evp-guests">
                {[...attendees].sort((a, b) => Number(b.organizer) - Number(a.organizer)).map((a) => (
                  <li key={a.email}>
                    <span className="av" style={{ background: colorFor(a.email) }}>
                      {(a.name ?? a.email)[0]?.toUpperCase()}
                      {a.status === 'accepted' && <i className="ok"><Icon name="check" size={9} /></i>}
                      {a.status === 'declined' && <i className="no"><Icon name="x" size={9} /></i>}
                    </span>
                    <div>
                      <span>{a.name ?? a.email}</span>
                      {a.organizer && <small>{t('ev.organizer')}</small>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <a className="evp-ibtn" title={t('ev.emailGuests')} href={`mailto:${attendees.map((a) => a.email).join(',')}`}><Icon name="mail" size={20} /></a>
          </div>
        )}

        {remText && (
          <div className="evp-row">
            <Icon name="bell" size={20} className="evp-ic" />
            <div><span>{remText}</span></div>
          </div>
        )}

        {calName && (
          <div className="evp-row">
            <Icon name="calendar" size={20} className="evp-ic" />
            <div><span>{calName}</span></div>
          </div>
        )}
      </div>

      {me && (
        <div className="evp-foot">
          <span>{t('ev.going')}</span>
          <div className="grow" />
          {err && <small className="evp-err" title={err}>!</small>}
          {(['accepted', 'declined', 'tentative'] as const).map((r) => (
            <button key={r} disabled={busy} className={'evp-rsvp' + (me.status === r ? ' on' : '')} onClick={() => void rsvp(r)}>
              {t(r === 'accepted' ? 'ev.btnYes' : r === 'declined' ? 'ev.btnNo' : 'ev.btnMaybe')}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
