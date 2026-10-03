#!/bin/bash
# 跨平台：启动本地静态服务器
# 用法： bash start-server.sh [端口]
cd "$(dirname "$0")" || exit 1
PORT="${1:-8787}"
echo "生活工具箱 · 本地服务器"
echo "打开：http://localhost:$PORT/index.html"
echo "按 Ctrl + C 停止"
exec python3 -m http.server "$PORT"
