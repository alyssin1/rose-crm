import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useData } from '../store/data'
import { dueTone, formatDue } from '../lib/dates'
import { tagIdsOf } from '../lib/views'
import type { Activity, Attachment, Priority, Task } from '../lib/types'
import { DatePicker } from './DatePicker'
import { Icon } from './Icon'
import { Popover } from './Popover'
import { RichEditor, toPlain } from './RichEditor'
import { NSelect } from './Select'
import { TaskPeople } from './Social'

const PRIORITIES: Priority[] = [5, 3, 1, 0]
const kb = (n: number | null) => (n == null ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

interface Props {
  taskId: string
  onClose: () => void
}

export function TaskDetail({ taskId, onClose }: Props) {
  const { t, i18n } = useTranslation()
  const data = useData()
  const task = data.tasks.find((x) => x.id === taskId)
  const [title, setTitle] = useState(task?.title ?? '')
  const [subDraft, setSubDraft] = useState('')
  const [tagDraft, setTagDraft] = useState('')
  const [atts, setAtts] = useState<Attachment[]>([])
  const [uploading, setUploading] = useState(false)
  const [activity, setActivity] = useState<Activity[] | null>(null)
  const [saved, setSaved] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTitle(task?.title ?? '')
    setSubDraft('')
    setTagDraft('')
    setAtts([])
    if (navigator.onLine) void data.listAttachments(taskId).then(setAtts)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId])

  if (!task) return <div className="detail empty" />
  const trashed = !!task.deleted_at
  const tone = dueTone(task)
  const subs = data.tasks.filter((x) => x.parent_id === task.id && !x.deleted_at).sort((a, b) => a.sort_order - b.sort_order)
  const tagIds = tagIdsOf(data, task.id)
  const tagList = tagIds.map((id) => data.tags.find((x) => x.id === id)).filter(Boolean)
  const lang = i18n.language.slice(0, 2)
  const gcals = data.googleCalendars.filter((c) => c.enabled)

  const save = (patch: Partial<Task>) => data.updateTask(task.id, patch)

  const addSub = async () => {
    const v = subDraft.trim()
    if (!v) return
    setSubDraft('')
    await data.addTask({ title: v, parent_id: task.id, list_id: task.list_id, sort_order: Date.now() })
  }

  const addTag = async () => {
    const v = tagDraft.trim().replace(/^#/, '')
    setTagDraft('')
    if (!v) return
    const tg = await data.ensureTag(v)
    if (!tagIds.includes(tg.id)) await data.setTaskTags(task.id, [...tagIds, tg.id])
  }

  const upload = async (files: FileList | null) => {
    if (!files?.length) return
    setUploading(true)
    for (const f of Array.from(files)) {
      const a = await data.uploadAttachment(task.id, f)
      if (a) setAtts((p) => [...p, a])
    }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const openAttachment = async (a: Attachment) => {
    const url = await data.attachmentUrl(a)
    if (url) window.open(url, '_blank', 'noopener')
  }

  const exportMd = () => {
    const md = `# ${task.title}\n\n${task.due_at ? `- ${t('detail.dueDate')}: ${formatDue(task, lang, t)}\n` : ''}${subs.map((s) => `- [${s.status === 1 ? 'x' : ' '}] ${s.title}`).join('\n')}\n\n${toPlain(task.content)}\n`
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }))
    a.download = `${task.title || 'task'}.md`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const describe = (a: Activity) => {
    const d = a.detail as Record<string, string | number | null>
    const list = (id: unknown) => data.lists.find((l) => l.id === id)?.name ?? ''
    const date = (v: unknown) => (v ? new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(String(v))) : '—')
    switch (a.action) {
      case 'title': return t('activity.title', { from: d.from, to: d.to })
      case 'due': return t('activity.due', { from: date(d.from), to: date(d.to) })
      case 'priority': return t('activity.priority', { from: t(`priority.${d.from}`), to: t(`priority.${d.to}`) })
      case 'list': return t('activity.list', { to: list(d.to) || t('nav.inbox') })
      case 'attached': return t('activity.attached', { name: d.name })
      default: return t(`activity.${a.action}`)
    }
  }

  const flagColor = task.priority === 5 ? 'var(--p-high)' : task.priority === 3 ? 'var(--p-med)' : task.priority === 1 ? 'var(--p-low)' : 'currentColor'

  return (
    <aside className="detail">
      <div className="detail-top">
        <button className="icon-btn detail-close" onClick={onClose} aria-label="←"><Icon name="left" size={18} /></button>
        <button className={`check p${task.priority}` + (task.status === 1 ? ' on' : task.status === 2 ? ' wont' : '')} onClick={() => !trashed && data.toggleDone(task)} aria-label={t('task.complete')}>
          {task.status === 1 && <Icon name="check" size={11} />}
          {task.status === 2 && <Icon name="x" size={11} />}
        </button>
        <span className="sep" />

        <Popover
          trigger={(_o, toggle) => (
            <button className={'chip ' + (task.due_at ? tone : '')} onClick={toggle}>
              <Icon name="calendar" size={14} /> {task.due_at ? formatDue(task, lang, t) : t('detail.dueDate')}
            </button>
          )}
        >
          {(close) => (
            <DatePicker
              task={task}
              weekStart={data.profile?.week_start ?? 0}
              onClose={close}
              onApply={(p) => {
                void save(p)
                close()
              }}
            />
          )}
        </Popover>

        <div className="grow" />
        <Popover
          align="right"
          trigger={(_o, toggle) => (
            <button className="icon-btn" onClick={toggle} title={t('priority.title')} style={{ color: flagColor }}>
              <Icon name="flag" size={16} />
            </button>
          )}
        >
          {(close) => (
            <div className="menu">
              {PRIORITIES.map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    void save({ priority: p })
                    close()
                  }}
                >
                  <Icon name="flag" size={14} className={`pf p${p}`} /> {t(`priority.${p}`)} {task.priority === p && <Icon name="check" size={14} />}
                </button>
              ))}
            </div>
          )}
        </Popover>
      </div>

      <div className="detail-body">
        <input className="detail-title" value={title} placeholder={t('detail.titlePh')} onChange={(e) => setTitle(e.target.value)} onBlur={() => title !== task.title && save({ title })} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
        <RichEditor key={task.id} value={task.content} placeholder={t('detail.contentPh')} onCommit={(html) => save({ content: html })} minHeight={110} />
        <TaskPeople task={task} />

        {(subs.length > 0 || subDraft !== '') && <div className="detail-label">{t('detail.subtasks')}</div>}
        {subs.map((s) => (
          <div key={s.id} className={'sub-row' + (s.status !== 0 ? ' done' : '')}>
            <button className={'check p0' + (s.status === 1 ? ' on' : '')} onClick={() => data.toggleDone(s)} aria-label={t('task.complete')}>
              {s.status === 1 && <Icon name="check" size={11} />}
            </button>
            <input defaultValue={s.title} onBlur={(e) => e.target.value !== s.title && data.updateTask(s.id, { title: e.target.value })} />
            <button className="icon-btn" onClick={() => data.trashTask(s.id)} title={t('detail.delete')}><Icon name="x" size={13} /></button>
          </div>
        ))}
        <div className="sub-row add">
          <Icon name="plus" size={14} />
          <input value={subDraft} placeholder={t('detail.addSubtask')} onChange={(e) => setSubDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void addSub()} />
        </div>

        {(atts.length > 0 || uploading) && <div className="detail-label">{t('detail.attachments')}</div>}
        {atts.map((a) => (
          <div key={a.id} className="attach">
            <Icon name="paperclip" size={14} />
            <a href="#" onClick={(e) => { e.preventDefault(); void openAttachment(a) }}>{a.name}</a>
            <small>{kb(a.size_bytes)}</small>
            <button className="icon-btn" title={t('detail.delete')} onClick={async () => { await data.deleteAttachment(a); setAtts((p) => p.filter((x) => x.id !== a.id)) }}><Icon name="x" size={13} /></button>
          </div>
        ))}
        {uploading && <small className="detail-label">…</small>}
        <input ref={fileRef} type="file" multiple hidden onChange={(e) => void upload(e.target.files)} />

        <div className="detail-tags">
          {tagList.map((tg) => (
            <span key={tg!.id} className="tag-chip">
              #{tg!.name}
              <button onClick={() => data.setTaskTags(task.id, tagIds.filter((x) => x !== tg!.id))} aria-label="×"><Icon name="x" size={11} /></button>
            </span>
          ))}
          <input value={tagDraft} placeholder={'# ' + t('detail.addTag')} onChange={(e) => setTagDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void addTag()} />
        </div>
      </div>

      <div className="detail-foot">
        <Icon name="list" size={14} />
        <NSelect value={task.list_id ?? ''} onChange={(e) => save({ list_id: e.target.value || null })}>
          {data.lists.map((l) => <option key={l.id} value={l.id}>{l.emoji ?? ''} {l.is_inbox ? t('nav.inbox') : l.name}</option>)}
        </NSelect>
        {gcals.length > 0 && (
          <>
            <Icon name="calendar" size={14} />
            <NSelect value={task.google_calendar_id ?? ''} onChange={(e) => save({ google_calendar_id: e.target.value || null })} title={t('google.calendar')}>
              <option value="">{t('google.noCalendar')}</option>
              {gcals.map((c) => <option key={c.id} value={c.google_calendar_id}>{c.name}</option>)}
            </NSelect>
          </>
        )}
        <div className="grow" />
        {trashed && <button onClick={() => data.restoreTask(task.id)}>{t('trash.restore')}</button>}
        <Popover
          align="right"
          up
          trigger={(_o, toggle) => <button className="icon-btn" onClick={toggle} title={t('common.more')}><Icon name="more" size={17} /></button>}
        >
          {(close) => {
            const go = (fn: () => void) => () => {
              fn()
              close()
            }
            return (
              <div className="menu wide">
                <button onClick={go(() => document.querySelector<HTMLInputElement>('.sub-row.add input')?.focus())}><Icon name="plus" size={15} /> {t('detail.addSubtask')}</button>
                <button onClick={go(() => void save({ pinned: !task.pinned }))}><Icon name="pin" size={15} /> {task.pinned ? t('detail.unpin') : t('detail.pin')}</button>
                <button onClick={go(() => void data.setWontDo(task))}><Icon name="slash" size={15} /> {t('detail.wontDo')}</button>
                <button onClick={go(() => document.querySelector<HTMLInputElement>('.detail-tags input')?.focus())}><Icon name="tag" size={15} /> {t('nav.tags')}</button>
                <button disabled={!data.online} onClick={go(() => fileRef.current?.click())}><Icon name="paperclip" size={15} /> {t('detail.attach')}</button>
                <button disabled={!data.online} onClick={go(() => void data.listActivity(task.id).then(setActivity))}><Icon name="clock" size={15} /> {t('detail.activity')}</button>
                <button onClick={go(() => { void data.saveTemplate(task); setSaved(true); setTimeout(() => setSaved(false), 1800) })}><Icon name="copy" size={15} /> {t('detail.saveTemplate')}</button>
                <button onClick={go(() => void data.duplicateTask(task))}><Icon name="copy" size={15} /> {t('detail.duplicate')}</button>
                <button onClick={go(() => void navigator.clipboard?.writeText(`${location.origin}/#task=${task.id}`))}><Icon name="link" size={15} /> {t('detail.copyLink')}</button>
                <button onClick={go(() => void save({ kind: task.kind === 'note' ? 'task' : 'note' }))}><Icon name="note" size={15} /> {task.kind === 'note' ? t('detail.toTask') : t('detail.toNote')}</button>
                <button onClick={go(exportMd)}><Icon name="download" size={15} /> {t('detail.export')}</button>
                <button onClick={go(() => window.print())}><Icon name="print" size={15} /> {t('detail.print')}</button>
                <button
                  className="danger"
                  onClick={go(() => {
                    void data.trashTask(task.id)
                    onClose()
                  })}
                >
                  <Icon name="trash" size={15} /> {t('detail.delete')}
                </button>
              </div>
            )
          }}
        </Popover>
      </div>

      {saved && <div className="toast ok">{t('template.saved')}</div>}

      {activity && (
        <div className="modal-back" onMouseDown={() => setActivity(null)}>
          <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
            <h3>{t('detail.activity')}</h3>
            {activity.length === 0 && <p className="empty">—</p>}
            <ul className="activity">
              {activity.map((a) => (
                <li key={a.id}>
                  <span>{describe(a)}</span>
                  <small>{new Intl.DateTimeFormat(lang, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(a.created_at))}</small>
                </li>
              ))}
            </ul>
            <div className="modal-actions"><button onClick={() => setActivity(null)}>{t('common.cancel')}</button></div>
          </div>
        </div>
      )}
    </aside>
  )
}
