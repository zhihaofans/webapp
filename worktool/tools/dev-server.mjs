#!/usr/bin/env node
/* ============================================================
   tools/dev-server.mjs — 零依赖本地静态服务器

   为什么不直接用 python -m http.server：
     · 它不认 .wasm 的 MIME，WebP 编码器会因为
       「Incorrect response MIME type」被浏览器拒绝加载；
     · 它不认 .webmanifest，PWA 清单在 DevTools 里显示为纯文本；
     · 项目没有 package.json，也就没有 serve / vite 可用。

   服务的是仓库根 —— 因为根就是站点根，线上跑的就是这些文件本身。

   用法：
     node tools/dev-server.mjs            # 端口 8787
     node tools/dev-server.mjs -p 9000    # 指定端口
     bash tools/dev.sh                    # 等价，带端口占用自动顺延
   ============================================================ */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};

const argv = process.argv.slice(2);
let port = 8787;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '-p' || a === '--port') port = Number(argv[++i]);
  else if (/^\d+$/.test(a)) port = Number(a);
  else if (a === '-h' || a === '--help') {
    console.log('用法：node tools/dev-server.mjs [-p 端口]');
    process.exit(0);
  }
}
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('✗ 端口不合法：' + port);
  process.exit(1);
}

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
  } catch {
    res.writeHead(400).end('bad request');
    return;
  }

  let file = path.join(ROOT, urlPath);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end('forbidden'); return; }

  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');

  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
      .end('<h1>404</h1><p>' + urlPath.replace(/[<>&]/g, '') + ' 不存在</p>'
        + '<p>如果这是个新文件，确认它真的落盘了；如果是路径问题，检查有没有写绝对路径。</p>');
    return;
  }

  const ext = path.extname(file).toLowerCase();
  const stat = fs.statSync(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    /* 开发时一律不缓存：改完刷新就能看到，不会被 304 骗 */
    'Cache-Control': 'no-store, must-revalidate'
  });
  fs.createReadStream(file).pipe(res);
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error('✗ 端口 ' + port + ' 已被占用，换一个：node tools/dev-server.mjs -p ' + (port + 1));
  } else {
    console.error('✗ ' + e.message);
  }
  process.exit(1);
});

server.listen(port, '127.0.0.1', () => {
  console.log('生活工具箱 · 本地服务');
  console.log('  目录：' + ROOT);
  console.log('  地址：http://localhost:' + port + '/');
  console.log('  localhost 属于安全上下文，摄像头与 Service Worker 都能用；');
  console.log('  但局域网直传要真机互访，请改用手机浏览器打开你的内网 IP（或部署后的 HTTPS 地址）。');
  console.log('  Ctrl + C 停止');
});
