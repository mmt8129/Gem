const CACHE_NAME = 'gemini-v1';
const ASSETS = [
  '/',
  'index.html',
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&family=Orbitron:wght@600&display=swap'
];

// Kurulum: Dosyaları önbelleğe al
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
});

// Strateji: Önce önbelleğe bak, yoksa internetten al
self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((res) => {
      return res || fetch(e.request);
    })
  );
});
