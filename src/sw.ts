/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching'
import { NavigationRoute, registerRoute } from 'workbox-routing'

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: Array<string | { url: string; revision: string | null }> }

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/auth\//] }))

self.addEventListener('install', () => void self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

// ---------- Web Push (lembretes) ----------
self.addEventListener('push', (event) => {
  let data: { title?: string; body?: string; taskId?: string } = {}
  try {
    data = event.data?.json() ?? {}
  } catch {
    data = { title: 'Rose', body: event.data?.text() }
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Rose', {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.taskId,
      data: { taskId: data.taskId },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const taskId = (event.notification.data as { taskId?: string } | undefined)?.taskId
  const url = taskId ? `/#task=${taskId}` : '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      const w = wins[0]
      if (w) {
        void w.focus()
        return w.navigate(url)
      }
      return self.clients.openWindow(url)
    }),
  )
})
