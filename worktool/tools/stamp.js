#!/usr/bin/env node
/* ============================================================
   tools/stamp.js — 发版盖章

   一次把「同一个版本号」这件事写进四个地方：
     · js/core.js    APP_VER  / APP_BUILD
     · version.json  ver / build / note
     · sw.js         CACHE 名

   为什么要有这个脚本：这四处原来全靠手改。README 里写着「缺一处老访客
   就会一直看到旧版本」，结果 2026-10-03 之后十几轮发版，APP_BUILD 一直
   停在 10 月 3 日没人动 —— 首页底部和设置里的「构建于」整整错了 12 天。
   靠人记必然漂，交给脚本。

   用法：
     node tools/stamp.js                    只把构建日期刷成今天
     node tools/stamp.js 1.13.4             指定版本号
     node tools/stamp.js --bump c           在当前版本上自增（c 位）
     node tools/stamp.js --bump c --note "修了什么"
     node tools/stamp.js 1.14.0 --date 2026-11-01

   版本号规则（见 README）：
     c 位 = 小更新 / 修 bug / 文案样式微调
     b 位 = 新增或移除功能、改交互结构
     a 位 = 不兼容的重构
   ============================================================ */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var F_CORE = path.join(ROOT, 'js', 'core.js');
var F_VER = path.join(ROOT, 'version.json');
var F_SW = path.join(ROOT, 'sw.js');

function die(msg) {
  console.error('✗ ' + msg);
  process.exit(1);
}
function today() {
  var d = new Date();
  var p = function (n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function bump(ver, which) {
  var p = ver.split('.').map(Number);
  /* 允许 '1.14' 这种省略末尾 0 的写法，补齐到三段再算 */
  while (p.length < 3) p.push(0);
  if (p.length !== 3 || p.some(isNaN)) die('当前版本号解析失败：' + ver);
  if (which === 'a') { p[0] += 1; p[1] = 0; p[2] = 0; }
  else if (which === 'b') { p[1] += 1; p[2] = 0; }
  else if (which === 'c') { p[2] += 1; }
  else die('--bump 只能是 a / b / c，收到：' + which);
  return p.join('.');
}

/* ---------------- 解析参数 ---------------- */
var argv = process.argv.slice(2);
var wantVer = null, bumpWhich = null, note = null, date = today();

for (var i = 0; i < argv.length; i++) {
  var a = argv[i];
  if (a === '--bump') bumpWhich = argv[++i];
  else if (a === '--note') note = argv[++i];
  else if (a === '--date') date = argv[++i];
  else if (a === '-h' || a === '--help') { console.log(fs.readFileSync(__filename, 'utf8').split('============ */')[0]); process.exit(0); }
  else if (/^\d+\.\d+\.\d+$/.test(a)) wantVer = a;
  else die('认不出的参数：' + a);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) die('--date 需要 YYYY-MM-DD，收到：' + date);

/* ---------------- 读现状 ---------------- */
var coreSrc = fs.readFileSync(F_CORE, 'utf8');
var verSrc = fs.readFileSync(F_VER, 'utf8');
var swSrc = fs.readFileSync(F_SW, 'utf8');

var curVer = (/var APP_VER = '([^']+)'/.exec(coreSrc) || [])[1];
if (!curVer) die('在 js/core.js 里找不到 APP_VER');
var curBuild = (/var APP_BUILD = '([^']+)'/.exec(coreSrc) || [])[1];

var nextVer = wantVer || (bumpWhich ? bump(curVer, bumpWhich) : curVer);

/* ---------------- 写四处 ---------------- */
function sub(src, re, to, label) {
  if (!re.test(src)) die('替换失败，没匹配到：' + label);
  return src.replace(re, to);
}

coreSrc = sub(coreSrc, /var APP_VER = '[^']+'/, "var APP_VER = '" + nextVer + "'", 'core.js APP_VER');
coreSrc = sub(coreSrc, /var APP_BUILD = '[^']+'/, "var APP_BUILD = '" + date + "'", 'core.js APP_BUILD');

var verObj = JSON.parse(verSrc);
verObj.ver = nextVer;
verObj.build = date;
if (note) verObj.note = note;

swSrc = sub(swSrc, /var CACHE = 'toolbox-[^']+'/, "var CACHE = 'toolbox-" + nextVer + "'", 'sw.js CACHE');

fs.writeFileSync(F_CORE, coreSrc);
fs.writeFileSync(F_VER, JSON.stringify(verObj, null, 2) + '\n');
fs.writeFileSync(F_SW, swSrc);

/* ---------------- 回读校验：四处必须一致 ---------------- */
var chk = {
  'js/core.js APP_VER': /var APP_VER = '([^']+)'/.exec(fs.readFileSync(F_CORE, 'utf8'))[1],
  'js/core.js APP_BUILD': /var APP_BUILD = '([^']+)'/.exec(fs.readFileSync(F_CORE, 'utf8'))[1],
  'version.json ver': JSON.parse(fs.readFileSync(F_VER, 'utf8')).ver,
  'version.json build': JSON.parse(fs.readFileSync(F_VER, 'utf8')).build,
  'sw.js CACHE': /var CACHE = 'toolbox-([^']+)'/.exec(fs.readFileSync(F_SW, 'utf8'))[1]
};

var bad = 0;
Object.keys(chk).forEach(function (k) {
  var want = /BUILD|build/.test(k) ? date : nextVer;
  var ok = chk[k] === want;
  if (!ok) bad++;
  console.log((ok ? '  ok   ' : '  FAIL ') + k + ' = ' + chk[k]);
});
if (bad) die('盖完章仍有 ' + bad + ' 处对不上，请检查');

console.log('\n✓ v' + curVer + ' → v' + nextVer + '（' + date + '）');
if (curBuild !== date) console.log('  构建日期 ' + curBuild + ' → ' + date);
if (note) console.log('  说明已写入 version.json');
console.log('  下一步：重新打包 + 发布，并把 worktool/ 推到 GitHub Pages。');
