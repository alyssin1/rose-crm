import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useData } from '../store/data'
import { showLocal } from './notify'

export type Phase = 'focus' | 'short' | 'long'
export type PomoMode = 'pomodoro' | 'stopwatch'

export interface PomoSettings {
  focus: number // minutos
  short: number
  long: number
  longEvery: number // pausa longa a cada N focos
  autoBreak: boolean
  sound: boolean
}
export const DEFAULT_POMO: PomoSettings = { focus: 25, short: 5, long: 15, longEvery: 4, autoBreak: true, sound: true }

interface PomoState {
  mode: PomoMode
  phase: Phase
  status: 'idle' | 'running' | 'paused'
  startedAt: number | null // início do foco atual (para a sessão registrada)
  endAt: number | null // pomodoro em andamento
  remainingMs: number // pomodoro pausado
  accMs: number // cronômetro: tempo acumulado antes do último "continuar"
  runFrom: number | null // cronômetro: instante do último "continuar"
  taskId: string | null
  cycles: number
}

const INITIAL: PomoState = { mode: 'pomodoro', phase: 'focus', status: 'idle', startedAt: null, endAt: null, remainingMs: 0, accMs: 0, runFrom: null, taskId: null, cycles: 0 }
const KEY = 'rose.pomo.state'
const KEY_SET = 'rose.pomo.settings'

const read = <T,>(key: string, fallback: T): T => {
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(key) ?? '{}') }
  } catch {
    return fallback
  }
}

interface Api {
  state: PomoState
  settings: PomoSettings
  setSettings: (p: Partial<PomoSettings>) => void
  /** milissegundos para exibir: restante (pomodoro) ou decorrido (cronômetro) */
  displayMs: number
  totalMs: number
  start: () => void
  pause: () => void
  resume: () => void
  stop: () => void // desiste (grava o foco parcial se durou ≥ 1 min)
  skip: () => void // pula a pausa
  setMode: (m: PomoMode) => void
  setPhase: (p: Phase) => void
  setTask: (id: string | null) => void
}

const Ctx = createContext<Api | null>(null)
export const usePomodoro = () => {
  const c = useContext(Ctx)
  if (!c) throw new Error('PomodoroProvider ausente')
  return c
}

const minutes = (s: PomoSettings, p: Phase) => (p === 'focus' ? s.focus : p === 'short' ? s.short : s.long)

function beep(on: boolean) {
  if (!on) return
  try {
    const ctx = new AudioContext()
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      o.frequency.value = 880
      g.gain.value = 0.08
      o.connect(g).connect(ctx.destination)
      o.start(ctx.currentTime + i * 0.35)
      o.stop(ctx.currentTime + i * 0.35 + 0.2)
    }
  } catch {
    /* sem áudio */
  }
}

export function PomodoroProvider({ children }: { children: ReactNode }) {
  const data = useData()
  const [state, setState] = useState<PomoState>(() => read(KEY, INITIAL))
  const [settings, setSettingsState] = useState<PomoSettings>(() => read(KEY_SET, DEFAULT_POMO))
  const [now, setNow] = useState(Date.now())
  const finishing = useRef(false)

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state))
    } catch {
      /* sem storage */
    }
  }, [state])

  const setSettings = useCallback((p: Partial<PomoSettings>) => {
    setSettingsState((s) => {
      const n = { ...s, ...p }
      try {
        localStorage.setItem(KEY_SET, JSON.stringify(n))
      } catch {
        /* sem storage */
      }
      return n
    })
  }, [])

  const totalMs = minutes(settings, state.phase) * 60000
  const elapsedStopwatch = state.status === 'running' && state.runFrom ? state.accMs + (now - state.runFrom) : state.accMs
  const displayMs =
    state.mode === 'stopwatch'
      ? elapsedStopwatch
      : state.status === 'running' && state.endAt
        ? Math.max(0, state.endAt - now)
        : state.status === 'paused'
          ? state.remainingMs
          : totalMs

  const record = useCallback(
    (seconds: number, planned: number | null, completed: boolean, startedAt: number | null, taskId: string | null, kind: PomoMode) => {
      if (seconds < 1) return
      void data.addSession({ task_id: taskId, kind, started_at: new Date(startedAt ?? Date.now() - seconds * 1000).toISOString(), duration_seconds: Math.round(seconds), planned_seconds: planned, completed })
    },
    [data],
  )

  // relógio de 250 ms enquanto roda
  useEffect(() => {
    if (state.status !== 'running') return
    const id = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(id)
  }, [state.status])

  // título da aba mostra o tempo
  useEffect(() => {
    const base = document.title.replace(/^\d+:\d\d · /, '')
    if (state.status === 'running') {
      const s = Math.ceil(displayMs / 1000)
      document.title = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')} · ${base}`
    } else document.title = base
  }, [displayMs, state.status])

  // fim do ciclo
  useEffect(() => {
    if (state.mode !== 'pomodoro' || state.status !== 'running' || !state.endAt || now < state.endAt || finishing.current) return
    finishing.current = true
    const wasFocus = state.phase === 'focus'
    if (wasFocus) record(minutes(settings, 'focus') * 60, minutes(settings, 'focus') * 60, true, state.startedAt, state.taskId, 'pomodoro')
    beep(settings.sound)
    showLocal(wasFocus ? '🍅 Pomodoro' : '☕', wasFocus ? 'Foco concluído — hora da pausa.' : 'Pausa concluída — de volta ao foco.', state.taskId ?? 'pomo')
    setState((s) => {
      const cycles = wasFocus ? s.cycles + 1 : s.cycles
      const next: Phase = wasFocus ? (cycles % settings.longEvery === 0 ? 'long' : 'short') : 'focus'
      const auto = settings.autoBreak && wasFocus
      const start = Date.now()
      return {
        ...s,
        cycles,
        phase: next,
        status: auto ? 'running' : 'idle',
        startedAt: auto ? start : null,
        endAt: auto ? start + minutes(settings, next) * 60000 : null,
        remainingMs: 0,
      }
    })
    finishing.current = false
  }, [now, state, settings, record])

  const api = useMemo<Api>(
    () => ({
      state,
      settings,
      setSettings,
      displayMs,
      totalMs,
      start: () => {
        const t = Date.now()
        setNow(t)
        setState((s) => (s.mode === 'stopwatch' ? { ...s, status: 'running', startedAt: t, runFrom: t, accMs: 0 } : { ...s, status: 'running', startedAt: t, endAt: t + minutes(settings, s.phase) * 60000 }))
      },
      pause: () =>
        setState((s) => {
          const t = Date.now()
          return s.mode === 'stopwatch' ? { ...s, status: 'paused', accMs: s.accMs + (s.runFrom ? t - s.runFrom : 0), runFrom: null } : { ...s, status: 'paused', remainingMs: Math.max(0, (s.endAt ?? t) - t), endAt: null }
        }),
      resume: () =>
        setState((s) => {
          const t = Date.now()
          setNow(t)
          return s.mode === 'stopwatch' ? { ...s, status: 'running', runFrom: t } : { ...s, status: 'running', endAt: t + s.remainingMs }
        }),
      stop: () => {
        const s = state
        if (s.phase === 'focus' || s.mode === 'stopwatch') {
          const spentMs = s.mode === 'stopwatch' ? elapsedStopwatch : minutes(settings, 'focus') * 60000 - displayMs
          if (spentMs >= 60000) record(spentMs / 1000, s.mode === 'stopwatch' ? null : minutes(settings, 'focus') * 60, s.mode === 'stopwatch', s.startedAt, s.taskId, s.mode)
        }
        setState((p) => ({ ...p, status: 'idle', startedAt: null, endAt: null, remainingMs: 0, accMs: 0, runFrom: null, phase: 'focus' }))
      },
      skip: () => setState((p) => ({ ...p, status: 'idle', phase: 'focus', startedAt: null, endAt: null, remainingMs: 0 })),
      setMode: (m) => setState((p) => (p.status === 'idle' ? { ...p, mode: m, phase: 'focus' } : p)),
      setPhase: (ph) => setState((p) => (p.status === 'idle' && p.mode === 'pomodoro' ? { ...p, phase: ph } : p)),
      setTask: (id) => setState((p) => ({ ...p, taskId: id })),
    }),
    [state, settings, setSettings, displayMs, totalMs, elapsedStopwatch, record],
  )

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>
}

export const fmtClock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export const fmtDuration = (seconds: number) => {
  const m = Math.round(seconds / 60)
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`
}
