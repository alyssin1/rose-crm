import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Session } from '@supabase/supabase-js'
import { useData } from '../store/data'
import { LANGS } from '../i18n'
import { signInWithGoogle } from '../lib/supabase'
import { askPermission, disablePush, enablePush, notificationsSupported, pushActive } from '../lib/notify'
import { Icon, type IconName } from './Icon'

type Tab = 'account' | 'features' | 'datetime' | 'appearance' | 'notifications' | 'integrations' | 'backup' | 'about'
const TABS: { id: Tab; icon: IconName }[] = [
  { id: 'account', icon: 'checkSquare' },
  { id: 'features', icon: 'layers' },
  { id: 'datetime', icon: 'clock' },
  { id: 'appearance', icon: 'sun' },
  { id: 'notifications', icon: 'bell' },
  { id: 'integrations', icon: 'link' },
  { id: 'backup', icon: 'download' },
  { id: 'about', icon: 'note' },
]
const FEATURES = ['calendar', 'matrix', 'sticky', 'habit', 'pomodoro', 'countdown'] as const
const LIVE = new Set(['calendar', 'matrix', 'sticky', 'habit', 'pomodoro', 'countdown'])

interface Props {
  session: Session
  theme: 'dark' | 'light'
  setTheme: (t: 'dark' | 'light') => void
  initialTab?: Tab
  onClose: () => void
}

export function Settings({ session, theme, setTheme, initialTab = 'account', onClose }: Props) {
  const { t, i18n } = useTranslation()
  const data = useData()
  const [tab, setTab] = useState<Tab>(initialTab)
  const [push, setPush] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const p = data.profile
  const name = session.user.user_metadata?.full_name ?? session.user.email

  useEffect(() => void pushActive().then(setPush), [])

  const settings = (p?.settings ?? {}) as Record<string, unknown>
  const setSetting = (k: string, v: unknown) => data.updateProfile({ settings: { ...settings, [k]: v } })

  const togglePush = async (on: boolean) => {
    if (on) {
      const r = await enablePush(data.userId)
      setPush(r === 'ok')
      setMsg(r === 'ok' ? null : t(`notif.${r}`))
    } else {
      await disablePush()
      setPush(false)
    }
  }

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), lists: data.lists, tags: data.tags, tasks: data.tasks, taskTags: data.taskTags, filters: data.filters, templates: data.templates }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `rose-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const importJson = async (file: File | undefined) => {
    if (!file) return
    try {
      const j = JSON.parse(await file.text()) as { lists?: { id: string; name: string; emoji: string | null; color: string | null; is_inbox: boolean }[]; tasks?: { id: string; title: string; content?: string; list_id: string | null; priority?: 0 | 1 | 3 | 5; due_at?: string | null; all_day?: boolean; status?: 0 | 1 | 2; parent_id?: string | null }[] }
      const idMap = new Map<string, string | null>()
      for (const l of j.lists ?? []) {
        if (l.is_inbox) idMap.set(l.id, data.inbox?.id ?? null)
        else idMap.set(l.id, (await data.addList(l.name, l.emoji, l.color)).id)
      }
      const taskMap = new Map<string, string>()
      for (const x of (j.tasks ?? []).filter((x) => !x.parent_id)) {
        const nt = await data.addTask({ title: x.title, content: x.content ?? '', list_id: x.list_id ? idMap.get(x.list_id) ?? data.inbox?.id ?? null : data.inbox?.id ?? null, priority: x.priority ?? 0, due_at: x.due_at ?? null, all_day: x.all_day ?? true, status: x.status ?? 0 })
        taskMap.set(x.id, nt.id)
      }
      for (const x of (j.tasks ?? []).filter((x) => x.parent_id && taskMap.has(x.parent_id))) await data.addTask({ title: x.title, parent_id: taskMap.get(x.parent_id!), list_id: data.inbox?.id ?? null, status: x.status ?? 0 })
      setMsg(t('backup.imported', { n: taskMap.size }))
    } catch {
      setMsg(t('backup.invalid'))
    }
  }

  const sync = async () => {
    setSyncing(true)
    const err = await data.syncGoogle()
    setSyncing(false)
    setMsg(err ? `${t('google.syncFail')}: ${err}` : t('google.syncOk'))
  }

  const row = (label: string, control: React.ReactNode, hint?: string) => (
    <div className="settings-row">
      <div>{label}{hint && <small>{hint}</small>}</div>
      {control}
    </div>
  )

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="settings" onMouseDown={(e) => e.stopPropagation()}>
        <nav className="settings-nav">
          <h3>{t('settings.title')}</h3>
          {TABS.map((x) => (
            <button key={x.id} className={tab === x.id ? 'on' : ''} onClick={() => { setTab(x.id); setMsg(null) }}>
              <Icon name={x.icon} size={15} /> {t(`settings.tab.${x.id}`)}
            </button>
          ))}
        </nav>
        <div className="settings-body">
          <button className="icon-btn settings-x" onClick={onClose} aria-label="×"><Icon name="x" size={16} /></button>
          {msg && <div className="settings-msg">{msg}</div>}

          {tab === 'account' && (
            <div className="settings-sec">
              {row(t('settings.name'), <b>{name}</b>)}
              {row('E-mail', <span>{session.user.email}</span>)}
              {row(t('settings.language'), (
                <select value={i18n.language.slice(0, 2)} onChange={(e) => { void i18n.changeLanguage(e.target.value); void data.updateProfile({ lang: e.target.value as 'pt' }) }}>
                  {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
                </select>
              ))}
            </div>
          )}

          {tab === 'features' && (
            <div className="settings-sec">
              {FEATURES.map((f) => row(t(`settings.f.${f}`), <input type="checkbox" checked={f === 'matrix' ? !!p?.features?.[f] : p?.features?.[f] !== false} onChange={(e) => data.updateProfile({ features: { ...(p?.features ?? {}), [f]: e.target.checked } })} />, LIVE.has(f) ? undefined : t('common.soon')))}
            </div>
          )}

          {tab === 'datetime' && (
            <div className="settings-sec">
              {row(t('settings.timeFormat'), (
                <select value={p?.time_format ?? '24h'} onChange={(e) => data.updateProfile({ time_format: e.target.value as '24h' | '12h' })}>
                  <option value="24h">24 h (13:00)</option><option value="12h">12 h (1:00 PM)</option>
                </select>
              ))}
              {row(t('settings.dateFormat'), (
                <select value={p?.date_format ?? 'auto'} onChange={(e) => data.updateProfile({ date_format: e.target.value })}>
                  <option value="auto">{t('settings.dateAuto')}</option>
                  {['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD'].map((f) => <option key={f}>{f}</option>)}
                </select>
              ))}
              {row(t('settings.weekStart'), (
                <select value={p?.week_start ?? 0} onChange={(e) => data.updateProfile({ week_start: Number(e.target.value) })}>
                  {[0, 1, 6].map((d) => <option key={d} value={d}>{new Intl.DateTimeFormat(i18n.language.slice(0, 2), { weekday: 'long' }).format(new Date(2023, 0, 1 + d))}</option>)}
                </select>
              ))}
              {row(t('settings.weekNumbers'), <input type="checkbox" checked={!!p?.show_week_numbers} onChange={(e) => data.updateProfile({ show_week_numbers: e.target.checked })} />)}
            </div>
          )}

          {tab === 'appearance' && (
            <div className="settings-sec">
              {row(t('settings.theme'), (
                <select value={theme} onChange={(e) => { setTheme(e.target.value as 'dark' | 'light'); void data.updateProfile({ theme: e.target.value as 'dark' | 'light' }) }}>
                  <option value="dark">{t('settings.dark')}</option><option value="light">{t('settings.light')}</option>
                </select>
              ))}
            </div>
          )}

          {tab === 'notifications' && (
            <div className="settings-sec">
              {row(t('notif.push'), <input type="checkbox" checked={push} disabled={!notificationsSupported()} onChange={(e) => void togglePush(e.target.checked)} />, t('notif.pushHint'))}
              {row(t('notif.local'), <button onClick={async () => setMsg((await askPermission()) === 'granted' ? t('notif.granted') : t('notif.denied'))}>{t('notif.allow')}</button>, t('notif.localHint'))}
              {row(t('notif.email'), <input type="checkbox" checked={settings.email_reminders !== false} onChange={(e) => void setSetting('email_reminders', e.target.checked)} />, t('notif.emailHint', { email: session.user.email }))}
            </div>
          )}

          {tab === 'integrations' && (
            <div className="settings-sec">
              <h4>Google Calendar</h4>
              {data.google.connected ? (
                <>
                  {row(t('google.connected'), <button onClick={() => void data.disconnectGoogle()}>{t('google.disconnect')}</button>, data.google.email)}
                  {row(t('google.syncNow'), <button disabled={syncing} onClick={() => void sync()}>{syncing ? '…' : t('google.sync')}</button>, t('google.syncHint'))}
                  <h4>{t('google.calendars')}</h4>
                  {data.googleCalendars.length === 0 && <small>{t('google.noCalendars')}</small>}
                  {data.googleCalendars.map((c) => (
                    <label key={c.id} className="cal-toggle">
                      <input type="checkbox" checked={c.enabled} onChange={(e) => void data.toggleGoogleCalendar(c.id, e.target.checked)} />
                      <i className="dot-c" style={{ background: c.background_color ?? 'var(--accent)' }} /> {c.name}
                    </label>
                  ))}
                </>
              ) : (
                row(t('google.notConnected'), <button className="btn-primary" onClick={() => void signInWithGoogle()}>{t('google.connect')}</button>, t('google.connectHint'))
              )}
              <h4>{t('google.others')}</h4>
              <small>Outlook · Exchange · iCloud · CalDAV · {t('google.holidays')} — {t('common.soon')}</small>
            </div>
          )}

          {tab === 'backup' && (
            <div className="settings-sec">
              {row(t('backup.export'), <button onClick={exportJson}>{t('backup.exportBtn')}</button>, t('backup.exportHint'))}
              {row(t('backup.import'), <input type="file" accept="application/json" onChange={(e) => void importJson(e.target.files?.[0])} />, t('backup.importHint'))}
            </div>
          )}

          {tab === 'about' && (
            <div className="settings-sec">
              {row('Rose', <span>v0.1</span>, t('app.tagline'))}
              {row(t('settings.shortcuts'), <span />, t('settings.shortcutsHint'))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
