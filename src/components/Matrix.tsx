import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useData } from '../store/data'
import { addDays, dayDiff, startOfDay } from '../lib/dates'
import type { Priority, Task } from '../lib/types'
import { Icon } from './Icon'
import { Popover } from './Popover'
import { TaskGroups } from './TaskList'
import { promptText } from './Dialogs'

export interface MatrixRules {
  urgentDays: number // urgente = vence em até N dias (atrasadas incluídas)
  importantMin: 3 | 5 // importante = prioridade ≥ N
}
export const DEFAULT_MATRIX: MatrixRules = { urgentDays: 0, importantMin: 5 }

type Quad = 'do' | 'plan' | 'delegate' | 'drop'
// ordem e cores do TickTick: I vermelho, II amarelo, III azul, IV verde
const QUADS: { id: Quad; numeral: string; urgent: boolean; important: boolean; color: string }[] = [
  { id: 'do', numeral: 'I', urgent: true, important: true, color: '#ff5f68' },
  { id: 'plan', numeral: 'II', urgent: false, important: true, color: '#ffb000' },
  { id: 'delegate', numeral: 'III', urgent: true, important: false, color: '#4772fa' },
  { id: 'drop', numeral: 'IV', urgent: false, important: false, color: '#0cce9c' },
]

export const isUrgent = (t: Task, r: MatrixRules) => !!t.due_at && dayDiff(new Date(t.due_at), new Date()) <= r.urgentDays
export const isImportant = (t: Task, r: MatrixRules) => t.priority >= r.importantMin

interface Props {
  selectedId: string | null
  onSelect: (id: string | null) => void
  onToggleSidebar?: () => void
}

export function Matrix({ selectedId, onSelect }: Props) {
  const { t } = useTranslation()
  const data = useData()
  const rules: MatrixRules = { ...DEFAULT_MATRIX, ...((data.profile?.settings?.matrix as Partial<MatrixRules>) ?? {}) }
  const [showDone, setShowDone] = useState(false)
  const [over, setOver] = useState<Quad | null>(null)

  const setRules = (patch: Partial<MatrixRules>) => data.updateProfile({ settings: { ...(data.profile?.settings ?? {}), matrix: { ...rules, ...patch } } })

  const pool = data.tasks.filter((x) => !x.deleted_at && !x.parent_id && x.kind !== 'note' && x.source !== 'google' && (showDone || x.status === 0))

  // sem prioridade nenhuma → quadrante IV (como no TickTick); "urgente e não importante" exige alguma prioridade
  const quadOf = (x: Task): Quad => {
    const u = isUrgent(x, rules)
    const i = isImportant(x, rules)
    if (u && i) return 'do'
    if (i) return 'plan'
    if (u && x.priority > 0) return 'delegate'
    return 'drop'
  }

  const patchFor = (x: Partial<Task>, q: (typeof QUADS)[number]): Partial<Task> => {
    const patch: Partial<Task> = {}
    const prio = x.priority ?? 0
    if (q.important && prio < rules.importantMin) patch.priority = rules.importantMin as Priority
    if (!q.important && prio >= rules.importantMin) patch.priority = 0
    if (!q.important && q.urgent && (patch.priority ?? prio) === 0) patch.priority = 1
    if (!q.important && !q.urgent && (patch.priority ?? prio) > 0) patch.priority = 0
    const dueDiff = x.due_at ? dayDiff(new Date(x.due_at), new Date()) : null
    const urgentNow = dueDiff !== null && dueDiff <= rules.urgentDays
    if (q.urgent && !urgentNow) {
      patch.due_at = startOfDay(new Date()).toISOString()
      patch.all_day = true
    }
    if (!q.urgent && urgentNow) {
      patch.due_at = startOfDay(addDays(new Date(), rules.urgentDays + 1)).toISOString()
      patch.all_day = true
    }
    return patch
  }

  const addTo = async (q: (typeof QUADS)[number]) => {
    const title = await promptText(t('kanban.addTask'))
    if (!title?.trim()) return
    const task = await data.addTask({ ...patchFor({ priority: 0, due_at: null }, q), title: title.trim(), list_id: data.inbox?.id ?? null })
    onSelect(task.id)
  }

  return (
    <section className="matrix tt">
      <header className="mx-head">
        <h2>{t('matrix.title')}</h2>
        <div className="grow" />
        <Popover align="right" trigger={(_o, toggle) => <button className="icon-btn" onClick={toggle} title={t('matrix.rules')}><Icon name="more" size={20} /></button>}>
          {() => (
            <div className="menu wide">
              <div className="menu-title">{t('matrix.rules')}</div>
              <label className="menu-select">
                <span>{t('matrix.urgent')}</span>
                <select value={rules.urgentDays} onChange={(e) => void setRules({ urgentDays: Number(e.target.value) })}>
                  <option value={0}>{t('matrix.u0')}</option>
                  <option value={1}>{t('matrix.u1')}</option>
                  <option value={3}>{t('matrix.u3')}</option>
                  <option value={7}>{t('matrix.u7')}</option>
                </select>
              </label>
              <label className="menu-select">
                <span>{t('matrix.important')}</span>
                <select value={rules.importantMin} onChange={(e) => void setRules({ importantMin: Number(e.target.value) as 3 | 5 })}>
                  <option value={5}>{t('matrix.i5')}</option>
                  <option value={3}>{t('matrix.i3')}</option>
                </select>
              </label>
              <label className="menu-check"><input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> {t('view.showCompleted')}</label>
            </div>
          )}
        </Popover>
      </header>

      <div className="mx-grid">
        {QUADS.map((q) => {
          const items = pool.filter((x) => quadOf(x) === q.id)
          return (
            <div
              key={q.id}
              className={'mx-quad' + (over === q.id ? ' over' : '')}
              style={{ ['--q' as string]: q.color }}
              onDragOver={(e) => {
                e.preventDefault()
                setOver(q.id)
              }}
              onDragLeave={() => setOver((o) => (o === q.id ? null : o))}
              onDrop={(e) => {
                e.preventDefault()
                setOver(null)
                const id = e.dataTransfer.getData('text/rose-task')
                const task = data.tasks.find((x) => x.id === id)
                if (task) void data.updateTask(task.id, patchFor(task, q))
              }}
            >
              <div className="mx-qhead">
                <i className="mx-badge">{q.numeral}</i>
                <span>{t(`matrix.q.${q.id}.full`)}</span>
                <div className="grow" />
                <button className="mx-act" title={t('kanban.addTask')} onClick={() => void addTo(q)}><Icon name="plus" size={20} /></button>
              </div>
              <div className="mx-qbody">
                {items.length === 0 ? <div className="mx-empty">{t('matrix.empty')}</div> : <TaskGroups tasks={items} selectedId={selectedId} onSelect={onSelect} />}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
