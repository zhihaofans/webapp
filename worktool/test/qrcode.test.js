/* ============================================================
   编码 ↔ 解码闭环用例：node test/qrcode.test.js

   二维码工具把「生成」和「识别」摆在了同一个页面上，于是这两条链路
   必须自洽：本工具生成的码，本工具的识别必须能读回来。真机上当然
   要实测一次，但那种验证不可重复；这里用最小跑法把它钉成回归用例。

   做法：qr.js 出模块矩阵 → 按 5px/模块、4 模块静区栅格化成 RGBA
   位图 → 直接喂给 qrdec.js。不涉及 canvas / DOM，node 就能跑。
   ============================================================ */
'use strict';

var QR = require('../js/lib/qr.js');
var QRDec = require('../js/lib/qrdec.js');

var pass = 0, fail = 0;
function check(name, got, want) {
  var ok = got === want;
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + name);
  if (!ok) console.log('         期望: ' + String(want) + '\n         实际: ' + String(got));
}

/* 把模块矩阵画成 RGBA 位图：白底黑块 + 4 模块静区 */
function raster(m, scale, quiet) {
  scale = scale || 5;
  quiet = quiet == null ? 4 : quiet;
  var total = m.size + quiet * 2;
  var w = total * scale;
  var data = new Uint8ClampedArray(w * w * 4);
  data.fill(255);   /* 连同 alpha 一起铺成不透明白 */
  for (var y = 0; y < m.size; y++) {
    for (var x = 0; x < m.size; x++) {
      if (!m.data[y * m.size + x]) continue;
      for (var dy = 0; dy < scale; dy++) {
        for (var dx = 0; dx < scale; dx++) {
          var i = (((y + quiet) * scale + dy) * w + (x + quiet) * scale + dx) * 4;
          data[i] = 23; data[i + 1] = 21; data[i + 2] = 15; data[i + 3] = 255;
        }
      }
    }
  }
  return { width: w, height: w, data: data };
}

function roundtrip(text, ecl) {
  var m = QR.matrix(text, { ecl: ecl || 'M' });
  var r = QRDec.decode(raster(m));
  return r && r.text;
}

/* ---------------- 基本往返 ---------------- */
console.log('\n── 生成 → 识别往返 ──');
check('短文本', roundtrip('hi'), 'hi');
check('网址', roundtrip('https://example.com/tools/qr?a=1&b=2#top'), 'https://example.com/tools/qr?a=1&b=2#top');
check('中文', roundtrip('生活工具箱 · 二维码'), '生活工具箱 · 二维码');
check('多行文本', roundtrip('第一行\n第二行\n第三行'), '第一行\n第二行\n第三行');
check('纯数字', roundtrip('20261028'), '20261028');
check('引号与尖括号原样往返', roundtrip('<b>"a" & \'b\'</b> \\ /'), '<b>"a" & \'b\'</b> \\ /');

/* ---------------- 两个纠错等级 ---------------- */
console.log('\n── 纠错等级 L / M ──');
var long = 'https://github.com/zhihaofans/webapp/tree/master/worktool';
check('L 级长链接', roundtrip(long, 'L'), long);
check('M 级长链接', roundtrip(long, 'M'), long);

/* 第三方码大量用 Q / H（支付码、名片码、微信多选 H）。只支持 L / M 时，
   别人生成的码哪怕拍得再清楚也解不出来。 */
check('Q 级链接', roundtrip('https://example.com/a?b=1', 'Q'), 'https://example.com/a?b=1');
check('H 级链接', roundtrip('https://example.com/a?b=1', 'H'), 'https://example.com/a?b=1');
check('Q 级中文', roundtrip('第三个二维码', 'Q'), '第三个二维码');
check('H 级中文', roundtrip('第三个二维码', 'H'), '第三个二维码');
check('Q 级比 M 级更占地方',
  QR.matrix('x'.repeat(20), { ecl: 'Q' }).version >= QR.matrix('x'.repeat(20), { ecl: 'M' }).version, true);

/* 200 字符会落到较高版本，验证的是多版本下的定位/采样，而不只是 v1 */
var big = '';
for (var i = 0; big.length < 200; i++) big += 'abcd' + i + '-';
big = big.slice(0, 200);
check('200 字符（高版本）', roundtrip(big, 'M'), big);

/* 紧凑裁切的大模块图：每模块 12 / 20 px，四周只有 4 模块静区。
   这类图常见于「把生成好的 PNG 直接丢回来识别」——曾经因为 Otsu 在只有两种
   灰阶的图上取到暗值本身，黑块内部被判成白，整张码模块被掏空而识别失败。 */
function tight(text, ecl, scale) {
  var m = QR.matrix(text, { ecl: ecl || 'M' });
  var r = QRDec.decode(raster(m, scale));
  return r && r.text;
}
check('紧凑裁切 · 12px/模块', tight('https://zhihaofans.github.io/webapp/worktool/', 'M', 12), 'https://zhihaofans.github.io/webapp/worktool/');
check('紧凑裁切 · 20px/模块', tight('https://zhihaofans.github.io/webapp/worktool/', 'L', 20), 'https://zhihaofans.github.io/webapp/worktool/');

/* ---------------- 拍屏幕：模糊 + 反光 ----------------
   摄像头画面几乎不可能是「纯黑纯白的干净图」：对焦会虚一点，屏幕会反光一块。
   这两种退化曾经让解码器直接失守（只试 8px 一个分块尺寸），现在分块尺寸
   8/16/24 各试一遍，模糊与反光都要能过。 */
function degrade(m, scale, blur, glare) {
  var quiet = 4, total = m.size + quiet * 2, w = total * scale;
  var g = new Float32Array(w * w).fill(255);
  for (var y = 0; y < m.size; y++) {
    for (var x = 0; x < m.size; x++) {
      if (!m.data[y * m.size + x]) continue;
      for (var dy = 0; dy < scale; dy++) {
        for (var dx = 0; dx < scale; dx++) {
          g[((y + quiet) * scale + dy) * w + (x + quiet) * scale + dx] = 25;
        }
      }
    }
  }
  for (var y2 = 0; y2 < w; y2++) {
    for (var x2 = 0; x2 < w; x2++) g[y2 * w + x2] *= 0.85 + 0.3 * (1 - y2 / w);
  }
  if (glare) {
    for (var y3 = 0; y3 < w; y3++) {
      for (var x3 = 0; x3 < w; x3++) {
        var dx2 = (x3 - 0.72 * w) / (0.35 * w), dy2 = (y3 - 0.28 * w) / (0.28 * w);
        var d = dx2 * dx2 + dy2 * dy2;
        if (d < 1) g[y3 * w + x3] = Math.min(255, g[y3 * w + x3] + glare * (1 - d));
      }
    }
  }
  if (blur) {
    var o = new Float32Array(g.length), r = blur;
    for (var y4 = 0; y4 < w; y4++) {
      for (var x4 = 0; x4 < w; x4++) {
        var sum = 0, n = 0;
        for (var dy3 = -r; dy3 <= r; dy3++) {
          for (var dx3 = -r; dx3 <= r; dx3++) {
            var yy = y4 + dy3, xx = x4 + dx3;
            if (yy < 0 || yy >= w || xx < 0 || xx >= w) continue;
            sum += g[yy * w + xx]; n++;
          }
        }
        o[y4 * w + x4] = sum / n;
      }
    }
    g = o;
  }
  var data = new Uint8ClampedArray(w * w * 4);
  for (var i = 0; i < w * w; i++) {
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = g[i];
    data[i * 4 + 3] = 255;
  }
  return { width: w, height: w, data: data };
}

function degraded(text, scale, blur, glare) {
  var m = QR.matrix(text, { ecl: 'M' });
  var r = QRDec.decode(degrade(m, scale, blur, glare));
  return r && r.text;
}
var shot = 'https://zhihaofans.github.io/webapp/worktool/';
check('拍屏幕：轻微模糊', degraded(shot, 10, 1, 0), shot);
check('拍屏幕：模糊 + 反光', degraded(shot, 10, 1, 90), shot);
check('拍屏幕：更糊 + 反光', degraded(shot, 10, 2, 90), shot);

/* ---------------- 元信息一致 ---------------- */
console.log('\n── 元信息 ──');
var mm = QR.matrix('meta-check', { ecl: 'L' });
var rr = QRDec.decode(raster(mm));
check('版本号读回一致', rr && rr.version, mm.version);
check('纠错等级读回一致', rr && rr.ecl, 'L');
check('模块边长是 4n+17', (mm.size - 17) % 4, 0);

/* ---------------- 边界 ---------------- */
console.log('\n── 边界 ──');
check('内容超长会抛错', (function () {
  try { QR.matrix(new Array(6000).join('x'), { ecl: 'L' }); return '没抛'; }
  catch (e) { return '抛了'; }
})(), '抛了');
check('不支持的纠错等级会抛错', (function () {
  try { QR.matrix('x', { ecl: 'Z' }); return '没抛'; }
  catch (e) { return '抛了'; }
})(), '抛了');
check('空白图识别返回 null', QRDec.decode({ width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4).fill(255) }), null);
check('过小的图直接返回 null', QRDec.decode({ width: 10, height: 10, data: new Uint8ClampedArray(10 * 10 * 4) }), null);

console.log('\n==============================================');
console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) process.exitCode = 1;
