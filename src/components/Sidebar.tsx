import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useData } from '../store/data'
import { countFor } from '../lib/views'
import { viewKey, type FilterRules, type View } from '../lib/types'
import { Icon, type IconName } from './Icon'
import { Popover } from './Popover'

const SMART: { type: 'all' | 'today' | 'next7' | 'inbox' | 'summary'; icon: IconName }[] = [
  { type: 'all', icon: 'layers' },
  { type: 'today', icon: 'calendar' },
  { type: 'next7', icon: 'calendar' },
  { type: 'inbox', icon: 'inbox' },
  { type: 'summary', icon: 'summary' },
]

interface Props {
  view: View
  onView: (v: View) => void
}

export function Sidebar({ view, onView }: Props) {
  const { t } = useTranslation()
  const data = useData()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const active = viewKey(view)
  const ctx = data
  const userLists = data.lists.filter((l) => !l.is_inbox && !l.archived)

  const tagCount = (id: string) => countFor({ type: 'tag', id }, ctx)

  const createList = async () => {
    const n = name.trim()
    setName('')
    setAdding(false)
    if (!n) return
    const list = await data.addList(n)
    onView({ type: 'list', id: list.id })
  }

  const row = (v: View, icon: IconName | null, label: string, count?: number, emoji?: string | null, color?: string | null, menu?: React.ReactNode) => (
    <div key={viewKey(v)} className={'side-item' + (active === viewKey(v) ? ' active' : '')}>
      <button className="side-btn" onClick={() => onView(v)}>
        {emoji ? <span className="emoji">{emoji}</span> : icon ? <Icon name={icon} size={16} /> : <span className="dot" style={{ background: color ?? 'var(--silver-500)' }} />}
        <span className="grow">{label}</span>
        {count ? <span className="count">{count}</span> : null}
      </button>
      {menu}
    </div>
  )

  return (
    <aside className="sidebar">
      {SMART.map((s) => row({ type: s.type } as View, s.icon, t(`nav.${s.type}`), s.type === 'summary' ? undefined : countFor({ type: s.type } as View, ctx)))}

      <div className="side-sep" />

      <div className="side-group">
        <span>{t('nav.lists')}</span>
        <button title={t('nav.addList')} onClick={() => setAdding(true)}><Icon name="plus" size={14} /></button>
      </div>
      {adding && (
        <input
          className="side-input"
          autoFocus
          value={name}
          placeholder={t('list.name')}
          onChange={(e) => setName(e.target.value)}
          onBlur={createList}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void createList()
            if (e.key === 'Escape') {
              setName('')
              setAdding(false)
            }
          }}
        />
      )}
      {userLists.map((l) =>
        row(
          { type: 'list', id: l.id },
          null,
          l.name,
          countFor({ type: 'list', id: l.id }, ctx),
          l.emoji,
          l.color,
          <Popover
            align="right"
            trigger={(_o, toggle) => <button className="side-more" onClick={toggle}><Icon name="more" size={14} /></button>}
          >
            {(close) => (
              <div className="menu">
                <button
                  onClick={() => {
                    close()
                    const n = window.prompt(t('list.rename'), l.name)
                    if (n?.trim()) void data.updateList(l.id, { name: n.trim() })
                  }}
                >
                  {t('list.rename')}
                </button>
                <button
                  onClick={() => {
                    close()
                    const e = window.prompt(t('list.emoji'), l.emoji ?? '')
                    if (e !== null) void data.updateList(l.id, { emoji: e.trim() || null })
                  }}
                >
                  {t('list.emoji')}
                </button>
                <button
                  className="danger"
                  onClick={() => {
                    close()
                    if (window.confirm(t('list.confirmDelete', { name: l.name }))) {
                      void data.deleteList(l.id)
                      if (active === viewKey({ type: 'list', id: l.id })) onView({ type: 'all' })
                    }
                  }}
                >
                  {t('list.delete')}
                </button>
              </div>
            )}
          </Popover>,
        ),
      )}

      <div className="side-group">
        <span>{t('nav.filters')}</span>
        <button title={t('filter.new')} onClick={() => setFilterOpen(true)}><Icon name="plus" size={14} /></button>
      </div>
      {data.filters.length === 0 && <p className="side-hint">{t('filter.hint')}</p>}
      {data.filters.map((f) =>
        row(
          { type: 'filter', id: f.id },
          'filter',
          f.name,
          countFor({ type: 'filter', id: f.id }, ctx),
          null,
          null,
          <button className="side-more" title={t('list.delete')} onClick={() => window.confirm(t('list.confirmDelete', { name: f.name })) && void data.deleteFilter(f.id)}>
            <Icon name="x" size={13} />
          </button>,
        ),
      )}

      <div className="side-group">
        <span>{t('nav.tags')}</span>
      </div>
      {data.tags.length === 0 && <p className="side-hint">{t('tag.hint')}</p>}
      {data.tags.map((tg) =>
        row(
          { type: 'tag', id: tg.id },
          'tag',
          tg.name,
          tagCount(tg.id),
          null,
          null,
          <button className="side-more" title={t('list.delete')} onClick={() => window.confirm(t('list.confirmDelete', { name: tg.name })) && void data.deleteTag(tg.id)}>
            <Icon name="x" size={13} />
          </button>,
        ),
      )}

      <div className="side-sep" />
      {row({ type: 'completed' }, 'checkSquare', t('nav.completed'))}
      {row({ type: 'trash' }, 'trash', t('nav.trash'))}

      {filterOpen && <FilterDialog onClose={() => setFilterOpen(false)} />}
    </aside>
  )
}

function FilterDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const data = useData()
  const [name, setName] = useState('')
  const [rules, setRules] = useState<FilterRules>({ date: 'any', status: 'open', listIds: [], tagIds: [], priorities: [] })

  const toggle = <K extends 'listIds' | 'tagIds' | 'priorities'>(k: K, v: NonNullable<FilterRules[K]>[number]) => {
    const cur = (rules[k] ?? []) as (string | number)[]
    setRules({ ...rules, [k]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] })
  }

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{t('filter.new')}</h3>
        <input autoFocus placeholder={t('list.name')} value={name} onChange={(e) => setName(e.target.value)} />

        <label className="field">{t('filter.lists')}</label>
        <div className="chips">
          {data.lists.map((l) => (
            <button key={l.id} className={rules.listIds?.includes(l.id) ? 'on' : ''} onClick={() => toggle('listIds', l.id)}>
              {l.emoji ?? ''} {l.is_inbox ? t('nav.inbox') : l.name}
            </button>
          ))}
        </div>

        <label className="field">{t('filter.priority')}</label>
        <div className="chips">
          {([5, 3, 1, 0] as const).map((p) => (
            <button key={p} className={rules.priorities?.includes(p) ? 'on' : ''} onClick={() => toggle('priorities', p)}>
              {t(`priority.${p}`)}
            </button>
          ))}
        </div>

        {data.tags.length > 0 && (
          <>
            <label className="field">{t('nav.tags')}</label>
            <div className="chips">
              {data.tags.map((tg) => (
                <button key={tg.id} className={rules.tagIds?.includes(tg.id) ? 'on' : ''} onClick={() => toggle('tagIds', tg.id)}>#{tg.name}</button>
              ))}
            </div>
          </>
        )}

        <label className="field">{t('filter.date')}</label>
        <select value={rules.date} onChange={(e) => setRules({ ...rules, date: e.target.value as FilterRules['date'] })}>
          {(['any', 'today', 'next7', 'overdue', 'nodate'] as const).map((d) => <option key={d} value={d}>{t(`filter.d.${d}`)}</option>)}
        </select>

        <label className="field">{t('filter.status')}</label>
        <select value={rules.status} onChange={(e) => setRules({ ...rules, status: e.target.value as FilterRules['status'] })}>
          {(['open', 'done', 'all'] as const).map((s) => <option key={s} value={s}>{t(`filter.s.${s}`)}</option>)}
        </select>

        <div className="modal-actions">
          <button onClick={onClose}>{t('common.cancel')}</button>
          <button
            className="btn-primary"
            disabled={!name.trim()}
            onClick={async () => {
              await data.addFilter(name.trim(), rules)
              onClose()
            }}
          >
            {t('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
