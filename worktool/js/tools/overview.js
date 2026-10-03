/* ============================================================
   tools/overview.js — 概览页
   刻意不用「卡片宫格」：靠悬挂序号 + 细分隔线 + 字距来组织信息，
   让页面更像一本工作手册的目录页，而不是一块功能面板。
   ============================================================ */
(function (T) {
  'use strict';

  function greeting() {
    var h = new Date().getHours();
    if (h < 6) return '夜深了';
    if (h < 9) return '早上好';
    if (h < 12) return '上午好';
    if (h < 14) return '中午好';
    if (h < 18) return '下午好';
    if (h < 23) return '晚上好';
    return '夜深了';
  }

  function statsHTML() {
    var db = T.Store.db;
    var saved = db.history.reduce(function (a, h) {
      return a + (h.srcBytes > h.outBytes ? (h.srcBytes - h.outBytes) : 0);
    }, 0);
    return '<div class="hero__stats">' +
      '<div class="metric"><b>' + T.readyCount() + '<span style="font-size:13px;color:var(--ink-4)"> / ' + T.totalCount() + '</span></b><span>工具已上线</span></div>' +
      '<div class="metric"><b>' + db.history.length + '</b><span>转换记录</span></div>' +
      '<div class="metric"><b>' + (saved > 0 ? T.fmtBytes(saved) : '—') + '</b><span>累计节省体积</span></div>' +
    '</div>';
  }

  function recentHTML() {
    var db = T.Store.db;
    var items = db.recent
      .map(function (r) { return T.findTool(r.tool) ? { tool: T.findTool(r.tool), at: r.at } : null; })
      .filter(Boolean)
      .slice(0, 6);
    if (!items.length) return '';
    return '<section class="recent">' +
      '<div class="recent__row">' +
        items.map(function (x) {
          return '<a class="recent__i" href="' + T.routeOf(x.tool.id) + '">' +
            T.ic(x.tool.icon, '', 0) +
            '<span>' + T.esc(x.tool.name) + '</span>' +
            '<em>' + T.relTime(x.at) + '</em>' +
          '</a>';
        }).join('') +
      '</div>' +
    '</section>';
  }

  var n = 0;
  function groupsHTML() {
    n = 0;
    return T.toolTree().map(function (node) {
      var rows = node.tools.map(function (t) {
        n += 1;
        var soon = t.status !== 'ready';
        var inner =
          '<span class="trow__n">' + (n < 10 ? '0' + n : n) + '</span>' +
          '<span class="trow__ic">' + T.ic(t.icon, '', 0) + '</span>' +
          '<span class="trow__tx">' +
            '<b>' + T.esc(t.name) +
              (soon ? '<span class="tag">规划中</span>' : '<span class="tag tag--accent">可用</span>') +
            '</b>' +
            '<small>' + T.esc(t.desc || t.sub || '') + '</small>' +
          '</span>' +
          '<span class="trow__go">' + T.ic('chevron', '', 0) + '</span>';

        return soon
          ? '<div class="trow is-soon" data-tool="' + T.esc(t.id) + '">' + inner + '</div>'
          : '<a class="trow" href="' + T.routeOf(t.id) + '">' + inner + '</a>';
      }).join('');

      return '<div class="glist">' +
        '<div class="ghead">' +
          '<h2>' + T.esc(node.group.name) + '</h2><i></i>' +
          '<em>' + node.tools.length + ' 项 · ' + T.esc(node.group.desc || '') + '</em>' +
        '</div>' + rows +
      '</div>';
    }).join('');
  }

  var _unsub = null;

  T.register('_overview', {
    render: function (host) {
      var now = new Date();
      host.innerHTML =
        '<section class="hero">' +
          '<div class="hero__date"><i></i><span>' + T.ymd(now) + ' · ' + T.weekCN(now) + '</span></div>' +
          '<h1>' + greeting() + '，这里是<em>你的工具箱</em></h1>' +
          '<p>' + '一些安静、够用的小工具。所有处理都在你自己的浏览器里完成，图片和文字不会被上传到任何地方；' +
            '改过的设置会立刻存下来，关掉页面再打开还在。</p>' +
          statsHTML() +
        '</section>' +
        recentHTML() +
        '<div id="ovGroups">' + groupsHTML() + '</div>' +
        '<div class="pagefoot">' +
          T.APP_NAME + ' v' + T.APP_VER + ' · 构建于 ' + T.APP_BUILD + '<br>' +
          '零依赖静态工作台：所有样式、脚本与图标均为本地独立文件，不引用任何外部组件库。' +
        '</div>';

      /* 数据变化时只重画统计与清单，不碰其它区域 */
      _unsub = T.Store.on(function () {
        var s = host.querySelector('.hero__stats');
        if (s) s.outerHTML = statsHTML();
        var g = host.querySelector('#ovGroups');
        if (g) g.innerHTML = groupsHTML();
      });
    },
    onLeave: function () {
      if (_unsub) { _unsub(); _unsub = null; }
    }
  });
})(window.Toolbox);
