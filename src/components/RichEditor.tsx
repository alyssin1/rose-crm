import { useEffect, useRef } from 'react'
import { promptText } from './Dialogs'
import { useTranslation } from 'react-i18next'

const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'DEL', 'H1', 'H2', 'H3', 'P', 'DIV', 'BR', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'CODE', 'PRE', 'A', 'SPAN', 'MARK'])

/** Sanitiza o HTML do editor (só tags de formatação; sem scripts, estilos ou handlers). */
export function sanitize(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      if (!ALLOWED.has(child.tagName)) {
        const text = document.createTextNode(child.textContent ?? '')
        child.replaceWith(text)
        continue
      }
      for (const attr of Array.from(child.attributes)) {
        const keep = child.tagName === 'A' && attr.name === 'href' && /^(https?:|mailto:)/i.test(attr.value)
        if (!keep) child.removeAttribute(attr.name)
      }
      if (child.tagName === 'A') child.setAttribute('rel', 'noopener noreferrer')
      walk(child)
    }
  }
  walk(doc.body)
  return doc.body.innerHTML
}

/** Texto puro a partir do conteúdo (HTML sanitizado ou texto simples antigo). */
export const toPlain = (html: string) => new DOMParser().parseFromString(html, 'text/html').body.textContent ?? ''

const isHtml = (s: string) => /<\/?[a-z][\s\S]*>/i.test(s)
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
export const normalize = (s: string) => (isHtml(s) ? sanitize(s) : escapeHtml(s).replace(/\n/g, '<br>'))

const cmd = (name: string, value?: string) => document.execCommand(name, false, value)

interface Props {
  value: string
  placeholder?: string
  onCommit: (html: string) => void
  minHeight?: number
  toolbar?: boolean
}

export function RichEditor({ value, placeholder, onCommit, minHeight = 120, toolbar = true }: Props) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  const last = useRef(value)

  useEffect(() => {
    if (ref.current && (value !== last.current || ref.current.innerHTML === '')) {
      ref.current.innerHTML = normalize(value)
      last.current = value
    }
  }, [value])

  const commit = () => {
    if (!ref.current) return
    const html = sanitize(ref.current.innerHTML)
    const out = html === '<br>' ? '' : html
    if (out !== last.current) {
      last.current = out
      onCommit(out)
    }
  }

  const btn = (label: string, title: string, run: () => void) => (
    <button type="button" title={title} onMouseDown={(e) => e.preventDefault()} onClick={() => { run(); commit() }}>{label}</button>
  )

  return (
    <div className="rich">
      {toolbar && (
        <div className="rich-bar">
          {btn('H', t('editor.heading'), () => cmd('formatBlock', 'H2'))}
          {btn('B', t('editor.bold'), () => cmd('bold'))}
          {btn('I', t('editor.italic'), () => cmd('italic'))}
          {btn('U', t('editor.underline'), () => cmd('underline'))}
          {btn('S', t('editor.strike'), () => cmd('strikeThrough'))}
          {btn('•', t('editor.bullets'), () => cmd('insertUnorderedList'))}
          {btn('1.', t('editor.numbers'), () => cmd('insertOrderedList'))}
          {btn('❝', t('editor.quote'), () => cmd('formatBlock', 'BLOCKQUOTE'))}
          {btn('</>', t('editor.code'), () => cmd('formatBlock', 'PRE'))}
          {btn('🔗', t('editor.link'), () => {
            // guarda a seleção: o diálogo tira o foco do editor
            const sel = window.getSelection()
            const range = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null
            void promptText('URL', 'https://').then((url) => {
              if (!url || !/^(https?:|mailto:)/i.test(url)) return
              ref.current?.focus()
              if (range) {
                sel?.removeAllRanges()
                sel?.addRange(range)
              }
              cmd('createLink', url)
              commit()
            })
          })}
          {btn('Tx', t('editor.clear'), () => { cmd('removeFormat'); cmd('formatBlock', 'P') })}
        </div>
      )}
      <div
        ref={ref}
        className="rich-body"
        contentEditable
        suppressContentEditableWarning
        data-placeholder={placeholder}
        style={{ minHeight }}
        onBlur={commit}
        onPaste={(e) => {
          e.preventDefault()
          cmd('insertText', e.clipboardData.getData('text/plain'))
        }}
      />
    </div>
  )
}

/** Visualização somente leitura do conteúdo (sanitizado). */
export function RichView({ html }: { html: string }) {
  return <div className="rich-body ro" dangerouslySetInnerHTML={{ __html: normalize(html) }} />
}
