const CACHE_NAME = "student-chat-v3";
const APP_SHELL = ["./", "./manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
});

self.addEventListener("push", (event) => {
  let data = {
    title: "Nowa wiadomość",
    body: "Masz nowe powiadomienie.",
    url: "./#/teacher/panel",
    badgeCount: null,
  };

  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {}

  const tasks = [];

  if (Number.isFinite(Number(data.badgeCount)) && self.navigator?.setAppBadge) {
    const count = Number(data.badgeCount);
    tasks.push(count > 0 ? self.navigator.setAppBadge(count) : self.navigator.clearAppBadge?.());
  }

  tasks.push(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "./icons/icon-192.png",
      badge: "./icons/badge-96.png",
      tag: data.tag || "student-chat-notification",
      renotify: true,
      data: { url: data.url || "./#/teacher/panel" }
    })
  );

  event.waitUntil(Promise.all(tasks.filter(Boolean)));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = new URL(
    event.notification.data?.url || "./#/teacher/panel",
    self.registration.scope
  ).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.startsWith(self.registration.scope) && "focus" in client) {
          if ("navigate" in client) {
            return client.navigate(targetUrl).then(() => client.focus());
          }
          return client.focus();
        }
      }
      return self.clients.openWindow ? self.clients.openWindow(targetUrl) : undefined;
    })
  );
});
