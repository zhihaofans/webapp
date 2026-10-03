/* ============================================================
   shell.js — 外壳（侧拉栏 / 顶栏 / 手机抽屉）
   只负责「把导航画出来」和「把当前项点亮」，不参与路由跳转：
   点击导航只是改 location.hash，由 router.js 单向接管。
   ============================================================ */
(function (T) {
  'use strict';
  var $ = T.$, $$ = T.$$;

  var Shell = {};
  var activeId = '';

  /* ---------------- 导航列表（桌面侧栏 + 手机抽屉共用） ---------------- */
  function navHTML(mode) {
    var tree = T.toolTree();
    return tree.map(function (node) {
      var items = node.tools.map(function (t) {
        var soon = t.status !== 'ready';
        return '<a class="ritem' + (soon ? ' is-soon' : '') + '"' +
          ' href="' + T.routeOf(t.id) + '"' +
          ' data-tool="' + T.esc(t.id) + '"' +
          ' title="' + T.esc(t.name + (soon ? ' · 规划中' : '')) + '">' +
          T.ic(t.icon, '', 0) +
          '<span class="ritem__tx">' + T.esc(t.name) + '</span>' +
          (soon ? '<span class="ritem__soon">规划中</span>' : '') +
          '</a>';
      }).join('');
      return '<div class="rgroup">' +
        '<div class="rgroup__hd">' +
          '<b>' + T.esc(node.group.name) + '</b>' +
          '<i></i>' +
          '<em>' + node.tools.length + '</em>' +
        '</div>' +
        items +
        '</div>';
    }).join('');
  }

  Shell.renderNav = function () {
    var body = $('#railBody');
    if (body) body.innerHTML = navHTML('rail');
    var mbody = $('#mnavBody');
    if (mbody) mbody.innerHTML = navHTML('mnav');
    if (activeId) Shell.setActive(activeId, true);
  };

  /* ---------------- 当前项高亮 ---------------- */
  Shell.setActive = function (toolId, silent) {
    activeId = toolId || '';
    $$('[data-tool]').forEach(function (el) {
      el.classList.toggle('is-on', el.getAttribute('data-tool') === activeId);
    });

    var tool = T.findTool(activeId);
    var h1 = $('#ttl'), sub = $('#sub'), label = $('#menuLabel');
    if (h1) {
      h1.innerHTML = tool
        ? T.esc(tool.name) + (tool.status === 'ready' ? '' : ' <em>规划中</em>')
        : '概览';
    }
    if (sub) sub.textContent = tool ? (tool.sub || '') : ('共 ' + T.totalCount() + ' 个工具 · 已上线 ' + T.readyCount() + ' 个');
    if (label) label.textContent = tool ? tool.name : '概览';
    if (!silent) document.title = (tool ? tool.name : '概览') + ' · ' + T.APP_NAME;
    var mlabel = $('#mnavLabel');
    if (mlabel) mlabel.textContent = tool ? tool.name : '概览';
  };

  /* ---------------- 手机抽屉 ---------------- */
  function openMobile() {
    var nav = $('#mNav'), scrim = $('#mScrim');
    if (!nav) return;
    scrim.style.display = 'block';
    nav.style.display = 'flex';
    requestAnimationFrame(function () {
      scrim.classList.add('is-on');
      nav.classList.add('is-on');
    });
    document.body.classList.add('is-locked');
    var btn = $('#btnMenu');
    if (btn) btn.setAttribute('aria-expanded', 'true');
  }
  function closeMobile() {
    var nav = $('#mNav'), scrim = $('#mScrim');
    if (!nav || !nav.classList.contains('is-on')) return;
    scrim.classList.remove('is-on');
    nav.classList.remove('is-on');
    document.body.classList.remove('is-locked');
    var btn = $('#btnMenu');
    if (btn) btn.setAttribute('aria-expanded', 'false');
    setTimeout(function () {
      nav.style.display = '';
      scrim.style.display = '';
    }, 300);
  }
  Shell.openMobile = openMobile;
  Shell.closeMobile = closeMobile;

  /* ---------------- 侧栏收起 ---------------- */
  Shell.setMini = function (v, persist) {
    var app = $('#app');
    if (!app) return;
    app.classList.toggle('is-mini', !!v);
    var b = $('#btnMini');
    if (b) {
      b.setAttribute('title', v ? '展开侧拉栏' : '收起侧拉栏');
      b.setAttribute('aria-expanded', v ? 'false' : 'true');
      var tx = $('span', b);
      if (tx) tx.textContent = v ? '展开' : '收起';
    }
    if (persist) T.Store.patch({ mini: !!v });
  };

  /* ---------------- 顶部操作按钮 ---------------- */
  function actBtn(id, icon, label, title) {
    return '<button class="rbtn" type="button" id="' + id + '" title="' + T.esc(title || label) + '"' +
      ' aria-label="' + T.esc(title || label) + '">' + T.ic(icon, '', 0) + '<span>' + T.esc(label) + '</span></button>';
  }

  Shell.init = function () {
    Shell.renderNav();

    /* 侧栏底部工具区 */
    var foot = $('#railFoot');
    if (foot) {
      foot.innerHTML =
        '<button class="rbtn" type="button" data-theme-btn title="切换主题">' + T.ic('sun', '', 0) + '<span>浅色</span></button>' +
        actBtn('btnMini', 'sliders', '收起', '收起 / 展开侧拉栏') +
        actBtn('btnData', 'backup', '数据', '数据备份与设置');
    }
    /* 手机抽屉底部工具区 */
    var mfoot = $('#mnavFoot');
    if (mfoot) {
      mfoot.innerHTML =
        '<button class="rbtn" type="button" data-theme-btn title="切换主题">' + T.ic('sun', '', 0) + '<span>浅色</span></button>' +
        actBtn('btnDataM', 'backup', '数据', '数据备份与设置');
    }

    /* 交互绑定 */
    var btnMenu = $('#btnMenu');
    if (btnMenu) btnMenu.addEventListener('click', openMobile);
    var x = $('#mnavX');
    if (x) x.addEventListener('click', closeMobile);
    var scrim = $('#mScrim');
    if (scrim) scrim.addEventListener('click', closeMobile);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeMobile();
    });

    /* 抽屉内点导航 → 关抽屉（真正跳转交给 router） */
    var mbody = $('#mnavBody');
    if (mbody) {
      mbody.addEventListener('click', function (e) {
        if (e.target.closest('[data-tool]')) closeMobile();
      });
    }

    var mini = $('#btnMini');
    if (mini) mini.addEventListener('click', function () {
      Shell.setMini(!$('#app').classList.contains('is-mini'), true);
    });

    $$('[data-theme-btn]').forEach(function (b) {
      b.addEventListener('click', function () { T.Theme.cycle(); });
    });
    ['btnData', 'btnDataM'].forEach(function (id) {
      var b = document.getElementById(id);
      if (b) b.addEventListener('click', function () {
        closeMobile();
        if (T.Settings && T.Settings.open) T.Settings.open();
      });
    });

    Shell.setMini(T.Store.settings.mini, false);
    T.Theme.apply();
  };

  T.Shell = Shell;
})(window.Toolbox);
