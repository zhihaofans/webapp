/* ============================================================
   sw.js — Service Worker（离线可用 + 换版即生效 + 启动不等网络）

   三条原则，按重要性排：

   1) 换版即生效 —— 本项目资源 URL 不带内容指纹（就是 core.js、base.css
      这种裸名字），所以脚本一旦无条件用缓存，就会出现「新 index.html
      配上旧 core.js」，用户看到的永远是旧版且只能靠清缓存解决。
      因此脚本一律「网络优先 + 短超时」。
      唯一例外是 CSS 与 loader.js：它们卡在首帧前面，走缓存才不会白等，
      代价（一次性样式偏差）也远小于脚本混搭。见下面的 cacheFirst。

   2) 启动不等网络（v1.12 新增，本次白屏的根治）——
      每个请求都有「网络等待上限」，超时立刻拿缓存渲染，网络结果在后台
      回填。原来是不设上限的 network-first：弱网下 fetch 会一直挂着不
      reject，缓存里明明有货也要干等，26 个请求串起来就是几秒白屏。

   3) 离线可用 —— 网络失败回退预缓存，导航请求兜底到 index.html。

   第三方接口一律不拦截。
   ============================================================ */

var CACHE = 'toolbox-v1.12.0';

/* 网络等待上限（毫秒）
   - 导航：给宽一点。HTML 必须拿到最新的，否则新页面配旧脚本。
   - 其余脚本：短一些。它们全在预缓存里，超时直接吃缓存反而更快。
   正常网络下 RTT 只有几十毫秒，这两个值都碰不到；只有弱网才会触发，
   而触发时正是我们想要的「别等了，先用缓存」。 */
var NAV_TIMEOUT = 1500;
var ASSET_TIMEOUT = 600;

var SHELL = [
  './',
  'index.html',
  'assets/css/tokens.css',
  'assets/css/base.css',
  'assets/css/layout.css',
  'assets/css/components.css',
  'assets/css/features/overview.css',
  'assets/css/features/imageconvert.css',
  'assets/css/features/github2jsdelivr.css',
  'assets/css/features/datecalc.css',
  'assets/css/features/unitconvert.css',
  'js/loader.js',
  'js/core.js',
  'js/registry.js',
  'js/shell.js',
  'js/router.js',
  'js/settings.js',
  'js/lib/github2jsdelivr.js',
  'js/lib/ghmirror.js',
  'js/lib/datecalc.js',
  'js/lib/unitconvert.js',
  'js/tools/overview.js',
  'js/tools/imageconvert.js',
  'js/tools/github2jsdelivr.js',
  'js/tools/datecalc.js',
  'js/tools/unitconvert.js',
  'js/app.js',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png'
];
/* 注意 version.json 不在列表里 —— 它是「有没有新版本」的探针，
   缓存它等于自己骗自己。见下面的 fetch 分支。 */

function noop() {}

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      /* 单个资源失败不影响整体安装 */
      return Promise.all(SHELL.map(function (u) {
        return c.add(new Request(u, { cache: 'reload' })).catch(noop);
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

/* ------------------------------------------------------------
   取缓存副本：先按原样找，导航请求再兜底到 index.html / 根路径。
   都没有就返回一个说明清楚的响应，而不是让页面白屏。
   ------------------------------------------------------------ */
function fromCache(req) {
  return caches.open(CACHE).then(function (c) {
    return c.match(req, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      if (req.mode === 'navigate') {
        return c.match('index.html').then(function (x) {
          return x || c.match('./');
        });
      }
      return null;
    });
  }).then(function (hit) {
    if (hit) return hit;
    var nav = req.mode === 'navigate';
    return new Response(nav ? '离线，且没有找到缓存页面。' : '', {
      status: nav ? 503 : 504,
      statusText: '离线',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  });
}

/* ------------------------------------------------------------
   网络优先 + 超时兜底
   两条分支同时起跑，谁先到用谁：
     · 网络在 ms 内返回   → 用网络结果，顺带回填缓存
     · 网络超过 ms 或失败 → 立刻用缓存，网络结果回来后再回填
   回填挂在 e.waitUntil 上，避免 SW 提前被回收导致更新丢失。
   ------------------------------------------------------------ */
function networkFirst(e, req, ms) {
  var netP = fetch(req).then(function (res) {
    if (res && res.status === 200 && res.type === 'basic') {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { return c.put(req, copy); }).catch(noop);
    }
    return res;
  }).catch(function () { return null; });

  /* 无论这次用不用得上，都让 SW 活到网络结束 —— 回填缓存算它的收尾工作 */
  e.waitUntil(netP.then(noop, noop));

  return new Promise(function (resolve) {
    var settled = false;
    var timer = setTimeout(function () {
      if (settled) return;
      settled = true;
      fromCache(req).then(resolve);
    }, ms);

    netP.then(function (res) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (res) { resolve(res); return; }
      fromCache(req).then(resolve);
    });
  });
}

/* ------------------------------------------------------------
   缓存优先 + 后台更新（只给「卡在首帧前面」的那几个文件用）

   为什么单独开一条路：外链样式表**阻塞渲染** —— 只要 head 里还有没到齐的
   CSS，浏览器就不画第一帧。让它们也走「网络优先 + 超时」，等于每次弱网
   打开都硬等一个超时窗口，用户盯着的正是这段时间。

   走缓存的代价很小：CSS 版本对不上最多是一次样式偏差，不会像脚本那样直接
   报错；而且更新照做 —— 缓存立刻返回，网络请求同时在后台跑并回填。
   loader.js 同理，它决定后面加载哪些模块，也在关键路径上。
   换版时的短暂不一致由「新 SW 接管 → 自动刷新」兜住。

   脚本不走这条路：新旧脚本混搭会真的把页面跑挂，宁可多等一个超时。
   ------------------------------------------------------------ */
function isCritical(url) {
  /* splash/ 是 iOS 主屏启动时系统要的那张图 —— 它比页面本身还早显示，
     更不该等网络。不放进预缓存列表（389 KB 会拖慢安装），
     靠这条规则按需缓存：用到哪张存哪张，第二次打开就秒开。 */
  return /\.css$/.test(url.pathname)
      || /\/loader\.js$/.test(url.pathname)
      || /\/splash\//.test(url.pathname);
}

function cacheFirst(e, req) {
  return caches.open(CACHE).then(function (c) {
    return c.match(req, { ignoreSearch: true }).then(function (hit) {
      var netP = fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          c.put(req, res.clone()).catch(noop);
        }
        return res;
      }).catch(function () { return null; });

      e.waitUntil(netP.then(noop, noop));

      if (hit) return hit;                 /* 有缓存：立刻给，更新在后台 */
      return netP.then(function (res) {
        return res || fromCache(req);      /* 没缓存（首次）：等网络，失败再兜底 */
      });
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (err) { return; }

  /* 跨域（天气、接口等）不拦截，直接走网络 */
  if (url.origin !== self.location.origin) return;

  /* 版本探针放行：这个请求的意义就是「问服务器现在是什么版本」，
     走缓存等于问自己。放它走纯网络，拿不到就老实报失败。 */
  if (/\/version\.json$/.test(url.pathname)) return;

  if (req.mode === 'navigate') {
    e.respondWith(networkFirst(e, req, NAV_TIMEOUT));
  } else if (isCritical(url)) {
    e.respondWith(cacheFirst(e, req));
  } else {
    e.respondWith(networkFirst(e, req, ASSET_TIMEOUT));
  }
});
