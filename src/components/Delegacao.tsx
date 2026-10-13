import { useState, type DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useData } from '../store/data'
import { dayDiff, startOfDay } from '../lib/dates'
import type { DelegLevel, Task } from '../lib/types'
import { Select } from './Select'

// agentes do time (~/.claude/agents, sem os Masters revisores); o app roda no Replit e não lê a pasta
const AGENTS = ['automacao', 'claude-ops', 'contador', 'criativos', 'cto', 'data-viewer', 'database', 'designer', 'dev-apps', 'financeiro', 'funnel-ops', 'gestao-time', 'juridico', 'secretaria', 'segundo-cerebro']
const COLS: { id: DelegLevel; color: string }[] = [
  { id: 'sim', color: '#0cce9c' },
  { id: 'parcial', color: '#ffb000' },
  { id: 'eu', color: '#ff5f68' },
]

const level = (x: Task) => x.delegation?.decisao?.nivel ?? x.delegation?.sugestao?.nivel ?? null
const agentOf = (x: Task) => (x.delegation?.decisao ? x.delegation.decisao.agente : x.delegation?.sugestao?.agente ?? null)

export function Delegacao({ selectedId, onSelect }: { selectedId: string | null; onSelect: (id: string) => void }) {
  const { t } = useTranslation()
  const data = useData()
  const [over, setOver] = useState<DelegLevel | null>(null)
  const today = startOfDay(new Date())
  const late = (x: Task) => (x.due_at ? dayDiff(startOfDay(new Date(x.due_at)), today) : 9999)

  const pool = data.tasks
    .filter((x) => x.source !== 'google' && !x.deleted_at && !x.parent_id && x.status === 0 && x.kind !== 'note')
    .sort((a, b) => late(a) - late(b) || b.priority - a.priority)

  // qualquer ação na tela vira decisão (sólida); a sugestão fica guardada ao lado
  const decide = (x: Task, nivel: DelegLevel, agente = agentOf(x)) =>
    data.updateTask(x.id, { delegation: { ...x.delegation, decisao: { agente: nivel === 'eu' ? null : agente, nivel } } })

  const dueText = (x: Task) => {
    const d = late(x)
    return d === 9999 ? t('deleg.undated') : d < 0 ? t('deleg.late', { n: -d }) : d === 0 ? t('deleg.today') : new Date(x.due_at as string).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' })
  }

  const Card = ({ x }: { x: Task }) => {
    const sug = x.delegation?.sugestao
    const confirmed = !!x.delegation?.decisao
    const nv = level(x)
    return (
      <div
        className={'dg-card' + (confirmed ? '' : ' sug') + (selectedId === x.id ? ' sel' : '')}
        draggable
        onDragStart={(e) => e.dataTransfer.setData('text/rose-task', x.id)}
      >
        <button className="dg-title" onClick={() => onSelect(x.id)}>{x.title || '—'}</button>
        <div className="dg-meta">
          <span className={late(x) < 0 ? 'late' : ''}>{dueText(x)}</span>
          {!confirmed && sug && <span>{t('deleg.suggested')}</span>}
        </div>
        {sug?.motivo && <p className="dg-why">{sug.motivo}{sug.origem && <small> · {sug.origem}</small>}</p>}
        {nv && (
          <div className="dg-acts">
            {nv !== 'eu' && (
              <Select
                value={agentOf(x) ?? ''}
                options={[{ value: '', label: t('deleg.noAgent') }, ...AGENTS.map((a) => ({ value: a, label: a }))]}
                onChange={(a) => void decide(x, nv, a || null)}
                ariaLabel={t('deleg.agent')}
                className="dg-agent"
              />
            )}
            {!confirmed && <button onClick={() => void decide(x, nv)}>{t('deleg.confirm')}</button>}
          </div>
        )}
      </div>
    )
  }

  const drop = (e: DragEvent, nivel: DelegLevel) => {
    e.preventDefault()
    setOver(null)
    const x = data.tasks.find((y) => y.id === e.dataTransfer.getData('text/rose-task'))
    if (x) void decide(x, nivel)
  }

  const none = pool.filter((x) => !level(x))

  return (
    <section className="mesa dg">
      <header className="tasks-head">
        <h2>{t('deleg.title')}</h2>
        <span className="ms-week">{t('deleg.hint')}</span>
      </header>

      <div className="dg-cols">
        {COLS.map((c) => {
          const items = pool.filter((x) => level(x) === c.id)
          return (
            <div
              key={c.id}
              className={'dg-col' + (over === c.id ? ' over' : '')}
              style={{ ['--q' as string]: c.color }}
              onDragOver={(e) => { e.preventDefault(); setOver(c.id) }}
              onDragLeave={() => setOver((o) => (o === c.id ? null : o))}
              onDrop={(e) => drop(e, c.id)}
            >
              <h3 className="dg-head"><i />{t(`deleg.${c.id}`)} <small>{items.length}</small></h3>
              <p className="dg-sub">{t(`deleg.${c.id}Hint`)}</p>
              {items.length === 0 ? <p className="ms-empty">{t('deleg.empty')}</p> : items.map((x) => <Card key={x.id} x={x} />)}
            </div>
          )
        })}
      </div>

      <details className="dg-none">
        <summary>{t('deleg.none')} <small>{none.length}</small> <span className="dg-sub">{t('deleg.noneHint')}</span></summary>
        <div className="dg-none-list">{none.map((x) => <Card key={x.id} x={x} />)}</div>
      </details>
    </section>
  )
}
