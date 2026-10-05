import { useEffect, useRef, useState } from 'react'

export interface Point {
  label: string
  value: number
  hint?: string // texto extra no tooltip
}

/** Degrau inteiro "bonito": 4 intervalos no eixo Y, sem decimais. */
const niceStep = (v: number) => {
  const raw = Math.max(1, Math.ceil(v / 4))
  if (raw <= 10) return raw
  const pow = Math.pow(10, Math.floor(Math.log10(raw)) - 0)
  return Math.ceil(raw / (pow / 2)) * (pow / 2) // múltiplos de 5, 50, 500…
}

interface BarProps {
  title: string
  points: Point[]
  format?: (n: number) => string
  tickEvery?: number // rótulo do eixo X a cada N barras
  height?: number
  tableLabel: string // texto do botão "ver tabela"
  chartLabel: string
}

/** Colunas de uma série: barras finas (≤ 24 px, topo arredondado), grade hairline, tooltip por barra e visão em tabela. */
export function BarChart({ title, points, format = String, tickEvery = 1, height = 190, tableLabel, chartLabel }: BarProps) {
  const [hover, setHover] = useState<number | null>(null)
  const [table, setTable] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const [W, setW] = useState(680)
  // mede a largura real: o SVG é desenhado em pixels (texto e barras não esticam)
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(Math.max(260, Math.round(el.clientWidth))))
    ro.observe(el)
    setW(Math.max(260, Math.round(el.clientWidth)))
    return () => ro.disconnect()
  }, [table])
  const B = 24
  const T = 10
  const step4 = niceStep(Math.max(0, ...points.map((p) => p.value)))
  const max = step4 * 4
  const L = Math.max(34, 14 + 6.6 * format(max).length) // margem esquerda cabe o maior rótulo
  const plotW = W - L - 8
  const plotH = height - B - T
  const step = plotW / Math.max(1, points.length)
  const bw = Math.min(24, step * 0.7)
  const y = (v: number) => T + plotH * (1 - v / max)
  const ticks = [0, step4, step4 * 2, step4 * 3, max]

  return (
    <figure className="chart">
      <figcaption>
        <b>{title}</b>
        <button className="link-btn" onClick={() => setTable((t) => !t)}>{table ? chartLabel : tableLabel}</button>
      </figcaption>
      {table ? (
        <table className="chart-table">
          <tbody>
            {points.map((p, i) => (
              <tr key={i}><th>{p.label}</th><td>{format(p.value)}</td></tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="chart-wrap" ref={wrap} onPointerLeave={() => setHover(null)}>
          <svg width={W} height={height} viewBox={`0 0 ${W} ${height}`} role="img" aria-label={title}>
            {ticks.map((tk) => (
              <g key={tk}>
                <line x1={L} x2={W - 8} y1={y(tk)} y2={y(tk)} className="grid" />
                <text x={L - 6} y={y(tk) + 4} textAnchor="end" className="axis">{format(tk)}</text>
              </g>
            ))}
            {points.map((p, i) => {
              const x = L + i * step + step / 2
              const h = Math.max(0, plotH * (p.value / max))
              return (
                <g key={i}>
                  {p.value > 0 && (
                    // topo arredondado (4px), base reta no eixo
                    <path
                      className={'bar' + (hover === i ? ' hov' : '')}
                      d={`M${x - bw / 2},${T + plotH} v${-Math.max(0, h - 4)} q0,-4 4,-4 h${bw - 8} q4,0 4,4 v${Math.max(0, h - 4)} z`}
                    />
                  )}
                  {i % tickEvery === 0 && <text x={x} y={height - 6} textAnchor="middle" className="axis">{p.label}</text>}
                  <rect x={L + i * step} y={T} width={step} height={plotH + B} fill="transparent" tabIndex={0} onPointerEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} />
                </g>
              )
            })}
          </svg>
          {hover !== null && points[hover] && (
            <div className="chart-tip" style={{ left: `${((L + hover * step + step / 2) / W) * 100}%` }}>
              <b>{format(points[hover].value)}</b>
              <small>{points[hover].hint ?? points[hover].label}</small>
            </div>
          )}
        </div>
      )}
    </figure>
  )
}

interface HProps {
  title: string
  points: Point[]
  format?: (n: number) => string
  tableLabel: string
  chartLabel: string
}

/** Barras horizontais de uma série (categorias), valor na ponta. */
export function HBars({ title, points, format = String, tableLabel, chartLabel }: HProps) {
  const [table, setTable] = useState(false)
  const max = Math.max(1, ...points.map((p) => p.value))
  return (
    <figure className="chart">
      <figcaption>
        <b>{title}</b>
        <button className="link-btn" onClick={() => setTable((t) => !t)}>{table ? chartLabel : tableLabel}</button>
      </figcaption>
      {points.length === 0 && <p className="side-hint">—</p>}
      {table ? (
        <table className="chart-table">
          <tbody>{points.map((p, i) => <tr key={i}><th>{p.label}</th><td>{format(p.value)}</td></tr>)}</tbody>
        </table>
      ) : (
        <div className="hbars">
          {points.map((p, i) => (
            <div key={i} className="hbar" title={`${p.label}: ${format(p.value)}`}>
              <span className="hl">{p.label}</span>
              <span className="track"><i style={{ width: `${(p.value / max) * 100}%` }} /></span>
              <span className="hv">{format(p.value)}</span>
            </div>
          ))}
        </div>
      )}
    </figure>
  )
}
