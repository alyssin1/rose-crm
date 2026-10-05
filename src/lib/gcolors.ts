/**
 * Cores como o Google Calendar mostra hoje.
 * A API ainda devolve a paleta antiga (ex.: #9fe1e7); a interface usa a paleta nova,
 * com uma versão própria para o modo escuro (medida no app real: Peacock → #4b99d2).
 */

/** paleta antiga da API (agendas) → cor atual no modo claro */
const CALENDAR: Record<string, string> = {
  '#ac725e': '#795548', '#d06b64': '#e67c73', '#f83a22': '#d50000', '#fa573c': '#f4511e',
  '#ff7537': '#ef6c00', '#ffad46': '#f09300', '#42d692': '#009688', '#16a765': '#0b8043',
  '#7bd148': '#7cb342', '#b3dc6c': '#c0ca33', '#fbe983': '#e4c441', '#fad165': '#f6bf26',
  '#92e1c0': '#33b679', '#9fe1e7': '#039be5', '#9fc6e7': '#4285f4', '#4986e7': '#3f51b5',
  '#9a9cff': '#7986cb', '#b99aff': '#b39ddb', '#c2c2c2': '#616161', '#cabdbf': '#a79b8e',
  '#cca6ac': '#ad1457', '#f691b2': '#d81b60', '#cd74e6': '#8e24aa', '#a47ae2': '#9e69af',
}

/** colorId do evento (1–11) → cor atual no modo claro */
const EVENT: Record<string, string> = {
  '1': '#7986cb', '2': '#33b679', '3': '#8e24aa', '4': '#e67c73', '5': '#f6bf26', '6': '#f4511e',
  '7': '#039be5', '8': '#616161', '9': '#3f51b5', '10': '#0b8043', '11': '#d50000',
}

/** versões do modo escuro medidas no Google Calendar */
const DARK: Record<string, string> = {
  '#039be5': '#4b99d2', '#ad1457': '#c05476', '#7986cb': '#828bc2', '#f6bf26': '#e7ba51',
  '#f4511e': '#da5234', '#7cb342': '#85ad59',
}

const hex2rgb = (h: string) => {
  const n = parseInt(h.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** aproximação do modo escuro do Google para cores não medidas: menos saturada e um pouco mais clara */
function toDark(hex: string) {
  const [r, g, b] = hex2rgb(hex).map((v) => v / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  const l0 = (max + min) / 2
  const d = max - min
  const s0 = d === 0 ? 0 : d / (1 - Math.abs(2 * l0 - 1))
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  const s = Math.min(s0 * 0.75, 0.7)
  const l = Math.min(0.66, Math.max(0.5, l0 * 0.6 + 0.25))
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs((h % 2) - 1))
  const m = l - c / 2
  const [a, bb, cc] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x]
  return '#' + [a, bb, cc].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('')
}

export interface Shade {
  light: string
  dark: string
}

/** cor de exibição a partir da cor da agenda (paleta da API) ou de uma cor livre (listas do Rose) */
export function shade(color: string, colorId?: string | null): Shade {
  const key = color.toLowerCase()
  const light = (colorId && EVENT[colorId]) || CALENDAR[key] || key
  return { light, dark: DARK[light] ?? toDark(light) }
}
