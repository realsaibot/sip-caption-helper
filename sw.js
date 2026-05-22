// sw.js — bump CACHE_NAME whenever you deploy new files
const CACHE_NAME = 'caption-helper-v4';

const PRECACHE = [
  '/',
  '/index.html',
  '/options.html',
  '/builder.css',
  '/builder.js',
  '/options.js',
  '/photo-db.js',
  '/crop-picker.js',
  '/manifest.webmanifest'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  // Network-first: serve fresh JS/HTML immediately so updates land on next load.
  // Falls back to cache when offline.
  event.respondWith(
    fetch(event.request)
      .then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        return res;
      })
      .catch(() => caches.match(event.request))
  );
});
