import { useEffect, useState } from 'react'

const Q = '(max-width: 820px)'

/** true em telas de celular/tablet pequeno (mesmo corte do CSS mobile). */
export function useMobile() {
  const [m, setM] = useState(() => window.matchMedia(Q).matches)
  useEffect(() => {
    const mq = window.matchMedia(Q)
    const on = () => setM(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return m
}
