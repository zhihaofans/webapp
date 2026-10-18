/* ============================================================
   loader.js — 并行加载
   一次性把所有模块插进文档，浏览器并行下载、按插入顺序执行。

   为什么不是「一个 onload 才插下一个」：
   那种写法把加载过程人为串行化了 —— 15 个文件就是 15 个来回，
   弱网下每个来回 200~300ms，加起来正好是「几秒白屏」。
   动态脚本设 async=false 后浏览器会把它放进「按序执行」队列：
   下载是并行的，执行仍然严格按 core → registry → … → app 的顺序，
   依赖关系一点没变，等待时间却从「15 个 RTT 之和」变成「1 个 RTT」。

   （各模块都是独立经典脚本，共享全局 Toolbox 命名空间）
   ============================================================ */
(function () {
  var ASSETS = [
    'js/core.js',
    'js/registry.js',
    'js/shell.js',
    'js/router.js',
    'js/settings.js',
    'js/lib/github2jsdelivr.js',
    'js/lib/ghmirror.js',
    'js/lib/datecalc.js',
    'js/lib/unitconvert.js',
    'js/lib/webpenc.js',
    'js/lib/qr.js',
    'js/lib/qrdec.js',
    'js/lib/lanshare.js',
    'js/tools/overview.js',
    'js/tools/imageconvert.js',
    'js/tools/github2jsdelivr.js',
    'js/tools/datecalc.js',
    'js/tools/unitconvert.js',
    'js/tools/lanshare.js',
    'js/app.js'
  ];

  var total = ASSETS.length;
  var done = 0;
  var failed = [];
  var prog = document.getElementById('bootProg');
  var bar = document.getElementById('bootBar');

  var verEl = document.getElementById('bootVer');
  var verShown = false;

  /* 版本号只在 core.js 里有一份。core.js 是第 1 个被执行的脚本，
     它一到位就把它填进启动页 —— 不额外发请求，也不会出现两处版本号对不上。 */
  function syncVersion() {
    if (verShown || !verEl) return;
    var v = window.Toolbox && window.Toolbox.APP_VER;
    if (!v) return;
    verEl.textContent = 'v' + v;
    verShown = true;
  }

  function paint() {
    if (prog) prog.textContent = '正在加载 ' + done + '/' + total;
    if (bar) bar.style.width = Math.round(done / total * 100) + '%';
    syncVersion();
  }

  /* 全部插进去。async=false 保证「并行下载、按序执行」，
     所以这里不需要任何链式等待 —— 也就不存在被串行化的问题。 */
  function loadAll() {
    ASSETS.forEach(function (src) {
      var s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = function () {
        done += 1;
        paint();
        if (done === total) finish();
      };
      s.onerror = function () {
        failed.push(src);
        done += 1;
        paint();
        console.error('[加载失败] ' + src);
        if (done === total) finish();
      };
      document.head.appendChild(s);
    });
  }

  function finish() {
    var loader = document.getElementById('bootLoader');
    function hide() {
      if (!loader) return;
      loader.classList.add('boot--hide');
      setTimeout(function () { loader.style.display = 'none'; }, 380);
    }

    if (typeof window.__TOOLBOX_BOOT__ !== 'function') {
      if (loader) {
        loader.classList.add('boot--err');
        if (prog) {
          prog.textContent = failed.length
            ? ('有 ' + failed.length + ' 个脚本没能加载：' + failed.join('、'))
            : '启动失败，请刷新页面重试';
        }
      }
      return;
    }

    try {
      window.__TOOLBOX_BOOT__();
      hide();
    } catch (e) {
      console.error('[启动失败]', e);
      if (loader) {
        loader.classList.add('boot--err');
        if (prog) prog.textContent = '启动失败：' + (e && e.message ? e.message : e);
      }
    }
  }

  paint();
  syncVersion();
  loadAll();

  /* ------------------------------------------------------------
     Service Worker：PWA 离线可用 + 换版即拿最新
     缓存策略见 sw.js（网络优先 + 超时兜底）。
     用户数据都在 localStorage，刷新 / 换 SW / 清缓存都不会丢。
     ------------------------------------------------------------ */
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.__TOOLBOX_FORCE_UPDATE__ = function () {
      try { sessionStorage.removeItem('toolbox.swReloadAt'); } catch (e) {}
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(function (rs) {
          rs.forEach(function (r) { try { r.update(); } catch (e) {} });
        }).catch(function () {});
      }
      reloadOnce('手动触发');
    };

    var reloading = false;
    function reloadOnce(why) {
      if (reloading) return;
      reloading = true;
      try {
        var last = +(sessionStorage.getItem('toolbox.swReloadAt') || 0);
        if (last && Date.now() - last < 10000) { reloading = false; return; }
        sessionStorage.setItem('toolbox.swReloadAt', String(Date.now()));
      } catch (e) {}
      console.log('[更新] 刷新到新版本：' + why);
      location.reload();
    }

    window.addEventListener('load', function () {
      /* updateViaCache:'none' —— 让浏览器查 sw.js 更新时绕开 HTTP 缓存。
         GitHub Pages 给静态文件发的是 max-age=600，不绕过的话新版本
         可能被浏览器自己缓存压住最多 10 分钟，用户拿到的一直是旧 SW。 */
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function (reg) {
        try { reg.update(); } catch (e) {}
        reg.addEventListener('updatefound', function () {
          var nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', function () {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) {
              try { nw.postMessage({ type: 'SKIP_WAITING' }); } catch (e) {}
            }
          });
        });
        document.addEventListener('visibilitychange', function () {
          if (document.visibilityState === 'visible') { try { reg.update(); } catch (e) {} }
        });
      }).catch(function (e) { console.warn('[SW] 注册失败（不影响使用）', e); });
    });

    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController) return;      /* 首次安装不刷新 */
      reloadOnce('新 Service Worker 已接管');
    });
  }
})();
