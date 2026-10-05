import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useData } from '../store/data'
import { countFor } from '../lib/views'
import { viewKey, type FilterDef, type FilterRules, type List, type View } from '../lib/types'
import { Icon, type IconName } from './Icon'
import { Popover } from './Popover'
import { confirmAsk, promptText } from './Dialogs'

const SMART: { type: 'all' | 'today' | 'next7' | 'inbox' | 'summary'; icon: IconName }[] = [
  { type: 'all', icon: 'layers' },
  { type: 'today', icon: 'calendar' },
  { type: 'next7', icon: 'calendar' },
  { type: 'inbox', icon: 'inbox' },
  { type: 'summary', icon: 'summary' },
]
const COLORS = ['#d62f45', '#f5a524', '#2fb67c', '#4c8dff', '#9b6bff', '#18a9c4', '#e86fb0', '#8d909c']
const EMOJIS = ['📁', '💼', '🏠', '📚', '🎯', '💡', '🛒', '✈️', '💪', '🎨']

interface Props {
  view: View
  onView: (v: View) => void
}

export function Sidebar({ view, onView }: Props) {
  const { t } = useTranslation()
  const data = useData()
  const [listDlg, setListDlg] = useState<List | 'new' | null>(null)
  const [filterDlg, setFilterDlg] = useState<FilterDef | 'new' | null>(null)
  const active = viewKey(view)
  const ctx = data
  const userLists = data.lists.filter((l) => !l.is_inbox && !l.archived)
  const folders = [...data.folders].sort((a, b) => a.sort_order - b.sort_order)
  const loose = userLists.filter((l) => !l.folder_id || !folders.some((f) => f.id === l.folder_id))

  const row = (v: View, icon: IconName | null, label: string, count?: number, emoji?: string | null, color?: string | null, menu?: React.ReactNode, indent = false) => (
    <div key={viewKey(v)} className={'side-item' + (active === viewKey(v) ? ' active' : '') + (indent ? ' indent' : '')}>
      <button className="side-btn" onClick={() => onView(v)}>
        {emoji ? <span className="emoji">{emoji}</span> : icon ? <Icon name={icon} size={16} /> : <span className="dot" style={{ background: color ?? 'var(--silver-500)' }} />}
        <span className="grow">{label}</span>
        {count ? <span className="count">{count}</span> : null}
      </button>
      {menu}
    </div>
  )

  const listRow = (l: List, indent: boolean) =>
    row(
      { type: 'list', id: l.id },
      null,
      l.name,
      countFor({ type: 'list', id: l.id }, ctx),
      l.emoji,
      l.color,
      <Popover align="right" trigger={(_o, toggle) => <button className="side-more" onClick={toggle} aria-label={t('common.more')}><Icon name="more" size={14} /></button>}>
        {(close) => (
          <div className="menu">
            <button onClick={() => { close(); setListDlg(l) }}>{t('list.edit')}</button>
            {folders.length > 0 && (
              <>
                <div className="menu-title">{t('folder.moveTo')}</div>
                {l.folder_id && <button onClick={() => { close(); void data.updateList(l.id, { folder_id: null }) }}>{t('folder.none')}</button>}
                {folders.filter((f) => f.id !== l.folder_id).map((f) => (
                  <button key={f.id} onClick={() => { close(); void data.updateList(l.id, { folder_id: f.id }) }}>📁 {f.name}</button>
                ))}
              </>
            )}
            <button
              className="danger"
              onClick={async () => {
                close()
                if (await confirmAsk(t('list.confirmDelete', { name: l.name }))) {
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
      indent,
    )

  return (
    <aside className="sidebar">
      {SMART.map((s) => row({ type: s.type } as View, s.icon, t(`nav.${s.type}`), s.type === 'summary' ? undefined : countFor({ type: s.type } as View, ctx)))}

      <div className="side-sep" />

      <div className="side-group">
        <span>{t('nav.lists')}</span>
        <Popover align="right" trigger={(_o, toggle) => <button title={t('nav.addList')} onClick={toggle}><Icon name="plus" size={14} /></button>}>
          {(close) => (
            <div className="menu">
              <button onClick={() => { close(); setListDlg('new') }}>{t('list.new')}</button>
              <button
                onClick={async () => {
                  close()
                  const n = await promptText(t('folder.name'))
                  if (n?.trim()) void data.addFolder(n.trim())
                }}
              >
                {t('folder.new')}
              </button>
            </div>
          )}
        </Popover>
      </div>

      {folders.map((f) => {
        const inside = userLists.filter((l) => l.folder_id === f.id)
        return (
          <div key={f.id} className="folder">
            <div className="side-item">
              <button className="side-btn" onClick={() => void data.updateFolder(f.id, { collapsed: !f.collapsed })}>
                <Icon name={f.collapsed ? 'right' : 'down'} size={13} />
                <span className="grow">{f.name}</span>
                <span className="count">{inside.length}</span>
              </button>
              <Popover align="right" trigger={(_o, toggle) => <button className="side-more" onClick={toggle} aria-label={t('common.more')}><Icon name="more" size={14} /></button>}>
                {(close) => (
                  <div className="menu">
                    <button onClick={async () => { close(); const n = await promptText(t('folder.name'), f.name); if (n?.trim()) void data.updateFolder(f.id, { name: n.trim() }) }}>{t('list.rename')}</button>
                    <button className="danger" onClick={async () => { close(); if (await confirmAsk(t('folder.confirmDelete', { name: f.name }))) void data.deleteFolder(f.id) }}>{t('list.delete')}</button>
                  </div>
                )}
              </Popover>
            </div>
            {!f.collapsed && inside.map((l) => listRow(l, true))}
          </div>
        )
      })}
      {loose.map((l) => listRow(l, false))}

      <div className="side-group">
        <span>{t('nav.filters')}</span>
        <button title={t('filter.new')} onClick={() => setFilterDlg('new')}><Icon name="plus" size={14} /></button>
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
          <Popover align="right" trigger={(_o, toggle) => <button className="side-more" onClick={toggle} aria-label={t('common.more')}><Icon name="more" size={14} /></button>}>
            {(close) => (
              <div className="menu">
                <button onClick={() => { close(); setFilterDlg(f) }}>{t('list.edit')}</button>
                <button className="danger" onClick={async () => { close(); if (await confirmAsk(t('list.confirmDelete', { name: f.name }))) { void data.deleteFilter(f.id); if (active === viewKey({ type: 'filter', id: f.id })) onView({ type: 'all' }) } }}>{t('list.delete')}</button>
              </div>
            )}
          </Popover>,
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
          countFor({ type: 'tag', id: tg.id }, ctx),
          null,
          null,
          <Popover align="right" trigger={(_o, toggle) => <button className="side-more" onClick={toggle} aria-label={t('common.more')}><Icon name="more" size={14} /></button>}>
            {(close) => (
              <div className="menu">
                <button onClick={async () => { close(); const n = await promptText(t('tag.rename'), tg.name); const v = n?.trim().replace(/^#/, ''); if (v && v !== tg.name) void data.updateTag(tg.id, { name: v }) }}>{t('list.rename')}</button>
                <button className="danger" onClick={async () => { close(); if (await confirmAsk(t('list.confirmDelete', { name: tg.name }))) { void data.deleteTag(tg.id); if (active === viewKey({ type: 'tag', id: tg.id })) onView({ type: 'all' }) } }}>{t('list.delete')}</button>
              </div>
            )}
          </Popover>,
        ),
      )}

      <div className="side-sep" />
      {row({ type: 'completed' }, 'checkSquare', t('nav.completed'))}
      {row({ type: 'trash' }, 'trash', t('nav.trash'))}

      {listDlg && <ListDialog list={listDlg === 'new' ? null : listDlg} onClose={() => setListDlg(null)} onCreated={(l) => onView({ type: 'list', id: l.id })} />}
      {filterDlg && <FilterDialog filter={filterDlg === 'new' ? null : filterDlg} onClose={() => setFilterDlg(null)} />}
    </aside>
  )
}

function ListDialog({ list, onClose, onCreated }: { list: List | null; onClose: () => void; onCreated: (l: List) => void }) {
  const { t } = useTranslation()
  const data = useData()
  const [name, setName] = useState(list?.name ?? '')
  const [emoji, setEmoji] = useState(list?.emoji ?? '')
  const [color, setColor] = useState<string | null>(list?.color ?? null)
  const [folder, setFolder] = useState(list?.folder_id ?? '')

  const save = async () => {
    const n = name.trim()
    if (!n) return
    if (list) await data.updateList(list.id, { name: n, emoji: emoji.trim() || null, color, folder_id: folder || null })
    else {
      const l = await data.addList(n, emoji.trim() || null, color)
      if (folder) await data.updateList(l.id, { folder_id: folder })
      onCreated(l)
    }
    onClose()
  }

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{list ? t('list.edit') : t('list.new')}</h3>
        <div className="row2">
          <input style={{ width: 64, textAlign: 'center' }} value={emoji} maxLength={4} placeholder="📁" onChange={(e) => setEmoji(e.target.value)} aria-label="emoji" />
          <input autoFocus style={{ flex: 1 }} value={name} placeholder={t('list.name')} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} />
        </div>
        <div className="chips">{EMOJIS.map((e) => <button key={e} onClick={() => setEmoji(e)}>{e}</button>)}</div>
        <label className="field">{t('list.color')}</label>
        <div className="swatches">
          <button className={'swatch none' + (color === null ? ' on' : '')} onClick={() => setColor(null)} aria-label={t('list.noColor')}>∅</button>
          {COLORS.map((c) => <button key={c} className={'swatch' + (c === color ? ' on' : '')} style={{ background: c }} onClick={() => setColor(c)} aria-label={c} />)}
        </div>
        {data.folders.length > 0 && (
          <>
            <label className="field">{t('folder.title')}</label>
            <select value={folder} onChange={(e) => setFolder(e.target.value)}>
              <option value="">{t('folder.none')}</option>
              {data.folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </>
        )}
        <div className="modal-actions">
          <button onClick={onClose}>{t('common.cancel')}</button>
          <button className="btn-primary" disabled={!name.trim()} onClick={() => void save()}>{t('common.save')}</button>
        </div>
      </div>
    </div>
  )
}

function FilterDialog({ filter, onClose }: { filter: FilterDef | null; onClose: () => void }) {
  const { t } = useTranslation()
  const data = useData()
  const [name, setName] = useState(filter?.name ?? '')
  const [rules, setRules] = useState<FilterRules>(filter?.rules ?? { date: 'any', status: 'open', listIds: [], tagIds: [], priorities: [] })

  const toggle = <K extends 'listIds' | 'tagIds' | 'priorities'>(k: K, v: NonNullable<FilterRules[K]>[number]) => {
    const cur = (rules[k] ?? []) as (string | number)[]
    setRules({ ...rules, [k]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] })
  }

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{filter ? t('list.edit') : t('filter.new')}</h3>
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
              if (filter) await data.updateFilter(filter.id, { name: name.trim(), rules })
              else await data.addFilter(name.trim(), rules)
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
