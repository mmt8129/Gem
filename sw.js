const CACHE_NAME = 'gemini-haber-v1';
const urlsToCache = [
  '/Gem/',
  '/Gem/index.html',
  '/Gem/icon.png',
  '/Gem/manifest.json'
];

// Service Worker kurulumu
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Önbellek açıldı');
        return cache.addAll(urlsToCache);
      })
  );
});

// Aktifleştirme - eski cache'leri temizle
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Fetch - ağ isteklerini yönet
self.addEventListener('fetch', event => {
  // Sadece GET isteklerini önbelleğe al
  if (event.request.method !== 'GET') return;

  // API isteklerini önbelleğe alma (haberler ve AI)
  if (event.request.url.includes('firebaseio.com') || 
      event.request.url.includes('googleapis.com')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Önbellekte varsa döndür
        if (response) {
          return response;
        }

        // Yoksa ağdan al
        return fetch(event.request).then(
          networkResponse => {
            // Sadece geçerli yanıtları önbelleğe al
            if (!networkResponse || networkResponse.status !== 200) {
              return networkResponse;
            }

            // Yanıtı önbelleğe ekle
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache);
              });

            return networkResponse;
          }
        );
      })
  );
});

// Bildirimler için (ileride kullanılabilir)
self.addEventListener('push', event => {
  const options = {
    body: event.data.text(),
    icon: '/Gem/icon.png',
    badge: '/Gem/icon.png',
    vibrate: [200, 100, 200],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    }
  };

  event.waitUntil(
    self.registration.showNotification('Gemini Haber', options)
  );
});
