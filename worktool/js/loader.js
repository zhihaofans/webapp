/* ============================================================
   loader.js — 渐进加载
   按固定顺序逐个注入 JS 模块并更新进度，全部就绪后调用启动函数、
   淡出遮罩。比「等所有脚本下载完再白屏跳变」体验更顺。

   加载顺序 = 依赖顺序，不可随意调换：
     core → registry → shell → router → settings → tools/* → app
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
    'js/tools/overview.js',
    'js/tools/imageconvert.js',
    'js/tools/github2jsdelivr.js',
    'js/app.js'
  ];

  var total = ASSETS.length;
  var done = 0;
  var failed = [];
  var prog = document.getElementById('bootProg');
  var bar = document.getElementById('bootBar');

  var verEl = document.getElementById('bootVer');
  var verShown = false;

  /* 版本号只在 core.js 里有一份。core.js 是第 1 个被注入的脚本，
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

  function loadOne(i) {
    if (i >= ASSETS.length) { finish(); return; }
    var s = document.createElement('script');
    s.src = ASSETS[i];
    s.async = false;
    s.onload = function () { done += 1; paint(); loadOne(i + 1); };
    s.onerror = function () {
      failed.push(ASSETS[i]);
      done += 1; paint();
      console.error('[加载失败] ' + ASSETS[i]);
      loadOne(i + 1);
    };
    document.head.appendChild(s);
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
  loadOne(0);

  /* ------------------------------------------------------------
     Service Worker：PWA 离线可用 + 换版即拿最新
     要点（踩过的坑）：静态资源一律「网络优先」，不能用 cache-first ——
     否则新 HTML 会配上旧 JS，表现为「打开还是旧版」。
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
      navigator.serviceWorker.register('sw.js').then(function (reg) {
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
