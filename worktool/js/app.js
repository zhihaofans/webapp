/* ============================================================
   app.js — 启动
   固定顺序：主题 → 外壳 → 路由 → 兜底落盘。
   这里只做「按顺序调用」，不写业务逻辑，方便一眼看清启动链路。
   ============================================================ */
(function (T) {
  'use strict';

  function boot() {
    /* 1. 先把数据读进来（localStorage → 内存），没有就用空库；
          这一步必须在任何渲染之前，否则会拿着空库去渲染 */
    T.loadStore();

    /* 2. 主题落地，避免首帧闪错色 */
    T.Theme.apply();

    /* 3. 外壳：侧拉栏 / 顶栏 / 手机抽屉 */
    T.Shell.init();

    /* 4. 隐藏的文件输入（数据导入）在这里只绑一次 */
    T.Settings.bindFileInput();

    /* 5. 路由：渲染当前 hash 对应的视图 */
    T.Router.start();

    /* 6. 兜底落盘：防抖窗口内用户关了页面也不会丢改动 */
    function flush() { try { T.Store.flush(); } catch (e) { /* 忽略 */ } }
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') flush();
    });

    console.log('[生活工具箱] v' + T.APP_VER + ' 已启动');
  }

  window.__TOOLBOX_BOOT__ = boot;
})(window.Toolbox);
