// Celular no padrão do app do Nubank: Início com saudação + atalhos redondos + blocos com divisória,
// barra de baixo com 4 abas rotuladas e a folha "Mais" que sobe de baixo.
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useData } from '../store/data'
import { countFor, selectTasks } from '../lib/views'
import { DEFAULT_VIEW_OPTIONS, type View } from '../lib/types'
import { hhmm, sameDay, startOfDay } from '../lib/dates'
import { Avatar, Icon, type IconName } from './Icon'

import type { Section } from '../lib/routes'
export type { Section }

interface HomeProps {
  name: string
  onView: (v: View) => void
  onGo: (s: Section) => void
  onSelect: (id: string) => void
  onSearch: () => void
  onSettings: () => void
  onTheme: () => void
  theme: 'dark' | 'light'
}

export function MobileHome({ name, onView, onGo, onSelect, onSearch, onSettings, onTheme, theme }: HomeProps) {
  const { t, i18n } = useTranslation()
  const data = useData()
  const first = name.split(/[\s@]/)[0]
  const opts = { ...DEFAULT_VIEW_OPTIONS, groupBy: 'none' as const, showCompleted: false }
  const today = selectTasks({ type: 'today' }, data, opts).filter((x) => !x.google_calendar_id)
  // próximos eventos de hoje: só da(s) agenda(s) própria(s), como no Resumo
  const own = new Set(data.googleCalendars.filter((g) => g.access_role === 'owner').map((g) => g.google_calendar_id))
  const now = new Date()
  const events = data.tasks
    .filter((x) => !x.deleted_at && x.google_calendar_id && own.has(x.google_calendar_id) && !x.all_day && x.start_at && sameDay(new Date(x.start_at), now) && new Date(x.due_at ?? x.start_at) > now)
    .sort((a, b) => Date.parse(a.start_at!) - Date.parse(b.start_at!))
  const lists = data.lists.filter((l) => !l.archived && !l.is_inbox)

  const shortcuts: { icon: IconName; label: string; on: () => void }[] = [
    { icon: 'calendar', label: t('nav.today'), on: () => onView({ type: 'today' }) },
    { icon: 'calendar', label: t('nav.next7'), on: () => onView({ type: 'next7' }) },
    { icon: 'inbox', label: t('nav.inbox'), on: () => onView({ type: 'inbox' }) },
    { icon: 'summary', label: t('nav.summary'), on: () => onView({ type: 'summary' }) },
    { icon: 'matrix', label: t('matrix.title'), on: () => onGo('matrix') },
    { icon: 'timer', label: t('pomo.title'), on: () => onGo('pomodoro') },
    { icon: 'target', label: t('habit.title'), on: () => onGo('habits') },
  ]

  return (
    <section className="mh">
      <header className="mh-top">
        <button className="mh-avatar" onClick={onSettings} aria-label={t('settings.title')}><Avatar url={data.profile?.avatar_url} name={first} /></button>
        <div className="grow" />
        <button className="mh-ic" onClick={onTheme} aria-label={t('settings.theme')}><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={22} /></button>
        <button className="mh-ic" onClick={onSearch} aria-label={t('nav.search')}><Icon name="search" size={22} /></button>
        <button className="mh-ic" onClick={onSettings} aria-label={t('settings.title')}><Icon name="more" size={22} /></button>
      </header>
      <h1 className="mh-hello">{t('home.hello', { name: first })}</h1>

      <div className="mh-shortcuts">
        {shortcuts.map((s) => (
          <button key={s.label} onClick={s.on}>
            <i><Icon name={s.icon} size={24} /></i>
            <span>{s.label}</span>
          </button>
        ))}
      </div>

      <button className="mh-block" onClick={() => onView({ type: 'today' })}>
        <div className="mh-row"><b>{t('nav.today')}</b><Icon name="right" size={20} /></div>
        <strong className="mh-big">{t('home.tasksCount', { count: countFor({ type: 'today' }, data) })}</strong>
        {today.slice(0, 3).map((x) => (
          <span key={x.id} className="mh-line" onClick={(e) => { e.stopPropagation(); onSelect(x.id) }}>
            <i className={'mh-dot p' + x.priority} />{x.title || t('task.untitled')}
          </span>
        ))}
        {!today.length && <small>{t('home.nothingToday')}</small>}
      </button>

      <button className="mh-block" onClick={() => onGo('calendar')}>
        <div className="mh-row"><b>{t('nav.calendar')}</b><Icon name="right" size={20} /></div>
        {events.length ? (
          <>
            <small>{t('home.next')}</small>
            <strong className="mh-mid">{events[0].title || t('task.untitled')}</strong>
            <small>{hhmm(new Date(events[0].start_at!))} – {hhmm(new Date(events[0].due_at ?? events[0].start_at!))}{events.length > 1 ? ` · ${t('home.moreToday', { count: events.length - 1 })}` : ''}</small>
          </>
        ) : (
          <small>{t('home.noEvents')}</small>
        )}
      </button>

      <button className="mh-block" onClick={() => onView({ type: 'inbox' })}>
        <div className="mh-row"><b>{t('nav.inbox')}</b><Icon name="right" size={20} /></div>
        <strong className="mh-big">{t('home.tasksCount', { count: countFor({ type: 'inbox' }, data) })}</strong>
      </button>

      {lists.length > 0 && (
        <div className="mh-block static">
          <div className="mh-row"><b>{t('nav.lists')}</b></div>
          {lists.map((l) => (
            <button key={l.id} className="mh-list" onClick={() => onView({ type: 'list', id: l.id })}>
              <span>{l.name}</span>
              <small>{countFor({ type: 'list', id: l.id }, data)}</small>
              <Icon name="right" size={18} />
            </button>
          ))}
        </div>
      )}
      <p className="mh-foot">{startOfDay(now).toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
    </section>
  )
}

interface NavProps {
  section: Section
  onGo: (s: Section) => void
  more: boolean
  setMore: (v: boolean) => void
  calendarOn: boolean
}

export function MobileNav({ section, onGo, more, setMore, calendarOn }: NavProps) {
  const { t } = useTranslation()
  const tabs: { s: Section | 'more'; icon: IconName; label: string }[] = [
    { s: 'home', icon: 'home', label: t('home.title') },
    { s: 'tasks', icon: 'checkSquare', label: t('nav.tasks') },
    ...(calendarOn ? [{ s: 'calendar' as const, icon: 'calendar' as IconName, label: t('nav.calendar') }] : []),
    { s: 'more', icon: 'more', label: t('home.more') },
  ]
  const isMore = !['home', 'tasks', 'calendar'].includes(section)
  return (
    <nav className="mnav">
      {tabs.map((x) => {
        const on = x.s === 'more' ? more || isMore : !more && section === x.s
        return (
          <button key={x.s} className={on ? 'on' : ''} onClick={() => (x.s === 'more' ? setMore(!more) : (setMore(false), onGo(x.s)))}>
            <Icon name={x.icon} size={24} />
            <span>{x.label}</span>
          </button>
        )
      })}
    </nav>
  )
}

export interface MoreItem {
  icon: IconName
  label: string
  on: () => void
}

/** folha que sobe de baixo (atalhos redondos em grade, como no Nubank) */
export function MoreSheet({ items, onClose }: { items: MoreItem[]; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [onClose])
  return (
    <>
      <div className="msheet-back" onClick={onClose} />
      <div className="msheet" role="dialog" aria-modal="true">
        <i className="msheet-grip" />
        <div className="msheet-grid">
          {items.map((x) => (
            <button key={x.label} onClick={() => { onClose(); x.on() }}>
              <i><Icon name={x.icon} size={24} /></i>
              <span>{x.label}</span>
            </button>
          ))}
        </div>
      </div>
    </>
  )
}
