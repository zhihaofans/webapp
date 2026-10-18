/* ============================================================
   局域网直传的纯逻辑用例：node test/lanshare.test.js

   只测 lib/lanshare.js（打包、SAS、指纹、格式化）。真正的 WebRTC 连接
   没法在 Node 里测 —— 那部分由 tools/check-lanshare.py 用两个真实浏览器
   页面端到端跑完（发起 → 应答 → 连接 → SAS 一致 → 传文本 → 传文件）。

   这里最要紧的两条：
     · 打包/解包必须无损，而且压缩与不压缩两条路都要能解；
     · SAS 必须「两端算出同一个值」—— 排序就是为了这个，
       漏了排序，两台设备会显示不同的码，用户会误以为被中间人攻击。
   ============================================================ */
'use strict';

var LS = require('../js/lib/lanshare.js');

var pass = 0, fail = 0;
function check(name, got, want) {
  var ok = got === want;
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + name);
  if (!ok) console.log('         期望: ' + want + '\n         实际: ' + got);
}
function checkTrue(name, got, why) {
  var ok = !!got;
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + name);
  if (!ok && why) console.log('         ' + why);
}

var SDP_OFFER = [
  'v=0', 'o=- 1234567890 2 IN IP4 127.0.0.1', 's=-', 't=0 0',
  'a=group:BUNDLE 0',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=candidate:1 1 udp 2113937151 192.168.1.7 51234 typ host generation 0',
  'a=candidate:2 1 udp 2113939711 a1b2c3d4.local 51235 typ host generation 0',
  'a=ice-ufrag:AbCd',
  'a=ice-pwd:0123456789abcdef0123456789abcdef',
  'a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99',
  'a=setup:actpass', 'a=mid:0', 'a=sctp-port:5000'
].join('\r\n');

(async function main() {

  console.log('\n── 打包 / 解包 ──');
  {
    var obj = { k: 'offer', sdp: SDP_OFFER };
    var packed = await LS.pack(obj);
    checkTrue('带 LS1 前缀', packed.indexOf('LS1') === 0, '实际: ' + packed.slice(0, 16));
    checkTrue('base64url 不含 + / =', !/[+/=]/.test(packed.slice(4)), '会把 URL 弄坏');
    var back = await LS.unpack(packed);
    check('类型还原', back.k, 'offer');
    check('SDP 逐字节还原', back.sdp, SDP_OFFER);
    console.log('        原始 ' + JSON.stringify(obj).length + ' 字节 → 打包后 ' + packed.length + ' 字符');
  }

  console.log('\n── 解包异常输入 ──');
  {
    var e1 = null;
    await LS.unpack('hello world').catch(function (e) { e1 = e; });
    checkTrue('非本工具内容被拒绝', !!e1);
    var e2 = null;
    await LS.unpack('LS1z.%%%%').catch(function (e) { e2 = e; });
    checkTrue('损坏内容被拒绝', !!e2);
  }

  console.log('\n── SAS 短码 ──');
  {
    var fpA = LS.fingerprintOf(SDP_OFFER);
    checkTrue('能从 SDP 里取出指纹', fpA.indexOf('sha-256') === 0, '实际: ' + fpA);
    var fpB = 'sha-256 11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD:EE:FF:11:22:33:44:55:66:77:88:99:00:AA:BB:CC:DD:EE:FF';
    var ab = await LS.sas(fpA, fpB);
    var ba = await LS.sas(fpB, fpA);
    check('两端算出同一个值（顺序无关）', ab, ba);
    check('是 6 位数字', /^\d{6}$/.test(ab), true);
    check('显示成 3+3', LS.sasPretty(ab).replace(' ', ''), ab);
    var other = await LS.sas(fpA, 'sha-256 00:00');
    checkTrue('指纹不同则码不同', other !== ab);
  }

  console.log('\n── SDP 候选分析 ──');
  {
    check('数出 host 候选', LS.countHostCandidates(SDP_OFFER), 2);
    check('没有 relay', LS.hasRelay(SDP_OFFER), false);
    check('识别 relay', LS.hasRelay('a=candidate:1 1 udp 1 1.2.3.4 5 typ relay'), true);
  }

  console.log('\n── 体积格式化 ──');
  {
    check('字节', LS.fmtSize(512), '512 B');
    check('KB', LS.fmtSize(2048), '2.0 KB');
    check('MB', LS.fmtSize(5 * 1048576), '5.0 MB');
    check('GB', LS.fmtSize(2 * 1073741824), '2.00 GB');
  }

  console.log('\n── base64url 往返 ──');
  {
    var okAll = true;
    for (var len = 0; len < 300; len += 7) {
      var src = new Uint8Array(len);
      for (var i = 0; i < len; i++) src[i] = (i * 37 + len) & 0xFF;
      var enc = LS._bytesToB64u(src);
      var dec = LS._b64uToBytes(enc);
      if (dec.length !== src.length) { okAll = false; break; }
      for (var j = 0; j < src.length; j++) if (dec[j] !== src[j]) { okAll = false; break; }
      if (!okAll) break;
    }
    checkTrue('0-300 字节随机长度无损往返', okAll);
  }

  console.log('\n==============================================');
  console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  if (fail) process.exitCode = 1;
})();
