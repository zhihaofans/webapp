/* ============================================================
   settings.js — 数据与设置抽屉
   外观偏好、数据备份 / 恢复 / 清空、关于信息。
   所有偏好项都是「改了立刻写 localStorage」，没有「保存」按钮。
   ============================================================ */
(function (T) {
  'use strict';
  var $ = T.$, $$ = T.$$;

  var Settings = {};

  /* 版本号比较：'1.10.0' > '1.9.2'（逐段数值比较，不是字符串比较） */
  function cmpVer(a, b) {
    var x = String(a).split('.'), y = String(b).split('.');
    for (var i = 0; i < Math.max(x.length, y.length); i++) {
      var m = parseInt(x[i] || '0', 10) || 0;
      var n = parseInt(y[i] || '0', 10) || 0;
      if (m !== n) return m > n ? 1 : -1;
    }
    return 0;
  }

  function byteSizeOfDB() {
    try {
      return new Blob([JSON.stringify(T.Store.db)]).size;
    } catch (e) {
      return (JSON.stringify(T.Store.db) || '').length;
    }
  }

  function themeSeg() {
    var cur = T.Store.settings.theme;
    var opts = [['auto', '跟随系统'], ['light', '浅色'], ['dark', '深色']];
    return '<div class="seg" id="segTheme">' + opts.map(function (o) {
      return '<button class="seg__b' + (cur === o[0] ? ' is-on' : '') + '" type="button" data-v="' + o[0] + '">' +
        T.esc(o[1]) + '</button>';
    }).join('') + '</div>';
  }

  function bodyHTML() {
    var s = T.Store.settings;
    var db = T.Store.db;
    var bytes = byteSizeOfDB();
    var conv = db.history.length;
    var links = (db.links || []).length;
    var saved = db.history.reduce(function (a, h) {
      return a + (h.srcBytes > h.outBytes ? (h.srcBytes - h.outBytes) : 0);
    }, 0);

    return '' +
      '<div class="sect" style="margin-top:0"><h2>外观</h2><i class="hr"></i></div>' +
      '<div class="srow">' +
        '<div class="srow__t"><b>主题</b><small>跟随系统时会随系统深浅色自动切换</small></div>' +
        '<div class="srow__c">' + themeSeg() + '</div>' +
      '</div>' +
      '<div class="srow">' +
        '<div class="srow__t"><b>默认收起侧拉栏</b><small>收起后只留图标，给内容让出宽度；桌面端生效</small></div>' +
        '<div class="srow__c">' +
          '<label class="sw"><input type="checkbox" id="swMini"' + (s.mini ? ' checked' : '') + '>' +
          '<span class="sw__track"></span></label>' +
        '</div>' +
      '</div>' +

      '<div class="sect"><h2>数据</h2><i class="hr"></i></div>' +
      '<div class="panel panel--flat" style="margin-bottom:14px">' +
        '<div class="panel__bd" style="display:flex;gap:22px;flex-wrap:wrap">' +
          '<div class="metric"><b>' + conv + '</b><span>图片记录</span></div>' +
          '<div class="metric"><b>' + links + '</b><span>链接记录</span></div>' +
          '<div class="metric"><b>' + T.fmtBytes(saved) + '</b><span>累计节省</span></div>' +
          '<div class="metric"><b>' + T.fmtBytes(bytes) + '</b><span>本地占用</span></div>' +
        '</div>' +
      '</div>' +
      '<p class="note" style="margin-bottom:14px">' +
        '数据存在这台设备的浏览器里（localStorage），不会上传到任何服务器。' +
        '换设备或清理浏览器数据前，请先导出备份。' +
      '</p>' +
      '<div class="linklist">' +
        '<a href="javascript:void(0)" id="btnExport">' + T.ic('backup', '', 0) +
          '<span>导出 JSON 备份</span><em>含设置与记录</em></a>' +
        '<a href="javascript:void(0)" id="btnImport">' + T.ic('restore', '', 0) +
          '<span>导入 JSON 备份</span><em>可选合并或覆盖</em></a>' +
        '<a href="javascript:void(0)" id="btnClearHist">' + T.ic('trash', '', 0) +
          '<span>清空图片记录</span><em>' + conv + ' 条</em></a>' +
        '<a href="javascript:void(0)" id="btnClearLinks">' + T.ic('trash', '', 0) +
          '<span>清空链接记录</span><em>' + links + ' 条</em></a>' +
        '<a href="javascript:void(0)" id="btnReset" style="color:var(--danger)">' + T.ic('warn', '', 0) +
          '<span>清空全部数据</span><em>设置与记录</em></a>' +
      '</div>' +

      '<div class="sect"><h2>关于</h2><i class="hr"></i></div>' +
      '<div class="linklist" style="margin-bottom:12px">' +
        '<a href="javascript:void(0)" style="cursor:default">' + T.ic('info', '', 0) +
          '<span>版本</span><em>' + T.esc(T.APP_VER) + '</em></a>' +
        '<a href="javascript:void(0)" style="cursor:default">' + T.ic('clock', '', 0) +
          '<span>构建日期</span><em>' + T.esc(T.APP_BUILD) + '</em></a>' +
        '<a href="javascript:void(0)" style="cursor:default">' + T.ic('grid', '', 0) +
          '<span>工具</span><em>已上线 ' + T.readyCount() + ' / ' + T.totalCount() + '</em></a>' +
        '<a href="javascript:void(0)" id="btnUpdate">' + T.ic('spark', '', 0) +
          '<span>检查更新</span><em id="updState">点击检测</em></a>' +
      '</div>' +
      '<p class="note">' +
        '零依赖、零后端的纯静态工作台：所有样式、脚本与图标都是本目录下的独立文件，' +
        '图片转换在你自己的浏览器里完成，不经过任何服务器。' +
      '</p>';
  }

  function bind(d) {
    /* 主题分段 */
    var seg = d.body.querySelector('#segTheme');
    if (seg) {
      seg.addEventListener('click', function (e) {
        var b = e.target.closest('[data-v]');
        if (!b) return;
        var v = b.getAttribute('data-v');
        T.Theme.set(v);
        $$('.seg__b', seg).forEach(function (x) { x.classList.toggle('is-on', x === b); });
      });
    }
    /* 侧拉栏收起 */
    var swMini = d.body.querySelector('#swMini');
    if (swMini) {
      swMini.addEventListener('change', function () {
        T.Shell.setMini(swMini.checked, true);
      });
    }

    /* 导出 */
    d.body.querySelector('#btnExport').addEventListener('click', function () {
      var name = '生活工具箱-备份-' + T.ymd() + '.json';
      T.downloadText(T.Store.exportJSON(), name);
      T.toast('已导出备份文件', { icon: 'check' });
    });

    /* 导入 */
    var fileIn = $('#fileIn');
    d.body.querySelector('#btnImport').addEventListener('click', function () { fileIn.click(); });

    /* 检查更新：比对同源 version.json（no-store 强拉真值，避免拿到缓存里的旧版本号） */
    var btnUpd = d.body.querySelector('#btnUpdate');
    if (btnUpd) {
      btnUpd.addEventListener('click', function () {
        var em = d.body.querySelector('#updState');
        em.textContent = '检测中…';
        fetch('version.json?_=' + Date.now(), { cache: 'no-store' }).then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.json();
        }).then(function (j) {
          var remote = String((j && j.ver) || '');
          if (remote && cmpVer(remote, T.APP_VER) > 0) {
            em.textContent = '有新版本 v' + remote;
            T.toast('发现新版本 v' + remote + '（当前 v' + T.APP_VER + '）', {
              icon: 'spark', ms: 9000,
              action: {
                label: '立即更新',
                fn: function () {
                  if (typeof window.__TOOLBOX_FORCE_UPDATE__ === 'function') window.__TOOLBOX_FORCE_UPDATE__();
                  else location.reload();
                }
              }
            });
          } else {
            em.textContent = '已是最新';
            T.toast('已是最新版本 v' + T.APP_VER, { icon: 'check' });
          }
        }).catch(function () {
          em.textContent = '无法检测';
          T.toast('暂时无法检测更新（本地打开或当前离线）', { icon: 'warn', ms: 4200 });
        });
      });
    }

    /* 清空记录 */
    d.body.querySelector('#btnClearHist').addEventListener('click', function () {
      if (!T.Store.db.history.length) { T.toast('还没有转换记录'); return; }
      T.confirm({
        title: '清空转换记录',
        text: '将删除本机保存的全部转换记录（共 ' + T.Store.db.history.length + ' 条）。',
        hint: '已下载的 WebP 文件不受影响，设置项也会保留。',
        ok: '清空记录', danger: true
      }).then(function (yes) {
        if (!yes) return;
        T.Store.clearHistory();
        d.close();
        T.toast('转换记录已清空', { icon: 'check' });
      });
    });

    /* 清空链接记录 */
    d.body.querySelector('#btnClearLinks').addEventListener('click', function () {
      if (!(T.Store.db.links || []).length) { T.toast('还没有链接记录'); return; }
      T.confirm({
        title: '清空链接记录',
        text: '将删除本机保存的全部链接转换记录（共 ' + T.Store.db.links.length + ' 条）。',
        hint: '输入框里的当前内容不受影响，设置项也会保留。',
        ok: '清空记录', danger: true
      }).then(function (yes) {
        if (!yes) return;
        T.Store.clearLinks();
        d.close();
        T.toast('链接记录已清空', { icon: 'check' });
      });
    });

    /* 清空全部 */
    d.body.querySelector('#btnReset').addEventListener('click', function () {
      T.confirm({
        title: '清空全部数据',
        text: '设置项、图片与链接记录、草稿和最近使用痕迹都会被清除，且无法撤销。',
        hint: '建议先导出一次备份。',
        ok: '全部清空', danger: true
      }).then(function (yes) {
        if (!yes) return;
        T.Store.reset();
        T.Shell.setMini(false, false);
        T.Theme.apply();
        d.close();
        T.toast('已恢复到初始状态', { icon: 'check' });
        T.Router.render();
      });
    });
  }

  /* 文件导入：由 shell / 全局只绑一次 */
  Settings.bindFileInput = function () {
    var fileIn = $('#fileIn');
    if (!fileIn || fileIn._bound) return;
    fileIn._bound = true;
    fileIn.addEventListener('change', function () {
      var f = fileIn.files && fileIn.files[0];
      fileIn.value = '';
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        T.confirm({
          title: '导入备份',
          text: '文件里有 ' + f.name + '。选择「合并」会保留本地设置、把记录去重后追加；「覆盖」会完全替换本地数据。',
          ok: '合并导入'
        }).then(function (merge) {
          try {
            var r = T.Store.importJSON(String(rd.result), merge ? 'merge' : 'replace');
            T.Theme.apply();
            T.Shell.setMini(T.Store.settings.mini, false);
            T.toast('已导入，现有 ' + r.history + ' 条记录', { icon: 'check' });
            T.Router.render();
          } catch (e) {
            T.toast('导入失败：' + (e && e.message ? e.message : '文件格式不正确'), { icon: 'warn', ms: 5000 });
          }
        });
      };
      rd.onerror = function () { T.toast('文件读取失败', { icon: 'warn' }); };
      rd.readAsText(f);
    });
  };

  Settings.open = function () {
    var d = T.Sheet.open({
      title: '数据与设置',
      label: '数据与设置',
      body: bodyHTML(),
      foot: '<button class="btn btn--block" type="button" data-x="c">完成</button>'
    });
    if (d) bind(d);
    return d;
  };

  T.Settings = Settings;
})(window.Toolbox);
