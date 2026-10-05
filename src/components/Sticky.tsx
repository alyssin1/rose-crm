import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useData } from '../store/data'
import type { StickyNote } from '../lib/types'
import { Icon } from './Icon'
import { Popover } from './Popover'
import { RichEditor, toPlain } from './RichEditor'

export const NOTE_COLORS: Record<string, { bg: string; bar: string }> = {
  yellow: { bg: '#fff4a8', bar: '#f5e26b' },
  pink: { bg: '#ffd6e0', bar: '#f7a8bd' },
  blue: { bg: '#cfe6ff', bar: '#9ec8f5' },
  green: { bg: '#d4f5d0', bar: '#9fdc98' },
  purple: { bg: '#e3d6ff', bar: '#c4abf5' },
  gray: { bg: '#e8e8ee', bar: '#c9c9d3' },
}

/** Nota individual: arrastável pelo cabeçalho, redimensionável, com cores e conteúdo rico. */
function Note({ note, floating }: { note: StickyNote; floating: boolean }) {
  const { t } = useTranslation()
  const data = useData()
  const [pos, setPos] = useState({ x: note.x, y: note.y })
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  const box = useRef<HTMLDivElement>(null)
  const c = NOTE_COLORS[note.color] ?? NOTE_COLORS.yellow

  useEffect(() => setPos({ x: note.x, y: note.y }), [note.x, note.y])

  const down = (e: React.PointerEvent) => {
    if (!floating) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y }
    void data.updateNote(note.id, { z: Date.now() % 100000000 })
  }
  const move = (e: React.PointerEvent) => {
    if (!drag.current) return
    setPos({ x: Math.max(0, Math.min(window.innerWidth - 80, e.clientX - drag.current.dx)), y: Math.max(0, Math.min(window.innerHeight - 40, e.clientY - drag.current.dy)) })
  }
  const up = () => {
    if (!drag.current) return
    drag.current = null
    void data.updateNote(note.id, { x: Math.round(pos.x), y: Math.round(pos.y) })
  }
  const saveSize = () => {
    const el = box.current
    if (!el || !floating) return
    const w = Math.round(el.offsetWidth)
    const h = Math.round(el.offsetHeight)
    if (w !== note.w || h !== note.h) void data.updateNote(note.id, { w, h })
  }

  const popOut = () => {
    window.open(`/#sticky=${note.id}`, `rose-note-${note.id}`, `popup,width=${note.w + 20},height=${note.h + 20}`)
    void data.updateNote(note.id, { is_open: false }) // sai da tela principal; fica só na janela
  }

  return (
    <div
      ref={box}
      className={'sticky' + (floating ? ' floating' : ' window')}
      style={{ background: c.bg, ...(floating ? { left: pos.x, top: pos.y, width: note.w, height: note.h, zIndex: 40 + (note.z % 1000) } : {}) }}
      onMouseUp={saveSize}
    >
      <div className="sticky-bar" style={{ background: c.bar }} onPointerDown={down} onPointerMove={move} onPointerUp={up}>
        <Popover trigger={(_o, toggle) => <button title={t('sticky.color')} onPointerDown={(e) => e.stopPropagation()} onClick={toggle}><i className="swatch" style={{ background: c.bg }} /></button>}>
          {(close) => (
            <div className="swatches">
              {Object.entries(NOTE_COLORS).map(([k, v]) => (
                <button key={k} className="swatch" style={{ background: v.bg }} onClick={() => { void data.updateNote(note.id, { color: k }); close() }} aria-label={k} />
              ))}
            </div>
          )}
        </Popover>
        <div className="grow" />
        {floating && <button title={t('sticky.popOut')} onPointerDown={(e) => e.stopPropagation()} onClick={popOut}><Icon name="link" size={13} /></button>}
        {floating && <button title={t('sticky.hide')} onPointerDown={(e) => e.stopPropagation()} onClick={() => void data.updateNote(note.id, { is_open: false })}><Icon name="x" size={13} /></button>}
        <button
          title={t('list.delete')}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={() => {
            if (toPlain(note.content).trim() === '' || window.confirm(t('sticky.confirmDelete'))) {
              void data.deleteNote(note.id)
              if (!floating) window.close()
            }
          }}
        >
          <Icon name="trash" size={13} />
        </button>
      </div>
      <div className="sticky-body">
        <RichEditor key={note.id} value={note.content} placeholder={t('sticky.placeholder')} onCommit={(html) => void data.updateNote(note.id, { content: html })} toolbar={false} minHeight={60} />
      </div>
    </div>
  )
}

/** Camada com todas as notas abertas, por cima do app. */
export function StickyLayer() {
  const data = useData()
  return (
    <>
      {data.notes.filter((n) => n.is_open).map((n) => (
        <Note key={n.id} note={n} floating />
      ))}
    </>
  )
}

/** Lista de notas (abrir/ocultar/excluir) + criar nova. */
export function StickyMenu() {
  const { t } = useTranslation()
  const data = useData()
  return (
    <div className="menu wide sticky-menu">
      <button onClick={() => void data.addNote()}><Icon name="plus" size={15} /> {t('sticky.new')}</button>
      {data.notes.length === 0 && <div className="menu-title">{t('sticky.none')}</div>}
      {data.notes.map((n) => {
        const text = toPlain(n.content).trim().split('\n')[0] || t('sticky.empty')
        return (
          <div key={n.id} className="tpl-row">
            <button onClick={() => void data.updateNote(n.id, { is_open: !n.is_open })}>
              <i className="swatch" style={{ background: (NOTE_COLORS[n.color] ?? NOTE_COLORS.yellow).bg }} /> {text.slice(0, 40)} {n.is_open && <Icon name="check" size={13} />}
            </button>
            <button className="icon-btn" title={t('list.delete')} onClick={() => void data.deleteNote(n.id)}><Icon name="x" size={12} /></button>
          </div>
        )
      })}
    </div>
  )
}

/** Janela própria de uma nota (aberta com "destacar"). */
export function StickyWindow({ id }: { id: string }) {
  const data = useData()
  const note = data.notes.find((n) => n.id === id)
  if (!note) return <div className="login"><p>…</p></div>
  return <Note note={note} floating={false} />
}
