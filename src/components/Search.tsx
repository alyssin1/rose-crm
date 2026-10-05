import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useData } from '../store/data'
import { formatDue } from '../lib/dates'
import { toPlain } from './RichEditor'
import { Icon } from './Icon'
import type { View } from '../lib/types'

interface Props {
  onClose: () => void
  onOpenTask: (taskId: string, listView: View) => void
  onOpenView: (v: View) => void
}

type Scope = 'all' | 'task' | 'list'

export function Search({ onClose, onOpenTask, onOpenView }: Props) {
  const { t, i18n } = useTranslation()
  const data = useData()
  const [q, setQ] = useState('')
  const [scope, setScope] = useState<Scope>('all')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])

  const needle = q.trim().toLowerCase()
  const tasks = useMemo(() => {
    if (!needle || scope === 'list') return []
    return data.tasks
      .filter((x) => !x.deleted_at && (x.title.toLowerCase().includes(needle) || toPlain(x.content).toLowerCase().includes(needle)))
      .slice(0, 50)
  }, [needle, scope, data.tasks])
  const lists = useMemo(() => (!needle || scope === 'task' ? [] : data.lists.filter((l) => !l.is_inbox && l.name.toLowerCase().includes(needle))), [needle, scope, data.lists])

  return (
    <div className="modal-back top" onMouseDown={onClose}>
      <div className="search" onMouseDown={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="search-input">
          <Icon name="search" size={16} />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search.placeholder')} />
          <button className="icon-btn" onClick={onClose} aria-label="×"><Icon name="x" size={14} /></button>
        </div>
        <div className="chips">
          {(['all', 'task', 'list'] as const).map((s) => (
            <button key={s} className={scope === s ? 'on' : ''} onClick={() => setScope(s)}>{t(`search.${s}`)}</button>
          ))}
        </div>
        <div className="search-results">
          {!needle && <p className="empty">{t('search.hint')}</p>}
          {needle && !tasks.length && !lists.length && <p className="empty">{t('search.none')}</p>}
          {lists.map((l) => (
            <button key={l.id} className="search-item" onClick={() => { onOpenView({ type: 'list', id: l.id }); onClose() }}>
              <span>{l.emoji ?? '📁'}</span> <b>{l.name}</b>
            </button>
          ))}
          {tasks.map((x) => {
            const list = data.lists.find((l) => l.id === x.list_id)
            return (
              <button
                key={x.id}
                className="search-item"
                onClick={() => {
                  onOpenTask(x.id, list && !list.is_inbox ? { type: 'list', id: list.id } : { type: 'all' })
                  onClose()
                }}
              >
                <Icon name={x.status === 1 ? 'checkSquare' : 'check'} size={14} />
                <b className={x.status !== 0 ? 'done' : ''}>{x.title || t('task.untitled')}</b>
                <small>{list ? (list.is_inbox ? t('nav.inbox') : list.name) : ''}{x.due_at ? ` · ${formatDue(x, i18n.language.slice(0, 2), t)}` : ''}</small>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
