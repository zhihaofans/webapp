/* ============================================================
   tools/image2webp.js — 图片转 WebP
   全部在本地浏览器完成：File → Image → Canvas → toBlob('image/webp')。
   不引用任何图像库，也不上传任何文件。
   ============================================================ */
(function (T) {
  'use strict';

  var $ = T.$, $$ = T.$$;
  var MAX_PIXELS = 40 * 1000 * 1000;   // 单张 4000 万像素上限，超过则先等比缩小
  var EDGE_PRESETS = [
    { v: 0, label: '不限制' },
    { v: 2560, label: '2560' },
    { v: 1920, label: '1920' },
    { v: 1280, label: '1280' },
    { v: 800, label: '800' }
  ];

  var items = [];        // 当前队列
  var listEl = null;     // 队列容器
  var busy = false;      // 是否正在批量处理
  var dirty = false;     // 设置改过、已有结果需要重转
  var pasteHandler = null;
  var delayTimer = null;
  var dragDepth = 0;

  /* ---------------- 能力检测 ---------------- */
  var webpOK = null;
  function detectWebP() {
    if (webpOK !== null) return webpOK;
    try {
      var c = document.createElement('canvas');
      c.width = 2; c.height = 2;
      webpOK = c.toDataURL('image/webp').indexOf('data:image/webp') === 0;
    } catch (e) { webpOK = false; }
    return webpOK;
  }

  /* ---------------- 编码 ---------------- */
  function canvasToBlob(canvas, quality) {
    return new Promise(function (resolve, reject) {
      if (canvas.toBlob) {
        canvas.toBlob(function (b) {
          if (b) resolve(b); else reject(new Error('编码失败'));
        }, 'image/webp', quality);
      } else {
        try {
          var url = canvas.toDataURL('image/webp', quality);
          var bin = atob(url.split(',')[1]);
          var u8 = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
          resolve(new Blob([u8], { type: 'image/webp' }));
        } catch (e) { reject(e); }
      }
    });
  }

  function loadImage(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { resolve({ img: img, url: url }); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('这张图片读不出来')); };
      img.src = url;
    });
  }

  function encodeOne(file, opt) {
    return loadImage(file).then(function (r) {
      var img = r.img;
      var w = img.naturalWidth || img.width;
      var h = img.naturalHeight || img.height;
      if (!w || !h) throw new Error('图片尺寸异常');

      var scale = 1;
      if (opt.maxEdge > 0 && Math.max(w, h) > opt.maxEdge) {
        scale = opt.maxEdge / Math.max(w, h);
      }
      var pixels = w * h * scale * scale;
      if (pixels > MAX_PIXELS) {
        scale *= Math.sqrt(MAX_PIXELS / pixels);
      }
      var tw = Math.max(1, Math.round(w * scale));
      var th = Math.max(1, Math.round(h * scale));

      var canvas = document.createElement('canvas');
      canvas.width = tw; canvas.height = th;
      var ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, tw, th);
      URL.revokeObjectURL(r.url);

      return canvasToBlob(canvas, opt.quality).then(function (blob) {
        /* 个别浏览器在编码格式不支持时会静默返回 PNG，这里明确报错 */
        if (blob.type !== 'image/webp') throw new Error('当前浏览器不支持 WebP 编码');
        return { blob: blob, w: tw, h: th, ow: w, oh: h };
      });
    });
  }

  function outName(origName, suffix) {
    var base = origName.replace(/\.[^.]+$/, '');
    return base + (suffix || '') + '.webp';
  }

  /* ---------------- 队列操作 ---------------- */
  function isImage(file) {
    if (file.type && file.type.indexOf('image/') === 0) return true;
    return /\.(png|jpe?g|gif|bmp|webp|avif|tiff?)$/i.test(file.name || '');
  }

  function addFiles(files) {
    var list = Array.prototype.slice.call(files || []).filter(isImage);
    if (!list.length) {
      T.toast(files && files.length ? '只支持图片文件' : '没有选中图片', { icon: 'warn' });
      return;
    }
    var before = items.length;
    list.forEach(function (f) {
      items.push({
        id: T.uid('it'),
        file: f,
        name: f.name || ('图片-' + (items.length + 1)),
        srcBytes: f.size || 0,
        status: 'pending',
        blob: null, outBytes: 0, w: 0, h: 0, ow: 0, oh: 0,
        thumb: null, err: ''
      });
    });
    dirty = false;
    paint();
    var added = items.length - before;
    runQueue().then(function () {
      if (added) T.toast('已处理 ' + added + ' 张图片', { icon: 'check' });
    });
  }

  /* 串行处理：避免几十张大图同时占满内存 */
  function runQueue() {
    if (busy) return Promise.resolve();
    var pending = items.filter(function (it) { return it.status === 'pending' || it.status === 'error'; });
    if (!pending.length) return Promise.resolve();
    if (!detectWebP()) {
      pending.forEach(function (it) { it.status = 'error'; it.err = '当前浏览器不支持 WebP 编码'; });
      paint();
      return Promise.resolve();
    }

    busy = true;
    var i = 0;
    var quality = T.Store.settings.quality;
    var maxEdge = T.Store.settings.maxEdge;

    function step() {
      if (i >= pending.length) {
        busy = false;
        paint();
        return;
      }
      var it = pending[i];
      it.status = 'working';
      it.err = '';
      updateRow(it.id);

      encodeOne(it.file, { quality: quality, maxEdge: maxEdge }).then(function (res) {
        it.blob = res.blob;
        it.outBytes = res.blob.size;
        it.w = res.w; it.h = res.h; it.ow = res.ow; it.oh = res.oh;
        it.quality = quality;
        it.status = 'done';
        if (!it.thumb) it.thumb = URL.createObjectURL(it.file);
        T.Store.addHistory({
          name: it.name, srcBytes: it.srcBytes, outBytes: it.outBytes,
          w: res.w, h: res.h, quality: quality
        });
      }).catch(function (e) {
        it.status = 'error';
        it.err = (e && e.message) ? e.message : '转换失败';
      }).then(function () {
        i += 1;
        updateRow(it.id);
        paintSummary();
        if (T.Store.settings.autoDownload && it.status === 'done') downloadOne(it);
        step();
      });
    }
    step();
    return new Promise(function (resolve) {
      var t = setInterval(function () {
        if (!busy) { clearInterval(t); resolve(); }
      }, 120);
    });
  }

  function downloadOne(it) {
    if (!it.blob) return;
    T.downloadBlob(it.blob, outName(it.name, T.Store.settings.suffix));
  }

  function downloadAll() {
    var done = items.filter(function (it) { return it.status === 'done'; });
    if (!done.length) { T.toast('还没有可下载的结果', { icon: 'warn' }); return; }
    done.forEach(function (it, idx) {
      setTimeout(function () { downloadOne(it); }, idx * 420);
    });
    T.toast('正在下载 ' + done.length + ' 个文件', { icon: 'download', ms: 3200 });
  }

  function clearQueue() {
    items.forEach(function (it) { if (it.thumb) URL.revokeObjectURL(it.thumb); });
    items = [];
    dirty = false;
    paint();
  }

  /* ---------------- 渲染 ---------------- */
  function summaryHTML() {
    var done = items.filter(function (it) { return it.status === 'done'; });
    var totalSrc = done.reduce(function (a, it) { return a + it.srcBytes; }, 0);
    var totalOut = done.reduce(function (a, it) { return a + it.outBytes; }, 0);
    var saved = totalSrc - totalOut;
    var pct = totalSrc > 0 ? Math.round(saved / totalSrc * 100) : 0;
    var working = items.filter(function (it) { return it.status === 'working'; }).length;

    return '<div class="sum">' +
      '<div class="sum__i"><b>' + items.length + '</b><span>张已加入</span></div>' +
      '<div class="sum__i"><b>' + done.length + '</b><span>张已转换</span></div>' +
      '<div class="sum__i"><b>' + T.fmtBytes(totalSrc) + '</b><span>原体积</span></div>' +
      '<div class="sum__i"><b>' + T.fmtBytes(totalOut) + '</b><span>WebP 体积</span></div>' +
      '<div class="sum__i sum__saved"><b>' + (saved > 0 ? '−' + pct + '%' : '—') + '</b><span>' +
        (saved > 0 ? '省下 ' + T.fmtBytes(saved) : '等待转换') + '</span></div>' +
      '<div class="sum__sp"></div>' +
      (working ? '<div class="sum__i"><span>正在处理 ' + working + ' 张…</span></div>' : '') +
    '</div>';
  }

  function rowHTML(it) {
    var soon = '';
    var meta = '';
    if (it.status === 'done') {
      var diff = it.srcBytes - it.outBytes;
      var pct = it.srcBytes > 0 ? Math.round(diff / it.srcBytes * 100) : 0;
      var up = diff < 0;
      var wA = it.srcBytes || 1;
      var wB = Math.max(1, it.outBytes);
      var total = wA + wB;
      meta =
        '<span>' + T.fmtBytes(it.srcBytes) + '</span>' +
        '<span class="ic-holder">' + T.ic('chevron', '', 12) + '</span>' +
        '<span>' + T.fmtBytes(it.outBytes) + '</span>' +
        '<i>·</i><span>' + it.w + '×' + it.h + '</span>' +
        (it.ow && it.oh && (it.ow !== it.w || it.oh !== it.h)
          ? '<i>·</i><span>原 ' + it.ow + '×' + it.oh + '</span>' : '') +
        '<i>·</i><span>质量 ' + Math.round((it.quality || T.Store.settings.quality) * 100) + '%</span>';
      soon = '<div class="qbar" title="灰色为原图，橙色为转换后">' +
        '<i class="qbar__a" style="width:' + (wA / total * 100) + '%"></i>' +
        '<i class="qbar__b" style="width:' + (wB / total * 100) + '%"></i>' +
        '</div>';
      var badge = up
        ? '<span class="qsave qsave--up">+' + Math.abs(pct) + '%</span>'
        : '<span class="qsave qsave--down">−' + pct + '%</span>';
      return '<div class="qitem" data-id="' + T.esc(it.id) + '">' +
        '<div class="qthumb"><img src="' + T.esc(it.thumb || '') + '" alt=""></div>' +
        '<div class="qmain">' +
          '<div class="qname"><span>' + T.esc(it.name) + '</span></div>' +
          '<div class="qmeta">' + meta + '</div>' + soon +
        '</div>' +
        '<div class="qact">' + badge +
          '<button class="btn btn--sm btn--icon" type="button" data-act="dl" title="下载这张">' + T.ic('download', '', 0) + '</button>' +
          '<button class="btn btn--sm btn--icon btn--ghost" type="button" data-act="rm" title="移除">' + T.ic('close', '', 0) + '</button>' +
        '</div>' +
      '</div>';
    }
    if (it.status === 'working') {
      return '<div class="qitem" data-id="' + T.esc(it.id) + '">' +
        '<div class="qthumb">' + T.ic('image', '', 0) + '</div>' +
        '<div class="qmain">' +
          '<div class="qname"><span>' + T.esc(it.name) + '</span></div>' +
          '<div class="qmeta"><span>' + T.fmtBytes(it.srcBytes) + '</span><i>·</i><span>正在转换…</span></div>' +
          '<div class="qprog"><i style="width:70%"></i></div>' +
        '</div>' +
        '<div class="qact"></div>' +
      '</div>';
    }
    if (it.status === 'error') {
      return '<div class="qitem" data-id="' + T.esc(it.id) + '">' +
        '<div class="qthumb">' + T.ic('warn', '', 0) + '</div>' +
        '<div class="qmain">' +
          '<div class="qname"><span>' + T.esc(it.name) + '</span><span class="tag tag--danger">失败</span></div>' +
          '<div class="qerr">' + T.ic('warn', '', 0) + '<span>' + T.esc(it.err || '转换失败') + '</span></div>' +
        '</div>' +
        '<div class="qact">' +
          '<button class="btn btn--sm" type="button" data-act="retry">重试</button>' +
          '<button class="btn btn--sm btn--icon btn--ghost" type="button" data-act="rm" title="移除">' + T.ic('close', '', 0) + '</button>' +
        '</div>' +
      '</div>';
    }
    /* pending */
    return '<div class="qitem" data-id="' + T.esc(it.id) + '">' +
      '<div class="qthumb">' + T.ic('image', '', 0) + '</div>' +
      '<div class="qmain">' +
        '<div class="qname"><span>' + T.esc(it.name) + '</span></div>' +
        '<div class="qmeta"><span>' + T.fmtBytes(it.srcBytes) + '</span><i>·</i><span>等待转换</span></div>' +
      '</div>' +
      '<div class="qact">' +
        '<button class="btn btn--sm btn--icon btn--ghost" type="button" data-act="rm" title="移除">' + T.ic('close', '', 0) + '</button>' +
      '</div>' +
    '</div>';
  }

  function queueHTML() {
    if (!items.length) return '';
    var doneCount = items.filter(function (it) { return it.status === 'done'; }).length;
    var head =
      '<div class="qhead">' +
        '<h2>转换队列</h2><i class="hr"></i>' +
        '<div class="qhead__acts">' +
          (dirty ? '<span class="tag tag--amber">设置已改，可重转</span>' : '') +
          (doneCount ? '<button class="btn btn--sm btn--primary" type="button" data-act="dlall">' +
            T.ic('download', '', 0) + '下载全部 (' + doneCount + ')</button>' : '') +
          '<button class="btn btn--sm" type="button" data-act="reconv">' + T.ic('convert', '', 0) + '重新转换</button>' +
          '<button class="btn btn--sm btn--ghost" type="button" data-act="clear">' + T.ic('trash', '', 0) + '清空</button>' +
        '</div>' +
      '</div>';
    return '<div class="queue">' + head + '<div id="qbody">' +
      items.map(rowHTML).join('') + '</div></div>';
  }

  function histHTML() {
    var h = T.Store.db.history.slice(0, 8);
    if (!h.length) {
      return '<p class="note">完成的转换会在这里留下一条记录（只存文件名和体积，不存图片本身）。</p>';
    }
    return '<div class="hist">' + h.map(function (x) {
      var diff = x.srcBytes - x.outBytes;
      var pct = x.srcBytes > 0 ? Math.round(diff / x.srcBytes * 100) : 0;
      return '<div class="hitem">' +
        '<div class="hitem__tx">' +
          '<b title="' + T.esc(x.name) + '">' + T.esc(x.name) + '</b>' +
          '<small>' + T.fmtBytes(x.srcBytes) + ' → ' + T.fmtBytes(x.outBytes) +
            (diff > 0 ? '  (−' + pct + '%)' : '') + ' · ' + T.relTime(x.at) + '</small>' +
        '</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  function emptyQueueHTML() {
    if (items.length) return '';
    return '<div class="empty">' + T.ic('image', '', 0) +
      '<b>队列是空的</b><p>把图片拖到上面的区域，或者点「选择图片」。也可以直接 Ctrl / ⌘ + V 粘贴剪贴板里的图。</p></div>';
  }

  /* ---------------- 统一刷新入口 ---------------- */
  function paintSummary() {
    var host = $('#sumHost');
    if (host) host.innerHTML = summaryHTML();
  }
  function paintQueue() {
    var host = $('#queueHost');
    if (!host) return;
    host.innerHTML = queueHTML() + emptyQueueHTML();
    listEl = host;
  }
  function paintHistory() {
    var host = $('#histHost');
    if (host) host.innerHTML = histHTML();
  }
  /* 单一刷新入口：任何数据变化都只调它，渲染函数之间互不调用 */
  function paint() {
    paintSummary();
    paintQueue();
    paintHistory();
  }

  /* 单行进度更新：只补丁一个节点，避免整表重画 */
  function updateRow(id) {
    if (!listEl) return;
    var row = listEl.querySelector('.qitem[data-id="' + id + '"]');
    if (!row) { paintQueue(); return; }
    var it = items.filter(function (x) { return x.id === id; })[0];
    if (!it) return;
    var tmp = document.createElement('div');
    tmp.innerHTML = rowHTML(it);
    row.parentNode.replaceChild(tmp.firstChild, row);
  }

  /* ---------------- 设置面板 ---------------- */
  function ctlHTML() {
    var s = T.Store.settings;
    return '<div class="ctl">' +
      '<div class="ctl__row">' +
        '<div class="ctl__hd"><b>输出质量</b><em id="qVal">' + Math.round(s.quality * 100) + '%</em></div>' +
        '<input class="rng" type="range" id="rngQ" min="40" max="98" step="1" value="' + Math.round(s.quality * 100) + '"' +
          ' style="--pct:' + Math.round((s.quality * 100 - 40) / 58 * 100) + '%" aria-label="输出质量">' +
        '<div class="ctl__hint">数值越高越清晰、文件越大。照片一般 75–85%，截图和线稿 88% 以上更稳。</div>' +
      '</div>' +
      '<div class="ctl__row">' +
        '<div class="ctl__hd"><b>最长边限制</b></div>' +
        '<div class="ctl__grid" id="edgeGrid">' + EDGE_PRESETS.map(function (p) {
          return '<button class="ctl__chip' + (s.maxEdge === p.v ? ' is-on' : '') + '" type="button" data-v="' + p.v + '">' +
            T.esc(p.label) + '</button>';
        }).join('') + '</div>' +
        '<div class="ctl__hint">只缩小不放大。给图片站或聊天发送压一档，体积通常能再降一半。</div>' +
      '</div>' +
      '<div class="ctl__row">' +
        '<div class="ctl__hd"><b>文件名后缀</b><small>可选</small></div>' +
        '<input class="inp" type="text" id="inpSuffix" placeholder="例：-slim" value="' + T.escAttr(s.suffix) + '" maxlength="24" aria-label="文件名后缀">' +
        '<div class="ctl__hint">photo.jpg → photo<span class="num">' + T.esc(s.suffix || '') + '</span>.webp</div>' +
      '</div>' +
      '<div class="ctl__row">' +
        '<label class="sw">' +
          '<input type="checkbox" id="swAuto"' + (s.autoDownload ? ' checked' : '') + '>' +
          '<span class="sw__track"></span>' +
          '<span class="sw__tx">转换完自动下载<small>批量时可能触发浏览器的多文件下载确认</small></span>' +
        '</label>' +
      '</div>' +
      '<div class="tip">' + T.ic('shield', '', 0) +
        '<div><b>图片不会离开这台设备。</b>转换在浏览器里用 Canvas 完成，没有任何上传步骤，断网也能用。</div>' +
      '</div>' +
    '</div>';
  }

  function bindControls(host) {
    var rng = host.querySelector('#rngQ');
    if (rng) {
      rng.addEventListener('input', function () {
        var v = parseInt(rng.value, 10);
        var q = T.clamp(v / 100, 0.4, 0.98);
        var lab = host.querySelector('#qVal');
        if (lab) lab.textContent = v + '%';
        rng.style.setProperty('--pct', Math.round((v - 40) / 58 * 100) + '%');
        T.Store.patch({ quality: q });          /* 输入即保存 */
        if (items.some(function (it) { return it.status === 'done'; })) {
          dirty = true; paintQueue();
        }
      });
    }
    var grid = host.querySelector('#edgeGrid');
    if (grid) {
      grid.addEventListener('click', function (e) {
        var b = e.target.closest('[data-v]');
        if (!b) return;
        $$('.ctl__chip', grid).forEach(function (x) { x.classList.toggle('is-on', x === b); });
        T.Store.patch({ maxEdge: parseInt(b.getAttribute('data-v'), 10) || 0 });
        if (items.some(function (it) { return it.status === 'done'; })) {
          dirty = true; paintQueue();
        }
      });
    }
    var suf = host.querySelector('#inpSuffix');
    if (suf) {
      suf.addEventListener('input', function () {
        T.Store.patch({ suffix: suf.value.slice(0, 24) });
      });
    }
    var swAuto = host.querySelector('#swAuto');
    if (swAuto) {
      swAuto.addEventListener('change', function () {
        T.Store.patch({ autoDownload: swAuto.checked });
      });
    }
  }

  /* ---------------- 事件 ---------------- */
  function bindDrop(host) {
    var drop = host.querySelector('#drop');
    var fileIn = host.querySelector('#fileIn2');
    if (!drop) return;

    drop.addEventListener('click', function (e) {
      if (e.target.closest('button')) return;
      fileIn.click();
    });
    host.querySelector('#btnPick').addEventListener('click', function (e) {
      e.stopPropagation(); fileIn.click();
    });
    fileIn.addEventListener('change', function () {
      /* 必须先把 FileList 拷成数组再清空 value：
         input.files 是实时集合，value='' 会把它一起清空，
         先清空再读就永远是空的（本文件最初就踩了这个坑）。 */
      var picked = Array.prototype.slice.call(fileIn.files || []);
      fileIn.value = '';
      addFiles(picked);
    });

    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) {
        e.preventDefault();
        drop.classList.add('is-over');
      });
    });
    drop.addEventListener('dragleave', function (e) {
      if (drop.contains(e.relatedTarget)) return;
      drop.classList.remove('is-over');
    });
    drop.addEventListener('drop', function (e) {
      e.preventDefault();
      drop.classList.remove('is-over');
      var dt = e.dataTransfer;
      if (!dt) return;
      if (dt.files && dt.files.length) addFiles(dt.files);
      else if (dt.items) {
        var fs = [];
        for (var i = 0; i < dt.items.length; i++) {
          var it = dt.items[i];
          if (it.kind === 'file') { var f = it.getAsFile(); if (f) fs.push(f); }
        }
        addFiles(fs);
      }
    });

    /* 粘贴：整个文档范围内监听，只在工具处于挂载状态时生效 */
    pasteHandler = function (e) {
      if (!document.getElementById('drop')) return;
      var cb = e.clipboardData;
      if (!cb) return;
      var fs = [];
      if (cb.files && cb.files.length) {
        for (var i = 0; i < cb.files.length; i++) fs.push(cb.files[i]);
      } else if (cb.items) {
        for (var j = 0; j < cb.items.length; j++) {
          var it = cb.items[j];
          if (it.kind === 'file') { var f = it.getAsFile(); if (f) fs.push(f); }
        }
      }
      fs = fs.filter(isImage);
      if (!fs.length) return;
      e.preventDefault();
      addFiles(fs);
    };
    document.addEventListener('paste', pasteHandler);
  }

  function bindQueue(host) {
    host.addEventListener('click', function (e) {
      var b = e.target.closest('[data-act]');
      if (!b) return;
      var act = b.getAttribute('data-act');
      if (act === 'dlall') { downloadAll(); return; }
      if (act === 'clear') {
        if (busy) { T.toast('正在转换，稍后再清空', { icon: 'warn' }); return; }
        clearQueue();
        return;
      }
      if (act === 'reconv') {
        if (busy) { T.toast('正在转换中', { icon: 'warn' }); return; }
        items.forEach(function (it) {
          it.status = 'pending'; it.blob = null; it.err = '';
        });
        dirty = false;
        paint();
        runQueue();
        return;
      }
      var row = e.target.closest('.qitem');
      if (!row) return;
      var id = row.getAttribute('data-id');
      var it = items.filter(function (x) { return x.id === id; })[0];
      if (!it) return;
      if (act === 'dl') downloadOne(it);
      if (act === 'rm') {
        if (it.thumb) URL.revokeObjectURL(it.thumb);
        items = items.filter(function (x) { return x.id !== id; });
        paint();
      }
      if (act === 'retry') {
        it.status = 'pending'; it.err = '';
        paint();
        runQueue();
      }
    });
  }

  /* 拖拽到窗口任意位置都不触发浏览器默认打开文件 */
  function guardWindowDrag() {
    var fn = function (e) {
      if (document.getElementById('drop')) e.preventDefault();
    };
    document.addEventListener('dragover', fn);
    document.addEventListener('drop', fn);
    return fn;
  }
  var _guard = null;

  /* ---------------- 注册 ---------------- */
  T.register('image2webp', {
    render: function (host) {
      var ok = detectWebP();
      T.Settings.bindFileInput();

      host.innerHTML =
        (ok ? '' :
          '<div class="capmsg">' + T.ic('warn', '', 0) +
          '<div><b>这个浏览器不支持 WebP 编码。</b>换用较新版本的 Chrome / Edge / Firefox / Safari 即可，' +
          '移动端的系统相册与聊天软件通常都能打开 WebP 图片。</div></div>' +
          '<div style="height:14px"></div>') +

        '<div class="i2w">' +
          '<div class="i2w__drop">' +
            '<div class="drop" id="drop">' +
              '<div class="drop__ic">' + T.ic('upload', '', 0) + '</div>' +
              '<div class="drop__t">把图片拖进来，或点击选择</div>' +
              '<div class="drop__s">支持 PNG / JPG / GIF / BMP / AVIF 等格式，可一次选多张。' +
                '转换后体积通常能小 50% 以上，画质几乎看不出差别。</div>' +
              '<div class="drop__acts">' +
                '<button class="btn btn--primary" type="button" id="btnPick">' + T.ic('image', '', 0) + '选择图片</button>' +
              '</div>' +
              '<div class="drop__s" style="margin-top:2px">也可以直接 <span class="drop__kbd">Ctrl / ⌘ + V</span> 粘贴剪贴板里的图</div>' +
            '</div>' +
            /* 文件输入必须放在 #drop 之外：否则程序化 click 会冒泡回容器，
               触发容器自己的 click 处理，形成「点一次弹两次」的循环 */
            '<input type="file" id="fileIn2" accept="image/*" multiple>' +
          '</div>' +

          '<div class="i2w__main">' +
            '<div id="sumHost"></div>' +
            '<div id="queueHost"></div>' +
            '<div class="panel" style="margin-top:22px">' +
              '<div class="panel__hd"><h3>' + T.ic('history', '', 0) + '最近转换</h3></div>' +
              '<div class="panel__bd" id="histHost"></div>' +
            '</div>' +
          '</div>' +

          '<aside class="i2w__side">' +
            '<div class="panel">' +
              '<div class="panel__hd"><h3>' + T.ic('sliders', '', 0) + '转换设置</h3></div>' +
              '<div class="panel__bd" id="ctlHost"></div>' +
            '</div>' +
          '</aside>' +
        '</div>' +
        '<div class="pagefoot">' +
          '图片在本机浏览器内转换，全程不联网上传。记录只保存文件名与体积，图片本身不会被存进浏览器。' +
        '</div>';

      var ctlHost = host.querySelector('#ctlHost');
      if (ctlHost) {
        ctlHost.innerHTML = ctlHTML();
        bindControls(host);
      }
      bindDrop(host);
      bindQueue(host);
      _guard = guardWindowDrag();
      paint();
    },
    onLeave: function () {
      if (pasteHandler) { document.removeEventListener('paste', pasteHandler); pasteHandler = null; }
      if (_guard) {
        document.removeEventListener('dragover', _guard);
        document.removeEventListener('drop', _guard);
        _guard = null;
      }
      if (delayTimer) { clearTimeout(delayTimer); delayTimer = null; }
      busy = false;
      /* 释放缩略图的 Object URL，避免长时间浏览后内存上涨 */
      items.forEach(function (it) { if (it.thumb) URL.revokeObjectURL(it.thumb); });
      items = [];
      listEl = null;
    }
  });
})(window.Toolbox);
