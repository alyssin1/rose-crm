import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useData } from '../store/data'
import { fmtClock, fmtDuration, usePomodoro, type Phase } from '../lib/pomodoro'
import { addDays, startOfDay } from '../lib/dates'
import { Icon } from './Icon'
import { Popover } from './Popover'
import { NSelect } from './Select'

const R = 120
const C = 2 * Math.PI * R

export function Pomodoro({ onToggleSidebar }: { onToggleSidebar?: () => void }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language.slice(0, 2)
  const data = useData()
  const p = usePomodoro()
  const { state, settings } = p
  const idle = state.status === 'idle'
  const running = state.status === 'running'
  const stopwatch = state.mode === 'stopwatch'
  const progress = stopwatch ? 0 : 1 - p.displayMs / p.totalMs

  const today = startOfDay(new Date()).getTime()
  const week = addDays(startOfDay(new Date()), -6).getTime()
  const stats = useMemo(() => {
    const done = data.sessions.filter((s) => s.completed || s.kind === 'stopwatch' || s.duration_seconds >= 60)
    const sum = (from: number) => done.filter((s) => new Date(s.started_at).getTime() >= from)
    const d = sum(today)
    const w = sum(week)
    return {
      todayCount: d.filter((s) => s.kind === 'pomodoro' && s.completed).length,
      todaySec: d.reduce((n, s) => n + s.duration_seconds, 0),
      weekSec: w.reduce((n, s) => n + s.duration_seconds, 0),
      totalSec: done.reduce((n, s) => n + s.duration_seconds, 0),
    }
  }, [data.sessions, today, week])

  const openTasks = data.tasks.filter((x) => !x.deleted_at && !x.parent_id && x.status === 0 && x.kind !== 'note' && x.source !== 'google')
  const taskName = (id: string | null) => data.tasks.find((x) => x.id === id)?.title
  const recent = data.sessions.slice(0, 30)

  const phases: Phase[] = ['focus', 'short', 'long']

  return (
    <section className="pomo">
      <div className="pomo-main">
        <header className="tasks-head">
          {onToggleSidebar && <button className="icon-btn" onClick={onToggleSidebar} title={t('common.toggleSidebar')}><Icon name="sidebar" size={18} /></button>}
          <h2>{t('pomo.title')}</h2>
          <div className="grow" />
          <Popover
            align="right"
            trigger={(_o, toggle) => <button className="icon-btn" onClick={toggle} title={t('pomo.settings')}><Icon name="more" size={17} /></button>}
          >
            {() => (
              <div className="menu wide pomo-settings">
                <div className="menu-title">{t('pomo.settings')}</div>
                {(['focus', 'short', 'long'] as const).map((k) => (
                  <label key={k} className="menu-select">
                    <span>{t(`pomo.${k}`)} (min)</span>
                    <input type="number" min={1} max={180} value={settings[k]} onChange={(e) => p.setSettings({ [k]: Math.max(1, Math.min(180, Number(e.target.value) || 1)) })} style={{ width: 64 }} />
                  </label>
                ))}
                <label className="menu-select">
                  <span>{t('pomo.longEvery')}</span>
                  <input type="number" min={2} max={12} value={settings.longEvery} onChange={(e) => p.setSettings({ longEvery: Math.max(2, Math.min(12, Number(e.target.value) || 4)) })} style={{ width: 64 }} />
                </label>
                <label className="menu-check"><input type="checkbox" checked={settings.autoBreak} onChange={(e) => p.setSettings({ autoBreak: e.target.checked })} /> {t('pomo.autoBreak')}</label>
                <label className="menu-check"><input type="checkbox" checked={settings.sound} onChange={(e) => p.setSettings({ sound: e.target.checked })} /> {t('pomo.sound')}</label>
              </div>
            )}
          </Popover>
        </header>

        <div className="pomo-stage">
          <div className="pomo-modes">
            {(['pomodoro', 'stopwatch'] as const).map((m) => (
              <button key={m} className={state.mode === m ? 'on' : ''} disabled={!idle} onClick={() => p.setMode(m)}>{t(`pomo.mode.${m}`)}</button>
            ))}
          </div>

          {!stopwatch && (
            <div className="pomo-phases">
              {phases.map((ph) => (
                <button key={ph} className={state.phase === ph ? 'on' : ''} disabled={!idle} onClick={() => p.setPhase(ph)}>{t(`pomo.${ph}`)}</button>
              ))}
            </div>
          )}

          <div className="pomo-ring" role="timer" aria-live="off">
            <svg viewBox="0 0 280 280" width="280" height="280">
              <circle cx="140" cy="140" r={R} className="ring-bg" />
              {!stopwatch && <circle cx="140" cy="140" r={R} className={'ring-fg ' + state.phase} strokeDasharray={C} strokeDashoffset={C * (1 - Math.min(1, Math.max(0, progress)))} transform="rotate(-90 140 140)" />}
            </svg>
            <div className="pomo-time">
              <b>{fmtClock(p.displayMs)}</b>
              <small>{stopwatch ? t('pomo.mode.stopwatch') : t(`pomo.${state.phase}`)}{state.cycles > 0 && !stopwatch ? ` · 🍅 ${state.cycles}` : ''}</small>
            </div>
          </div>

          <label className="pomo-task">
            <Icon name="check" size={14} />
            <NSelect value={state.taskId ?? ''} onChange={(e) => p.setTask(e.target.value || null)} disabled={running}>
              <option value="">{t('pomo.noTask')}</option>
              {openTasks.map((x) => <option key={x.id} value={x.id}>{x.title || t('task.untitled')}</option>)}
            </NSelect>
          </label>

          <div className="pomo-actions">
            {idle && <button className="btn-primary big" onClick={p.start}><Icon name="play" size={16} /> {t('pomo.start')}</button>}
            {running && <button className="btn-primary big" onClick={p.pause}><Icon name="pause" size={16} /> {t('pomo.pause')}</button>}
            {state.status === 'paused' && <button className="btn-primary big" onClick={p.resume}><Icon name="play" size={16} /> {t('pomo.resume')}</button>}
            {!idle && state.phase === 'focus' && <button className="big ghost" onClick={p.stop}><Icon name="stop" size={16} /> {stopwatch ? t('pomo.finish') : t('pomo.giveUp')}</button>}
            {!idle && state.phase !== 'focus' && <button className="big ghost" onClick={p.skip}>{t('pomo.skip')}</button>}
          </div>
        </div>
      </div>

      <aside className="pomo-side">
        <div className="sum-label">{t('pomo.overview')}</div>
        <div className="pomo-cards">
          <div><small>{t('pomo.todayPomos')}</small><b>{stats.todayCount}</b></div>
          <div><small>{t('pomo.todayFocus')}</small><b>{fmtDuration(stats.todaySec)}</b></div>
          <div><small>{t('pomo.week')}</small><b>{fmtDuration(stats.weekSec)}</b></div>
          <div><small>{t('pomo.total')}</small><b>{fmtDuration(stats.totalSec)}</b></div>
        </div>

        <div className="sum-label">{t('pomo.history')}</div>
        {recent.length === 0 && <p className="side-hint">{t('pomo.noHistory')}</p>}
        <ul className="pomo-history">
          {recent.map((s) => (
            <li key={s.id}>
              <span className={'dot-c ' + (s.completed || s.kind === 'stopwatch' ? 'ok' : 'part')} />
              <div>
                <b>{taskName(s.task_id) ?? t('pomo.noTask')}</b>
                <small>{new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(s.started_at))} · {fmtDuration(s.duration_seconds)}</small>
              </div>
              <button className="icon-btn" title={t('list.delete')} onClick={() => data.deleteSession(s.id)}><Icon name="x" size={12} /></button>
            </li>
          ))}
        </ul>
      </aside>
    </section>
  )
}
