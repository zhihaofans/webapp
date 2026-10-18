/* ============================================================
   自研二维码解码器的闭环用例：node test/qrdec.test.js

   为什么能这么测：编码器（lib/qr.js）和解码器（lib/qrdec.js）都在仓库里，
   于是可以「编码 → 渲染成像素 → 解码 → 比对原文」跑完整闭环，不需要摄像头。

   重点覆盖的是**真实拍摄会遇到的那几种劣化**，而不是只喂一张干净图：
     · 缩放（模块不是整像素）
     · 高斯模糊（对焦不准）
     · 亮度渐变（屏幕反光、环境光不均）
     · 高斯噪声（弱光高 ISO）
     · 透视（手机屏幕斜对着笔记本摄像头）
     · 码字被破坏（验证 RS 纠错真的在纠）

   真机摄像头下的表现还是要人拿手机对一下；这里保证的是算法本身不走偏。
   ============================================================ */
'use strict';

var QREnc = require('../js/lib/qr.js');
var QRDec = require('../js/lib/qrdec.js');

var pass = 0, fail = 0;
function check(name, got, want) {
  var ok = got === want;
  ok ? pass++ : fail++;
  console.log('  %s %s', ok ? 'ok  ' : 'FAIL', name);
  if (!ok) {
    console.log('        期望: %s', String(want).slice(0, 90));
    console.log('        实际: %s', String(got).slice(0, 90));
  }
}
function section(t) { console.log('\n── ' + t + ' ──'); }

/* ---------------- 渲染：矩阵 → RGBA 像素 ---------------- */
function render(m, opt) {
  opt = opt || {};
  var quiet = opt.quiet == null ? 4 : opt.quiet;
  var scale = opt.scale || 4;
  var total = m.size + quiet * 2;
  var w = Math.round(total * scale), h = w;
  var data = new Uint8ClampedArray(w * h * 4);

  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var mx = Math.floor(x / scale) - quiet;
      var my = Math.floor(y / scale) - quiet;
      var dark = (mx >= 0 && my >= 0 && mx < m.size && my < m.size)
        ? m.data[my * m.size + mx] : 0;
      var v = dark ? 18 : 245;
      var p = (y * w + x) * 4;
      data[p] = data[p + 1] = data[p + 2] = v;
      data[p + 3] = 255;
    }
  }
  return { width: w, height: h, data: data };
}

/* 亮度渐变：模拟屏幕一侧反光 */
function shade(img, lo, hi) {
  var w = img.width, h = img.height, d = img.data;
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var k = lo + (hi - lo) * (x / w);
      var p = (y * w + x) * 4;
      for (var c = 0; c < 3; c++) d[p + c] = Math.max(0, Math.min(255, d[p + c] * k));
    }
  }
  return img;
}

/* 3x3 高斯模糊，模拟对焦不准 */
function blur(img) {
  var w = img.width, h = img.height, d = img.data;
  var out = new Uint8ClampedArray(d.length);
  var k = [1, 2, 1, 2, 4, 2, 1, 2, 1];
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var s = 0, wsum = 0;
      for (var dy = -1; dy <= 1; dy++) {
        for (var dx = -1; dx <= 1; dx++) {
          var yy = y + dy, xx = x + dx;
          if (yy < 0 || yy >= h || xx < 0 || xx >= w) continue;
          var kk = k[(dy + 1) * 3 + (dx + 1)];
          s += d[(yy * w + xx) * 4] * kk;
          wsum += kk;
        }
      }
      var v = s / wsum;
      var p = (y * w + x) * 4;
      out[p] = out[p + 1] = out[p + 2] = v;
      out[p + 3] = 255;
    }
  }
  return { width: w, height: h, data: out };
}

/* 固定种子的伪随机噪声，保证可复现 */
function noise(img, amp, seed) {
  var s = seed || 12345;
  function rnd() { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }
  var d = img.data;
  for (var p = 0; p < d.length; p += 4) {
    var n = (rnd() - 0.5) * amp;
    for (var c = 0; c < 3; c++) d[p + c] = Math.max(0, Math.min(255, d[p + c] + n));
  }
  return img;
}

/* 透视：用真的单应变换重采样，模拟斜着拍。
   （早先版本用的是 u*(1-kx+kx*v) 这种双线性映射 —— 它不是投影变换，
     单应矩阵本来就不该拟合它，用例本身是错的，一度让人误以为解码器不行。） */
function perspective(img, kx) {
  var w = img.width, h = img.height, d = img.data;
  var out = new Uint8ClampedArray(d.length);

  var srcC = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
  var dstC = [[kx * (w - 1), 0], [(1 - kx) * (w - 1), 0], [0, h - 1], [w - 1, h - 1]];
  /* 需要「目标像素 → 源像素」，所以把两角的顺序反过来求 */
  var H = QRDec._internals.homography(dstC, srcC);
  if (!H) throw new Error('透视矩阵求解失败');

  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var p = QRDec._internals.applyH(H, x, y);
      var dp = (y * w + x) * 4;
      var sx = p ? Math.round(p.x) : -1;
      var sy = p ? Math.round(p.y) : -1;
      var v = 245;                       /* 采样不到的位置按静区白处理 */
      if (sx >= 0 && sx < w && sy >= 0 && sy < h) {
        v = d[(sy * w + sx) * 4];
      }
      out[dp] = out[dp + 1] = out[dp + 2] = v;
      out[dp + 3] = 255;
    }
  }
  return { width: w, height: h, data: out };
}

function decodeImg(img) {
  var r = QRDec.decode(img);
  return r ? r.text : null;
}

/* ---------------- 用例 ---------------- */
console.log('二维码解码器 · 闭环用例');

section('干净渲染');
(function () {
  var cases = [
    'https://example.com/?ls=LS1z.short',
    'LS1z.' + 'A'.repeat(120)
  ];
  for (var i = 0; i < cases.length; i++) {
    var m = QREnc.matrix(cases[i]);
    var got = decodeImg(render(m, { scale: 4 }));
    check('scale=4 往返（v' + m.version + '，' + cases[i].length + ' 字符）', got, cases[i]);
  }
})();

section('真实配对载荷（SDP 压缩后的量级）');
(function () {
  var payload = 'LS1z.' + (function () {
    var s = '', a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    for (var i = 0; i < 520; i++) s += a.charAt((i * 7 + 13) % 64);
    return s;
  })();
  var m = QREnc.matrix(payload);
  var got = decodeImg(render(m, { scale: 3 }));
  check('520 字符载荷往返（v' + m.version + '）', got, payload);
})();

section('劣化：缩放 / 模糊 / 亮度 / 噪声');
(function () {
  var text = 'LS1z.zoom-test-' + 'x'.repeat(200);
  var m = QREnc.matrix(text);

  check('非整数倍缩放 scale=3.6', decodeImg(render(m, { scale: 3.6 })), text);
  check('小尺寸 scale=2.5', decodeImg(render(m, { scale: 2.5 })), text);
  check('高斯模糊', decodeImg(blur(render(m, { scale: 4 }))), text);
  check('亮度渐变 0.75→1.0', decodeImg(shade(render(m, { scale: 4 }), 0.75, 1.0)), text);
  check('噪声 ±40', decodeImg(noise(render(m, { scale: 4 }), 40, 777)), text);
  check('模糊+渐变+噪声', decodeImg(
    noise(shade(blur(render(m, { scale: 4 })), 0.8, 1.0), 30, 4242)), text);
})();

section('劣化：透视');
(function () {
  var text = 'LS1z.persp-' + 'y'.repeat(120);
  var m = QREnc.matrix(text);
  check('轻度透视 kx=0.10', decodeImg(perspective(render(m, { scale: 5 }), 0.10)), text);
})();

section('真实取景：码只占画面一部分');
(function () {
  /* 笔记本摄像头画面 800x600，手机屏幕上的码大概占三分之一到一半。
     这里按比例把码贴进大画面，验证「模块只有 3px」时还能不能读。 */
  function frame(m, cw, ch, frac) {
    var qw = Math.round(cw * frac);
    var sc = qw / (m.size + 8);
    var w = Math.round((m.size + 8) * sc);
    var data = new Uint8ClampedArray(cw * ch * 4);
    for (var i = 0; i < data.length; i += 4) {
      data[i] = data[i + 1] = data[i + 2] = 200;
      data[i + 3] = 255;
    }
    var ox = Math.round((cw - w) / 2), oy = Math.round((ch - w) / 2);
    for (var y = 0; y < w; y++) {
      for (var x = 0; x < w; x++) {
        var mx = Math.floor(x / sc) - 4, my = Math.floor(y / sc) - 4;
        var dark = (mx >= 0 && my >= 0 && mx < m.size && my < m.size)
          ? m.data[my * m.size + mx] : 0;
        var v = dark ? 20 : 240;
        var p = ((oy + y) * cw + (ox + x)) * 4;
        data[p] = data[p + 1] = data[p + 2] = v;
      }
    }
    return { width: cw, height: ch, data: data };
  }

  var payload = 'LS1z.' + 'A'.repeat(520);
  var mm = QREnc.matrix(payload);
  var fracs = [0.6, 0.45, 0.33];
  for (var i = 0; i < fracs.length; i++) {
    var f = fracs[i];
    var got = decodeImg(frame(mm, 800, 600, f));
    check('画面占比 ' + Math.round(f * 100) + '% 仍可解（模块约 ' +
      (800 * f / (mm.size + 8)).toFixed(1) + 'px）', got, payload);
  }
})();

section('RS 纠错：故意破坏码字');
(function () {
  var text = 'LS1z.rs-test-' + 'z'.repeat(150);
  var m = QREnc.matrix(text);
  var img = render(m, { scale: 4 });

  /* 在数据区拍几个白块上去，模拟局部污损 */
  var w = img.width, d = img.data;
  var hits = 0;
  for (var n = 0; n < 3; n++) {
    var bx = Math.floor(w * (0.3 + n * 0.15));
    var by = Math.floor(w * (0.55 + n * 0.08));
    for (var y = by; y < by + 6 && y < w; y++) {
      for (var x = bx; x < bx + 6 && x < w; x++) {
        var p = (y * w + x) * 4;
        d[p] = d[p + 1] = d[p + 2] = 245;
      }
    }
    hits++;
  }
  check('3 处污损仍能解出', decodeImg(img), text);
})();

section('边界');
(function () {
  check('空对象返回 null', QRDec.decode({}), null);
  check('尺寸过小返回 null', QRDec.decode({ width: 10, height: 10, data: new Uint8ClampedArray(400) }), null);
  check('纯白图返回 null', QRDec.decode(render({ size: 21, data: new Uint8Array(441) }, { scale: 4 })), null);
})();

console.log('\n==============================================');
console.log('结果: %d 通过 / %d 失败', pass, fail);
process.exit(fail ? 1 : 0);
