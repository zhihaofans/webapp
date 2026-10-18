/* ============================================================
   tools/lanshare.js — 局域网文件传输

   一句话：两台设备之间拉一条 WebRTC DataChannel，文件走这条线直传，
   全程不碰任何服务器。

   没有服务器，配对信息怎么交换？靠二维码接力：
     ① A 点「发起」→ 生成 offer → 压成二维码 + 链接
     ② B 用系统相机扫 → 打开链接 → 自动生成 answer → 出自己的二维码
     ③ A 扫 B 的码（或粘贴链接）→ 连接建立
   配对信息只在两台设备的屏幕和摄像头之间流动，没有任何第三方经手。

   安全：
     · DataChannel 本身跑在 DTLS 上，端到端加密，中间节点解不开；
     · iceServers 留空 → 连 STUN 都不问，只会产生本地/私网候选，
       从协议层面就不存在「走 TURN 中继」的可能；
     · 连上后两端各自用「自己的 DTLS 指纹 + 对方的」算出 6 位 SAS，
       屏幕上核对一致即可排除中间人。
   ============================================================ */
(function (T) {
  'use strict';

  var LS = null, QR = null, QRDec = null;
  var hostEl = null;
  var seq = 0;
  var lastPaint = 0;

  var state = {
    phase: 'idle',        /* idle | starting | hosting | joining | connecting | connected | closed */
    role: '',             /* host | guest */
    qrText: '',
    sas: '',
    note: '',
    error: '',
    pc: null,
    dc: null,
    scanning: false,
    hasCam: true,         /* 由 probeCameras() 校准；拿不到设备列表时保持 true，不误伤 */
    stream: null,
    scanTimer: null,
    inbound: null,        /* { id, name, size, mime, chunks, recv } */
    transfers: [],        /* { id, name, size, done, dir, kind, status, url, text } */
    incoming: {},         /* 元信息暂存 */
    consumed: false
  };

  /* ---------------- 页内扫码 ----------------
     有摄像头就直接扫，省掉「复制一长串链接」这一步。
     BarcodeDetector 的支持情况：Safari 17+ / Chrome 88+ / Edge 83+（Firefox 没有）。
     不支持就不显示这个入口，退回剪贴板或手动粘贴 —— 不做假按钮。 */
  /* 能不能扫，取三者之一：
       · 系统自带 BarcodeDetector（Safari 17+ / macOS、ChromeOS 上的 Chrome）
       · 自研解码器 qrdec.js（其它 Chrome/Edge/Firefox 都靠它）
     桌面端的 BarcodeDetector 只覆盖 ChromeOS 和 macOS —— Windows / Linux
     的 Chrome 明明有摄像头却用不了，所以必须有兜底。 */
  function nativeDetector() {
    return typeof window.BarcodeDetector === 'function';
  }
  function canScan() {
    if (!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)) return false;
    return nativeDetector() || !!(QRDec && QRDec.ready);
  }
  /* 「支持扫码 API」和「真的有摄像头」是两件事：台式机/部分笔记本有前者没后者，
     点了 getUserMedia 才报错，用户白挨一下挫败。先问设备列表。 */
  function probeCameras() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
    navigator.mediaDevices.enumerateDevices().then(function (list) {
      if (!list || !list.length) return;   /* 未授权时部分浏览器返回空表，按「有」处理 */
      var n = 0;
      for (var i = 0; i < list.length; i++) if (list[i].kind === 'videoinput') n++;
      var has = n > 0;
      if (has === state.hasCam) return;
      state.hasCam = has;
      if (!state.scanning && (state.phase === 'hosting' || state.phase === 'joining')) paint();
    }).catch(function () {});
  }
  /* 本机到底能不能扫码 */
  function scanReady() { return canScan() && state.hasCam; }
  function canClipPaste() {
    return !!(navigator.clipboard && navigator.clipboard.readText);
  }
  function stopScan() {
    if (state.scanTimer) { clearInterval(state.scanTimer); state.scanTimer = null; }
    if (state.stream) {
      try { state.stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
      state.stream = null;
    }
    if (state.scanning) { state.scanning = false; paint(); }
  }
  /* 抽帧：把视频帧画到离屏 canvas，缩到 640 宽再交给解码器。
     太大只是慢，太小则模块不够分辨 —— 800 宽下 v16 码每个模块约 3px，勉强够。 */
  function makeGrabber() {
    if (typeof document === 'undefined') return null;
    var cv = document.createElement('canvas');
    var cx = cv.getContext && cv.getContext('2d', { willReadFrequently: true });
    if (!cx) return null;
    return function (video) {
      var vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh) return null;
      var maxW = 800;
      var k = vw > maxW ? maxW / vw : 1;
      var w = Math.max(21, Math.round(vw * k));
      var h = Math.max(21, Math.round(vh * k));
      if (cv.width !== w) { cv.width = w; cv.height = h; }
      try {
        cx.drawImage(video, 0, 0, w, h);
        return cx.getImageData(0, 0, w, h);
      } catch (e) { return null; }
    };
  }

  function startScan() {
    if (!canScan()) return T.toast('这台设备用不了摄像头', { icon: 'warn' });
    state.scanning = true;
    state.error = '';
    paint();

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(function (stream) {
        if (!state.scanning) { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
        state.stream = stream;
        var v = hostEl && hostEl.querySelector('#lsVideo');
        if (!v) return;
        v.srcObject = stream;
        v.setAttribute('playsinline', '');
        v.play().catch(function () {});

        var det = nativeDetector() ? new window.BarcodeDetector({ formats: ['qr_code'] }) : null;
        var grab = det ? null : makeGrabber();

        state.scanTimer = setInterval(function () {
          if (!v.videoWidth) return;

          if (det) {
            det.detect(v).then(function (codes) {
              if (!codes || !codes.length) return;
              var raw = codes[0].rawValue || '';
              stopScan();
              applyFromUrl(raw);
            }).catch(function () {});
            return;
          }

          /* 自研解码：抽帧 → 灰度 → 找定位图案 → 采样 → 纠错，整条都是同步的，
             所以间隔放长一点，别把主线程占满、让取景卡住 */
          if (!grab || !QRDec) return;
          var img = grab(v);
          if (!img) return;
          var got = null;
          try { got = QRDec.decode(img); } catch (e) { got = null; }
          if (got && got.text) {
            stopScan();
            applyFromUrl(got.text);
          }
        }, det ? 280 : 260);
      })
      .catch(function (e) {
        state.scanning = false;
        state.error = '打不开摄像头：' + ((e && e.name) === 'NotAllowedError'
          ? '没有给摄像头权限。' : (e && e.message || '设备不可用'));
        paint();
      });
  }

  /* 扫码 / 粘贴得到的东西可能是整条链接，也可能只是配对码，统一抽出 ls 参数 */
  function payloadFrom(text) {
    var s = String(text || '').trim();
    if (!s) return '';
    var i = s.indexOf('?ls=');
    if (i >= 0) return decodeURIComponent(s.slice(i + 4).split('#')[0]);
    if (s.indexOf('LS1') === 0) return s;
    return '';
  }
  function applyFromUrl(text) {
    var p = payloadFrom(text);
    if (!p) {
      state.error = '扫到的不是本工具的配对码';
      paint();
      return;
    }
    applyAnswer(p);
  }

  /* ---------------- 小工具 ---------------- */
  function esc(s) { return T.esc(s); }
  function paint() {
    lastPaint = Date.now();
    if (!hostEl) return;
    hostEl.innerHTML = viewHTML();
    bindOnce();
  }
  function paintThrottled() {
    if (Date.now() - lastPaint < 180) return;
    paint();
  }
  function fail(msg) {
    state.error = msg || '出错了';
    state.phase = state.pc ? 'closed' : 'idle';
    paint();
  }

  function buildUrl(payload) {
    return location.origin + location.pathname + '?ls=' + payload + '#/lanshare';
  }
  function readIncoming() {
    try {
      var q = new URLSearchParams(location.search).get('ls');
      return q || '';
    } catch (e) { return ''; }
  }
  function clearIncoming() {
    try {
      history.replaceState(null, '', location.pathname + location.hash);
    } catch (e) {}
  }

  /* ---------------- WebRTC ---------------- */
  function newPC() {
    /* 关键：iceServers 留空。没有 STUN/TURN，候选只可能是 host（本地/私网），
       文件也就只可能在同一局域网内直连。 */
    var pc = new RTCPeerConnection({ iceServers: [] });
    pc.addEventListener('connectionstatechange', function () {
      var s = pc.connectionState;
      if (s === 'connected') return;          /* 以 DataChannel open 为准 */
      if (s === 'failed') fail('直连失败：两台设备可能不在同一局域网，或路由器开了「客户端隔离」。');
      if (s === 'disconnected') { state.note = '连接暂时中断，正在尝试恢复…'; paint(); }
    });
    pc.addEventListener('datachannel', function (e) { bindChannel(e.channel); });
    return pc;
  }

  function waitIce(pc, ms) {
    return new Promise(function (resolve) {
      if (pc.iceGatheringState === 'complete') return resolve();
      var done = false;
      var finish = function () { if (!done) { done = true; resolve(); } };
      pc.addEventListener('icegatheringstatechange', function () {
        if (pc.iceGatheringState === 'complete') finish();
      });
      setTimeout(finish, ms || 3500);
    });
  }

  function startHost() {
    if (!window.RTCPeerConnection) return fail('这台浏览器不支持 WebRTC，无法直连。');
    state.phase = 'starting'; state.role = 'host'; state.error = ''; paint();

    var pc = newPC();
    state.pc = pc;
    bindChannel(pc.createDataChannel('lan', { ordered: true }));

    pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false })
      .then(function (o) { return pc.setLocalDescription(o); })
      .then(function () { return waitIce(pc, 3500); })
      .then(function () { return LS.pack({ k: 'offer', sdp: pc.localDescription.sdp }); })
      .then(function (payload) {
        state.qrText = buildUrl(payload);
        state.phase = 'hosting';
        paint();
        probeCameras();
      })
      .catch(function (e) { fail('生成配对信息失败：' + (e && e.message || e)); });
  }

  function joinWith(payload) {
    if (!window.RTCPeerConnection) return fail('这台浏览器不支持 WebRTC，无法直连。');
    state.phase = 'starting'; state.role = 'guest'; state.error = ''; paint();

    LS.unpack(payload).then(function (obj) {
      if (obj.k !== 'offer') throw new Error('这不是「发起方」的二维码');
      var pc = newPC();
      state.pc = pc;
      return pc.setRemoteDescription({ type: 'offer', sdp: obj.sdp })
        .then(function () { return pc.createAnswer(); })
        .then(function (a) { return pc.setLocalDescription(a); })
        .then(function () { return waitIce(pc, 3500); })
        .then(function () { return LS.pack({ k: 'answer', sdp: pc.localDescription.sdp }); })
        .then(function (p) {
          state.qrText = buildUrl(p);
          state.phase = 'joining';
          paint();
          probeCameras();
        });
    }).catch(function (e) { fail(e && e.message || '配对信息无法识别'); });
  }

  function applyAnswer(payload) {
    if (!state.pc || state.phase !== 'hosting') {
      return fail('这条应答已经失效了。请让对方重新扫一次你的二维码。');
    }
    LS.unpack(payload).then(function (obj) {
      if (obj.k !== 'answer') throw new Error('这不是「接收方」的应答二维码');
      return state.pc.setRemoteDescription({ type: 'answer', sdp: obj.sdp });
    }).then(function () {
      state.phase = 'connecting';
      state.note = '正在建立直连…';
      paint();
    }).catch(function (e) { fail(e && e.message || '应答信息无法识别'); });
  }

  function bindChannel(dc) {
    state.dc = dc;
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = LS ? LS.LOW_WATER : 65536;

    dc.onopen = function () {
      var fpL = LS.fingerprintOf(state.pc.localDescription && state.pc.localDescription.sdp);
      var fpR = LS.fingerprintOf(state.pc.remoteDescription && state.pc.remoteDescription.sdp);
      LS.sas(fpL, fpR).then(function (code) {
        state.sas = code;
        state.phase = 'connected';
        state.note = '';
        paint();
      });
    };
    dc.onclose = function () {
      if (state.phase === 'connected') {
        state.phase = 'closed';
        state.note = '对方已断开';
        paint();
      }
    };
    dc.onerror = function () { fail('连接出错，请重新发起。'); };
    dc.onmessage = onMessage;
  }

  /* ---------------- 收发 ---------------- */
  function onMessage(e) {
    var data = e.data;

    if (typeof data === 'string') {
      var m;
      try { m = JSON.parse(data); } catch (err) { return; }

      if (m.t === 'meta') {
        if (m.kind === 'text') {
          state.transfers.unshift({
            id: m.id || ('x' + (++seq)), kind: 'text', dir: 'in', name: '文本',
            text: String(m.text || ''), status: 'done', size: (m.text || '').length
          });
          paint();
          return;
        }
        state.inbound = {
          id: m.id, name: m.name || '未命名', size: m.size || 0,
          mime: m.mime || 'application/octet-stream', chunks: [], recv: 0
        };
        state.transfers.unshift({
          id: m.id, kind: 'file', dir: 'in', name: m.name || '未命名',
          size: m.size || 0, done: 0, status: 'receiving', url: ''
        });
        paint();
        return;
      }

      if (m.t === 'end') {
        var ib = state.inbound;
        if (!ib) return;
        var blob = new Blob(ib.chunks, { type: ib.mime });
        var rec = findTransfer(ib.id);
        if (rec) {
          rec.status = 'done';
          rec.done = ib.size;
          rec.url = URL.createObjectURL(blob);
          rec.blob = blob;
        }
        state.inbound = null;
        paint();
        return;
      }

      if (m.t === 'text') {
        state.transfers.unshift({
          id: 'x' + (++seq), kind: 'text', dir: 'in', name: '文本',
          text: String(m.text || ''), status: 'done', size: (m.text || '').length
        });
        paint();
      }
      return;
    }

    /* 二进制分块 */
    var ib2 = state.inbound;
    if (!ib2) return;
    ib2.chunks.push(data);
    ib2.recv += data.byteLength;
    var r = findTransfer(ib2.id);
    if (r) r.done = ib2.recv;
    paintThrottled();
  }

  function findTransfer(id) {
    for (var i = 0; i < state.transfers.length; i++) {
      if (state.transfers[i].id === id) return state.transfers[i];
    }
    return null;
  }

  function sendFiles(files) {
    if (!state.dc || state.dc.readyState !== 'open') return;
    var list = Array.prototype.slice.call(files || []);
    var i = 0;
    function next() {
      if (i >= list.length) return;
      var f = list[i++];
      if (f.size > LS.MAX_FILE) {
        fail('「' + f.name + '」超过 2 GB，浏览器内存放不下。');
        return;
      }
      sendOne(f).then(next).catch(function (e) { fail('发送中断：' + (e && e.message || e)); });
    }
    next();
  }

  function sendOne(file) {
    var id = 'f' + (++seq);
    var rec = {
      id: id, kind: 'file', dir: 'out', name: file.name, size: file.size,
      done: 0, status: 'sending', url: '', mime: file.type
    };
    state.transfers.unshift(rec);
    paint();

    state.dc.send(JSON.stringify({
      t: 'meta', id: id, name: file.name, size: file.size,
      mime: file.type || 'application/octet-stream', kind: 'file'
    }));

    return sendChunks(file, rec).then(function () {
      state.dc.send(JSON.stringify({ t: 'end', id: id }));
      rec.status = 'done';
      rec.done = file.size;
      paint();
    });
  }

  function sendChunks(file, rec) {
    var offset = 0;
    return new Promise(function (resolve, reject) {
      function step() {
        if (offset >= file.size) return resolve();
        var dc = state.dc;
        if (!dc || dc.readyState !== 'open') return reject(new Error('连接已断开'));

        if (dc.bufferedAmount > LS.HIGH_WATER) {
          dc.onbufferedamountlow = function () {
            dc.onbufferedamountlow = null;
            step();
          };
          return;
        }
        var slice = file.slice(offset, offset + LS.CHUNK);
        slice.arrayBuffer().then(function (buf) {
          try { dc.send(buf); } catch (e) { return reject(e); }
          offset += buf.byteLength;
          rec.done = offset;
          paintThrottled();
          step();
        }).catch(reject);
      }
      step();
    });
  }

  function sendText(text) {
    var s = String(text || '').trim();
    if (!s || !state.dc || state.dc.readyState !== 'open') return;
    var id = 'x' + (++seq);
    state.dc.send(JSON.stringify({ t: 'meta', id: id, kind: 'text', text: s }));
    state.transfers.unshift({
      id: id, kind: 'text', dir: 'out', name: '文本', text: s,
      status: 'done', size: s.length
    });
    paint();
  }

  function teardown() {
    try { if (state.dc) state.dc.close(); } catch (e) {}
    try { if (state.pc) state.pc.close(); } catch (e) {}
    state.dc = null;
    state.pc = null;
  }

  function reset() {
    teardown();
    state.phase = 'idle';
    state.role = '';
    state.qrText = '';
    state.sas = '';
    state.note = '';
    state.error = '';
    state.inbound = null;
    state.transfers = [];
    paint();
  }

  /* ---------------- 界面 ---------------- */
  function phaseCard() {
    if (state.phase === 'idle') {
      return '<div class="panel ls__hero">' +
        '<div class="ls__hero-ic">' + T.ic('swap', '', 0) + '</div>' +
        '<h3>同一局域网，直接传</h3>' +
        '<p>文件在两台设备之间点对点传输，<b>不经过任何服务器</b>。' +
        '两端连同一个 Wi-Fi 即可，跨网段、开了客户端隔离的路由器不行。</p>' +
        '<div class="ls__hero-acts">' +
          '<button class="btn btn--primary" type="button" data-act="start">' + T.ic('swap', '', 0) + '发起传输</button>' +
        '</div>' +
        '<p class="ls__tip">已经有人发起？用手机<b>系统相机</b>扫对方屏幕上的二维码即可加入。</p>' +
      '</div>';
    }

    if (state.phase === 'starting') {
      return '<div class="panel ls__hero"><div class="ls__spin"></div><p>正在生成本机直连信息…</p></div>';
    }

    if (state.phase === 'hosting' || state.phase === 'joining') {
      var isHost = state.phase === 'hosting';
      /* 发起方要自己走两步；加入方扫完就已经在第二步上等着了 */
      var canR = scanReady();

      var steps = '<div class="ls__steps">' +
        '<span class="ls__step ' + (isHost ? (state.scanning ? 'is-done' : 'is-on') : 'is-done') + '">' +
          '① 对方扫这个码</span>' +
        '<span class="ls__step ' + (isHost ? (state.scanning ? 'is-on' : '') : 'is-on') + '">' +
          '② ' + (isHost ? '你读对方的屏' : '等对方扫你') + '</span>' +
      '</div>';

      var head, sub;
      if (isHost && state.scanning) {
        head = '正在读对方的码…';
        sub = '把对方屏幕上那块二维码对准摄像头，读到就自动连上。';
      } else if (isHost) {
        head = '第一步：让对方扫这个码';
        sub = '用另一台设备的<b>系统相机</b>扫下面这个码。它扫完会显示出自己的二维码 —— ' +
          '这一屏不会自己变，<b>还需要你手动做第二步</b>，见下方。';
      } else {
        head = '第二步：让发起方扫这个码';
        sub = '你扫过了，现在轮到对方。把这块屏幕对着发起方设备的摄像头；' +
          '对方没有摄像头的话，点下面「复制链接」发给他。';
      }

      var actArea;
      if (!isHost) {
        actArea = '<div class="ls__recv">' +
          '<div class="ls__recv-hd"><b>等发起方扫完，就会自动连上</b>' +
            '对方点了「用摄像头扫」并读到这块屏幕之后，两边会同时跳转，不用再点别的。</div>' +
        '</div>';
      } else if (state.scanning) {
        actArea = '<div class="ls__scan">' +
          '<video id="lsVideo" playsinline muted autoplay></video>' +
          '<div class="ls__scan-hint">把对方屏幕上的二维码对准摄像头</div>' +
          '<button class="btn btn--sm btn--ghost" type="button" data-act="stopscan">停止扫描</button>' +
        '</div>';
      } else {
        actArea = '<div class="ls__recv">' +
          '<div class="ls__recv-hd"><b>第二步：' + (canR ? '读对方的屏幕' : '把对方的链接搬过来') + '</b>' +
            (canR
              ? '可以先点开「用摄像头扫」，它会一直等着 —— 对方扫完显示二维码时自动读到就连接，不用再点。'
              : '这台设备没有摄像头。让对方在手机上点「复制链接」，用微信发给自己，再粘到下面。') +
          '</div>' +
          '<div class="ls__recv-acts">' +
            (canR
              ? '<button class="btn btn--sm btn--primary" type="button" data-act="scan">' +
                T.ic('image', '', 0) + '用摄像头扫</button>'
              : '') +
            (canClipPaste()
              ? '<button class="btn btn--sm" type="button" data-act="clippaste">' +
                T.ic('paste', '', 0) + '从剪贴板粘贴</button>'
              : '') +
          '</div>' +
          '<details class="ls__manual" id="lsManual">' +
            '<summary>手动粘贴链接</summary>' +
            '<textarea class="ta" id="lsPaste" rows="2" placeholder="把对方的链接粘到这里，点「连接」"></textarea>' +
            '<button class="btn btn--sm" type="button" data-act="applypaste">连接</button>' +
          '</details>' +
        '</div>';
      }

      return '<div class="panel ls__pair">' +
        steps +
        '<div class="ls__pair-hd">' +
          '<h3>' + head + '</h3>' +
          '<p>' + sub + '</p>' +
        '</div>' +
        (state.scanning
          ? ''
          : '<div class="ls__qr"><canvas id="lsQR" width="360" height="360"></canvas></div>' +
            '<div class="ls__link">' +
              '<input class="ls__link-in" id="lsLink" readonly value="' + esc(state.qrText) + '">' +
              '<button class="btn btn--sm" type="button" data-act="copylink">' + T.ic('copy', '', 0) + '复制链接</button>' +
            '</div>') +
        actArea +
        '<button class="btn btn--sm btn--ghost" type="button" data-act="reset">取消</button>' +
      '</div>';
    }

    if (state.phase === 'connecting') {
      return '<div class="panel ls__hero"><div class="ls__spin"></div><p>' +
        esc(state.note || '正在建立直连…') + '</p></div>';
    }

    if (state.phase === 'connected') {
      return '<div class="panel ls__ok">' +
        '<div class="ls__ok-hd">' + T.ic('check', '', 0) + '<b>已直连</b>' +
          '<span class="tag tag--sage">DTLS 加密</span></div>' +
        '<div class="ls__sas">' +
          '<span class="ls__sas-lb">安全码</span>' +
          '<b class="ls__sas-num">' + esc(LS.sasPretty(state.sas)) + '</b>' +
          '<span class="ls__sas-hint">两台设备显示一致才说明没有人插在中间</span>' +
        '</div>' +
      '</div>';
    }

    if (state.phase === 'closed') {
      return '<div class="panel ls__hero">' +
        '<div class="ls__hero-ic ls__hero-ic--off">' + T.ic('link', '', 0) + '</div>' +
        '<h3>连接已结束</h3><p>' + esc(state.note || state.error || '对方已断开') + '</p>' +
        '<button class="btn btn--primary" type="button" data-act="reset">重新开始</button>' +
      '</div>';
    }

    return '';
  }

  function transferPanel() {
    if (state.phase !== 'connected') return '';
    return '<div class="panel ls__send">' +
      '<div class="panel__hd"><h3>' + T.ic('upload', '', 0) + '发送</h3></div>' +
      '<div class="panel__bd">' +
        '<div class="ls__drop" id="lsDrop">' +
          '<b>把文件拖进来，或</b>' +
          '<button class="btn btn--sm" type="button" data-act="pick">选择文件</button>' +
          '<input type="file" id="lsFile" multiple hidden>' +
        '</div>' +
        '<div class="ls__text">' +
          '<textarea class="ta" id="lsText" rows="2" placeholder="也可以直接发一段文本（链接、密码、地址…）"></textarea>' +
          '<button class="btn btn--sm" type="button" data-act="sendtext">发送文本</button>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="panel ls__list">' +
      '<div class="panel__hd"><h3>' + T.ic('history', '', 0) + '传输记录</h3></div>' +
      '<div class="panel__bd">' + listHTML() + '</div>' +
    '</div>';
  }

  function listHTML() {
    if (!state.transfers.length) {
      return '<p class="note">还没有传输记录。连接是点对点的，关掉页面记录就没了。</p>';
    }
    return '<div class="ls__items">' + state.transfers.map(function (r) {
      var pct = r.size ? Math.min(100, Math.round(r.done / r.size * 100)) : 0;
      var isText = r.kind === 'text';
      var right = '';
      if (isText) {
        right = '<button class="btn btn--sm btn--icon btn--ghost" type="button" data-act="copytext" data-id="' + esc(r.id) + '" title="复制">' +
          T.ic('copy', '', 0) + '</button>';
      } else if (r.dir === 'in' && r.url) {
        right = '<a class="btn btn--sm" href="' + esc(r.url) + '" download="' + esc(r.name) + '">' +
          T.ic('download', '', 0) + '保存</a>';
      }
      return '<div class="ls__item">' +
        '<div class="ls__item-hd">' +
          '<span class="ls__dir">' + (r.dir === 'in' ? '收' : '发') + '</span>' +
          '<b class="ls__name" title="' + esc(r.name) + '">' + esc(r.name) + '</b>' +
          '<span class="ls__size">' + (isText ? '文本' : LS.fmtSize(r.size)) + '</span>' +
          right +
        '</div>' +
        (isText
          ? '<pre class="ls__textbody">' + esc(r.text) + '</pre>'
          : '<div class="ls__bar"><i style="width:' + (r.status === 'done' ? 100 : pct) + '%"></i></div>' +
            '<div class="ls__meta">' + (r.status === 'done' ? '已完成' : pct + '%') +
            (r.dir === 'out' ? ' · 已发出' : '') + '</div>') +
      '</div>';
    }).join('') + '</div>';
  }

  function viewHTML() {
    var banner = state.error
      ? '<div class="ls__err">' + T.ic('warn', '', 0) + '<span>' + esc(state.error) + '</span>' +
        '<button class="btn btn--sm btn--ghost" type="button" data-act="reset">重来</button></div>'
      : '';

    return '<div class="ls">' +
      '<div class="ls__intro">' +
        '<div class="ls__badges">' +
          '<span class="tag tag--accent">' + T.ic('shield', '', 0) + 'DTLS 加密</span>' +
          '<span class="tag">不经过服务器</span>' +
          '<span class="tag tag--sage">SAS 核验</span>' +
        '</div>' +
      '</div>' +
      banner +
      '<div class="ls__flow">' +
        phaseCard() +
        transferPanel() +
      '</div>' +
      '<div class="pagefoot">' +
        '文件只在两台设备之间流动，本工具没有服务器，也没有任何上传接口；' +
        '连接仅使用本地/私网候选，不走 TURN 中继。关闭页面后传输记录即清空。' +
      '</div>' +
    '</div>';
  }

  function drawQR() {
    if (!state.qrText) return;
    var c = hostEl && hostEl.querySelector('#lsQR');
    if (!c || !QR) return;
    try {
      QR.draw(c, state.qrText, { quiet: 3, scale: 8 });
      c.style.width = '100%';
      c.style.height = 'auto';
    } catch (e) { /* 内容过长等，链接仍然可复制 */ }
  }

  /* ---------------- 事件 ---------------- */
  function bindOnce() {
    drawQR();
    if (state.phase === 'connected' && hostEl) {
      var fi = hostEl.querySelector('#lsFile');
      if (fi && !fi.__bound) {
        fi.__bound = true;
        fi.addEventListener('change', function () {
          sendFiles(fi.files);
          fi.value = '';
        });
      }
      var drop = hostEl.querySelector('#lsDrop');
      if (drop && !drop.__bound) {
        drop.__bound = true;
        ['dragover', 'dragenter'].forEach(function (t) {
          drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('is-over'); });
        });
        ['dragleave', 'drop'].forEach(function (t) {
          drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.remove('is-over'); });
        });
        drop.addEventListener('drop', function (e) {
          if (e.dataTransfer && e.dataTransfer.files) sendFiles(e.dataTransfer.files);
        });
      }
    }
  }

  function onClick(e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var act = b.getAttribute('data-act');

    if (act === 'start') return startHost();
    if (act === 'reset') return reset();

    if (act === 'copylink') {
      T.copyText(state.qrText).then(function () {
        T.toast('链接已复制', { icon: 'check', ms: 1600 });
      }).catch(function () { T.toast('复制失败，请手动选中', { icon: 'warn' }); });
      return;
    }
    if (act === 'scan') return startScan();
    if (act === 'stopscan') return stopScan();

    if (act === 'clippaste') {
      if (!canClipPaste()) return T.toast('这个浏览器读不了剪贴板', { icon: 'warn' });
      navigator.clipboard.readText().then(function (t) {
        if (!payloadFrom(t)) {
          return T.toast('剪贴板里没有配对链接', { icon: 'warn', ms: 2600 });
        }
        applyFromUrl(t);
      }).catch(function () {
        T.toast('读不到剪贴板，展开「手动粘贴链接」试试', { icon: 'warn', ms: 3200 });
      });
      return;
    }

    if (act === 'applypaste') {
      var ta = hostEl.querySelector('#lsPaste');
      var v = ta ? ta.value.trim() : '';
      if (!v) return T.toast('先粘贴对方的链接', { icon: 'warn' });
      return applyFromUrl(v);
    }
    if (act === 'pick') {
      var fi = hostEl.querySelector('#lsFile');
      if (fi) fi.click();
      return;
    }
    if (act === 'sendtext') {
      var t = hostEl.querySelector('#lsText');
      if (t) { sendText(t.value); t.value = ''; }
      return;
    }
    if (act === 'copytext') {
      var id = b.getAttribute('data-id');
      var rec = findTransfer(id);
      if (rec) T.copyText(rec.text).then(function () {
        T.toast('已复制', { icon: 'check', ms: 1500 });
      });
    }
  }

  /* ---------------- 注册 ---------------- */
  T.register('lanshare', {
    render: function (host) {
      LS = T.LanShare;
      QR = T.QR;
      QRDec = T.QRDec;
      hostEl = host;

      if (!LS || !QR) {
        host.innerHTML = '<div class="capmsg">' + T.ic('warn', '', 0) +
          '<div><b>传输模块没有加载成功。</b>请刷新页面重试。</div></div>';
        return;
      }

      host.innerHTML = viewHTML();
      bindOnce();
      host.onclick = onClick;

      /* 从二维码链接进来：自动认领 offer 或 answer */
      var payload = readIncoming();
      if (payload && !state.consumed) {
        state.consumed = true;
        clearIncoming();
        /* URLSearchParams 已经解过码，这里直接用 —— base64url 里没有 % 转义 */
        LS.unpack(payload).then(function (obj) {
          if (obj.k === 'offer') return joinWith(payload);
          if (obj.k === 'answer') return applyAnswer(payload);
          throw new Error('配对信息类型未知');
        }).catch(function (err) {
          fail(err && err.message || '配对信息无法识别');
        });
      }
    },

    onLeave: function () {
      stopScan();
      teardown();
      state.consumed = false;
      hostEl = null;
    }
  });
})(window.Toolbox);
