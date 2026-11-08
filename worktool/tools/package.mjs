#!/usr/bin/env node
/* ============================================================
   tools/package.mjs — 校验 + 出交付包（零构建项目）

   这个项目是「零构建」的：仓库根就是站点根，js/ CSS/ splash/ 这些文件
   改完推上去就是线上跑的那一份，没有编译、没有转译、没有产物目录。
   所以这个脚本不负责「构建」，只负责三件事：

     1. 校验 —— 版本号四处自洽、引用不缺、没有绝对路径、没有系统垃圾；
     2. 清残留 —— 按上一版清单删掉「已经不存在于源码里」的旧文件，
        例如某个 js/lib/xxx.js 改名后，旧文件不会一直躺在磁盘上被一起推上去；
     3. 打包 —— 出一个带版本号与构建号的 zip，包内自带 dev-docs/ 交接文档。

   为什么产物不能放到 docs/：
     线上入口是 https://zhihaofans.github.io/webapp/worktool/ 。GitHub Pages
     从 webapp 仓库根发布，worktool/docs/ 只会变成 "/worktool/docs/" 这个
     URL 后缀 —— 入口就变了。要让入口一字不动，worktool/ 目录本身必须是
     站点根，产物只能平铺在这里。

   用法：
     node tools/package.mjs               # 清理 + 校验 + 打包（构建号自增）
     node tools/package.mjs --no-zip      # 不动 zip，只清理与校验
     node tools/package.mjs --check       # 只校验，不写任何文件
     node tools/package.mjs --build 19    # 指定构建号，不自增

   退出码：全部通过 0；任一项校验失败 1（此时不写清单、不打包）。
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const MANIFEST = path.join(ROOT, '.artifacts.json');
const BUILDFILE = path.join(ROOT, '.buildno');
const BUILDINFO = path.join(ROOT, 'build-info.json');

/* 开发区：不进产物清单，也永不被清理逻辑碰到 */
const DEV_DIRS = new Set(['tools', 'test', 'dev-docs', '.git', 'node_modules', '.codebuddy']);
/* 开发文件：同上。README 是主文档，两个启动脚本是本地工具，都不算部署资源 */
const DEV_FILES = new Set([
  '.buildno', '.artifacts.json', '.gitignore', '.DS_Store',
  'AGENTS.md', 'TODO.md', 'CHANGELOG.md',
  'README.md', 'start-server.sh', '启动本地服务器.command',
  'build-info.json'
]);
/* 允许出现在部署区的扩展名（用于提示误放文件，不作为失败项） */
const OK_EXT = new Set([
  '.html', '.js', '.mjs', '.css', '.json', '.webmanifest', '.wasm',
  '.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico', '.txt', '.map'
]);
/* 无扩展名或特殊名，但确实是部署资源 */
const OK_NAME = new Set(['.nojekyll']);

let pass = 0, fail = 0, warn = 0;
const problems = [], warnings = [];
const ok = (name, extra) => { pass++; console.log('  ok    ' + name + (extra ? '  ' + extra : '')); };
const bad = (name, detail) => {
  fail++; problems.push(name + (detail ? '：' + detail : ''));
  console.log('  FAIL  ' + name + (detail ? '\n        ' + detail : ''));
};
const warnOf = (name, detail) => {
  warn++; warnings.push(name + (detail ? '：' + detail : ''));
  console.log('  warn  ' + name + (detail ? '  ' + detail : ''));
};
const check = (name, cond, detail) => (cond ? ok(name) : bad(name, detail));

/* ---------------- 参数 ---------------- */
const argv = process.argv.slice(2);
let noZip = false, checkOnly = false, forceBuild = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--no-zip') noZip = true;
  else if (a === '--check') checkOnly = true;
  else if (a === '--build') forceBuild = Number(argv[++i]);
  else if (a === '-h' || a === '--help') {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('============ */')[0]);
    process.exit(0);
  } else {
    console.error('✗ 认不出的参数：' + a + '（试 --help）');
    process.exit(1);
  }
}
if (forceBuild !== null && (!Number.isInteger(forceBuild) || forceBuild < 1)) {
  console.error('✗ --build 需要一个正整数');
  process.exit(1);
}

/* ---------------- 1. 版本号自洽 ---------------- */
console.log('\n── 版本号 ──');

const verPath = path.join(ROOT, 'version.json');
if (!fs.existsSync(verPath)) {
  console.error('✗ 找不到 version.json，确认你在仓库根跑这个脚本');
  process.exit(1);
}
const verJson = JSON.parse(fs.readFileSync(verPath, 'utf8'));
const ver = verJson.ver;
const buildDate = verJson.build;

const coreSrc = fs.readFileSync(path.join(ROOT, 'js', 'core.js'), 'utf8');
const swSrc = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const coreVer = (/var APP_VER\s*=\s*'([^']+)'/.exec(coreSrc) || [])[1];
const coreBuild = (/var APP_BUILD\s*=\s*'([^']+)'/.exec(coreSrc) || [])[1];
const cacheVer = (/var CACHE\s*=\s*'toolbox-([^']+)'/.exec(swSrc) || [])[1];

check('version.json 有版本号', !!ver, String(ver));
check('version.json 的 build 是日期', /^\d{4}-\d{2}-\d{2}$/.test(String(buildDate)), String(buildDate));
check('core.js 的 APP_VER 与 version.json 一致', coreVer === ver, 'core=' + coreVer + '  version.json=' + ver);
check('core.js 的 APP_BUILD 与 version.json 一致', coreBuild === buildDate, 'core=' + coreBuild + '  version.json=' + buildDate);
check('sw.js 的 CACHE 名与版本号一致', cacheVer === ver, 'sw=toolbox-' + cacheVer + '  ver=' + ver);
check('version.json 的 url 指向站点根', verJson.url === 'https://zhihaofans.github.io/webapp/worktool/', String(verJson.url));

if (fail) {
  console.error('\n✗ 版本号不一致。跑 node tools/stamp.js --bump c --note "…" 一次写齐四处，别手改。');
  process.exit(1);
}

/* ---------------- 2. 构建号 ---------------- */
let buildNo;
if (forceBuild !== null) {
  buildNo = forceBuild;
} else {
  const prev = fs.existsSync(BUILDFILE) ? parseInt(fs.readFileSync(BUILDFILE, 'utf8').trim(), 10) : 0;
  buildNo = (Number.isInteger(prev) && prev > 0 ? prev : 0) + 1;
}
console.log('  v' + ver + ' · 构建日期 ' + buildDate + ' · build' + buildNo);

/* ---------------- 3. 收集部署文件 ---------------- */
function walk(dir, rel, out) {
  for (const name of fs.readdirSync(dir)) {
    if (name === '.DS_Store' || name === '__MACOSX') continue;
    if (!rel && DEV_DIRS.has(name)) continue;
    if (!rel && DEV_FILES.has(name)) continue;
    const abs = path.join(dir, name);
    const r = rel ? rel + '/' + name : name;
    const st = fs.lstatSync(abs);
    if (st.isDirectory()) walk(abs, r, out);
    else if (st.isFile() && !/\.(zip|tmp)$/i.test(name)) out.push(r);
  }
  return out;
}
const files = walk(ROOT, '', []).sort();

const oddExt = files.filter(f => !OK_EXT.has(path.extname(f).toLowerCase()) && !OK_NAME.has(f));
if (oddExt.length) warnOf('部署区有非常见扩展名的文件', oddExt.join(', '));

check('部署文件数量正常', files.length > 60, files.length + ' 个');
for (const must of ['index.html', 'sw.js', 'version.json', 'manifest.webmanifest', '.nojekyll', 'js/loader.js', 'js/core.js']) {
  check('关键文件在位：' + must, files.includes(must));
}

/* ---------------- 4. 清理上一版的残留 ---------------- */
console.log('\n── 清理残留 ──');

let prevFiles = [];
if (fs.existsSync(MANIFEST)) {
  try {
    const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
    prevFiles = Array.isArray(m.files) ? m.files : [];
  } catch (e) {
    console.error('✗ .artifacts.json 解析失败，先看一眼这个文件：' + e.message);
    process.exit(1);
  }
}

/* 清单被写脏时的最后一道闸：绝不删开发区、绝不越界 */
const unsafe = prevFiles.filter(f => {
  const seg = String(f).split('/')[0];
  return DEV_DIRS.has(seg) || DEV_FILES.has(seg) || String(f).includes('..') || path.isAbsolute(String(f));
});
if (unsafe.length) {
  console.error('✗ .artifacts.json 里有受保护或越界的路径，拒绝继续：\n  ' + unsafe.join('\n  '));
  process.exit(1);
}

const current = new Set(files);
const stale = prevFiles.filter(f => !current.has(f));
let removed = 0;
if (!checkOnly && stale.length) {
  for (const f of stale) {
    const abs = path.join(ROOT, f);
    if (!abs.startsWith(ROOT + path.sep)) continue;
    if (fs.existsSync(abs)) { fs.rmSync(abs, { force: true }); removed++; }
  }
  /* 删掉因此变空的目录，从深到浅；根目录本身不动 */
  const dirs = [...new Set(stale.map(f => path.dirname(f)))].filter(d => d && d !== '.')
    .sort((a, b) => b.split('/').length - a.split('/').length);
  for (const d of dirs) {
    let cur = path.join(ROOT, d);
    while (cur !== ROOT && cur.startsWith(ROOT + path.sep)) {
      if (!fs.existsSync(cur) || fs.readdirSync(cur).length) break;
      fs.rmdirSync(cur);
      cur = path.dirname(cur);
    }
  }
}
console.log('  上一版清单 ' + prevFiles.length + ' 项，本次 ' + files.length + ' 项'
  + (stale.length ? '，删掉 ' + removed + ' 个已不存在的旧文件' : '，无残留'));

/* ---------------- 5. 引用完整性 ---------------- */
console.log('\n── 引用完整性 ──');

const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map(m => m[1])
  .filter(u => !/^(?:data:|blob:|https?:|mailto:|#|\/\/)/.test(u))
  .map(u => u.split('#')[0].split('?')[0])
  .filter(Boolean);
const uniqRefs = [...new Set(refs)];
const missingRefs = uniqRefs.filter(u => !fs.existsSync(path.join(ROOT, u)));
check('index.html 引用的 ' + uniqRefs.length + ' 个本地资源都在', missingRefs.length === 0, missingRefs.join(', '));

const absRefs = uniqRefs.filter(u => u.startsWith('/'));
check('index.html 没有以 / 开头的绝对路径', absRefs.length === 0, absRefs.join(', '));

/* loader.js 的 ASSETS：漏加脚本 → 工具不出现 */
const loaderSrc = fs.readFileSync(path.join(ROOT, 'js', 'loader.js'), 'utf8');
const assetsBlock = (/var ASSETS\s*=\s*\[([\s\S]*?)\];/.exec(loaderSrc) || [])[1] || '';
const assets = [...assetsBlock.matchAll(/'([^']+)'/g)].map(m => m[1]);
const missingAssets = assets.filter(u => !fs.existsSync(path.join(ROOT, u)));
check('loader.js 的 ' + assets.length + ' 个脚本都在', assets.length > 0 && missingAssets.length === 0, missingAssets.join(', '));

/* sw.js 的 SHELL：漏资源 → 断网打不开 */
const shellBlock = (/var SHELL\s*=\s*\[([\s\S]*?)\];/.exec(swSrc) || [])[1] || '';
const shell = [...shellBlock.matchAll(/'([^']+)'/g)].map(m => m[1]);
const missingShell = shell.filter(u => u !== './' && !fs.existsSync(path.join(ROOT, u)));
check('sw.js 的 SHELL ' + shell.length + ' 项都在', shell.length > 0 && missingShell.length === 0, missingShell.join(', '));

/* 反向：页面引用的资源必须都在 SHELL 里，否则断网白屏 */
const shellSet = new Set(shell.map(u => u.replace(/^\.\//, '')));
const notCached = uniqRefs.filter(u => /\.(css|js|webmanifest)$/.test(u) && !shellSet.has(u));
check('页面引用的 CSS/JS 都进了 SHELL', notCached.length === 0, notCached.join(', '));

/* ---------------- 6. 卫生检查 ---------------- */
console.log('\n── 卫生 ──');

const nj = path.join(ROOT, '.nojekyll');
check('.nojekyll 存在', fs.existsSync(nj));
if (fs.existsSync(nj)) check('.nojekyll 是空文件', fs.statSync(nj).size === 0, fs.statSync(nj).size + ' 字节');

const strays = [];
(function scanJunk(dir, rel) {
  for (const name of fs.readdirSync(dir)) {
    if (name === '.git' || name === 'node_modules') continue;
    const abs = path.join(dir, name);
    const r = rel ? rel + '/' + name : name;
    if (name === '.DS_Store' || name === '__MACOSX') strays.push(r);
    if (fs.lstatSync(abs).isDirectory()) scanJunk(abs, r);
  }
})(ROOT, '');
check('仓库里没有 .DS_Store / __MACOSX', strays.length === 0, strays.join(', '));

check('index.html 是真实页面，不是跳转壳', !/location\.(replace|assign)\(\s*['"]\.\/(?:docs|dist)\//.test(html));

/* 孤儿文件：部署区里有、但没有任何页面 / 清单 / 代码路径字符串提到它。
   典型来源是源码里删了引用、文件却还留在磁盘上。不自动删（删错代价太大），
   只提示，由人确认。只看 js/ 与 assets/css/ —— splash/ 是整目录按尺寸生成的，
   逐个核对没意义。 */
const textExt = /\.(html|js|css|json|webmanifest)$/;
const pool = files.filter(f => textExt.test(f))
  .map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
const orphans = files.filter(f => (/^js\/.+\.js$/.test(f) || /^assets\/css\/.+\.css$/.test(f)) && !pool.includes(f));
if (orphans.length) warnOf('这些文件没有任何引用，可能是残留', orphans.join(', '));

/* ---------------- 7. 收尾：写清单与构建信息 ---------------- */
if (fail) {
  console.error('\n✗ ' + fail + ' 项校验未通过，未写清单、未打包。');
  console.error('  - ' + problems.join('\n  - '));
  process.exit(1);
}
if (checkOnly) {
  console.log('\n==============================================');
  console.log('只校验：' + pass + ' 通过 / ' + fail + ' 失败' + (warn ? ' / ' + warn + ' 提示' : ''));
  console.log('（未写任何文件）');
  process.exit(0);
}

const builtAt = new Date().toISOString();
fs.writeFileSync(BUILDINFO, JSON.stringify({
  app: verJson.name,
  ver,
  buildDate,
  buildNo,
  builtAt,
  files: files.length
}, null, 2) + '\n');

fs.writeFileSync(MANIFEST, JSON.stringify({
  ver,
  buildNo,
  builtAt,
  files
}, null, 2) + '\n');

fs.writeFileSync(BUILDFILE, buildNo + '\n');

const bytes = files.reduce((n, f) => n + fs.statSync(path.join(ROOT, f)).size, 0);
console.log('\n  部署文件 ' + (files.length + 1) + ' 个 / 部署体积约 ' + (bytes / 1024 / 1024).toFixed(2) + ' MB');

/* ---------------- 8. 打 zip ---------------- */
const zipName = 'worktool-v' + ver + '-build' + buildNo + '.zip';
if (noZip) {
  console.log('\n--no-zip：已跳过打包');
} else {
  console.log('\n── 打包 ──');
  const zipPath = path.join(path.dirname(ROOT), zipName);
  const zipTmp = zipPath + '.tmp';
  fs.rmSync(zipTmp, { force: true });
  try {
    execFileSync('zip', [
      '-r', '-q', '-X', zipTmp, path.basename(ROOT),
      '-x', '*/node_modules/*', '*/.git/*', '*.DS_Store', '*/__MACOSX/*', '*.zip', '*.tmp'
    ], { cwd: path.dirname(ROOT), stdio: 'pipe' });
    fs.rmSync(zipPath, { force: true });
    fs.renameSync(zipTmp, zipPath);
    const size = fs.statSync(zipPath).size;
    ok('已打包 ' + zipName, (size / 1024 / 1024).toFixed(2) + ' MB');
  } catch (e) {
    fs.rmSync(zipTmp, { force: true });
    bad('打包失败', String(e.stderr || e.message).trim());
  }
}

/* ---------------- 9. 报告 ---------------- */
console.log('\n==============================================');
console.log('v' + ver + ' · build' + buildNo + ' · ' + pass + ' 通过 / ' + fail + ' 失败'
  + (warn ? ' / ' + warn + ' 提示' : ''));
if (warn) console.log('提示：\n  - ' + warnings.join('\n  - '));
if (fail) {
  console.error('失败：\n  - ' + problems.join('\n  - '));
  process.exitCode = 1;
} else {
  console.log('下一步：bash tools/dev.sh → 手工验收清单 → git push（发版即上线）');
}
