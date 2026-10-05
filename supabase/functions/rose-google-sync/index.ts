// Rose · sincronização com o Google Calendar (duas vias).
//  - Chamada pelo app (JWT do usuário)         → sincroniza o próprio usuário
//  - Chamada pelo cron (x-cron-secret)         → sincroniza todos os usuários conectados
//  - Webhook do Google (x-goog-channel-id ...) → sincroniza o dono do canal
// Segredos necessários: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, CRON_SECRET.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { admin, caller, cors, env, json, plain, toHtml } from '../_shared/util.ts'

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
  htmlLink?: string
  location?: string
  hangoutLink?: string
  colorId?: string
  recurringEventId?: string
  recurrence?: string[]
  organizer?: { email?: string; displayName?: string; self?: boolean }
  attendees?: { email?: string; displayName?: string; responseStatus?: string; organizer?: boolean; self?: boolean; optional?: boolean }[]
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string; label?: string; pin?: string; regionCode?: string }[] }
  reminders?: { useDefault?: boolean; overrides?: { method?: string; minutes?: number }[] }
}

/** Dados extras do evento para o pop-up do app (convidados, Meet, recorrência, lembretes). */
function metaOf(ev: GEvent, recurrence: string[] | null, defaultReminders: { method?: string; minutes?: number }[]) {
  const entry = ev.conferenceData?.entryPoints ?? []
  const phone = entry.find((e) => e.entryPointType === 'phone')
  const rem = ev.reminders?.useDefault ? defaultReminders : ev.reminders?.overrides ?? []
  return {
    htmlLink: ev.htmlLink ?? null,
    colorId: ev.colorId ?? null,
    location: ev.location ?? null,
    meet: ev.hangoutLink ?? entry.find((e) => e.entryPointType === 'video')?.uri ?? null,
    phone: phone ? { label: phone.label ?? phone.uri?.replace('tel:', '') ?? '', pin: phone.pin ?? null } : null,
    organizer: ev.organizer ? { email: ev.organizer.email ?? null, name: ev.organizer.displayName ?? null, self: !!ev.organizer.self } : null,
    attendees: (ev.attendees ?? []).map((a) => ({ email: a.email ?? '', name: a.displayName ?? null, status: a.responseStatus ?? 'needsAction', organizer: !!a.organizer, self: !!a.self, optional: !!a.optional })),
    recurrence: recurrence ?? ev.recurrence ?? null,
    reminders: rem.map((r) => r.minutes).filter((m): m is number => typeof m === 'number'),
  }
}

// ---------- Google ----------
async function accessToken(refresh: string): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env('GOOGLE_CLIENT_ID')!,
      client_secret: env('GOOGLE_CLIENT_SECRET')!,
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
  const list = await g(token, '/users/me/calendarList?minAccessRole=freeBusyReader&maxResults=250')
  if (list.status !== 200) throw new Error(`calendarList ${list.status}`)
  const { data: known } = await db.from('rose_google_calendars').select('*').eq('user_id', userId)
  const defaults = new Map<string, { method?: string; minutes?: number }[]>()
  for (const c of list.body.items as { id: string; summaryOverride?: string; summary: string; backgroundColor?: string; accessRole: string; defaultReminders?: { method?: string; minutes?: number }[] }[]) {
    defaults.set(c.id, c.defaultReminders ?? [])
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
      // em páginas: o PostgREST devolve no máximo 1000 linhas por consulta
      const tasks: Task[] = []
      for (let from = 0; ; from += 1000) {
        const { data: rows } = await db.from('rose_tasks').select('*').eq('user_id', userId).eq('google_calendar_id', cal.google_calendar_id).order('id').range(from, from + 999)
        tasks.push(...((rows ?? []) as Task[]))
        if (!rows || rows.length < 1000) break
      }
      for (const t of tasks) {
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

    const localMap = new Map<string, Record<string, any>>() // eslint-disable-line @typescript-eslint/no-explicit-any
    for (let from = 0; ; from += 1000) {
      const { data: rows } = await db.from('rose_tasks').select('*').eq('user_id', userId).eq('google_calendar_id', cal.google_calendar_id).order('id').range(from, from + 999)
      for (const r of rows ?? []) if (r.google_event_id) localMap.set(r.google_event_id, r)
      if (!rows || rows.length < 1000) break
    }
    const inserts: Record<string, unknown>[] = []
    const flushInserts = async () => {
      while (inserts.length) {
        const chunk = inserts.splice(0, 200)
        const { error } = await db.from('rose_tasks').upsert(chunk, { onConflict: 'user_id,google_calendar_id,google_event_id', ignoreDuplicates: true }) // trava única: execuções simultâneas não duplicam
        if (error) throw new Error('insert: ' + error.message)
      }
    }
    const masters = new Map<string, string[] | null>()
    let masterCalls = 0
    const recurrenceOf = async (ev: GEvent) => {
      if (!ev.recurringEventId) return null
      if (masters.has(ev.recurringEventId)) return masters.get(ev.recurringEventId)!
      if (masterCalls++ >= 80) return null
      const m = await g(token, `${calPath}/events/${encodeURIComponent(ev.recurringEventId)}`)
      const rec = m.status === 200 ? ((m.body.recurrence as string[]) ?? null) : null
      masters.set(ev.recurringEventId, rec)
      return rec
    }

    let pageToken: string | undefined
    do {
      if (pageToken) params.set('pageToken', pageToken)
      const res = await g(token, `${calPath}/events?${params}`)
      if (res.status !== 200) throw new Error(`events.list ${res.status}`)
      for (const ev of res.body.items as GEvent[]) {
        const local = localMap.get(ev.id)
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
          if (local.google_etag === ev.etag && local.google_meta && "colorId" in local.google_meta) continue // eco da nossa gravação (e já tem os dados extras)
          if (local.google_synced_at && isDirty(local.updated_at, local.google_synced_at) && ms(local.updated_at) > ms(ev.updated)) continue // alteração local mais recente vence
        }
        const mapped = fromEvent(ev)
        const row = {
          title: ev.summary || '(sem título)',
          content: ev.description ? toHtml(ev.description) : '',
          ...mapped,
          google_meta: metaOf(ev, await recurrenceOf(ev), defaults.get(cal.google_calendar_id) ?? []),
          google_etag: ev.etag,
          google_synced_at: new Date().toISOString(),
        }
        if (local) await db.from('rose_tasks').update(row).eq('id', local.id)
        else inserts.push({ user_id: userId, list_id: null, source: 'google', google_calendar_id: cal.google_calendar_id, google_event_id: ev.id, status: 0, priority: 0, reminders: [], ...row })
        stats.pulled++
      }
      pageToken = res.body.nextPageToken
      await flushInserts()
    } while (pageToken)
    await flushInserts()

    await db.from('rose_google_calendars').update({ last_synced_at: startedAt.toISOString(), ...(full ? { sync_token: startedAt.toISOString() } : {}) }).eq('id', cal.id)

    // 4) canal de push (webhook) para receber avisos do Google em tempo real
    const expiring = !cal.channel_expires_at || Date.parse(cal.channel_expires_at) - Date.now() < 2 * 86400000
    if (expiring && env('CRON_SECRET')) {
      const channelId = crypto.randomUUID()
      const res = await g(token, `${calPath}/events/watch`, {
        method: 'POST',
        body: JSON.stringify({
          id: channelId,
          type: 'web_hook',
          address: `${Deno.env.get('SUPABASE_URL')}/functions/v1/rose-google-sync`,
          token: env('CRON_SECRET'),
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
    if (req.headers.get('x-goog-channel-token') !== env('CRON_SECRET')) return json({ error: 'forbidden' }, 403)
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

  let body: { action?: string; taskId?: string; response?: string; scope?: string; start?: string; end?: string } = {}
  try {
    body = await req.json()
  } catch {
    /* sem corpo */
  }
  if (body.action === 'recurring') {
    // série recorrente: "all" muda a série inteira; "following" corta a série e cria uma nova a partir desta ocorrência
    if (who.kind !== 'user') return json({ error: 'forbidden' }, 403)
    try {
      const scope = body.scope === 'all' ? 'all' : body.scope === 'following' ? 'following' : null
      const ns = body.start ? new Date(body.start) : null
      const ne = body.end ? new Date(body.end) : null
      if (!scope || !body.taskId || !ns || !ne || isNaN(+ns) || isNaN(+ne) || ne <= ns) return json({ error: 'parâmetros inválidos' }, 400)
      const { data: t } = await db.from('rose_tasks').select('id, google_calendar_id, google_event_id').eq('id', body.taskId).eq('user_id', who.userId).maybeSingle()
      if (!t?.google_event_id || !t.google_calendar_id) return json({ error: 'evento não encontrado' }, 404)
      const { data: cal } = await db.from('rose_google_calendars').select('access_role').eq('user_id', who.userId).eq('google_calendar_id', t.google_calendar_id).maybeSingle()
      if (!['owner', 'writer'].includes(cal?.access_role ?? '')) return json({ error: 'agenda somente leitura' }, 403)
      const { data: tok } = await db.from('rose_google_tokens').select('refresh_token').eq('user_id', who.userId).maybeSingle()
      if (!tok) return json({ error: 'Google não conectado' }, 400)
      const access = await accessToken(tok.refresh_token)
      const calPath = `/calendars/${encodeURIComponent(t.google_calendar_id)}`
      const inst = await g(access, `${calPath}/events/${t.google_event_id}`)
      if (inst.status !== 200) return json({ error: `events.get ${inst.status}` }, 502)
      const masterId = inst.body.recurringEventId as string | undefined
      if (!masterId) return json({ error: 'não é um evento recorrente' }, 400)
      const master = await g(access, `${calPath}/events/${encodeURIComponent(masterId)}`)
      if (master.status !== 200) return json({ error: `master ${master.status}` }, 502)
      const tz = (master.body.start?.timeZone as string | undefined) ?? undefined
      const instStart = new Date(inst.body.start?.dateTime ?? inst.body.start?.date)
      const origStart = new Date(inst.body.originalStartTime?.dateTime ?? inst.body.originalStartTime?.date ?? instStart)
      const masterStart = new Date(master.body.start?.dateTime ?? master.body.start?.date)
      const isFirst = Math.abs(origStart.getTime() - masterStart.getTime()) < 60000

      if (scope === 'all' || isFirst) {
        const s = new Date(masterStart.getTime() + (ns.getTime() - instStart.getTime()))
        const e = new Date(s.getTime() + (ne.getTime() - ns.getTime()))
        const res = await g(access, `${calPath}/events/${encodeURIComponent(masterId)}?sendUpdates=all`, {
          method: 'PATCH',
          body: JSON.stringify({ start: { dateTime: s.toISOString(), timeZone: tz }, end: { dateTime: e.toISOString(), timeZone: tz } }),
        })
        if (res.status !== 200) return json({ error: `events.patch ${res.status}` }, 502)
      } else {
        // 1) encerra a série original na ocorrência anterior
        const until = new Date(origStart.getTime() - 1000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
        const rec = ((master.body.recurrence ?? []) as string[]).map((r) => (r.startsWith('RRULE:') ? 'RRULE:' + r.slice(6).split(';').filter((p) => !/^(UNTIL|COUNT)=/.test(p)).concat(`UNTIL=${until}`).join(';') : r))
        const cut = await g(access, `${calPath}/events/${encodeURIComponent(masterId)}?sendUpdates=all`, { method: 'PATCH', body: JSON.stringify({ recurrence: rec }) })
        if (cut.status !== 200) return json({ error: `events.patch ${cut.status}` }, 502)
        // 2) nova série a partir desta ocorrência, com o horário novo
        const m = master.body
        const recNew = ((m.recurrence ?? []) as string[]).filter((r) => !r.startsWith('EXDATE')).map((r) => (r.startsWith('RRULE:') ? 'RRULE:' + r.slice(6).split(';').filter((p) => !/^(UNTIL|COUNT)=/.test(p)).join(';') : r))
        const neu = {
          summary: m.summary,
          description: m.description,
          location: m.location,
          colorId: m.colorId,
          reminders: m.reminders,
          attendees: (m.attendees ?? []).map((a: { email?: string; optional?: boolean }) => ({ email: a.email, optional: a.optional })),
          conferenceData: m.conferenceData,
          recurrence: recNew,
          start: { dateTime: ns.toISOString(), timeZone: tz },
          end: { dateTime: ne.toISOString(), timeZone: tz },
        }
        const res = await g(access, `${calPath}/events?sendUpdates=all&conferenceDataVersion=1`, { method: 'POST', body: JSON.stringify(neu) })
        if (res.status !== 200) return json({ error: `events.insert ${res.status}` }, 502)
      }
      // traz as ocorrências atualizadas (a busca incremental pega tudo que o Google marcou como alterado)
      await syncUser(db, who.userId, t.google_calendar_id)
      return json({ ok: true })
    } catch (e) {
      return json({ error: String(e) }, 500)
    }
  }
  if (body.action === 'rsvp') {
    if (who.kind !== 'user') return json({ error: 'forbidden' }, 403)
    try {
      const status = ['accepted', 'declined', 'tentative'].includes(body.response ?? '') ? body.response! : null
      if (!status || !body.taskId) return json({ error: 'parâmetros inválidos' }, 400)
      const { data: t } = await db.from('rose_tasks').select('id, google_calendar_id, google_event_id, google_meta').eq('id', body.taskId).eq('user_id', who.userId).maybeSingle()
      if (!t?.google_event_id || !t.google_calendar_id) return json({ error: 'evento não encontrado' }, 404)
      const { data: tok } = await db.from('rose_google_tokens').select('refresh_token').eq('user_id', who.userId).maybeSingle()
      if (!tok) return json({ error: 'Google não conectado' }, 400)
      const access = await accessToken(tok.refresh_token)
      const path = `/calendars/${encodeURIComponent(t.google_calendar_id)}/events/${t.google_event_id}`
      const cur = await g(access, path)
      if (cur.status !== 200) return json({ error: `events.get ${cur.status}` }, 502)
      const attendees = ((cur.body.attendees ?? []) as { self?: boolean; responseStatus?: string }[]).map((a) => (a.self ? { ...a, responseStatus: status } : a))
      const res = await g(access, `${path}?sendUpdates=all`, { method: 'PATCH', body: JSON.stringify({ attendees }) })
      if (res.status !== 200) return json({ error: `events.patch ${res.status}` }, 502)
      const meta = { ...(t.google_meta as Record<string, unknown>), attendees: (res.body.attendees ?? []).map((a: { email?: string; displayName?: string; responseStatus?: string; organizer?: boolean; self?: boolean; optional?: boolean }) => ({ email: a.email ?? '', name: a.displayName ?? null, status: a.responseStatus ?? 'needsAction', organizer: !!a.organizer, self: !!a.self, optional: !!a.optional })) }
      await db.from('rose_tasks').update({ google_meta: meta, google_etag: res.body.etag }).eq('id', t.id)
      return json({ ok: true })
    } catch (e) {
      return json({ error: String(e) }, 500)
    }
  }

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
