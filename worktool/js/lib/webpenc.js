/* ============================================================
   lib/webpenc.js — WebP 编码（libwebp 编译成 WASM）

   为什么要有这一层：
   浏览器 Canvas 的 toBlob('image/webp') 背后其实就是 libwebp，但只暴露
   一个 quality，method 之类的参数一律锁死。实测同一张照片同样 quality，
   把 method 从默认的 4 提到 6 就能再小 15%；更要紧的是 Canvas **没有无损
   模式** —— 而对截图、UI 图、图表这类颜色少的图，libwebp 的无损输出比
   Canvas 的有损还小（实测 -36%），画质还是完美的。
   顺带解决一个老问题：Safari / iOS 的 Canvas 不能编码 WebP，走 WASM
   自带编码器就不再受这个限制。

   体积与加载：只托管 encoder，不要 decoder（浏览器自己能解码）。
   两个版本按运行时 SIMD 支持二选一，实际单次下载约 121 KB（gzip）。
   只在打开图片转换工具时才拉，不进首屏；拉过一次就进 SW 缓存。

   降级：任何环节出问题（不支持 module worker、wasm 加载失败、编码报错）
   都如实标记出来，交由调用方回退到 Canvas 路径，不静默失败。
   ============================================================ */
(function (T) {
  'use strict';

  var WORKER_URL = 'js/worker/webpenc.worker.js';
  var INIT_TIMEOUT = 25000;    /* wasm 加载上限，超时即判定不可用 */

  var state = 'idle';          /* idle | loading | ok | failed */
  var failReason = '';
  var worker = null;
  var simd = false;
  var seq = 0;
  var pending = {};
  var waiters = [];
  var initTimer = null;

  /* 静态能力判断：只要有 WebAssembly 和 Worker 就先乐观认为可用。
     module worker 的支持没法可靠地「只检测不创建」，所以放到 start()
     里实际创建时再判 —— 那时失败会走降级，不会卡住界面。 */
  function supported() {
    return typeof WebAssembly === 'object' && typeof Worker === 'function';
  }

  function settle(next, reason) {
    if (state === 'ok' || state === 'failed') return;
    state = next;
    failReason = reason || '';
    if (initTimer) { clearTimeout(initTimer); initTimer = null; }
    var list = waiters.splice(0);
    list.forEach(function (fn) { fn(next); });
  }

  function failAll(reason) {
    Object.keys(pending).forEach(function (id) {
      try { pending[id].reject(new Error(reason)); } catch (e) {}
      delete pending[id];
    });
  }

  function onMessage(e) {
    var d = e.data || {};

    if (d.type === 'ready') { simd = !!d.simd; settle('ok'); return; }
    if (d.type === 'init-error') { settle('failed', d.message || '编码器初始化失败'); return; }

    var p = pending[d.id];
    if (!p) return;
    delete pending[d.id];
    if (d.type === 'done') p.resolve({ buffer: d.buffer, ms: d.ms });
    else p.reject(new Error(d.message || '编码失败'));
  }

  function onWorkerFail() {
    var reason = '编码器意外退出';
    failAll(reason);
    settle('failed', reason);
  }

  function start() {
    if (state !== 'idle') return;
    state = 'loading';
    try {
      worker = new Worker(WORKER_URL, { type: 'module' });
    } catch (e) {
      settle('failed', '当前浏览器不支持 module worker');
      return;
    }
    worker.onmessage = onMessage;
    worker.onerror = onWorkerFail;
    worker.onmessageerror = onWorkerFail;
    worker.postMessage({ type: 'init' });
    initTimer = setTimeout(function () {
      settle('failed', '编码器加载超时');
    }, INIT_TIMEOUT);
  }

  /* 幂等：第一次调用开始加载，重复调用只是等同一个结果 */
  function whenReady() {
    if (state === 'ok') return Promise.resolve(true);
    if (state === 'failed') return Promise.reject(new Error(failReason || '编码器不可用'));
    if (state === 'idle') start();
    return new Promise(function (resolve, reject) {
      waiters.push(function (s) {
        if (s === 'ok') resolve(true);
        else reject(new Error(failReason || '编码器不可用'));
      });
    });
  }

  /* 预热：打开图片转换工具时调用，让 wasm 在用户挑图的时候就下好 */
  function warmup() {
    if (!supported()) { settle('failed', '当前浏览器缺少 WebAssembly 或 Worker'); return; }
    whenReady().catch(function () { /* 失败由调用方在 encode 时感知 */ });
  }

  /* 编码。
     返回 { buffer: ArrayBuffer, ms }
     说明：内部会拷贝一份像素再交给 Worker —— ImageData 的原 buffer 若被
     transfer 走就会失效，而编码失败时调用方还要拿它回退 Canvas。 */
  function encode(imageData, opt) {
    var o = opt || {};
    return whenReady().then(function () {
      return new Promise(function (resolve, reject) {
        var id = ++seq;
        pending[id] = { resolve: resolve, reject: reject };

        var conf = {
          lossless: o.lossless ? 1 : 0,
          method: 6,                       /* 最慢但最小的一档 */
          quality: Math.max(0, Math.min(100, Math.round(
            o.quality == null ? 82 : o.quality))),
          exact: 0
        };
        if (o.lossless && o.nearLossless != null) {
          conf.near_lossless = Math.max(0, Math.min(100, Math.round(o.nearLossless)));
        }

        var copy = imageData.data.slice();
        worker.postMessage({
          type: 'encode',
          id: id,
          data: copy.buffer,
          width: imageData.width,
          height: imageData.height,
          opt: conf
        }, [copy.buffer]);
      });
    });
  }

  /* 离开工具页时调用：把还在排队的请求全部作废，不重建 Worker
     （wasm 已经驻留，回来时直接可用） */
  function abort() {
    failAll('已取消');
  }

  T.WebpEnc = {
    supported: supported,
    status: function () { return state; },
    reason: function () { return failReason; },
    simd: function () { return simd; },
    warmup: warmup,
    whenReady: whenReady,
    encode: encode,
    abort: abort
  };
})(window.Toolbox);
