/* ============================================================
   WebP 编码器的状态机用例：node test/webpenc.test.js

   只测状态流转，不测真的编码（那要跑 wasm，交给浏览器）。

   为什么要单测这个：webpenc.js 里 start() 是一次性的
   （state !== 'idle' 就直接 return），所以一旦判成 failed 就永远翻不了身。
   这次的 bug 就出在这条边上 —— 「重新检测」按钮点下去毫无作用，
   因为失败态根本没有重置的入口。reset() 补的就是这个缺口，
   而状态机的正确性用眼睛看代码是看不出来的。

   Worker 与 WebAssembly 都是桩，按需造出「就绪 / 初始化报错」两种宿主。
   ============================================================ */
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var CODE = fs.readFileSync(path.join(__dirname, '..', 'js', 'lib', 'webpenc.js'), 'utf8');

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

/* 造一个宿主。mode 是可变对象，中途能改，用来模拟「重试时网络恢复了」 */
function makeHost(opts) {
  opts = opts || {};
  var env = { mode: opts.mode || 'ready' };
  var workers = [];

  function FakeWorker(url, o) {
    var self = this;
    this.url = url;
    this.options = o;
    this.terminated = false;
    this.sent = [];
    this.postMessage = function (msg) {
      self.sent.push(msg);
      if (msg.type !== 'init') return;
      setTimeout(function () {
        if (self.terminated) return;                 /* 拆掉的 Worker 不该再说话 */
        if (env.mode === 'ready') self.onmessage({ data: { type: 'ready', simd: true } });
        else if (env.mode === 'init-error') self.onmessage({ data: { type: 'init-error', message: 'wasm 拉不下来' } });
        /* mode === 'silent'：什么都不回，走超时分支（本用例不测，25 秒太久） */
      }, 0);
    };
    this.terminate = function () { self.terminated = true; };
    workers.push(this);
  }

  /* 注意：WebAssembly 是 V8 的内建全局，新 context 里照样存在，
     单纯「不放进沙箱」删不掉它 —— 必须显式赋 undefined 遮蔽掉。 */
  var sandbox = {
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    Promise: Promise,
    WebAssembly: opts.withWebAssembly === false ? undefined : {},
    Worker: opts.withWorker === false ? undefined : FakeWorker,
    window: { Toolbox: {} }
  };

  vm.runInNewContext(CODE, sandbox, { filename: 'webpenc.js' });
  return { enc: sandbox.window.Toolbox.WebpEnc, env: env, workers: workers };
}

(async function main() {

  console.log('\n── 静态能力判断 ──');
  {
    var h = makeHost({ withWebAssembly: false });
    check('没有 WebAssembly → supported() 为 false', h.enc.supported(), false);
    h.enc.warmup();
    check('并如实置为 failed', h.enc.status(), 'failed');
    check('原因说得清楚', h.enc.reason(), '当前浏览器缺少 WebAssembly 或 Worker');
  }
  {
    var h2 = makeHost({ withWorker: false });
    check('没有 Worker → supported() 为 false', h2.enc.supported(), false);
  }

  console.log('\n── 正常路径：idle → loading → ok ──');
  {
    var h3 = makeHost({ mode: 'ready' });
    check('初始为 idle', h3.enc.status(), 'idle');
    checkTrue('supported() 为 true', h3.enc.supported());
    await h3.enc.whenReady();
    check('加载完成后为 ok', h3.enc.status(), 'ok');
    check('Worker 按 module 方式创建', h3.workers[0].options && h3.workers[0].options.type, 'module');
  }

  console.log('\n── 失败路径：初始化报错 ──');
  {
    var h4 = makeHost({ mode: 'init-error' });
    var err = null;
    await h4.enc.whenReady().catch(function (e) { err = e; });
    check('状态为 failed', h4.enc.status(), 'failed');
    checkTrue('whenReady 被拒绝', !!err);
    check('原因透传给调用方', h4.enc.reason(), 'wasm 拉不下来');
  }

  console.log('\n── 幂等：重复调用不会重复创建 Worker ──');
  {
    var h5 = makeHost({ mode: 'ready' });
    await h5.enc.whenReady();
    await h5.enc.whenReady();
    h5.enc.warmup();
    check('只创建了一个 Worker', h5.workers.length, 1);
  }

  console.log('\n── reset()：失败之后还能重来（本次修复的核心）──');
  {
    var h6 = makeHost({ mode: 'init-error' });
    await h6.enc.whenReady().catch(function () {});
    check('先失败', h6.enc.status(), 'failed');

    /* 没有 reset() 的话，这一步之后的 whenReady 会直接抛上一次那个死结论 */
    h6.enc.reset();
    check('reset 后回到 idle', h6.enc.status(), 'idle');
    check('原因被清空', h6.enc.reason(), '');
    checkTrue('旧的 Worker 被拆掉', h6.workers[0].terminated);

    h6.env.mode = 'ready';                 /* 模拟重试时网络恢复了 */
    var retryErr = null;
    await h6.enc.whenReady().catch(function (e) { retryErr = e; });
    check('重试后成功', h6.enc.status(), 'ok');
    checkTrue('重试没有报错' + (retryErr ? '（' + retryErr.message + '）' : ''), !retryErr);
    check('确实新建了 Worker', h6.workers.length, 2);
  }

  console.log('\n── reset() 与在途请求 ──');
  {
    var h7 = makeHost({ mode: 'init-error' });
    var inFlight = h7.enc.encode({ data: new Uint8Array(4), width: 1, height: 1 }, {});
    var rejected = false;
    inFlight.catch(function () { rejected = true; });
    await new Promise(function (r) { setTimeout(r, 5); });
    h7.enc.reset();
    await new Promise(function (r) { setTimeout(r, 5); });
    checkTrue('在途请求被作废，不会永远挂着', rejected);
  }

  console.log('\n==============================================');
  console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  if (fail) process.exitCode = 1;

})();
