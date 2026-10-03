/* ============================================================
   sw.js — Service Worker（离线可用 + 换版即生效）
   策略：同源资源一律「网络优先，失败回退缓存」。
   千万不要对 css/js 用 cache-first —— 那会导致新 HTML 配上旧脚本，
   用户看到的永远是旧版本，且只能靠清缓存解决。
   第三方接口一律不拦截。
   ============================================================ */

var CACHE = 'toolbox-v1.0.0';

var SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'version.json',
  'assets/css/tokens.css',
  'assets/css/base.css',
  'assets/css/layout.css',
  'assets/css/components.css',
  'assets/css/boot.css',
  'assets/css/features/overview.css',
  'assets/css/features/image2webp.css',
  'js/loader.js',
  'js/core.js',
  'js/registry.js',
  'js/shell.js',
  'js/router.js',
  'js/settings.js',
  'js/tools/overview.js',
  'js/tools/image2webp.js',
  'js/app.js',
  'assets/icons/logo.svg',
  'icon-192.png',
  'icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      /* 单个资源失败不影响整体安装 */
      return Promise.all(SHELL.map(function (u) {
        return c.add(new Request(u, { cache: 'reload' })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
        return null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (e) {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }

  /* 跨域（天气、接口等）不拦截，直接走网络 */
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(req).then(function (res) {
      /* 网络成功：回填缓存副本（仅同源、正常响应） */
      if (res && res.status === 200 && res.type === 'basic') {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); }).catch(function () {});
      }
      return res;
    }).catch(function () {
      /* 离线：回退缓存；导航请求回退到缓存的 index.html */
      return caches.match(req, { ignoreSearch: true }).then(function (hit) {
        if (hit) return hit;
        if (req.mode === 'navigate') {
          return caches.match('index.html').then(function (idx) {
            return idx || new Response('离线，且没有找到缓存页面。', {
              status: 503,
              headers: { 'Content-Type': 'text/plain; charset=utf-8' }
            });
          });
        }
        return new Response('', { status: 504, statusText: '离线' });
      });
    })
  );
});
