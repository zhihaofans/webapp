#!/bin/bash
# 双击本文件即可启动本地静态服务器并打开浏览器（macOS）
# 首次使用若提示没有权限，先在终端执行： chmod +x 启动本地服务器.command
cd "$(dirname "$0")" || exit 1
PORT=8787
URL="http://localhost:$PORT/index.html"

echo "生活工具箱 · 本地服务器"
echo "目录：$(pwd)"
echo "地址：$URL"
echo "按 Ctrl + C 停止"
echo

# 端口被占用时自动顺延
while lsof -i ":$PORT" >/dev/null 2>&1; do
  echo "端口 $PORT 已被占用，改用 $((PORT+1))"
  PORT=$((PORT+1))
  URL="http://localhost:$PORT/index.html"
done

(sleep 1 && open "$URL") &
exec python3 -m http.server "$PORT"
