# 交接文档 · 生活工具箱

> 给接手这个仓库的人。读完这一份就能开工，不必再问原作者。
> 最后更新：2026-11-08 · 对应版本 v1.15.0

---

## 0. 30 秒上手

```bash
# 解压后进入仓库根（有 index.html 和 js/ 的那一层）
bash tools/dev.sh          # → http://localhost:8787/
```

就这一条。**没有 `npm install`，没有 `npm ci`，这个项目没有 `package.json`。**

原计划写的是「解压后 `npm ci && npm run dev`」。本项目坚持零依赖零构建，
为了两个命令去背一份 npm 供应链风险不划算。等价物：

| 你可能习惯的命令 | 这个项目里的等价物 |
|---|---|
| `npm ci` | 不需要，无依赖 |
| `npm run dev` | `bash tools/dev.sh` |
| `npm test` | `for f in test/*.test.js; do node "$f" \|\| exit 1; done` |
| `npm run build` | `node tools/package.mjs` |
| `npm run release` | `node tools/stamp.js --bump c --note "…"` |

第一次拿到包，按这个顺序走：

1. `bash tools/dev.sh`，确认首页能开、五个工具都能点进去；
2. 跑全量测试，确认基线是 **377 条全绿**（不全绿说明包被动过）；
3. 读本文件 §2 目录导航和 §3 硬约定，再动第一行代码。

---

## 1. 这是什么

泛生活场景的多功能在线工具箱，PWA，中文界面，**所有数据留在用户自己的浏览器里**。
当前五个工具：图片格式转换、GITHUB 链接转换、单位换算、日期天数计算、
二维码生成与识别，外加一个局域网文件直传。

- 线上：<https://zhihaofans.github.io/webapp/worktool/>
- 形态：零依赖、零构建、多文件静态站点。浏览器直接执行裸的经典脚本，
  共享一个全局命名空间 `window.Toolbox`
- 部署：GitHub Pages，`webapp` 仓库，发布源是仓库根 `/`

**这个仓库根目录就是站点根**，没有 `dist/`、没有 `src/`、没有 `docs/`。
文件名、目录名在线上 URL 里原样出现，所以根目录的整洁度等于线上 URL 的整洁度。
`README.md`、`AGENTS.md`、`tools/`、`test/` 会被一起推上去（GitHub Pages 不做过滤），
它们无害，只是多几个可公开访问的路径 —— 里面没有密钥，也没有隐私数据。

---

## 2. 目录导航

```
worktool/
├── index.html            入口：<head> 内联启动遮罩 → 图标 sprite → 骨架 → loader
├── manifest.webmanifest  PWA 清单（start_url / scope 都是 ./，别改成绝对路径）
├── sw.js                 Service Worker：预缓存 + 取数策略，CACHE 名带版本号
├── version.json          版本探针，「检查更新」的比对源，刻意不被 SW 缓存
├── .nojekyll             跳过 Jekyll 处理（下划线开头的文件不会被吞）
├── build-info.json       本次构建的版本、构建号、时间、文件数（打包脚本生成）
│
├── js/
│   ├── core.js           基础设施：$ / esc / ic / Store / normalizeDB / 主题 / 吐司
│   ├── registry.js       GROUPS + TOOLS，侧栏 / 概览 / 路由的唯一数据源
│   ├── loader.js         模块清单 ASSETS，并行下载、按序执行
│   ├── shell.js          侧拉栏 / 顶栏 / 手机抽屉
│   ├── router.js         hash 路由 + 占位页 + 404 兜底
│   ├── settings.js       数据导入导出 / 清空 / 检查更新
│   ├── scanner.js        摄像头扫码（取景 / 抽帧 / 双解码），两个工具共用
│   ├── lib/              纯逻辑，不碰 DOM，node 可直接 require
│   ├── tools/            各工具界面层，只有 render / onLeave 两个钩子
│   └── worker/           WebP 编码 Worker（module worker）
│
├── assets/css/           tokens → base → layout → components → features/*
├── assets/wasm/          libwebp 编码器，自托管，按需加载，不进预缓存
├── splash/               iOS 启动图，由 tools/make-splash.py 生成
│
├── dev-docs/
│   └── DEV_HANDOVER.md   本文件
├── tools/                开发脚本，不进产物清单
│   ├── package.mjs       校验 + 清残留 + 打 zip
│   ├── dev-server.mjs    零依赖静态服务器（认 .wasm / .webmanifest MIME）
│   ├── dev.sh            上面那个的包装，解压后跑这个
│   ├── stamp.js          发版盖章，一次写齐四处版本字段
│   ├── make-splash.py    生成 iOS 启动图
│   ├── check-layout.py   真实 Chromium 量移动端横向越界
│   └── check-lanshare.py 开两个页面跑完整直传链路
├── test/                 纯逻辑用例，node 直接跑，无框架
├── README.md             完整使用与设计说明（74KB，最详细的一份）
├── AGENTS.md             给 AI / 协作者的操作手册（约定更细，先读它）
├── TODO.md               唯一未完成清单（版本变更记录在 README「十、版本」里）
├── .buildno              构建号计数器，打包时自增
├── .artifacts.json       上一版部署文件清单，用来清残留
├── start-server.sh       老的启动方式（python3 http.server，MIME 不全，仅备用）
└── 启动本地服务器.command  macOS 双击启动（同上，MIME 不全）
```

**改什么去哪**：

| 想做的事 | 动哪里 | 千万别忘 |
|---|---|---|
| 加一个工具 | `js/registry.js` + 新建 `js/tools/<id>.js` | `loader.js` 的 `ASSETS`、`sw.js` 的 `SHELL` 两处都要加 |
| 加图标 | `index.html` 的 `<symbol>` 池 | 不用改缓存清单，不要建 `.svg` 文件 |
| 改配色 | `assets/css/tokens.css` | 不要在 feature CSS 里写死色值 |
| 加数据字段 | `core.js` 的 `blankDB()` + `normalize()` | 两处都要，漏一处就是「存进去刷新就没了」 |
| 改缓存策略 | `sw.js` | 改完跑 `node test/sw.test.js` |
| 改文案 | 对应 `js/tools/*.js` | 中文，克制、具体，不写营销腔 |

---

## 3. 必须遵守的约定

违反下面任何一条，通常不会立刻报错，而是在某个弱网、某台旧手机、某次发版时冒出来。
每条后面写的「后果」都不是假设，是真实发生过的。

### 3.1 零依赖

不加 `package.json`、不加框架、不加工具库、不引外链字体与 CDN。
需要新能力就写进 `js/lib/`。

**后果**：生成页面时最容易顺手引 CDN，用户只保存了 HTML，库 404，功能全废。
这个项目从第一天就躲开了这个坑，不要把坑重新挖开。

### 3.2 零构建

文件改完就是线上跑的那份。不要引入转译、不要 TS、不要裸模块 `import`、不要生成产物目录。
唯一的「构建」是 `node tools/package.mjs`，它只做校验、清残留、打 zip，一个字节都不改。

### 3.3 路径全相对

线上是 `/webapp/worktool/` 这种子路径。禁止 `/assets/...` 这类以 `/` 开头的路径。

**后果**：绝对路径在本地 `http://localhost:8787/` 下能跑，推上去就 404 ——
因为 Pages 上它指向的是 `zhihaofans.github.io/assets/...`，根目录，不是这个项目。
打包脚本会拦 `index.html` 里的绝对路径，但**动态拼出来的路径它扫不到**，写的时候自己盯住。

### 3.4 文件名全 ASCII

Pages 是 Linux，大小写敏感。中文名只用在 `启动本地服务器.command` 这类本地脚本上。

**后果**：曾经把 `splash/` 写成 `Splash/`，本地 macOS 不区分大小写跑得好好的，推上去全 404。

### 3.5 调用链单向

数据层 → 计算层 → 渲染层。**渲染函数之间严禁互相调**，多处联动收敛到一个
`paint()` / `refreshAll()`，由事件处理函数触发。

**后果**：`renderCalendar()` 调 `renderTodayList()`、后者又调回前者，直接栈溢出。
这类 bug 语法正确、静态检查拦不住，只能在架构上杜绝。

### 3.6 用户输入必须转义

进 `innerHTML` 的一切都要过 `T.esc()` / `T.escAttr()`：地名、文件名、链接、剪贴板内容，
无一例外。

### 3.7 新增数据字段要在两处登记

`core.js` 的 `blankDB()` 和 `normalize()`。`normalize()` 是**逐字段重建**，不是浅拷贝。

**后果**：漏登记 = 存进去了、刷新就没了。表现像灵异事件，排查要花很久。

### 3.8 图标只用 sprite

`T.ic('name', '额外class', 尺寸档位)`，`<symbol>` 写在 `index.html` 的图标池里，
里面只写 `viewBox` + 路径；描边、填充、线宽、颜色统一由 `.ic` 给
（`currentColor` 会穿透 `<use>` 的 shadow tree）。

全站零 `.svg` 文件，favicon 是内联 data URI。**data URI 必须带 `data:image/svg+xml,` 前缀**，
漏掉浏览器静默不显示图标 —— 这个坑踩过一次。

### 3.9 工具只有两个钩子

`render(host, tool)` 与 `onLeave()`。`onLeave` 里必须清计时器、`URL.revokeObjectURL`、
document 级监听，否则切走再回来会叠事件，表现为「点一次触发两次」。

### 3.10 版本号只许脚本改

四处：`js/core.js` 的 `APP_VER` / `APP_BUILD`、`version.json` 的 `ver` / `build`、
`sw.js` 的 `CACHE`。全部由 `node tools/stamp.js` 写，**不要手改**。

**后果**：缺一处，老访客就永远看不到新版。曾经 `APP_BUILD` 停在 10 月 3 日整整 12 天
没人发现，首页底部和设置里的「构建于」全是错的。

### 3.11 发版前的纪律

**代码改完 → 全部测试 → 验收通过 → 才动版本号。**

不要在功能还没验证时就 `--bump`，那会让版本号变成刷屏的噪音，也会让
「v1.14.1 到底修了什么」这种问题失去答案。

### 3.12 部署区不要手放杂物

根目录下的每个文件都会出现在线上 URL 里。想放草稿、放设计稿、放临时截图，
放 `dev-docs/` 或干脆别提交。`package.mjs` 会在部署区发现非常见扩展名时给出提示。

---

## 4. 实际遇到的常见问题

按「症状 → 原因 → 动作」写，都是真发生过的。

### 4.1 打开还是旧版，清了浏览器缓存也没用

**原因**：三处版本号里有一处没跟着改，或者改了但用户那边的 SW 还没换。

**动作**：
```bash
node test/version.test.js      # 先看四处是否自洽
node tools/stamp.js            # 只刷新构建日期，不改版本号
```
如果自洽但仍然旧版，让用户在 DevTools → Application → Service Workers 里点
「Update」，或 Unregister 再刷新。

### 4.2 打开后白屏几秒

**原因**：启动遮罩的样式没内联，或者被挪到了外部 CSS 之后。

**动作**：启动遮罩的 `<style>` 必须在 `<head>` 里、**在所有 `<link rel="stylesheet">` 之前**。
挪到外部文件等于把白屏重新引回来 —— 因为外部 CSS 本身就要等一个 RTT。

### 4.3 新加的工具在侧栏里不出现

**原因**：`js/loader.js` 的 `ASSETS` 漏了那一行。

**动作**：补进 `ASSETS`，位置在 `js/app.js` 之前。打包脚本会校验 `ASSETS` 里每个文件
真实存在，但**校验不了「你忘了往里加」**。

### 4.4 在线能用，断网打不开某个工具

**原因**：`sw.js` 的 `SHELL` 漏了那个文件。

**动作**：补进 `SHELL`。漏了 `loader.js` 那一处，工具不出现；漏了 `SHELL` 这一处，离线打不开。
`package.mjs` 有一条反向校验：页面引用的 CSS/JS 必须都在 SHELL 里，能兜住大半。

### 4.5 手机扫码没反应

**原因**（按概率排）：
1. 页面不是 HTTPS，也不是 `localhost` —— `getUserMedia` 直接不给权限；
2. 用户拒了摄像头权限；
3. 浏览器没有 `BarcodeDetector`。**这不等于「没有摄像头」** ——
   桌面端 `BarcodeDetector` 只覆盖 ChromeOS 和 macOS，Windows / Linux 的
   Chrome、Edge、Firefox 全都没有。本项目为此自研了 `js/lib/qrdec.js` 兜底，
   判断能否扫码的判据是 `有 getUserMedia && (原生解码 || QRDec.ready)`。

**动作**：先在电脑上开摄像头试一次，再看 `js/scanner.js` 的 `canScan()` 分支。

### 4.6 局域网传输出不来配对码 / 卡在第一步

**原因**：无服务器 = 无信令。发起方把 SDP 塞进二维码，接收方扫完必须**回一个应答码**，
发起方扫回来才能建立连接。界面若只显示「让对方扫这个码」而不进入第二步，就永远卡在那里。

**动作**：确认配对页是「两步引导」——第一步出示、第二步扫对方的应答码。
两边版本号不一致时界面会标黄提醒刷新，先让两端同版再试。

### 4.7 打包后线上 404

**原因**：引用写成了绝对路径，或者文件根本不在这台机器上（比如 `.gitignore` 里被忽略了）。

**动作**：`node tools/package.mjs` 会校验 `index.html` 的全部本地引用、
`loader.js` 的 `ASSETS`、`sw.js` 的 `SHELL`，缺一个就红。先看它的输出。

### 4.8 存了数据，刷新就没了

**原因**：新字段没在 `normalize()` 里登记。

**动作**：`blankDB()` 和 `normalize()` 两处都补上。这是本项目最隐蔽的一类 bug。

### 4.9 手机上右边被切掉一截

**原因**：某个元素在窄屏下没有收缩，撑破了视口。

**动作**：
```bash
python3 tools/check-layout.py
```
需要 `pip install playwright && playwright install chromium`。它会量 393 / 360 两个宽度下
每个元素的实际右边界。

### 4.10 WebP 转不出来

**原因**：`application/wasm` 的 MIME 不对，或者浏览器是 Safari / iOS。

**动作**：用 `bash tools/dev.sh`（内部是 `tools/dev-server.mjs`）而不是 `python -m http.server`
—— 后者不认 `.wasm` MIME，浏览器会拒绝 `WebAssembly.instantiateStreaming`。
Safari 是真的没有可用编码能力，会自动回退 JPEG/PNG 并在界面说明，这是预期行为。

### 4.11 iOS 添加到主屏后图标是黑底

**原因**：`apple-touch-icon` 引了带透明通道的图，或者尺寸不是 180×180。

**动作**：iOS 会把透明区域填黑。给 180×180 的不透明版本，或在现有图标上垫底色。

### 4.12 打包脚本说版本不一致

**原因**：改了 `version.json` 却忘了 `core.js`，或者反过来。

**动作**：`node tools/stamp.js <版本号>` 一次写齐四处，再打包。

### 4.13 打包说「部署区有非常见扩展名的文件」

**原因**：根目录多了 `.psd`、`.sketch`、`.md` 之类不该上线的东西。

**动作**：这只是提示不是失败。确认无害就留着，确认是误放就挪进 `dev-docs/`。
`.md` 放在根会被一起发布，如果里面有内部信息，那才是真的问题。

---

## 5. 测试策略

分三层，越往下越慢、越贵，能不跑就不跑。

### 第一层：纯逻辑用例（必跑，秒级）

```bash
for f in test/*.test.js; do node "$f" || exit 1; done
```

当前 10 个文件、**377 条断言**，全绿是基线：

| 文件 | 条数 | 覆盖 |
|---|---|---|
| `datecalc.test.js` | 54 | 月末、闰年、跨年、日期折合 |
| `ghmirror.test.js` | 57 | 镜像地址拼接（纯字符串） |
| `github2jsdelivr.test.js` | 22 | 两类地址识别；`--online` 追加 3 条真 API |
| `lanshare.test.js` | 29 | 打包、SAS、指纹、版本比较 |
| `qrcode.test.js` | 26 | 编码矩阵、容量、掩码选择 |
| `qrdec.test.js` | 17 | 解码（含透视、旋转、污损合成样本） |
| `sw.test.js` | 16 | 取数策略：缓存优先、超时兜底、不拦探针 |
| `unitconvert.test.js` | 126 | 系数、温度仿射、浮点收敛 |
| `version.test.js` | 10 | 四处版本号与构建日期自洽 |
| `webpenc.test.js` | 20 | 编码器状态机，含失败后重试 |

**约定**：用例文件自带 `pass/fail` 计数和 `check(name, got, want)`，末尾打印
`结果: N 通过 / M 失败`，有失败时 `process.exitCode = 1`。不引测试框架，
因为引框架就要引 npm，就要破零依赖。

**断言要覆盖边界**，不要只跑 happy path：月末、闰年、跨年、浮点收敛、非法输入。

### 第二层：真实浏览器脚本（改动涉及布局 / 扫码 / 直传时跑）

```bash
python3 tools/check-layout.py      # 移动端横向越界，393 / 360 两种宽度
python3 tools/check-lanshare.py    # 两个页面跑完整直传链路（四场景）
```

`check-lanshare.py` 的四个场景值得记住，因为它是按真实故障设计的：
① 粘贴配对码 ② 有原生 `BarcodeDetector` ③ 没有原生 API 但有摄像头（走自研解码器）
④ 真没有摄像头（走粘贴兜底）。

两个脚本量的都是**仓库根本身** —— 因为这个项目没有产物目录，根就是线上。

### 第三层：手工验收（每次发版必做）

打包脚本能验证「文件齐不齐」，验证不了「点了有没有反应」。发版前手动过一遍：

- [ ] 首页五个工具都能点进去，控制台无报错、无 404
- [ ] 图片转换：拖一张 JPG，能出 WebP；再改设置，队列出现「设置已改」
- [ ] 二维码：输入文字立刻出码，能下载 PNG；从图片识别能读回来
- [ ] 局域网直传：两台设备同一 Wi-Fi，能互传一个文件，图片在记录里有缩略图
- [ ] 日期计算：跨月、跨年各算一次
- [ ] 深色模式下看一遍首页和设置页
- [ ] 手机宽度（≤900px）看一遍：顶栏、抽屉、底部安全区
- [ ] 导出 JSON → 清空 → 导入，数据能回来
- [ ] 断网后刷新，仍能打开已缓存的工具

### 没有的东西（别去找）

- 没有 CI、没有 lint、没有类型检查、没有覆盖率统计。
- 没有 E2E 框架（Playwright 只被两个 python 脚本直接调用，没有测试运行器）。
- 没有快照测试。

这不是疏忽，是「零依赖」的代价。补偿手段是：约定写死 + 发版前手工清单。

---

## 6. 发版流程

### 6.1 顺序不能颠倒

```
改代码 → 跑全部测试 → 起服务验收 → 才动版本号 → 打包 → 提交 → 推送
```

版本号是「已验证」的印章，不是「我改完了」的标记。功能没验就升版，
等于把印章盖在空白纸上。

### 6.2 盖章

```bash
node tools/stamp.js --bump c --note "一句话说明改了什么"
```

- `c` 位：修 bug、文案、样式微调
- `b` 位：新增 / 移除功能、改交互结构
- `a` 位：不兼容的重构

脚本会一次写齐并回读校验四处：`js/core.js` 的 `APP_VER` / `APP_BUILD`、
`version.json` 的 `ver` / `build` / `note`、`sw.js` 的 `CACHE`。

**脚本不管的两处，要手动补**：
1. `README.md` 顶部标题的版本号；
2. `README.md`「十、版本」里补一段更新说明。

### 6.3 打包

```bash
node tools/package.mjs
```

做的事：读版本 → 构建号 +1 → 清掉上一版清单里已不存在的文件 → 23 项校验 →
写 `build-info.json` 与 `.artifacts.json` → 打 `worktool-v<版本>-build<构建号>.zip`。

**任何一项校验失败就非 0 退出，此时不写清单、不打包**，仓库保持原样。
zip 先写 `.tmp` 再改名，中断不会产生坏包。

产物与包的位置：

```
仓库根                           可部署产物（就是源码本身）
../worktool-v1.15.0-build3.zip   交付包（在仓库外，不污染仓库）
```

### 6.4 提交

提交信息格式照历史来，**单行、不写 body、不加 trailer**：

```
生活工具箱-v1.15.0：新增二维码生成与识别；复用局域网传输的编解码模块
```

版本号必须与 `stamp.js` 盖出来的一致。细节用「：」分句、用「；」并列。

### 6.5 推送

Pages 是**覆盖式替换，发版即上线**。推之前务必确认本机验收过了。
推送后核对三件事：

1. `…/worktool/version.json` 的版本号是对的；
2. 关键文件的 MD5 与本地一致；
3. 已删除的旧文件返回 404（确认是全量替换，不是增量残留）。

---

## 7. 技术债

按「会不会咬人」排序，不是按「改起来爽不爽」。

| # | 债 | 影响 | 触发条件 / 什么时候该还 |
|---|---|---|---|
| 1 | 自研二维码解码器只有 17 条合成样本用例，没有真机样本库 | 弱光、低分辨率、反光屏幕下成功率未知 | 用户反馈「扫不出来」时，先收真实失败样本再调参，别盲改阈值 |
| 2 | 局域网直传 `iceServers: []`，无 TURN | 跨网段、对称 NAT 必然失败 | 只在同 Wi-Fi 场景够用。要跨网就得引 STUN/TURN，那会破「不联网」承诺，需要产品决策 |
| 3 | 无 CI，两个 check 脚本靠人手动跑 | 布局 / 直传回归只能靠自觉 | 一旦出现「本地过了线上坏了」，就该上一个最小 workflow（只跑 node 测试） |
| 4 | 移动端只验 393 / 360 两个宽度 | 平板、折叠屏、横屏未覆盖 | 收到相关反馈时补 `SCENES` |
| 5 | 源码与产物是同一份，根目录会被 Pages 全量暴露 | `README.md`、`AGENTS.md`、`test/` 都可被公开访问 | 里面一旦出现内网地址、密钥、客户名，就必须立刻改为 Actions 构建 + 只发布站点文件 |
| 6 | `start-server.sh` 与 `启动本地服务器.command` 仍用 python http.server | `.wasm` MIME 不对，WebP 功能在这两个入口下会失败 | 下次有人踩到就直接改成调用 `tools/dev-server.mjs`，或删掉这两个脚本只留 `dev.sh` |
| 7 | `apple-touch-icon` 引 `icon-192.png` | 该图有透明像素且尺寸非 180，iOS 主屏会填黑底 | 有人反馈主屏图标难看时，出一张 180×180 不透明版本 |
| 8 | `js/tools/*.js` 用字符串拼 HTML | 全靠 `esc()` 自觉，无编译期保障 | 出现一次 XSS 或转义遗漏就必须上模板函数 |
| 9 | 无 lint / 无类型检查 | 低级错误靠人眼 | 如果接手人 ≥2 人，考虑加一个不依赖 npm 的 `node --check` 批量脚本 |
| 10 | 版本探针「发现新版本」这条链路没有回归用例 | 改了 `sw.js` 可能悄悄拦住 `version.json` | 下次动 `sw.js` 时补一条用例：断言 `version.json` 不被缓存 |

---

## 8. 排查手册

| 症状 | 先看哪里 | 一句话判断 |
|---|---|---|
| 首页打不开 / 404 | 根目录有没有 `index.html` | 少了就是文件没提交或被 `.gitignore` 吞了 |
| 打开是旧版 | `node test/version.test.js` | 四处不一致，或 SW 没换 |
| 白屏几秒 | `index.html` 的 `<head>` | 启动遮罩样式被挪走了 |
| 工具不出现 | `loader.js` 的 `ASSETS` | 漏了脚本 |
| 断网缺件 | `sw.js` 的 `SHELL` | 漏了资源 |
| 刷新丢数据 | `core.js` 的 `normalize()` | 字段没登记 |
| 点一次触发两次 | 对应工具的 `onLeave()` | 监听器没清 |
| 手机右侧被切 | `check-layout.py` | 元素撑破视口 |
| 扫码无反应 | `scanner.js` 的 `canScan()` | 权限 / HTTPS / 解码器 |
| 直传卡在第一步 | 配对页步骤条 | 没进入「扫对方应答码」 |
| WebP 失败 | 服务端 MIME | 用了 `python -m http.server` |
| 图标黑底 | `apple-touch-icon` | 透明通道 / 尺寸不是 180 |
| 打包报版本不一致 | 跑 `stamp.js` | 手改了其中一处 |
| 打包报缺文件 | 输出里列了路径 | 引用写了但文件不在盘上 |
| 打包报「部署区非常见扩展名」 | 根目录列表 | 误放了设计稿 / 草稿 |

**通用三步**：① 看控制台第一条红字；② 看 Network 里哪个请求 404；
③ 对比 `git status`，确认文件真的在盘上而不是只在编辑器里。

---

## 9. 交接 checklist

拿到包当天：

- [ ] `bash tools/dev.sh` 能起，首页五个工具都能点开
- [ ] `for f in test/*.test.js; do node "$f" || exit 1; done` 是 377 条全绿
- [ ] `node tools/package.mjs` 能跑通，23 项校验全过、zip 生成
- [ ] 读过 `AGENTS.md`（约定比本文件更细）
- [ ] 读过本文件 §3 的 12 条硬约定
- [ ] 知道根目录就是线上目录，版本号只能 `stamp.js` 改
- [ ] 确认自己能访问 GitHub 仓库，知道 Pages 发布源是仓库根 `/`

第一次改代码：

- [ ] 改的是根目录里那份文件本身，没有另建产物目录
- [ ] 新增脚本进了 `loader.js` 的 `ASSETS`
- [ ] 新增资源进了 `sw.js` 的 `SHELL`
- [ ] 新数据字段进了 `blankDB()` 和 `normalize()`
- [ ] 用户输入都过了 `esc()` / `escAttr()`

第一次发版：

- [ ] 测试全绿
- [ ] 手工验收清单（§5 第三层）逐条过完
- [ ] `stamp.js --bump ?` 选对了位（c / b / a）
- [ ] README 顶部版本号和「十、版本」都补了
- [ ] `package.mjs` 校验全过
- [ ] 提交信息是 `生活工具箱-vX.Y.Z：…` 单行格式
- [ ] 推送后核对了 version.json、MD5、旧文件 404

---

## 10. 还没做的事

见 `TODO.md`。那里是唯一权威，本文件不重复维护待办列表 ——
两份清单必然有一份是过期的。
