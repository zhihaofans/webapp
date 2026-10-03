# 生活工具箱 · v1.0.0

泛生活人群的多功能在线工具箱工作台。**多文件交付、零外部依赖**：所有样式、脚本、图标都是本目录下的独立文件，不引用任何 CDN、字体服务或组件库。

当前状态：**框架 + 两个可用工具** —— 图片转 WebP、GitHub 链接转 jsDelivr。侧拉栏还有 4 个分组、11 个已排期的工具位。

---

## 一、快速开始

### 方式 A：本地起一个静态服务（推荐）

多文件项目应当通过 HTTP 访问，这也是手机端唯一可行的方式。任选一条：

```bash
cd 生活工具箱-v1.0
python3 -m http.server 8787        # 然后浏览器打开 http://localhost:8787
```

macOS 上也可以直接双击 `启动本地服务器.command`（首次使用需 `chmod +x 启动本地服务器.command`），它会自动起服务并打开浏览器。

> **不建议直接双击 `index.html`**。以 `file://` 打开时浏览器会以 CORS 拦截 CSS `mask` 对本地 SVG 的引用，图标会自动降级成 `<img>` 直引 —— 能看、能用，但图标不再跟随主题换色。`file://` 下 Service Worker 也不会注册（离线缓存失效）。

### 方式 B：部署到静态托管

整个目录原样上传即可（GitHub Pages / Vercel / Netlify / 任意对象存储静态站）。没有构建步骤，没有后端，没有环境变量。

#### GitHub Pages 特别注意

**可以，且不需要改一行代码** —— 已按「项目站」（`https://<用户名>.github.io/<仓库名>/` 这种子路径形式）实测通过。下面三条照做就行：

1. **把本目录的内容放到仓库根目录**，不要连 `生活工具箱-v1.1/` 这层文件夹一起提交。
   否则访问地址会变成 `…github.io/<仓库名>/生活工具箱-v1.1/` —— 能用，但中文路径会被百分号编码成一长串。
2. **保留根目录的 `.nojekyll`**（本包已带一个空文件）。
   GitHub Pages 默认会跑一遍 Jekyll 构建，`.nojekyll` 用来关掉它，避免构建环节引入意外。
3. **仓库 Settings → Pages → Source 选 `Deploy from a branch`，分支 `main`、目录 `/ (root)`**，保存后等一两分钟。

为什么它天然适配：

| 特性 | 为什么在 Pages 子路径下没问题 |
|---|---|
| 路由 | 用 **hash 路由**（`#/image2webp`），不依赖服务端重写，不需要 `404.html` 兜底 |
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
生活工具箱-v1.0/
├── index.html                     入口：骨架 + 挂载点 + 挂载加载器（无任何内联样式/脚本）
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
│   │       ├── image2webp.css     图片转 WebP
│   │       └── github2jsdelivr.css  GitHub 转 jsDelivr
│   └── icons/                     43 个独立 SVG 图标 + logo.svg（应用标识）
│
└── js/
    ├── loader.js                  渐进加载器：按序注入模块 + 注册 Service Worker
    ├── core.js                    工具函数 / 图标 / Store / 主题 / 吐司 / 抽屉 / 下载
    ├── registry.js                工具注册表：分组与工具的单一数据源
    ├── shell.js                   侧拉栏、顶栏、手机抽屉的渲染与交互
    ├── router.js                  基于 hash 的路由 + 占位页 + 兜底页
    ├── settings.js                数据与设置抽屉（外观 / 备份 / 恢复 / 清空 / 检查更新）
    ├── lib/
    │   └── github2jsdelivr.js     GitHub→jsDelivr 纯转换逻辑（无 DOM，可被 node 直接跑）
    ├── tools/
    │   ├── overview.js            概览页（编辑部式分组清单）
    │   ├── image2webp.js          图片转 WebP
    │   └── github2jsdelivr.js     GitHub 转 jsDelivr 界面
    └── app.js                     启动：按固定顺序调用上面各层
```

**加载顺序**（`loader.js` 里写死，也是依赖顺序）：

```
core → registry → shell → router → settings → lib/github2jsdelivr
     → tools/overview → tools/image2webp → tools/github2jsdelivr → app
```

全部是**独立经典脚本**，共享 `window.Toolbox` 命名空间，跨文件按名互访；改哪个模块只动那个文件。

---

## 三、已实现的功能

### 框架

| 能力 | 说明 |
|---|---|
| **分组式侧拉栏** | 桌面端常驻、可收起为纯图标（68px）；手机端自动变成顶部菜单 + 左侧抽屉（≤900px 切换） |
| **工具注册表** | 分组与工具在 `registry.js` 里声明一次，侧拉栏、概览页、路由三处自动同步 |
| **hash 路由** | `#/image2webp` 直达；未知地址有兜底页；未实现的工具有「路线图」占位页 |
| **深浅色主题** | 跟随系统 / 浅色 / 深色三态循环，深色为暖中性（不是纯黑） |
| **数据存储** | 所有偏好与记录写 `localStorage`，**输入即保存**，关掉页面再打开还在 |
| **备份与恢复** | 导出 JSON（文件名带日期）、导入（合并 / 覆盖）、清空均需二次确认 |
| **PWA** | 可添加到主屏、离线可用、「检查更新」比对 `version.json` |

### 图片转 WebP

| 能力 | 说明 |
|---|---|
| 输入方式 | 拖拽、点击选择、`Ctrl / ⌘ + V` 粘贴剪贴板图片，支持多选与格式混合 |
| 转换参数 | 输出质量 40–98%（滑块）、最长边限制（不限制 / 2560 / 1920 / 1280 / 800）、文件名后缀 |
| 批量处理 | 串行队列，逐张显示进度，单张失败不阻塞其余；可重试、可移除 |
| 结果呈现 | 原体积 → WebP 体积、缩减百分比、尺寸变化、体积对比条 |
| 下载 | 单张下载、一键下载全部（自动错开间隔，避免浏览器拦截） |
| 历史 | 记录文件名与体积（不存图片本身），保留最近 60 条 |
| 隐私 | 全程在浏览器内用 Canvas 完成，**不联网、不上传**，断网可用 |

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

侧拉栏、概览页、路由会自动出现这一项。需要新图标就往 `assets/icons/` 放一个同名 `.svg` 即可。

### 约定（重要）

- **调用链必须是单向的**。数据层 → 计算层 → 渲染层，渲染函数之间**不允许互相调用**。多个区域需要联动时，收敛到一个 `paint()` / `refreshAll()` 统一入口，由事件处理函数触发它。多个渲染函数互调会形成调用环，直接栈溢出。
- **图标**用 `T.ic('name', '额外class', 尺寸档位)` 生成；图标文件放在 `assets/icons/name.svg`，用 `fill="none" + stroke` 的线性风格，24×24 viewBox。
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

界面层没有引入测试框架（保持零依赖），改动后用 `python3 -m http.server` 起服务、在浏览器里过一遍即可；`file://` 与 HTTP 两种打开方式都要各看一次，图标走的是两条不同的代码路径。

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

1. **`file://` 打开时**图标降级为 `<img>` 直引（不再随主题换色），Service Worker 不注册。请用 HTTP 访问。
2. **WebP 编码能力**取决于浏览器。过老的浏览器会给出明确提示而不是静默失败。Safari 14+、Chrome 32+、Firefox 65+ 均可。
3. 单张图片超过 4000 万像素会先自动等比缩小，避免 Canvas 尺寸超限。
4. 浏览器存储配额约 5 MB，本项目只存文本记录，正常使用远不会触顶；触顶时会有明确提示。
5. `assets/icons/` 里有 12 个图标是给后续工具预留的（见 `registry.js` 中 `status: 'soon'` 的条目）。

---

## 九、版本

### v1.1.0 — 2026-10-03

新增工具与若干工程改进。

- **新增「GitHub 转 jsDelivr」**（开发工具分组）：批量生成 CDN 镜像链接，支持 blob / raw / tree / raw.githubusercontent 四种地址，可选联网校验版本、短 hash 补全、三种复制格式；纯逻辑独立成 `js/lib/github2jsdelivr.js`，无 DOM 依赖，可直接用 node 跑用例。
- 数据层新增 `links`（链接记录）与 `drafts`（输入草稿）两个区，各自在 `normalizeDB()` 里登记字段。
- 数据与设置面板新增「链接记录」计数与「清空链接记录」。
- 历史列表样式（`.hist` / `.hitem`）从 `features/image2webp.css` 上移到 `components.css` —— 已被两个工具共用，放在功能层是错的。
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
