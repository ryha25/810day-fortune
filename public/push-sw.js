self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {
      title: "\u0038\u0031\u0030\u0044\u0061\u0079\u6bce\u65e5\u304f\u3058",
      body: event.data ? event.data.text() : "",
    };
  }

  const title = payload.title || "\u0038\u0031\u0030\u0044\u0061\u0079\u6bce\u65e5\u304f\u3058";
  const options = {
    body: payload.body || "",
    icon: "/app-icon.png",
    badge: "/app-icon.png",
    data: {
      url: payload.url || "/dashboard",
    },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/dashboard";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const targetUrl = new URL(url, self.location.origin).href;
      for (const client of clients) {
        if (client.url === targetUrl && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(targetUrl);
    }),
  );
});
