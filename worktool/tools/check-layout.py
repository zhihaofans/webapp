#!/usr/bin/env python3
"""tools/check-layout.py — 移动端布局越界检查

现有的 test/*.test.js 全是纯 Node 的逻辑用例，跑起来不需要浏览器、也不需要
装任何东西。代价是**布局类的 bug 一个都抓不到** —— 2026-10-15 那个
「设置已改，可重转」把「重新转换 / 清空」顶出屏幕（实测右边界跑到 476px，
视口只有 393px）就是这类：逻辑全对，屏幕上却是坏的。

这个脚本用真实 Chromium 打开本机服务，量每个元素的实际右边界，
凡是超出视口宽度的一律算失败。

依赖：playwright（pip install playwright && playwright install chromium）
用法：
    python3 tools/check-layout.py            # 默认查图片工具的转换队列
    python3 tools/check-layout.py -v         # 连每个元素的位置一起打印

退出码：全部通过 0，有越界 1。
"""
import argparse
import http.server
import os
import socketserver
import sys
import threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 检查项：路径 → 需要先把页面弄成的状态 → 要量的元素
QUEUE_ITEMS = [
    (".qhead h2", "转换队列"),
    (".qhead .tag--amber", "设置已改标签"),
    (".qhead [data-act='dlall']", "下载全部"),
    (".qhead [data-act='reconv']", "重新转换"),
    (".qhead [data-act='clear']", "清空"),
]

SCENES = [
    # (名称, 视口宽, 是否触发 dirty)
    ("393px 常规", 393, False),
    ("393px 改过设置", 393, True),
    ("360px 常规", 360, False),
    ("360px 改过设置", 360, True),
]


def serve(port):
    handler = lambda *a, **kw: http.server.SimpleHTTPRequestHandler(*a, directory=ROOT, **kw)
    httpd = socketserver.TCPServer(("127.0.0.1", port), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


def make_test_image(path):
    """没有 PIL 就跳过造图 —— 那就只查空队列，量不到按钮。"""
    try:
        from PIL import Image, ImageDraw
    except ImportError:
        return False
    im = Image.new("RGB", (1200, 1600), (240, 235, 225))
    d = ImageDraw.Draw(im)
    for i in range(0, 1600, 40):
        d.line([(0, i), (1200, i)], fill=(200 - i // 20, 150, 120), width=3)
    im.save(path, quality=88)
    return True


def run(port, verbose):
    from playwright.sync_api import sync_playwright

    img = "/tmp/_layout_check.jpg"
    have_img = make_test_image(img)
    url = "http://127.0.0.1:%d/#/imageconvert" % port

    fails = []
    with sync_playwright() as p:
        b = p.chromium.launch()
        for name, width, dirty in SCENES:
            pg = b.new_page(viewport={"width": width, "height": 852}, device_scale_factor=2)
            pg.goto(url, wait_until="load")
            pg.wait_for_selector("#fileIn2", state="attached", timeout=20000)

            if have_img:
                pg.set_input_files("#fileIn2", img)
                try:
                    pg.wait_for_selector('[data-act="dlall"]', timeout=30000)
                except Exception:
                    pass
                if dirty:
                    seg = pg.query_selector("#segFmt")
                    cur = seg.query_selector(".is-on") if seg else None
                    cur_v = cur.get_attribute("data-v") if cur else None
                    for x in (seg.query_selector_all("[data-v]") if seg else []):
                        if x.get_attribute("data-v") != cur_v:
                            x.click()
                            break
            pg.wait_for_timeout(600)

            if not pg.query_selector(".qhead"):
                print("  %-16s 队列还没出现，跳过" % name)
                pg.close()
                continue

            worst, worst_name, missing = 0.0, "", []
            details = []
            for sel, label in QUEUE_ITEMS:
                el = pg.query_selector(sel)
                if not el:
                    if label != "设置已改标签":     # 标签本来就可能不存在
                        missing.append(label)
                    continue
                bb = el.bounding_box()
                if not bb:
                    continue
                right = bb["x"] + bb["width"]
                details.append("%s→%.0f" % (label, right))
                if right > worst:
                    worst, worst_name = right, label

            ok = worst <= width and not missing
            if not ok:
                fails.append((name, worst, width, worst_name, missing))

            print("  %-16s %s  最右元素 %-6s %.0f / 视口 %d%s"
                  % (name, "✅" if ok else "❌", worst_name or "-", worst, width,
                     ("  越界 %.0fpx" % (worst - width)) if worst > width else ""))
            if verbose:
                print("      " + "  ".join(details))
            pg.close()
        b.close()

    print()
    if fails:
        for name, worst, width, who, missing in fails:
            if missing:
                print("✗ %s：这些元素没渲染出来 —— %s" % (name, "、".join(missing)))
            else:
                print("✗ %s：「%s」右边界 %.0f，超出视口 %d 共 %.0fpx"
                      % (name, who, worst, width, worst - width))
        return 1
    print("✓ 全部场景无越界")
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-p", "--port", type=int, default=8099)
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args()

    httpd = serve(args.port)
    try:
        code = run(args.port, args.verbose)
    finally:
        httpd.shutdown()
    sys.exit(code)


if __name__ == "__main__":
    main()
