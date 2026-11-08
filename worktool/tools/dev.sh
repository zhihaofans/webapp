#!/bin/bash
# 开发服务器包装：解压后跑这一条就能开工。
#
# 和 start-server.sh 的区别：start-server.sh 用 python3 -m http.server，
# 它不认 .wasm 的 MIME，图片转 WebP 会失败。这个走 tools/dev-server.mjs，
# MIME 是对齐过的，并且端口被占用时会自动顺延。
#
# 用法：
#   bash tools/dev.sh            # 端口 8787
#   bash tools/dev.sh 9000       # 指定端口
set -e
cd "$(dirname "$0")/.." || exit 1

PORT="${1:-8787}"
if command -v node >/dev/null 2>&1; then
  exec node tools/dev-server.mjs -p "$PORT"
fi

echo "没有找到 node，退回 python3 -m http.server（注意：它不认 .wasm MIME）" >&2
exec python3 -m http.server "$PORT"
