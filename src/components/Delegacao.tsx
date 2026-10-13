import { useState, type DragEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useData } from '../store/data'
import { dayDiff, startOfDay } from '../lib/dates'
import type { DelegLevel, Delegation, Task } from '../lib/types'
import { Select } from './Select'
import { Avatar } from './Icon'
import { Popover } from './Popover'
import { peerName, useFriendPeers } from './Sticky'

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
        <Estado d={x.delegation} />

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

      <Contexto pool={pool} selectedId={selectedId} onSelect={onSelect} />

      <div className="dg-cols">
        <div className="dg-col" style={{ ['--q' as string]: 'var(--text-dim)' }}>
          <h3 className="dg-head"><i />{t('deleg.none')} <small>{none.length}</small></h3>
          <p className="dg-sub">{t('deleg.noneHint')}</p>
          {none.length === 0 ? <p className="ms-empty">{t('deleg.empty')}</p> : none.map((x) => <Card key={x.id} x={x} />)}
        </div>
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
    </section>
  )
}

/** Uma linha de estado no cartão: checagem de contexto da Gestora e execução do agente (dot + texto). */
function Estado({ d }: { d: Delegation | null | undefined }) {
  const { t } = useTranslation()
  const c = d?.contexto, e = d?.execucao
  if (!c && !e) return null
  const cor: Record<string, string> = { pronto: '#0cce9c', falta: '#ffb000', nao_executavel: '#ff5f68', na_fila: '#5ea8ff', rodando: '#5ea8ff', entregue: '#0cce9c', reprovado: '#ff5f68' }
  return (
    <div className="dg-state">
      {c && !e && <span><i style={{ background: cor[c.veredito] }} />{t(`deleg.ctx_${c.veredito}`)}</span>}
      {e && <span><i style={{ background: cor[e.status] }} />{t(`deleg.exe_${e.status}`)}</span>}
    </div>
  )
}

/** Painel de procura de contexto: tarefas executáveis em que o agente disse que falta contexto. */
function Contexto({ pool, selectedId, onSelect }: { pool: Task[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const { t } = useTranslation()
  const data = useData()
  const friends = useFriendPeers()
  const itens = pool.filter((x) => x.delegation?.contexto?.veredito === 'falta')
  if (!itens.length) return null
  const meName = data.profile?.display_name || t('deleg.me')

  // grava uma resposta (ou o repasse) na pergunta, preservando o resto da delegação
  const salva = (x: Task, id: string, patch: { resposta?: string; quem?: string }) => {
    const c = x.delegation?.contexto
    if (!c) return
    const faltando = (c.faltando ?? []).map((p) => (p.id === id ? { ...p, ...patch, em: new Date().toISOString() } : p))
    void data.updateTask(x.id, { delegation: { ...x.delegation, contexto: { ...c, faltando } } })
  }

  return (
    <div className="dg-ctx">
      <h3 className="dg-head" style={{ ['--q' as string]: '#ffb000' }}><i />{t('deleg.ctxTitle')} <small>{itens.length}</small></h3>
      <p className="dg-sub">{t('deleg.ctxHint')}</p>
      <div className="dg-ctx-list">
        {itens.map((x) => {
          const c = x.delegation!.contexto!
          const qs = c.faltando ?? []
          const ok = qs.length > 0 && qs.every((p) => (p.resposta ?? '').trim())
          const ids = data.members.filter((m) => m.task_id === x.id).map((m) => m.user_id)
          return (
            <div key={x.id} className={'dg-card dg-ctx-card' + (selectedId === x.id ? ' sel' : '')}>
              <button className="dg-title" onClick={() => onSelect(x.id)}>{x.title || '—'}</button>
              <div className="dg-meta"><span>{c.agente ?? t('deleg.noAgent')}</span>{c.motivo && <span>{c.motivo}</span>}</div>
              {qs.map((p) => (
                <label key={p.id} className="dg-q">
                  <span>{p.pergunta}</span>
                  <textarea
                    defaultValue={p.resposta ?? ''}
                    placeholder={t('deleg.answerPh')}
                    rows={2}
                    onBlur={(e) => { const v = e.target.value.trim(); if (v !== (p.resposta ?? '')) salva(x, p.id, { resposta: v, quem: meName }) }}
                  />
                  {p.quem && <small>{t('deleg.by', { name: p.quem })}</small>}
                </label>
              ))}
              <div className="dg-acts">
                {x.user_id === data.userId && friends.some((f) => !ids.includes(f.user_id)) && (
                  <Popover trigger={(_o, toggle) => <button onClick={toggle}>{t('deleg.handOff')}</button>}>
                    {(close) => (
                      <div className="menu">
                        {friends.filter((f) => !ids.includes(f.user_id)).map((f) => (
                          <button key={f.user_id} onClick={() => { void data.addMember(x.id, f.user_id); close() }}>
                            <span className="peer-av"><Avatar url={f.avatar_url} name={peerName(f)} /></span> {peerName(f)}
                          </button>
                        ))}
                      </div>
                    )}
                  </Popover>
                )}
                {ok && <span className="dg-ready">{t('deleg.ctxReady')}</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
