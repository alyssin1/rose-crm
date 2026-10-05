// Rose · sincronização com o Google Calendar (duas vias).
//  - Chamada pelo app (JWT do usuário)         → sincroniza o próprio usuário
//  - Chamada pelo cron (x-cron-secret)         → sincroniza todos os usuários conectados
//  - Webhook do Google (x-goog-channel-id ...) → sincroniza o dono do canal
// Segredos necessários: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, CRON_SECRET.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { admin, caller, cors, json, plain, toHtml } from '../_shared/util.ts'

const GOOGLE = 'https://www.googleapis.com/calendar/v3'
const FULL_EVERY_MS = 12 * 3600 * 1000 // a janela de eventos "anda": refaz a leitura completa a cada 12 h
const PAST_DAYS = 90
const FUTURE_DAYS = 365

interface Task {
  id: string
  user_id: string
  title: string
  content: string
  status: number
  start_at: string | null
  due_at: string | null
  all_day: boolean
  duration_minutes: number | null
  deleted_at: string | null
  google_calendar_id: string | null
  google_event_id: string | null
  google_etag: string | null
  google_synced_at: string | null
  source: 'rose' | 'google'
  updated_at: string
}

interface GEvent {
  id: string
  etag: string
  status: 'confirmed' | 'tentative' | 'cancelled'
  summary?: string
  description?: string
  updated: string
  start?: { date?: string; dateTime?: string }
  end?: { date?: string; dateTime?: string }
}

// ---------- Google ----------
async function accessToken(refresh: string): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_CLIENT_ID')!,
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET')!,
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }),
  })
  const body = await res.json()
  if (!res.ok) throw Object.assign(new Error(body.error_description || body.error || 'token'), { code: body.error })
  return body.access_token as string
}

async function g(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${GOOGLE}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) } })
  if (res.status === 204) return { status: 204, body: null }
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : null }
}

// timestamps chegam em formatos diferentes (Z / +00:00): sempre comparar como números
const ms = (s: string) => Date.parse(s)
const DIRTY_MS = 3000 // tolerância: a própria gravação da sincronização move updated_at por milissegundos
const isDirty = (updatedAt: string, syncedAt: string | null) => !syncedAt || ms(updatedAt) - ms(syncedAt) > DIRTY_MS

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function toEvent(t: Task) {
  const due = new Date(t.due_at!)
  const start = t.start_at ? new Date(t.start_at) : due
  const body: Record<string, unknown> = { summary: t.title || '(sem título)', description: plain(t.content ?? '') }
  if (t.all_day) {
    // dia inteiro: o fim no Google é exclusivo
    const first = new Date(Math.min(start.getTime(), due.getTime()))
    const last = new Date(Math.max(start.getTime(), due.getTime()))
    const end = new Date(last)
    end.setDate(end.getDate() + 1)
    body.start = { date: ymd(first) }
    body.end = { date: ymd(end) }
  } else {
    const s = t.start_at ? start : due
    const e = t.start_at ? due : new Date(due.getTime() + (t.duration_minutes ?? 60) * 60000)
    body.start = { dateTime: s.toISOString() }
    body.end = { dateTime: (e > s ? e : new Date(s.getTime() + 3600000)).toISOString() }
  }
  return body
}

function fromEvent(ev: GEvent) {
  const allDay = !!ev.start?.date
  if (allDay) {
    const first = new Date(`${ev.start!.date}T00:00:00`)
    const endEx = new Date(`${ev.end?.date ?? ev.start!.date}T00:00:00`)
    const last = new Date(endEx)
    last.setDate(last.getDate() - 1)
    const multi = last > first
    return { all_day: true, start_at: multi ? first.toISOString() : null, due_at: (multi ? last : first).toISOString() }
  }
  const s = new Date(ev.start!.dateTime!)
  const e = new Date(ev.end?.dateTime ?? ev.start!.dateTime!)
  return { all_day: false, start_at: s.toISOString(), due_at: e > s ? e.toISOString() : s.toISOString() }
}

// ---------- sincronização de um usuário ----------
async function syncUser(db: SupabaseClient, userId: string, onlyCalendar?: string) {
  const { data: tok } = await db.from('rose_google_tokens').select('refresh_token').eq('user_id', userId).maybeSingle()
  if (!tok) return { skipped: 'sem token' }
  let token: string
  try {
    token = await accessToken(tok.refresh_token)
  } catch (e) {
    if ((e as { code?: string }).code === 'invalid_grant') await db.from('rose_google_tokens').delete().eq('user_id', userId) // acesso revogado: pede novo login
    throw e
  }

  // 1) lista de agendas
  const list = await g(token, '/users/me/calendarList?minAccessRole=reader&maxResults=250')
  if (list.status !== 200) throw new Error(`calendarList ${list.status}`)
  const { data: known } = await db.from('rose_google_calendars').select('*').eq('user_id', userId)
  for (const c of list.body.items as { id: string; summaryOverride?: string; summary: string; backgroundColor?: string; accessRole: string }[]) {
    const prev = known?.find((k) => k.google_calendar_id === c.id)
    await db.from('rose_google_calendars').upsert(
      {
        user_id: userId,
        google_calendar_id: c.id,
        name: c.summaryOverride || c.summary,
        background_color: c.backgroundColor ?? null,
        access_role: c.accessRole,
        enabled: prev ? prev.enabled : ['owner', 'writer'].includes(c.accessRole),
      },
      { onConflict: 'user_id,google_calendar_id' },
    )
  }

  const { data: cals } = await db.from('rose_google_calendars').select('*').eq('user_id', userId).eq('enabled', true)
  const stats = { pushed: 0, pulled: 0, removed: 0 }

  for (const cal of cals ?? []) {
    if (onlyCalendar && cal.google_calendar_id !== onlyCalendar) continue
    const calPath = `/calendars/${encodeURIComponent(cal.google_calendar_id)}`
    const writable = ['owner', 'writer'].includes(cal.access_role ?? '')
    const startedAt = new Date()

    // 2) Rose → Google
    if (writable) {
      const { data: tasks } = await db.from('rose_tasks').select('*').eq('user_id', userId).eq('google_calendar_id', cal.google_calendar_id)
      for (const t of (tasks ?? []) as Task[]) {
        if (!isDirty(t.updated_at, t.google_synced_at)) continue
        if (t.deleted_at || !t.due_at) {
          if (t.google_event_id) {
            await g(token, `${calPath}/events/${t.google_event_id}`, { method: 'DELETE' })
            await db.from('rose_tasks').update({ google_event_id: null, google_etag: null, google_synced_at: new Date().toISOString() }).eq('id', t.id)
            stats.removed++
          }
          continue
        }
        const res = t.google_event_id
          ? await g(token, `${calPath}/events/${t.google_event_id}`, { method: 'PATCH', body: JSON.stringify(toEvent(t)) })
          : await g(token, `${calPath}/events`, { method: 'POST', body: JSON.stringify(toEvent(t)) })
        if (res.status === 200) {
          await db.from('rose_tasks').update({ google_event_id: res.body.id, google_etag: res.body.etag, google_synced_at: new Date().toISOString() }).eq('id', t.id)
          stats.pushed++
        } else if (res.status === 404 || res.status === 410) {
          await db.from('rose_tasks').update({ google_event_id: null, google_etag: null }).eq('id', t.id) // recria na próxima rodada
        }
      }
    }

    // 3) Google → Rose
    const lastFull = cal.sync_token ? Date.parse(cal.sync_token) : 0
    const full = !cal.last_synced_at || Date.now() - lastFull > FULL_EVERY_MS
    const params = new URLSearchParams({
      singleEvents: 'true',
      showDeleted: 'true',
      maxResults: '250',
      timeMin: new Date(Date.now() - PAST_DAYS * 86400000).toISOString(),
      timeMax: new Date(Date.now() + FUTURE_DAYS * 86400000).toISOString(),
    })
    if (!full) params.set('updatedMin', new Date(Date.parse(cal.last_synced_at) - 60000).toISOString())

    let pageToken: string | undefined
    do {
      if (pageToken) params.set('pageToken', pageToken)
      const res = await g(token, `${calPath}/events?${params}`)
      if (res.status !== 200) throw new Error(`events.list ${res.status}`)
      for (const ev of res.body.items as GEvent[]) {
        const { data: local } = await db.from('rose_tasks').select('*').eq('user_id', userId).eq('google_calendar_id', cal.google_calendar_id).eq('google_event_id', ev.id).maybeSingle()
        if (ev.status === 'cancelled') {
          if (local) {
            if (local.source === 'google') await db.from('rose_tasks').delete().eq('id', local.id)
            else await db.from('rose_tasks').update({ google_event_id: null, google_etag: null }).eq('id', local.id) // tarefa do Rose: só desvincula
            stats.removed++
          }
          continue
        }
        if (!ev.start) continue
        if (local) {
          if (local.google_etag === ev.etag) continue // é o eco da nossa própria gravação
          if (local.google_synced_at && isDirty(local.updated_at, local.google_synced_at) && ms(local.updated_at) > ms(ev.updated)) continue // alteração local mais recente vence
        }
        const mapped = fromEvent(ev)
        const row = {
          title: ev.summary || '(sem título)',
          content: ev.description ? toHtml(ev.description) : '',
          ...mapped,
          google_etag: ev.etag,
          google_synced_at: new Date().toISOString(),
        }
        if (local) await db.from('rose_tasks').update(row).eq('id', local.id)
        else
          await db.from('rose_tasks').insert({ user_id: userId, list_id: null, source: 'google', google_calendar_id: cal.google_calendar_id, google_event_id: ev.id, status: 0, priority: 0, reminders: [], ...row })
        stats.pulled++
      }
      pageToken = res.body.nextPageToken
    } while (pageToken)

    await db.from('rose_google_calendars').update({ last_synced_at: startedAt.toISOString(), ...(full ? { sync_token: startedAt.toISOString() } : {}) }).eq('id', cal.id)

    // 4) canal de push (webhook) para receber avisos do Google em tempo real
    const expiring = !cal.channel_expires_at || Date.parse(cal.channel_expires_at) - Date.now() < 2 * 86400000
    if (expiring && Deno.env.get('CRON_SECRET')) {
      const channelId = crypto.randomUUID()
      const res = await g(token, `${calPath}/events/watch`, {
        method: 'POST',
        body: JSON.stringify({
          id: channelId,
          type: 'web_hook',
          address: `${Deno.env.get('SUPABASE_URL')}/functions/v1/rose-google-sync`,
          token: Deno.env.get('CRON_SECRET'),
        }),
      })
      if (res.status === 200) await db.from('rose_google_calendars').update({ channel_id: channelId, channel_expires_at: new Date(Number(res.body.expiration)).toISOString() }).eq('id', cal.id)
    }
  }
  return stats
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const db = admin()

  // webhook do Google
  const channel = req.headers.get('x-goog-channel-id')
  if (channel) {
    if (req.headers.get('x-goog-channel-token') !== Deno.env.get('CRON_SECRET')) return json({ error: 'forbidden' }, 403)
    if (req.headers.get('x-goog-resource-state') === 'sync') return json({ ok: true }) // ping inicial do canal
    const { data: cal } = await db.from('rose_google_calendars').select('user_id, google_calendar_id').eq('channel_id', channel).maybeSingle()
    if (!cal) return json({ ok: true })
    try {
      return json({ ok: true, ...(await syncUser(db, cal.user_id, cal.google_calendar_id)) })
    } catch (e) {
      return json({ error: String(e) }, 200) // 200 para o Google não reenviar em loop
    }
  }

  const who = await caller(req, db)
  if (!who) return json({ error: 'unauthorized' }, 401)

  try {
    if (who.kind === 'user') return json({ ok: true, ...(await syncUser(db, who.userId)) })
    const { data: users } = await db.from('rose_google_tokens').select('user_id')
    const out: Record<string, unknown> = {}
    for (const u of users ?? []) {
      try {
        out[u.user_id] = await syncUser(db, u.user_id)
      } catch (e) {
        out[u.user_id] = { error: String(e) }
      }
    }
    return json({ ok: true, users: out })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
