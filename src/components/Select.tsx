import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Icon } from './Icon'

export interface Option<V extends string | number = string> {
  value: V
  label: string
  hint?: string // texto secundário à direita
  icon?: string // emoji ou caractere à esquerda
}

interface Props<V extends string | number> {
  value: V
  options: Option<V>[]
  onChange: (v: V) => void
  placeholder?: string
  className?: string
  disabled?: boolean
  align?: 'left' | 'right'
  minWidth?: number
  searchPlaceholder?: string
  ariaLabel?: string
}

/** Seletor próprio: botão + lista flutuante escura, com teclado (↑ ↓ Enter Esc) e busca quando há muitas opções. */
export function Select<V extends string | number>({ value, options, onChange, placeholder, className = '', disabled, align = 'left', minWidth = 0, searchPlaceholder = '…', ariaLabel }: Props<V>) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean }>({ left: 0, top: 0, width: 0, up: false })
  const btn = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const current = options.find((o) => o.value === value)
  const searchable = options.length > 8
  const list = useMemo(() => (q ? options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())) : options), [options, q])

  const close = () => {
    setOpen(false)
    setQ('')
  }

  useLayoutEffect(() => {
    if (!open || !btn.current) return
    const r = btn.current.getBoundingClientRect()
    const width = Math.max(r.width, minWidth, 180)
    const h = Math.min(320, list.length * 34 + 12 + (searchable ? 44 : 0))
    const up = r.bottom + h + 12 > window.innerHeight && r.top > h
    const left = align === 'right' ? Math.max(8, r.right - width) : Math.min(r.left, window.innerWidth - width - 8)
    setPos({ left, top: up ? r.top - 6 : r.bottom + 6, width, up })
  }, [open, align, minWidth, list.length, searchable])

  useEffect(() => {
    if (!open) return
    setActive(Math.max(0, list.findIndex((o) => o.value === value)))
    const onDown = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) close()
    }
    const onScroll = (e: Event) => {
      if (!panel.current?.contains(e.target as Node)) close()
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('.sel-opt.act')?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  const choose = (o: Option<V>) => {
    onChange(o.value)
    close()
    btn.current?.focus()
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault()
        setOpen(true)
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      btn.current?.focus()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(list.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (list[active]) choose(list[active])
    }
  }

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={'sel-btn2 ' + className + (open ? ' open' : '')}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKey}
      >
        <span className="sel-label">{current ? <>{current.icon && <i className="sel-ico">{current.icon}</i>}{current.label}</> : <em>{placeholder ?? ''}</em>}</span>
        <Icon name="down" size={14} className="sel-chev" />
      </button>
      {open && (
        <div
          ref={panel}
          role="listbox"
          className="sel-panel"
          style={{ left: pos.left, top: pos.top, width: pos.width, transform: pos.up ? 'translateY(-100%)' : undefined }}
          onKeyDown={onKey}
        >
          {searchable && (
            <input
              autoFocus
              className="sel-search"
              value={q}
              placeholder={searchPlaceholder}
              onChange={(e) => {
                setQ(e.target.value)
                setActive(0)
              }}
            />
          )}
          <div className="sel-list">
            {list.length === 0 && <div className="sel-none">—</div>}
            {list.map((o, i) => (
              <button
                key={String(o.value)}
                type="button"
                role="option"
                aria-selected={o.value === value}
                className={'sel-opt' + (i === active ? ' act' : '') + (o.value === value ? ' on' : '')}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(o)}
              >
                {o.icon && <i className="sel-ico">{o.icon}</i>}
                <span className="sel-txt">{o.label}</span>
                {o.hint && <small>{o.hint}</small>}
                {o.value === value && <Icon name="check" size={14} className="sel-check" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function textOf(n: React.ReactNode): string {
  if (n == null || typeof n === 'boolean') return ''
  if (typeof n === 'string' || typeof n === 'number') return String(n)
  if (Array.isArray(n)) return n.map(textOf).join('')
  if (typeof n === 'object' && 'props' in n) return textOf((n.props as { children?: React.ReactNode }).children)
  return ''
}

interface NProps {
  value: string | number | undefined
  onChange: (e: { target: { value: string } }) => void
  children: React.ReactNode
  className?: string
  disabled?: boolean
  title?: string
  style?: React.CSSProperties
  'aria-label'?: string
}

/** Substitui <select>: mesma API (value, onChange(e.target.value), <option>), visual próprio. */
export function NSelect({ value, onChange, children, className, disabled, title, 'aria-label': aria }: NProps) {
  const options: Option<string>[] = []
  const walk = (nodes: React.ReactNode) => {
    for (const c of Array.isArray(nodes) ? nodes : [nodes]) {
      if (Array.isArray(c)) walk(c)
      else if (c && typeof c === 'object' && 'props' in c) {
        const p = c.props as { value?: string | number; children?: React.ReactNode }
        if (c.type === 'option') {
          const label = textOf(p.children).replace(/\s+/g, ' ').trim()
          options.push({ value: String(p.value ?? label), label })
        } else walk(p.children)
      }
    }
  }
  walk(children)
  return (
    <span title={title} className="sel-wrap">
      <Select value={String(value ?? "")} options={options} className={className} disabled={disabled} ariaLabel={aria} onChange={(v) => onChange({ target: { value: v } })} />
    </span>
  )
}
