/* 日常 · 生活工作台 —— Service Worker (v1.21)
 * 目标：既能离线打开，又能「新版本及时生效」，且绝不触碰 localStorage 里的用户数据。
 *
 * 策略：
 *   - install：预缓存应用外壳，并立即 skipWaiting（不等旧页面关闭）
 *   - activate：清掉旧版本缓存 + clients.claim（立即接管已打开的页面）
 *   - 导航请求（index.html）：**网络优先**，拿最新 HTML；离线回退缓存
 *   - version.json：网络优先（no-store），保证「检查更新」拿到真值
 *   - 静态资源（css/js/图标）：**网络优先**（在线时永远拿最新、顺带回填缓存），
 *       网络失败才回退缓存。这样「在线打开 = 最新版」，彻底避免旧 JS 被缓存卡住；
 *       离线时仍由缓存兜底，离线可用不受影响。
 *       —— 之所以不做 cache-first：那会导致「发了新版，用户还一直吃旧 JS」。
 *   - 第三方接口（天气/新闻/AI）：完全不拦截
 *
 * 注意：本文件里的版本号 CACHE 变化会触发浏览器 SW 字节比对 → 自动走新 SW 安装流程。
 *       所以每次发布只要保证 sw.js 内容有变（哪怕只改版本号），更新就能被触发。
 */
const CACHE = 'lifehub-v1.23';
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

// 页面可通过 postMessage({type:'SKIP_WAITING'}) 让等待中的新 SW 立即接管
self.addEventListener('message', e => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // 只接管同源请求；第三方接口一律放行
  if (url.origin !== self.location.origin) return;

  // 版本清单：网络优先，保证「检查更新」拿到真值
  if (url.pathname.endsWith('/version.json')) {
    e.respondWith(fetch(req, { cache: 'no-store' }).catch(() => caches.match(req)));
    return;
  }

  // 页面导航：网络优先（拿最新 HTML），离线回退缓存的 index
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(res => {
        // 顺手回填一份最新 index，供离线使用
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put('./index.html', copy)).catch(() => {});
        return res;
      }).catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  // 其余同源静态资源：网络优先（在线永远最新），失败回退缓存（离线可用）
  e.respondWith(
    fetch(req).then(res => {
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(req))
  );
});
