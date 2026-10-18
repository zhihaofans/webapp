#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成 iOS 启动图与 apple-touch-icon —— 一条命令出全套。

为什么需要这个脚本
------------------
iOS 的启动图（apple-touch-startup-image）是「一台设备一张图」，靠 CSS media
query 精确匹配。手工做几乎必然漏机型，而**漏掉的那台机器启动时就是纯白屏**——
应用是米色底，白屏一闪特别刺眼。

这里按官方文档的匹配规则生成六组：
    device-width / device-height 用 **CSS 像素**（如 390×844）
    -webkit-device-pixel-ratio 是 DPR（2 或 3）
    图片本身用 **物理像素**（如 1170×2532）

用法
----
    python3 tools/gen-pwa-assets.py

只在图标源文件变动后才需要重跑；产出的 png 应当提交进仓库。
"""
import os
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_ICON = os.path.join(ROOT, 'icon-512.png')            # 透明圆角图标，用于启动图
SRC_MASK = os.path.join(ROOT, 'icon-maskable-512.png')   # 满底图标，用于 iOS 主屏
OUT_DIR = os.path.join(ROOT, 'splash')

# 背景色与 index.html / boot-loader 的浅色底一致（#f6f3ee）。
# 为什么不按深色模式出两套：apple-touch-startup-image 的 media 只可靠匹配尺寸，
# 再叠 prefers-color-scheme 会让条目翻倍且兼容性不稳。选浅色是因为它与
# 应用默认底色连续，深色用户最多闪一下米色，不会出现刺眼白屏。
BG = (246, 243, 238)

# (文件名标识, CSS 宽, CSS 高, DPR)
DEVICES = [
    ('iphone-se',        375, 667, 2),
    ('iphone-x',         375, 812, 3),
    ('iphone-13',        390, 844, 3),
    ('iphone-15pro',     393, 852, 3),
    ('iphone-15promax',  430, 932, 3),
    ('ipad',             768, 1024, 2),
]


def build_splash(logo, w, h, path):
    """把图标居中放在纯色底上。logo 边长取短边的 22% —— 再大就像广告页了。"""
    canvas = Image.new('RGB', (w, h), BG)
    side = int(min(w, h) * 0.22)
    ic = logo.resize((side, side), Image.LANCZOS)
    canvas.paste(ic, ((w - side) // 2, (h - side) // 2), ic)
    canvas.save(path, 'PNG', optimize=True)
    return side


def main():
    if not os.path.exists(SRC_ICON):
        raise SystemExit('找不到 icon-512.png')
    os.makedirs(OUT_DIR, exist_ok=True)
    logo = Image.open(SRC_ICON).convert('RGBA')

    print('启动图：')
    for name, cw, ch, dpr in DEVICES:
        w, h = cw * dpr, ch * dpr
        fn = 'splash-%s-%dx%d.png' % (name, w, h)
        side = build_splash(logo, w, h, os.path.join(OUT_DIR, fn))
        print('  %-34s %4dx%-4d  logo %dpx' % (fn, w, h, side))

    # iOS 主屏图标：必须 180×180 且**不透明**（透明会被 iOS 填成黑底）。
    # 用 maskable 版本（满底、图案内缩），缩到 180 时不会被裁掉。
    if os.path.exists(SRC_MASK):
        ic = Image.open(SRC_MASK).convert('RGB').resize((180, 180), Image.LANCZOS)
        ic.save(os.path.join(ROOT, 'icon-180.png'), 'PNG', optimize=True)
        print('\n主屏图标：icon-180.png  180x180  RGB（不透明）')


if __name__ == '__main__':
    main()
