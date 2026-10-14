#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
生成 iOS 启动图（apple-touch-startup-image）。

iOS 不会从 manifest 的 background_color 自动生成启动图 —— 必须为每个
设备尺寸显式声明一张 PNG，media 查询里要同时匹配「设计尺寸 + 倍率」，
少一个条件 Safari 就当作不匹配、退回到白屏。

这里生成浅色与深色两套（深色套的 media 里多一个 prefers-color-scheme），
Safari 取「第一个匹配」的那张；深色查询不被识别时自然落到浅色套，
所以两套同时存在是安全的。

产物放在 splash/ 下，命名 splash-{宽}x{高}.png。
"""
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'splash')
ICON = Image.open(os.path.join(ROOT, 'icon-512.png')).convert('RGBA')

BG_LIGHT = (244, 241, 234)   # 与 manifest.background_color 一致
BG_DARK = (26, 25, 23)       # 与深色模式的 --bg 一致

# (像素宽, 像素高, CSS 宽, CSS 高, 倍率)
SIZES = [
    (750,  1334, 375,  667,  2),   # iPhone SE2/3、8
    (1125, 2436, 375,  812,  3),   # iPhone X / XS / 11 Pro
    (828,  1792, 414,  896,  2),   # iPhone XR / 11
    (1242, 2688, 414,  896,  3),   # iPhone XS Max / 11 Pro Max
    (1080, 2340, 360,  780,  3),   # iPhone 12/13 mini
    (1170, 2532, 390,  844,  3),   # iPhone 12 / 13 / 14
    (1179, 2556, 393,  852,  3),   # iPhone 14 Pro / 15 / 16
    (1284, 2778, 428,  926,  3),   # iPhone 12/13 Pro Max / 14 Plus
    (1206, 2622, 402,  874,  3),   # iPhone 16 Pro
    (1290, 2796, 430,  932,  3),   # iPhone 14 Pro Max / 15 Plus / 15 Pro Max
    (1320, 2868, 440,  956,  3),   # iPhone 16 Pro Max
    (1536, 2048, 768,  1024, 2),   # iPad 9.7 / mini
    (1620, 2160, 810,  1080, 2),   # iPad 10.2
    (1668, 2388, 834,  1194, 2),   # iPad Pro 11 / Air
    (2048, 2732, 1024, 1366, 2),   # iPad Pro 12.9
]

os.makedirs(OUT, exist_ok=True)

def make(bg, w, h, path):
    canvas = Image.new('RGB', (w, h), bg)
    side = int(min(w, h) * 0.28)
    ic = ICON.resize((side, side), Image.LANCZOS)
    canvas.paste(ic, ((w - side) // 2, (h - side) // 2), ic)
    # 纯色底 + 单张小图，降到调色板后体积能掉一个量级，肉眼无差
    canvas.convert('P', palette=Image.ADAPTIVE, colors=128).save(path, optimize=True)

total = 0
for (pw, ph, cw, ch, dpr) in SIZES:
    for tag, bg in (('light', BG_LIGHT), ('dark', BG_DARK)):
        p = os.path.join(OUT, 'splash-%s-%dx%d.png' % (tag, pw, ph))
        make(bg, pw, ph, p)
        total += os.path.getsize(p)

files = sorted(os.listdir(OUT))
print('生成 %d 张，合计 %.0f KB，平均 %.1f KB' % (
    len(files), total / 1024, total / 1024 / len(files)))
print('目录体积 %.0f KB' % (sum(os.path.getsize(os.path.join(OUT, f)) for f in files) / 1024))
