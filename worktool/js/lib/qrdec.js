/* js/lib/qrdec.js — 自研二维码解码器（零依赖）

   为什么要有这个：BarcodeDetector 在桌面端只覆盖 ChromeOS 与 macOS，
   Windows / Linux 的 Chrome、Firefox、旧 Safari 都没有。而那些机器**有摄像头**。
   只靠原生 API，等于让一大半台式/笔记本用户无法「对着屏幕扫一下」。

   这里做的是纯 JS 解码，跑在同一台设备上：
     灰度 → 局部自适应二值化 → 找三个定位图案 → 透视变换 → 网格采样
          → 读格式信息(BCH 容错) → 去掩码 → 解交织 → RS 纠错 → 字节段

   只解本项目自己生成的码：字节模式、纠错等级 L/M（编码器 qr.js 只出这两级）。
   这不是通用扫码库，够用就好。

   依赖：复用 qr.js 的 ECC / BLK 表，避免两份参数表各自漂移。
*/
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./qr.js'));
  } else {
    var api = factory(root && root.Toolbox && root.Toolbox.QR);
    if (root && root.Toolbox) root.Toolbox.QRDec = api;
  }
})(typeof window !== 'undefined' ? window : null, function (QR) {
  'use strict';

  if (!QR || !QR.ECC || !QR.BLK) {
    return { decode: function () { return null; }, ready: false };
  }

  /* ---------------- GF(256) ---------------- */
  var EXP = new Uint8Array(512);
  var LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11D;
    }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();

  function gmul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }
  function gdiv(a, b) { return a === 0 ? 0 : EXP[(LOG[a] + 255 - LOG[b]) % 255]; }
  function gpow(a, n) { return (a === 0) ? 0 : EXP[(LOG[a] * (n % 255)) % 255]; }

  /* ---------------- 结构表 ---------------- */
  function rawModules(ver) {
    var r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var n = Math.floor(ver / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (ver >= 7) r -= 36;
    }
    return r;
  }

  function alignPos(ver) {
    if (ver === 1) return [];
    var num = Math.floor(ver / 7) + 2;
    var step = (ver === 32) ? 26 : Math.ceil((ver * 4 + 4) / (num * 2 - 2)) * 2;
    var out = [6];
    for (var pos = ver * 4 + 10; out.length < num; pos -= step) out.splice(1, 0, pos);
    return out;
  }

  function maskHit(mask, x, y) {
    switch (mask) {
      case 0: return (x + y) % 2 === 0;
      case 1: return y % 2 === 0;
      case 2: return x % 3 === 0;
      case 3: return (x + y) % 3 === 0;
      case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
      case 5: return x * y % 2 + x * y % 3 === 0;
      case 6: return (x * y % 2 + x * y % 3) % 2 === 0;
      default: return ((x + y) % 2 + x * y % 3) % 2 === 0;
    }
  }

  /* 功能模块分布：与 qr.js 的 buildMatrix 保持同一套边界 */
  function functionMap(ver) {
    var size = ver * 4 + 17;
    var fn = [];
    for (var i = 0; i < size; i++) fn.push(new Uint8Array(size));
    function set(x, y) { if (x >= 0 && x < size && y >= 0 && y < size) fn[y][x] = 1; }

    function finder(cx, cy) {
      for (var dy = -4; dy <= 4; dy++) {
        for (var dx = -4; dx <= 4; dx++) set(cx + dx, cy + dy);
      }
    }
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);

    for (var t = 0; t < size; t++) { set(t, 6); set(6, t); }

    var pos = alignPos(ver);
    for (var a = 0; a < pos.length; a++) {
      for (var b = 0; b < pos.length; b++) {
        if ((a === 0 && b === 0) || (a === 0 && b === pos.length - 1) ||
            (a === pos.length - 1 && b === 0)) continue;
        for (var dy2 = -2; dy2 <= 2; dy2++) {
          for (var dx2 = -2; dx2 <= 2; dx2++) set(pos[a] + dx2, pos[b] + dy2);
        }
      }
    }

    for (var k = 0; k <= 8; k++) { set(8, k); set(k, 8); }
    for (var m = 0; m < 8; m++) { set(size - 1 - m, 8); set(8, size - 1 - m); }

    if (ver >= 7) {
      for (var v = 0; v < 18; v++) {
        var aa = size - 11 + v % 3, bb = Math.floor(v / 3);
        set(aa, bb); set(bb, aa);
      }
    }
    return fn;
  }

  /* ---------------- 图像：灰度与二值化 ---------------- */
  function toGray(img) {
    var w = img.width, h = img.height, d = img.data;
    if (img.gray) return img.gray;
    var g = new Uint8Array(w * h);
    for (var i = 0, p = 0; i < g.length; i++, p += 4) {
      g[i] = (d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) >> 8;
    }
    return g;
  }

  /* 全局 Otsu：给局部阈值做上下限。纯黑/纯白块自己算出来的均值毫无意义
     （全黑块均值≈18，拿它当阈值会把整块判成白），必须夹回合理区间。 */
  function otsu(g) {
    var hist = new Uint32Array(256);
    for (var i = 0; i < g.length; i++) hist[g[i]]++;
    var total = g.length, sum = 0;
    for (var t = 0; t < 256; t++) sum += t * hist[t];
    var sumB = 0, wB = 0, best = 0, bestVar = -1;
    for (var k = 0; k < 256; k++) {
      wB += hist[k];
      if (!wB) continue;
      var wF = total - wB;
      if (!wF) break;
      sumB += k * hist[k];
      var mB = sumB / wB, mF = (sum - sumB) / wF;
      var v = wB * wF * (mB - mF) * (mB - mF);
      if (v > bestVar) { bestVar = v; best = k; }
    }
    return best || 128;
  }

  /* 轻量 3x3 平滑（[1,2,1] 分离式）。摄像头本身有噪声，
     不平滑的话行扫描的 1:1:3:1:1 判断会被锯齿打散 —— 实测 ±40 噪声下直接失守。 */
  function smooth(g, w, h) {
    var tmp = new Uint8Array(w * h);
    var out = new Uint8Array(w * h);
    for (var y = 0; y < h; y++) {
      var row = y * w;
      for (var x = 0; x < w; x++) {
        var a = g[row + (x > 0 ? x - 1 : x)];
        var b = g[row + x];
        var c = g[row + (x < w - 1 ? x + 1 : x)];
        tmp[row + x] = (a + b * 2 + c) >> 2;
      }
    }
    for (var x2 = 0; x2 < w; x2++) {
      for (var y2 = 0; y2 < h; y2++) {
        var a2 = tmp[(y2 > 0 ? y2 - 1 : y2) * w + x2];
        var b2 = tmp[y2 * w + x2];
        var c2 = tmp[(y2 < h - 1 ? y2 + 1 : y2) * w + x2];
        out[y2 * w + x2] = (a2 + b2 * 2 + c2) >> 2;
      }
    }
    return out;
  }

  function binarize(g, w, h) {
    var BS = 8;
    var t0 = otsu(g);
    var lo = t0 * 0.5, hi = t0 * 1.7;
    var bw = Math.ceil(w / BS), bh = Math.ceil(h / BS);
    var mean = new Float32Array(bw * bh);
    var lowc = new Uint8Array(bw * bh);

    for (var by = 0; by < bh; by++) {
      for (var bx = 0; bx < bw; bx++) {
        var sum = 0, cnt = 0, mn = 255, mx = 0;
        var y1 = Math.min(h, (by + 1) * BS), x1 = Math.min(w, (bx + 1) * BS);
        for (var y = by * BS; y < y1; y++) {
          for (var x = bx * BS; x < x1; x++) {
            var v = g[y * w + x];
            sum += v; cnt++;
            if (v < mn) mn = v;
            if (v > mx) mx = v;
          }
        }
        mean[by * bw + bx] = cnt ? sum / cnt : 128;
        lowc[by * bw + bx] = (mx - mn) < 24 ? 1 : 0;
      }
    }

    /* 纯色块没有可用阈值，用邻域均值顶上，避免整块被压成一色 */
    var thr = new Float32Array(bw * bh);
    for (var by2 = 0; by2 < bh; by2++) {
      for (var bx2 = 0; bx2 < bw; bx2++) {
        if (!lowc[by2 * bw + bx2]) { thr[by2 * bw + bx2] = mean[by2 * bw + bx2]; continue; }
        var s2 = 0, n2 = 0;
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            var yy = by2 + dy, xx = bx2 + dx;
            if (yy < 0 || yy >= bh || xx < 0 || xx >= bw) continue;
            s2 += mean[yy * bw + xx]; n2++;
          }
        }
        thr[by2 * bw + bx2] = n2 ? s2 / n2 : 128;
      }
    }

    for (var c = 0; c < thr.length; c++) {
      if (thr[c] < lo) thr[c] = lo;
      else if (thr[c] > hi) thr[c] = hi;
    }

    var bin = new Uint8Array(w * h);
    for (var y3 = 0; y3 < h; y3++) {
      var rowb = Math.floor(y3 / BS) * bw;
      for (var x3 = 0; x3 < w; x3++) {
        bin[y3 * w + x3] = g[y3 * w + x3] < thr[rowb + Math.floor(x3 / BS)] ? 1 : 0;
      }
    }
    return bin;
  }

  /* ---------------- 定位图案 ---------------- */
  function findFinders(bin, w, h) {
    var cands = [];

    function addPoint(cx, cy, msize) {
      for (var i = 0; i < cands.length; i++) {
        var c = cands[i];
        if (Math.abs(c.x - cx) <= msize * 2.5 && Math.abs(c.y - cy) <= msize * 2.5) {
          c.x = (c.x * c.n + cx) / (c.n + 1);
          c.y = (c.y * c.n + cy) / (c.n + 1);
          c.m = (c.m * c.n + msize) / (c.n + 1);
          c.n++;
          return;
        }
      }
      cands.push({ x: cx, y: cy, m: msize, n: 1 });
    }

    /* 竖直方向复核：同一列上也要是 1:1:3:1:1，否则只是行方向凑巧 */
    function verifyY(cx, cy, unit) {
      var xi = Math.round(cx), y0 = Math.round(cy);
      if (xi < 0 || xi >= w || y0 < 0 || y0 >= h) return false;
      if (bin[y0 * w + xi] !== 1) return false;

      /* 中心黑段：finder 中间是 3 个模块宽 */
      var up = y0, down = y0;
      while (up - 1 >= 0 && bin[(up - 1) * w + xi] === 1) up--;
      while (down + 1 < h && bin[(down + 1) * w + xi] === 1) down++;
      var core = down - up + 1;
      if (core < unit * 1.8 || core > unit * 5.2) return false;

      /* 上下各量白、黑两段 */
      var segs = [];
      var want = 0;
      var p = up - 1;
      for (var i = 0; i < 2; i++) {
        var l = 0;
        while (p >= 0 && bin[p * w + xi] === want) { l++; p--; }
        segs.push(l);
        want = 1 - want;
      }
      want = 0;
      var q = down + 1;
      for (var j = 0; j < 2; j++) {
        var l2 = 0;
        while (q < h && bin[q * w + xi] === want) { l2++; q++; }
        segs.push(l2);
        want = 1 - want;
      }
      for (var k = 0; k < 4; k++) {
        if (segs[k] === 0) return false;
        if (Math.abs(segs[k] - unit) > unit * 1.5) return false;
      }
      return true;
    }

    for (var y = 0; y < h; y++) {
      var runs = [];
      var cur = bin[y * w];
      var start = 0;
      for (var x = 1; x <= w; x++) {
        var v = x < w ? bin[y * w + x] : -1;
        if (v !== cur) {
          runs.push({ c: cur, s: start, l: x - start });
          cur = v;
          start = x;
        }
      }
      for (var i = 0; i + 4 < runs.length; i++) {
        if (runs[i].c !== 1) continue;
        if (runs[i + 1].c !== 0 || runs[i + 2].c !== 1 ||
            runs[i + 3].c !== 0 || runs[i + 4].c !== 1) continue;
        var a = runs[i].l, b2 = runs[i + 1].l, c2 = runs[i + 2].l,
            d2 = runs[i + 3].l, e2 = runs[i + 4].l;
        var total = a + b2 + c2 + d2 + e2;
        if (total < 7) continue;
        var unit = total / 7;
        var tol = unit * 1.05;
        if (Math.abs(a - unit) > tol || Math.abs(b2 - unit) > tol ||
            Math.abs(c2 - 3 * unit) > tol * 2.2 || Math.abs(d2 - unit) > tol ||
            Math.abs(e2 - unit) > tol) continue;
        var cx = runs[i + 2].s + runs[i + 2].l / 2;
        var cy = y;
        if (!verifyY(cx, cy, unit)) continue;
        addPoint(cx, cy, unit);
      }
    }

    cands.sort(function (p, q) { return q.n - p.n; });
    return cands.slice(0, 12);
  }

  /* 三点定序：直角顶点是左上，叉积判右上/左下 */
  function orderPoints(p) {
    var d = [
      Math.pow(p[1].x - p[2].x, 2) + Math.pow(p[1].y - p[2].y, 2),
      Math.pow(p[0].x - p[2].x, 2) + Math.pow(p[0].y - p[2].y, 2),
      Math.pow(p[0].x - p[1].x, 2) + Math.pow(p[0].y - p[1].y, 2)
    ];
    var tl = 0, bestErr = Infinity;
    for (var i = 0; i < 3; i++) {
      var a = d[(i + 1) % 3], b = d[(i + 2) % 3], c = d[i];
      var err = Math.abs(a + b - c);
      if (err < bestErr) { bestErr = err; tl = i; }
    }
    var P = p[tl], Q = p[(tl + 1) % 3], R = p[(tl + 2) % 3];
    var cross = (Q.x - P.x) * (R.y - P.y) - (Q.y - P.y) * (R.x - P.x);
    return cross > 0
      ? { tl: P, tr: Q, bl: R }
      : { tl: P, tr: R, bl: Q };
  }

  /* ---------------- 透视变换 ---------------- */
  function solve8(A, b) {
    var n = 8;
    for (var i = 0; i < n; i++) {
      var piv = i;
      for (var r = i + 1; r < n; r++) {
        if (Math.abs(A[r][i]) > Math.abs(A[piv][i])) piv = r;
      }
      if (Math.abs(A[piv][i]) < 1e-12) return null;
      var t = A[i]; A[i] = A[piv]; A[piv] = t;
      var tb = b[i]; b[i] = b[piv]; b[piv] = tb;

      var pv = A[i][i];
      for (var c = i; c < n; c++) A[i][c] /= pv;
      b[i] /= pv;

      for (var r2 = 0; r2 < n; r2++) {
        if (r2 === i) continue;
        var f = A[r2][i];
        if (!f) continue;
        for (var c2 = i; c2 < n; c2++) A[r2][c2] -= f * A[i][c2];
        b[r2] -= f * b[i];
      }
    }
    return b;
  }

  function homography(src, dst) {
    var A = [], b = [];
    for (var i = 0; i < 4; i++) {
      var x = src[i][0], y = src[i][1], X = dst[i][0], Y = dst[i][1];
      A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]); b.push(X);
      A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]); b.push(Y);
    }
    return solve8(A, b);
  }

  function applyH(H, x, y) {
    var den = H[6] * x + H[7] * y + 1;
    if (!den) return null;
    return { x: (H[0] * x + H[1] * y + H[2]) / den, y: (H[3] * x + H[4] * y + H[5]) / den };
  }

  /* ---------------- 格式信息（BCH 15,5） ---------------- */
  var FMT_TABLE = (function () {
    var out = [];
    for (var d = 0; d < 32; d++) {
      var v = d << 10;
      for (var i = 4; i >= 0; i--) {
        if (v & (1 << (i + 10))) v ^= 0x537 << i;
      }
      out.push((((d << 10) | (v & 0x3FF)) ^ 0x5412));
    }
    return out;
  })();

  function popcount(x) { var c = 0; while (x) { c += x & 1; x >>= 1; } return c; }

  function readFormat(m, size) {
    var b1 = 0;
    for (var i = 0; i <= 5; i++) b1 |= m[i][8] << i;
    b1 |= m[7][8] << 6;
    b1 |= m[8][8] << 7;
    b1 |= m[8][7] << 8;
    for (var j = 9; j < 15; j++) b1 |= m[8][14 - j] << j;

    var b2 = 0;
    for (var k = 0; k < 8; k++) b2 |= m[8][size - 1 - k] << k;
    for (var n = 8; n < 15; n++) b2 |= m[size - 15 + n][8] << n;

    function nearest(bits) {
      var best = -1, bestD = 99;
      for (var t = 0; t < 32; t++) {
        var dd = popcount(bits ^ FMT_TABLE[t]);
        if (dd < bestD) { bestD = dd; best = t; }
      }
      return bestD <= 3 ? { data: best, dist: bestD } : null;
    }
    var r1 = nearest(b1), r2 = nearest(b2);
    if (!r1 && !r2) return null;
    var pick;
    if (r1 && r2) pick = r1.dist <= r2.dist ? r1 : r2;
    else pick = r1 || r2;

    var eclBits = pick.data >> 3;
    var mask = pick.data & 7;
    var ecl = eclBits === 1 ? 'L' : eclBits === 0 ? 'M' : eclBits === 3 ? 'Q' : 'H';
    return { ecl: ecl, mask: mask };
  }

  /* ---------------- 数据位与纠错 ---------------- */
  function readCodewords(m, size, ver, mask) {
    var fn = functionMap(ver);
    var bits = [];
    var total = Math.floor(rawModules(ver) / 8) * 8;

    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (var j = 0; j < 2; j++) {
          var x = right - j;
          var upward = ((right + 1) & 2) === 0;
          var y = upward ? size - 1 - vert : vert;
          if (fn[y][x]) continue;
          var bit = m[y][x];
          if (maskHit(mask, x, y)) bit ^= 1;
          bits.push(bit);
          if (bits.length >= total) break;
        }
        if (bits.length >= total) break;
      }
      if (bits.length >= total) break;
    }

    var out = new Uint8Array(Math.floor(bits.length / 8));
    for (var i = 0; i < out.length; i++) {
      var v = 0;
      for (var k = 0; k < 8; k++) v = (v << 1) | bits[i * 8 + k];
      out[i] = v;
    }
    return out;
  }

  function deinterleave(cw, ver, ecl) {
    var numBlocks = QR.BLK[ecl][ver];
    var eccLen = QR.ECC[ecl][ver];
    var raw = Math.floor(rawModules(ver) / 8);
    var numShort = numBlocks - raw % numBlocks;
    var shortLen = Math.floor(raw / numBlocks);

    var blocks = [];
    for (var i = 0; i < numBlocks; i++) blocks.push(new Uint8Array(shortLen + 1));

    var k = 0;
    for (var j = 0; j <= shortLen; j++) {
      for (var b = 0; b < numBlocks; b++) {
        if (j === shortLen - eccLen && b < numShort) continue;
        if (k < cw.length) blocks[b][j] = cw[k++];
      }
    }

    var out = [];
    for (var b2 = 0; b2 < numBlocks; b2++) {
      var blk = blocks[b2];
      var flat = [];
      for (var x = 0; x < blk.length; x++) {
        if (b2 < numShort && x === shortLen - eccLen) continue;
        flat.push(blk[x]);
      }
      var fixed = rsCorrect(flat, eccLen);
      if (!fixed) return null;
      var dataLen = flat.length - eccLen;
      for (var d = 0; d < dataLen; d++) out.push(fixed[d]);
    }
    return out;
  }

  function syndromes(cw, nsym) {
    var s = new Uint8Array(nsym);
    var bad = false;
    for (var i = 0; i < nsym; i++) {
      var a = EXP[i];
      var v = 0;
      for (var j = 0; j < cw.length; j++) v = gmul(v, a) ^ cw[j];
      s[i] = v;
      if (v) bad = true;
    }
    return bad ? s : null;
  }

  function rsCorrect(cw, nsym) {
    var s = syndromes(cw, nsym);
    if (!s) return cw;

    /* Berlekamp–Massey */
    var lambda = [1], B = [1], L = 0, m = 1, bb = 1;
    for (var n = 0; n < nsym; n++) {
      var d = s[n];
      for (var i = 1; i <= L; i++) {
        if (i < lambda.length) d ^= gmul(lambda[i], s[n - i]);
      }
      if (d === 0) { m++; continue; }
      var coef = gdiv(d, bb);
      var T = lambda.slice();
      if (lambda.length < B.length + m) {
        while (lambda.length < B.length + m) lambda.push(0);
      }
      for (var j = 0; j < B.length; j++) lambda[j + m] ^= gmul(coef, B[j]);
      if (2 * L <= n) { L = n + 1 - L; B = T; bb = d; m = 1; }
      else m++;
    }
    while (lambda.length > 1 && lambda[lambda.length - 1] === 0) lambda.pop();

    var nerr = lambda.length - 1;
    if (nerr <= 0 || nerr * 2 > nsym) return null;

    /* Chien 搜索 */
    var nlen = cw.length;
    var pos = [];
    for (var p = 0; p < nlen; p++) {
      var xinv = EXP[(255 - ((nlen - 1 - p) % 255)) % 255];
      var acc = 0, xp = 1;
      for (var q = 0; q < lambda.length; q++) { acc ^= gmul(lambda[q], xp); xp = gmul(xp, xinv); }
      if (acc === 0) pos.push(p);
    }
    if (pos.length !== nerr) return null;

    /* Ω(x) = S(x)·Λ(x) mod x^nsym */
    var omega = new Uint8Array(nsym);
    for (var o = 0; o < nsym; o++) {
      var v = 0;
      for (var w = 0; w <= Math.min(o, lambda.length - 1); w++) v ^= gmul(lambda[w], s[o - w]);
      omega[o] = v;
    }

    /* Forney */
    var out = cw.slice();
    for (var t2 = 0; t2 < pos.length; t2++) {
      var idx = pos[t2];
      var e = (nlen - 1 - idx) % 255;
      var Xi = EXP[e];
      var XiInv = EXP[(255 - e) % 255];

      var num = 0, xp2 = 1;
      for (var u = 0; u < omega.length; u++) { num ^= gmul(omega[u], xp2); xp2 = gmul(xp2, XiInv); }

      var den = 0;
      for (var y2 = 1; y2 < lambda.length; y2 += 2) {
        den ^= gmul(lambda[y2], gpow(XiInv, y2 - 1));
      }
      if (den === 0) return null;
      out[idx] = out[idx] ^ gmul(Xi, gdiv(num, den));
    }

    /* 纠完再验一次，防止算错却当成成功 */
    if (syndromes(out, nsym)) return null;
    return out;
  }

  /* ---------------- 字节段解析 ---------------- */
  function parseBytes(data, ver) {
    var bits = [];
    for (var i = 0; i < data.length; i++) {
      for (var k = 7; k >= 0; k--) bits.push((data[i] >> k) & 1);
    }
    var p = 0;
    function read(n) {
      var v = 0;
      for (var j = 0; j < n; j++) { v = (v << 1) | (bits[p++] || 0); }
      return v;
    }
    var texts = [];
    while (p + 4 <= bits.length) {
      var mode = read(4);
      if (mode === 0) break;
      if (mode === 4) {
        var cnt = read(ver <= 9 ? 8 : 16);
        var bytes = [];
        for (var i2 = 0; i2 < cnt && p + 8 <= bits.length; i2++) bytes.push(read(8));
        texts.push(utf8Decode(bytes));
      } else if (mode === 2) {
        var cnt2 = read(ver <= 9 ? 9 : 11);
        var s = '';
        for (var i3 = 0; i3 < cnt2; i3++) {
          var v2 = read(11);
          s += String.fromCharCode((v2 >> 6) & 0x1F, (v2 >> 3) & 0x7, v2 & 0x7);
        }
        texts.push(s.replace(/[\x00-\x1f]/g, ''));
      } else if (mode === 1) {
        var cnt3 = read(ver <= 9 ? 10 : 12);
        var s2 = '';
        var alpha = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
        for (var i4 = 0; i4 + 2 <= cnt3; i4 += 2) {
          var v3 = read(11);
          s2 += alpha.charAt(Math.floor(v3 / 45)) + alpha.charAt(v3 % 45);
        }
        if (cnt3 % 2) s2 += alpha.charAt(read(6));
        texts.push(s2);
      } else {
        break;
      }
    }
    return texts.join('');
  }

  function utf8Decode(bytes) {
    var out = '';
    for (var i = 0; i < bytes.length; i++) {
      var c = bytes[i];
      if (c < 0x80) out += String.fromCharCode(c);
      else if (c >= 0xC0 && c < 0xE0 && i + 1 < bytes.length) {
        out += String.fromCharCode(((c & 0x1F) << 6) | (bytes[++i] & 0x3F));
      } else if (c >= 0xE0 && c < 0xF0 && i + 2 < bytes.length) {
        out += String.fromCharCode(((c & 0x0F) << 12) | ((bytes[++i] & 0x3F) << 6) | (bytes[++i] & 0x3F));
      } else if (c >= 0xF0 && i + 3 < bytes.length) {
        var cp = ((c & 0x07) << 18) | ((bytes[++i] & 0x3F) << 12) |
                 ((bytes[++i] & 0x3F) << 6) | (bytes[++i] & 0x3F);
        cp -= 0x10000;
        out += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 0x3FF));
      }
    }
    return out;
  }

  /* ---------------- 主流程 ---------------- */
  function sampleMatrix(H, bin, w, h, size) {
    var m = [];
    for (var y = 0; y < size; y++) m.push(new Uint8Array(size));
    for (var my = 0; my < size; my++) {
      for (var mx = 0; mx < size; mx++) {
        var pt = applyH(H, mx + 0.5, my + 0.5);
        if (!pt) return null;
        var px = Math.round(pt.x), py = Math.round(pt.y);
        /* 码贴边时最外一列可能算出界 1~2px（透视外推误差），夹回来即可；
           真出界太多说明矩阵本身歪了，直接放弃这一组 */
        if (px < -2 || px >= w + 2 || py < -2 || py >= h + 2) return null;
        if (px < 0) px = 0; else if (px >= w) px = w - 1;
        if (py < 0) py = 0; else if (py >= h) py = h - 1;
        m[my][mx] = bin[py * w + px];
      }
    }
    return m;
  }

  function decodeMatrix(m, size) {
    var ver = Math.round((size - 17) / 4);
    if (ver < 1 || ver > 40) return null;
    if (ver * 4 + 17 !== size) return null;

    var fmt = readFormat(m, size);
    if (!fmt) return null;
    if (!QR.ECC[fmt.ecl] || !QR.BLK[fmt.ecl]) return null;

    var cw = readCodewords(m, size, ver, fmt.mask);
    var data = deinterleave(cw, ver, fmt.ecl);
    if (!data) return null;

    var text = parseBytes(data, ver);
    if (!text) return null;
    return { text: text, version: ver, ecl: fmt.ecl, mask: fmt.mask };
  }

  function dist(dx, dy) { return Math.sqrt(dx * dx + dy * dy); }

  /* 在预测点附近找校正图形（5x5：黑框/白环/黑心，穿过中心是 1:1:1:1:1）。
     第四点如果只靠平行四边形估，透视下会偏出好几个模块 —— 实测 10% 斜视
     就偏了 4 个模块，采样全错。校正图形正好钉住右下角。 */
  /* 校正图形紧贴数据区，外面没有静区 —— 靠「游程 1:1:1:1:1」会把相邻的
     黑色数据模块一起算进去，比例直接崩掉。改成按模板读格：
     外圈黑、中间环白、正中黑，25 格里对得越多越像。 */
  function alignmentScore(bin, w, h, cx, cy, u) {
    var hit = 0;
    for (var dy = -2; dy <= 2; dy++) {
      for (var dx = -2; dx <= 2; dx++) {
        var x = Math.round(cx + dx * u);
        var y = Math.round(cy + dy * u);
        if (x < 0 || x >= w || y < 0 || y >= h) return -1;
        var ring = Math.max(Math.abs(dx), Math.abs(dy));
        var want = ring === 1 ? 0 : 1;
        if (bin[y * w + x] === want) hit++;
      }
    }
    return hit;
  }

  function findAlignment(bin, w, h, px, py, radius, unit) {
    var best = null, bestScore = -Infinity;

    function scan(x0, x1, y0, y1, step) {
      for (var y = y0; y <= y1; y += step) {
        for (var x = x0; x <= x1; x += step) {
          if (x - 2.6 * unit < 0 || x + 2.6 * unit >= w) continue;
          if (y - 2.6 * unit < 0 || y + 2.6 * unit >= h) continue;
          var sc = alignmentScore(bin, w, h, x, y, unit);
          if (sc < 0) continue;
          var d = dist(x - px, y - py) / unit;
          var total = sc - d * 0.9;
          if (total > bestScore) { bestScore = total; best = { x: x, y: y, u: unit }; }
        }
      }
    }

    var step0 = Math.max(1, Math.round(unit / 2));
    scan(Math.round(px - radius), Math.round(px + radius),
         Math.round(py - radius), Math.round(py + radius), step0);
    if (!best || bestScore < 18) return null;

    /* 粗搜定位后按 1px 细化，采样点差 2px 就够让矩阵整体偏移 */
    var cx = best.x, cy = best.y;
    bestScore = -Infinity;
    scan(Math.round(cx - step0), Math.round(cx + step0),
         Math.round(cy - step0), Math.round(cy + step0), 1);
    return bestScore >= 20 ? best : null;
  }

  function tryTriple(pts, bin, w, h) {
    var o = orderPoints(pts);
    var ms = (o.tl.m + o.tr.m + o.bl.m) / 3;
    var d1 = dist(o.tr.x - o.tl.x, o.tr.y - o.tl.y);
    var d2 = dist(o.bl.x - o.tl.x, o.bl.y - o.tl.y);
    var mods = Math.round(((d1 + d2) / 2) / ms) + 7;
    var ver = Math.round((mods - 17) / 4);
    if (ver < 1 || ver > 40) return null;
    var size = ver * 4 + 17;

    var src = [
      [3.5, 3.5], [size - 3.5, 3.5], [3.5, size - 3.5],
      [size - 3.5, size - 3.5]
    ];
    var dst = [
      [o.tl.x, o.tl.y], [o.tr.x, o.tr.y], [o.bl.x, o.bl.y],
      [o.tr.x + o.bl.x - o.tl.x, o.tr.y + o.bl.y - o.tl.y]
    ];
    var H = homography(src, dst);
    if (!H) return null;

    /* 先用校正图形把第四点钉准，再退回平行四边形版本 */
    var ap = alignPos(ver);
    if (ap.length) {
      var ac = ap[ap.length - 1] + 0.5;
      var pred = applyH(H, ac, ac);
      if (pred) {
        var al = findAlignment(bin, w, h, pred.x, pred.y, ms * 6, ms);
        if (al) {
          /* 校正图形在码的内部，不是第四个角点 —— 源坐标必须用它自己的
             模块位置 (ac, ac)，右下角由矩阵解出来。写错这点会让采样整体外飘。 */
          var src2 = [
            [3.5, 3.5], [size - 3.5, 3.5], [3.5, size - 3.5], [ac, ac]
          ];
          var dst2 = [
            [o.tl.x, o.tl.y], [o.tr.x, o.tr.y], [o.bl.x, o.bl.y], [al.x, al.y]
          ];
          var H2 = homography(src2, dst2);
          if (H2) {
            var mm2 = sampleMatrix(H2, bin, w, h, size);
            if (mm2) {
              var r2 = decodeMatrix(mm2, size);
              if (r2) return r2;
            }
          }
        }
      }
    }

    var mm = sampleMatrix(H, bin, w, h, size);
    if (!mm) return null;
    return decodeMatrix(mm, size);
  }

  /* 三个定位图案必须像「等腰直角三角形的三个顶点」，且模块大小接近。
     光按命中次数排序会在透视下选错 —— 被压扁那一角的命中次数天然更低。 */
  function tripleScore(p) {
    var o;
    try { o = orderPoints(p); } catch (e) { return -1; }
    var d1 = dist(o.tr.x - o.tl.x, o.tr.y - o.tl.y);
    var d2 = dist(o.bl.x - o.tl.x, o.bl.y - o.tl.y);
    var d3 = dist(o.tr.x - o.bl.x, o.tr.y - o.bl.y);
    if (!d1 || !d2) return -1;

    var ratio = d1 / d2;
    if (ratio < 0.5 || ratio > 2.0) return -1;

    var hyp = Math.max(d1, d2);
    var diag = d3 / hyp;
    if (diag < 1.1 || diag > 1.8) return -1;

    var ms = [o.tl.m, o.tr.m, o.bl.m];
    var mn = Math.min(ms[0], ms[1], ms[2]);
    var mx = Math.max(ms[0], ms[1], ms[2]);
    if (!mn || mx / mn > 2.6) return -1;

    /* 命中次数越多越好，形状离正等腰直角三角形越近越好 */
    var hits = (o.tl.n + o.tr.n + o.bl.n);
    var penalty = Math.abs(diag - 1.4142) * 6 + Math.abs(Math.log(ratio)) * 3;
    return hits / (1 + penalty);
  }

  function candidatesTriples(cands, limit) {
    var list = [];
    for (var a = 0; a < cands.length - 2; a++) {
      for (var b = a + 1; b < cands.length - 1; b++) {
        for (var c = b + 1; c < cands.length; c++) {
          var sc = tripleScore([cands[a], cands[b], cands[c]]);
          if (sc > 0) list.push({ p: [cands[a], cands[b], cands[c]], s: sc });
        }
      }
    }
    list.sort(function (x, y) { return y.s - x.s; });
    return list.slice(0, limit);
  }

  function decodeWith(g, w, h) {
    var bin = binarize(g, w, h);
    var cands = findFinders(bin, w, h);
    if (cands.length < 3) return null;

    var triples = candidatesTriples(cands, 6);
    for (var i = 0; i < triples.length; i++) {
      var r = tryTriple(triples[i].p, bin, w, h);
      if (r) return r;
    }
    return null;
  }

  function decode(img) {
    if (!img || !img.width || !img.height) return null;
    var w = img.width, h = img.height;
    if (w < 21 || h < 21) return null;

    var g0 = toGray(img);

    /* 先原图：小模块、清晰画面最吃这一套，平滑反而会糊掉细格子 */
    var r = decodeWith(g0, w, h);
    if (r) return r;

    /* 再平滑：噪声大、对焦虚时才走这条，代价是牺牲小模块的分辨率 */
    return decodeWith(smooth(g0, w, h), w, h);
  }

  return {
    decode: decode,
    ready: true,
    _internals: {
      toGray: toGray, binarize: binarize, findFinders: findFinders,
      decodeMatrix: decodeMatrix, rsCorrect: rsCorrect, rawModules: rawModules,
      tryTriple: tryTriple, tripleScore: tripleScore, candidatesTriples: candidatesTriples,
      findAlignment: findAlignment, alignPos: alignPos, orderPoints: orderPoints,
      homography: homography, applyH: applyH, sampleMatrix: sampleMatrix, smooth: smooth
    }
  };
});
