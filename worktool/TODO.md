# TODO · 生活工具箱

唯一权威的待办清单。做完一条删一条，别在这里写「已完成」——
已完成的看 `README.md`「十、版本」的更新记录。

---

## 待处理（按会不会咬人排序）

### 1. `apple-touch-icon` 在 iOS 主屏显示为黑底

`index.html` 目前让 `apple-touch-icon` 指向 `icon-192.png`。两个问题叠加：

- 该图有透明像素，iOS 会把透明区域填成黑色；
- iOS 主屏图标期望 180×180，192 会被缩放，边缘发虚。

**修法**：出一张 180×180、不透明、四角按 iOS 圆角遮罩预留安全区的新图
（如 `apple-touch-icon-180.png`），改 `index.html` 的 `<link rel="apple-touch-icon">`。
同时把它加进 `sw.js` 的 `SHELL`。做完跑 `node tools/package.mjs` 确认引用校验通过。

### 2. `sw.js` 清理缓存时可能误删同域其他项目的缓存

当前 `activate` 里按「key 不等于本项目的 CACHE 名」来删。线上 `zhihaofans.github.io`
是共享域，`workbench/` 也在同一域名下，若两个项目都注册了 SW，会互相清掉对方缓存
（两者作用域不同，实际触发概率低，但不是零）。

**修法**：改成只删前缀匹配本项目命名空间的那批，例如
`k.indexOf('toolbox-') === 0 && k !== CACHE`。改完跑 `node test/sw.test.js`。

### 3. `start-server.sh` / `启动本地服务器.command` 的 MIME 不对

两者都用 `python3 -m http.server`，不认 `.wasm` 与 `.webmanifest`，
在这两个入口下图片转 WebP 会失败。

**修法**：二选一 —— ① 都改成 `exec node tools/dev-server.mjs -p "$PORT"`（node 不在时回退 python）；
② 直接删掉，只留 `tools/dev.sh`，并在 README「快速开始」里改掉引用。

### 4. 自研二维码解码器缺真实样本库

`js/lib/qrdec.js` 目前只有 17 条合成样本用例（含透视、旋转、污损），
弱光、低分辨率、屏幕反光下的成功率没有数据。

**修法**：收 10~20 张真实失败照片放进 `test/fixtures/`，先统计失败率再决定调哪个环节
（二值化阈值 / 定位图案识别 / 校正图形定位），不要凭感觉改。

### 5. 没有 CI

测试、布局检查、直传检查全靠手动。一旦出现「本地过了线上坏了」，就会想加。

**修法**：最小可用版本 —— GitHub Actions 只跑 `for f in test/*.test.js; do node "$f"; done`，
不需要装任何依赖（项目本身零依赖，`node` 是 runner 自带的）。

### 6. 版本探针链路没有回归用例

`sw.js` 必须完全不拦 `version.json`，否则「检查更新」永远说已是最新。
现在只有 `sw.test.js` 的策略级用例，没有针对这个具体路径的断言。

**修法**：在 `sw.test.js` 里补一条：断言 `version.json` 命中 bypass 分支。

---

## 明确不做

- 不做账号体系：数据在用户浏览器里，导出 / 导入就是迁移手段。
- 不做云端同步：一旦联网同步，就要处理冲突、隐私、合规，和小工具定位不符。
- 不做「大而全」的工具集合：每加一个工具，`SHELL` 与首屏加载都会变重。
