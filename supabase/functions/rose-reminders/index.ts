// Rose · dispara lembretes (Web Push + e-mail). Rodar a cada minuto via cron (x-cron-secret).
// Segredos: CRON_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, RESEND_API_KEY (opcional), MAIL_FROM (opcional).
import webpush from 'npm:web-push@3.6.7'
import { admin, caller, cors, json, plain } from '../_shared/util.ts'

const OFFSET_MIN: Record<string, number> = { on_time: 0, '5m': 5, '30m': 30, '1h': 60, '1d': 1440 }
const LABEL: Record<string, Record<string, string>> = {
  pt: { on_time: 'Agora', '5m': 'em 5 minutos', '30m': 'em 30 minutos', '1h': 'em 1 hora', '1d': 'amanhã' },
  en: { on_time: 'Now', '5m': 'in 5 minutes', '30m': 'in 30 minutes', '1h': 'in 1 hour', '1d': 'tomorrow' },
  ja: { on_time: '今', '5m': '5分後', '30m': '30分後', '1h': '1時間後', '1d': '明日' },
  it: { on_time: 'Adesso', '5m': 'tra 5 minuti', '30m': 'tra 30 minuti', '1h': 'tra 1 ora', '1d': 'domani' },
}
const WINDOW_MS = 150000 // dispara se o horário caiu nos últimos 2,5 min (o cron roda a cada 1 min)

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const db = admin()
  const who = await caller(req, db)
  if (!who || who.kind !== 'cron') return json({ error: 'unauthorized' }, 401)

  const pub = Deno.env.get('VAPID_PUBLIC_KEY')
  const prv = Deno.env.get('VAPID_PRIVATE_KEY')
  if (pub && prv) webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com', pub, prv)
  const resend = Deno.env.get('RESEND_API_KEY')

  const now = Date.now()
  const { data: tasks, error } = await db
    .from('rose_tasks')
    .select('id,user_id,title,content,due_at,all_day,reminders')
    .eq('status', 0)
    .is('deleted_at', null)
    .not('due_at', 'is', null)
    .gte('due_at', new Date(now - 12 * 3600000).toISOString())
    .lte('due_at', new Date(now + 26 * 3600000).toISOString())
  if (error) return json({ error: error.message }, 500)

  let sent = 0
  const profiles = new Map<string, { lang: string; email: boolean }>()
  const emails = new Map<string, string | null>()

  for (const t of tasks ?? []) {
    const reminders = (t.reminders ?? []) as string[]
    if (!reminders.length) continue
    const due = new Date(t.due_at).getTime()
    const base = t.all_day ? due + 9 * 3600000 : due // dia inteiro → 09:00 (due_at é a meia-noite local)
    for (const r of reminders) {
      if (!(r in OFFSET_MIN)) continue
      const fireAt = base - OFFSET_MIN[r] * 60000
      if (fireAt > now || now - fireAt > WINDOW_MS) continue

      // já enviado? (chave primária task+lembrete+horário)
      const log = await db.from('rose_reminder_log').insert({ task_id: t.id, reminder: r, fire_at: new Date(fireAt).toISOString() })
      if (log.error) continue

      if (!profiles.has(t.user_id)) {
        const { data: p } = await db.from('rose_profiles').select('lang,settings').eq('user_id', t.user_id).maybeSingle()
        profiles.set(t.user_id, { lang: p?.lang ?? 'pt', email: (p?.settings as { email_reminders?: boolean } | null)?.email_reminders !== false })
      }
      const prof = profiles.get(t.user_id)!
      const when = (LABEL[prof.lang] ?? LABEL.pt)[r]
      const body = t.all_day ? when : `${when} · ${new Intl.DateTimeFormat(prof.lang, { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).format(new Date(due))}`

      // Web Push
      if (pub && prv) {
        const { data: subs } = await db.from('rose_push_subscriptions').select('id,endpoint,keys').eq('user_id', t.user_id)
        for (const s of subs ?? []) {
          try {
            await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify({ title: t.title || 'Rose', body, taskId: t.id }))
            sent++
          } catch (e) {
            const status = (e as { statusCode?: number }).statusCode
            if (status === 404 || status === 410) await db.from('rose_push_subscriptions').delete().eq('id', s.id) // aparelho desinscrito
          }
        }
      }

      // E-mail
      if (resend && prof.email) {
        if (!emails.has(t.user_id)) emails.set(t.user_id, (await db.auth.admin.getUserById(t.user_id)).data.user?.email ?? null)
        const to = emails.get(t.user_id)
        if (to) {
          const res = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${resend}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: Deno.env.get('MAIL_FROM') ?? 'Rose <onboarding@resend.dev>',
              to,
              subject: `⏰ ${t.title || 'Rose'} — ${when}`,
              text: `${t.title}\n${when}\n\n${plain(t.content ?? '')}`,
            }),
          })
          if (res.ok) sent++
        }
      }
    }
  }
  // ---------- hábitos: lembrete no horário escolhido (fuso do usuário, gravado em profile.settings.tz) ----------
  const { data: habits } = await db
    .from('rose_habits')
    .select('id,user_id,name,emoji,days,goal,reminder_time,last_reminded_on')
    .eq('archived', false)
    .not('reminder_time', 'is', null)
  let habitSent = 0
  for (const h of habits ?? []) {
    const { data: p } = await db.from('rose_profiles').select('lang,settings').eq('user_id', h.user_id).maybeSingle()
    const settings = (p?.settings ?? {}) as { tz?: string; email_reminders?: boolean }
    const tz = settings.tz ?? 'America/Sao_Paulo'
    const local = new Date().toLocaleString('sv-SE', { timeZone: tz }) // "YYYY-MM-DD HH:MM:SS"
    const day = local.slice(0, 10)
    const nowMin = Number(local.slice(11, 13)) * 60 + Number(local.slice(14, 16))
    const [rh, rm] = String(h.reminder_time).split(':').map(Number)
    const remMin = rh * 60 + rm
    const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(new Date()))
    if (nowMin < remMin || nowMin - remMin > 2 || h.last_reminded_on === day || !(h.days as number[]).includes(dow)) continue
    const { data: log } = await db.from('rose_habit_logs').select('value').eq('habit_id', h.id).eq('day', day).maybeSingle()
    await db.from('rose_habits').update({ last_reminded_on: day }).eq('id', h.id) // marca antes de enviar: nunca duplica
    if ((log?.value ?? 0) >= h.goal) continue // já cumprido hoje
    const title = `${h.emoji ?? '✓'} ${h.name}`
    if (pub && prv) {
      const { data: subs } = await db.from('rose_push_subscriptions').select('id,endpoint,keys').eq('user_id', h.user_id)
      for (const s of subs ?? []) {
        try {
          await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify({ title, body: (LABEL[p?.lang ?? 'pt'] ?? LABEL.pt).on_time }))
          habitSent++
        } catch (e) {
          const status = (e as { statusCode?: number }).statusCode
          if (status === 404 || status === 410) await db.from('rose_push_subscriptions').delete().eq('id', s.id)
        }
      }
    }
    if (resend && settings.email_reminders !== false) {
      const to = (await db.auth.admin.getUserById(h.user_id)).data.user?.email
      if (to) {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${resend}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: Deno.env.get('MAIL_FROM') ?? 'Rose <onboarding@resend.dev>', to, subject: `⏰ ${title}`, text: title }),
        })
        if (res.ok) habitSent++
      }
    }
  }
  return json({ ok: true, checked: tasks?.length ?? 0, sent, habits: habits?.length ?? 0, habitSent })
})
