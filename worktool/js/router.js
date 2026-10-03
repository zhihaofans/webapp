/* ============================================================
   router.js — 路由
   唯一职责：根据 location.hash 决定「渲染哪个视图」，并通知外壳点亮导航。
   视图切换是单向的：hashchange → Router.render() → 工具 render() / Shell.setActive()。
   工具内部不允许反过来调用 Router。
   ============================================================ */
(function (T) {
  'use strict';
  var $ = T.$;

  var Router = {};
  var currentId = null;
  var currentImpl = null;

  function parseHash() {
    var h = location.hash || '';
    if (h.indexOf('#/') === 0) h = h.slice(2);
    else if (h === '#' || h === '') h = '';
    h = h.replace(/^\//, '').split('?')[0].trim();
    return h;
  }

  /* ---------- 「规划中」占位页：把路线图讲清楚，而不是给一个空壳 ---------- */
  function soonHTML(tool) {
    var plans = (tool.plan || []).map(function (p, i) {
      return '<li class="sitem">' +
        '<span class="sitem__n">' + (i + 1) + '</span>' +
        '<span class="sitem__t">' + T.esc(p) + '</span>' +
        '</li>';
    }).join('');
    return '<div class="viewwrap">' +
      '<div class="soon">' +
        '<div class="soon__mark">' + T.ic(tool.icon, '', 0) + '</div>' +
        '<h2>' + T.esc(tool.name) + '</h2>' +
        '<p>' + T.esc(tool.desc || '') + '</p>' +
        (plans ? '<div class="plans"><div class="plans__hd">计划包含</div><ul class="plist">' + plans + '</ul></div>' : '') +
        '<p class="note">这个工具还只在路线图上，尚未实现。当前版本先把框架和一个可用的工具打磨好 —— ' +
        '侧拉栏里的分组、路由与数据存储都已就位，后续每加一个工具只需注册一行。</p>' +
        '<div><a class="btn btn--primary" href="#/image2webp">' + T.ic('image', '', 0) + '先用「图片转 WebP」</a></div>' +
      '</div>' +
    '</div>';
  }

  /* ---------- 未知路由 ---------- */
  function notFoundHTML(id) {
    return '<div class="viewwrap">' +
      '<div class="soon">' +
        '<div class="soon__mark">' + T.ic('search', '', 0) + '</div>' +
        '<h2>没有这个工具</h2>' +
        '<p>地址里是「' + T.esc(id || '(空)') + '」，可能链接输错了，或者这个工具已被移除。</p>' +
        '<div><a class="btn" href="#/">' + T.ic('overview', '', 0) + '回到概览</a></div>' +
      '</div>' +
    '</div>';
  }

  Router.render = function () {
    var host = $('#view');
    if (!host) return;
    var id = parseHash();

    /* 离开上一个视图：让工具自己清理计时器 / Object URL */
    if (currentImpl && typeof currentImpl.onLeave === 'function') {
      try { currentImpl.onLeave(); } catch (e) { console.error(e); }
    }
    currentImpl = null;

    var tool = null, impl = null;

    if (!id || id === 'overview') {
      id = '_overview';
      impl = T.getImpl('_overview');
    } else {
      tool = T.findTool(id);
      impl = T.getImpl(id);
    }

    currentId = id;
    host.scrollTop = 0;
    window.scrollTo(0, 0);

    /* 顶栏与导航高亮 */
    T.Shell.setActive(tool ? tool.id : '', false);

    if (tool && tool.status !== 'ready' && !impl) {
      host.innerHTML = soonHTML(tool);
      return;
    }
    if (!impl) {
      host.innerHTML = notFoundHTML(id);
      return;
    }
    host.innerHTML = '';
    try {
      impl.render(host, tool);
    } catch (e) {
      console.error('[渲染失败] ' + id, e);
      host.innerHTML =
        '<div class="viewwrap"><div class="soon">' +
        '<div class="soon__mark">' + T.ic('warn', '', 0) + '</div>' +
        '<h2>这个工具没能打开</h2>' +
        '<p>页面渲染时出了点问题。刷新一次通常就能恢复；如果反复出现，说明代码里有需要修的地方。</p>' +
        '<p class="note">' + T.esc(e && e.message ? e.message : String(e)) + '</p>' +
        '</div></div>';
      return;
    }
    currentImpl = impl;

    /* 记录使用痕迹（供概览页「最近使用」） */
    if (tool) T.Store.touch(tool.id);

    /* 高亮同步（工具可能加载后才有内容），不触发额外渲染 */
    T.Shell.setActive(tool ? tool.id : '', true);
  };

  Router.start = function () {
    window.addEventListener('hashchange', Router.render);
    Router.render();
  };

  Router.current = function () { return currentId; };

  T.Router = Router;
})(window.Toolbox);
