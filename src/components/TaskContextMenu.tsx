import { ListIcon } from './ListIcon'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useData } from '../store/data'
import { addDays, startOfDay } from '../lib/dates'
import { tagIdsOf } from '../lib/views'
import type { Priority, Task } from '../lib/types'
import { Icon } from './Icon'
import { DatePicker } from './DatePicker'

type Open = { taskId: string; x: number; y: number }
let openFn: ((o: Open) => void) | null = null

/** Abre o menu de contexto da tarefa na posição do clique direito. */
export function openTaskMenu(e: React.MouseEvent, taskId: string) {
  e.preventDefault()
  e.stopPropagation()
  openFn?.({ taskId, x: e.clientX, y: e.clientY })
}

const PRIOS: Priority[] = [5, 3, 1, 0]

export function TaskContextHost({ onSelect, weekStart = 0 }: { onSelect: (id: string | null) => void; weekStart?: number }) {
  const { t } = useTranslation()
  const data = useData()
  const [open, setOpen] = useState<Open | null>(null)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [sub, setSub] = useState<'move' | 'tags' | 'date' | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    openFn = (o) => {
      setSub(null)
      setOpen(o)
      setPos({ x: o.x, y: o.y })
    }
    return () => {
      openFn = null
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const close = () => setOpen(null)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [open])

  // mantém o menu dentro da tela (recalcula quando abre submenu)
  useLayoutEffect(() => {
    if (!open || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    const x = Math.max(8, Math.min(open.x, window.innerWidth - r.width - 8))
    const y = Math.max(8, Math.min(open.y, window.innerHeight - r.height - 8))
    if (x !== pos.x || y !== pos.y) setPos({ x, y })
  }, [open, sub, pos.x, pos.y])

  if (!open) return null
  const task: Task | undefined = data.tasks.find((x) => x.id === open.taskId)
  if (!task) return null
  const close = () => setOpen(null)
  const tagIds = tagIdsOf(data, task.id)
  const trashed = !!task.deleted_at

  const setDay = (d: Date) => {
    const base = startOfDay(d)
    if (task.due_at && !task.all_day) {
      const old = new Date(task.due_at)
      base.setHours(old.getHours(), old.getMinutes())
    }
    void data.updateTask(task.id, { due_at: base.toISOString(), all_day: task.all_day || !task.due_at })
    close()
  }
  const today = startOfDay(new Date())
  const nextMon = addDays(today, ((8 - today.getDay()) % 7) || 7)
  const run = (fn: () => void) => () => {
    fn()
    close()
  }

  return (
    <div ref={ref} className="ctx-menu" style={{ left: pos.x, top: pos.y }} onContextMenu={(e) => e.preventDefault()}>
      {sub === 'date' ? (
        <DatePicker
          task={task}
          weekStart={weekStart}
          onClose={close}
          onApply={(p) => {
            void data.updateTask(task.id, p)
            close()
          }}
        />
      ) : (
        <>
          <div className="ctx-label">{t('date.tabDate')}</div>
          <div className="ctx-icons">
            <button title={t('date.today')} onClick={() => setDay(today)}><Icon name="sun" size={18} /></button>
            <button title={t('date.tomorrow')} onClick={() => setDay(addDays(today, 1))}><Icon name="sun" size={18} className="soft" /></button>
            <button title={t('date.nextWeek')} onClick={() => setDay(nextMon)}><Icon name="calendar" size={18} /></button>
            <button title={t('ctx.pickDate')} onClick={() => setSub('date')}><Icon name="clock" size={18} /></button>
            <button title={t('date.clear')} onClick={run(() => void data.updateTask(task.id, { due_at: null, start_at: null, repeat_rule: null, reminders: [] }))}><Icon name="x" size={18} /></button>
          </div>

          <div className="ctx-label">{t('priority.title')}</div>
          <div className="ctx-icons">
            {PRIOS.map((p) => (
              <button key={p} className={task.priority === p ? 'on' : ''} title={t(`priority.${p}`)} onClick={run(() => void data.updateTask(task.id, { priority: p }))}>
                <Icon name="flag" size={18} className={`pf p${p}`} />
              </button>
            ))}
          </div>

          <div className="ctx-sep" />
          <button className="ctx-item" onClick={run(() => { onSelect(task.id); setTimeout(() => document.querySelector<HTMLInputElement>('.sub-row.add input')?.focus(), 250) })}>
            <Icon name="plus" size={15} /> {t('detail.addSubtask')}
          </button>
          <button className="ctx-item" onClick={run(() => void data.updateTask(task.id, { pinned: !task.pinned }))}>
            <Icon name="pin" size={15} /> {task.pinned ? t('detail.unpin') : t('detail.pin')}
          </button>
          <button className="ctx-item" onClick={run(() => void data.setWontDo(task))}>
            <Icon name="slash" size={15} /> {t('detail.wontDo')}
          </button>

          <button className="ctx-item" onClick={() => setSub(sub === 'move' ? null : 'move')}>
            <Icon name="list" size={15} /> {t('ctx.moveTo')} <Icon name={sub === 'move' ? 'down' : 'right'} size={13} className="ctx-arrow" />
          </button>
          {sub === 'move' && (
            <div className="ctx-sub">
              {data.lists.filter((l) => !l.archived).map((l) => (
                <button key={l.id} className={'ctx-item' + (task.list_id === l.id ? ' on' : '')} onClick={run(() => void data.updateTask(task.id, { list_id: l.id }))}>
                  <ListIcon emoji={l.emoji} color={l.color} size={15} /> {l.is_inbox ? t('nav.inbox') : l.name} {task.list_id === l.id && <Icon name="check" size={13} />}
                </button>
              ))}
            </div>
          )}

          <button className="ctx-item" onClick={() => setSub(sub === 'tags' ? null : 'tags')}>
            <Icon name="tag" size={15} /> {t('nav.tags')} <Icon name={sub === 'tags' ? 'down' : 'right'} size={13} className="ctx-arrow" />
          </button>
          {sub === 'tags' && (
            <div className="ctx-sub">
              {data.tags.length === 0 && <div className="ctx-empty">{t('ctx.noTags')}</div>}
              {data.tags.map((g) => {
                const on = tagIds.includes(g.id)
                return (
                  <button key={g.id} className={'ctx-item' + (on ? ' on' : '')} onClick={() => void data.setTaskTags(task.id, on ? tagIds.filter((x) => x !== g.id) : [...tagIds, g.id])}>
                    #{g.name} {on && <Icon name="check" size={13} />}
                  </button>
                )
              })}
            </div>
          )}

          <div className="ctx-sep" />
          <button className="ctx-item" onClick={run(() => void data.duplicateTask(task))}><Icon name="copy" size={15} /> {t('detail.duplicate')}</button>
          <button className="ctx-item" onClick={run(() => void navigator.clipboard?.writeText(`${location.origin}/#task=${task.id}`))}><Icon name="link" size={15} /> {t('detail.copyLink')}</button>
          <button className="ctx-item" onClick={run(() => void data.updateTask(task.id, { kind: task.kind === 'note' ? 'task' : 'note' }))}>
            <Icon name="note" size={15} /> {task.kind === 'note' ? t('detail.toTask') : t('detail.toNote')}
          </button>
          {trashed ? (
            <button className="ctx-item" onClick={run(() => void data.restoreTask(task.id))}><Icon name="undo" size={15} /> {t('trash.restore')}</button>
          ) : (
            <button className="ctx-item danger" onClick={run(() => void data.trashTask(task.id))}><Icon name="trash" size={15} /> {t('detail.delete')}</button>
          )}
        </>
      )}
    </div>
  )
}
