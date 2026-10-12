#!/usr/bin/env bash
#
# 版本号 / 构建日期的**唯一修改入口**。
#
# 为什么要有它
# ------------
# 以前版本号散在四个地方靠手工同步：core.js 的 APP_VER、version.json 的 ver、
# sw.js 的缓存名、index.html 的首页徽标；构建日期又是另一份（core.js 的
# APP_BUILD 与 version.json 的 build）。结果从 v1.21 到 v1.26.2 连续 8 次发版
# 都只改了 APP_VER、漏了构建日期，界面上「构建日期」一直停在 2026-10-03。
#
# 现在全项目只有 version.json 一个文件存这些信息，改完即全站生效：
#   · js/loader.js  启动时读它 → 填进 window.__LIFEHUB_META__
#   · js/core.js    APP_META.ver / APP_META.build 都取自它
#   · index.html    徽标由 loader 填（不再写死）
#   · sw.js         缓存名固定，不参与版本同步
#
# 日期格式
# --------
# 统一 YYYY/MM/DD（斜杠 + 补零），例如 2026/10/12 —— 全项目展示层一致。
# 注意数据层（localStorage 里的日期字段、<input type="date"> 的值）仍然是
# ISO 的 YYYY-MM-DD，那是存储格式，不能换；转换由 js/core.js 的 fmtDate() 负责。
#
# 用法
# ----
#   tools/bump.sh                        # 只把构建日期刷成今天
#   tools/bump.sh 1.26.4                 # 改版本号 + 刷构建日期
#   tools/bump.sh 1.26.4 "修了某某问题"   # 再顺手更新发布说明（note）
#   tools/bump.sh --show                 # 只看当前值，不改动
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FILE="$ROOT/version.json"

[ -f "$FILE" ] || { echo "✗ 找不到 $FILE" >&2; exit 1; }

if [ "${1:-}" = "--show" ]; then
  grep -n '"ver"\|"build"\|"note"' "$FILE"
  exit 0
fi

VER="${1:-}"
NOTE="${2:-}"
STAMP="$(date '+%Y/%m/%d')"

# 先校验版本号格式，别把脏值写进去
if [ -n "$VER" ] && ! printf '%s' "$VER" | grep -Eq '^[0-9]+\.[0-9]+(\.[0-9]+)?$'; then
  echo "✗ 版本号格式应为 x.y 或 x.y.z，收到：$VER" >&2
  exit 1
fi

# 用 node 读写 JSON：自动处理转义，也不会像 sed 那样被引号绊住
FILE="$FILE" VER="$VER" NOTE="$NOTE" STAMP="$STAMP" node -e '
const fs = require("fs");
const f = process.env.FILE;
const d = JSON.parse(fs.readFileSync(f, "utf8"));
const before = d.ver;
if (process.env.VER) d.ver = process.env.VER;
d.build = process.env.STAMP;
if (process.env.NOTE) d.note = process.env.NOTE;
if (!d.ver || !d.build || !d.url){ console.error("✗ version.json 必须含 ver / build / url"); process.exit(1); }
fs.writeFileSync(f, JSON.stringify(d, null, 2) + "\n");
const changed = process.env.VER && process.env.VER !== before;
console.log("✓ 版本 " + before + (changed ? " → " + d.ver : "（未变）") + " · 构建日期 " + d.build);
if (process.env.NOTE) console.log("  说明 " + d.note);
'

echo "--- 当前 version.json ---"
cat "$FILE"
