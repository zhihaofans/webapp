/* ============================================================
   lib/lanshare.js — 局域网直传的纯逻辑层

   这里只放「不碰 DOM、不碰 RTCPeerConnection」的东西，好在 Node 里单测：
     · 配对信息的打包 / 解包（JSON → deflate → base64url）
     · SAS 短码（两端 DTLS 指纹 → 6 位数字）
     · 分块与背压参数
     · 大小格式化

   为什么配对信息要压缩：它要整个塞进二维码。一段 data channel 的 SDP
   原始约 800-1000 字节，deflate-raw 之后通常能压到四成左右，二维码版本
   能从 v20 降到 v15 上下 —— 模块更少、格子更大，手机相机才扫得稳。

   压缩不可用时（老浏览器）自动退回不压缩，格式里用标志位区分，
   解包端不需要知道对方压没压。
   ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && root.Toolbox) root.Toolbox.LanShare = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var PREFIX = 'LS1';
  var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  function bytesToB64u(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 3) {
      var b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
      s += B64[b0 >> 2];
      s += B64[((b0 & 3) << 4) | ((b1 === undefined ? 0 : b1) >> 4)];
      if (b1 === undefined) break;
      s += B64[((b1 & 15) << 2) | ((b2 === undefined ? 0 : b2) >> 6)];
      if (b2 === undefined) break;
      s += B64[b2 & 63];
    }
    return s;
  }
  function b64uToBytes(str) {
    var out = [], buf = 0, bits = 0;
    for (var i = 0; i < str.length; i++) {
      var v = B64.indexOf(str[i]);
      if (v < 0) continue;
      buf = (buf << 6) | v; bits += 6;
      if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 0xFF); }
    }
    return new Uint8Array(out);
  }

  function utf8(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str);
    var s = unescape(encodeURIComponent(str)), a = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i);
    return a;
  }
  function fromUtf8(bytes) {
    if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(bytes);
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return decodeURIComponent(escape(s));
  }

  function deflateRaw(bytes) {
    if (typeof CompressionStream !== 'function') return Promise.resolve(null);
    try {
      var stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      return new Response(stream).arrayBuffer().then(function (ab) {
        return new Uint8Array(ab);
      }).catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  }
  function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') return Promise.reject(new Error('当前浏览器不支持解压'));
    try {
      var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Response(stream).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
    } catch (e) { return Promise.reject(e); }
  }

  /* 打包：LS1 + 压缩标志 + '.' + base64url */
  function pack(obj) {
    var json = JSON.stringify(obj);
    return deflateRaw(utf8(json)).then(function (z) {
      if (z && z.length && z.length < utf8(json).length) return PREFIX + 'z.' + bytesToB64u(z);
      return PREFIX + 'r.' + bytesToB64u(utf8(json));
    });
  }

  function unpack(text) {
    var s = String(text || '').trim();
    if (s.indexOf(PREFIX) !== 0) return Promise.reject(new Error('不是本工具的配对信息'));
    var flag = s.charAt(PREFIX.length);
    var body = s.slice(PREFIX.length + 2);
    var bytes = b64uToBytes(body);
    var p = flag === 'z' ? inflateRaw(bytes) : Promise.resolve(bytes);
    return p.then(function (raw) {
      try { return JSON.parse(fromUtf8(raw)); }
      catch (e) { throw new Error('配对信息已损坏'); }
    });
  }

  /* ---------------- SAS 短码 ----------------
     两端各自把「自己的 DTLS 指纹 + 对方的」排序后拼起来做 SHA-256，
     取前三个字节转成 6 位十进制。中间人替换指纹时两边会看到不同的码，
     核对一眼即可发现。排序是为了两端算出同一个值。
     注意：这里只用于「人眼比对」，安全性来自 DTLS 本身。 */
  function fingerprintOf(sdp) {
    var m = /a=fingerprint:\s*([^\r\n]+)/i.exec(String(sdp || ''));
    return m ? m[1].trim() : '';
  }

  function sas(fpA, fpB) {
    var pair = [String(fpA || ''), String(fpB || '')].sort().join('|');
    if (typeof crypto === 'undefined' || !crypto.subtle) {
      /* 没有 SubtleCrypto 时退化为简单哈希（仅用于显示，不参与加密） */
      var h = 0;
      for (var i = 0; i < pair.length; i++) h = (h * 31 + pair.charCodeAt(i)) >>> 0;
      return Promise.resolve(String(h % 1000000).padStart(6, '0'));
    }
    return crypto.subtle.digest('SHA-256', utf8(pair)).then(function (buf) {
      var b = new Uint8Array(buf);
      var n = ((b[0] << 16) | (b[1] << 8) | b[2]) % 1000000;
      return String(n).padStart(6, '0');
    });
  }
  function sasPretty(code) {
    var c = String(code || '');
    return c.length === 6 ? c.slice(0, 3) + ' ' + c.slice(3) : c;
  }

  /* ---------------- 传输参数 ---------------- */
  var CHUNK = 16 * 1024;          /* 16 KB：各浏览器 DataChannel 都稳 */
  var HIGH_WATER = 4 * 1024 * 1024;
  var LOW_WATER = 64 * 1024;
  var MAX_FILE = 2 * 1024 * 1024 * 1024;   /* 2 GB：再大浏览器内存吃不住 */

  function fmtSize(n) {
    if (n == null || !isFinite(n)) return '';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1048576).toFixed(n < 10485760 ? 1 : 0) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  }

  /* 从 SDP 里挑出候选数量，用于界面上提示「只走局域网」 */
  function countHostCandidates(sdp) {
    var m = String(sdp || '').match(/a=candidate:[^\r\n]*typ host/gi);
    return m ? m.length : 0;
  }
  function hasRelay(sdp) {
    return /typ relay/i.test(String(sdp || ''));
  }

  /* 版本号比较：'1.14' 与 '1.14.1' 视为不同，缺的段按 0 补。
     配对时两端版本不一致，分块与消息格式可能对不上，最好早点提示。 */
  function cmpVer(a, b) {
    var pa = String(a || '').split('.');
    var pb = String(b || '').split('.');
    var n = Math.max(pa.length, pb.length);
    for (var i = 0; i < n; i++) {
      var x = parseInt(pa[i], 10) || 0;
      var y = parseInt(pb[i], 10) || 0;
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  }

  return {
    pack: pack, unpack: unpack,
    cmpVer: cmpVer,
    sas: sas, sasPretty: sasPretty, fingerprintOf: fingerprintOf,
    fmtSize: fmtSize, countHostCandidates: countHostCandidates, hasRelay: hasRelay,
    CHUNK: CHUNK, HIGH_WATER: HIGH_WATER, LOW_WATER: LOW_WATER, MAX_FILE: MAX_FILE,
    _bytesToB64u: bytesToB64u, _b64uToBytes: b64uToBytes
  };
});
