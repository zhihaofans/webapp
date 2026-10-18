/* ============================================================
   lib/qr.js — 二维码编码器（字节模式，ECC L / M）

   为什么自己写：局域网传输要在「零服务器」的前提下交换配对信息，
   二维码是唯一不依赖任何外部服务的载体。而这个项目从第一天起就不引
   任何外部库 —— 所以自己编。

   为什么不自己发明参数表：ECC 码字数与分块数这两张表有 80 个数字，
   手抄一个就废掉某个版本。这里的两张表是从 python-qrcode 的
   RS_BLOCK_TABLE 推导后固化进来的（ECC 码字数 = 总码字 - 数据码字，
   块数 = 两组之和），并用 cv2 / pyzbar 两个独立解码器逐版本验证过。

   实现按标准流程：分段 → RS 纠错 → 交织 → 功能图形 → 8 种掩码择优
   （按标准的四条罚分规则）→ 写格式信息与版本信息。
   ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && root.Toolbox) root.Toolbox.QR = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  /* 索引 0 占位，版本从 1 开始 */
  var ECC = {
    L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28]
  };
  var BLK = {
    L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49]
  };
  /* 格式信息里的两比特纠错等级编码，注意不是上面的数组下标 */
  var ECL_BITS = { L: 1, M: 0, Q: 3, H: 2 };

  function getBit(x, i) { return ((x >>> i) & 1) !== 0; }

  function getNumRawDataModules(ver) {
    var result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }
  function getNumDataCodewords(ver, ecl) {
    return Math.floor(getNumRawDataModules(ver) / 8) - ECC[ecl][ver] * BLK[ecl][ver];
  }

  /* ---------------- GF(256) 与 RS 纠错 ---------------- */
  function mul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((y >>> i) & 1) * x;
    }
    return z & 0xFF;
  }
  function rsDivisor(degree) {
    var result = new Uint8Array(degree);
    result[degree - 1] = 1;
    var root = 1;
    for (var i = 0; i < degree; i++) {
      for (var j = 0; j < degree; j++) {
        result[j] = mul(result[j], root);
        if (j + 1 < degree) result[j] ^= result[j + 1];
      }
      root = mul(root, 0x02);
    }
    return result;
  }
  function rsRemainder(data, divisor) {
    var result = new Uint8Array(divisor.length);
    for (var i = 0; i < data.length; i++) {
      var factor = data[i] ^ result[0];
      result.copyWithin(0, 1);
      result[result.length - 1] = 0;
      for (var j = 0; j < result.length; j++) result[j] ^= mul(divisor[j], factor);
    }
    return result;
  }

  function addEccAndInterleave(data, ver, ecl) {
    var numBlocks = BLK[ecl][ver];
    var blockEccLen = ECC[ecl][ver];
    var rawCodewords = Math.floor(getNumRawDataModules(ver) / 8);
    var numShortBlocks = numBlocks - rawCodewords % numBlocks;
    var shortBlockLen = Math.floor(rawCodewords / numBlocks);

    var blocks = [];
    var divisor = rsDivisor(blockEccLen);
    var k = 0;
    for (var i = 0; i < numBlocks; i++) {
      var len = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
      var dat = data.slice(k, k + len);
      k += len;
      var ecc = rsRemainder(dat, divisor);
      var block = Array.prototype.slice.call(dat);
      if (i < numShortBlocks) block.push(0);           /* 短块补位，交织时跳过 */
      blocks.push(block.concat(Array.prototype.slice.call(ecc)));
    }

    var result = [];
    for (var j = 0; j < blocks[0].length; j++) {
      for (var b = 0; b < blocks.length; b++) {
        if (j !== shortBlockLen - blockEccLen || b >= numShortBlocks) {
          result.push(blocks[b][j]);
        }
      }
    }
    return result;
  }

  /* ---------------- 数据编码 ---------------- */
  function utf8Bytes(text) {
    if (typeof TextEncoder !== 'undefined') return Array.prototype.slice.call(new TextEncoder().encode(text));
    var s = unescape(encodeURIComponent(text));        /* 老环境兜底 */
    var out = [];
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
    return out;
  }

  function encodeData(bytes, ver, ecl) {
    var bits = [];
    function push(val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); }

    push(0x4, 4);                                      /* 字节模式 */
    push(bytes.length, ver <= 9 ? 8 : 16);
    for (var i = 0; i < bytes.length; i++) push(bytes[i], 8);

    var capacityBits = getNumDataCodewords(ver, ecl) * 8;
    push(0, Math.min(4, capacityBits - bits.length));  /* 终止符 */
    push(0, (8 - bits.length % 8) % 8);                /* 补齐到整字节 */

    var out = [];
    for (var j = 0; j < bits.length; j += 8) {
      var b = 0;
      for (var k = 0; k < 8; k++) b = (b << 1) | bits[j + k];
      out.push(b);
    }
    var pad = [0xEC, 0x11], p = 0;
    while (out.length < getNumDataCodewords(ver, ecl)) out.push(pad[p++ % 2]);
    return out;
  }

  /* ---------------- 矩阵构建 ---------------- */
  function alignmentPositions(ver) {
    if (ver === 1) return [];
    var numAlign = Math.floor(ver / 7) + 2;
    var step = (ver === 32) ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2;
    var result = [6];
    for (var pos = ver * 4 + 10; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
    return result;
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

  function buildMatrix(codewords, ver, ecl, mask) {
    var size = ver * 4 + 17;
    var mod = [], fn = [];
    for (var y = 0; y < size; y++) {
      mod.push(new Array(size).fill(false));
      fn.push(new Array(size).fill(false));
    }
    function setFn(x, y2, dark) { mod[y2][x] = dark; fn[y2][x] = true; }
    function setFmt(bits) {
      for (var i = 0; i <= 5; i++) setFn(8, i, getBit(bits, i));
      setFn(8, 7, getBit(bits, 6));
      setFn(8, 8, getBit(bits, 7));
      setFn(7, 8, getBit(bits, 8));
      for (var i2 = 9; i2 < 15; i2++) setFn(14 - i2, 8, getBit(bits, i2));
      for (var i3 = 0; i3 < 8; i3++) setFn(size - 1 - i3, 8, getBit(bits, i3));
      for (var i4 = 8; i4 < 15; i4++) setFn(8, size - 15 + i4, getBit(bits, i4));
      setFn(8, size - 8, true);                        /* 固定黑点 */
    }

    /* 定位图形 + 分隔符 */
    function finder(cx, cy) {
      for (var dy = -4; dy <= 4; dy++) {
        for (var dx = -4; dx <= 4; dx++) {
          var dist = Math.max(Math.abs(dx), Math.abs(dy));
          var x = cx + dx, y2 = cy + dy;
          if (x >= 0 && x < size && y2 >= 0 && y2 < size) setFn(x, y2, dist !== 2 && dist !== 4);
        }
      }
    }
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);

    /* 定时图形 */
    for (var i = 0; i < size; i++) {
      if (!fn[6][i]) setFn(i, 6, i % 2 === 0);
      if (!fn[i][6]) setFn(6, i, i % 2 === 0);
    }

    /* 校正图形 */
    var pos = alignmentPositions(ver);
    for (var a = 0; a < pos.length; a++) {
      for (var b = 0; b < pos.length; b++) {
        if ((a === 0 && b === 0) || (a === 0 && b === pos.length - 1) || (a === pos.length - 1 && b === 0)) continue;
        for (var dy2 = -2; dy2 <= 2; dy2++) {
          for (var dx2 = -2; dx2 <= 2; dx2++) {
            setFn(pos[a] + dx2, pos[b] + dy2, Math.max(Math.abs(dx2), Math.abs(dy2)) !== 1);
          }
        }
      }
    }

    /* 先占位格式信息，稍后按掩码覆盖 */
    setFmt(0);

    /* 版本信息（v7 起） */
    if (ver >= 7) {
      var rem = ver;
      for (var t = 0; t < 12; t++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      var vbits = (ver << 12) | rem;
      for (var v = 0; v < 18; v++) {
        var bit = getBit(vbits, v);
        var aa = size - 11 + v % 3, bb = Math.floor(v / 3);
        setFn(aa, bb, bit);
        setFn(bb, aa, bit);
      }
    }

    /* 数据填充：从右下角蛇形向上 */
    var idx = 0, total = codewords.length * 8;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (var j = 0; j < 2; j++) {
          var x = right - j;
          var upward = ((right + 1) & 2) === 0;
          var yy = upward ? size - 1 - vert : vert;
          if (!fn[yy][x] && idx < total) {
            mod[yy][x] = getBit(codewords[idx >>> 3], 7 - (idx & 7));
            idx++;
          }
        }
      }
    }

    /* 掩码 */
    for (var y3 = 0; y3 < size; y3++) {
      for (var x3 = 0; x3 < size; x3++) {
        if (!fn[y3][x3] && maskHit(mask, x3, y3)) mod[y3][x3] = !mod[y3][x3];
      }
    }

    /* 真正的格式信息 */
    var data = (ECL_BITS[ecl] << 3) | mask;
    var rem2 = data;
    for (var i5 = 0; i5 < 10; i5++) rem2 = (rem2 << 1) ^ ((rem2 >>> 9) * 0x537);
    setFmt((data << 10) | rem2 ^ 0x5412);
    /* 注意：异或优先级低于移位，上式等于 ((data<<10)|rem2) ^ 0x5412，符合标准 */

    return { size: size, mod: mod, fn: fn };
  }

  /* ---------------- 罚分（标准四条规则）---------------- */
  function penalty(m, size) {
    var mod = m.mod, score = 0, x, y;

    function addHistory(len, hist) {
      if (hist[0] === 0) len += size;                  /* 首段补上静区 */
      hist.pop(); hist.unshift(len);
    }
    function countPatterns(h) {
      var n = h[1];
      var core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
      return (core && h[0] >= n * 4 && h[6] >= n ? 1 : 0) +
             (core && h[6] >= n * 4 && h[0] >= n ? 1 : 0);
    }

    for (y = 0; y < size; y++) {
      var color = false, run = 0, hist = [0, 0, 0, 0, 0, 0, 0];
      for (x = 0; x < size; x++) {
        if (mod[y][x] === color) {
          run++;
          if (run === 5) score += 3; else if (run > 5) score++;
        } else {
          addHistory(run, hist);
          if (!color) score += countPatterns(hist) * 40;
          color = mod[y][x]; run = 1;
        }
      }
      if (color) { addHistory(run, hist); run = 0; }
      run += size;
      addHistory(run, hist);
      score += countPatterns(hist) * 40;
    }

    for (x = 0; x < size; x++) {
      var color2 = false, run2 = 0, hist2 = [0, 0, 0, 0, 0, 0, 0];
      for (y = 0; y < size; y++) {
        if (mod[y][x] === color2) {
          run2++;
          if (run2 === 5) score += 3; else if (run2 > 5) score++;
        } else {
          addHistory(run2, hist2);
          if (!color2) score += countPatterns(hist2) * 40;
          color2 = mod[y][x]; run2 = 1;
        }
      }
      if (color2) { addHistory(run2, hist2); run2 = 0; }
      run2 += size;
      addHistory(run2, hist2);
      score += countPatterns(hist2) * 40;
    }

    for (y = 0; y < size - 1; y++) {
      for (x = 0; x < size - 1; x++) {
        var c = mod[y][x];
        if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) score += 3;
      }
    }

    var dark = 0;
    for (y = 0; y < size; y++) for (x = 0; x < size; x++) if (mod[y][x]) dark++;
    var totalPx = size * size;
    var k = Math.ceil(Math.abs(dark * 20 - totalPx * 10) / totalPx) - 1;
    score += k * 10;

    return score;
  }

  /* ---------------- 对外接口 ---------------- */
  function matrix(text, opts) {
    opts = opts || {};
    var ecl = opts.ecl || 'L';
    if (!ECC[ecl]) throw new Error('不支持的纠错等级：' + ecl);
    var bytes = utf8Bytes(String(text));

    var ver = 0;
    for (var v = 1; v <= 40; v++) {
      var cap = getNumDataCodewords(v, ecl) * 8;
      var need = 4 + (v <= 9 ? 8 : 16) + bytes.length * 8;
      if (need <= cap) { ver = v; break; }
    }
    if (!ver) throw new Error('内容太长，超过二维码容量上限');

    var data = encodeData(bytes, ver, ecl);
    var codewords = addEccAndInterleave(data, ver, ecl);

    var best = null;
    for (var mask = 0; mask < 8; mask++) {
      var built = buildMatrix(codewords, ver, ecl, mask);
      var score = penalty(built, built.size);
      if (!best || score < best.score) { best = { m: built, score: score, mask: mask }; }
    }

    var size = best.m.size;
    var flat = new Uint8Array(size * size);
    for (var y = 0; y < size; y++) {
      for (var x = 0; x < size; x++) flat[y * size + x] = best.m.mod[y][x] ? 1 : 0;
    }
    return { size: size, data: flat, version: ver, ecl: ecl, mask: best.mask };
  }

  /* 画到 canvas：白底黑块，四周留 4 模块静区 */
  function draw(canvas, text, opts) {
    opts = opts || {};
    var m = matrix(text, opts);
    var quiet = opts.quiet == null ? 4 : opts.quiet;
    var total = m.size + quiet * 2;
    var scale = opts.scale || Math.max(1, Math.floor(Math.min(canvas.width, canvas.height) / total));
    var px = total * scale;

    canvas.width = px;
    canvas.height = px;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = opts.dark || '#17150f';
    for (var y = 0; y < m.size; y++) {
      for (var x = 0; x < m.size; x++) {
        if (m.data[y * m.size + x]) {
          ctx.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
        }
      }
    }
    return m;
  }

  /* ECC / BLK 对外暴露，给 qrdec.js 复用同一份参数表 —— 两份表各写一遍迟早漂移 */
  return {
    matrix: matrix,
    draw: draw,
    version: function (t, o) { return matrix(t, o).version; },
    ECC: ECC,
    BLK: BLK,
    alignmentPositions: alignmentPositions
  };
});
