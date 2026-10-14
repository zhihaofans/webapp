/* ============================================================
   worker/webpenc.worker.js — WebP 编码 Worker（module worker）

   为什么必须放 Worker：libwebp 的 method=6 编一张 1600×1200 的图要
   400~500ms，编一张 4000 万像素的大图更久。放在主线程就是整整半秒的
   界面冻结，批量转十张就是五秒卡死、进度条都不动。放进 Worker 后
   主线程只管收结果，进度和取消都能正常响应。

   为什么是 module worker：emscripten 的胶水是 ESM（用 import.meta.url
   定位同目录的 .wasm），只能靠动态 import() 加载。经典 Worker 的
   importScripts 读不了 ESM。

   两条编码路线由主线程指定：
     lossless=1  → 无损 / 近无损（图形、截图、UI 图）
     lossless=0  → 有损，method=6（照片）
   ============================================================ */

/* struct WebPConfig 的全部字段。libwebp 的 embind 绑定是「整套结构体」
   式的，缺任何一个字段都会直接抛 "Missing field"，所以必须给全。 */
var DEF = {
  quality: 75, target_size: 0, target_PSNR: 0, method: 4,
  sns_strength: 50, filter_strength: 60, filter_sharpness: 0, filter_type: 1,
  partitions: 0, segments: 4, pass: 1, show_compressed: 0, preprocessing: 0,
  autofilter: 0, partition_limit: 0, alpha_compression: 1, alpha_filtering: 1,
  alpha_quality: 100, lossless: 0, exact: 0, image_hint: 0,
  emulate_jpeg_size: 0, thread_level: 0, low_memory: 0, near_lossless: 100,
  use_delta_palette: 0, use_sharp_yuv: 0
};

/* SIMD 探测：一段极小的合法 SIMD 模块，能通过校验就说明运行时支持。
   支持就加载 SIMD 版 wasm（快 2~3 倍，代价是多 12 KB），
   不支持就退回通用版。 */
function hasSimd() {
  try {
    return WebAssembly.validate(new Uint8Array([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123,
      3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11
    ]));
  } catch (e) {
    return false;
  }
}

var loaded = null;      /* { mod, simd } —— 两个调用点都从这里取，别只存 instance */
var loading = null;

function load() {
  if (loaded) return Promise.resolve(loaded);
  if (loading) return loading;
  var simd = hasSimd();
  var url = simd
    ? '../../assets/wasm/webp_enc_simd.js'
    : '../../assets/wasm/webp_enc.js';
  loading = import(url).then(function (m) {
    return m.default({ noInitialRun: true });
  }).then(function (instance) {
    loaded = { mod: instance, simd: simd };
    return loaded;
  });
  return loading;
}

self.onmessage = function (e) {
  var d = e.data || {};

  if (d.type === 'init') {
    load().then(function (r) {
      self.postMessage({ type: 'ready', simd: r.simd });
    }).catch(function (err) {
      self.postMessage({ type: 'init-error', message: String(err && err.message || err) });
    });
    return;
  }

  if (d.type !== 'encode') return;

  load().then(function (r) {
    var opt = {};
    for (var k in DEF) opt[k] = DEF[k];
    if (d.opt) for (var j in d.opt) opt[j] = d.opt[j];

    var t0 = performance.now();
    var out = r.mod.encode(new Uint8ClampedArray(d.data), d.width, d.height, opt);
    if (!out) throw new Error('编码器没有返回结果');

    /* encode() 返回的是 Uint8Array，不是 ArrayBuffer；而且这个视图指向
       wasm 的一大块线性内存。直接 transfer 会报「不是可转移类型」，
       直接 postMessage 又得把整块 wasm 内存序列化过去。
       所以先 slice 出精确大小的副本，再转移它的 buffer。 */
    var view = out instanceof Uint8Array ? out : new Uint8Array(out.buffer || out);
    var copy = view.slice();

    self.postMessage({
      type: 'done',
      id: d.id,
      buffer: copy.buffer,
      ms: Math.round(performance.now() - t0)
    }, [copy.buffer]);
  }).catch(function (err) {
    self.postMessage({
      type: 'error',
      id: d.id,
      message: String(err && err.message || err)
    });
  });
};
