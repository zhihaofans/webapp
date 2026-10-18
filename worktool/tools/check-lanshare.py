#!/usr/bin/env python3
"""tools/check-lanshare.py — 局域网直传的端到端检查

为什么单独一个工具：WebRTC 的连接、DataChannel、分块与背压这些，
在 Node 里没有可用实现，纯逻辑用例（test/lanshare.test.js）覆盖不到。
这里开真实浏览器页面当作两台设备，把三条路径各走一遍：

    ① 粘贴路径：发起 → 应答 → 连接 → 两端 SAS 一致 → 传文本 → 传文件（校验字节数）
    ② 扫码路径：发起方点「用摄像头扫」，读到对方屏幕上的码后自动连上
    ③ 无摄像头降级：没有 videoinput 时不显示扫码按钮，第二步改成「把对方的链接搬过来」

②③ 用 Chromium 的假摄像头 + 注入的假 BarcodeDetector 模拟，验的是**状态机与
界面判据**，不是解码能力（真解码只有真机能测）。

注意：所有页面在同一台机器上，走的是本机回环/私网候选 —— 这能验证协议、
状态机、分块与校验，但**不能替代真机跨设备测试**（比如路由器开了客户端
隔离时会不会连不上，只有真机才知道）。

依赖：playwright（pip install playwright && playwright install chromium）
用法：python3 tools/check-lanshare.py [-p 8110]
"""
import argparse
import os
import subprocess
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TEST_SIZE = 65536

# 假 BarcodeDetector：读到 window.__CODE 就返回，读不到就返回空（模拟取景中）
SCAN_STUB = """
window.__CODE = '';
window.BarcodeDetector = function () {
  this.detect = async function () { return window.__CODE ? [{ rawValue: window.__CODE }] : []; };
};
window.BarcodeDetector.getSupportedFormats = async function () { return ['qr_code']; };
"""

# 有摄像头、但没有 BarcodeDetector —— Windows/Linux Chrome 的真实处境
NO_NATIVE_STUB = """
window.__CODE = '';
(function () {
  try { delete window.BarcodeDetector; } catch (e) {}
  window.BarcodeDetector = undefined;
})();
"""

# 在上面基础上，把摄像头从设备列表里抹掉 —— 模拟有麦克风、没摄像头的台式机。
# 注意要保底塞一条 audioinput：设备列表为空时产品侧会按「拿不到列表，按有摄像头处理」
# 走保守分支，那样测不到无摄像头的降级路径。
NOCAM_STUB = SCAN_STUB + """
(function () {
  var md = navigator.mediaDevices;
  if (!md || !md.enumerateDevices) return;
  var orig = md.enumerateDevices.bind(md);
  md.enumerateDevices = function () {
    return orig().then(function (l) {
      var out = Array.prototype.filter.call(l, function (d) { return d.kind !== 'videoinput'; });
      if (!out.length) out = [{ kind: 'audioinput', deviceId: 'fake-mic', label: '', groupId: '' }];
      return out;
    });
  };
})();
"""


def wait_pair(page, timeout=25000):
    page.wait_for_function(
        "document.querySelector('#lsLink') && document.querySelector('#lsLink').value.length > 100",
        timeout=timeout)
    return page.input_value("#lsLink")


def start_host(page):
    page.wait_for_selector('[data-act="start"]', timeout=15000)
    page.click('[data-act="start"]')
    return wait_pair(page)


def check_paste(pw, port, test_file):
    """① 粘贴路径：完整传一条文本 + 一个文件"""
    ok = True
    b = pw.chromium.launch()
    try:
        ctx = b.new_context(viewport={"width": 393, "height": 852})
        A = ctx.new_page()
        A.goto("http://127.0.0.1:%d/#/lanshare" % port, wait_until="load")
        link_a = start_host(A)

        B = ctx.new_page()
        B.goto(link_a, wait_until="load")
        link_b = wait_pair(B)

        A.evaluate("document.querySelector('#lsManual').open = true")
        A.fill("#lsPaste", link_b)
        A.click('[data-act="applypaste"]')
        A.wait_for_selector(".ls__sas-num", timeout=30000)
        B.wait_for_selector(".ls__sas-num", timeout=30000)
        sas_a = A.inner_text(".ls__sas-num").strip()
        sas_b = B.inner_text(".ls__sas-num").strip()
        print("  连接: 已建立   安全码 %s / %s  %s" % (sas_a, sas_b, "✅" if sas_a == sas_b else "❌"))
        ok = ok and sas_a == sas_b

        A.fill("#lsText", "端到端检查 · hello")
        A.click('[data-act="sendtext"]')
        B.wait_for_selector(".ls__textbody", timeout=15000)
        got = B.inner_text(".ls__textbody")
        print("  文本: %-24r %s" % (got, "✅" if "端到端检查" in got else "❌"))
        ok = ok and "端到端检查" in got

        A.set_input_files("#lsFile", test_file)
        B.wait_for_selector(".ls__item a[download]", timeout=30000)
        href = B.get_attribute(".ls__item a[download]", "href")
        size = B.evaluate("""async (h) => {
            const r = await fetch(h); const blob = await r.blob(); return blob.size;
        }""", href)
        print("  文件: %d 字节（期望 %d）%s" % (size, TEST_SIZE, "✅" if size == TEST_SIZE else "❌"))
        ok = ok and size == TEST_SIZE
    finally:
        b.close()
    return ok


def check_scan(pw, port):
    """② 扫码路径：发起方用摄像头读对方的码，读到即连"""
    ok = True
    b = pw.chromium.launch(args=["--use-fake-ui-for-media-stream",
                                 "--use-fake-device-for-media-stream"])
    try:
        ctx = b.new_context(viewport={"width": 1280, "height": 900}, permissions=["camera"])
        ctx.add_init_script(SCAN_STUB)
        A = ctx.new_page()
        A.goto("http://127.0.0.1:%d/#/lanshare" % port, wait_until="load")
        link_a = start_host(A)

        # 发起方：第一步高亮，且明确写着还要做第二步
        step1 = A.eval_on_selector_all(
            ".ls__step", "e => e.map(x => x.className.indexOf('is-on') >= 0)")
        head = A.inner_text(".ls__pair-hd h3")
        print("  发起方首屏: 步骤①高亮=%s 标题=%s  %s"
              % (step1[0], head, "✅" if step1 == [True, False] else "❌"))
        ok = ok and step1 == [True, False]
        ok = ok and "第一步" in head

        B = ctx.new_page()
        B.goto(link_a, wait_until="load")
        link_b = wait_pair(B)
        b_step = B.eval_on_selector_all(
            ".ls__step", "e => e.map(x => x.className.indexOf('is-on') >= 0)")
        b_head = B.inner_text(".ls__pair-hd h3")
        print("  加入方首屏: 步骤②高亮=%s 标题=%s  %s"
              % (b_step[1], b_head, "✅" if b_step == [False, True] else "❌"))
        ok = ok and b_step == [False, True]
        ok = ok and "第二步" in b_head

        # 发起方点扫码 —— 扫描中标题要换、二维码让位给取景
        A.evaluate("v => { window.__CODE = ''; }", None)
        A.click('[data-act="scan"]')
        A.wait_for_selector("#lsVideo", timeout=8000)
        scan_head = A.inner_text(".ls__pair-hd h3")
        qr_gone = A.evaluate("!document.querySelector('#lsQR')")
        print("  扫描中: 标题=%s 取景已开=True 二维码让位=%s  %s"
              % (scan_head, qr_gone, "✅" if ("正在读" in scan_head and qr_gone) else "❌"))
        ok = ok and "正在读" in scan_head and qr_gone

        # 假装摄像头读到了对方屏幕上的码
        A.evaluate("v => { window.__CODE = v; }", link_b)
        A.wait_for_selector(".ls__sas-num", timeout=30000)
        B.wait_for_selector(".ls__sas-num", timeout=30000)
        sas_a = A.inner_text(".ls__sas-num").strip()
        sas_b = B.inner_text(".ls__sas-num").strip()
        print("  扫码连接: 安全码 %s / %s  %s" % (sas_a, sas_b, "✅" if sas_a == sas_b else "❌"))
        ok = ok and sas_a == sas_b
    finally:
        b.close()
    return ok


def check_native_missing(pw, port):
    """③ 没有 BarcodeDetector、但有摄像头 —— Windows/Linux 的 Chrome 就是这样。

    这是用户实测报上来的场景：电脑明明有摄像头，界面却说「扫不了码」。
    现在靠自研解码器兜底，必须仍然给出「用摄像头扫」。
    """
    ok = True
    b = pw.chromium.launch(args=["--use-fake-ui-for-media-stream",
                                 "--use-fake-device-for-media-stream"])
    try:
        ctx = b.new_context(viewport={"width": 1280, "height": 900}, permissions=["camera"])
        ctx.add_init_script(NO_NATIVE_STUB)
        A = ctx.new_page()
        A.goto("http://127.0.0.1:%d/#/lanshare" % port, wait_until="load")
        start_host(A)
        A.wait_for_timeout(1000)

        native = A.evaluate("typeof window.BarcodeDetector")
        dec = A.evaluate("!!(window.Toolbox && window.Toolbox.QRDec && window.Toolbox.QRDec.ready)")
        acts = A.eval_on_selector_all(
            "[data-act]", "e => e.filter(x => x.offsetParent).map(x => x.getAttribute('data-act'))")
        head = A.inner_text(".ls__recv-hd b")
        print("  BarcodeDetector=%s 自研解码器就绪=%s" % (native, dec))
        print("  动作: %s" % acts)
        print("  第二步标题: %s" % head)
        good = (native == "undefined") and dec and ("scan" in acts) and ("读对方的屏幕" in head)
        print("  %s" % ("✅ 没有原生 API 也能扫码" if good else "❌ 仍然判成扫不了"))
        ok = ok and good
    finally:
        b.close()
    return ok


def check_nocam(pw, port):
    """④ 真没有摄像头：不显示扫码按钮，第二步改成搬链接"""
    ok = True
    b = pw.chromium.launch()
    try:
        ctx = b.new_context(viewport={"width": 1280, "height": 900})
        ctx.add_init_script(NOCAM_STUB)
        A = ctx.new_page()
        A.goto("http://127.0.0.1:%d/#/lanshare" % port, wait_until="load")
        start_host(A)
        A.wait_for_timeout(1000)

        acts = A.eval_on_selector_all(
            "[data-act]", "e => e.filter(x => x.offsetParent).map(x => x.getAttribute('data-act'))")
        head = A.inner_text(".ls__recv-hd b")
        has_scan = "scan" in acts
        has_paste = "clippaste" in acts or "applypaste" in acts
        print("  动作: %s" % acts)
        print("  第二步标题: %s  %s" % (head, "✅" if "搬过来" in head else "❌"))
        print("  扫码按钮已隐藏=%s 仍有粘贴入口=%s  %s"
              % (not has_scan, has_paste, "✅" if (not has_scan and has_paste) else "❌"))
        ok = ok and "搬过来" in head and (not has_scan) and has_paste
    finally:
        b.close()
    return ok


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("-p", "--port", type=int, default=8110)
    ap.add_argument("--keep", action="store_true", help="失败时保留截图")
    args = ap.parse_args()

    from playwright.sync_api import sync_playwright

    tmp = tempfile.mkdtemp(prefix="lanshare-")
    test_file = os.path.join(tmp, "check.bin")
    with open(test_file, "wb") as f:
        f.write(os.urandom(TEST_SIZE))

    srv = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(args.port), "--bind", "127.0.0.1", "--directory", ROOT],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1.2)

    ok = True
    try:
        with sync_playwright() as pw:
            for name, fn in (("① 粘贴路径", lambda: check_paste(pw, args.port, test_file)),
                             ("② 扫码路径（原生 BarcodeDetector）", lambda: check_scan(pw, args.port)),
                             ("③ 无原生 API、有摄像头（自研解码兜底）",
                              lambda: check_native_missing(pw, args.port)),
                             ("④ 真无摄像头", lambda: check_nocam(pw, args.port))):
                print("\n%s" % name)
                try:
                    if not fn():
                        ok = False
                except Exception as e:
                    ok = False
                    print("  ✗ 中途失败：%s" % e)
    finally:
        srv.terminate()

    print()
    print("结果: " + ("全部通过 ✅" if ok else "有失败 ❌"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
