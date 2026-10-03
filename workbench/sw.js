/* 日常 · 生活工作台 —— Service Worker (v1.19)
 * 策略：
 *   - 预缓存应用外壳（index/css/js/图标/manifest），保证离线可打开
 *   - 同源静态资源：cache-first（命中即用，未命中回源并回填）
 *   - 导航请求：网络优先，失败回退缓存 index（离线也能进）
 *   - version.json：网络优先，避免检测更新拿到旧值
 *   - 第三方接口（天气/新闻/AI）：完全不拦截，直接走网络
 */
const CACHE = 'lifehub-v1.19';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './version.json',
  './assets/style.css',
  './js/core.js',
  './js/weather.js',
  './js/ai_news.js',
  './js/views.js',
  './js/workbench.js',
  './js/boot.js',
  './js/loader.js',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // 只接管同源请求；第三方接口一律放行
  if (url.origin !== self.location.origin) return;

  // 检测更新的版本清单：网络优先
  if (url.pathname.endsWith('/version.json')) {
    e.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  // 页面导航：网络优先，离线回退缓存的 index
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  // 其余同源静态资源：缓存优先
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => hit))
  );
});
