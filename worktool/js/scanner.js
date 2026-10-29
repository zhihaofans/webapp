/* ============================================================
   scanner.js — 摄像头扫码（局域网传输 / 二维码工具共用）

   两个工具有同一个需求：把摄像头画面取回来，一帧一帧找二维码，
   找到就停。差别只在「找到之后做什么」，所以这里只做取景与识别，
   结果通过 onResult 交回调用方。

   两条解码路径：
     · 系统自带 BarcodeDetector（Safari 17+ / macOS 与 ChromeOS 的 Chrome）
     · 自研 qrdec.js（其它 Chrome / Edge / Firefox）—— 桌面端 BarcodeDetector
       只覆盖 ChromeOS 与 macOS，Windows / Linux 的 Chrome 有摄像头却用不了，
       所以必须有兜底。

   这个模块碰 DOM 与 getUserMedia，所以放在 js/ 根层（与 shell.js 同级），
   不进 js/lib/ —— lib 的约定是纯逻辑、node 可直接跑。
   ============================================================ */
(function (T) {
  'use strict';

  function nativeDetector() {
    return typeof window.BarcodeDetector === 'function';
  }
  function getUserMedia() {
    return navigator.mediaDevices && navigator.mediaDevices.getUserMedia
      ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices) : null;
  }
  function canScan() {
    if (!getUserMedia()) return false;
    return nativeDetector() || !!(T.QRDec && T.QRDec.ready);
  }

  /* 「支持扫码 API」和「真的有摄像头」是两件事：台式机/部分笔记本有前者没后者，
     点了 getUserMedia 才报错。先问设备列表；未授权时部分浏览器返回空表，按「有」处理。 */
  function hasCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
      return Promise.resolve(canScan());
    }
    return navigator.mediaDevices.enumerateDevices().then(function (list) {
      if (!list || !list.length) return canScan();
      for (var i = 0; i < list.length; i++) {
        if (list[i].kind === 'videoinput') return true;
      }
      return false;
    }).catch(function () { return canScan(); });
  }

  /* 抽帧：视频帧画到离屏 canvas → getImageData，交给解码器 */
  function makeGrabber() {
    if (typeof document === 'undefined') return null;
    var cv = document.createElement('canvas');
    var cx = cv.getContext && cv.getContext('2d', { willReadFrequently: true });
    if (!cx) return null;
    return function (video, maxW) {
      var vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh) return null;
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

  /* opt: { video, onResult({text, version, ecl, how}), onError(msg),
            onStart(), onStop() } */
  function create(opt) {
    opt = opt || {};
    var video = opt.video || null;
    var onResult = opt.onResult || function () {};
    var onError = opt.onError || function () {};
    var onStart = opt.onStart || function () {};
    var onStop = opt.onStop || function () {};

    var stream = null, timer = null, watchdog = null, detector = null, grab = null;
    var running = false;

    function release() {
      if (watchdog) { clearTimeout(watchdog); watchdog = null; }
      if (timer) { clearInterval(timer); timer = null; }
      if (stream) {
        try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) { /* 忽略 */ }
        stream = null;
      }
      if (video) {
        try { video.srcObject = null; } catch (e) { /* 忽略 */ }
      }
      running = false;
    }

    function stop() {
      if (!running && !timer && !stream) return;
      var was = running;
      release();
      if (was) onStop();
    }

    function hit(res) {
      if (!running) return;
      stop();
      onResult(res);
    }

    var lastSelf = 0;
    var sizeIx = 0;
    var SIZES = [800, 480];

    /* 自研解码整条链路是同步的，间隔放长一点，别把主线程占满、让取景卡住。
       800 / 480 两档轮换：码在画面里占比大时，缩得小一点反而更好认。 */
    function selfTick(force) {
      if (!grab) return;
      var now = Date.now();
      if (!force && now - lastSelf < 450) return;
      lastSelf = now;
      var maxW = SIZES[sizeIx++ % SIZES.length];
      var img = grab(video, maxW);
      if (!img) return;
      var r = null;
      try { r = T.QRDec.decode(img); } catch (e) { r = null; }
      if (r && r.text) hit({ text: r.text, version: r.version, ecl: r.ecl, how: 'self' });
    }

    function tick() {
      if (!running || !video || !video.videoWidth) return;

      if (detector) {
        detector.detect(video).then(function (codes) {
          if (!running) return;
          if (codes && codes.length) {
            hit({ text: codes[0].rawValue || '', how: 'native' });
            return;
          }
          /* 原生没结果不等于没有码：桌面端/部分 WebView 的 BarcodeDetector
             会一直返回空，甚至直接 reject。静默吞掉就成了「一直扫不出来」，
             所以每次空结果都让自研解码补一枪（限频，避免每帧都跑全量）。 */
          selfTick(false);
        }).catch(function () {
          /* 原生 API 在运行时不可用：彻底退回自研，不要每帧再试一次 */
          detector = null;
          if (!grab) grab = makeGrabber();
          selfTick(true);
        });
        return;
      }

      selfTick(true);
    }

    function start() {
      if (running) return true;
      if (!canScan()) { onError('这台设备用不了摄像头'); return false; }
      if (!video) { onError('取景框没有准备好'); return false; }

      running = true;
      detector = null;
      if (nativeDetector()) {
        try { detector = new window.BarcodeDetector({ formats: ['qr_code'] }); }
        catch (e) { detector = null; }
      }
      grab = makeGrabber();

      /* 先要好一点的画面：分辨率高、连续对焦，扫码成功率高得多。
         WebView 对不认识的约束会整体拒绝（OverconstrainedError），那就退回最简约束再要一次。 */
      var constraints = {
        audio: false,
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 },
          advanced: [{ focusMode: 'continuous' }]
        }
      };
      var simple = { audio: false, video: { facingMode: 'environment' } };
      var ask = getUserMedia()(constraints).catch(function () {
        return getUserMedia()(simple);
      });
      ask
        .then(function (s) {
          if (!running) { s.getTracks().forEach(function (t) { t.stop(); }); return; }
          stream = s;
          video.srcObject = s;
          video.setAttribute('playsinline', '');
          video.play().catch(function () { /* 自动播放被拦时用户手点即可 */ });
          onStart();
          /* 权限给了、流也接了，但一直没画面（被别的应用占用、系统没真正给摄像头、
             或者自动播放被拦）—— 不能就这么干等，6 秒后明说。 */
          watchdog = setTimeout(function () {
            watchdog = null;
            if (!running) return;
            if (!video || !video.videoWidth) {
              release();
              onError('摄像头已授权但没有画面：可能被别的应用占用，或系统没把画面交给浏览器。');
            }
          }, 6000);
          timer = setInterval(tick, detector ? 280 : 260);
        })
        .catch(function (e) {
          release();
          onError('打不开摄像头：' + ((e && e.name) === 'NotAllowedError'
            ? '没有给摄像头权限（系统弹窗里点了拒绝，或浏览器设置里关掉了）。'
            : (e && e.name) === 'NotReadableError'
              ? '摄像头被别的应用占用，先关掉相机应用再试。'
              : (e && e.message || '设备不可用')));
        });

      return true;
    }

    return {
      start: start,
      stop: stop,
      isRunning: function () { return running; }
    };
  }

  T.Scanner = {
    create: create,
    canScan: canScan,
    hasCamera: hasCamera,
    native: nativeDetector
  };
})(window.Toolbox);
