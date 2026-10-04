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
      '<div class="metric"><b>' + T.readyCount() + '</b><span>个可用工具</span></div>' +
      '<div class="metric"><b>' + db.history.length + '</b><span>图片转换记录</span></div>' +
      '<div class="metric"><b>' + (db.links || []).length + '</b><span>链接转换记录</span></div>' +
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
  /* 首页只列已上线的工具。
     规划中的内容不进首页 —— 列一堆点不动的条目只会让页面显得空。
     整组没有可用工具的分组也一并略过（由 T.readyTree() 负责）。 */
  function groupsHTML() {
    n = 0;
    var tree = T.readyTree();
    if (!tree.length) {
      return '<div class="empty">' + T.ic('wrench', '', 0) +
        '<b>还没有可用的工具</b><p>工具正在路上。</p></div>';
    }
    return tree.map(function (node) {
      var rows = node.tools.map(function (t) {
        n += 1;
        var tags = (t.tags || []).slice(0, 3).map(function (x) {
          return '<span class="tag">' + T.esc(x) + '</span>';
        }).join('');
        return '<a class="trow" href="' + T.routeOf(t.id) + '">' +
          '<span class="trow__n">' + (n < 10 ? '0' + n : n) + '</span>' +
          '<span class="trow__ic">' + T.ic(t.icon, '', 0) + '</span>' +
          '<span class="trow__tx">' +
            '<b>' + T.esc(t.name) + '</b>' +
            '<small>' + T.esc(t.desc || t.sub || '') + '</small>' +
            (tags ? '<span class="trow__tags">' + tags + '</span>' : '') +
          '</span>' +
          '<span class="trow__go">' + T.ic('chevron', '', 0) + '</span>' +
        '</a>';
      }).join('');

      return '<div class="glist">' +
        '<div class="ghead">' +
          '<h2>' + T.esc(node.group.name) + '</h2><i></i>' +
          /* 只写「N 项可用」：分组描述会把整个分组规划的范围都列出来，
             和这里只列已上线工具的口径对不上，反而让人以为有缺失 */
          '<em>' + node.tools.length + ' 项可用</em>' +
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
            '改过的设置会立刻存下来，关掉页面再打开还在。下面只列已经能用的。</p>' +
          statsHTML() +
        '</section>' +
        recentHTML() +
        '<div id="ovGroups">' + groupsHTML() + '</div>' +
        '<div class="pagefoot">' +
          T.APP_NAME + ' v' + T.APP_VER + ' · 构建于 ' + T.APP_BUILD + '<br>' +
          '零依赖静态工作台：样式与脚本均为本地独立文件，图标为内联 SVG sprite，不引用任何外部组件库。' +
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
