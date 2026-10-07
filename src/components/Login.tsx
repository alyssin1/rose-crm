// Tela de login: emblema "Vórtice" animado sobre grafite, sempre no tema escuro (não depende do tema do app).
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { signInWithGoogle } from '../lib/supabase'
import { Emblem, EmblemDefs } from './RoseEmblem'

interface Props {
  /** conta que entrou mas não tem acesso: mostra o aviso e o botão Sair no lugar do Google */
  denied?: { email: string; onSignOut: () => void }
}

const COLORS = ['#d62f45', '#ec5468', '#c3c6d0', '#8d909c']

export function Login({ denied }: Props) {
  const { t } = useTranslation()
  const root = useRef<HTMLDivElement>(null)
  const [loading, setLoading] = useState(false)
  const [glitch, setGlitch] = useState(false)
  const [error, setError] = useState<string | null>(denied ? t('auth.denied', { email: denied.email }) : null)
  const [shake, setShake] = useState(0)

  // partículas: valores sorteados uma vez
  const motes = useMemo(
    () =>
      Array.from({ length: 36 }, () => {
        const size = 2 + Math.random() * 4
        return {
          left: Math.random() * 100,
          size,
          dur: 14 + Math.random() * 22,
          delay: -Math.random() * 30,
          drift: (Math.random() - 0.5) * 120,
          op: 0.25 + Math.random() * 0.45,
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
          blur: size > 4.5 ? 1.5 : 0,
        }
      }),
    [],
  )

  // a barra do celular fica grafite enquanto o login está na tela
  useEffect(() => {
    const meta = document.querySelector('meta[name="theme-color"]')
    const prev = meta?.getAttribute('content')
    meta?.setAttribute('content', '#1b1b20')
    return () => {
      if (prev) meta?.setAttribute('content', prev)
    }
  }, [])

  // erro devolvido pelo Google/Supabase na volta do login (?error=… ou #error=…)
  useEffect(() => {
    const q = new URLSearchParams(location.search)
    const h = new URLSearchParams(location.hash.replace(/^#/, ''))
    if (q.get('error') || h.get('error')) {
      setError(t('login.oauthError'))
      setShake((n) => n + 1)
      history.replaceState(null, '', location.pathname)
    }
  }, [t])

  // rajada de glitch no emblema a cada 6–9 s
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let id: ReturnType<typeof setTimeout>
    const burst = () => {
      setGlitch(true)
      setTimeout(() => setGlitch(false), 150)
      id = setTimeout(burst, 6000 + Math.random() * 3000)
    }
    id = setTimeout(burst, 5000)
    return () => clearTimeout(id)
  }, [])

  // paralaxe do mouse (desktop): só atualiza variáveis CSS, sem re-renderizar
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !matchMedia('(pointer: fine)').matches) return
    const el = root.current
    if (!el) return
    let raf = 0
    let tx = 0
    let ty = 0
    let cx = 0
    let cy = 0
    const move = (e: MouseEvent) => {
      tx = -(e.clientX / innerWidth - 0.5) * 32
      ty = -(e.clientY / innerHeight - 0.5) * 32
    }
    const tick = () => {
      cx += (tx - cx) * 0.08
      cy += (ty - cy) * 0.08
      el.style.setProperty('--px', cx.toFixed(2) + 'px')
      el.style.setProperty('--py', cy.toFixed(2) + 'px')
      raf = requestAnimationFrame(tick)
    }
    addEventListener('mousemove', move)
    raf = requestAnimationFrame(tick)
    return () => {
      removeEventListener('mousemove', move)
      cancelAnimationFrame(raf)
    }
  }, [])

  const go = async () => {
    if (loading) return
    setLoading(true)
    setError(null)
    const { error: e } = await signInWithGoogle()
    if (e) {
      setLoading(false)
      setError(t('login.oauthError'))
      setShake((n) => n + 1)
    }
  }

  return (
    <div ref={root} className={'lg' + (loading ? ' lg-loading' : '')}>
      <EmblemDefs />

      {/* fundo: fumaça líquida, partículas, linhas de varredura, feixe e granulado */}
      <div className="lg-smoke" aria-hidden>
        <i className="lg-blob b1" />
        <i className="lg-blob b2" />
        <i className="lg-blob b3" />
        <i className="lg-blob b4" />
        <i className="lg-vignette" />
      </div>
      <div className="lg-motes" aria-hidden>
        {motes.map((m, i) => (
          <i
            key={i}
            style={{ left: m.left + '%', width: m.size, height: m.size, background: m.color, filter: m.blur ? `blur(${m.blur}px)` : undefined, animationDuration: m.dur + 's', animationDelay: m.delay + 's', ['--drift' as string]: m.drift + 'px', ['--op' as string]: m.op }}
          />
        ))}
      </div>
      <div className="lg-scan" aria-hidden />
      <div className="lg-beam" aria-hidden />
      <div className="lg-grain" aria-hidden />

      <main className="lg-main">
        <section className="lg-cardwrap">
          <div className={'lg-card'} key={shake} data-shake={shake > 0 ? '1' : undefined}>
            <div className="lg-top">
              <span className="lg-mini"><Emblem simple className="lg-mini-svg" /></span>
              <span className="lg-badge">{t('login.badge')}</span>
            </div>
            <h1 className="lg-word">Rose</h1>
            <p className="lg-tag">{t('app.tagline')}</p>

            {error && (
              <div className="lg-error" role="alert">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                <span>{error}</span>
              </div>
            )}

            {denied ? (
              <button className="lg-cta" onClick={denied.onSignOut}><span>{t('auth.signOut')}</span></button>
            ) : (
              <button className="lg-cta" onClick={() => void go()} disabled={loading}>
                <span className="lg-g" aria-hidden>
                  <svg viewBox="0 0 24 24" width="14" height="14"><path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.66-5.17 3.66-9.17z" /><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z" /><path fill="#FBBC05" d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z" /><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z" /></svg>
                </span>
                {loading ? <i className="lg-spin" aria-label="…" /> : <span>{t('auth.google')}</span>}
              </button>
            )}

            <p className="lg-foot">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
              {t('login.foot')}
            </p>
          </div>
        </section>

        <section className="lg-hero" aria-hidden>
          <div className="lg-stage">
            <div className="lg-aura" />
            <div className="lg-breathe">
              <div className={'lg-rotor' + (glitch ? ' lg-glitch' : '')}>
                <Emblem className="lg-big" />
              </div>
            </div>
            <div className="lg-inner">
              <svg viewBox="0 0 300 300" fill="none"><path d="M 150 40 C 90 40 40 90 40 150 C 40 210 90 260 150 260 C 200 260 240 220 240 170 C 240 130 210 100 170 100 C 140 100 120 120 120 150 C 120 170 135 185 155 185" stroke="#ec5468" strokeWidth="10" strokeLinecap="round" strokeDasharray="14 18" /></svg>
            </div>
          </div>
        </section>
      </main>

      <footer className="lg-copy">© Rose</footer>
      <div className="lg-fade" aria-hidden />
    </div>
  )
}
