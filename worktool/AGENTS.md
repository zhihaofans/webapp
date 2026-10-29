# AGENTS.md · 生活工具箱（worktool）

给在此目录里干活的 AI / 协作者看的操作手册。**它是约定，不是建议**：下面每一条都对应一次真实踩过的坑，
违反之后通常不会立刻报错，而是在某个弱网、某台旧手机或某次发版时冒出来。

- 项目：泛生活场景的多功能在线工具箱（PWA），中文界面，纯本地处理。
- 形态：**零依赖、零构建、多文件静态站点**。没有 `package.json`、没有打包器、没有 npm 包、没有 CDN。
  浏览器直接执行裸的经典脚本，共享一个全局命名空间 `window.Toolbox`。
- 线上地址：<https://zhihaofans.github.io/webapp/worktool/>（GitHub Pages，仓库子目录）。

---

## 1. 硬边界

| 约束 | 说明 |
|---|---|
| **只改 `worktool/`** | Git 仓库根在上一层（`/root/projects/webapp`），里面有另一个应用 `workbench/`。不要动 `workbench/`，也不要动仓库根文件。 |
| **不引入依赖** | 不加 `package.json`、不加框架（React/Vue/jQuery）、不加工具库、不引外链字体与 CDN。需要新能力就写进 `js/lib/`。 |
| **不引入构建** | 没有编译步骤。文件改完就是线上跑的那份；不要生成 `dist/`、不要用 TS、不要用裸模块 `import`。 |
| **路径全相对** | 线上是 `/webapp/worktool/` 子路径。禁止 `/assets/...` 这类以 `/` 开头的路径。 |
| **文件名全 ASCII** | Pages 是 Linux，大小写敏感；中文文件名只用在 `启动本地服务器.command` 这类本地脚本上。 |
| **不联网、不上传** | 除了 GitHub 版本校验（默认关）和用户主动发起的局域网直传，任何功能都不许发请求。 |

## 2. 目录地图

```
index.html            入口：<head> 内联启动遮罩样式 → 图标 sprite（<symbol id="i-*">）→ 骨架 → loader.js
manifest.webmanifest  PWA 清单（start_url/scope 都是 ./，别改成绝对路径）
sw.js                 Service Worker：预缓存 + 取数策略，CACHE 名带版本号
version.json          版本探针（"检查更新"的比对源，刻意不被 SW 缓存）
assets/css/           tokens（设计令牌）→ base → layout → components → features/*.css
assets/wasm/          libwebp 编码器（自托管，按需加载，不进预缓存）
js/core.js            基础设施：$ / $$ / esc / escAttr / ic / 存储层 Store / normalizeDB / 主题 / 吐司
js/registry.js        GROUPS + TOOLS（侧栏、概览、路由的唯一数据源）+ T.register
js/loader.js          模块清单 ASSETS（并行下载、按序执行）
js/shell.js           侧拉栏 / 顶栏 / 手机抽屉
js/router.js          hash 路由 + 规划中占位页 + 404 兜底
js/settings.js        数据导入导出 / 清空 / 检查更新
js/app.js             启动顺序：数据 → 主题 → 外壳 → 路由 → 兜底落盘
js/scanner.js         摄像头扫码（取景/抽帧/双解码路径），局域网传输与二维码工具共用
js/lib/               纯逻辑，不碰 DOM，可被 node 直接 require
js/tools/             各工具界面层（render / onLeave）
js/worker/            WebP 编码 Worker（module worker）
test/                 纯逻辑用例，node 直接跑（自带 check，无框架）
tools/                stamp.js（发版盖章）、make-splash.py、check-layout.py、check-lanshare.py
```

## 3. 命令

```bash
bash start-server.sh 8787          # 起本地服务 → http://localhost:8787
                                   # macOS 也可双击「启动本地服务器.command」（会自动开浏览器）
```

```bash
node test/version.test.js          # 单跑
for f in test/*.test.js; do node "$f" || exit 1; done   # 全量，当前基线 377 条全绿
node test/github2jsdelivr.test.js --online              # 追加需要真实 GitHub API 的用例
```

```bash
node tools/stamp.js --bump c --note "这次改了什么"   # 发版（见 §6.4）
```

可选（需要 `pip install playwright && playwright install chromium`）：

```bash
python3 tools/check-layout.py      # 真实 Chromium 量移动端是否横向越界（393 / 360）
python3 tools/check-lanshare.py    # 两个页面跑完整直传链路
```

## 4. 代码约定

1. **调用链单向**：数据层 → 计算层 → 渲染层。渲染函数之间**严禁互相调用**；
   多处联动收敛到一个 `paint()` / `refreshAll()`，由事件处理函数触发。互调会直接栈溢出。
2. **进 innerHTML 的用户数据必须过 `T.esc()` / `T.escAttr()`**。地名、文件名、链接、用户输入无一例外。
3. **新增数据字段必须在 `js/core.js` 的 `blankDB()` 与 `normalize()` 里同时登记**。
   `normalize()` 是逐字段重建（不是浅拷贝），漏登记的表现是「存进去了，刷新就没了」。
4. **图标只用 `T.ic('name', '额外class', 尺寸档位)`**：`<symbol>` 加在 `index.html` 的图标池里，
   里面只写 `viewBox` + 路径，描边/填充/线宽/颜色统一由 `.ic` 给（`currentColor` 会穿透 `<use>`）。
   **不要新建 `.svg` 文件** —— 全站零 SVG 文件（favicon 是内联 data URI）。
5. **模块外壳固定**：
   - 界面层：`(function (T) { 'use strict'; ... })(window.Toolbox);`
   - 纯逻辑层（`js/lib/`）：结尾加 `if (typeof module !== 'undefined' && module.exports) module.exports = T.XXX;`
     且外层用 `(typeof window !== 'undefined' ? window : globalThis)`，保证 node 能 require。
6. **工具实现只有两个钩子**：`render(host, tool)` 与 `onLeave()`。`onLeave` 里要清计时器、
   `URL.revokeObjectURL`、document 级监听 —— 否则切走再回来会叠事件。
7. **样式**：颜色/圆角/阴影/字体只从 `assets/css/tokens.css` 取，不写死色值；新工具的样式放
   `assets/css/features/<工具>.css`，再在 `index.html` 的 `<link>` 与 `sw.js` 的 `SHELL` 里各加一行。
   `.pagefoot` 渲染在 `.view` 内部，横向留白由 `.view` 提供，不要再加左右 padding。
8. **文案**：中文，克制、具体，不写营销腔；错误提示要说清「发生了什么 + 怎么办」。

## 5. 测试约定

- 只有 `js/lib/` 里的纯逻辑进 `test/`；界面层不引测试框架（保持零依赖）。
- 用例文件自带 `pass/fail` 计数与 `check(name, got, want)`，末尾打印 `结果: N 通过 / M 失败`，
  有失败时 `process.exitCode = 1`。
- 断言要覆盖边界（月末、闰年、跨年、浮点收敛、非法输入），而不是只跑 happy path。
- 改 `js/lib/*` 必须跑对应用例；改版本号必须跑 `test/version.test.js`。

## 6. 常见任务

### 6.1 新增一个工具

1. `js/registry.js`：确认 `T.GROUPS` 里有分组，在 `T.TOOLS` 补一条
   `{ id, group, name, icon, status: 'ready', sub, desc, tags }`（未实现的用 `status: 'soon'` + `plan`，
   概览页会自动隐藏它）。
2. 新建 `js/tools/<id>.js`，用 `T.register(id, { render, onLeave })`。
3. **两处清单都要加**：`js/loader.js` 的 `ASSETS`（放在 `js/app.js` 之前）+ `sw.js` 的 `SHELL`。
   漏了第一处工具不出现，漏了第二处离线打不开。
4. 需要新样式就在 `assets/css/features/<id>.css` 写，并加进 `index.html` 的 `<link>` 与 `sw.js` 的 `SHELL`。

### 6.2 新增图标

在 `index.html` 图标池里加一行 `<symbol id="i-名字" viewBox="0 0 24 24">…</symbol>`（`fill="none"` + `stroke`，
24×24 线性风格），然后 `T.ic('名字')`。**不需要**改缓存清单，也不要建独立文件。

### 6.3 改样式 / 改界面

- 先改 `tokens.css` 里已有的令牌，再改具体样式；不允许在 feature CSS 里复制一份色值。
- 布局改动要同时看：桌面（侧栏常驻 / 收起 68px）、手机 ≤900px（顶栏 + 抽屉）、深色模式。
- 动效只有三类（视图淡入、抽屉滑入、进度条推进），共用同一条缓动曲线，别自行加 easing。

### 6.4 发版

```bash
node tools/stamp.js --bump c --note "一句话说明"    # c=修 bug/微调，b=新功能/交互变化，a=不兼容重构
```

脚本会一次写齐并回读校验：`js/core.js` 的 `APP_VER`/`APP_BUILD`、`version.json` 的 `ver`/`build`/`note`、
`sw.js` 的 `CACHE`。**不要手改这四处**。

发版后还差三件手动的：

1. `README.md` 顶部标题的版本号、以及「十、版本」里补一段更新说明（`stamp.js` 不管这两处）。
2. 全量跑测试（`test/version.test.js` 会兜住漏改）。
3. 本机起服务把改动验收一遍，再 `git push` —— **发版即上线**，Pages 是覆盖式替换。

提交信息格式照历史提交来：`生活工具箱-vX.Y.Z：一句话说明`，**单行、不写 body、不加 trailer**；版本号与本次 `stamp.js` 盖出的版本一致，细节用「：」分句、用「；」并列（例：`生活工具箱-v1.14.1：局域网传输：传输记录里的图片显示缩略图；配对包互相带版本号检测`）。`workbench/` 用「生活工作台-vX.Y.Z」，别混用。

### 6.5 改了 `sw.js`

- 新增/删除预缓存资源，必须同步 `SHELL`；`CACHE` 名随版本号换（由 `stamp.js` 改）。
- 取数策略不要退化：导航与脚本保持「网络优先 + 短超时」，CSS / `loader.js` / `splash/` 走缓存优先，
  **`version.json` 必须完全不拦**（它是探针）。第三方接口也不拦。
- 改完跑 `node test/sw.test.js`。

## 7. 已知坑

1. **`file://` 下没有 Service Worker**（`module worker` 也会被拦，WebP 走浏览器内置编码兜底）。
   验收以 HTTP 为准，`file://` 只用于快速看样式。
2. **Safari / iOS 没有可用的 WASM WebP 编码**，会自动回退 JPEG/PNG 并在界面说明，不能做成静默失败。
3. **版本号不一致 = 老访客永远看不到新版**。三处（`core.js` / `version.json` / `sw.js`）只许用脚本改。
4. `MIGRATED` 戳跟着「引入迁移的那个版本」走，**不随发版更新**，否则每次升版都会把用户手动改过的开关翻回去。
5. 本地存储配额约 5 MB，只存文本与元数据；图片本身绝不进 `localStorage`。
6. 启动遮罩样式内联在 `<head>`，且必须在所有 `<link rel="stylesheet">` 之前 —— 挪到外部文件会重新引入白屏。
7. iOS 启动图由 `tools/make-splash.py` 生成，`index.html` 的 media 声明必须与该脚本里的 `SIZES` 一致。

## 8. 完成定义（DoD）

- [ ] 改动只落在 `worktool/` 内，没有新依赖、没有新构建步骤、没有绝对路径。
- [ ] 用户输入全部转义；新数据字段已在 `normalize()` 登记。
- [ ] 新增脚本进了 `loader.js` 的 `ASSETS`，所有新增资源进了 `sw.js` 的 `SHELL`（CSS 还要进 `index.html` 的 `<link>`）。
- [ ] `for f in test/*.test.js; do node "$f" || exit 1; done` 全绿。
- [ ] 本地 HTTP 实机/浏览器验收过：新功能、深色模式、手机宽度（≤900px）。
- [ ] 发版用 `stamp.js`；`README.md` 版本段已补；提交信息符合 `生活工具箱-vX.Y.Z：…`。
