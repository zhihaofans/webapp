/* ============================================================
   纯逻辑用例：node test/ghmirror.test.js
   全部离线 —— 镜像地址是纯字符串拼接，本来就不该联网。

   之所以能这样跑，是因为 js/lib/ghmirror.js 不碰 DOM、带了 CommonJS
   导出，并且只复用同样零依赖的 github2jsdelivr.js 做 URL 解析。
   ============================================================ */
'use strict';

/* ghmirror 依赖 GitHub2JsDelivr 的 parse，必须先加载它 */
require('../js/lib/github2jsdelivr.js');
var M = require('../js/lib/ghmirror.js');

var pass = 0, fail = 0;
function check(name, got, want) {
  var ok = got === want;
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + name);
  if (!ok) console.log('         期望: ' + want + '\n         实际: ' + got);
}
function checkTrue(name, got) { check(name, !!got, true); }

var FILE = 'https://github.com/jquery/jquery/blob/main/dist/jquery.min.js';

/* ---------- ① 前缀代理 ---------- */
console.log('\n── 前缀代理 ──');
var r = M.convert(FILE);
check('代理数量 = 定义数量', r.proxies.length, M.PROXIES.length);
check('首位是 gh-proxy',
  r.proxies[0].url,
  'https://gh-proxy.com/https://github.com/jquery/jquery/raw/main/dist/jquery.min.js');
check('blob 被换成 /raw/ 形式（下载要的是文件不是网页）',
  r.rawUrl, 'https://github.com/jquery/jquery/raw/main/dist/jquery.min.js');
check('ghfast 拼接正确',
  r.proxies[1].url,
  'https://ghfast.top/https://github.com/jquery/jquery/raw/main/dist/jquery.min.js');
checkTrue('每条代理都带 url', r.proxies.every(function (m) { return /^https:\/\//.test(m.url); }));
checkTrue('每条代理都有名字和说明',
  r.proxies.every(function (m) { return m.name && m.note; }));
checkTrue('镜像域名两两不同',
  new Set(r.proxies.map(function (m) { return m.url.split('/')[2]; })).size === r.proxies.length);

/* ---------- ② CDN 重写 ---------- */
console.log('\n── CDN 重写 ──');
check('CDN 数量 = 定义数量', r.cdns.length, M.CDNS.length);
check('jsDelivr 使用 @ref 形式',
  r.cdns[0].url, 'https://cdn.jsdelivr.net/gh/jquery/jquery@main/dist/jquery.min.js');
check('GitHack 使用 /ref/ 形式',
  (r.cdns.filter(function (c) { return c.id === 'githack'; })[0] || {}).url,
  'https://rawcdn.githack.com/jquery/jquery/main/dist/jquery.min.js');
check('Statically 使用 @ref 形式',
  (r.cdns.filter(function (c) { return c.id === 'statically'; })[0] || {}).url,
  'https://cdn.statically.io/gh/jquery/jquery@main/dist/jquery.min.js');
check('总量 = 代理 + CDN', r.total, r.proxies.length + r.cdns.length);

/* ---------- ③ 各种输入形态 ---------- */
console.log('\n── 输入形态归一 ──');
var rawHost = M.convert('https://raw.githubusercontent.com/jquery/jquery/main/dist/jquery.min.js');
check('raw 域名输入原样代理（它本身就是取文件的地址）',
  rawHost.proxies[0].url,
  'https://gh-proxy.com/https://raw.githubusercontent.com/jquery/jquery/main/dist/jquery.min.js');
check('raw 域名输入同样能生成 CDN',
  rawHost.cdns[0].url, 'https://cdn.jsdelivr.net/gh/jquery/jquery@main/dist/jquery.min.js');
check('行号锚点被剥离',
  M.convert('https://github.com/u/r/blob/main/a.js#L10-L20').cdns[0].url,
  'https://cdn.jsdelivr.net/gh/u/r@main/a.js');
check('?raw=true 被剥离',
  M.convert('https://github.com/u/r/blob/main/a.js?raw=true').cdns[0].url,
  'https://cdn.jsdelivr.net/gh/u/r@main/a.js');
check('www. 前缀可用',
  M.convert('https://www.github.com/u/r/blob/main/a.js').proxies.length, M.PROXIES.length);
check('.git 后缀被去掉',
  M.convert('https://github.com/u/r.git/blob/main/a.js').cdns[0].url,
  'https://cdn.jsdelivr.net/gh/u/r@main/a.js');
check('首尾空格被容忍',
  M.convert('  https://github.com/u/r/blob/main/a.js  ').cdns[0].url,
  'https://cdn.jsdelivr.net/gh/u/r@main/a.js');

/* ---------- ④ 目录与仓库根 ---------- */
console.log('\n── 目录 / 仓库根 ──');
var tree = M.convert('https://github.com/twbs/bootstrap/tree/v5.3.3/dist');
check('目录保持原样，不转 /raw/',
  tree.rawUrl, 'https://github.com/twbs/bootstrap/tree/v5.3.3/dist');
check('目录仍给代理', tree.proxies.length, M.PROXIES.length);
checkTrue('目录跳过 GitHack（它不支持目录）',
  tree.cdns.every(function (c) { return c.id !== 'githack'; }));
check('目录的 CDN 数量 = 总数 - 1', tree.cdns.length, M.CDNS.length - 1);
check('目录仍可用 jsDelivr（支持目录）',
  (tree.cdns.filter(function (c) { return c.id === 'jsdelivr'; })[0] || {}).url,
  'https://cdn.jsdelivr.net/gh/twbs/bootstrap@v5.3.3/dist');

var repoOnly = M.convert('https://github.com/microsoft/TypeScript');
check('只有仓库时仍给代理', repoOnly.proxies.length, M.PROXIES.length);
check('只有仓库时不给 CDN（没有文件路径）', repoOnly.cdns.length, 0);
check('仓库根代理用原链接',
  repoOnly.proxies[0].url, 'https://gh-proxy.com/https://github.com/microsoft/TypeScript');

var latest = M.convert('https://github.com/u/r/blob/latest/a.js');
check('latest 在 CDN 里保留 @latest', latest.cdns[0].url,
  'https://cdn.jsdelivr.net/gh/u/r@latest/a.js');

/* ---------- ⑤ 非仓库文件：Release 与源码包 ---------- */
console.log('\n── Release 与源码包 ──');
var rel = M.convert('https://github.com/git-for-windows/git/releases/download/v2.44.0.windows.1/Git-2.44.0-64-bit.exe');
check('Release 链接保持原样，不转 /raw/',
  rel.rawUrl, 'https://github.com/git-for-windows/git/releases/download/v2.44.0.windows.1/Git-2.44.0-64-bit.exe');
check('Release 仍给全套代理', rel.proxies.length, M.PROXIES.length);
check('Release 不给 CDN（CDN 取不到附件）', rel.cdns.length, 0);

var arc = M.convert('https://github.com/torvalds/linux/archive/refs/heads/master.zip');
check('archive 链接保持原样', arc.rawUrl, 'https://github.com/torvalds/linux/archive/refs/heads/master.zip');
check('archive 不给 CDN', arc.cdns.length, 0);
check('archive 代理拼接正确',
  arc.proxies[0].url, 'https://gh-proxy.com/https://github.com/torvalds/linux/archive/refs/heads/master.zip');

/* ---------- ⑥ 非法输入 ---------- */
console.log('\n── 非法输入 ──');
['', 'not a url', 'https://gitlab.com/a/b', 'https://github.com/onlyuser'].forEach(function (bad) {
  var x = M.convert(bad);
  check('拒绝: ' + (bad || '(空)'), x.ok, false);
  check('  且不给代理结果: ' + (bad || '(空)'), x.proxies.length, 0);
  checkTrue('  且给出可读原因: ' + (bad || '(空)'), x.error && x.error.length > 4);
});

/* ---------- ⑦ latest 省略与按 ref 重建 ---------- */
console.log('\n── latest 省略与按 ref 重建 ──');
var lat2 = M.convert('https://github.com/u/r/blob/latest/a.js', { omitLatest: true });
check('开启省略后 jsDelivr 去掉版本段',
  lat2.cdns[0].url, 'https://cdn.jsdelivr.net/gh/u/r/a.js');
check('GitHack 不受影响（不是 jsDelivr 系）',
  (lat2.cdns.filter(function (c) { return c.id === 'githack'; })[0] || {}).url,
  'https://rawcdn.githack.com/u/r/latest/a.js');
check('Statically 也不受影响',
  (lat2.cdns.filter(function (c) { return c.id === 'statically'; })[0] || {}).url,
  'https://cdn.statically.io/gh/u/r@latest/a.js');

/* buildCdns：界面做版本校验时按完整 commit 重建这一组 */
var parsed = M.convert('https://github.com/u/r/blob/abc1234/a.js').parsed;
var SHA = '8b7fbe7a2b3e0d4a3f2e1c0b9a8d7e6f5c4b3a21';
var rebuilt = M.buildCdns(parsed, SHA, {});
check('按完整 commit 重建：jsDelivr 用 commit',
  rebuilt[0].url, 'https://cdn.jsdelivr.net/gh/u/r@' + SHA + '/a.js');
check('重建条数与定义一致', rebuilt.length, M.CDNS.length);
check('非仓库路径重建为空',
  M.buildCdns(M.convert('https://github.com/u/r').parsed, 'main', {}).length, 0);
check('Release 路径重建为空',
  M.buildCdns(M.convert('https://github.com/u/r/releases/download/v1/f.zip').parsed, 'main', {}).length, 0);

/* ---------- ⑧ 批量 ---------- */
console.log('\n── 批量 ──');
var seen = [];
var many = M.convertMany([
  'https://github.com/u/r/blob/main/a.js',
  'garbage',
  'https://github.com/u/r/blob/main/a.js'
], {}, function (res, i, total) { seen.push(i + '/' + total); });
check('批量返回同样条数', many.length, 3);
check('批量不自动去重（去重交给界面）', many.filter(function (x) { return x.ok; }).length, 2);
check('逐条回调带索引与总数', seen.join(','), '0/3,1/3,2/3');
check('批量透传 opts',
  M.convertMany(['https://github.com/u/r/blob/latest/a.js'], { omitLatest: true })[0].cdns[0].url,
  'https://cdn.jsdelivr.net/gh/u/r/a.js');

console.log('\n' + '='.repeat(46));
console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) process.exit(1);
