import { useTranslation } from 'react-i18next'

export type FeatureKey = 'calendar' | 'matrix' | 'habit' | 'pomodoro' | 'countdown' | 'sticky'

const BG: Record<FeatureKey, string> = {
  calendar: 'linear-gradient(135deg,#8aa4ff,#b9c6ff)',
  matrix: 'linear-gradient(135deg,#6fc3ff,#a9e0ff)',
  habit: 'linear-gradient(135deg,#6fe0a6,#c3f2c9)',
  pomodoro: 'linear-gradient(135deg,#ff9b8a,#ff7aa8)',
  countdown: 'linear-gradient(135deg,#8aa4ff,#c9a8ff)',
  sticky: 'linear-gradient(135deg,#ffe27a,#ffc46b)',
}

/** Ilustração em CSS de cada módulo (janela branca sobre fundo em degradê). */
function Preview({ k }: { k: FeatureKey }) {
  const bar = (w: string, c = '#e6e8f0') => <i className="fp-bar" style={{ width: w, background: c }} />
  return (
    <div className="fp" style={{ background: BG[k] }}>
      <div className="fp-win">
        <i className="fp-pill" />
        {k === 'calendar' && (
          <div className="fp-cal">
            {Array.from({ length: 21 }, (_, i) => (
              <span key={i}>{[3, 8, 9, 14, 15].includes(i) && <b style={{ background: ['#b6c4ff', '#ffc9c9', '#b6c4ff', '#ffd9a8', '#c9c9d4'][[3, 8, 9, 14, 15].indexOf(i)] }} />}</span>
            ))}
          </div>
        )}
        {k === 'matrix' && (
          <div className="fp-mx">
            {['#ff6b6b', '#ffb020', '#4c6fff', '#2fd6a6'].map((c) => (
              <div key={c}>
                <u style={{ background: c }} />
                {bar('70%')}
                {bar('50%')}
              </div>
            ))}
          </div>
        )}
        {k === 'habit' && (
          <div className="fp-hb">
            {['#4c8dff', '#ffb020', '#ff8a4c', '#ff6b6b'].map((c) => (
              <div key={c}>
                <u style={{ background: c }} />
                <span>{[0, 1, 2, 3].map((n) => <s key={n} style={{ borderColor: c, background: n < 3 ? c : 'transparent' }} />)}</span>
              </div>
            ))}
          </div>
        )}
        {k === 'pomodoro' && (
          <div className="fp-po">
            <div className="ring"><b>16:36</b></div>
            <i className="btn" />
          </div>
        )}
        {k === 'countdown' && (
          <div className="fp-cd">
            <b>81</b>
            {bar('60%')}
            {bar('40%')}
          </div>
        )}
        {k === 'sticky' && (
          <div className="fp-st">
            <div style={{ background: '#fff4a8' }}>{bar('70%', '#e8d97a')}{bar('50%', '#e8d97a')}</div>
            <div style={{ background: '#ffd6e0' }}>{bar('60%', '#f0aebf')}</div>
          </div>
        )}
      </div>
    </div>
  )
}

interface Props {
  keys: FeatureKey[]
  isOn: (k: FeatureKey) => boolean
  toggle: (k: FeatureKey, on: boolean) => void
}

export function FeatureCards({ keys, isOn, toggle }: Props) {
  const { t } = useTranslation()
  return (
    <div className="features">
      <h3 className="features-title">{t('settings.tab.features')}</h3>
      <div className="feature-grid">
        {keys.map((k) => (
          <div key={k} className="feature-card">
            <div className="feature-head">
              <b>{t(`settings.f.${k}`)}</b>
              <button role="switch" aria-checked={isOn(k)} aria-label={t(`settings.f.${k}`)} className={'switch' + (isOn(k) ? ' on' : '')} onClick={() => toggle(k, !isOn(k))}>
                <i />
              </button>
            </div>
            <p>{t(`settings.fd.${k}`)}</p>
            <Preview k={k} />
          </div>
        ))}
      </div>
    </div>
  )
}
