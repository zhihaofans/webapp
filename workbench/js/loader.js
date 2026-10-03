(function(){
  // 多文件渐进加载：先显示「加载中」，再按顺序注入脚本，每完成一个更新进度
  var ASSETS = [
    'js/core.js', 'js/weather.js', 'js/ai_news.js',
    'js/views.js', 'js/workbench.js', 'js/boot.js'
  ];
  var total = ASSETS.length, done = 0;
  var prog = document.getElementById('bootProg');
  function setProg(){ if (prog) prog.textContent = '加载模块 ' + done + '/' + total; }
  function loadOne(i){
    if (i >= ASSETS.length){ finish(); return; }
    var s = document.createElement('script');
    s.src = ASSETS[i];
    s.onload = function(){ done++; setProg(); loadOne(i + 1); };
    s.onerror = function(){ done++; setProg(); loadOne(i + 1); };
    document.head.appendChild(s);
  }
  function finish(){
    var l = document.getElementById('bootLoader');
    if (l){ l.classList.add('boot-loader--hide'); setTimeout(function(){ l.style.display = 'none'; }, 400); }
    if (typeof window.__LIFEHUB_BOOT__ === 'function'){
      try { window.__LIFEHUB_BOOT__(); }
      catch (e){
        console.error('boot error', e);
        if (l){ l.style.display = 'flex'; l.classList.remove('boot-loader--hide');
          var t = document.getElementById('bootProg'); if (t) t.textContent = '启动失败：' + (e && e.message ? e.message : e); }
      }
    } else {
      console.error('boot 未就绪：window.__LIFEHUB_BOOT__ 不存在');
    }
  }
  setProg();
  loadOne(0);

  /* ---------------------------------------------------------------
     PWA / Service Worker：注册 + 自动更新（数据在 localStorage，刷新不丢）
     解决「旧版一直生效、要清缓存才更新」的问题：
       1) 每次加载都 registration.update() 主动去服务器比对 sw.js
       2) 发现新 SW 就绪 → 通知它 skipWaiting
       3) controllerchange 时自动 reload 一次（带防重入，绝不循环）
     同时提供手动入口 window.__LIFEHUB_FORCE_UPDATE__()
     --------------------------------------------------------------- */
  if ('serviceWorker' in navigator && location.protocol !== 'file:'){
    var RELOAD_KEY = 'lifehub.v1.swReloadAt';
    var reloading = false;
    function reloadOnce(reason){
      if (reloading) return;
      reloading = true;
      // 防重入：10 秒内只自动刷新一次，避免极端情况下循环
      try {
        var last = +(sessionStorage.getItem(RELOAD_KEY) || 0);
        if (last && Date.now() - last < 10000){ reloading = false; return; }
        sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
      } catch (e){}
      console.log('[更新] 正在刷新到新版本：' + (reason || ''));
      location.reload();
    }
    // 暴露手动强制更新（设置里「立即更新」可调）
    window.__LIFEHUB_FORCE_UPDATE__ = function(){
      try { sessionStorage.removeItem(RELOAD_KEY); } catch (e){}
      if ('serviceWorker' in navigator){
        navigator.serviceWorker.getRegistrations().then(function(rs){
          rs.forEach(function(r){ try { r.update(); } catch (e){} });
        }).catch(function(){});
      }
      reloadOnce('手动触发');
    };

    /** 处理「新 SW 已装好」的公共逻辑：让它接管并刷新 */
    function takeOver(reg, label){
      // 若已有等待中的 SW，直接催它 skipWaiting
      if (reg && reg.waiting){ try { reg.waiting.postMessage({ type: 'SKIP_WAITING' }); } catch (e){} }
      // 兜底：无论 controllerchange 是否如期触发，只要检测到新 SW 就刷新一次
      setTimeout(function(){ reloadOnce(label || '检测到新版本'); }, 600);
    }

    window.addEventListener('load', function(){
      navigator.serviceWorker.register('sw.js').then(function(reg){
        // ① 主动探测更新（iOS 尤其需要，否则可能几天都不更新）
        try { reg.update(); } catch (e){}

        // ② 本次注册时就已经有 waiting 的 SW（上次没接管完）→ 立刻处理
        if (reg.waiting && navigator.serviceWorker.controller) takeOver(reg, '已有等待中的新版本');

        // ③ 发现新 SW 正在安装 → 跟踪其状态
        reg.addEventListener('updatefound', function(){
          var nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', function(){
            if (nw.state === 'installed'){
              if (navigator.serviceWorker.controller){
                // 已有旧 SW 在控 → 新 SW 已就绪等待 → 让它立即接管并刷新
                takeOver(reg, '新版本已就绪');
              }
            }
          });
        });

        // ④ 页面重新可见时再探一次更新（手机上切回前台很常见）
        document.addEventListener('visibilitychange', function(){
          if (document.visibilityState === 'visible'){ try { reg.update(); } catch (e){} }
        });

        // ⑤ 进入页面后 3 秒再补探一次：部分浏览器首次 update() 会被节流吞掉
        setTimeout(function(){ try { reg.update(); } catch (e){} }, 3000);
      }).catch(function(e){ console.warn('SW 注册失败', e); });
    });

    // SW 换新接管后 → 自动刷新一次拿到新资源
    var hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', function(){
      if (!hadController) return; // 首次安装不刷新
      reloadOnce('新 Service Worker 已接管');
    });
  }
})();
