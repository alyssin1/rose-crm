import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useData } from '../store/data'
import { addDays, formatDue, startOfDay } from '../lib/dates'
import { tagIdsOf } from '../lib/views'
import type { Task } from '../lib/types'
import { RichEditor, sanitize, toPlain } from './RichEditor'
import { Icon } from './Icon'
import { Popover } from './Popover'
import { NSelect } from './Select'

type RangeKey = 'today' | 'yesterday' | 'week' | 'lastWeek' | 'month' | 'lastMonth' | 'last7' | 'last30'
type Grouping = 'status' | 'list' | 'date' | 'none'
type Field = 'date' | 'list' | 'tags' | 'priority'
type StatusF = 'all' | 'done' | 'open'
type Preset = 'blank' | 'daily' | 'weekly'

const RANGES: RangeKey[] = ['today', 'yesterday', 'week', 'lastWeek', 'month', 'lastMonth', 'last7', 'last30']
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function rangeBounds(k: RangeKey, weekStart: number): [Date, Date] {
  const today = startOfDay(new Date())
  const wk = (d: Date) => addDays(d, -((d.getDay() - weekStart + 7) % 7))
  switch (k) {
    case 'today': return [today, today]
    case 'yesterday': return [addDays(today, -1), addDays(today, -1)]
    case 'week': return [wk(today), addDays(wk(today), 6)]
    case 'lastWeek': return [addDays(wk(today), -7), addDays(wk(today), -1)]
    case 'month': return [new Date(today.getFullYear(), today.getMonth(), 1), new Date(today.getFullYear(), today.getMonth() + 1, 0)]
    case 'lastMonth': return [new Date(today.getFullYear(), today.getMonth() - 1, 1), new Date(today.getFullYear(), today.getMonth(), 0)]
    case 'last7': return [addDays(today, -6), today]
    default: return [addDays(today, -29), today]
  }
}

export function Summary({ weekStart = 0, onToggleSidebar }: { weekStart?: number; onToggleSidebar?: () => void }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language.slice(0, 2)
  const data = useData()
  const [range, setRange] = useState<RangeKey>('week')
  const [listId, setListId] = useState('')
  const [status, setStatus] = useState<StatusF>('all')
  const [priorityOnly, setPriorityOnly] = useState(false)
  const [grouping, setGrouping] = useState<Grouping>('status')
  const [fields, setFields] = useState<Field[]>(['date', 'list', 'tags'])
  const [next, setNext] = useState(false)
  const [preset, setPreset] = useState<Preset>('blank')
  const [html, setHtml] = useState('')
  const [copied, setCopied] = useState(false)

  const [from, to] = rangeBounds(range, weekStart)
  const dayFmt = (d: Date) => new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' }).format(d)
  const inRange = (iso: string | null, a = from, b = to) => !!iso && new Date(iso) >= a && new Date(iso) < addDays(b, 1)

  const generated = useMemo(() => {
    // eventos do Google só da(s) agenda(s) própria(s); agendas de outras pessoas ficam de fora do resumo
    const own = new Set(data.googleCalendars.filter((g) => g.access_role === 'owner').map((g) => g.google_calendar_id))
    const base = data.tasks.filter((x) => !x.deleted_at && !x.parent_id && x.kind !== 'note' && (!x.google_calendar_id || own.has(x.google_calendar_id)) && (!listId || x.list_id === listId) && (!priorityOnly || x.priority > 0))
    const done = base.filter((x) => x.status === 1 && inRange(x.completed_at))
    const open = base.filter((x) => x.status === 0 && inRange(x.due_at))
    const sel: Task[] = status === 'done' ? done : status === 'open' ? open : [...done, ...open]

    const line = (x: Task) => {
      const bits: string[] = []
      if (fields.includes('date') && x.due_at) bits.push(formatDue(x, lang, t))
      if (fields.includes('list')) { const l = data.lists.find((y) => y.id === x.list_id); bits.push(l ? (l.is_inbox ? t('nav.inbox') : l.name) : '') }
      if (fields.includes('tags')) bits.push(tagIdsOf(data, x.id).map((id) => '#' + (data.tags.find((g) => g.id === id)?.name ?? '')).join(' '))
      if (fields.includes('priority') && x.priority) bits.push(t(`priority.${x.priority}`))
      const meta = bits.filter(Boolean).join(' · ')
      return `<li>${esc(x.title)}${meta ? ` <i>(${esc(meta)})</i>` : ''}</li>`
    }
    const block = (title: string, items: Task[]) => (items.length ? `<h3>${esc(title)}</h3><ul>${items.map(line).join('')}</ul>` : '')

    let out = `<h2>${esc(dayFmt(from))}${from.getTime() === to.getTime() ? '' : ' – ' + esc(dayFmt(to))}</h2>`
    if (preset === 'daily') out += `<p>${esc(t('summary.p.daily'))}</p>`
    if (preset === 'weekly') out += `<p>${esc(t('summary.p.weekly'))}</p>`
    if (grouping === 'status') out += block(t('summary.done'), sel.filter((x) => x.status === 1)) + block(t('summary.undone'), sel.filter((x) => x.status === 0))
    else if (grouping === 'list') {
      const ids = [...new Set(sel.map((x) => x.list_id ?? ''))]
      for (const id of ids) { const l = data.lists.find((y) => y.id === id); out += block(l ? (l.is_inbox ? t('nav.inbox') : l.name) : t('group.noList'), sel.filter((x) => (x.list_id ?? '') === id)) }
    } else if (grouping === 'date') {
      const days = [...new Set(sel.map((x) => startOfDay(new Date(x.status === 1 ? x.completed_at ?? x.updated_at : x.due_at ?? x.updated_at)).getTime()))].sort()
      for (const d of days) out += block(dayFmt(new Date(d)), sel.filter((x) => startOfDay(new Date(x.status === 1 ? x.completed_at ?? x.updated_at : x.due_at ?? x.updated_at)).getTime() === d))
    } else out += `<ul>${sel.map(line).join('')}</ul>`
    if (!sel.length) out += `<p>${esc(t('summary.empty'))}</p>`

    if (next) {
      const len = Math.round((to.getTime() - from.getTime()) / 86400000) + 1
      const nf = addDays(to, 1)
      const nt = addDays(to, len)
      const upcoming = base.filter((x) => x.status === 0 && inRange(x.due_at, nf, nt))
      out += block(`${t('summary.next')} (${dayFmt(nf)} – ${dayFmt(nt)})`, upcoming)
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.tasks, data.googleCalendars, data.lists, data.tags, data.taskTags, range, listId, status, priorityOnly, grouping, fields, next, preset, lang])

  useEffect(() => setHtml(generated), [generated])

  const copy = async () => {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ 'text/html': new Blob([sanitize(html)], { type: 'text/html' }), 'text/plain': new Blob([toPlain(html)], { type: 'text/plain' }) }),
      ])
    } catch {
      await navigator.clipboard.writeText(toPlain(html))
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const download = (kind: 'html' | 'txt') => {
    const body = kind === 'html' ? `<!doctype html><meta charset="utf-8"><title>Rose</title>${sanitize(html)}` : toPlain(html)
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([body], { type: kind === 'html' ? 'text/html' : 'text/plain' }))
    a.download = `rose-${t('nav.summary').toLowerCase()}.${kind}`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const toggleField = (f: Field) => setFields((p) => (p.includes(f) ? p.filter((x) => x !== f) : [...p, f]))

  return (
    <section className="summary">
      <div className="summary-main">
        <header className="tasks-head">
          {onToggleSidebar && <button className="icon-btn" onClick={onToggleSidebar} title={t('common.toggleSidebar')}><Icon name="sidebar" size={18} /></button>}
          <h2>{t('nav.summary')}</h2>
        </header>
        <div className="summary-editor">
          <RichEditor value={html} onCommit={setHtml} minHeight={360} />
        </div>
        <div className="summary-foot">
          <Popover up trigger={(_o, toggle) => <button onClick={toggle}><Icon name="download" size={14} /> {t('summary.saveAs')}</button>}>
            {(close) => (
              <div className="menu">
                <button onClick={() => { download('html'); close() }}>HTML</button>
                <button onClick={() => { download('txt'); close() }}>{t('summary.text')}</button>
                <button onClick={() => { close(); window.print() }}>PDF ({t('detail.print')})</button>
              </div>
            )}
          </Popover>
          <button onClick={copy}><Icon name="copy" size={14} /> {copied ? t('summary.copied') : t('summary.copyAs')}</button>
        </div>
      </div>

      <aside className="summary-side">
        <div className="sum-label">{t('summary.template')}</div>
        <div className="chips">
          {(['blank', 'daily', 'weekly'] as const).map((p) => (
            <button key={p} className={preset === p ? 'on' : ''} onClick={() => { setPreset(p); if (p === 'daily') setRange('today'); if (p === 'weekly') setRange('week') }}>{t(`summary.t.${p}`)}</button>
          ))}
        </div>

        <div className="sum-label">{t('summary.filter')}</div>
        <div className="sum-box">
          <Row label={t('summary.date')}><NSelect value={range} onChange={(e) => setRange(e.target.value as RangeKey)}>{RANGES.map((r) => <option key={r} value={r}>{t(`summary.r.${r}`)}</option>)}</NSelect></Row>
          <Row label={t('nav.lists')}>
            <NSelect value={listId} onChange={(e) => setListId(e.target.value)}>
              <option value="">{t('summary.allLists')}</option>
              {data.lists.map((l) => <option key={l.id} value={l.id}>{l.is_inbox ? t('nav.inbox') : l.name}</option>)}
            </NSelect>
          </Row>
          <Row label={t('filter.status')}>
            <NSelect value={status} onChange={(e) => setStatus(e.target.value as StatusF)}>
              <option value="all">{t('summary.s.all')}</option><option value="done">{t('summary.done')}</option><option value="open">{t('summary.undone')}</option>
            </NSelect>
          </Row>
          <Row label={t('summary.more')}>
            <NSelect value={priorityOnly ? 'p' : ''} onChange={(e) => setPriorityOnly(e.target.value === 'p')}>
              <option value="">{t('summary.none')}</option><option value="p">{t('summary.withPriority')}</option>
            </NSelect>
          </Row>
        </div>

        <div className="sum-label">{t('summary.display')}</div>
        <div className="sum-box">
          <Row label={t('summary.grouping')}>
            <NSelect value={grouping} onChange={(e) => setGrouping(e.target.value as Grouping)}>
              <option value="status">{t('summary.g.status')}</option><option value="list">{t('summary.g.list')}</option><option value="date">{t('summary.g.date')}</option><option value="none">{t('sort.g.none')}</option>
            </NSelect>
          </Row>
          <Row label={t('summary.fields')}>
            <Popover align="right" trigger={(_o, toggle) => <button className="sel-btn" onClick={toggle}>{t('summary.selected', { n: fields.length })}</button>}>
              {() => (
                <div className="menu">
                  {(['date', 'list', 'tags', 'priority'] as const).map((f) => (
                    <label key={f} className="menu-check"><input type="checkbox" checked={fields.includes(f)} onChange={() => toggleField(f)} /> {t(`summary.f.${f}`)}</label>
                  ))}
                </div>
              )}
            </Popover>
          </Row>
        </div>

        <label className="sum-toggle">
          <span>{t('summary.nextPeriod')}</span>
          <input type="checkbox" checked={next} onChange={(e) => setNext(e.target.checked)} />
        </label>
      </aside>
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="sum-row">
      <span>{label}</span>
      {children}
    </div>
  )
}
