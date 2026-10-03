/* 日常 · 生活工作台 —— Service Worker (v1.24)
 * 目标：既能离线打开，又能「新版本及时生效」，且绝不触碰 localStorage 里的用户数据。
 *
 * 策略：
 *   - install：预缓存应用外壳，并立即 skipWaiting（不等旧页面关闭）
 *   - activate：清掉旧版本缓存 + clients.claim（立即接管已打开的页面）
 *   - 导航请求（index.html）：**网络优先**，拿最新 HTML；离线回退缓存
 *   - version.json：网络优先（no-store），保证「检查更新」拿到真值
 *   - 静态资源（css/js/图标）：**网络优先 + 绕过 HTTP 缓存**（cache:'no-store'）。
 *       关键：只写 fetch(req) 会先命中浏览器自己的 HTTP 磁盘缓存，服务器返回 304
 *       时拿到的仍是旧内容 —— 这正是「发了新版，用户还一直吃旧 JS」的根因。
 *       显式 no-store 强制每次都向服务器要真内容；失败再回退 SW 缓存（离线可用）。
 *
 * 注意：本文件里的版本号 CACHE 变化会触发浏览器 SW 字节比对 → 自动走新 SW 安装流程。
 *       所以每次发布只要保证 sw.js 内容有变（哪怕只改版本号），更新就能被触发。
 */
const CACHE = 'lifehub-v1.25';
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
// 每次发布改这里（跟 CACHE 同步），用于告诉浏览器「外壳换新版了」，
// 并在 install 阶段主动刷新一次预缓存，避免预缓存里留着旧文件。
const SHELL_VER = '1.25';

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(SHELL.map(u =>
        // 预缓存时也绕过 HTTP 缓存，确保缓存到的是当前发布的真内容
        fetch(new Request(u, { cache: 'reload' })).then(res => {
          if (res && res.ok) return c.put(u, res);
        }).catch(() => {})
      )))
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
  // 页面可发 CHECK_UPDATE：SW 自己去拉 sw.js 看有没有新版
  if (e.data && e.data.type === 'CHECK_UPDATE') self.registration.update().catch(() => {});
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // 只接管同源请求；第三方接口一律放行
  if (url.origin !== self.location.origin) return;

  // SW 自身与版本清单：一律绕过 HTTP 缓存，保证拿到真值
  if (url.pathname.endsWith('/sw.js') || url.pathname.endsWith('/version.json')) {
    e.respondWith(fetch(req, { cache: 'no-store' }).catch(() => caches.match(req)));
    return;
  }

  // 页面导航：网络优先（拿最新 HTML），离线回退缓存的 index
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(new Request(req, { cache: 'no-store' })).then(res => {
        // 顺手回填一份最新 index，供离线使用
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put('./index.html', copy)).catch(() => {});
        return res;
      }).catch(() => caches.match('./index.html').then(r => r || caches.match('./')))
    );
    return;
  }

  // 其余同源静态资源：网络优先（在线永远最新，且绕过 HTTP 缓存），失败回退 SW 缓存
  e.respondWith(
    fetch(new Request(req, { cache: 'no-store' })).then(res => {
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(req))
  );
});
