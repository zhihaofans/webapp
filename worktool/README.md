# 生活工具箱 · v1.7.0

泛生活人群的多功能在线工具箱工作台。**多文件交付、零外部依赖**：样式与脚本都是本目录下的独立文件（CSS 8 个、JS 11 个，按层拆分），44 个界面图标为内联 SVG sprite（见「图标系统」一节），不引用任何 CDN、字体服务或组件库。

当前状态：**两个可用的工具** —— 图片格式转换、GitHub 转 jsDelivr。侧拉栏分 4 组共 10 项（其中 8 项为已排期的占位）；**首页只列已上线的工具**。

---

## 一、快速开始

### 方式 A：本地起一个静态服务（推荐）

多文件项目应当通过 HTTP 访问，这也是手机端唯一可行的方式。任选一条：

```bash
cd 生活工具箱-v1.7
python3 -m http.server 8787        # 然后浏览器打开 http://localhost:8787
```

macOS 上也可以直接双击 `启动本地服务器.command`（首次使用需 `chmod +x 启动本地服务器.command`），它会自动起服务并打开浏览器。

> **现在也能直接双击 `index.html`。** v1.5.0 把图标换成内联 sprite 后，`file://` 下与 HTTP 完全一致，不再有任何降级路径（此前用 CSS `mask` 引用独立 SVG 会被 CORS 拦截）。唯一差别是 `file://` 下 Service Worker 不注册，因此没有离线缓存，功能不受影响。

### 方式 B：部署到静态托管

整个目录原样上传即可（GitHub Pages / Vercel / Netlify / 任意对象存储静态站）。没有构建步骤，没有后端，没有环境变量。

#### GitHub Pages 特别注意

**可以，且不需要改一行代码** —— 已按「项目站」（`https://<用户名>.github.io/<仓库名>/` 这种子路径形式）实测通过。下面三条照做就行：

1. **把本目录的内容放到仓库根目录**，不要连 `生活工具箱-v1.7/` 这层文件夹一起提交。
   否则访问地址会变成 `…github.io/<仓库名>/生活工具箱-v1.7/` —— 能用，但中文路径会被百分号编码成一长串。
2. **保留根目录的 `.nojekyll`**（本包已带一个空文件）。
   GitHub Pages 默认会跑一遍 Jekyll 构建，`.nojekyll` 用来关掉它，避免构建环节引入意外。
3. **仓库 Settings → Pages → Source 选 `Deploy from a branch`，分支 `main`、目录 `/ (root)`**，保存后等一两分钟。

为什么它天然适配：

| 特性 | 为什么在 Pages 子路径下没问题 |
|---|---|
| 路由 | 用 **hash 路由**（`#/imageconvert`），不依赖服务端重写，不需要 `404.html` 兜底 |
| 路径 | 全部是**相对路径**，没有一处 `/assets/...` 这种绝对路径 |
| Service Worker | `register('sw.js')` 是相对注册，作用域自动落在 `/仓库名/` |
| Manifest | `start_url` 与 `scope` 都写的 `./`，安装到主屏后不会跳错目录 |
| 文件名 | 资源文件名全是 ASCII，不涉及大小写不匹配（Pages 是 Linux，大小写敏感） |

> 自定义域名（`CNAME`）或用户站（`https://<用户名>.github.io/` 根路径）同样可用，这两种情况下路径更简单，不会有任何差别。
>
> `启动本地服务器.command` 是给你本地开发用的，传到 Pages 上不影响运行，只是会被当成一个可下载文件。

---

## 二、目录结构

```
生活工具箱-v1.7/
├── index.html                     入口：图标池（44 个 <symbol>）+ 骨架 + 挂载点 + 加载器
├── manifest.webmanifest           PWA 清单（可安装到主屏、standalone）
├── sw.js                          Service Worker：同源资源「网络优先 + 离线回退」
├── version.json                   版本清单，「检查更新」的比对源
├── icon-192 / 512 / maskable-512.png   PWA 应用图标
├── 启动本地服务器.command / start-server.sh
│
├── assets/
│   ├── css/
│   │   ├── tokens.css             设计令牌（颜色/圆角/阴影/字体/尺度）+ 深色模式
│   │   ├── base.css               重置、排版、图标基座、滚动条
│   │   ├── layout.css             外壳：侧拉栏 / 顶栏 / 主区域 / 手机抽屉 / 响应式
│   │   ├── components.css         跨工具组件：按钮、表单、滑块、开关、分段选择、
│   │   │                          标签、指标、面板、吐司、抽屉、空状态、占位页
│   │   ├── boot.css               启动遮罩
│   │   └── features/
│   │       ├── overview.css       概览页
│   │       ├── imageconvert.css    图片格式转换
│   │       └── github2jsdelivr.css  GitHub 转 jsDelivr
│   └── （无 icons 目录 —— 全站零 SVG 文件，见「图标系统」）
│
└── js/
    ├── loader.js                  渐进加载器：按序注入模块 + 注册 Service Worker
    ├── core.js                    工具函数 / 图标引用 / Store / 主题 / 吐司 / 抽屉 / 下载
    ├── registry.js                工具注册表：分组与工具的单一数据源
    ├── shell.js                   侧拉栏、顶栏、手机抽屉的渲染与交互
    ├── router.js                  基于 hash 的路由 + 占位页 + 兜底页
    ├── settings.js                数据与设置抽屉（外观 / 备份 / 恢复 / 清空 / 检查更新）
    ├── lib/
    │   └── github2jsdelivr.js     GitHub→jsDelivr 纯转换逻辑（无 DOM，可被 node 直接跑）
    ├── tools/
    │   ├── overview.js            概览页（编辑部式分组清单）
    │   ├── imageconvert.js         图片格式转换
    │   └── github2jsdelivr.js     GitHub 转 jsDelivr 界面
    └── app.js                     启动：按固定顺序调用上面各层

test/                             纯逻辑用例（node 直接跑，不需要浏览器）
└── github2jsdelivr.test.js       链接归类、去重与拆行
```

**加载顺序**（`loader.js` 里写死，也是依赖顺序）：

```
core → registry → shell → router → settings
     → lib/github2jsdelivr
     → tools/overview → tools/imageconvert → tools/github2jsdelivr → app
```

全部是**独立经典脚本**，共享 `window.Toolbox` 命名空间，跨文件按名互访；改哪个模块只动那个文件。

---

## 三、已实现的功能

### 框架

| 能力 | 说明 |
|---|---|
| **分组式侧拉栏** | 桌面端常驻、可收起为纯图标（68px）；手机端自动变成顶部菜单 + 左侧抽屉（≤900px 切换） |
| **首页只列可用项** | 概览页通过 `T.readyTree()` 过滤，只展示 `status: 'ready'` 的工具；整组没有可用工具的分组也一并略过 —— 不拿点不动的条目充数 |
| **工具注册表** | 分组与工具在 `registry.js` 里声明一次，侧拉栏、概览页、路由三处自动同步 |
| **hash 路由** | `#/imageconvert` 直达；未知地址有兜底页；未实现的工具有「路线图」占位页 |
| **深浅色主题** | 跟随系统 / 浅色 / 深色三态循环，深色为暖中性（不是纯黑） |
| **数据存储** | 所有偏好与记录写 `localStorage`，**输入即保存**，关掉页面再打开还在 |
| **备份与恢复** | 导出 JSON（文件名带日期）、导入（合并 / 覆盖）、清空均需二次确认 |
| **PWA** | 可添加到主屏、离线可用、「检查更新」比对 `version.json` |

### 图片格式转换

| 能力 | 说明 |
|---|---|
| 输入方式 | 拖拽、点击选择、`Ctrl / ⌘ + V` 粘贴剪贴板图片，支持多选与格式混合 |
| **输出格式自选** | WebP / JPEG / PNG 三选一，选择会存下来。**只列出当前设备真正能编码的格式** —— 不支持的选项直接不出现（如 iOS 上不会出现 WebP），没有点错的可能 |
| 格式记忆 | 若保存的格式在当前设备不可用（例如设置从桌面端同步到了 iPhone），自动退到第一个可用格式，绝不产出编不出来的文件 |
| 转换参数 | 输出质量 40–98%（滑块）、最长边限制（不限制 / 2560 / 1920 / 1280 / 800）、文件名后缀 |
| 批量处理 | 串行队列，逐张显示进度，单张失败不阻塞其余；可重试、可移除 |
| 结果呈现 | 原体积 → WebP 体积、缩减百分比、尺寸变化、体积对比条 |
| 下载 | 单张下载、一键下载全部（自动错开间隔，避免浏览器拦截） |
| 历史 | 记录文件名与体积（不存图片本身），保留最近 60 条 |
| 隐私 | 全程在浏览器内用 Canvas 完成，**不联网、不上传**，断网可用 |

**关于 iOS / Safari**：实测与 MDN 兼容表一致 —— Safari、以及 iOS 上所有基于 WebKit 的浏览器，都**不支持用 Canvas 导出 WebP**（`toBlob('image/webp')` 会静默返回 PNG）。本工具的处理是：

1. 启动时真的编一张 2×2 的图，看返回值判断能力（Canvas 编码没有能力查询 API，只能这么测）；
2. 支持 WebP → 输出 WebP，侧栏显示一行确认；
3. 不支持 → 顶部如实说明原因，侧栏改为选择 JPEG / PNG，**输出文件名后缀也跟着变**，不会出现「后缀 .webp、内容其实是 PNG」的坏文件；
4. 编码完成后再核对一次 `blob.type`，万一浏览器在探测和编码之间表现不一致，会**中止并说明**而不是悄悄产出错误格式；
5. 侧栏提供「重新检测编码能力」，系统或浏览器升级后不用刷新页面即可重试。

想真正拿到 WebP，用电脑上的 Chrome / Edge / Firefox 打开本页即可（会自动切成 WebP，无需任何设置）。

**关于输出体积**：`toBlob('image/webp', q)` 对照片类素材通常能减 50–90%（实测 5.17 MB PNG → 829 KB，−84%）。截图、纯色图、已压缩过的 JPEG 收益会小一些，个别情况下 WebP 反而更大 —— 所以每条结果都直接给出体积对比，不做乐观断言。

### GitHub 链接转 jsDelivr

| 能力 | 说明 |
|---|---|
| 支持的输入 | `github.com/…/blob/…`、`/raw/…`、`/tree/…`、`raw.githubusercontent.com/…`，每行一个，自动去空行与重复 |
| 输出 | `https://cdn.jsdelivr.net/gh/user/repo@version/path`；`latest` 默认省略 `@version` 段 |
| 版本校验 | 可开关。开启后调一次 GitHub API：**短 hash 补全为完整 40 位 commit**（jsDelivr 对 commit 永久缓存），tag / 分支校验存在后**保持原样**（tag 比 hash 好维护） |
| 结果徽标 | 仓库根 / latest / 完整 commit / 短 hash→完整 commit / 标签·分支 / 未校验 / 无法识别，一眼看清每条链接的性质 |
| 复制 | 单条或全部；三种格式可选：纯链接 / `<script src="…">` / `@import url("…")` |
| 实时性 | 边打字边出结果，本地计算无延迟；联网校验分段回填，不会卡输入 |
| 草稿 | 输入框内容实时落盘，关掉页面再打开还在 |
| 历史 | 记录用过的链接（按输出地址去重，最多 30 条），可一键取回 |

**与参考实现（`github2jsdelivr v1.0`）的关系**：转换逻辑、正则、API 语义、`latest` 处理、短 hash 补全规则全部对齐，28 条用例逐条比对输出一致。在此之上补了几处它没有覆盖的情况：

| 输入 | 参考实现 | 本实现 |
|---|---|---|
| `…/blob/main/a.js#L10-L20` | 行号锚点混进文件名 → 链接错误 | 剥离 `#…` 与 `?…` |
| `…/tree/main/src` | `main` 被当成文件名 → 链接错误 | 识别为分支 + 目录 |
| `https://www.github.com/…` | 不匹配 | 支持 `www.` |
| `…/repo.git/blob/…` | 仓库名带 `.git` | 自动去掉 |

**关于联网**：这是全站**唯一**会发起外部请求的功能。开启「联网校验版本」后，仓库名会发给 `api.github.com`（未登录每小时 60 次配额），因此批量超过 20 条时只解析前 20 条并如实标注；命中配额限制会退回未校验状态而不是失败。关闭该开关后，本工具与其他工具一样全程本地计算。

---

## 四、如何新增一个工具

三步，不需要动其它任何文件：

**1. 在 `js/registry.js` 的 `T.GROUPS` 里确认分组存在**（不存在就加一行），并在 `T.TOOLS` 里补一条：

```js
'my-tool': {
  id: 'my-tool', group: 'calc', name: '我的工具', icon: 'calculator',
  status: 'ready',                       // ready = 已实现；soon = 路线图上
  sub: '一句话副标题',
  desc: '在概览页里展示的说明文字。',
  tags: ['标签一', '标签二']
}
```

**2. 新建 `js/tools/my-tool.js`**：

```js
(function (T) {
  T.register('my-tool', {
    render: function (host, tool) {
      host.innerHTML = '<div class="panel"><div class="panel__bd">…</div></div>';
      // 绑定事件、首次渲染
    },
    onLeave: function () {
      // 清理计时器、Object URL、document 级事件监听
    }
  });
})(window.Toolbox);
```

**3. 把文件加进 `js/loader.js` 的 `ASSETS` 数组**（放在 `js/app.js` 之前），并加进 `sw.js` 的 `SHELL` 预缓存清单。

侧拉栏、概览页、路由会自动出现这一项。需要新图标就往 `index.html` 的图标池里加一行 `<symbol id="i-名字">`，然后写 `T.ic('名字')` —— 不用新建文件、不用改文件名、不用动缓存清单。

### 图标系统（SVG sprite）

44 个界面图标内联在 `index.html` 顶部的 `<svg style="display:none">` 里，每个是一个 `<symbol>`：

```html
<symbol id="i-image" viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="15" rx="2.2"/>…</symbol>
```

取用：`T.ic('image')` → `<svg class="ic" aria-hidden="true"><use href="#i-image"/></svg>`

v1.5.0 把原本 45 个独立 `.svg` 文件合并了进来，理由是实打实测出来的：

| | 独立文件（≤ v1.4） | 内联 sprite（v1.5+） |
|---|---|---|
| 首次加载传输量 | **11.7 KB**（逐文件 gzip 之和） | **2.9 KB** |
| 请求数 | 45 个，且每个都要运行时回填进 SW 缓存 | **0** |
| `file://` 可用性 | 需降级为 `<img>`，且不跟随主题换色 | 与 HTTP **完全一致** |
| 加一个图标 | 新建 `.svg` + 命名匹配 + 改进 `sw.js` 缓存清单 | 加一行 `<symbol>` |

**小文件是 gzip 最差的场景**：每个文件 340 字节里约 190 字节是重复的 `<svg>` 外壳与深色媒体查询，压缩字典还没热身就结束了，逐文件 gzip 只能压到 26%（15.5 KB → 11.7 KB）；合并后同样的内容能压到 17%（15.5 KB → 2.9 KB）。

**顺带删掉的复杂度**：`<use href="#...">` 是文档内引用，不受 CORS 约束，所以「按协议在 `mask` 与 `<img>` 之间切换」的整个降级分支没了 —— 连带 v1.0 那个「`mask` 相对路径在样式表所在目录下解析、46 个图标全部 404」的坑也一并根除。

**颜色不写死**：`.ic` 上写 `stroke:currentColor`，继承会穿透 `<use>` 的 shadow tree，图标跟着自身 `color` 走 —— 侧栏选中态、深色模式都自动适配，不需要给 45 个图标各写一份媒体查询。

**favicon 也是内联的**：`<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg…">`。写成 data URI 而不是独立文件，是为了让全站真正做到零 SVG 文件；矢量性质与零请求都没有损失。注意 data URI **必须带 `data:image/svg+xml,` 前缀**，漏掉它浏览器会静默不显示图标（这个坑我在改动时真踩了一次，靠实测才发现）。

### 约定（重要）

- **调用链必须是单向的**。数据层 → 计算层 → 渲染层，渲染函数之间**不允许互相调用**。多个区域需要联动时，收敛到一个 `paint()` / `refreshAll()` 统一入口，由事件处理函数触发它。多个渲染函数互调会形成调用环，直接栈溢出。
- **图标**用 `T.ic('name', '额外class', 尺寸档位)` 生成，输出 `<svg class="ic"><use href="#i-name"/></svg>`。图标定义在 `index.html` 的图标池里，`<symbol>` 内只写 `viewBox` + 路径；描边、填充、线宽、圆角统一由 `.ic` 给（继承会穿透 `<use>` 的 shadow tree），颜色用 `currentColor` 自动跟随主题。风格为 `fill="none" + stroke` 线性，24×24 viewBox。
- **所有用户输入进 innerHTML 前必须过 `T.esc()` / `T.escAttr()`**。
- **新增数据字段必须在 `core.js` 的 `normalizeDB()` 里登记**。`normalize()` 是逐字段重建（不是浅拷贝），漏登记的表现是「存进去了，刷新就没了」。
- **`.pagefoot` 渲染在 `.view` 内部**，横向留白由 `.view` 提供，不要再加左右 padding。

---

## 五、数据与隐私

- **存储位置**：浏览器 `localStorage`，主键 `lifetoolbox.v1`，快照键 `lifetoolbox.v1.bak`（主数据损坏时自动回退）。
- **不落库**：图片转换记录只保存文件名、体积、尺寸与时间，**图片本身不会被存进浏览器**。
- **不联网**：没有任何后端请求。图片转换的每一步都在本机完成。唯一例外是「GitHub 转 jsDelivr」的版本校验（可在工具内关闭），它只把仓库名发给 `api.github.com`，不发送任何本机数据。
- **草稿**：各工具输入框的内容也会实时落盘（`drafts` 字段），用于「关掉再打开还在」。
- **换设备**：用「数据与设置 → 导出 JSON 备份」迁移；部署到公网后，访客看到的是他自己的空白数据。
- **清理**：清空转换记录 / 清空全部数据都有二次确认。

---

## 六、跑测试

转换逻辑与界面是分开的，所以纯逻辑可以直接用 node 跑，不需要浏览器：

```bash
node test/github2jsdelivr.test.js            # 22 条离线用例（不打网络）
node test/github2jsdelivr.test.js --online   # 再追加 3 条真实 GitHub API 用例
```

界面层没有引入测试框架（保持零依赖），改动后用 `python3 -m http.server` 起服务、在浏览器里过一遍即可。Service Worker 注册与导航回退在 `file://` 与 HTTP 下行为不同，两种协议各看一次更稳妥。

## 七、设计语言

克制、高级、有生活感，刻意避开「一屏圆角卡片」的模板感：

| 维度 | 做法 |
|---|---|
| 底色 | 暖纸色 `#f4f1ea`，深色模式为暖中性 `#1a1917`（不是纯黑） |
| 点缀 | 赤陶 `#bb5f3d` 单色点缀，另有 sage / amber / plum / sky 四组语义色 |
| 层次 | 靠**细分隔线 + 悬挂序号 + 字距**组织信息，而不是靠阴影和卡片堆叠 |
| 字体 | 正文系统无衬线，标题与数字用衬线体，数值统一等宽（`tabular-nums`） |
| 动效 | 只有视图淡入、抽屉滑入、进度条推进三类，全部走同一条缓动曲线 |
| 圆角 | 6 / 9 / 13 / 18 / 26px 五档，按钮用胶囊、面板用 13px，不做超大圆角 |

颜色、圆角、阴影、字体全部集中在 `assets/css/tokens.css`，改一处即可整站换肤。

---

## 八、已知限制

1. **`file://` 打开时** Service Worker 不注册，因此没有离线缓存；其余功能与图标显示均与 HTTP 完全一致。（v1.5.0 起不再需要图标降级路径。）
2. **WebP 编码能力**取决于浏览器。Chrome / Edge / Firefox 可用；**Safari 与所有 iOS 浏览器不可用**（WebKit 限制），会自动改用 JPEG/PNG 兜底并在界面说明，不会静默失败。
3. 单张图片超过 4000 万像素会先自动等比缩小，避免 Canvas 尺寸超限。
4. 浏览器存储配额约 5 MB，本项目只存文本记录，正常使用远不会触顶；触顶时会有明确提示。
5. 图标池里有若干图标是给后续工具预留的，对应 `registry.js` 中 `status: 'soon'` 的条目。

---

## 九、版本

### v1.7.0 — 2026-10-04

**移除「Live Photo 提取」工具。** 原因是它在 iOS 上不可能达到预期效果：从相册选取实况照片时，系统只把静态那一帧交给网页，视频轨在浏览器拿到之前就被剥离了 —— 这是 Web 平台的接口缺失（原生 App 有 `PHLivePhotoView`，网页没有对应能力），**任何网页都绕不过去**。v1.6 曾试图用「iOS 引导 + 从视频首帧补图」缓解，但那要求用户先把实况照片手动导出成视频，步骤比直接用系统功能还多，收益不划算，故整体下线。

- 删除 `js/tools/livephoto.js`、`js/lib/livp.js`、`assets/css/features/livephoto.css`，以及只服务于它的 `test/livp.test.js` 与 `test/fixtures.js`，共 5 个文件。
- 从 `registry.js` 工具表、`loader.js` 加载列表、`sw.js` 预缓存清单、`index.html` 的样式引用与图标 sprite 中一并摘除，**不留悬空引用**。
- 规模变化：图标 45 → 44 个，CSS 9 → 8 个，JS 13 → 11 个，侧拉栏 11 → 10 项（其中已上线 2 项）。
- 自研的零依赖 ZIP 读取器（约 7 KB）随之移除 —— 它此前只服务于 `.livp` 拆包。
- 其余改进**全部保留**：图片格式自选（WebP / JPEG / PNG + 设备能力探测）、图标内联 sprite（零请求）、移动端 44px 触控目标。
- 顺手把 `.tag--sky` / `.tag--plum` 两个色变体从功能层提升到 `components.css`，与 `accent` / `sage` / `amber` / `danger` 并列 —— 此前 `github2jsdelivr.css` 里的定义与组件层重复。

### v1.6.0 — 2026-10-03

起因是一个真实反馈：**iPhone 上从相册选实况照片，工具只显示静态图**。查下来这不是 bug，是 iOS 的系统限制，于是把「说清楚 + 给出可行路径」两件事都做了。

- **确认了根因**：Web 平台没有读取 Live Photo 的接口。原生 App 用 `PHLivePhotoView` / `kUTTypeLivePhoto`，而浏览器 `<input type="file">` 走系统照片选择器，Apple 明确说明这条路径**只回传静态那一帧**，视频轨在交给网页前已被剥离。照片 App 的「存储到文件」同样会移除视频。**任何网页都绕不过去**，此前界面没有解释，容易被当成工具坏了。
- **新增 iOS 专属引导栏**（`iosGuideHTML`）：只在该设备渲染，讲清原因并给出三条可行路径 —— ① iOS 18+「存储为视频」；② macOS「导出未修改的原片」拿 HEIC+MOV；③ 直接给 `.livp`。iPadOS 13 起 UA 伪装成 macOS，靠 `maxTouchPoints > 1` 一并识别。
- **新增「视频首帧补图」**：只有视频轨没有静态图时，用 `<video>` + `<canvas>` 抽首帧生成 JPEG 当静态图。这样走「存储为视频」的 iPhone 用户，依然能拿到「静态图 + 视频」两个文件。派生的图带 `derived` 标记，界面标注「视频首帧」「从视频首帧生成」，且不提供「另存为 JPEG」。
- 抽帧的工程细节：iOS 上必须 `muted` + `playsInline` 才会解码；首帧常停在未解码状态，要 seek 一小段才真正出画；15 秒超时兜底；超过 200MB 的视频跳过抽帧以免吃满内存。
- 引入 `effStill()` 作为静态图的**统一取用口**（原生图优先、派生图兜底），下载、统计、徽标、按钮文案全部走它，避免各处各自判断 `g.still` 造成不一致。
- **回归验证**：`.livp` 拆包、`HEIC + MOV` 配对不受影响 —— 原图仍标原始格式（如 JPEG），仍保留「另存为 JPEG」，也**不会**被误标成「静态图由视频补出」。
- 顺手修掉两处界面问题：移动端按钮高度由 40/36px 提升到 `--tap`（44px），符合触控目标下限；补上 `.tag--sky` 定义（此前一直引用但从未定义，靠基础 `.tag` 样式兜底）。

### v1.5.0 — 2026-10-03

**45 个图标合并为内联 SVG sprite** —— 首次加载传输量从 11.7 KB 降到 2.9 KB（−75%），图标请求从 45 个降到 0，`index.html` 净增约 2.8 KB gzip。

- 图标池改为 `index.html` 顶部的一组 `<symbol>`，取用方式变成 `<svg class="ic"><use href="#i-名字"/></svg>`。
- **删掉整套 `file://` 降级分支**：`ICON_MODE` / `ICON_BASE` / `.ic--img` 全部移除，`ic()` 从 15 行缩到 4 行。`<use>` 是文档内引用，不受 CORS 约束，两种协议下渲染结果逐像素一致（实测可见像素占比均为 0.386）。
- **删掉 45 份重复的深色媒体查询**：改用 `stroke:currentColor`，颜色由 `.ic` 的 `color` 统一驱动。这同时修掉一处旧不一致 —— 此前 `file://` 降级成 `<img>` 后，图标色是硬编码的 `#6f6a60`，无法跟随选中态。
- 几何属性（`fill` / `stroke-width` / `linecap` / `linejoin`）集中到 `.ic`，靠 SVG 的继承向下传递，`<symbol>` 里只剩 `viewBox` 与路径。
- 顶栏菜单与抽屉关闭图标改用 `.ic--bold`（`stroke-width:2`）保持原有视觉。
- **全站零 SVG 文件**：45 个界面图标内联为 sprite；应用标识（favicon）以 **data URI** 内联在 `index.html` 的 `<link rel="icon">` 里 —— 同样是矢量、同样零请求，但不再需要一个独立文件。`manifest.webmanifest` 里原来的 SVG 图标项已移除，PWA 安装图标由 `icon-192` / `icon-512` / `icon-maskable-512` 三个 PNG 提供。
- 图标随 `index.html` 一起进 Service Worker 缓存，离线完整性比此前更可靠（原先那 45 个图标要靠运行时回填才进缓存）。
- **全站零 SVG 文件**：favicon 改为内联 data URI，`manifest.webmanifest` 移除 SVG 图标项（PWA 图标由三个 PNG 覆盖），`assets/icons/` 目录整个删除。
- Live Photo 的测试样本改为 `test/fixtures.js` 按需生成（见第七节），源码包不再含二进制测试媒体。

### v1.4.0 — 2026-10-03

- **新增「Live Photo 提取」**：拆出实况照片的静态图与视频。支持 `.livp` 单文件、`HEIC + MOV` 配对、以及没有视频轨的裸 HEIC 三种形态。
- **ZIP 解析自己写**（`js/lib/livp.js`，约 7 KB，零依赖）：deflate 交给原生 `DecompressionStream('deflate-raw')`；不引 JSZip（97.6 KB / gzip 28.4 KB）。理由见上文对比。
- 格式判定用**魔数**而非后缀；带 data descriptor 的 ZIP 也能正确读（尺寸以中央目录为准）。
- **不做转码**：静态图保持原格式；只有在浏览器真能解码时才出现「另存为 JPEG」。
- 修掉两个「同类」的静默 bug，都是实测才暴露的：
  - `paneHTML` 里按钮的 `data-i` 留了 `'IDX'` 占位却没替换 → `parseInt` 得 NaN → 事件处理静默 return，表现为「按钮点了没反应且不报错」。现在索引解析失败会明确提示。
  - `groupPairs` 没把 `container` 字段带过去 → 所有结果（包括合法 livp）都被标成「无法识别」。
- 修掉一个 CSS 层的隐性 bug：组件类普遍显式写了 `display`，**类选择器的优先级高于浏览器给 `[hidden]` 的 UA 规则**，导致设了 `hidden` 的「无法预览」遮罩和「另存为 JPEG」按钮照常显示。现已在 `base.css` 里一次性钉死 `[hidden]{display:none!important}`。

### v1.3.0 — 2026-10-03

- **图片工具改为自选输出格式**：WebP / JPEG / PNG 三选一，选择持久化。格式列表由 `availableFormats()` 按设备能力动态生成 —— **不支持的格式根本不会出现**，而不是出现后再报错；保存的格式若在当前设备不可用会自动降级。
- 工具随之更名：`图片转 WebP` → **`图片格式转换`**（路由 `#/image2webp` → `#/imageconvert`，文件同步改名）。名字不能骗人：能输出 JPEG/PNG 却叫「转 WebP」是错的。
- **移除「日常助手」分组**（日常记账 / 习惯打卡 / 提醒与倒计时）。
- **首页只展示已上线的工具**：新增 `T.readyTree()` 过滤，整组没有可用工具的分组也不显示；首页行内改为展示工具的能力标签，不再逐行挂「可用」徽标。
- 修复：规划中占位页的「先用某工具」按钮指向了改名前的路由，是个断链。
- 能力提示条从报错红改为信息琥珀色 —— 设备不支持 WebP 时工具照常可用，涂红会让人误以为坏了。

### v1.2.0 — 2026-10-03

- **修复 iOS / Safari 上图片工具直接报错不能用**：原因是 WebKit 不支持 Canvas 导出 WebP，原实现只弹一句「不支持」就没了下文。现改为「能力探测 → 如实说明 → JPEG / PNG 兜底」，iPhone 上也能正常用；文件名后缀、汇总统计、历史记录、侧栏说明全部跟随真实输出格式，不再写死 WebP。
- **新增编码结果类型校验**：编码完成核对 `blob.type`，杜绝产出「后缀 .webp、内容是 PNG」的坏文件（这是同类工具最常见的坑）。
- **JPEG 兜底时先铺白底**：JPEG 无 alpha 通道，透明区域原本会变成纯黑。
- **启动页显示版本号**：`core.js` 一加载完就把版本填进加载遮罩，不额外发请求、也不存在两处版本号对不上。
- 侧栏 logo 的版本徽标不再有 `v—` 占位闪烁。

### v1.1.0 — 2026-10-03

新增工具与若干工程改进。

- **新增「GitHub 转 jsDelivr」**（开发工具分组）：批量生成 CDN 镜像链接，支持 blob / raw / tree / raw.githubusercontent 四种地址，可选联网校验版本、短 hash 补全、三种复制格式；纯逻辑独立成 `js/lib/github2jsdelivr.js`，无 DOM 依赖，可直接用 node 跑用例。
- 数据层新增 `links`（链接记录）与 `drafts`（输入草稿）两个区，各自在 `normalizeDB()` 里登记字段。
- 数据与设置面板新增「链接记录」计数与「清空链接记录」。
- 历史列表样式（`.hist` / `.hitem`）从 `features/` 下的图片工具样式上移到 `components.css` —— 已被两个工具共用，放在功能层是错的。
- 版本号改为只在 `core.js` 维护一处，界面里的 `v1.x` 由 JS 填充，避免改版本时漏改 HTML。
- `sw.js` 缓存版本号跟进到 `toolbox-v1.1.0`。

### v1.0.0 — 2026-10-03

首个版本。

- 分组式侧拉栏框架（4 个分组 / 12 个工具位，其中 1 个已实现）
- 基于注册表的工具接入机制 + hash 路由 + 路线图占位页 + 未知地址兜底
- 图片转 WebP：拖拽 / 选择 / 粘贴、质量与最长边可调、批量串行转换、体积对比、批量下载、历史记录
- 输入即保存的本地存储、JSON 导出导入、二次确认清空
- 深浅色三态主题、手机端抽屉导航、PWA（可安装 / 离线可用 / 检查更新）

**开发过程中修掉的问题**（都是实测才暴露的）：

| 问题 | 根因 | 处理 |
|---|---|---|
| 图标全部 404 | CSS 自定义属性里的相对 URL 是在**使用它的样式表**所在目录解析的（`assets/css/`），于是 `assets/icons/x.svg` 被拼成了 `assets/css/assets/icons/x.svg` | 改为把 `mask-image` 直接写在元素 inline style 上（inline style 按文档地址解析） |
| 图标算出空 mask | `style` 属性用双引号定界，而 URL 里也写了双引号，属性被提前截断 | URL 改用单引号 |
| 上传的图片一张都转不了 | `input.files` 是**实时集合**，先 `value = ''` 再读就永远是空的 | 先拷贝成数组再清空 |
| 刷新后设置全丢 | 启动链路漏了「读 localStorage」这一步，一直拿着空库在跑 | 启动第 1 步改为 `loadStore()` |
| 手机端菜单按钮点不动 | 媒体查询里给 `.mscrim` 强制了 `display`，关闭状态的遮罩以 `opacity:0` 铺满全屏拦截点击 | 移除该规则，显示交给 JS 写 inline display |
| 点一次弹出两次文件框 | 文件输入放在投放区内部，程序化 `click()` 冒泡回容器又触发一次 | 把 input 移出投放区 |
