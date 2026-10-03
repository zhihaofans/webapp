/* ============================================================
   tools/github2jsdelivr.js — GitHub 链接转 jsDelivr
   两段式：先本地立刻算出结果（无网络、无等待），再按需联网校验版本。
   纯转换逻辑在 js/lib/github2jsdelivr.js，本文件只负责界面与状态。
   ============================================================ */
(function (T) {
  'use strict';

  var $ = T.$;
  var G = null;                 /* 延迟到 render 时取，保证 lib 已加载 */

  var MAX_RECORD = 30;
  var state = { results: [], token: 0, running: false };
  var inputEl = null, listEl = null;
  var runSoon = null;

  var SAMPLES = [
    { label: 'jquery 文件', url: 'https://github.com/jquery/jquery/blob/main/dist/jquery.min.js' },
    { label: 'bootstrap 固定 tag', url: 'https://github.com/twbs/bootstrap/blob/v5.3.3/dist/css/bootstrap.min.css' },
    { label: '目录（tree）', url: 'https://github.com/twbs/bootstrap/tree/v5.3.3/dist' },
    { label: '只要仓库', url: 'https://github.com/microsoft/TypeScript' }
  ];

  /* 徽标：kind -> [文案, 样式] */
  var KIND_TAG = {
    'repo': ['仓库根', ''],
    'latest': ['latest', 'tag--amber'],
    'commit': ['完整 commit', 'tag--accent'],
    'short-sha': ['短 hash → 完整 commit', 'tag--accent'],
    'ref': ['标签 / 分支', 'tag--sage'],
    'unverified': ['未校验', ''],
    'error': ['无法识别', 'tag--danger']
  };

  /* ---------------- 复制格式 ---------------- */
  function fmtLink(url, mode) {
    if (mode === 'html') return '<script src="' + url + '"><\/script>';
    if (mode === 'css') return '@import url("' + url + '");';
    return url;
  }
  function copyMode() {
    var s = T.Store.settings;
    return s.g2jCopyMode || 'plain';
  }

  /* ---------------- 转换主流程 ---------------- */
  function opts() {
    var s = T.Store.settings;
    return { omitLatest: s.g2jOmitLatest !== false, resolve: s.g2jResolve !== false };
  }

  function run() {
    if (!inputEl) return;
    var links = G.splitLinks(inputEl.value);
    var token = ++state.token;

    paintMeta(links.length);

    if (!links.length) {
      state.results = [];
      paint();
      return;
    }

    /* 第一段：纯本地，立刻出结果 */
    var o = opts();
    G.convertMany(links, { resolve: false, omitLatest: o.omitLatest }).then(function (local) {
      if (token !== state.token) return;
      state.results = local;
      paint();

      if (!o.resolve) return;

      /* 第二段：联网校验 / 补全，逐条回填 */
      state.running = true;
      paintMeta(links.length);
      G.convertMany(links, { resolve: true, omitLatest: o.omitLatest }, function (res, idx) {
        if (token !== state.token) return;
        state.results[idx] = res;
        updateRow(idx);
        paintSummary();
      }).then(function (final) {
        if (token !== state.token) return;
        state.results = final;
        state.running = false;
        paint();
        recordHistory();
      });
    });
  }

  function scheduleRun() {
    if (!runSoon) runSoon = T.debounce(run, 420);
    runSoon();
  }

  /* ---------------- 历史 ---------------- */
  function recordHistory() {
    var ok = state.results.filter(function (r) { return r && r.output; });
    if (!ok.length) return;
    T.Store.addLinks(ok.map(function (r) {
      return {
        from: r.input,
        to: r.output,
        kind: r.meta ? r.meta.kind : '',
        expanded: !!(r.meta && r.meta.expanded)
      };
    }), MAX_RECORD);
    paintHistory();
  }

  /* ---------------- 渲染 ---------------- */
  function summaryHTML() {
    var all = state.results.length;
    var ok = state.results.filter(function (r) { return r && r.output; }).length;
    var bad = all - ok;
    var verified = state.results.filter(function (r) { return r && r.meta && r.meta.verified; }).length;
    if (!all) return '';
    return '<div class="sum">' +
      '<div class="sum__i"><b>' + all + '</b><span>条链接</span></div>' +
      '<div class="sum__i"><b>' + ok + '</b><span>条已转换</span></div>' +
      (bad ? '<div class="sum__i"><b style="color:var(--danger)">' + bad + '</b><span>条无法识别</span></div>' : '') +
      '<div class="sum__i"><b>' + verified + '</b><span>条版本经校验</span></div>' +
      '<div class="sum__sp"></div>' +
      (state.running ? '<div class="sum__i"><span>正在校验版本…</span></div>' : '') +
    '</div>';
  }

  function rowHTML(r, i) {
    if (!r) return '';
    if (r.error || !r.output) {
      return '<div class="grow" data-i="' + i + '">' +
        '<div class="grow__hd">' +
          '<span class="tag tag--danger">' + KIND_TAG.error[0] + '</span>' +
          '<span class="grow__src" title="' + T.escAttr(r.input) + '">' + T.esc(r.input) + '</span>' +
        '</div>' +
        '<div class="grow__out grow__out--err">' + T.esc(r.error || '无法识别') + '</div>' +
      '</div>';
    }

    var m = r.meta || {};
    var t = KIND_TAG[m.kind] || ['', ''];
    var note = '';
    if (m.kind === 'short-sha') {
      note = '<div class="grow__note">' + T.ic('branch', '', 0) +
        '<span>短 hash 已补全为完整 commit，jsDelivr 对 commit 地址永久缓存，内容不会再变。</span></div>';
    } else if (m.kind === 'unverified' && m.reason) {
      note = '<div class="grow__note">' + T.ic('info', '', 0) +
        '<span>版本未校验（' + T.esc(T.G2J_REASON[m.reason] || m.reason) + '）。' +
        '<em>分支链接在 jsDelivr 缓存 12 小时</em>，链接本身可以正常使用。</span></div>';
    } else if (m.kind === 'ref') {
      note = '<div class="grow__note">' + T.ic('check', '', 0) +
        '<span>版本已校验存在，保持原样输出 —— tag 比 commit hash 更好维护。</span></div>';
    }

    return '<div class="grow" data-i="' + i + '">' +
      '<div class="grow__hd">' +
        '<span class="tag ' + t[1] + '">' + T.esc(t[0]) + '</span>' +
        '<span class="grow__src" title="' + T.escAttr(r.input) + '">' + T.esc(r.input) + '</span>' +
      '</div>' +
      '<div class="grow__line">' +
        '<code class="grow__out">' + T.esc(r.output) + '</code>' +
        '<div class="grow__acts">' +
          '<button class="btn btn--sm" type="button" data-act="copy" data-i="' + i + '">' +
            T.ic('copy', '', 0) + '复制</button>' +
          '<a class="btn btn--sm btn--icon" href="' + T.escAttr(r.output) + '" target="_blank" rel="noopener noreferrer"' +
            ' data-act="open" data-i="' + i + '" title="在新窗口打开，验证链接可用">' + T.ic('external', '', 0) + '</a>' +
        '</div>' +
      '</div>' + note +
    '</div>';
  }

  function resultsHTML() {
    if (!state.results.length) {
      if (!inputEl || !inputEl.value.trim()) {
        return '<div class="empty">' + T.ic('link', '', 0) +
          '<b>还没有输入链接</b><p>把 GitHub 上的文件链接粘到上面，左边贴一行就出一个结果。' +
          '支持 blob / raw / tree 三种地址和 raw.githubusercontent.com。</p></div>';
      }
      return '';
    }
    return '<div class="qhead">' +
        '<h2>转换结果</h2><i class="hr"></i>' +
        '<div class="qhead__acts">' +
          '<button class="btn btn--sm btn--primary" type="button" data-act="copyall">' +
            T.ic('copy', '', 0) + '复制全部</button>' +
        '</div>' +
      '</div>' +
      '<div class="glist2" id="g2jList">' + state.results.map(rowHTML).join('') + '</div>';
  }

  function paintSummary() {
    var h = $('#g2jSum');
    if (h) h.innerHTML = summaryHTML();
  }
  function paintResults() {
    var h = $('#g2jOutHost');
    if (h) { h.innerHTML = resultsHTML(); listEl = $('#g2jList'); }
  }
  function paintHistory() {
    var h = $('#g2jHistHost');
    if (!h) return;
    var list = T.Store.db.links || [];
    if (!list.length) {
      h.innerHTML = '<p class="note">用过的链接会留在这里，方便随时再取一次。</p>';
      return;
    }
    h.innerHTML = '<div class="hist">' + list.slice(0, 8).map(function (x) {
      return '<div class="hitem" data-i="' + T.escAttr(x.id) + '">' +
        '<div class="hitem__tx">' +
          '<b title="' + T.escAttr(x.to) + '">' + T.esc(x.to.replace('https://cdn.jsdelivr.net/gh/', '')) + '</b>' +
          '<small>' + T.relTime(x.at) + '</small>' +
        '</div>' +
        '<button class="btn btn--sm btn--icon btn--ghost" type="button" data-act="histcopy"' +
          ' data-url="' + T.escAttr(x.to) + '" title="复制这条">' + T.ic('copy', '', 0) + '</button>' +
      '</div>';
    }).join('') + '</div>';
  }
  function paintMeta(n) {
    var h = $('#g2jMeta');
    if (!h) return;
    h.innerHTML = '<span><span class="num">' + n + '</span> 条链接</span>' +
      '<i>·</i><span>每行一个，自动去重</span>' +
      (state.running ? '<i>·</i><span>校验中…</span>' : '');
  }

  /* 单一刷新入口 */
  function paint() {
    paintMeta(G ? G.splitLinks(inputEl ? inputEl.value : '').length : 0);
    paintSummary();
    paintResults();
    paintHistory();
  }

  /* 单行补丁：联网校验回来时只更新那一行 */
  function updateRow(i) {
    if (!listEl) return;
    var row = listEl.querySelector('.grow[data-i="' + i + '"]');
    if (!row) { paintResults(); return; }
    var tmp = document.createElement('div');
    tmp.innerHTML = rowHTML(state.results[i], i);
    if (tmp.firstChild) row.parentNode.replaceChild(tmp.firstChild, row);
  }

  /* ---------------- 设置面板 ---------------- */
  function ctlHTML() {
    var s = T.Store.settings;
    var mode = s.g2jCopyMode || 'plain';
    var modes = [['plain', '纯链接'], ['html', 'HTML'], ['css', 'CSS']];
    return '<div class="ctl">' +
      '<div class="ctl__row">' +
        '<label class="sw g2j__switch">' +
          '<input type="checkbox" id="swVerify"' + (s.g2jResolve !== false ? ' checked' : '') + '>' +
          '<span class="sw__track"></span>' +
          '<span class="sw__tx">联网校验版本<small>把短 hash 补全为完整 commit；tag 与分支校验后保持原样</small></span>' +
        '</label>' +
        '<label class="sw g2j__switch">' +
          '<input type="checkbox" id="swOmit"' + (s.g2jOmitLatest !== false ? ' checked' : '') + '>' +
          '<span class="sw__track"></span>' +
          '<span class="sw__tx">latest 省略版本段<small>输出 .../repo/文件 而不是 .../repo@latest/文件</small></span>' +
        '</label>' +
      '</div>' +
      '<div class="ctl__row">' +
        '<div class="ctl__hd"><b>复制为</b></div>' +
        '<div class="seg" id="segCopy">' + modes.map(function (m) {
          return '<button class="seg__b' + (mode === m[0] ? ' is-on' : '') + '" type="button" data-v="' + m[0] + '">' +
            T.esc(m[1]) + '</button>';
        }).join('') + '</div>' +
        '<div class="ctl__hint" id="copyPreview">' + T.esc(fmtLink('https://cdn.jsdelivr.net/gh/user/repo@main/a.js', mode)) + '</div>' +
      '</div>' +
      '<div class="netnote">' + T.ic('warn', '', 0) +
        '<div><b>这是全站唯一会联网的功能。</b>开启「联网校验版本」后，仓库名会发给 api.github.com ' +
        '（未登录每小时 60 次）。关闭后本工具全程本地计算，与其他工具一样不联网。</div>' +
      '</div>' +
    '</div>';
  }

  function bindControls(host) {
    var swV = host.querySelector('#swVerify');
    if (swV) swV.addEventListener('change', function () {
      T.Store.patch({ g2jResolve: swV.checked });
      run();
    });
    var swO = host.querySelector('#swOmit');
    if (swO) swO.addEventListener('change', function () {
      T.Store.patch({ g2jOmitLatest: swO.checked });
      run();
    });
    var seg = host.querySelector('#segCopy');
    if (seg) seg.addEventListener('click', function (e) {
      var b = e.target.closest('[data-v]');
      if (!b) return;
      var v = b.getAttribute('data-v');
      T.Store.patch({ g2jCopyMode: v });
      Array.prototype.forEach.call(seg.querySelectorAll('.seg__b'), function (x) {
        x.classList.toggle('is-on', x === b);
      });
      var pv = host.querySelector('#copyPreview');
      if (pv) pv.textContent = fmtLink('https://cdn.jsdelivr.net/gh/user/repo@main/a.js', v);
    });
  }

  /* ---------------- 事件 ---------------- */
  function bindEvents(host) {
    inputEl.addEventListener('input', function () {
      T.Store.setDraft('github2jsdelivr', inputEl.value);   /* 输入即保存，刷新后还在 */
      scheduleRun();
    });
    /* 回车不换行之外的快捷键：⌘/Ctrl + Enter 立即转换 */
    inputEl.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); run(); }
    });

    host.addEventListener('click', function (e) {
      var sBtn = e.target.closest('[data-sample]');
      if (sBtn) {
        var url = sBtn.getAttribute('data-sample');
        var cur = inputEl.value;
        inputEl.value = cur && cur.trim() ? cur.replace(/\s*$/, '\n' + url) : url;
        T.Store.setDraft('github2jsdelivr', inputEl.value);
        run();
        inputEl.focus();
        return;
      }

      var b = e.target.closest('[data-act]');
      if (!b) return;
      var act = b.getAttribute('data-act');

      if (act === 'clear') {
        inputEl.value = '';
        T.Store.setDraft('github2jsdelivr', '');
        state.results = [];
        state.token += 1;
        paint();
        inputEl.focus();
        return;
      }
      if (act === 'copyall') {
        var ok = state.results.filter(function (r) { return r && r.output; });
        if (!ok.length) { T.toast('还没有可复制的结果', { icon: 'warn' }); return; }
        var mode = copyMode();
        var text = ok.map(function (r) { return fmtLink(r.output, mode); }).join('\n');
        T.copyText(text).then(function () {
          T.toast('已复制 ' + ok.length + ' 条' + (mode === 'plain' ? '链接' : ''), { icon: 'check' });
          recordHistory();
        }).catch(function () { T.toast('复制失败，请手动选中复制', { icon: 'warn' }); });
        return;
      }
      if (act === 'copy') {
        var i = parseInt(b.getAttribute('data-i'), 10);
        var r = state.results[i];
        if (!r || !r.output) return;
        var m2 = copyMode();
        T.copyText(fmtLink(r.output, m2)).then(function () {
          T.toast('已复制', { icon: 'check', ms: 1500 });
          recordHistory();
        }).catch(function () { T.toast('复制失败', { icon: 'warn' }); });
        return;
      }
      if (act === 'open') {
        setTimeout(recordHistory, 400);   /* 让浏览器先处理跳转 */
        return;
      }
      if (act === 'histcopy') {
        var u = b.getAttribute('data-url');
        T.copyText(fmtLink(u, copyMode())).then(function () {
          T.toast('已复制', { icon: 'check', ms: 1500 });
        }).catch(function () { T.toast('复制失败', { icon: 'warn' }); });
        return;
      }
    });
  }

  /* ---------------- 注册 ---------------- */
  T.register('github2jsdelivr', {
    render: function (host) {
      G = T.GitHub2JsDelivr;
      if (!G) {
        host.innerHTML = '<div class="capmsg">' + T.ic('warn', '', 0) +
          '<div><b>转换模块没有加载成功。</b>请刷新页面重试。</div></div>';
        return;
      }
      T.Settings.bindFileInput();

      var draft = T.Store.getDraft('github2jsdelivr');

      host.innerHTML =
        '<div class="g2j">' +
          '<div class="g2j__in">' +
            '<div class="panel">' +
              '<div class="panel__hd"><h3>' + T.ic('link', '', 0) + 'GitHub 链接</h3></div>' +
              '<div class="panel__bd">' +
                '<textarea class="ta" id="g2jInput" spellcheck="false" autocomplete="off"' +
                  ' placeholder="每行一个 GitHub 链接，例如：&#10;https://github.com/jquery/jquery/blob/main/dist/jquery.min.js">' +
                  T.esc(draft) + '</textarea>' +
                '<div class="g2j__acts">' +
                  '<button class="btn btn--primary" type="button" id="g2jRun">' + T.ic('convert', '', 0) + '转换</button>' +
                  '<button class="btn" type="button" data-act="clear">' + T.ic('trash', '', 0) + '清空</button>' +
                  '<div class="g2j__meta" id="g2jMeta"></div>' +
                '</div>' +
                '<div class="samples">' +
                  '<span class="samples__hd">试试：</span>' +
                  SAMPLES.map(function (s) {
                    return '<button class="sample" type="button" data-sample="' + T.escAttr(s.url) + '">' +
                      T.ic('plus', '', 0) + T.esc(s.label) + '</button>';
                  }).join('') +
                '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +

          '<div class="g2j__out">' +
            '<div id="g2jSum"></div>' +
            '<div id="g2jOutHost"></div>' +
            '<div class="panel" style="margin-top:22px">' +
              '<div class="panel__hd"><h3>' + T.ic('history', '', 0) + '最近用过</h3></div>' +
              '<div class="panel__bd" id="g2jHistHost"></div>' +
            '</div>' +
          '</div>' +

          '<aside class="g2j__side">' +
            '<div class="panel">' +
              '<div class="panel__hd"><h3>' + T.ic('sliders', '', 0) + '转换设置</h3></div>' +
              '<div class="panel__bd" id="g2jCtlHost"></div>' +
            '</div>' +
            '<div class="panel">' +
              '<div class="panel__hd"><h3>' + T.ic('info', '', 0) + '怎么用</h3></div>' +
              '<div class="panel__bd">' +
                '<p class="note" style="margin-bottom:9px">' +
                  '把 jsDelivr 链接直接贴进 HTML 或 CSS 即可，它是一个免费 CDN，' +
                  '会把 GitHub 上的文件分发到全球节点。' +
                '</p>' +
                '<p class="note">' +
                  '<b style="color:var(--ink-3)">固定版本更稳：</b>用 tag（如 <span class="num">v5.3.3</span>）' +
                  '或完整 commit，别用分支 —— 分支内容一变，缓存 12 小时后链接内容也会跟着变。' +
                '</p>' +
              '</div>' +
            '</div>' +
          '</aside>' +
        '</div>' +
        '<div class="pagefoot">' +
          '链接转换在本机完成；只有开启「联网校验版本」时才会向 api.github.com 查询一次版本是否存在。' +
        '</div>';

      inputEl = host.querySelector('#g2jInput');
      var runBtn = host.querySelector('#g2jRun');
      if (runBtn) runBtn.addEventListener('click', run);

      var ctlHost = host.querySelector('#g2jCtlHost');
      if (ctlHost) {
        ctlHost.innerHTML = ctlHTML();
        bindControls(host);
      }
      bindEvents(host);
      paint();
      if (draft.trim()) run();
    },

    onLeave: function () {
      if (inputEl) T.Store.setDraft('github2jsdelivr', inputEl.value);
      recordHistory();
      state.token += 1;          /* 让还在飞的请求结果作废 */
      state.running = false;
      state.results = [];
      inputEl = null;
      listEl = null;
    }
  });
})(window.Toolbox);
