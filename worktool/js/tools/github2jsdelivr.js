/* ============================================================
   tools/github2jsdelivr.js — GITHUB 链接转换

   单一界面，一次给全：粘一条 GitHub 链接，同时得到
     · 加速代理 —— 前缀型镜像站，任何链接都能走
     · CDN 重写 —— jsDelivr / GitHack / Statically，仅仓库内文件
   两条转换逻辑分别在 js/lib/ghmirror.js 与 js/lib/github2jsdelivr.js。

   两段式：第一段纯本地，瞬时出全部镜像（不联网、不等待）；
   第二段按需联网校验版本，回来后**只重建 CDN 那一组**，
   所以校验期间结果已经可用，不会卡住界面。
   ============================================================ */
(function (T) {
  'use strict';

  var $ = T.$;
  var G = null;                 /* 延迟到 render 时取，保证 lib 已加载 */
  var M = null;

  var MAX_RECORD = 30;
  var DRAFT = 'github2jsdelivr';
  var state = { results: [], token: 0, verifying: false, verified: 0 };
  var inputEl = null, listEl = null;
  var runSoon = null;

  var SAMPLES = [
    { label: '仓库文件', url: 'https://github.com/jquery/jquery/blob/main/dist/jquery.min.js' },
    { label: '固定 tag', url: 'https://github.com/twbs/bootstrap/blob/v5.3.3/dist/css/bootstrap.min.css' },
    { label: 'Release 附件', url: 'https://github.com/git-for-windows/git/releases/download/v2.44.0.windows.1/Git-2.44.0-64-bit.exe' },
    { label: '源码包 zip', url: 'https://github.com/torvalds/linux/archive/refs/heads/master.zip' }
  ];

  var REASON = {
    'not-found': 'API 未找到该 tag / commit',
    'rate-limit': 'GitHub API 额度已用尽（未登录每小时 60 次）',
    'network': '网络不可达或请求超时',
    'too-many': '本批次链接过多，未逐条解析',
    'off': '已关闭版本解析'
  };

  /* ---------------- 复制格式 ---------------- */
  function fmtLink(url, mode) {
    if (mode === 'html') return '<script src="' + url + '"><\/script>';
    if (mode === 'css') return '@import url("' + url + '");';
    return url;
  }
  function copyMode() {
    return T.Store.settings.g2jCopyMode || 'plain';
  }
  function shortUrl(u) {
    return String(u || '')
      .replace(/^https:\/\/cdn\.jsdelivr\.net\/gh\//, '')
      .replace(/^https:\/\/(?:fastly|gcore)\.jsdelivr\.net\/gh\//, '')
      .replace(/^https:\/\//, '');
  }

  /* ---------------- 设置读取 ---------------- */
  function opts() {
    return { omitLatest: T.Store.settings.g2jOmitLatest === true };
  }
  function verifyOn() {
    return T.Store.settings.g2jResolve === true;
  }

  /* ---------------- 转换主流程 ---------------- */
  function run() {
    if (!inputEl) return;
    var links = G.splitLinks(inputEl.value);
    var token = ++state.token;
    state.verified = 0;
    state.verifying = false;

    if (!links.length) {
      state.results = [];
      paint();
      return;
    }

    /* 第一段：纯本地，瞬时出全部镜像 */
    state.results = M.convertMany(links, opts());
    paint();

    if (!verifyOn()) return;

    /* 第二段：联网校验版本，逐条回填 —— 只重建 CDN 那一组 */
    state.verifying = true;
    paintMeta(links.length);
    G.convertMany(links, { resolve: true, omitLatest: opts().omitLatest }, function (res, idx) {
      if (token !== state.token) return;
      var r = state.results[idx];
      if (!r || !r.ok || !res || !res.meta) return;
      var meta = res.meta;
      r.verified = !!meta.verified;
      r.expanded = !!meta.expanded;
      r.reason = meta.reason || '';
      var ver = meta.fullSha || (meta.parsed ? meta.parsed.version : '');
      if (r.parsed.version && ver && ver !== r.parsed.version) {
        r.cdns = M.buildCdns(r.parsed, ver, opts());
        r.versionUsed = ver;
      }
      if (r.verified) state.verified += 1;
      updateRow(idx);
      paintSummary();
    }).then(function () {
      if (token !== state.token) return;
      state.verifying = false;
      paint();
      recordHistory();
    });
  }

  function scheduleRun() {
    if (!runSoon) runSoon = T.debounce(run, 420);
    runSoon();
  }

  /* ---------------- 历史 ---------------- */
  function recordHistory() {
    var ok = state.results.filter(function (r) { return r && r.ok; });
    if (!ok.length) return;
    T.Store.addLinks(ok.map(function (r) {
      /* 优先记 CDN 主链接；Release / 源码包没有 CDN，就记第一条代理 */
      var to = r.cdns.length ? r.cdns[0].url : (r.proxies[0] ? r.proxies[0].url : '');
      return {
        from: r.input,
        to: to,
        kind: r.verified ? 'verified' : '',
        expanded: !!r.expanded
      };
    }).filter(function (x) { return x.to; }), MAX_RECORD);
    paintHistory();
  }

  /* ---------------- 渲染 ---------------- */
  function summaryHTML() {
    var all = state.results.length;
    if (!all) return '';
    var ok = state.results.filter(function (r) { return r.ok; }).length;
    var total = state.results.reduce(function (a, r) { return a + (r.ok ? r.total : 0); }, 0);
    var bad = all - ok;
    return '<div class="sum">' +
      '<div class="sum__i"><b>' + all + '</b><span>条链接</span></div>' +
      '<div class="sum__i"><b>' + ok + '</b><span>条已转换</span></div>' +
      '<div class="sum__i"><b>' + total + '</b><span>个镜像地址</span></div>' +
      (bad ? '<div class="sum__i"><b style="color:var(--danger)">' + bad + '</b><span>条无法识别</span></div>' : '') +
      (verifyOn() ? '<div class="sum__i"><b>' + state.verified + '</b><span>条版本经校验</span></div>' : '') +
      '<div class="sum__sp"></div>' +
      (state.verifying ? '<div class="sum__i"><span>正在校验版本…</span></div>' : '') +
    '</div>';
  }

  function groupHTML(title, sub, list, grp, extra) {
    if (!list.length) return '';
    return '<div class="mm" data-grp="' + grp + '">' +
      '<div class="mm__hd"><b>' + T.esc(title) + '</b><small>' + T.esc(sub) + '</small>' +
        (extra || '') + '</div>' +
      list.map(function (m) {
        return '<div class="mm__row">' +
          '<div class="mm__tx">' +
            '<b>' + T.esc(m.name) + '</b>' +
            '<small>' + T.esc(m.note) + '</small>' +
          '</div>' +
          '<code class="mm__url" title="' + T.escAttr(m.url) + '">' + T.esc(m.url) + '</code>' +
          '<div class="mm__acts">' +
            '<button class="btn btn--sm" type="button" data-act="copy" data-url="' + T.escAttr(m.url) + '">' +
              T.ic('copy', '', 0) + '复制</button>' +
            '<a class="btn btn--sm btn--icon" href="' + T.escAttr(m.url) + '" target="_blank" rel="noopener noreferrer"' +
              ' data-act="open" title="新窗口打开，验证这个链接通不通">' + T.ic('external', '', 0) + '</a>' +
          '</div>' +
        '</div>';
      }).join('') +
    '</div>';
  }

  /* 说明栏：直链替换、版本校验结果都集中在这里讲清楚 */
  function notesHTML(r) {
    var items = [];
    if (r.rawUrl !== r.input) {
      items.push('代理用的是文件直链：<em>' + T.esc(r.rawUrl) + '</em>');
    }
    if (r.expanded) {
      items.push('短 hash 已补全为完整 commit <em>' + T.esc(r.versionUsed || '') + '</em>，jsDelivr 对 commit 地址永久缓存。');
    } else if (r.verified && r.parsed.version) {
      items.push('版本已校验存在，保持原样输出 —— tag 比 commit hash 更好维护。');
    } else if (r.reason) {
      items.push('版本未校验（' + T.esc(REASON[r.reason] || r.reason) + '），链接本身可以正常使用。');
    }
    if (!items.length) return '';
    return '<div class="grow__note">' + T.ic('info', '', 0) +
      '<span>' + items.join(' ') + '</span></div>';
  }

  function rowHTML(r, i) {
    if (!r) return '';
    if (!r.ok) {
      return '<div class="grow" data-i="' + i + '">' +
        '<div class="grow__hd">' +
          '<span class="tag tag--danger">无法识别</span>' +
          '<span class="grow__src" title="' + T.escAttr(r.input) + '">' + T.esc(r.input) + '</span>' +
        '</div>' +
        '<div class="grow__out grow__out--err">' + T.esc(r.error || '无法识别') + '</div>' +
      '</div>';
    }
    var kind = r.parsed.kind === 'tree' ? '目录' : (r.parsed.file ? '文件' : '仓库');
    var cdnTag = r.verified
      ? '<span class="tag tag--sage">版本已校验</span>'
      : (verifyOn() && state.verifying ? '<span class="tag">校验中…</span>' : '');

    return '<div class="grow" data-i="' + i + '">' +
      '<div class="grow__hd">' +
        '<span class="tag tag--accent">' + kind + '</span>' +
        '<span class="grow__src" title="' + T.escAttr(r.input) + '">' + T.esc(r.input) + '</span>' +
        '<span class="mm__badge">' + r.total + ' 个地址</span>' +
      '</div>' +
      notesHTML(r) +
      groupHTML('加速代理', '适用于任何 GitHub 链接：文件、Release 附件、源码包、git clone', r.proxies, 'proxy') +
      groupHTML('CDN 重写', '仅适用于仓库内的文件或目录，走 CDN 节点通常更快', r.cdns, 'cdn', cdnTag) +
    '</div>';
  }

  function resultsHTML() {
    if (!state.results.length) {
      if (!inputEl || !inputEl.value.trim()) {
        return '<div class="empty">' + T.ic('link', '', 0) +
          '<b>还没有输入链接</b><p>粘一条 GitHub 链接进来，这里会同时给出可用的加速镜像，' +
          '以及 jsDelivr 等 CDN 地址。</p></div>';
      }
      return '';
    }
    return '<div class="qhead">' +
        '<h2>转换结果</h2><i class="hr"></i>' +
        '<div class="qhead__acts">' +
          '<button class="btn btn--sm btn--primary" type="button" data-act="copyall">' +
            T.ic('copy', '', 0) + '复制全部地址</button>' +
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
          '<b title="' + T.escAttr(x.to) + '">' + T.esc(shortUrl(x.to)) + '</b>' +
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
      (state.verifying ? '<i>·</i><span>校验中…</span>' : '');
  }

  /* 单一刷新入口 */
  function paint() {
    paintMeta(G && inputEl ? G.splitLinks(inputEl.value).length : 0);
    paintSummary();
    paintResults();
    paintHistory();
  }

  /* 单行补丁：校验回来时只更新那一行 */
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
          '<input type="checkbox" id="swVerify"' + (verifyOn() ? ' checked' : '') + '>' +
          '<span class="sw__track"></span>' +
          '<span class="sw__tx">联网校验版本<small>把短 hash 补全为完整 commit；tag 与分支校验后保持原样</small></span>' +
        '</label>' +
        '<label class="sw g2j__switch">' +
          '<input type="checkbox" id="swOmit"' + (s.g2jOmitLatest === true ? ' checked' : '') + '>' +
          '<span class="sw__track"></span>' +
          '<span class="sw__tx">latest 省略版本段<small>jsDelivr 输出 .../repo/文件 而不是 .../repo@latest/文件</small></span>' +
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
        '<div><b>只有「联网校验版本」会联网。</b>开启后仓库名会发给 api.github.com ' +
        '（未登录每小时 60 次）。关掉它，本工具与其他工具一样全程本地计算。</div>' +
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
      T.Store.setDraft(DRAFT, inputEl.value);   /* 输入即保存，刷新后还在 */
      scheduleRun();
    });
    /* ⌘/Ctrl + Enter 立即转换 */
    inputEl.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); run(); }
    });

    host.addEventListener('click', function (e) {
      var sBtn = e.target.closest('[data-sample]');
      if (sBtn) {
        var url = sBtn.getAttribute('data-sample');
        var cur = inputEl.value;
        inputEl.value = cur && cur.trim() ? cur.replace(/\s*$/, '\n' + url) : url;
        T.Store.setDraft(DRAFT, inputEl.value);
        run();
        inputEl.focus();
        return;
      }

      var b = e.target.closest('[data-act]');
      if (!b) return;
      var act = b.getAttribute('data-act');

      if (act === 'clear') {
        inputEl.value = '';
        T.Store.setDraft(DRAFT, '');
        state.results = [];
        state.token += 1;
        state.verified = 0;
        state.verifying = false;
        paint();
        inputEl.focus();
        return;
      }
      if (act === 'copyall') {
        var urls = [];
        state.results.forEach(function (r) {
          if (!r || !r.ok) return;
          r.proxies.concat(r.cdns).forEach(function (m) { urls.push(m.url); });
        });
        if (!urls.length) { T.toast('还没有可复制的地址', { icon: 'warn' }); return; }
        var mode = copyMode();
        T.copyText(urls.map(function (u) { return fmtLink(u, mode); }).join('\n')).then(function () {
          T.toast('已复制 ' + urls.length + ' 个地址', { icon: 'check' });
          recordHistory();
        }).catch(function () { T.toast('复制失败，请手动选中复制', { icon: 'warn' }); });
        return;
      }
      if (act === 'copy') {
        T.copyText(fmtLink(b.getAttribute('data-url') || '', copyMode())).then(function () {
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
      M = T.GhMirror;
      if (!G || !M) {
        host.innerHTML = '<div class="capmsg">' + T.ic('warn', '', 0) +
          '<div><b>转换模块没有加载成功。</b>请刷新页面重试。</div></div>';
        return;
      }
      T.Settings.bindFileInput();

      var draft = T.Store.getDraft(DRAFT);

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
              '<div class="panel__hd"><h3>' + T.ic('info', '', 0) + '两类地址</h3></div>' +
              '<div class="panel__bd">' +
                '<p class="note" style="margin-bottom:9px">' +
                  '<b style="color:var(--ink-3)">加速代理：</b>把整条链接拼在镜像域名后面，' +
                  '文件、Release 附件、源码包、git clone 都能走 —— 适用面最广。' +
                '</p>' +
                '<p class="note" style="margin-bottom:9px">' +
                  '<b style="color:var(--ink-3)">CDN 重写：</b>改写成 CDN 自己的路径格式，' +
                  '只适用于仓库里的文件或目录，但走的是 CDN 节点，通常更快更稳。' +
                  '要放进页面里用，优先挑 jsDelivr 那条。' +
                '</p>' +
                '<p class="note">' +
                  '镜像站都是第三方公益服务，域名随时可能失效。生成一串挑一个能打开的用就行。' +
                '</p>' +
              '</div>' +
            '</div>' +
            '<div class="panel">' +
              '<div class="panel__hd"><h3>' + T.ic('shield', '', 0) + '安全提醒</h3></div>' +
              '<div class="panel__bd">' +
                '<div class="netnote">' + T.ic('warn', '', 0) +
                  '<div><b>镜像请求会经过第三方服务器。</b>只用来下载公开资源，' +
                  '不要带 Token、Cookie，也不要用它传私密文件。</div>' +
                '</div>' +
              '</div>' +
            '</div>' +
          '</aside>' +
        '</div>' +
        '<div class="pagefoot">' +
          '镜像地址全部在本机拼出来，这一步不联网、不上传；只有开启「联网校验版本」时才会向 api.github.com 查询一次。' +
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
      if (inputEl) T.Store.setDraft(DRAFT, inputEl.value);
      recordHistory();
      state.token += 1;          /* 让还在飞的请求结果作废 */
      state.verifying = false;
      state.results = [];
      state.verified = 0;
      inputEl = null;
      listEl = null;
    }
  });
})(window.Toolbox);
