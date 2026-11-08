#!/usr/bin/env python3
"""tools/check-layout.py — 移动端布局越界检查

现有的 test/*.test.js 全是纯 Node 的逻辑用例，跑起来不需要浏览器、也不需要
装任何东西。代价是**布局类的 bug 一个都抓不到** —— 2026-10-15 那个
「设置已改，可重转」把「重新转换 / 清空」顶出屏幕（实测右边界跑到 476px，
视口只有 393px）就是这类：逻辑全对，屏幕上却是坏的。

这个脚本用真实 Chromium 打开本机服务，量每个元素的实际右边界，
凡是超出视口宽度的一律算失败。

两类场景都查：

1. **手机 393 / 360** —— 图片转换队列的按钮会不会被顶出屏幕；
2. **桌面 1280** —— 侧拉栏两处：底部工具按钮（主题 / 数据）会不会被挤到
   文字省略，以及品牌区那一行（logo + 两行标题 + 右端的收起按钮）会不会
   把副标题裁掉。248px 时代底栏实测溢出 25px，「数据」被裁掉大半；这类
   问题手机场景查不出来（那时侧栏是隐藏的），必须单独量桌面。

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

# 桌面侧栏检查：视口宽固定 1280（>900 才会显示 .rail），三种主题各量一遍 ——
# 「浅色·自动」是最长的一种文案，切换后还应变短。
DESKTOP_VIEWPORT = {"width": 1280, "height": 800}

SCENES = [
    # (名称, 视口宽, 是否触发 dirty)
    ("393px 常规", 393, False),
    ("393px 改过设置", 393, True),
    ("360px 常规", 360, False),
    ("360px 改过设置", 360, True),
]


class _Reusable(socketserver.TCPServer):
    # 上一次跑完留下的 TIME_WAIT 会让紧接着的第二次运行报 EADDRINUSE
    allow_reuse_address = True


def serve(port):
    handler = lambda *a, **kw: http.server.SimpleHTTPRequestHandler(*a, directory=ROOT, **kw)
    httpd = _Reusable(("127.0.0.1", port), handler)
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

        # ---- 桌面侧栏底部工具区 ----
        dpg = b.new_page(viewport=DESKTOP_VIEWPORT)
        dpg.goto("http://127.0.0.1:%d/" % port, wait_until="load")
        dpg.wait_for_selector(".rail__foot .rbtn", timeout=20000)
        dpg.wait_for_timeout(400)

        for round_no in range(3):
            m = dpg.evaluate("""() => {
              const foot = document.querySelector('.rail__foot');
              const cs = getComputedStyle(foot);
              const fr = foot.getBoundingClientRect();
              const lim = fr.right - parseFloat(cs.paddingRight);
              const items = [...foot.querySelectorAll('.rbtn')].map(b => {
                const r = b.getBoundingClientRect();
                const s = b.querySelector('span');
                return {
                  t: b.innerText.trim() || '(图标)',
                  right: r.right,
                  ell: s ? s.scrollWidth > s.clientWidth + 1 : false
                };
              });
              // 品牌区（logo + 标题 + 收起按钮）：宽 260 时副标题最容易先被裁
              const brand = document.querySelector('.rail__brand');
              const fold = document.querySelector('.rail__fold');
              const sub = document.querySelector('.rail__title span');
              const br = brand.getBoundingClientRect();
              const bf = fold ? fold.getBoundingClientRect() : null;
              const brandInfo = {
                lim: br.right,
                foldRight: bf ? bf.right : null,
                foldW: bf ? bf.width : 0,
                foldH: bf ? bf.height : 0,
                subEll: sub ? sub.scrollWidth > sub.clientWidth + 1 : false,
                foldInBrand: fold ? brand.contains(fold) : false
              };
              return {lim, items, footBottom: fr.bottom, vh: innerHeight, brand: brandInfo};
            }""")

            over = [x for x in m["items"] if x["right"] > m["lim"] + 0.5]
            ell = [x for x in m["items"] if x["ell"]]
            tall = m["footBottom"] > m["vh"] + 0.5

            # 品牌区：收起按钮必须在标题行内、不越界、可点；副标题不许被裁
            bd = m["brand"]
            bOver = bd["foldRight"] is not None and bd["foldRight"] > bd["lim"] - 1
            bSmall = bd["foldW"] < 28 or bd["foldH"] < 28
            bMiss = not bd["foldInBrand"]
            ok = not over and not ell and not tall and not bOver and not bd["subEll"] and not bSmall and not bMiss

            theme = m["items"][0]["t"] if m["items"] else "?"
            why = ""
            if over:
                why = "底栏「%s」溢出 %.0fpx" % (over[0]["t"], over[0]["right"] - m["lim"])
            elif ell:
                why = "底栏「%s」文字被省略" % ell[0]["t"]
            elif tall:
                why = "底栏超出视口"
            elif bMiss:
                why = "收起按钮不在品牌区内"
            elif bOver:
                why = "收起按钮贴到侧栏边缘（右 %.0f / 界 %.0f）" % (bd["foldRight"], bd["lim"])
            elif bSmall:
                why = "收起按钮 %.0fx%.0f 小于 28px" % (bd["foldW"], bd["foldH"])
            elif bd["subEll"]:
                why = "品牌区副标题被裁"
            if why:
                fails.append(("桌面侧栏（%s）" % theme, 0, 0, why, []))

            print("  %-16s %s  %s  内边界 %.0f / 视口 %d%s"
                  % ("桌面 1280 第%d次" % (round_no + 1), "✅" if ok else "❌", theme,
                     m["lim"], DESKTOP_VIEWPORT["width"],
                     ("  " + why) if why else ""))
            if verbose and m["items"]:
                print("      " + "  ".join("%s→%.0f" % (x["t"], x["right"]) for x in m["items"])
                      + "  | 收起 %.0fx%.0f 右 %.0f" % (bd["foldW"], bd["foldH"], bd["foldRight"] or 0))

            dpg.click("[data-theme-btn]")
            dpg.wait_for_timeout(450)
        dpg.close()
        b.close()

    print()
    if fails:
        for name, worst, width, who, missing in fails:
            if missing:
                print("✗ %s：这些元素没渲染出来 —— %s" % (name, "、".join(missing)))
            elif width:
                print("✗ %s：「%s」右边界 %.0f，超出视口 %d 共 %.0fpx"
                      % (name, who, worst, width, worst - width))
            else:
                print("✗ %s：%s" % (name, who))
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
