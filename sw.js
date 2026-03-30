/**
 * Service Worker — ST Perfumería
 * Maneja notificaciones push
 */

self.addEventListener('push', function(event) {
  var data = { title: 'ST Perfumería', body: '', icon: '/img/logo-st.webp', url: '/' };

  try {
    if (event.data) {
      var payload = event.data.json();
      data.title = payload.title || data.title;
      data.body = payload.body || data.body;
      data.icon = payload.icon || data.icon;
      data.url = payload.url || data.url;
    }
  } catch (e) {
    if (event.data) data.body = event.data.text();
  }

  var options = {
    body: data.body,
    icon: data.icon,
    badge: '/img/logo-st.webp',
    vibrate: [200, 100, 200],
    data: { url: data.url },
    actions: [
      { action: 'open', title: 'Ver ahora' }
    ]
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  var url = event.notification.data && event.notification.data.url
    ? event.notification.data.url
    : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (var i = 0; i < clientList.length; i++) {
        if (clientList[i].url.indexOf('st-perfumeria') !== -1 && 'focus' in clientList[i]) {
          clientList[i].navigate(url);
          return clientList[i].focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
