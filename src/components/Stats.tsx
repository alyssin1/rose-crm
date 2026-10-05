import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useData } from '../store/data'
import { addDays, isoDay, startOfDay } from '../lib/dates'
import { habitStats, isActive, isDone, logMap, valueOn } from '../lib/habits'
import { fmtDuration } from '../lib/pomodoro'
import { tagIdsOf } from '../lib/views'
import { BarChart, HBars, type Point } from './Charts'
import { Icon } from './Icon'
import { NSelect } from './Select'

type Tab = 'overview' | 'tasks' | 'focus' | 'habits'
const LEVELS = 12

export function Stats({ onToggleSidebar }: { onToggleSidebar?: () => void }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language.slice(0, 2)
  const data = useData()
  const [tab, setTab] = useState<Tab>('overview')
  const [range, setRange] = useState(30)
  const today = startOfDay(new Date())
  const m = useMemo(() => logMap(data.habitLogs), [data.habitLogs])
  const dayLabel = (d: Date) => new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' }).format(d)
  const days = useMemo(() => Array.from({ length: range }, (_, i) => addDays(today, i - range + 1)), [range, today])
  const labelEvery = range <= 7 ? 1 : range <= 30 ? 3 : 10
  const tickLabel = (d: Date) => (range <= 7 ? new Intl.DateTimeFormat(lang, { weekday: 'short' }).format(d) : String(d.getDate()))

  const done = useMemo(() => data.tasks.filter((x) => x.status === 1 && x.completed_at && !x.deleted_at && !x.parent_id).sort((a, b) => a.completed_at!.localeCompare(b.completed_at!)), [data.tasks])
  const sessions = useMemo(() => data.sessions.filter((s) => s.completed || s.kind === 'stopwatch' || s.duration_seconds >= 60), [data.sessions])

  const perDay = (isos: string[]) => {
    const c = new Map<string, number>()
    for (const i of isos) c.set(i, (c.get(i) ?? 0) + 1)
    return c
  }
  const tasksByDay = perDay(done.map((x) => isoDay(new Date(x.completed_at!))))
  const focusByDay = new Map<string, number>()
  for (const s of sessions) {
    const k = isoDay(new Date(s.started_at))
    focusByDay.set(k, (focusByDay.get(k) ?? 0) + s.duration_seconds / 60)
  }
  const taskPoints: Point[] = days.map((d) => ({ label: tickLabel(d), value: tasksByDay.get(isoDay(d)) ?? 0, hint: dayLabel(d) }))
  const focusPoints: Point[] = days.map((d) => ({ label: tickLabel(d), value: Math.round(focusByDay.get(isoDay(d)) ?? 0), hint: dayLabel(d) }))
  const inRangeTasks = done.filter((x) => new Date(x.completed_at!) >= days[0])
  const inRangeSessions = sessions.filter((s) => new Date(s.started_at) >= days[0])
  const focusSec = inRangeSessions.reduce((n, s) => n + s.duration_seconds, 0)

  const checkins = data.habitLogs.filter((l) => {
    const h = data.habits.find((x) => x.id === l.habit_id)
    return h && isDone(h, l.value)
  })
  const checkinsInRange = checkins.filter((l) => l.day >= isoDay(days[0]))

  // pontuação e nível
  const totalFocusMin = sessions.reduce((n, s) => n + s.duration_seconds, 0) / 60
  const score = done.length * 2 + checkins.length + Math.floor(totalFocusMin / 10)
  const level = Math.min(LEVELS, Math.floor(Math.sqrt(score / 8)) + 1)
  const levelFloor = 8 * (level - 1) ** 2
  const levelNext = 8 * level ** 2
  const levelPct = level >= LEVELS ? 1 : (score - levelFloor) / (levelNext - levelFloor)

  const byList: Point[] = useMemo(() => {
    const c = new Map<string, number>()
    for (const x of inRangeTasks) c.set(x.list_id ?? '', (c.get(x.list_id ?? '') ?? 0) + 1)
    return [...c.entries()].map(([id, v]) => {
      const l = data.lists.find((y) => y.id === id)
      return { label: l ? (l.is_inbox ? t('nav.inbox') : l.name) : t('group.noList'), value: v }
    }).sort((a, b) => b.value - a.value).slice(0, 8)
  }, [inRangeTasks, data.lists, t])

  const byPriority: Point[] = ([5, 3, 1, 0] as const).map((p) => ({ label: t(`priority.${p}`), value: inRangeTasks.filter((x) => x.priority === p).length }))

  const byTag: Point[] = useMemo(() => {
    const c = new Map<string, number>()
    for (const x of inRangeTasks) for (const id of tagIdsOf(data, x.id)) c.set(id, (c.get(id) ?? 0) + 1)
    return [...c.entries()].map(([id, v]) => ({ label: '#' + (data.tags.find((g) => g.id === id)?.name ?? ''), value: v })).sort((a, b) => b.value - a.value).slice(0, 8)
  }, [inRangeTasks, data])

  const focusByTask: Point[] = useMemo(() => {
    const c = new Map<string, number>()
    for (const s of inRangeSessions) c.set(s.task_id ?? '', (c.get(s.task_id ?? '') ?? 0) + s.duration_seconds / 60)
    return [...c.entries()].map(([id, v]) => ({ label: data.tasks.find((x) => x.id === id)?.title || t('pomo.noTask'), value: Math.round(v) })).sort((a, b) => b.value - a.value).slice(0, 8)
  }, [inRangeSessions, data.tasks, t])

  const habitRates: Point[] = data.habits.filter((h) => !h.archived).map((h) => {
    let active = 0
    let ok = 0
    for (const d of days) {
      if (!isActive(h, d)) continue
      active++
      if (isDone(h, valueOn(m, h, isoDay(d)))) ok++
    }
    return { label: `${h.emoji ?? ''} ${h.name}`.trim(), value: active ? Math.round((ok / active) * 100) : 0 }
  }).sort((a, b) => b.value - a.value)

  const bestStreak = Math.max(0, ...data.habits.map((h) => habitStats(h, m).best))

  // conquistas (data = quando a marca foi atingida)
  const when = (iso: string | undefined) => (iso ? new Intl.DateTimeFormat(lang, { dateStyle: 'medium' }).format(new Date(iso)) : null)
  const nth = <T extends { completed_at?: string | null; started_at?: string }>(arr: T[], n: number) => {
    const x = arr[n - 1]
    return x ? when(x.completed_at ?? x.started_at) : null
  }
  const pomos = sessions.filter((s) => s.kind === 'pomodoro' && s.completed).sort((a, b) => a.started_at.localeCompare(b.started_at))
  const achievements = [
    { k: 'task1', label: t('stats.a.task', { n: 1 }), at: nth(done, 1) },
    { k: 'task10', label: t('stats.a.task', { n: 10 }), at: nth(done, 10) },
    { k: 'task50', label: t('stats.a.task', { n: 50 }), at: nth(done, 50) },
    { k: 'task100', label: t('stats.a.task', { n: 100 }), at: nth(done, 100) },
    { k: 'task500', label: t('stats.a.task', { n: 500 }), at: nth(done, 500) },
    { k: 'pomo1', label: t('stats.a.pomo', { n: 1 }), at: nth(pomos, 1) },
    { k: 'pomo25', label: t('stats.a.pomo', { n: 25 }), at: nth(pomos, 25) },
    { k: 'pomo100', label: t('stats.a.pomo', { n: 100 }), at: nth(pomos, 100) },
    { k: 'streak7', label: t('stats.a.streak', { n: 7 }), at: bestStreak >= 7 ? '✓' : null },
    { k: 'streak30', label: t('stats.a.streak', { n: 30 }), at: bestStreak >= 30 ? '✓' : null },
  ]

  const tableLabel = t('stats.table')
  const chartLabel = t('stats.chart')
  const tabs: Tab[] = ['overview', 'tasks', 'focus', 'habits']

  return (
    <section className="stats">
      <header className="tasks-head">
        {onToggleSidebar && <button className="icon-btn" onClick={onToggleSidebar} title={t('common.toggleSidebar')}><Icon name="sidebar" size={18} /></button>}
        <h2>{t('stats.title')}</h2>
        <div className="grow" />
        <NSelect value={range} onChange={(e) => setRange(Number(e.target.value))} aria-label={t('stats.range')}>
          {[7, 30, 90].map((r) => <option key={r} value={r}>{t('stats.lastDays', { n: r })}</option>)}
        </NSelect>
      </header>

      <nav className="stats-tabs">
        {tabs.map((x) => <button key={x} className={tab === x ? 'on' : ''} onClick={() => setTab(x)}>{t(`stats.tab.${x}`)}</button>)}
      </nav>

      <div className="stats-body">
        {tab === 'overview' && (
          <>
            <div className="stat-cards">
              <div className="stat-tile"><small>{t('stats.tasksDone')}</small><b>{inRangeTasks.length}</b></div>
              <div className="stat-tile"><small>{t('stats.focusTime')}</small><b>{fmtDuration(focusSec)}</b></div>
              <div className="stat-tile"><small>{t('stats.checkins')}</small><b>{checkinsInRange.length}</b></div>
              <div className="stat-tile"><small>{t('stats.openTasks')}</small><b>{data.tasks.filter((x) => x.status === 0 && !x.deleted_at && !x.parent_id && x.source !== 'google').length}</b></div>
            </div>
            <div className="score">
              <div><small>{t('stats.score')}</small><b>{score}</b></div>
              <div className="grow">
                <div className="score-top"><span>{t('stats.level', { n: level })}</span><small>{level >= LEVELS ? t('stats.maxLevel') : t('stats.toNext', { n: levelNext - score })}</small></div>
                <div className="score-bar"><i style={{ width: `${Math.round(levelPct * 100)}%` }} /></div>
              </div>
            </div>
            <BarChart title={t('stats.tasksPerDay')} points={taskPoints} tickEvery={labelEvery} tableLabel={tableLabel} chartLabel={chartLabel} />
            <h4 className="stats-h">{t('stats.achievements')}</h4>
            <ul className="achievements">
              {achievements.map((a) => (
                <li key={a.k} className={a.at ? 'on' : ''}><span>{a.at ? '🏆' : '·'}</span><b>{a.label}</b><small>{a.at && a.at !== '✓' ? a.at : a.at ? '' : t('stats.locked')}</small></li>
              ))}
            </ul>
          </>
        )}

        {tab === 'tasks' && (
          <>
            <BarChart title={t('stats.tasksPerDay')} points={taskPoints} tickEvery={labelEvery} tableLabel={tableLabel} chartLabel={chartLabel} />
            <div className="chart-cols">
              <HBars title={t('stats.byList')} points={byList} tableLabel={tableLabel} chartLabel={chartLabel} />
              <HBars title={t('stats.byPriority')} points={byPriority} tableLabel={tableLabel} chartLabel={chartLabel} />
              <HBars title={t('stats.byTag')} points={byTag} tableLabel={tableLabel} chartLabel={chartLabel} />
            </div>
          </>
        )}

        {tab === 'focus' && (
          <>
            <BarChart title={t('stats.focusPerDay')} points={focusPoints} format={(n) => `${n} min`} tickEvery={labelEvery} tableLabel={tableLabel} chartLabel={chartLabel} />
            <HBars title={t('stats.focusByTask')} points={focusByTask} format={(n) => `${n} min`} tableLabel={tableLabel} chartLabel={chartLabel} />
          </>
        )}

        {tab === 'habits' && (
          <>
            <div className="stat-cards">
              <div className="stat-tile"><small>{t('stats.checkins')}</small><b>{checkinsInRange.length}</b></div>
              <div className="stat-tile"><small>{t('habit.best')}</small><b>{bestStreak}</b></div>
            </div>
            <HBars title={t('stats.habitRate')} points={habitRates} format={(n) => `${n}%`} tableLabel={tableLabel} chartLabel={chartLabel} />
          </>
        )}
      </div>
    </section>
  )
}
