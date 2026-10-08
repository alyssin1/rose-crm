import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
)

/** consent=true força a tela de permissões (só para reconectar a agenda); no login comum o Google lembra a autorização */
export const signInWithGoogle = (consent = false) => {
  try {
    if (location.pathname.length > 1) sessionStorage.setItem('rose.return', location.pathname + location.hash)
  } catch {
    /* sem storage */
  }
  return supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
      scopes:
        'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly',
      queryParams: consent ? { access_type: 'offline', prompt: 'consent' } : { access_type: 'offline' },
    },
  })
}
