import { useEffect, useRef, useState, type ReactNode } from 'react'

interface Props {
  trigger: (open: boolean, toggle: () => void) => ReactNode
  children: (close: () => void) => ReactNode
  align?: 'left' | 'right'
  up?: boolean
  className?: string
}

/** Popover simples ancorado no gatilho; fecha ao clicar fora ou com Esc. */
export function Popover({ trigger, children, align = 'left', up = false, className = '' }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="pop" ref={ref}>
      {trigger(open, () => setOpen((o) => !o))}
      {open && <div className={`pop-panel ${align} ${up ? 'up' : ''} ${className}`}>{children(() => setOpen(false))}</div>}
    </div>
  )
}
