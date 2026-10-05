import { supabase } from './supabase'
import { startOfDay } from './dates'
import type { Task } from './types'

const OFFSET_MIN: Record<string, number> = { on_time: 0, '5m': 5, '30m': 30, '1h': 60, '1d': 1440 }

/** Momentos em que os lembretes de uma tarefa disparam (dia inteiro → 09:00, como no TickTick). */
export function fireTimes(task: Task): { key: string; at: Date }[] {
  if (!task.due_at || task.status !== 0 || task.deleted_at) return []
  const due = new Date(task.due_at)
  const base = task.all_day ? new Date(startOfDay(due).getTime() + 9 * 3600000) : due
  return task.reminders
    .filter((r) => r in OFFSET_MIN)
    .map((r) => ({ key: `${task.id}:${r}:${base.getTime()}`, at: new Date(base.getTime() - OFFSET_MIN[r] * 60000) }))
}

export const notificationsSupported = () => 'Notification' in window

export async function askPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return 'denied'
  return Notification.permission === 'default' ? Notification.requestPermission() : Notification.permission
}

const b64ToUint8 = (b64: string) => {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

/** Inscreve este aparelho no Web Push e guarda a inscrição (RLS: só do próprio usuário). */
export async function enablePush(userId: string): Promise<'ok' | 'denied' | 'unsupported' | 'nokey'> {
  const key = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined
  if (!key) return 'nokey'
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported'
  if ((await askPermission()) !== 'granted') return 'denied'
  const reg = await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToUint8(key) }))
  const json = sub.toJSON()
  await supabase.from('rose_push_subscriptions').upsert({ user_id: userId, endpoint: sub.endpoint, keys: json.keys, user_agent: navigator.userAgent.slice(0, 200) }, { onConflict: 'endpoint' })
  return 'ok'
}

export async function disablePush(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  await supabase.from('rose_push_subscriptions').delete().eq('endpoint', sub.endpoint)
  await sub.unsubscribe()
}

export async function pushActive(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false
  const reg = await navigator.serviceWorker.getRegistration()
  return !!(await reg?.pushManager.getSubscription())
}

export function showLocal(title: string, body: string, taskId: string) {
  if (!notificationsSupported() || Notification.permission !== 'granted') return
  void navigator.serviceWorker?.getRegistration().then((reg) => {
    if (reg) void reg.showNotification(title, { body, icon: '/icon-192.png', tag: taskId, data: { taskId } })
    else new Notification(title, { body, icon: '/icon-192.png', tag: taskId })
  })
}
