import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Session } from '@supabase/supabase-js'
import { supabase, signInWithGoogle } from './lib/supabase'
import { fireTimes, showLocal } from './lib/notify'
import { DataProvider, useData } from './store/data'
import { Sidebar } from './components/Sidebar'
import { TaskList } from './components/TaskList'
import { TaskDetail } from './components/TaskDetail'
import { Calendar } from './components/Calendar'
import { Summary } from './components/Summary'
import { Matrix } from './components/Matrix'
import { Pomodoro } from './components/Pomodoro'
import { Habits } from './components/Habits'
import { Countdowns } from './components/Countdowns'
import { Stats } from './components/Stats'
import { PomodoroProvider, usePomodoro, fmtClock } from './lib/pomodoro'
import { Popover } from './components/Popover'
import { StickyLayer, StickyMenu, StickyWindow } from './components/Sticky'
import { Search } from './components/Search'
import { Settings } from './components/Settings'
import { Icon } from './components/Icon'
import type { View } from './lib/types'
import { useMobile } from './lib/useMobile'
import { setFormat } from './lib/format'
import { DialogHost } from './components/Dialogs'
import { TaskContextHost } from './components/TaskContextMenu'

type Theme = 'dark' | 'light'
const GOOGLE_SCOPES = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly'

function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return (localStorage.getItem('rose.theme') as Theme) || 'dark'
    } catch {
      return 'dark'
    }
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#1b1b20' : '#ffffff')
    try {
      localStorage.setItem('rose.theme', theme)
    } catch {
      /* sem storage */
    }
  }, [theme])
  return [theme, setTheme] as const
}

export default function App() {
  const { t } = useTranslation()
  const [theme, setTheme] = useTheme()
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (!ready) return null

  if (!session) {
    return (
      <div className="login">
        <img src="/icon.png" alt="Rose" />
        <h1>Rose</h1>
        <p>{t('app.tagline')}</p>
        <button className="btn-primary" onClick={() => void signInWithGoogle()}>{t('auth.google')}</button>
      </div>
    )
  }

  return (
    <DataProvider userId={session.user.id}>
      <PomodoroProvider>
        <Shell session={session} theme={theme} setTheme={setTheme} />
      </PomodoroProvider>
    </DataProvider>
  )
}

function Shell({ session, theme, setTheme }: { session: Session; theme: Theme; setTheme: (t: Theme) => void }) {
  const { t, i18n } = useTranslation()
  const data = useData()
  const pomo = usePomodoro() // hooks sempre antes de qualquer return antecipado
  setFormat(data.profile) // formato de hora/data (idempotente; re-renderiza junto com o perfil)
  const [section, setSection] = useState<'tasks' | 'calendar' | 'matrix' | 'pomodoro' | 'habits' | 'countdown' | 'stats'>('tasks')
  const [view, setView] = useState<View>({ type: 'all' })
  const [selected, setSelected] = useState<string | null>(null)
  const mobile = useMobile()
  const [sideOpen, setSideOpen] = useState(() => !window.matchMedia('(max-width: 820px)').matches)
  const [searching, setSearching] = useState(false)
  const [settings, setSettings] = useState(false)
  const profileApplied = useRef(false)
  const storedToken = useRef<string | null>(null)
  const fired = useRef(new Set<string>())

  // aplica idioma e tema salvos no perfil (uma vez, ao carregar)
  useEffect(() => {
    const p = data.profile
    if (!p || profileApplied.current) return
    profileApplied.current = true
    // guarda o fuso do usuário: o servidor precisa dele para os lembretes de hábito
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (tz && (p.settings as { tz?: string })?.tz !== tz) void data.updateProfile({ settings: { ...(p.settings ?? {}), tz } })
    if (p.lang && p.lang !== i18n.language.slice(0, 2)) void i18n.changeLanguage(p.lang)
    if ((p.theme === 'dark' || p.theme === 'light') && p.theme !== theme) setTheme(p.theme)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.profile])

  // refresh token do Google (só vem na volta do login com consentimento) → guardado no servidor
  useEffect(() => {
    const rt = session.provider_refresh_token
    if (!rt || storedToken.current === rt || !data.ready || data.denied) return
    storedToken.current = rt
    void data.storeGoogleToken(rt, GOOGLE_SCOPES, session.user.email ?? '').then(() => data.syncGoogle(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.provider_refresh_token, data.ready, data.denied])

  // sincronização com o Google ao abrir o app e a cada 5 min enquanto aberto
  useEffect(() => {
    if (!data.google.connected || !data.online || !data.syncAvailable) return
    void data.syncGoogle(false)
    const id = setInterval(() => void data.syncGoogle(false), 5 * 60000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.google.connected, data.online, data.syncAvailable])

  // alterações em tarefas ligadas a uma agenda do Google: envia logo (com pequeno atraso para agrupar edições)
  const lastSyncSig = useRef('')
  useEffect(() => {
    if (!data.google.connected || !data.online || !data.syncAvailable) return
    const dirty = data.tasks.filter((x) => x.google_calendar_id && (!x.google_synced_at || Date.parse(x.updated_at) - Date.parse(x.google_synced_at) > 3000))
    const sig = dirty.map((x) => x.id + x.updated_at).join('|')
    if (!sig || sig === lastSyncSig.current) return
    const id = setTimeout(() => {
      lastSyncSig.current = sig
      void data.syncGoogle(false)
    }, 4000)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.tasks, data.google.connected, data.online, data.syncAvailable])

  // lembretes locais (app aberto); com o app fechado, quem avisa é o servidor (Web Push / e-mail)
  useEffect(() => {
    const check = () => {
      const now = Date.now()
      for (const task of data.tasks) {
        for (const f of fireTimes(task)) {
          const at = f.at.getTime()
          if (at <= now && now - at < 90000 && !fired.current.has(f.key)) {
            fired.current.add(f.key)
            showLocal(task.title || 'Rose', t('notif.body'), task.id)
          }
        }
      }
    }
    check()
    const id = setInterval(check, 20000)
    return () => clearInterval(id)
  }, [data.tasks, t])

  // link de tarefa: /#task=<id>
  useEffect(() => {
    const id = /task=([0-9a-f-]{36})/.exec(location.hash)?.[1]
    if (id && data.tasks.some((x) => x.id === id)) setSelected(id)
  }, [data.tasks.length]) // eslint-disable-line react-hooks/exhaustive-deps

  // atalhos de teclado
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      const typing = el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearching(true)
      } else if (!typing && e.key === '/') {
        e.preventDefault()
        setSearching(true)
      } else if (!typing && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        setSection('tasks')
        setTimeout(() => document.querySelector<HTMLInputElement>('.add-task input')?.focus(), 30)
      } else if (!typing && e.key === 'Escape') setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!data.ready) return null

  const stickyId = /^#sticky=([0-9a-f-]{36})/.exec(location.hash)?.[1]
  if (stickyId) return <StickyWindow id={stickyId} />

  if (data.denied) {
    return (
      <div className="login">
        <img src="/icon.png" alt="Rose" />
        <h1>Rose</h1>
        <p>{t('auth.denied', { email: session.user.email })}</p>
        <button className="btn-primary" onClick={() => supabase.auth.signOut()}>{t('auth.signOut')}</button>
      </div>
    )
  }

  const name = session.user.user_metadata?.full_name ?? session.user.email ?? '?'
  const change = (v: View) => {
    setSection('tasks')
    setView(v)
    setSelected(null)
    if (mobile) setSideOpen(false)
  }
  const go = (sec: typeof section) => {
    setSection(sec)
    setSelected(null)
    if (mobile) setSideOpen(false)
  }
  const feat = data.profile?.features ?? {}
  const calendarOn = feat.calendar !== false
  const matrixOn = !!feat.matrix
  const stickyOn = feat.sticky !== false
  const habitOn = feat.habit !== false
  const pomoOn = feat.pomodoro !== false
  const countdownOn = feat.countdown !== false
  const weekStart = data.profile?.week_start ?? 0
  const showSidebar = sideOpen && section === 'tasks'
  const toggleSide = section === 'tasks' ? () => setSideOpen((o) => !o) : undefined // só existe barra lateral em Tarefas

  return (
    <div className={'shell' + (showSidebar ? '' : ' side-closed') + (mobile && showSidebar ? ' drawer-open' : '')}>
      {(!data.online || data.pending > 0) && (
        <div className="offline-bar">{!data.online ? t('offline.offline') : t('offline.syncing', { n: data.pending })}{!data.online && data.pending > 0 ? ` · ${t('offline.pending', { n: data.pending })}` : ''}</div>
      )}
      <nav className="rail">
        <button className="avatar" title={name} onClick={() => setSettings(true)}>{name[0]?.toUpperCase()}</button>
        <button className={'rail-btn' + (section === 'tasks' ? ' on' : '')} title={t('nav.tasks')} onClick={() => go('tasks')}><Icon name="checkSquare" size={20} /></button>
        {calendarOn && <button className={'rail-btn' + (section === 'calendar' ? ' on' : '')} title={t('nav.calendar')} onClick={() => go('calendar')}><Icon name="calendar" size={20} /></button>}
        {matrixOn && <button className={'rail-btn' + (section === 'matrix' ? ' on' : '')} title={t('matrix.title')} onClick={() => go('matrix')}><Icon name="matrix" size={20} /></button>}
        {pomoOn && (
          <button className={'rail-btn' + (section === 'pomodoro' ? ' on' : '')} title={t('pomo.title')} onClick={() => go('pomodoro')}>
            <Icon name="timer" size={20} />
            {pomo.state.status === 'running' && <i className="rail-badge">{fmtClock(pomo.displayMs)}</i>}
          </button>
        )}
        {habitOn && <button className={'rail-btn' + (section === 'habits' ? ' on' : '')} title={t('habit.title')} onClick={() => go('habits')}><Icon name="target" size={20} /></button>}
        {countdownOn && <button className={'rail-btn' + (section === 'countdown' ? ' on' : '')} title={t('countdown.title')} onClick={() => go('countdown')}><Icon name="hourglass" size={20} /></button>}
        <button className={'rail-btn' + (section === 'stats' ? ' on' : '')} title={t('stats.title')} onClick={() => go('stats')}><Icon name="chart" size={20} /></button>
        {stickyOn && (
          <Popover trigger={(_o, toggle) => <button className="rail-btn" title={t('sticky.title')} onClick={toggle}><Icon name="note" size={20} /></button>}>
            {() => <StickyMenu />}
          </Popover>
        )}
        <button className="rail-btn" title={`${t('nav.search')} (Ctrl+K)`} onClick={() => setSearching(true)}><Icon name="search" size={20} /></button>
        <div className="grow" />
        <button className="rail-btn" title={t('settings.theme')} onClick={() => { const n = theme === 'dark' ? 'light' : 'dark'; setTheme(n); void data.updateProfile({ theme: n }) }}><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} /></button>
        <button className="rail-btn" title={t('settings.title')} onClick={() => setSettings(true)}><Icon name="more" size={18} /></button>
        <button className="rail-btn" title={t('auth.signOut')} onClick={() => supabase.auth.signOut()}><Icon name="logout" size={18} /></button>
      </nav>

      {mobile && showSidebar && <div className="drawer-back" onClick={() => setSideOpen(false)} />}
      {(showSidebar || mobile) && <Sidebar view={view} onView={change} />}

      <main className={'main' + (selected ? ' with-detail' : '')}>
        {section === 'calendar' ? (
          <Calendar selectedId={selected} onSelect={setSelected} onToggleSidebar={toggleSide} weekStart={weekStart} showWeekNumbers={!!data.profile?.show_week_numbers} />
        ) : section === 'pomodoro' ? (
          <Pomodoro onToggleSidebar={toggleSide} />
        ) : section === 'habits' ? (
          <Habits weekStart={weekStart} onToggleSidebar={toggleSide} />
        ) : section === 'countdown' ? (
          <Countdowns onToggleSidebar={toggleSide} />
        ) : section === 'stats' ? (
          <Stats onToggleSidebar={toggleSide} />
        ) : section === 'matrix' ? (
          <Matrix selectedId={selected} onSelect={setSelected} onToggleSidebar={toggleSide} />
        ) : view.type === 'summary' ? (
          <Summary weekStart={weekStart} onToggleSidebar={toggleSide} />
        ) : (
          <TaskList view={view} selectedId={selected} onSelect={setSelected} onToggleSidebar={toggleSide} />
        )}
        {selected && (section !== 'tasks' || view.type !== 'summary') && <TaskDetail taskId={selected} onClose={() => setSelected(null)} />}
      </main>

      {stickyOn && <StickyLayer />}
      <TaskContextHost onSelect={setSelected} weekStart={weekStart} />
      <DialogHost />

      {searching && (
        <Search
          onClose={() => setSearching(false)}
          onOpenView={change}
          onOpenTask={(id, v) => {
            change(v)
            setSelected(id)
          }}
        />
      )}
      {settings && <Settings session={session} theme={theme} setTheme={setTheme} onClose={() => setSettings(false)} />}

      {data.error && (
        <div className="toast" onClick={data.clearError}>
          {data.error}
        </div>
      )}
    </div>
  )
}
