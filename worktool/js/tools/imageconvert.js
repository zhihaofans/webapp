/* ============================================================
   tools/imageconvert.js — 图片格式转换（WebP / JPEG / PNG）
   全部在本地浏览器完成：File → Image → Canvas → toBlob(mime)。
   输出格式只列本设备真正能编码的，不引用任何图像库，也不上传任何文件。
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

  /* ---------------- 能力检测 ----------------
     Canvas 编码没有「能力查询」接口，只能真的编一张再问它返回了什么。
     规范允许浏览器在不支持请求格式时**静默改成 PNG**，所以唯一可靠的
     判据是看返回值本身：dataURL 的前缀 / blob.type。
     关键事实：Safari / WebKit 至今不支持 Canvas 编码 WebP，
     iOS 上所有浏览器都是 WebKit，所以都会走到兜底分支。 */
  var CAP = null;
  function probeCap() {
    if (CAP) return CAP;
    var cap = { webp: false, jpeg: false, png: false };
    try {
      var c = document.createElement('canvas');
      c.width = 2; c.height = 2;
      var x = c.getContext('2d');
      x.fillStyle = 'rgba(0,128,255,.5)';   /* 半透明，顺带探一下 alpha */
      x.fillRect(0, 0, 1, 1);
      cap.png = c.toDataURL('image/png').indexOf('data:image/png') === 0;
      cap.jpeg = c.toDataURL('image/jpeg').indexOf('data:image/jpeg') === 0;
      cap.webp = c.toDataURL('image/webp').indexOf('data:image/webp') === 0;
    } catch (e) { /* 异常就保持全 false */ }
    CAP = cap;
    return cap;
  }
  function resetCap() { CAP = null; return probeCap(); }

  var MIME_LABEL = { 'image/webp': 'WebP', 'image/jpeg': 'JPEG', 'image/png': 'PNG' };
  var MIME_EXT = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };
  var MIME_HINT = {
    'image/webp': '体积最小，现代浏览器与系统相册都能打开，保留透明。质量拉满（100%）即无损。',
    'image/jpeg': '兼容性最好；有损压缩，不支持透明（透明区域会自动填白）。',
    'image/png': '无损、保留透明；体积通常比原图还大，适合图标与线稿。'
  };
  /* 展示顺序：WebP 最省流量，放第一个 */
  var FORMAT_ORDER = ['image/webp', 'image/jpeg', 'image/png'];

  /* WASM 编码器是否可用。
     加载前（idle）按「应该能用」处理 —— WebAssembly 的支持率极高，
     先乐观显示 WebP 选项，等真失败了再收回去，也好过让 iOS 用户
     一进来就看不到 WebP 然后再也没有第二次机会。 */
  function wasmUsable() {
    return !!(T.WebpEnc && T.WebpEnc.supported() && T.WebpEnc.status() !== 'failed');
  }

  /* 本设备能编码哪些格式。
     注意这里返回的是「可用清单」而不是「是否支持 WebP」——
     界面直接照着它渲染，不支持的格式根本不会出现，也就没有可点错的地方。 */
  function availableFormats() {
    var cap = probeCap();
    /* WebP 有两条路：Canvas 原生编码（Chrome / Edge / Firefox），
       或者 WASM 编码器（全平台，含 Safari 与 iOS）。
       后者一旦可用，WebP 就不再受「WebKit 不能编码 WebP」的限制。 */
    var canWebp = cap.webp || wasmUsable();
    return FORMAT_ORDER.filter(function (m) {
      if (m === 'image/webp') return canWebp;
      if (m === 'image/jpeg') return cap.jpeg;
      return cap.png;
    });
  }

  /* 当前生效的输出格式：优先用用户选的那个；
     若它在当前设备上不可用（例如设置是桌面端同步来的 WebP，人却在 iPhone 上），
     自动退到第一个可用格式，绝不产出编不出来的格式。 */
  function currentMime() {
    var list = availableFormats();
    var want = T.Store.settings.outFormat;
    if (list.indexOf(want) !== -1) return want;
    return list[0] || 'image/png';
  }

  /* ---------------- 编码 ---------------- */
  function canvasToBlob(canvas, quality, mime) {
    return new Promise(function (resolve, reject) {
      if (canvas.toBlob) {
        canvas.toBlob(function (b) {
          if (b) resolve(b); else reject(new Error('编码失败'));
        }, mime, quality);
      } else {
        try {
          var url = canvas.toDataURL(mime, quality);
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

  /* 抽样判断这张图是不是「图形类」（截图 / UI / 图表 / 图标）。
     这类图颜色数很少，用无损 WebP 往往比有损还小、画质还完美；
     照片则相反，无损会让体积暴涨十几倍。
     抽样就够用，而且一旦超过上限立刻返回，不让大图在这里耗时。 */
  var FLAT_LIMIT = 20000;
  function looksFlat(id) {
    var d = id.data, W = id.width, H = id.height;
    var step = Math.max(1, Math.floor(Math.sqrt(W * H / 40000)));
    var seen = new Set();
    for (var y = 0; y < H; y += step) {
      for (var x = 0; x < W; x += step) {
        var i = (y * W + x) * 4;
        seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
        if (seen.size > FLAT_LIMIT) return false;
      }
    }
    return true;
  }

  /* Canvas 兜底编码：WASM 用不了、或者它不是 WebP 目标格式时走这里。
     Canvas 没有无损模式，而且 quality 逼近 1 时输出会突然膨胀
     （实测 12 KB 的图能编出 341 KB），所以把上限压在 0.98。 */
  function canvasEncode(canvas, opt, mime, base) {
    var q = Math.min(0.98, opt.quality);
    return canvasToBlob(canvas, q, mime).then(function (blob) {
      /* 再兜一道：规范允许浏览器静默改用 PNG。这里必须核对真实类型，
         否则会产出「后缀 .webp 内容是 PNG」的坏文件。 */
      if (blob.type !== mime) {
        throw new Error('浏览器实际返回了 ' + (MIME_LABEL[blob.type] || blob.type) +
          ' 而不是 ' + MIME_LABEL[mime] + '，已中止以免产出错误格式的文件');
      }
      base.blob = blob;
      base.mode = 'lossy';
      base.engine = 'canvas';
      return base;
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

      var mime = opt.mime || 'image/webp';
      var canvas = document.createElement('canvas');
      canvas.width = tw; canvas.height = th;
      var ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      /* JPEG 没有 alpha 通道。不先铺白底的话，透明区域会变成纯黑 —— 这是
         把 PNG 转 JPEG 时最常见的一个坑。 */
      if (mime === 'image/jpeg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, tw, th);
      }
      ctx.drawImage(img, 0, 0, tw, th);
      URL.revokeObjectURL(r.url);

      var base = { w: tw, h: th, ow: w, oh: h, mime: mime };

      /* WebP 优先交给 WASM 编码器：method=6 参数可调、有真正的无损模式，
         而且不受 Safari / iOS 不能编码 WebP 的限制。 */
      if (mime === 'image/webp' && wasmUsable()) {
        var id = null;
        try { id = ctx.getImageData(0, 0, tw, th); } catch (e) { id = null; }
        if (id) {
          /* 质量拉满（100%）即视为要求无损 —— 这正是用户的直觉，
             而 Canvas 那边给不出无损，只会给出一个膨胀几十倍的文件。 */
          var lossless = opt.quality >= 1;
          base.flat = looksFlat(id);
          return T.WebpEnc.encode(id, {
            lossless: lossless,
            quality: lossless ? 100 : Math.round(opt.quality * 100)
          }).then(function (res) {
            base.blob = new Blob([res.buffer], { type: 'image/webp' });
            base.mode = lossless ? 'lossless' : 'lossy';
            base.ms = res.ms;
            base.engine = 'wasm';
            return base;
          }).catch(function (e) {
            /* 编码器出问题不该让整张图失败，退回 Canvas 继续；
               但要留痕，否则「为什么体积和以前一样」会很难查 */
            console.warn('[WebP] WASM 编码失败，已回退 Canvas：',
              e && e.message ? e.message : e);
            return canvasEncode(canvas, opt, mime, base);
          });
        }
      }

      return canvasEncode(canvas, opt, mime, base);
    });
  }

  function outName(origName, suffix, mime) {
    var base = origName.replace(/\.[^.]+$/, '');
    return base + (suffix || '') + '.' + (MIME_EXT[mime] || 'webp');
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

    busy = true;
    var i = 0;
    var quality = T.Store.settings.quality;
    var maxEdge = T.Store.settings.maxEdge;
    var mime = currentMime();

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

      encodeOne(it.file, { quality: quality, maxEdge: maxEdge, mime: mime }).then(function (res) {
        it.blob = res.blob;
        it.outBytes = res.blob.size;
        it.w = res.w; it.h = res.h; it.ow = res.ow; it.oh = res.oh;
        it.quality = quality;
        it.mime = res.mime;
        it.mode = res.mode || 'lossy';     /* lossless | lossy */
        it.engine = res.engine || 'canvas'; /* wasm | canvas */
        it.ms = res.ms || 0;
        /* 颜色少 + 有损编码 = 这张图很可能换个无损会更小更好看 */
        it.flatHint = !!res.flat && res.mode === 'lossy' && res.mime === 'image/webp';
        it.status = 'done';
        if (!it.thumb) it.thumb = URL.createObjectURL(it.file);
        T.Store.addHistory({
          name: it.name, srcBytes: it.srcBytes, outBytes: it.outBytes,
          w: res.w, h: res.h, quality: quality, fmt: res.mime
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
    T.downloadBlob(it.blob, outName(it.name, T.Store.settings.suffix, it.mime || currentMime()));
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

    var mime = currentMime();
    return '<div class="sum">' +
      '<div class="sum__i"><b>' + items.length + '</b><span>张已加入</span></div>' +
      '<div class="sum__i"><b>' + done.length + '</b><span>张已转换</span></div>' +
      '<div class="sum__i"><b>' + T.fmtBytes(totalSrc) + '</b><span>原体积</span></div>' +
      '<div class="sum__i"><b>' + T.fmtBytes(totalOut) + '</b><span>' + MIME_LABEL[mime] + ' 体积</span></div>' +
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
        '<i>·</i><span>' + (MIME_LABEL[it.mime] || 'WebP') + '</span>' +
        (it.mime === 'image/png'
          ? ''
          : (it.mode === 'lossless'
              ? '<i>·</i><span class="qmode">无损</span>'
              : '<i>·</i><span>质量 ' + Math.round((it.quality || T.Store.settings.quality) * 100) + '%</span>'));
      soon = '<div class="qbar" title="灰色为原图，橙色为转换后">' +
        '<i class="qbar__a" style="width:' + (wA / total * 100) + '%"></i>' +
        '<i class="qbar__b" style="width:' + (wB / total * 100) + '%"></i>' +
        '</div>';
      /* 颜色少的图用无损往往比有损更小、画质还完美 —— 值得提一句 */
      if (it.flatHint) {
        soon += '<div class="qtip">' + T.ic('info', '', 0) +
          '<span>颜色少，把质量拉到 <b>100%</b> 改无损，通常更小且画质完美</span></div>';
      }
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
            (diff > 0 ? '  (−' + pct + '%)' : '') +
            ' · ' + T.esc(MIME_LABEL[x.fmt] || 'WebP') + ' · ' + T.relTime(x.at) + '</small>' +
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
    var cap = probeCap();
    var mime = currentMime();
    var list = availableFormats();
    return '<div class="ctl">' +

      '<div class="ctl__row">' +
        '<div class="ctl__hd"><b>输出格式</b>' +
          '<small>' + (list.length > 1 ? '本设备支持 ' + list.length + ' 种' : '本设备仅支持 1 种') + '</small>' +
        '</div>' +
        '<div class="seg" id="segFmt">' +
          list.map(function (m) {
            return '<button class="seg__b' + (mime === m ? ' is-on' : '') + '" type="button" data-v="' + m + '">' +
              MIME_LABEL[m] + '</button>';
          }).join('') +
        '</div>' +
        '<div class="ctl__hint">' + MIME_HINT[mime] + '</div>' +
        (cap.webp || wasmUsable() ? '' :
          '<div class="ctl__note">' + T.ic('info', '', 0) +
            '<span>这台设备没有原生的 WebP 编码能力（Safari / WebKit 的限制），' +
            'WASM 编码器也没能加载起来' +
            (T.WebpEnc && T.WebpEnc.reason() ? '：' + T.esc(T.WebpEnc.reason()) : '') +
            '。所以列表里没有它。</span></div>' +
          '<button class="btn btn--sm" type="button" id="btnRecheck" style="align-self:flex-start">' +
            T.ic('restore', '', 0) + '重新检测编码能力</button>') +
        (wasmUsable() && T.WebpEnc.status() === 'loading'
          ? '<div class="ctl__note ctl__note--enc">' + T.ic('info', '', 0) +
            '<span>正在加载 WebP 编码器（约 120 KB，只需一次，之后走缓存）…</span></div>'
          : '') +
      '</div>' +

      '<div class="ctl__row' + (mime === 'image/png' ? ' is-off' : '') + '">' +
        '<div class="ctl__hd"><b>输出质量</b><em id="qVal">' +
          (s.quality >= 1 ? '无损' : Math.round(s.quality * 100) + '%') + '</em></div>' +
        '<input class="rng" type="range" id="rngQ" min="40" max="100" step="1" value="' + Math.round(s.quality * 100) + '"' +
          ' style="--pct:' + Math.round((s.quality * 100 - 40) / 60 * 100) + '%" aria-label="输出质量">' +
        '<div class="ctl__hint" id="qHint">' +
          (mime === 'image/png'
            ? 'PNG 是无损格式，质量设置对它不生效。'
            : (s.quality >= 1
                ? '无损：像素完全不变。截图、图标、图表用它常常比原图还小；照片会大很多。'
                : '数值越高越清晰、文件越大。照片一般 75–85%，截图与线稿 88% 以上更稳；拉到 100% 是无损。')) +
        '</div>' +
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
        '<div class="ctl__hint">photo.jpg → photo<span class="num">' + T.esc(s.suffix || '') + '</span>.' +
          (MIME_EXT[mime] || 'webp') + '</div>' +
      '</div>' +
      '<div class="ctl__row">' +
        '<label class="sw">' +
          '<input type="checkbox" id="swAuto"' + (s.autoDownload ? ' checked' : '') + '>' +
          '<span class="sw__track"></span>' +
          '<span class="sw__tx">转换完自动下载<small>批量时可能触发浏览器的多文件下载确认</small></span>' +
        '</label>' +
      '</div>' +
      '<div class="tip">' + T.ic('shield', '', 0) +
        '<div><b>图片不会离开这台设备。</b>转换全部在本机浏览器内完成，没有任何上传步骤，断网也能用。</div>' +
      '</div>' +
      /* 判据必须和 availableFormats() 一致：只看 cap.webp 的话，iOS 上
         这个按钮会永远挂着（Canvas 编不出 WebP），点下去还说「不支持」，
         明明 WASM 那条路是好的。只有 WebP 真的用不了时才需要这个入口。 */
      (cap.webp || wasmUsable() ? '' :
        '<button class="btn btn--sm btn--block" type="button" id="btnRecheck2">' +
          T.ic('restore', '', 0) + '重新检测编码能力</button>') +
    '</div>';
  }

  function bindControls(host) {
    /* 兜底格式切换：改了要让已有结果失效，提示重转 */
    var segFmt = host.querySelector('#segFmt');
    if (segFmt) {
      segFmt.addEventListener('click', function (e) {
        var b = e.target.closest('[data-v]');
        if (!b) return;
        T.Store.patch({ outFormat: b.getAttribute('data-v') });
        if (items.some(function (it) { return it.status === 'done'; })) dirty = true;
        if (viewHost) renderView(viewHost);   /* 事件 → 重建视图，单向 */
      });
    }
    /* 重新检测：两条路都真探一遍，而不是只看 Canvas。
       这里曾经有过一个会骗人的 bug —— 提示只读 Canvas 探测的结果，
       可 iOS 的 Canvas 永远编不出 WebP（WebKit 的限制），于是 cap.webp
       恒为 false，第三方 WASM 编码器工作得再好也照样弹「仍然不支持」。
       结果就是：格式列表里明明列着 WebP 三个字，点一下检测却被告知不支持，
       用户只能以为功能没生效。判据必须和 availableFormats() 一致。 */
    ['#btnRecheck', '#btnRecheck2'].forEach(function (sel) {
      var b = host.querySelector(sel);
      if (!b) return;
      b.addEventListener('click', function () {
        var cap = resetCap();                    /* 重探 Canvas（原生编码能力）*/

        if (cap.webp) {
          if (viewHost) renderView(viewHost);
          T.toast('这台设备支持 WebP 编码（浏览器原生）', { icon: 'check', ms: 3600 });
          return;
        }

        var enc = T.WebpEnc;
        if (!enc || !enc.supported()) {
          T.toast('仍然不支持 WebP 编码：这台浏览器缺少 WebAssembly 或 Worker',
            { icon: 'warn', ms: 5200 });
          return;
        }

        /* Canvas 这条路不行 —— 而 Safari / iOS 上 WASM 是唯一可能成功的路，
           所以真去加载一次再说。「失败」是个一次性状态，必须先重置才有
           重试的机会，否则这里点一百次也只会拿到上次那个死掉的结论。 */
        if (enc.status() === 'failed') enc.reset();

        var p = enc.whenReady();
        if (viewHost) renderView(viewHost);      /* 先显示「正在加载编码器…」*/

        p.then(function () {
          if (viewHost) renderView(viewHost);
          T.toast('WebP 编码器可用，输出格式里的 WebP 可以正常使用', { icon: 'check', ms: 4000 });
        }, function () {
          if (viewHost) renderView(viewHost);
          T.toast('仍然不支持 WebP 编码：' + (enc.reason() || '编码器加载失败'),
            { icon: 'warn', ms: 5600 });
        });
      });
    });

    var rng = host.querySelector('#rngQ');
    if (rng) {
      rng.addEventListener('input', function () {
        var v = parseInt(rng.value, 10);
        /* 100% 是特殊档：它代表无损，而不是「质量再高一点」。
           Canvas 那边给不出无损，只有 WASM 路径才兑现这个语义。 */
        var q = T.clamp(v / 100, 0.4, 1);
        var lab = host.querySelector('#qVal');
        if (lab) lab.textContent = (v >= 100 ? '无损' : v + '%');
        var hint = host.querySelector('#qHint');
        if (hint) {
          hint.textContent = v >= 100
            ? '无损：像素完全不变。截图、图标、图表用它常常比原图还小；照片会大很多。'
            : '数值越高越清晰、文件越大。照片一般 75–85%，截图与线稿 88% 以上更稳；拉到 100% 是无损。';
        }
        rng.style.setProperty('--pct', Math.round((v - 40) / 60 * 100) + '%');
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

  /* ---------------- 视图 ---------------- */
  var viewHost = null;

  /* 只在「原生不支持 + WASM 也没起来」时才出现 —— 这种情况很少见，
     所以文案里要把两条路都交代清楚，免得用户以为是自己设备的老问题。 */
  var NOTICE_WEBP_OFF =
    '<div class="capmsg">' + T.ic('info', '', 0) +
      '<div><b>这台设备暂时不能编码 WebP，所以格式列表里没有它。</b>' +
      'Safari / WebKit 的 Canvas 至今不支持导出 WebP，而 iOS 上所有浏览器都是 WebKit；' +
      '本页本来带了一个「自带 libwebp 编码器的 WASM」来绕开这个限制，但这次它也没能加载起来' +
      (T.WebpEnc && T.WebpEnc.reason() ? '（' + T.esc(T.WebpEnc.reason()) + '）' : '') + '。<br>' +
      '现在用 <b id="fbLabel">JPEG</b> 输出，体积收益与 WebP 很接近。' +
      '点上面的「重新检测编码能力」或刷新页面再试一次，通常就恢复了。' +
      '</div></div><div style="height:14px"></div>';

  function renderView(host) {
      viewHost = host;
      var cap = probeCap();
      T.Settings.bindFileInput();

      /* 打开工具就把编码器拉起来 —— 用户挑图、调参数这点功夫，120 KB 已经下完，
         于是既不占首屏，也不必在真正点转换时干等。
         必须在渲染设置区之前调用：ctlHTML 会读 status() 决定要不要显示「加载中」。 */
      if (wasmUsable()) T.WebpEnc.warmup();

      host.innerHTML =
        (cap.webp || wasmUsable() ? '' : NOTICE_WEBP_OFF) +

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

      /* 通知文案里的格式名跟随实际输出格式，不写死 */
      var fb = host.querySelector('#fbLabel');
      if (fb) fb.textContent = MIME_LABEL[currentMime()] || 'JPEG';

      var ctlHost = host.querySelector('#ctlHost');
      if (ctlHost) {
        ctlHost.innerHTML = ctlHTML();
        bindControls(host);

        /* 就绪后把「正在加载」那行撤掉就行，不必重建整块设置区
           （重建会连带重绑控件，没必要）；失败才需要重画。 */
        if (wasmUsable()) {
          T.WebpEnc.whenReady().then(function () {
            if (!ctlHost.parentNode) return;      /* 已经离开这个工具页了 */
            var note = ctlHost.querySelector('.ctl__note--enc');
            if (note && note.parentNode) note.parentNode.removeChild(note);
          }).catch(function (e) {
            if (!ctlHost.parentNode) return;
            /* 失败要重画：WebP 得从格式列表里撤掉，并说明为什么 */
            ctlHost.innerHTML = ctlHTML();
            bindControls(host);
            T.toast('WebP 编码器没能加载，已退回浏览器内置编码' +
              (e && e.message ? '：' + e.message : ''), { icon: 'warn', ms: 5200 });
          });
        }
      }
      bindDrop(host);
      bindQueue(host);
      _guard = guardWindowDrag();
      paint();
  }

  /* ---------------- 注册 ---------------- */
  T.register('imageconvert', {
    render: renderView,
    onLeave: function () {
      if (pasteHandler) { document.removeEventListener('paste', pasteHandler); pasteHandler = null; }
      if (_guard) {
        document.removeEventListener('dragover', _guard);
        document.removeEventListener('drop', _guard);
        _guard = null;
      }
      if (delayTimer) { clearTimeout(delayTimer); delayTimer = null; }
      busy = false;
      /* 还在排队的编码请求全部作废。Worker 与已加载的 wasm 都留着不销毁 ——
         重新进来时立刻可用，不必再下一次。 */
      if (T.WebpEnc) T.WebpEnc.abort();
      /* 释放缩略图的 Object URL，避免长时间浏览后内存上涨 */
      items.forEach(function (it) { if (it.thumb) URL.revokeObjectURL(it.thumb); });
      items = [];
      listEl = null;
    }
  });
})(window.Toolbox);
