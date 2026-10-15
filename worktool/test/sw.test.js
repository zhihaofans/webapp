/* ============================================================
   Service Worker 取数策略用例：node test/sw.test.js

   为什么值得单独测：这块的 bug 全都只在真机、只在冷启动那一瞬间出现，
   本地随便点几下页面根本复现不了 —— v1.13.3 那个「iPhone 主屏启动纯白
   1-2 秒」就是这么漏过去的。

   sw.js 不碰 DOM，只在顶层调 self.addEventListener，所以可以用 vm 把它
   装进一个桩宿主里跑：手写一个内存版 Cache Storage，再给一个可以控制
   快慢的 fetch，就能精确复现「缓存里有货、网络要等 2 秒」这种场景。

   核心断言只有一句：缓存里有页面时，导航请求**不许等网络**。
   ============================================================ */
'use strict';

var fs = require('fs');
var vm = require('vm');
var path = require('path');

var CODE = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
var CACHE = /var CACHE = '([^']+)'/.exec(CODE)[1];
var ORIGIN = 'https://zhihaofans.github.io';
var BASE = ORIGIN + '/webapp/worktool/';

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

/* ---------------- 桩：内存版 Cache Storage ---------------- */
/* 相对键按真机规则解析：'index.html' / './' 都相对 SW 脚本所在目录 */
function norm(key) {
  if (typeof key !== 'string') return key.url;
  if (/^https?:/.test(key)) return key;
  if (key === './' || key === '.') return BASE;
  return BASE + key.replace(/^\.\//, '');
}

function makeCache(store) {
  return {
    match: function (req, opts) {
      var want = norm(req);
      if (store[want]) return Promise.resolve(store[want].clone());
      if (opts && opts.ignoreSearch) {
        var base = want.split('?')[0];
        var keys = Object.keys(store);
        for (var i = 0; i < keys.length; i++) {
          if (keys[i].split('?')[0] === base) return Promise.resolve(store[keys[i]].clone());
        }
      }
      return Promise.resolve(undefined);
    },
    put: function (req, res) {
      store[norm(req)] = res.clone();
      return Promise.resolve();
    },
    add: function () { return Promise.resolve(); }
  };
}

/* ---------------- 桩：可控制快慢的 fetch ---------------- */
var netCalls = 0;
var netDelay = 0;
var netFail = false;
function setNet(delay, fail) { netDelay = delay; netFail = !!fail; netCalls = 0; }

function makeHarness(seed) {
  var store = {};
  (seed || []).forEach(function (pair) {
    store[norm(pair[0])] = new Response(pair[1], { status: 200, headers: { 'Content-Type': 'text/html' } });
  });

  var handlers = {};
  var sandbox = {
    console: console,
    Response: Response,
    Request: Request,
    URL: URL,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    Promise: Promise,
    caches: {
      open: function () { return Promise.resolve(makeCache(store)); },
      keys: function () { return Promise.resolve([CACHE]); },
      delete: function () { return Promise.resolve(true); }
    },
    fetch: function (req) {
      netCalls++;
      return new Promise(function (resolve, reject) {
        setTimeout(function () {
          if (netFail) return reject(new Error('net down'));
          resolve(new Response('FROM-NETWORK', { status: 200 }));
        }, netDelay);
      });
    },
    self: {
      location: { origin: ORIGIN, href: BASE + 'sw.js' },
      addEventListener: function (type, fn) { handlers[type] = fn; },
      skipWaiting: function () {},
      clients: { claim: function () {} }
    }
  };
  sandbox.self.self = sandbox.self;
  vm.runInNewContext(CODE, sandbox, { filename: 'sw.js' });
  return { handlers: handlers, store: store };
}

/* navigate 模式在规范里不可构造（只有浏览器导航会产生），
   这里先造一个普通 Request，再在实例上覆盖 mode 把它伪装成导航请求。 */
function makeReq(url, mode) {
  var nav = mode === 'navigate';
  var r = new Request(url, { mode: nav ? 'same-origin' : (mode || 'cors') });
  if (nav) Object.defineProperty(r, 'mode', { value: 'navigate' });
  return r;
}

/* 跑一次请求，返回 { ms, body } —— body 为 null 表示没调 respondWith */
function runFetch(handlers, url, mode) {
  return new Promise(function (resolve) {
    var ev = {
      request: makeReq(url, mode),
      respondWith: function (p) {
        var t0 = Date.now();
        Promise.resolve(p).then(function (res) {
          res.text().then(function (body) {
            resolve({ ms: Date.now() - t0, body: body });
          });
        }, function () { resolve({ ms: Date.now() - t0, body: '<<reject>>' }); });
      },
      waitUntil: function () {}
    };
    handlers.fetch(ev);
    setTimeout(function () { resolve({ ms: -1, body: null }); }, 3000);
  });
}

(async function main() {

  console.log('\n── 导航：缓存热 + 网络 2 秒（v1.13.3 之前会等满 1500ms 上限）──');
  {
    var h = makeHarness([['index.html', 'CACHED-HTML']]);
    setNet(2000);
    var r = await runFetch(h.handlers, BASE + 'index.html', 'navigate');
    check('内容来自缓存', r.body, 'CACHED-HTML');
    checkTrue('没有等网络（<100ms，实际 ' + r.ms + 'ms）', r.ms < 100, '缓存里有货却在等网络 = 白屏');
  }

  console.log('\n── 导航：缓存热 + 网络 300ms（对照：旧实现会白等满 300ms）──');
  {
    var h = makeHarness([['index.html', 'CACHED-HTML']]);
    setNet(300);
    var r = await runFetch(h.handlers, BASE + 'index.html', 'navigate');
    check('内容来自缓存', r.body, 'CACHED-HTML');
    checkTrue('没有等那 300ms（实际 ' + r.ms + 'ms）', r.ms < 100);
    checkTrue('后台仍然发起了网络请求（回填缓存用）', netCalls > 0);
  }

  console.log('\n── 导航：启动地址与缓存键不一致，但壳页面在 ──');
  {
    var h = makeHarness([['index.html', 'CACHED-HTML']]);
    setNet(2000);
    var r = await runFetch(h.handlers, BASE, 'navigate');   /* 落在站点根目录 */
    check('兜底给出 index.html', r.body, 'CACHED-HTML');
    checkTrue('没有等网络（实际 ' + r.ms + 'ms）', r.ms < 100);
  }

  console.log('\n── 导航：缓存全空（首次访问）──');
  {
    var h = makeHarness([]);
    setNet(20);
    var r = await runFetch(h.handlers, BASE + 'index.html', 'navigate');
    check('走网络', r.body, 'FROM-NETWORK');
  }

  console.log('\n── 导航：缓存空 + 网络挂掉 → 给出可读提示而不是白屏 ──');
  {
    var h = makeHarness([]);
    setNet(10, true);
    var r = await runFetch(h.handlers, BASE + 'index.html', 'navigate');
    checkTrue('返回离线提示（不是 null）', r.body && r.body !== '', '拿不到响应就是白屏');
  }

  console.log('\n── CSS：缓存热 + 网络 2 秒 ──');
  {
    var h = makeHarness([['assets/css/base.css', 'body{color:red}']]);
    setNet(2000);
    var r = await runFetch(h.handlers, BASE + 'assets/css/base.css');
    check('内容来自缓存', r.body, 'body{color:red}');
    checkTrue('没有等网络（实际 ' + r.ms + 'ms）', r.ms < 100, 'CSS 阻塞渲染，等它就是白屏');
  }

  console.log('\n── 脚本：网络通畅时用网络结果（换版即生效的保证）──');
  {
    var h = makeHarness([['js/core.js', 'OLD-CORE']]);
    setNet(20);
    var r = await runFetch(h.handlers, BASE + 'js/core.js');
    check('用了网络的新代码', r.body, 'FROM-NETWORK');
  }

  console.log('\n── 脚本：网络卡住 → 600ms 上限后回退缓存 ──');
  {
    var h = makeHarness([['js/core.js', 'OLD-CORE']]);
    setNet(2000);
    var r = await runFetch(h.handlers, BASE + 'js/core.js');
    check('回退到缓存', r.body, 'OLD-CORE');
    checkTrue('耗时在 550-900ms 之间（实际 ' + r.ms + 'ms）', r.ms >= 550 && r.ms < 900);
  }

  console.log('\n── 不该拦的请求 ──');
  {
    var h = makeHarness([['index.html', 'CACHED-HTML']]);
    setNet(20);
    var cross = await runFetch(h.handlers, 'https://api.github.com/repos/a/b', 'cors');
    check('跨域请求放行（未调用 respondWith）', cross.body, null);
    var probe = await runFetch(h.handlers, BASE + 'version.json');
    check('version.json 放行（它是版本探针）', probe.body, null);
  }

  console.log('\n==============================================');
  console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  if (fail) process.exitCode = 1;

})();
