/* ============================================================
   发版一致性用例：node test/version.test.js

   这个文件只干一件事：确认「同一个版本号 / 同一个构建日期」在仓库各处
   说的是同一句话。

   为什么需要它：README 里写着「发版时几处必须同步改，缺一处老访客就会
   一直看到旧版本」，但这句话是靠人记的。2026-10-03 之后连发十几版，
   APP_BUILD 一直停在 10 月 3 日，首页底部和设置里的「构建于」错了 12 天，
   没有任何机制发现。这个用例就是那个机制。

   它不检查日期是否是「今天」—— 那会让历史快照永远跑不过。
   它只检查各处是否自洽，以及日期格式是否合法。
   ============================================================ */
'use strict';

var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var core = fs.readFileSync(path.join(ROOT, 'js', 'core.js'), 'utf8');
var sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
var ver = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));

var pass = 0, fail = 0;
function check(name, got, want) {
  var ok = got === want;
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + name);
  if (!ok) console.log('         期望: ' + want + '\n         实际: ' + got);
}

var APP_VER = (/var APP_VER = '([^']+)'/.exec(core) || [])[1];
var APP_BUILD = (/var APP_BUILD = '([^']+)'/.exec(core) || [])[1];
var CACHE = (/var CACHE = 'toolbox-([^']+)'/.exec(sw) || [])[1];

console.log('\n── 版本号四处一致 ──');
check('js/core.js 里有 APP_VER', typeof APP_VER, 'string');
check('js/core.js APP_VER = version.json ver', APP_VER, ver.ver);
check('sw.js CACHE = version.json ver', CACHE, ver.ver);

console.log('\n── 构建日期两处一致（本次回归的主角）──');
check('js/core.js 里有 APP_BUILD', typeof APP_BUILD, 'string');
check('APP_BUILD = version.json build', APP_BUILD, ver.build);
console.log('  info 当前版本 v' + APP_VER + '，构建于 ' + APP_BUILD);

console.log('\n── 格式与基本合理性 ──');
check('版本号形如 a.b.c', /^\d+\.\d+\.\d+$/.test(APP_VER || ''), true);
check('构建日期形如 YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(APP_BUILD || ''), true);
check('构建日期是真实存在的日期', String(new Date(APP_BUILD + 'T00:00:00')) !== 'Invalid Date', true);
check('构建日期没有跑到未来', !(APP_BUILD > new Date().toISOString().slice(0, 10)), true);
check('version.json 的 name 不为空', !!(ver.name && ver.name.length), true);

console.log('\n==============================================');
console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) process.exitCode = 1;
