import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

type Req = { kind: 'prompt' | 'confirm'; title: string; initial?: string; danger?: boolean; resolve: (v: string | boolean | null) => void }
let push: ((r: Req) => void) | null = null

/** Pergunta um texto ao usuário (null se cancelar). Cai no prompt do navegador se o host não estiver montado. */
export const promptText = (title: string, initial = ''): Promise<string | null> =>
  new Promise((res) => {
    if (!push) return res(window.prompt(title, initial))
    push({ kind: 'prompt', title, initial, resolve: (v) => res(v as string | null) })
  })

export const confirmAsk = (message: string, danger = true): Promise<boolean> =>
  new Promise((res) => {
    if (!push) return res(window.confirm(message))
    push({ kind: 'confirm', title: message, danger, resolve: (v) => res(!!v) })
  })

export function DialogHost() {
  const { t } = useTranslation()
  const [req, setReq] = useState<Req | null>(null)
  const [text, setText] = useState('')
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    push = (r) => {
      setText(r.initial ?? '')
      setReq(r)
    }
    return () => {
      push = null
    }
  }, [])
  useEffect(() => void input.current?.select(), [req])

  if (!req) return null
  const done = (v: string | boolean | null) => {
    req.resolve(v)
    setReq(null)
  }
  return (
    <div className="modal-back dlg" onMouseDown={() => done(req.kind === 'prompt' ? null : false)}>
      <div className="modal small" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{req.title}</h3>
        {req.kind === 'prompt' && (
          <input
            ref={input}
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') done(text)
              if (e.key === 'Escape') done(null)
            }}
          />
        )}
        <div className="modal-actions">
          <button onClick={() => done(req.kind === 'prompt' ? null : false)}>{t('common.cancel')}</button>
          <button className={req.danger && req.kind === 'confirm' ? 'btn-danger' : 'btn-primary'} autoFocus={req.kind === 'confirm'} onClick={() => done(req.kind === 'prompt' ? text : true)}>
            {req.kind === 'confirm' ? t('common.confirm') : t('common.ok')}
          </button>
        </div>
      </div>
    </div>
  )
}
