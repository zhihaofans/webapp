/* ============================================================
   core.js — 基础设施
   工具函数 / 图标 / 存储层 / 主题 / 吐司 / 抽屉
   约定：本文件不依赖任何其它模块，允许被其它模块单向调用。
   ============================================================ */
window.Toolbox = window.Toolbox || {};

(function (T) {
  'use strict';

  var APP_NAME = '生活工具箱';
  var APP_VER = '1.1.0';
  var APP_BUILD = '2026-10-03';
  var SCHEMA = 1;

  T.APP_NAME = APP_NAME;
  T.APP_VER = APP_VER;
  T.APP_BUILD = APP_BUILD;

  /* ----------------------------------------------------------
     1. DOM 与通用工具
     ---------------------------------------------------------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }
  T.$ = $;
  T.$$ = $$;

  /* 所有进入 innerHTML 的用户数据都必须过这两个转义函数 */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escAttr(s) { return esc(s); }
  T.esc = esc;
  T.escAttr = escAttr;

  var _seq = 0;
  function uid(p) {
    _seq += 1;
    return (p || 'id') + '-' + Date.now().toString(36) + '-' + _seq.toString(36);
  }
  T.uid = uid;

  function clamp(n, lo, hi) { return n < lo ? lo : (n > hi ? hi : n); }
  T.clamp = clamp;

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms || 200);
    };
  }
  T.debounce = debounce;

  function fmtBytes(n) {
    if (n == null || isNaN(n)) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10240 ? 1 : 0) + ' KB';
    return (n / 1024 / 1024).toFixed(2) + ' MB';
  }
  T.fmtBytes = fmtBytes;

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function hms(d) {
    d = d || new Date();
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }
  function stamp(d) { return ymd(d) + ' ' + hms(d); }
  T.ymd = ymd;
  T.hms = hms;
  T.stamp = stamp;

  function relTime(ts) {
    var diff = Date.now() - ts;
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    if (diff < 86400000 * 7) return Math.floor(diff / 86400000) + ' 天前';
    var d = new Date(ts);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }
  T.relTime = relTime;

  function weekCN(d) {
    return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][(d || new Date()).getDay()];
  }
  T.weekCN = weekCN;

  /* ----------------------------------------------------------
     2. 图标
     图标是 assets/icons/*.svg 独立文件。
        · HTTP 访问：用 CSS mask 引用，随 currentColor 换色、跟随主题
        · file:// 访问：浏览器以 CORS 拦截 mask 引用本地文件，
                      自动降级为 <img> 直引（颜色来自 SVG 内置的深色媒体查询）
     ---------------------------------------------------------- */
  var ICON_MODE = (location.protocol === 'file:') ? 'img' : 'mask';
  T.ICON_MODE = ICON_MODE;
  T.ICON_BASE = 'assets/icons/';

  function ic(name, cls, size) {
    var c = 'ic' + (cls ? ' ' + cls : '') + (size ? ' ic-' + size : '');
    var file = T.ICON_BASE + name + '.svg';
    if (ICON_MODE === 'img') {
      return '<img class="' + c + ' ic--img" src="' + file + '" alt="" aria-hidden="true">';
    }
    /* 这里必须把 mask-image 直接写在元素的 inline style 上，不能走 CSS 变量：
       自定义属性里的相对 URL 是「在使用它的那条 CSS 规则所在的样式表」里解析的，
       base.css 在 assets/css/ 下，写 assets/icons/x.svg 会被解析成
       assets/css/assets/icons/x.svg 而 404。
       inline style 没有所属样式表，相对 URL 按文档地址解析 —— 结果才正确。
       另外：style 属性用双引号定界，URL 必须用单引号（或无引号），
       否则双引号会把属性提前截断，算出空的 mask。 */
    var u = "url('" + file + "')";
    return '<i class="' + c + '" style="-webkit-mask-image:' + u + ';mask-image:' + u + '" aria-hidden="true"></i>';
  }
  T.ic = ic;

  /* ----------------------------------------------------------
     3. 存储层
     主键 + 快照键：主数据损坏时自动从快照恢复。
     所有写操作都直接落 localStorage —— 输入即保存，关页面不丢。
     ---------------------------------------------------------- */
  var KEY = 'lifetoolbox.v1';
  var BAK = 'lifetoolbox.v1.bak';
  T.STORAGE_KEY = KEY;

  function blankDB() {
    return {
      schema: SCHEMA,
      createdAt: Date.now(),
      settings: {
        theme: 'auto',        // auto | light | dark
        mini: false,          // 侧拉栏收起
        quality: 0.82,        // WebP 质量
        maxEdge: 0,           // 最长边上限，0 = 不限制
        suffix: '',           // 输出文件名后缀
        keepNameTip: true,    // 首次使用提示
        autoDownload: false,  // 转换完自动下载
        g2jResolve: true,     // 链接工具：联网校验版本
        g2jOmitLatest: true,  // 链接工具：latest 省略版本段
        g2jCopyMode: 'plain'  // 链接工具：复制格式 plain | html | css
      },
      recent: [],             // [{ id, tool, at }]                     使用痕迹
      history: [],            // [{ id, name, at, srcBytes, ... }]      图片转换记录
      links: [],              // [{ id, from, to, kind, at }]           链接转换记录
      drafts: {}              // { 工具id: 未提交的输入 }                输入即保存
    };
  }
  T.blankDB = blankDB;

  function num(v, dflt, lo, hi) {
    var n = typeof v === 'number' ? v : parseFloat(v);
    if (!isFinite(n)) return dflt;
    if (lo != null && n < lo) return lo;
    if (hi != null && n > hi) return hi;
    return n;
  }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function str(v, dflt) { return typeof v === 'string' ? v : (dflt || ''); }
  function bool(v, dflt) { return typeof v === 'boolean' ? v : !!dflt; }

  /* 逐字段重建：新增字段必须在这里登记，否则表现为「存了，刷新就没了」 */
  function normalize(raw) {
    var d = blankDB();
    if (!raw || typeof raw !== 'object') return d;
    var s = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    var th = str(s.theme, 'auto');
    d.settings.theme = (th === 'light' || th === 'dark' || th === 'auto') ? th : 'auto';
    d.settings.mini = bool(s.mini, false);
    d.settings.quality = clamp(num(s.quality, 0.82), 0.4, 0.98);
    d.settings.maxEdge = clamp(Math.round(num(s.maxEdge, 0)), 0, 8000);
    d.settings.suffix = str(s.suffix, '').slice(0, 24);
    d.settings.keepNameTip = bool(s.keepNameTip, true);
    d.settings.autoDownload = bool(s.autoDownload, false);
    d.settings.g2jResolve = bool(s.g2jResolve, true);
    d.settings.g2jOmitLatest = bool(s.g2jOmitLatest, true);
    var cm = str(s.g2jCopyMode, 'plain');
    d.settings.g2jCopyMode = (cm === 'plain' || cm === 'html' || cm === 'css') ? cm : 'plain';
    d.createdAt = num(raw.createdAt, Date.now());

    /* 草稿：纯文本，限长防止异常输入把配额撑爆 */
    var dr = (raw.drafts && typeof raw.drafts === 'object') ? raw.drafts : {};
    d.drafts = {};
    Object.keys(dr).forEach(function (k) {
      var v = dr[k];
      if (typeof v === 'string' && v) d.drafts[k] = v.slice(0, 12000);
    });

    /* 链接转换记录 */
    d.links = arr(raw.links).slice(0, 60).map(function (x) {
      return {
        id: str(x && x.id, uid('l')),
        from: str(x && x.from).slice(0, 500),
        to: str(x && x.to).slice(0, 500),
        kind: str(x && x.kind),
        expanded: bool(x && x.expanded, false),
        at: num(x && x.at, Date.now())
      };
    }).filter(function (x) { return !!x.to; });

    d.recent = arr(raw.recent).slice(0, 12).map(function (x) {
      return { id: str(x && x.id, uid('r')), tool: str(x && x.tool), at: num(x && x.at, Date.now()) };
    }).filter(function (x) { return !!x.tool; });

    d.history = arr(raw.history).slice(0, 60).map(function (x) {
      return {
        id: str(x && x.id, uid('h')),
        name: str(x && x.name).slice(0, 200),
        at: num(x && x.at, Date.now()),
        srcBytes: num(x && x.srcBytes, 0),
        outBytes: num(x && x.outBytes, 0),
        w: num(x && x.w, 0),
        h: num(x && x.h, 0),
        quality: num(x && x.quality, 0.82)
      };
    });
    return d;
  }
  T.normalizeDB = normalize;

  var DB = blankDB();
  var listeners = [];

  function load() {
    var raw = null, ok = false;
    try {
      var txt = localStorage.getItem(KEY);
      if (txt) { raw = JSON.parse(txt); ok = true; }
    } catch (e) { ok = false; }

    if (!ok && raw === null) {
      // 主数据不存在或损坏 → 尝试快照
      try {
        var b = localStorage.getItem(BAK);
        if (b) { raw = JSON.parse(b); ok = true; console.warn('[存储] 主数据不可用，已从快照恢复'); }
      } catch (e2) { ok = false; }
    }
    DB = normalize(raw);
    if (!raw) DB.createdAt = Date.now();
    write(true);
    return DB;
  }

  var _saveWarned = false;
  function write(silent) {
    try {
      localStorage.setItem(KEY, JSON.stringify(DB));
      if (!silent) emit();
      return true;
    } catch (e) {
      if (!_saveWarned) {
        _saveWarned = true;
        T.toast('浏览器存储空间已满，最新改动未能保存', { icon: 'warn', ms: 5200 });
      }
      return false;
    }
  }

  /* 输入即保存：所有变更都走这里，默认不防抖 —— 由调用方按场景决定 */
  var saveSoon = debounce(function () { write(); }, 260);

  function emit() {
    listeners.forEach(function (fn) { try { fn(DB); } catch (e) { console.error(e); } });
  }

  var Store = {
    get db() { return DB; },
    get settings() { return DB.settings; },
    /* cfg: { silent:true 时不触发视图刷新 } */
    patch: function (obj, opts) {
      Object.keys(obj || {}).forEach(function (k) { DB.settings[k] = obj[k]; });
      if (opts && opts.silent) write(true); else saveSoon();
      return DB.settings;
    },
    patchNow: function (obj) {
      Object.keys(obj || {}).forEach(function (k) { DB.settings[k] = obj[k]; });
      return write();
    },
    /* 记录一次工具使用（供「最近使用」） */
    touch: function (toolId) {
      DB.recent = DB.recent.filter(function (r) { return r.tool !== toolId; });
      DB.recent.unshift({ id: uid('r'), tool: toolId, at: Date.now() });
      DB.recent = DB.recent.slice(0, 12);
      saveSoon();
    },
    addHistory: function (rec) {
      DB.history.unshift(Object.assign({ id: uid('h'), at: Date.now() }, rec));
      DB.history = DB.history.slice(0, 60);
      saveSoon();
    },
    clearHistory: function () { DB.history = []; saveSoon(); return true; },

    /* 链接转换记录：按 to 去重，新的排前面 */
    addLinks: function (recs, cap) {
      var seen = {};
      var out = [];
      DB.links.forEach(function (x) { if (x.to && !seen[x.to]) { seen[x.to] = 1; out.push(x); } });
      (recs || []).slice().reverse().forEach(function (r) {
        if (!r || !r.to || seen[r.to]) return;
        seen[r.to] = 1;
        out.unshift({ id: uid('l'), from: str(r.from, ''), to: r.to, kind: str(r.kind, ''), expanded: !!r.expanded, at: Date.now() });
      });
      DB.links = out.slice(0, cap || 30);
      saveSoon();
      return DB.links;
    },
    clearLinks: function () { DB.links = []; saveSoon(); return true; },

    /* 草稿：输入即保存 */
    setDraft: function (key, val) {
      if (!DB.drafts) DB.drafts = {};
      var v = String(val == null ? '' : val).slice(0, 12000);
      if (v) DB.drafts[key] = v; else delete DB.drafts[key];
      saveSoon();
    },
    getDraft: function (key) { return (DB.drafts && DB.drafts[key]) || ''; },
    /* 备份 / 恢复 */
    exportJSON: function () {
      return JSON.stringify({
        app: APP_NAME, ver: APP_VER, schema: SCHEMA, exportedAt: Date.now(), data: DB
      }, null, 2);
    },
    importJSON: function (text, mode) {
      var obj = JSON.parse(text);
      var src = obj && obj.data ? obj.data : obj;
      if (!src || typeof src !== 'object') throw new Error('文件内容不是有效的备份');
      var incoming = normalize(src);
      if (mode === 'merge') {
        // 合并：设置以本地为准，记录按 id 去重追加
        var seen = {};
        DB.history.forEach(function (h) { seen[h.id] = 1; });
        incoming.history.forEach(function (h) { if (!seen[h.id]) { DB.history.push(h); seen[h.id] = 1; } });
        DB.history = DB.history.slice(0, 60);
        var seenR = {};
        DB.recent.forEach(function (r) { seenR[r.tool] = 1; });
        incoming.recent.forEach(function (r) { if (!seenR[r.tool]) { DB.recent.push(r); seenR[r.tool] = 1; } });
        DB.recent = DB.recent.slice(0, 12);
      } else {
        DB = incoming;
        if (!DB.createdAt) DB.createdAt = Date.now();
      }
      write();
      return { history: DB.history.length };
    },
    reset: function () {
      var created = DB.createdAt;
      DB = blankDB();
      DB.createdAt = created || Date.now();
      write();
      return true;
    },
    count: function () { return DB.history.length + DB.recent.length; },
    /* 立刻落盘（防抖窗口内关闭页面时的兜底，由 app.js 在 pagehide 调用） */
    flush: function () { return write(true); },
    on: function (fn) { listeners.push(fn); return function () {
      listeners = listeners.filter(function (x) { return x !== fn; });
    }; }
  };
  T.Store = Store;
  T.loadStore = load;

  /* ----------------------------------------------------------
     4. 主题
     ---------------------------------------------------------- */
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function resolveTheme(v) {
    if (v === 'light' || v === 'dark') return v;
    return (mq && mq.matches) ? 'dark' : 'light';
  }
  function applyTheme() {
    var v = Store.settings.theme;
    var real = resolveTheme(v);
    document.documentElement.setAttribute('data-theme', real);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', real === 'dark' ? '#1a1917' : '#f4f1ea');
    /* 主题按钮在侧栏与手机抽屉里各有一个，用属性选择器统一更新 */
    T.$$('[data-theme-btn]').forEach(function (btn) {
      btn.innerHTML = ic(real === 'dark' ? 'moon' : 'sun', '', 0) +
        '<span>' + (real === 'dark' ? '深色' : '浅色') + '</span>';
      var label = v === 'auto' ? '跟随系统' : (v === 'dark' ? '深色模式' : '浅色模式');
      btn.setAttribute('title', '当前：' + label + ' · 点击切换');
      btn.setAttribute('aria-label', '切换主题，当前为' + label);
    });
    return real;
  }
  var Theme = {
    apply: applyTheme,
    resolved: function () { return resolveTheme(Store.settings.theme); },
    /* 三态循环：auto → light → dark → auto */
    cycle: function () {
      var cur = Store.settings.theme;
      var next = cur === 'auto' ? 'light' : (cur === 'light' ? 'dark' : 'auto');
      Store.patch({ theme: next });
      var real = applyTheme();
      T.toast(next === 'auto' ? ('已改为跟随系统 · ' + (real === 'dark' ? '深色' : '浅色'))
        : (next === 'dark' ? '已切换到深色模式' : '已切换到浅色模式'), { icon: real === 'dark' ? 'moon' : 'sun' });
      return next;
    },
    set: function (v) { Store.patch({ theme: v }); return applyTheme(); }
  };
  T.Theme = Theme;
  if (mq && mq.addEventListener) {
    mq.addEventListener('change', function () { if (Store.settings.theme === 'auto') applyTheme(); });
  }

  /* ----------------------------------------------------------
     5. 吐司
     ---------------------------------------------------------- */
  var Toast = {
    show: function (msg, opt) {
      opt = opt || {};
      var host = document.getElementById('toasts');
      if (!host) return;
      var el = document.createElement('div');
      el.className = 'toast';
      var safeIcon = opt.icon ? ic(opt.icon, '', 0) : '';
      el.innerHTML = (safeIcon || '') + '<span>' + esc(msg) + '</span>' +
        (opt.action ? '<button class="toast__btn" type="button">' + esc(opt.action.label) + '</button>' : '');
      host.appendChild(el);
      if (opt.action && typeof opt.action.fn === 'function') {
        $('.toast__btn', el).addEventListener('click', function () {
          try { opt.action.fn(); } catch (e) { console.error(e); }
          close();
        });
      }
      var timer = setTimeout(close, opt.ms || 2600);
      function close() {
        clearTimeout(timer);
        el.classList.add('is-out');
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 240);
      }
      el.addEventListener('click', function (e) { if (!e.target.closest('.toast__btn')) close(); });
      return close;
    }
  };
  T.toast = function (msg, opt) { return Toast.show(msg, opt); };
  T.Toast = Toast;

  /* ----------------------------------------------------------
     6. 抽屉 / 弹层
     关闭入口：头部 ×、底部按钮、遮罩、Esc —— 全部走同一个 close()。
     ---------------------------------------------------------- */
  var Sheet = {
    open: function (opt) {
      opt = opt || {};
      var layer = document.getElementById('layer');
      if (!layer) return null;

      var scrim = document.createElement('div');
      scrim.className = 'scrim';
      var box = document.createElement('div');
      box.className = 'sheet sheet--right';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-modal', 'true');
      if (opt.label) box.setAttribute('aria-label', opt.label);

      box.innerHTML =
        '<div class="sheet__hd">' +
          '<h3>' + esc(opt.title || '') + '</h3>' +
          '<button class="sheet__x" type="button" data-x="c" aria-label="关闭">' + ic('close', '', 0) + '</button>' +
        '</div>' +
        '<div class="sheet__bd">' + (opt.body || '') + '</div>' +
        (opt.foot ? '<div class="sheet__ft">' + opt.foot + '</div>' : '');

      layer.appendChild(scrim);
      layer.appendChild(box);
      document.body.classList.add('is-locked');

      var closed = false;
      function close() {
        if (closed) return;
        closed = true;
        scrim.classList.remove('is-on');
        box.classList.remove('is-on');
        document.removeEventListener('keydown', onKey);
        setTimeout(function () {
          if (scrim.parentNode) scrim.parentNode.removeChild(scrim);
          if (box.parentNode) box.parentNode.removeChild(box);
          document.body.classList.remove('is-locked');
        }, 300);
        if (typeof opt.onClose === 'function') { try { opt.onClose(); } catch (e) { console.error(e); } }
      }
      function onKey(e) { if (e.key === 'Escape') close(); }

      /* 关键：用 $$ 遍历绑定，body/foot 里若复用 data-x="c" 也能关掉 */
      $$('[data-x="c"]', box).forEach(function (b) { b.addEventListener('click', close); });
      scrim.addEventListener('click', close);
      document.addEventListener('keydown', onKey);

      requestAnimationFrame(function () {
        scrim.classList.add('is-on');
        box.classList.add('is-on');
      });

      return {
        el: box,
        body: $('.sheet__bd', box),
        foot: $('.sheet__ft', box),
        close: close
      };
    }
  };
  T.Sheet = Sheet;

  /* ----------------------------------------------------------
     7. 杂项：下载 / 复制 / 文件选择
     ---------------------------------------------------------- */
  function downloadBlob(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }
  T.downloadBlob = downloadBlob;

  function downloadText(text, filename, mime) {
    downloadBlob(new Blob([text], { type: mime || 'application/json;charset=utf-8' }), filename);
  }
  T.downloadText = downloadText;

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        resolve();
      } catch (e) { reject(e); }
    });
  }
  T.copyText = copyText;

  /* 统一确认弹窗（清空等破坏性操作必须过这一关） */
  T.confirm = function (opt) {
    return new Promise(function (resolve) {
      var settled = false;
      function done(v) { if (settled) return; settled = true; resolve(v); }
      var d = Sheet.open({
        title: opt.title || '确认操作',
        body: '<p class="lede" style="margin-bottom:6px">' + esc(opt.text || '') + '</p>' +
              (opt.hint ? '<p class="note">' + esc(opt.hint) + '</p>' : ''),
        foot: '<button class="btn" type="button" data-x="c">取消</button>' +
              '<button class="btn ' + (opt.danger ? 'btn--danger' : 'btn--primary') + '" type="button" id="cfmOk">' +
              esc(opt.ok || '确定') + '</button>',
        /* 任何关闭路径（× / 遮罩 / Esc）都视为「取消」 */
        onClose: function () { done(false); }
      });
      if (!d) { done(false); return; }
      d.foot.querySelector('#cfmOk').addEventListener('click', function () {
        done(true);
        d.close();
      });
    });
  };

})(window.Toolbox);
