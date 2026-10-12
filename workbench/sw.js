/* 日常 · 生活工作台 —— Service Worker
 * 目标：既能离线打开，又能「新版本及时生效」，且绝不触碰 localStorage 里的用户数据。
 *
 * 策略：
 *   - install：预缓存应用外壳，并立即 skipWaiting（不等旧页面关闭）
 *   - activate：清掉本应用遗留的旧缓存 + clients.claim（立即接管已打开的页面）
 *   - 导航请求（index.html）：**网络优先**，拿最新 HTML；离线回退缓存
 *   - version.json：网络优先（no-store），保证「检查更新」拿到真值
 *   - 静态资源（css/js/图标）：**网络优先 + 绕过 HTTP 缓存**（cache:'no-store'）。
 *       关键：只写 fetch(req) 会先命中浏览器自己的 HTTP 磁盘缓存，服务器返回 304
 *       时拿到的仍是旧内容 —— 这正是「发了新版，用户还一直吃旧 JS」的根因。
 *       显式 no-store 强制每次都向服务器要真内容；失败再回退 SW 缓存（离线可用）。
 *
 * 为什么这里没有版本号（曾经有，v1.26.3 起去掉）
 * ------------------------------------------------
 * 以前缓存名写作 'lifehub-v1.26.3'，靠「发版时手改它」来触发 SW 重装。
 * 但版本号一旦要在多个文件里手工同步，就必然会漏改（见 js/core.js 里的记录）。
 * 现在缓存名固定为 'lifehub-shell'：
 *   · 在线时静态资源一律 network-first，所以「刷新即最新」不依赖 SW 重装；
 *   · 离线时缓存照常兜底，预热和回填都写进这个固定缓存；
 *   · 升级路径也通 —— 老用户拿到这份新 sw.js 后，install 会预缓存外壳，
 *     activate 会把历史上留下的 lifehub-v* 旧缓存一并清掉。
 * 代价：以后发版 sw.js 字节不变 → 浏览器不会重装 SW → 也就没有
 *      「新 SW 接管 → 自动刷新」这条兜底了。改由 js/boot.js 里的
 *      watchNewVersion() 直接比对 version.json 来发现新版并提示刷新。
 *
 * 版本号/构建日期请在 version.json 里改（用 tools/bump.sh），全项目只此一处。
 */
const CACHE = 'lifehub-shell';
const CACHE_PREFIX = 'lifehub-';
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
  './js/items.js',
  './js/boot.js',
  './js/loader.js',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-512.png'
];
/* 注意：js/vendor/zxing-1d.min.js（74KB 扫码库）故意 **不** 放进 SHELL。
   它是按需加载的 —— 放进来会让每个用户首访都下载 74KB，哪怕从不扫码。
   不带进预缓存也不影响离线：下面的 fetch 处理器会把任何成功拉取过的同源静态
   资源写进缓存，所以「用过一次扫码」之后离线也能扫。 */

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
      // 只动本应用自己的缓存（历史上叫 lifehub-v1.2x），不碰同域下别人的
      .then(keys => Promise.all(
        keys.filter(k => k.indexOf(CACHE_PREFIX) === 0 && k !== CACHE).map(k => caches.delete(k))
      ))
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
