// Tela de carregamento: a rosa na lapela em vídeo de fundo (o terno "respira"), como nas telas de carregamento de jogo.
// Aparece enquanto o login é conferido e os dados chegam; quem pediu menos movimento vê só a imagem parada.
import { useTranslation } from 'react-i18next'
import { Emblem, EmblemDefs } from './RoseEmblem'

const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

export function Splash() {
  const { t } = useTranslation()
  return (
    <div className="splash" role="status" aria-live="polite">
      <EmblemDefs />
      {still ? (
        <img className="splash-media" src="/splash/rose-splash.jpg" alt="" />
      ) : (
        <video className="splash-media" autoPlay muted loop playsInline poster="/splash/rose-splash.jpg" aria-hidden>
          <source src="/splash/rose-splash.webm" type="video/webm" />
          <source src="/splash/rose-splash.mp4" type="video/mp4" />
        </video>
      )}
      <div className="splash-shade" />
      <div className="splash-brand">
        <Emblem simple className="splash-mark" />
        <div>
          <b>Rose</b>
          <span>{t('app.loading')}</span>
        </div>
      </div>
      <i className="splash-bar" />
    </div>
  )
}
