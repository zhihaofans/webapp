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
  // PWA：注册 Service Worker（离线可用 + 添加到主屏）。file:// 下浏览器不支持，自动跳过
  if ('serviceWorker' in navigator && location.protocol !== 'file:'){
    window.addEventListener('load', function(){
      navigator.serviceWorker.register('sw.js').catch(function(e){ console.warn('SW 注册失败', e); });
    });
  }
})();
