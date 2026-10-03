/* ============================================================
   纯逻辑用例：node test/github2jsdelivr.test.js
   默认只跑离线用例（不打网络）；加 --online 追加真实 GitHub API 用例。

   之所以能这样跑，是因为 js/lib/github2jsdelivr.js 不碰 DOM、
   也带了 CommonJS 导出 —— 转换逻辑和界面从第一天就是分开的。
   ============================================================ */
'use strict';

var ONLINE = process.argv.indexOf('--online') !== -1;
var REAL_FETCH = globalThis.fetch;
var OFFLINE = true;
globalThis.fetch = function () {
  return OFFLINE ? Promise.reject(new Error('offline')) : REAL_FETCH.apply(null, arguments);
};

var G = require('../js/lib/github2jsdelivr.js');

var pass = 0, fail = 0;
function check(name, got, want) {
  var ok = got === want;
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + name);
  if (!ok) console.log('         期望: ' + want + '\n         实际: ' + got);
}

/* ---- 离线：输入 → 输出（resolve 关闭，等价于分支行为） ---- */
var CASES = [
  ['https://github.com/jquery/jquery/blob/main/dist/jquery.min.js',
   'https://cdn.jsdelivr.net/gh/jquery/jquery@main/dist/jquery.min.js'],
  ['https://github.com/jquery/jquery/raw/main/dist/jquery.min.js',
   'https://cdn.jsdelivr.net/gh/jquery/jquery@main/dist/jquery.min.js'],
  ['https://raw.githubusercontent.com/jquery/jquery/main/dist/jquery.min.js',
   'https://cdn.jsdelivr.net/gh/jquery/jquery@main/dist/jquery.min.js'],
  ['https://github.com/jquery/jquery',
   'https://cdn.jsdelivr.net/gh/jquery/jquery/'],
  ['https://github.com/user/repo/blob/latest/app.js',
   'https://cdn.jsdelivr.net/gh/user/repo/app.js'],
  ['https://github.com/user/repo/blob/8b7fbe7a2b3e0d4a3f2e1c0b9a8d7e6f5c4b3a21/app.js',
   'https://cdn.jsdelivr.net/gh/user/repo@8b7fbe7a2b3e0d4a3f2e1c0b9a8d7e6f5c4b3a21/app.js'],
  /* 参考实现补强的地方 */
  ['https://github.com/user/repo/blob/main/src/a.js#L10-L20',
   'https://cdn.jsdelivr.net/gh/user/repo@main/src/a.js'],
  ['https://github.com/user/repo/blob/main/a.js?raw=true',
   'https://cdn.jsdelivr.net/gh/user/repo@main/a.js'],
  ['https://github.com/user/repo/tree/main/src',
   'https://cdn.jsdelivr.net/gh/user/repo@main/src'],
  ['https://www.github.com/user/repo/blob/main/a.js',
   'https://cdn.jsdelivr.net/gh/user/repo@main/a.js'],
  ['https://github.com/user/repo.git/blob/main/a.js',
   'https://cdn.jsdelivr.net/gh/user/repo@main/a.js'],
  ['  https://github.com/user/repo/blob/main/a.js  ',
   'https://cdn.jsdelivr.net/gh/user/repo@main/a.js']
];

/* latest 显式保留版本段 */
var OMIT_CASE = ['https://github.com/user/repo/blob/latest/app.js',
  'https://cdn.jsdelivr.net/gh/user/repo@latest/app.js'];

var BAD = ['', 'not a url', 'https://gitlab.com/a/b', 'https://github.com/onlyuser'];

function classifyCase(url, want) {
  var p = G.parse(url);
  check('归类 ' + want + '  <- ' + url, G.classify(p), want);
}

(async function () {
  console.log('── 离线：输入 → 输出 ──');
  for (var i = 0; i < CASES.length; i++) {
    var r = await G.convert(CASES[i][0], { resolve: false });
    check(CASES[i][0], r.output || ('错误: ' + r.error), CASES[i][1]);
  }

  console.log('\n── latest 省略开关 ──');
  var rKeep = await G.convert(OMIT_CASE[0], { resolve: false, omitLatest: false });
  check('omitLatest=false 时保留 @latest', rKeep.output, OMIT_CASE[1]);

  console.log('\n── 非法输入一律报错，不产出链接 ──');
  for (var j = 0; j < BAD.length; j++) {
    var rb = await G.convert(BAD[j], { resolve: false });
    check('拒绝 "' + BAD[j] + '"', String(rb.output === null && !!rb.error), 'true');
  }

  console.log('\n── 版本归类 ──');
  classifyCase('https://github.com/u/r', 'repo');
  classifyCase('https://github.com/u/r/blob/latest/a.js', 'latest');
  classifyCase('https://github.com/u/r/blob/8b7fbe7a2b3e0d4a3f2e1c0b9a8d7e6f5c4b3a21/a.js', 'commit');
  classifyCase('https://github.com/u/r/blob/main/a.js', 'unknown');

  console.log('\n── 去重与拆行 ──');
  check('拆行去空去重', G.splitLinks('a\n\n b \na\n').join('|'), 'a|b');

  if (ONLINE) {
    OFFLINE = false;
    console.log('\n── 在线：真实 GitHub API ──');
    var t = await G.convert('https://github.com/jquery/jquery/blob/3.7.1/dist/jquery.min.js');
    check('tag 校验通过且保持原样', String(t.meta.verified && t.meta.kind === 'ref' && t.output.indexOf('@3.7.1/') > 0), 'true');

    var sh = await G.convert('https://github.com/jquery/jquery/blob/f79d5f1/dist/jquery.min.js');
    check('短 hash 补全为 40 位 commit', String(sh.meta.expanded && /@[0-9a-f]{40}\//.test(sh.output)), 'true');

    var miss = await G.convert('https://github.com/jquery/jquery/blob/not-a-real-branch-xyz/a.js');
    check('不存在的 ref 退回未校验但链接仍可用',
      String(!miss.meta.verified && miss.output.indexOf('@not-a-real-branch-xyz/') > 0), 'true');
  } else {
    console.log('\n（加 --online 可追加真实 GitHub API 用例）');
  }

  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})();
