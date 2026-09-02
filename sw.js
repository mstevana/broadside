// BROADSIDE — offline cache. Everything the game needs is local, so a single
// precache makes it fully playable with no network.
const CACHE = 'broadside-v14';
const ASSETS = [
  './', './index.html', './manifest.webmanifest',
  './vendor/three.module.min.js',
  './src/main.js', './src/data.js', './src/ship.js', './src/world.js',
  './src/ai.js', './src/input.js', './src/hud.js', './src/refit.js',
  './src/meshes.js', './src/audio.js', './src/music.js', './src/craft.js',
  './src/tutorial.js', './src/merge.js', './src/textures.js', './src/backdrop.js', './src/bloom.js', './src/persist.js', './src/formation.js', './src/settings.js',
  './icons/icon-192.png', './icons/icon-512.png',
  // NASA/ESA/CSA nebula plates — see CREDITS.md
  './assets/nebula/carina.jpg', './assets/nebula/helix.jpg',
  './assets/nebula/crab.jpg', './assets/nebula/southernring.jpg',
  './assets/nebula/eagle.jpg', './assets/nebula/tarantula.jpg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// network-first for same-origin GETs so updates land, cache as the fallback
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
  );
});
