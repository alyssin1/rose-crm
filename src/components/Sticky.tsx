import { useEffect, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useTranslation } from 'react-i18next'
import { DataCtx, useData } from '../store/data'
import type { StickyNote } from '../lib/types'
import { Avatar, Icon } from './Icon'
import { Popover } from './Popover'
import { RichEditor, normalize, toPlain } from './RichEditor'
import type { Peer } from '../lib/types'
import { confirmAsk } from './Dialogs'

// Janela flutuante do navegador (Document Picture-in-Picture): sem barra de endereço e sempre por cima.
// ponytail: o navegador só permite uma janela dessas por vez; abrir outra nota troca a anterior.
const pip: { id: string | null; root: Root | null } = { id: null, root: null }
let rerenderPip: (() => void) | null = null
type PipApi = { requestWindow: (o: { width: number; height: number }) => Promise<Window> }

async function openPip(id: string, w: number, h: number) {
  const api = (window as unknown as { documentPictureInPicture?: PipApi }).documentPictureInPicture
  if (!api) return false
  const win = await api.requestWindow({ width: w, height: h })
  // leva os estilos e o tema do app para a janela nova
  for (const el of document.head.querySelectorAll('style, link[rel="stylesheet"]')) win.document.head.appendChild(el.cloneNode(true))
  win.document.documentElement.dataset.theme = document.documentElement.dataset.theme ?? 'dark'
  win.document.title = 'Rose'
  win.document.body.style.margin = '0'
  const host = win.document.body.appendChild(win.document.createElement('div'))
  host.className = 'pip-note'
  pip.root?.unmount()
  pip.id = id
  pip.root = createRoot(host)
  win.addEventListener('pagehide', () => {
    pip.root?.unmount()
    pip.root = null
    pip.id = null
  })
  rerenderPip?.()
  return true
}

export const NOTE_COLORS: Record<string, { bg: string; bar: string }> = {
  yellow: { bg: '#fff4a8', bar: '#f5e26b' },
  pink: { bg: '#ffd6e0', bar: '#f7a8bd' },
  blue: { bg: '#cfe6ff', bar: '#9ec8f5' },
  green: { bg: '#d4f5d0', bar: '#9fdc98' },
  purple: { bg: '#e3d6ff', bar: '#c4abf5' },
  gray: { bg: '#e8e8ee', bar: '#c9c9d3' },
}

/** amigos aceitos (para o @) */
export function useFriendPeers(): Peer[] {
  const data = useData()
  const ids = data.friends.filter((f) => f.status === 'accepted').map((f) => (f.requester === data.userId ? f.addressee : f.requester))
  return data.peers.filter((p) => ids.includes(p.user_id))
}
export const peerName = (p: Peer) => p.display_name || p.email?.split('@')[0] || '?'
const handleOf = (p: Peer) => peerName(p).split(' ')[0]
/** quem foi marcado no texto: "@Nome", "@Nome Sobrenome" ou "@usuario-do-email" */
const mentionedIn = (html: string, friends: Peer[]) => {
  const txt = toPlain(html).toLowerCase()
  return friends.filter((p) => [peerName(p), handleOf(p), p.email?.split('@')[0] ?? ''].some((n) => n && txt.includes('@' + n.toLowerCase()))).map((p) => p.user_id)
}

/** Nota individual: arrastável pelo cabeçalho, redimensionável, com cores e conteúdo rico. */
function Note({ note, floating }: { note: StickyNote; floating: boolean }) {
  const { t } = useTranslation()
  const data = useData()
  const friends = useFriendPeers()
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

  const popOut = async () => {
    const ok = await openPip(note.id, note.w, note.h).catch(() => false)
    if (!ok) window.open(`/#sticky=${note.id}`, `rose-note-${note.id}`, `popup,width=${note.w + 20},height=${note.h + 20}`)
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
        {friends.length > 0 && (
          <Popover trigger={(_o, toggle) => <button title={t('friends.mention')} onPointerDown={(e) => e.stopPropagation()} onClick={toggle}><b className="at">@</b></button>}>
            {(close) => (
              <div className="menu">
                {friends.map((p) => (
                  <button key={p.user_id} onClick={() => {
                    const html = (note.content || '') + `<p>@${handleOf(p)}&nbsp;</p>`
                    void data.updateNote(note.id, { content: html })
                    void data.mentionInNote(note.id, [p.user_id])
                    close()
                  }}>
                    <span className="peer-av"><Avatar url={p.avatar_url} name={peerName(p)} /></span> {peerName(p)}
                  </button>
                ))}
              </div>
            )}
          </Popover>
        )}
        {floating && <button title={t('sticky.popOut')} onPointerDown={(e) => e.stopPropagation()} onClick={() => void popOut()}><Icon name="link" size={13} /></button>}
        {floating && <button title={t('sticky.hide')} onPointerDown={(e) => e.stopPropagation()} onClick={() => void data.updateNote(note.id, { is_open: false })}><Icon name="x" size={13} /></button>}
        <button
          title={t('list.delete')}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={async () => {
            if (toPlain(note.content).trim() === '' || (await confirmAsk(t('sticky.confirmDelete')))) {
              void data.deleteNote(note.id)
              if (!floating) window.close()
            }
          }}
        >
          <Icon name="trash" size={13} />
        </button>
      </div>
      <div className="sticky-body">
        <RichEditor key={note.id} value={note.content} placeholder={t('sticky.placeholder')} onCommit={(html) => { void data.updateNote(note.id, { content: html }); const ids = mentionedIn(html, friends); if (ids.length) void data.mentionInNote(note.id, ids) }} toolbar={false} minHeight={60} />
      </div>
    </div>
  )
}

/** Camada com todas as notas abertas, por cima do app. */
export function StickyLayer() {
  const data = useData()
  const draw = () => {
    const n = pip.id ? data.notes.find((x) => x.id === pip.id) : null
    if (pip.root && n) pip.root.render(<DataCtx.Provider value={data}><Note note={n} floating={false} /></DataCtx.Provider>)
  }
  rerenderPip = draw
  useEffect(draw)
  return (
    <>
      {data.notes.filter((n) => n.is_open && n.user_id === data.userId).map((n) => (
        <Note key={n.id} note={n} floating />
      ))}
      {data.mentions
        .filter((m) => m.user_id === data.userId && !m.dismissed)
        .map((m, i) => {
          const n = data.notes.find((x) => x.id === m.note_id && x.user_id !== data.userId)
          return n ? <MentionNote key={n.id} note={n} index={i} /> : null
        })}
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

/** Nota de outra pessoa em que fui mencionado: aparece na hora, só leitura, até eu fechar. */
function MentionNote({ note, index }: { note: StickyNote; index: number }) {
  const { t } = useTranslation()
  const data = useData()
  const c = NOTE_COLORS[note.color] ?? NOTE_COLORS.yellow
  const from = data.peers.find((p) => p.user_id === note.user_id)
  return (
    <div className="sticky floating mention" role="dialog" style={{ background: c.bg, right: 24 + index * 16, top: 72 + index * 16, width: Math.max(260, note.w), height: Math.max(200, note.h), zIndex: 90 }}>
      <div className="sticky-bar" style={{ background: c.bar }}>
        <span className="peer-av"><Avatar url={from?.avatar_url} name={from ? peerName(from) : '?'} /></span>
        <b className="mention-from">{t('friends.mentionedYou', { name: from ? peerName(from) : '' })}</b>
        <div className="grow" />
        <button title={t('common.close')} onClick={() => void data.dismissMention(note.id)}><Icon name="x" size={13} /></button>
      </div>
      <div className="sticky-body"><div className="rich-body" dangerouslySetInnerHTML={{ __html: normalize(note.content || '') }} /></div>
    </div>
  )
}
