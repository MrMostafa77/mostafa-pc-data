/* GameVault Firebase Cloud Messaging service worker v22. */
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyCOKK_r4030__sS3tFKeIXIiZUUWowzTms',
  authDomain: 'pc-data-mostafa.firebaseapp.com',
  projectId: 'pc-data-mostafa',
  storageBucket: 'pc-data-mostafa.firebasestorage.app',
  messagingSenderId: '658582821260',
  appId: '1:658582821260:web:672788aca447dc5def1ea9'
});

const messaging = firebase.messaging();

/* Notification payloads are displayed automatically by Firebase Messaging
   when the page is in the background. Data-only messages are displayed here. */
messaging.onBackgroundMessage(function(payload) {
  const notification = payload && payload.notification;
  if (notification) return;

  const data = (payload && payload.data) || {};
  const title = data.title || 'GameVault';
  const options = {
    body: data.body || 'GameVault was updated on another device.',
    icon: data.icon || 'assets/hero-logo-icon.png',
    badge: data.badge || 'assets/hero-logo-icon.png',
    data: data
  };

  return self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({type: 'window', includeUncontrolled: true}).then(function(list) {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/mostafa-pc-data/');
    })
  );
});
