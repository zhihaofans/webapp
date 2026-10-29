/* ============================================================
   tools/qrcode.js — 二维码生成与识别

   编码与解码都不新写：直接用 js/lib/qr.js 与 js/lib/qrdec.js ——
   局域网传输的配对二维码已经用这两个模块跑了两版，参数表、掩码择优、
   纠错解码整条链路都在真实设备上验证过。本文件只负责三件事：
   界面、状态、把图片喂给解码器。

   生成：输入即出，没有「生成」按钮。改一个字符就重画。
   识别：三条入口（拖/选图片、Ctrl+V 粘贴、摄像头），
         最终都汇到 decodeImage()，结果只在一个地方呈现。
   ============================================================ */
(function (T) {
  'use strict';

  var QR = null, QRDec = null;

  var DRAFT = 'qrcode.text';
  var QUIET = 4;
  /* 输出边长可选档位：core.js 只做区间收敛，这里负责给用户挑 */
  var SIZES = [256, 384, 512, 768, 1024];
  var SAMPLE_MAX = 1600;   /* 识别时先把大图缩到这个边长内，太慢没意义 */

  var state = {
    text: '',
    ecc: 'M',
    size: 512,
    version: 0,
    result: '',
    resultMeta: '',
    hasCam: true
  };

  var els = {};
  var off = null;          /* 离屏 canvas：识别时缩图用 */
  var inputTimer = null;
  var onPaste = null;

  /* ---------------- 小工具 ---------------- */
  function bytesLen(s) {
    try { return new TextEncoder().encode(s).length; }
    catch (e) { return unescape(encodeURIComponent(s)).length; }
  }
  function ensureOff() {
    if (off) return off;
    var cv = document.createElement('canvas');
    var cx = cv.getContext && cv.getContext('2d', { willReadFrequently: true });
    if (!cx) return null;
    off = { cv: cv, cx: cx };
    return off;
  }

  /* ---------------- 生成 ---------------- */
  function draw() {
    if (!QR || !els.canvas) return;
    var text = els.text.value;

    /* 空输入：收起画布，不画一张空白码让人以为「生成失败了」 */
    if (!text.trim()) {
      state.version = 0;
      state.text = '';
      els.wrap.classList.add('is-empty');
      els.meta.textContent = '—';
      els.cap.textContent = '输入内容后，这里会实时生成二维码。';
      els.dl.disabled = true;
      els.copy.disabled = true;
      els.cap.classList.remove('is-bad');
      T.Store.setDraft(DRAFT, '');
      return;
    }

    state.text = text;
    T.Store.setDraft(DRAFT, text);

    var m;
    try {
      m = QR.matrix(text, { ecl: state.ecc });
    } catch (e) {
      state.version = 0;
      els.wrap.classList.add('is-empty');
      els.meta.textContent = '超出容量';
      els.cap.textContent = (e && e.message) || '这段内容编不成二维码。';
      els.cap.classList.add('is-bad');
      els.dl.disabled = true;
      els.copy.disabled = false;
      return;
    }
    els.cap.classList.remove('is-bad');

    /* 按目标边长反算每模块像素：宁可略小于目标，也不放大到发虚 */
    var total = m.size + QUIET * 2;
    var scale = Math.max(1, Math.floor(state.size / total));
    var px = total * scale;

    var cv = els.canvas;
    cv.width = px;
    cv.height = px;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = '#17150f';
    for (var y = 0; y < m.size; y++) {
      var row = y * m.size;
      for (var x = 0; x < m.size; x++) {
        if (m.data[row + x]) ctx.fillRect((x + QUIET) * scale, (y + QUIET) * scale, scale, scale);
      }
    }

    state.version = m.version;
    els.wrap.classList.remove('is-empty');
    els.meta.textContent = 'v' + m.version + ' · ' + m.size + '×' + m.size + ' · ' + px + ' px';
    els.cap.textContent = '内容 ' + bytesLen(text) + ' 字节 · 纠错 ' + m.ecl +
      ' · 模块 ' + m.size + '×' + m.size;
    els.dl.disabled = false;
    els.copy.disabled = false;
  }

  function drawSoon() {
    clearTimeout(inputTimer);
    inputTimer = setTimeout(draw, 90);
  }

  function downloadPng() {
    if (!state.version || !els.canvas) return;
    var name = 'qrcode-v' + state.version + '-' + Date.now().toString(36) + '.png';
    if (!els.canvas.toBlob) {
      T.toast('这个浏览器不支持导出图片，可以直接截屏', { icon: 'info' });
      return;
    }
    els.canvas.toBlob(function (b) {
      if (!b) { T.toast('导出图片失败，请重试', { icon: 'warn' }); return; }
      T.downloadBlob(b, name);
      T.toast('已保存 ' + name, { icon: 'download' });
    }, 'image/png');
  }

  /* ---------------- 识别 ---------------- */
  /* 一次尝试：把图缩到最长边不超过 cap，铺白底后交给解码器 */
  function decodeAt(img, cap) {
    var o = ensureOff();
    if (!o) return null;

    var w = img.naturalWidth || img.width;
    var h = img.naturalHeight || img.height;
    var longest = Math.max(w, h);
    var k = Math.min(1, cap / longest);
    var cw = Math.max(21, Math.round(w * k));
    var ch = Math.max(21, Math.round(h * k));

    o.cv.width = cw;
    o.cv.height = ch;
    /* 必须先铺白底：透明 PNG 的透明像素是 (0,0,0,0)，直接灰度化会变成
       一整片黑，定位图案直接没了 —— 这是「一张好好的透明二维码扫不出来」
       的唯一原因。 */
    o.cx.fillStyle = '#ffffff';
    o.cx.fillRect(0, 0, cw, ch);
    o.cx.drawImage(img, 0, 0, cw, ch);

    var data;
    try { data = o.cx.getImageData(0, 0, cw, ch); }
    catch (e) { return null; }

    try { return QRDec.decode(data); }
    catch (e) { return null; }
  }

  /* 同一张图按几档尺寸各试一次：
       · 原尺寸（最长边不超过 1600）—— 普通截图、相册照片
       · 800 / 400 —— 二维码在画面里占比很大、模块几十像素时，
         缩下来更接近「标准比例」，二值化与采样都更稳
     三档都失败才认定认不出，不拿一次偶然失败下结论。 */
  function decodeImage(img) {
    if (!QRDec || !QRDec.ready) return null;
    var longest = Math.max(img.naturalWidth || img.width || 0, img.naturalHeight || img.height || 0);
    if (!longest) return null;

    var caps = [], seen = {};
    [SAMPLE_MAX, 800, 400].forEach(function (c) {
      var v = Math.min(c, longest);
      if (v >= 21 && !seen[v]) { seen[v] = 1; caps.push(v); }
    });
    for (var i = 0; i < caps.length; i++) {
      var r = decodeAt(img, caps[i]);
      if (r && r.text) return r;
    }
    return null;
  }

  function showError(msg) {
    if (!els.err) return;
    if (!msg) { els.err.hidden = true; els.err.textContent = ''; return; }
    els.err.hidden = false;
    els.err.textContent = msg;
  }

  function showResult(text, meta) {
    state.result = text;
    state.resultMeta = meta || '';
    els.res.hidden = false;
    els.resBody.textContent = text;
    els.resMeta.textContent = state.resultMeta;

    var s = String(text).trim();
    var isUrl = /^https?:\/\//i.test(s);
    els.open.hidden = !isUrl;
    if (isUrl) els.open.href = s;
    else els.open.removeAttribute('href');

    showError('');
  }

  function clearResult() {
    state.result = '';
    state.resultMeta = '';
    if (els.res) els.res.hidden = true;
    showError('');
  }

  function scanFile(blob) {
    if (!blob) return;
    if (blob.type && !/^image\//.test(blob.type)) {
      showError('这不是图片文件。扫码需要一张包含二维码的图片。');
      return;
    }
    clearResult();
    els.scanMeta.textContent = '识别中…';

    var url = URL.createObjectURL(blob);
    var im = new Image();
    im.onload = function () {
      var r = decodeImage(im);
      URL.revokeObjectURL(url);
      els.scanMeta.textContent = '';
      if (!r || !r.text) {
        showError('没能识别出二维码。换一张试试：二维码要完整入框、别裁掉四周留白、避开反光或手抖；' +
          '如果图里根本没有码，或者码是彩色的艺术码，这条链路也认不出来。');
        return;
      }
      showResult(r.text, 'v' + r.version + ' · 纠错 ' + r.ecl + ' · ' +
        (im.naturalWidth || im.width) + '×' + (im.naturalHeight || im.height));
    };
    im.onerror = function () {
      URL.revokeObjectURL(url);
      els.scanMeta.textContent = '';
      showError('这张图片打不开，可能格式不被浏览器支持 —— iPhone 的 HEIC 照片常见这种情况，' +
        '可以在相册里导出成 JPG，或者直接截屏再选。');
    };
    im.src = url;
  }

  /* ---------------- 摄像头（实时取景） ----------------
     取景、抽帧、两条解码路径都在 js/scanner.js —— 局域网传输用的是同一份。
     这里只管「框摆哪儿、扫到之后怎么显示」。 */
  var scanCtl = null;
  var camTimer = null;

  /* 浏览器只在安全上下文里给 getUserMedia：https 或 localhost。
     局域网 http:// 下 navigator.mediaDevices 是 undefined，按钮留着会点一次失败一次，
     所以先判断，点的时候给明确原因。 */
  function liveCamOK() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  /* 「API 存在」不等于「有摄像头」：没摄像头就别给这个按钮 */
  function probeCameras() {
    if (!(T.Scanner && T.Scanner.hasCamera)) return;
    T.Scanner.hasCamera().then(function (has) {
      if (has === state.hasCam) return;
      state.hasCam = has;
      if (els.cam) els.cam.hidden = !has;
    }).catch(function () {});
  }

  function stopCam() {
    clearTimeout(camTimer);
    camTimer = null;
    if (scanCtl) { scanCtl.stop(); scanCtl = null; }
    if (els.camBox) els.camBox.hidden = true;
    if (els.cam) els.cam.hidden = !state.hasCam;
    setHint('把二维码放进取景框，读到会自动停');
  }

  function setHint(txt) {
    if (els.camHint) els.camHint.textContent = txt;
  }

  function startCam() {
    if (!T.Scanner) {
      showError('扫码模块没有加载成功（js/scanner.js）。刷新页面重试；如果反复出现，检查文件是否被缓存成了旧版。');
      return;
    }
    if (!liveCamOK()) {
      showError('这个地址拿不到摄像头：浏览器只在 https 或本机地址（localhost / 127.0.0.1）' +
        '下把摄像头交给网页。换 https 打开本页，或者用同一台设备上的本机地址访问；' +
        '也可以先用「拍照扫码」，那条路走系统相机，不受这个限制。');
      return;
    }

    clearResult();
    els.camBox.hidden = false;
    els.cam.hidden = true;
    /* 先把状态摆出来：点下去什么都不发生最难受，至少知道「在请求权限」 */
    setHint('正在请求摄像头权限…');

    try {
      scanCtl = T.Scanner.create({
        video: els.video,
        onStart: function () {
          setHint('把二维码放进取景框，读到会自动停');
        },
        onResult: function (r) {
          stopCam();
          var meta = (r.how === 'self' && r.version)
            ? 'v' + r.version + ' · 纠错 ' + r.ecl + ' · 摄像头'
            : '摄像头';
          showResult(r.text, meta);
        },
        onError: function (msg) {
          scanCtl = null;
          stopCam();
          showError(msg);
        }
      });
    } catch (e) {
      stopCam();
      showError('打开摄像头时出错：' + (e && e.message ? e.message : String(e)));
      return;
    }

    if (!scanCtl.start()) { scanCtl = null; stopCam(); return; }

    /* 浏览器把权限弹窗晾在那儿时 getUserMedia 可能一直不 settle —— 10 秒没起来就明说 */
    clearTimeout(camTimer);
    camTimer = setTimeout(function () {
      if (els.camBox && !els.camBox.hidden && scanCtl && !scanCtl.isRunning()) {
        stopCam();
        showError('请求摄像头没有回应：可能权限弹窗还开着，或者浏览器/系统拦住了摄像头。' +
          '允许摄像头后重试；急着用可以先「拍照扫码」。');
      }
    }, 10000);
  }

  /* ---------------- 三条识别入口 ---------------- */
  function onPasteHandler(e) {
    var cd = e.clipboardData;
    if (!cd) return;
    var items = cd.items || [];
    for (var i = 0; i < items.length; i++) {
      var type = items[i].type || '';
      if (!/^image\//.test(type)) continue;
      var f = items[i].getAsFile();
      if (f) { e.preventDefault(); scanFile(f); return; }
    }
  }

  function pasteFromClipboard() {
    if (!(navigator.clipboard && navigator.clipboard.read)) {
      T.toast('这个浏览器不支持读取剪贴板图片，试试 Ctrl+V 粘贴', { icon: 'info' });
      return;
    }
    navigator.clipboard.read().then(function (items) {
      var found = null;
      return Promise.all(items.map(function (it) {
        if (found) return null;
        var t = (it.types || []).filter(function (x) { return /^image\//.test(x); })[0];
        if (!t) return null;
        return it.getType(t).then(function (blob) { if (!found) found = blob; });
      })).then(function () {
        if (found) scanFile(found);
        else T.toast('剪贴板里没有图片', { icon: 'info' });
      });
    }).catch(function () {
      T.toast('读取剪贴板被拒绝，可以改用 Ctrl+V', { icon: 'warn' });
    });
  }

  /* ---------------- 视图 ---------------- */
  function sizeOptions() {
    return SIZES.map(function (s) {
      return '<option value="' + s + '"' + (s === state.size ? ' selected' : '') + '>' + s + ' px</option>';
    }).join('');
  }

  function view() {
    return '<div class="qr">' +
      '<div class="qr__main">' +

        '<section class="panel">' +
          '<div class="panel__hd"><h3>' + T.ic('qr', '', 0) + '生成二维码</h3>' +
            '<span class="qr__meta" id="qrMeta">—</span></div>' +
          '<div class="panel__bd">' +
            '<div class="qr__gen">' +
              '<div class="qr__form">' +
                '<label class="qr__lbl" for="qrText">内容</label>' +
                '<textarea class="qr__ta" id="qrText" rows="5" spellcheck="false"' +
                  ' placeholder="输入文字、网址或任意一段文本，右边实时生成"></textarea>' +
                '<div class="qr__opts">' +
                  '<div class="qr__opt">' +
                    '<span class="qr__opt-l">纠错等级</span>' +
                    '<div class="seg" id="qrEcc" role="tablist" aria-label="纠错等级">' +
                      '<button class="seg__b' + (state.ecc === 'L' ? ' is-on' : '') + '" type="button" data-ecc="L">L</button>' +
                      '<button class="seg__b' + (state.ecc === 'M' ? ' is-on' : '') + '" type="button" data-ecc="M">M</button>' +
                    '</div>' +
                  '</div>' +
                  '<div class="qr__opt">' +
                    '<label class="qr__opt-l" for="qrSize">输出尺寸</label>' +
                    '<select class="inp qr__sel" id="qrSize">' + sizeOptions() + '</select>' +
                  '</div>' +
                '</div>' +
                '<div class="qr__cap" id="qrCap">输入内容后，这里会实时生成二维码。</div>' +
              '</div>' +

              '<div class="qr__canvaswrap">' +
                '<div class="qr__canvas is-empty" id="qrWrap">' +
                  '<canvas id="qrCanvas" aria-label="生成的二维码"></canvas>' +
                  '<div class="qr__ph">' + T.ic('qr', '', 0) + '<span>等待内容</span></div>' +
                '</div>' +
                '<div class="qr__btnrow">' +
                  '<button class="btn btn--primary btn--sm" type="button" id="qrDl" disabled>' +
                    T.ic('download', '', 0) + '下载 PNG</button>' +
                  '<button class="btn btn--sm" type="button" id="qrCopy" disabled>' +
                    T.ic('copy', '', 0) + '复制内容</button>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</section>' +

        '<section class="panel">' +
          '<div class="panel__hd"><h3>' + T.ic('eye', '', 0) + '识别二维码</h3>' +
            '<span class="qr__meta" id="qrScanMeta"></span></div>' +
          '<div class="panel__bd">' +
            '<div class="qr__drop" id="qrDrop" role="button" tabindex="0">' +
              T.ic('upload', '', 0) +
              '<b>拖入图片 · 点这里选相册 · Ctrl+V 粘贴</b>' +
              '<span>直接从截图或照片里解出内容，图片不会离开这台设备。</span>' +
            '</div>' +
            '<input type="file" id="qrFile" accept="image/*" hidden>' +
            /* capture 让浏览器把「选文件」换成系统相机：拍完直接拿到一张照片 */
            '<input type="file" id="qrShot" accept="image/*" capture="environment" hidden>' +

            '<div class="qr__scanbtns">' +
              '<button class="btn btn--sm" type="button" id="qrGallery">' +
                T.ic('image', '', 0) + '从相册选择</button>' +
              '<button class="btn btn--sm" type="button" id="qrShotBtn">' +
                T.ic('camera', '', 0) + '拍照扫码</button>' +
              '<button class="btn btn--sm" type="button" id="qrCam">' +
                T.ic('eye', '', 0) + '实时扫码</button>' +
              '<button class="btn btn--sm" type="button" id="qrPaste">' +
                T.ic('paste', '', 0) + '从剪贴板读取</button>' +
            '</div>' +
            (liveCamOK() ? '' :
              '<p class="qr__hint">' + T.ic('info', '', 0) +
                '当前是 http 地址，浏览器不把摄像头交给网页（要 https 或本机地址）。' +
                '「实时扫码」会说明原因；「拍照扫码」由系统相机拍一张，不受这条限制。</p>') +

            '<div class="qr__cam" id="qrCamBox" hidden>' +
              '<video id="qrVideo" playsinline muted autoplay></video>' +
              '<div class="qr__cam-hint" id="qrCamHint">把二维码放进取景框，读到会自动停</div>' +
              '<button class="btn btn--sm btn--ghost qr__camstop" type="button" id="qrCamStop">停止扫码</button>' +
            '</div>' +

            '<div class="qr__res" id="qrRes" hidden>' +
              '<div class="qr__res-hd">' +
                '<span class="tag tag--accent">识别结果</span>' +
                '<span class="qr__res-meta" id="qrResMeta"></span>' +
              '</div>' +
              '<pre class="qr__res-body" id="qrResBody"></pre>' +
              '<div class="qr__res-foot">' +
                '<button class="btn btn--sm" type="button" id="qrResCopy">' + T.ic('copy', '', 0) + '复制</button>' +
                '<button class="btn btn--sm" type="button" id="qrResGen">' + T.ic('qr', '', 0) + '拿去重新生成</button>' +
                '<a class="btn btn--sm btn--ghost" id="qrResOpen" target="_blank" rel="noopener" hidden>' +
                  T.ic('external', '', 0) + '打开链接</a>' +
                '<button class="btn btn--sm btn--ghost qr__res-clear" type="button" id="qrResClear">清空</button>' +
              '</div>' +
            '</div>' +

            '<div class="qr__err" id="qrErr" hidden></div>' +
          '</div>' +
        '</section>' +

      '</div>' +

      '<aside class="qr__side">' +
        '<div class="panel">' +
          '<div class="panel__hd"><h3>' + T.ic('info', '', 0) + '怎么用</h3></div>' +
          '<div class="panel__bd">' +
            '<p class="note" style="margin-bottom:9px">' +
              '左边输入 → 二维码即时生成，下载的是 PNG，边长按「输出尺寸」定。' +
            '</p>' +
            '<p class="note">' +
              '扫码支持三种方式：把图片拖进来、<b>Ctrl / ⌘ + V</b> 直接粘贴截图，' +
              '或者开摄像头对着屏幕扫。' +
            '</p>' +
          '</div>' +
        '</div>' +
        '<div class="panel">' +
          '<div class="panel__hd"><h3>' + T.ic('shield', '', 0) + '几点说明</h3></div>' +
          '<div class="panel__bd">' +
            '<ul class="plist">' +
              '<li class="sitem"><span class="sitem__n">1</span><span class="sitem__t">' +
                '编码与解码都在本机完成，图片不上传、不联网。</span></li>' +
              '<li class="sitem"><span class="sitem__n">2</span><span class="sitem__t">' +
                '纠错 L / M 两档：L 装得更多，M 更耐脏、破损也能恢复。</span></li>' +
              '<li class="sitem"><span class="sitem__n">3</span><span class="sitem__t">' +
                '只解标准二维码（字节模式），加密码、彩色艺术码认不出。</span></li>' +
              '<li class="sitem"><span class="sitem__n">4</span><span class="sitem__t">' +
                '内容会随输入自动保存，关掉页面再打开还在。</span></li>' +
            '</ul>' +
          '</div>' +
        '</div>' +
      '</aside>' +
    '</div>' +
    '<div class="pagefoot">' +
      '生成与识别全部在你的浏览器里完成，不联网、不上传。' +
    '</div>';
  }

  /* 显式映射而不是按命名规则推导：模板里改了 id 忘了这里，会在这里一眼看见 */
  var IDS = {
    meta: 'qrMeta', text: 'qrText', ecc: 'qrEcc', size: 'qrSize', cap: 'qrCap',
    wrap: 'qrWrap', canvas: 'qrCanvas', dl: 'qrDl', copy: 'qrCopy',
    scanMeta: 'qrScanMeta', drop: 'qrDrop', file: 'qrFile', shot: 'qrShot',
    gallery: 'qrGallery', shotBtn: 'qrShotBtn', cam: 'qrCam', paste: 'qrPaste',
    camBox: 'qrCamBox', camHint: 'qrCamHint', video: 'qrVideo', camStop: 'qrCamStop',
    res: 'qrRes', resMeta: 'qrResMeta', resBody: 'qrResBody', resCopy: 'qrResCopy',
    resGen: 'qrResGen', resOpen: 'qrResOpen', resClear: 'qrResClear', err: 'qrErr'
  };

  function collect(host) {
    Object.keys(IDS).forEach(function (k) {
      els[k] = host.querySelector('#' + IDS[k]);
    });
  }

  function bind() {
    els.text.addEventListener('input', function () {
      T.Store.setDraft(DRAFT, els.text.value);   /* 立即落盘，防抖只影响重绘 */
      drawSoon();
    });

    els.ecc.addEventListener('click', function (e) {
      var b = e.target.closest('[data-ecc]');
      if (!b) return;
      state.ecc = b.getAttribute('data-ecc');
      Array.prototype.forEach.call(els.ecc.querySelectorAll('[data-ecc]'), function (x) {
        x.classList.toggle('is-on', x === b);
      });
      T.Store.patch({ qrEcc: state.ecc });
      draw();
    });

    els.size.addEventListener('change', function () {
      state.size = parseInt(els.size.value, 10) || 512;
      T.Store.patch({ qrSize: state.size });
      draw();
    });

    els.dl.addEventListener('click', downloadPng);
    els.copy.addEventListener('click', function () {
      T.copyText(els.text.value).then(function () {
        T.toast('内容已复制', { icon: 'copy' });
      }).catch(function () { T.toast('复制失败，请手动选中复制', { icon: 'warn' }); });
    });

    /* 识别：选图 / 拖拽 / 键盘 */
    els.drop.addEventListener('click', function () { els.file.click(); });
    els.drop.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.file.click(); }
    });
    els.drop.addEventListener('dragover', function (e) {
      e.preventDefault();
      els.drop.classList.add('is-over');
    });
    els.drop.addEventListener('dragleave', function () { els.drop.classList.remove('is-over'); });
    els.drop.addEventListener('drop', function (e) {
      e.preventDefault();
      els.drop.classList.remove('is-over');
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) scanFile(f);
    });
    els.file.addEventListener('change', function () {
      var f = els.file.files && els.file.files[0];
      els.file.value = '';
      if (f) scanFile(f);
    });

    /* 相册：同一个 input 不等于「用户找得到」—— 很多手机的文件选择器默认落在
       文档页，相册要再点两下。所以单独给一个入口。 */
    els.gallery.addEventListener('click', function () { els.file.click(); });

    /* 拍照：capture 属性把选择器换成系统相机，拍完回来的就是一张照片 */
    els.shotBtn.addEventListener('click', function () { els.shot.click(); });
    els.shot.addEventListener('change', function () {
      var f = els.shot.files && els.shot.files[0];
      els.shot.value = '';
      if (f) scanFile(f);
    });

    if (els.cam) els.cam.addEventListener('click', startCam);
    els.camStop.addEventListener('click', function () {
      stopCam();
      T.toast('已停止扫码', { icon: 'info', ms: 1600 });
    });
    els.paste.addEventListener('click', pasteFromClipboard);

    els.resCopy.addEventListener('click', function () {
      if (!state.result) return;
      T.copyText(state.result).then(function () {
        T.toast('已复制识别结果', { icon: 'copy' });
      }).catch(function () { T.toast('复制失败，请手动选中复制', { icon: 'warn' }); });
    });
    els.resGen.addEventListener('click', function () {
      if (!state.result) return;
      els.text.value = state.result;
      draw();
      els.text.focus();
      try { els.text.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) { /* 忽略 */ }
    });
    els.resClear.addEventListener('click', function () { stopCam(); clearResult(); });

    document.addEventListener('paste', onPaste);
    probeCameras();
  }

  T.register('qrcode', {
    render: function (host, tool) {
      QR = T.QR;
      QRDec = T.QRDec;

      if (!QR) {
        host.innerHTML = '<div class="capmsg">' + T.ic('warn', '', 0) +
          '<div><b>二维码模块没有加载成功。</b>请刷新页面重试。</div></div>';
        return;
      }

      var st = T.Store.settings;
      state.ecc = (st.qrEcc === 'L' || st.qrEcc === 'M') ? st.qrEcc : 'M';
      state.size = SIZES.indexOf(st.qrSize) >= 0 ? st.qrSize : 512;
      state.result = '';

      T.Settings.bindFileInput();
      host.innerHTML = view();
      collect(host);

      els.text.value = T.Store.getDraft(DRAFT);
      onPaste = onPasteHandler;

      bind();
      draw();
    },
    onLeave: function () {
      clearTimeout(inputTimer);
      inputTimer = null;
      stopCam();
      if (onPaste) { document.removeEventListener('paste', onPaste); onPaste = null; }
      off = null;       /* 离屏 canvas 随视图一起释放 */
      els = {};
      state.result = '';
      state.text = '';
      state.version = 0;
    }
  });
})(window.Toolbox);
