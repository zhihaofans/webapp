/* ============================================================
   lib/github2jsdelivr.js — GitHub 链接 → jsDelivr 镜像链接
   纯逻辑，零依赖，不碰 DOM，可以被 node 直接跑（工具页只负责界面）。

   逻辑与行为对齐 jsDelivr 官网转换工具（jsdelivr/www.jsdelivr.com
   -> src/views/pages/github.html）与参考实现 github2jsdelivr v1.0：
     · 输出 https://cdn.jsdelivr.net/gh/user/repo@version/path
     · version 为 latest 时省略 @version 段
     · tag / 短 hash 会调 GitHub API 换成完整 40 位 commit，jsDelivr
       对 commit 链接永久缓存，比分支链接（缓存 12 小时）可靠
     · API 查不到时退回按分支名处理

   在参考实现之上补了几处它没覆盖的情况（README 有说明）：
     · 剥离 #L10-L20 行号锚点与 ?raw=true 查询串
     · 支持 /tree/<branch>/<dir>（目录也能过 CDN 取）
     · 支持 www.github.com 与结尾 .git

   仅「版本解析」一步会联网（api.github.com）；不解析时全程纯本地计算。
   ============================================================ */
(function (root) {
  'use strict';

  /* 浏览器里挂在 window.Toolbox 下；node 里挂到 globalThis —— 这样同一份
     纯逻辑既能被工具页调用，也能直接用 node 跑用例验证。 */
  var T = root.Toolbox = root.Toolbox || {};

  var CDN_HOST = 'https://cdn.jsdelivr.net/gh';
  var API_ROOT = 'https://api.github.com/repos/';
  var FULL_SHA = /^[0-9a-f]{40}$/i;
  var DEFAULT_ERROR = "这看起来不是一个有效的 GitHub 链接 :(";

  /* 一个正则同时吃下 github.com 与 raw.githubusercontent.com。
     第 3 段捕获 blob / raw / tree，用来区分「文件」和「目录」。 */
  var URL_RE = /^(?:https?:\/\/)?(?:www\.)?(?:github\.com|raw\.githubusercontent\.com)\/([^/?#]+)\/([^/?#]+)(?:\/(blob|raw|tree))?(?:\/([^/?#]+))?(?:\/(.*))?$/i;

  var REASON = {
    'not-found': 'API 未找到该 tag / commit',
    'rate-limit': 'GitHub API 额度已用尽（未登录每小时 60 次）',
    'network': '网络不可达或请求超时',
    'too-many': '本批次链接过多，未逐条解析',
    'off': '已关闭版本解析'
  };
  T.G2J_REASON = REASON;

  function parse(input) {
    if (!input || typeof input !== 'string') return null;
    var s = input.trim();
    if (!s) return null;
    s = s.replace(/[?#].*$/, '');      /* #L10-L20 行号锚点 / ?raw=true */
    s = s.replace(/\/+$/, '');          /* 结尾斜杠 */
    var m = URL_RE.exec(s);
    if (!m) return null;
    var repo = m[2].replace(/\.git$/i, '');
    if (!repo) return null;
    return {
      user: m[1],
      repo: repo,
      kind: (m[3] || '').toLowerCase(),   /* '' | blob | raw | tree */
      version: m[4] || '',
      file: m[5] || '',
      normalized: s
    };
  }

  function build(parsed, opts) {
    opts = opts || {};
    var base = CDN_HOST + '/' + parsed.user + '/' + parsed.repo;
    var v = parsed.version;
    var f = parsed.file;
    /* latest：老规范省略 @version 段 */
    if (!v) return base + '/';
    if (v === 'latest' && opts.omitLatest !== false) return base + (f ? '/' + f : '/');
    return base + '@' + v + (f ? '/' + f : '/');
  }

  /* 版本归类：给界面用，决定显示哪个徽标 */
  function classify(parsed) {
    if (!parsed.version) return 'repo';
    if (parsed.version === 'latest') return 'latest';
    if (FULL_SHA.test(parsed.version)) return 'commit';
    return 'unknown';                  /* 可能是 tag / 分支 / 短 hash，解析后才知道 */
  }

  /* 查 GitHub API。
     与参考实现保持一致的语义：
       · 输入是「完整 hash 的前缀」→ 补全为完整 40 位（jsDelivr 永久缓存）
       · 输入是 tag / 分支名 → 校验通过后**原样保留**，不做替换
         （tag 可读且稳定，改成 hash 反而不好维护）
     返回 { ok, sha, expanded } */
  function isCommitPrefixOrTag(user, repo, sha, opts) {
    opts = opts || {};
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, opts.timeout || 9000) : null;
    var url = API_ROOT + encodeURIComponent(user) + '/' + encodeURIComponent(repo) + '/commits/' + encodeURIComponent(sha);

    return fetch(url, {
      headers: { 'Accept': 'application/vnd.github+json' },
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      if (timer) clearTimeout(timer);
      /* GitHub 对不存在的 ref 返回 422（"No commit found for SHA"），
         对不存在的仓库返回 404 —— 两者都归为「查不到」 */
      if (res.status === 404 || res.status === 422) return { ok: false, reason: 'not-found' };
      if (res.status === 403 || res.status === 429) return { ok: false, reason: 'rate-limit' };
      if (!res.ok) return { ok: false, reason: 'http-' + res.status };
      return res.json().then(function (d) {
        var full = d && d.sha;
        if (full && typeof full === 'string' && full.indexOf(sha) === 0) {
          return { ok: true, sha: full, expanded: full !== sha };
        }
        return { ok: true, sha: sha, expanded: false };
      });
    }).catch(function () {
      if (timer) clearTimeout(timer);
      return { ok: false, reason: 'network' };
    });
  }

  /* 单条转换
     返回 { input, output, error, meta }
       meta.parsed    解析结果
       meta.kind      repo | latest | commit | short-sha | ref | unverified
       meta.verified  版本是否经 API 校验通过
       meta.expanded  短 hash 是否被补全为完整 commit
       meta.reason    未校验的原因（若有）
       meta.fullSha   补全后的完整 hash（若有）                                */
  function convert(input, opts) {
    opts = opts || {};
    var parsed = parse(input);
    if (!parsed) {
      return Promise.resolve({ input: input, output: null, error: DEFAULT_ERROR, meta: null });
    }

    var meta = { parsed: parsed, kind: classify(parsed), verified: false, expanded: false, reason: '', fullSha: '' };

    /* 三种情况不需要联网：没有版本 / latest / 已经是完整 hash */
    if (!parsed.version || parsed.version === 'latest') {
      return Promise.resolve({ input: input, output: build(parsed, opts), error: null, meta: meta });
    }
    if (FULL_SHA.test(parsed.version)) {
      meta.kind = 'commit';
      meta.verified = true;
      return Promise.resolve({ input: input, output: build(parsed, opts), error: null, meta: meta });
    }

    if (opts.resolve === false) {
      meta.reason = 'off';
      meta.kind = 'unverified';
      return Promise.resolve({ input: input, output: build(parsed, opts), error: null, meta: meta });
    }

    return isCommitPrefixOrTag(parsed.user, parsed.repo, parsed.version, opts).then(function (r) {
      if (r.ok) {
        meta.verified = true;
        meta.expanded = !!r.expanded;
        if (r.expanded) {
          /* 短 hash 被补全：换成完整 commit，jsDelivr 永久缓存 */
          meta.kind = 'short-sha';
          meta.fullSha = r.sha;
          meta.displayVersion = parsed.version;
          var p = Object.assign({}, parsed, { version: r.sha });
          return { input: input, output: build(p, opts), error: null, meta: meta };
        }
        /* tag / 分支：校验通过但保持原样 */
        meta.kind = 'ref';
        return { input: input, output: build(parsed, opts), error: null, meta: meta };
      }
      meta.reason = r.reason;
      meta.kind = 'unverified';
      return { input: input, output: build(parsed, opts), error: null, meta: meta };
    });
  }

  /* 批量：串行（不并发打 API，避免瞬间触发额度限制）
     onEach(result, index, total) 每完成一条回调一次，便于流式渲染 */
  function convertMany(list, opts, onEach) {
    opts = opts || {};
    var MAX_RESOLVE = opts.maxResolve == null ? 20 : opts.maxResolve;
    var out = [];
    var needResolve = 0;
    var i = 0;

    function step() {
      if (i >= list.length) return Promise.resolve(out);
      var raw = list[i];
      var idx = i;
      i += 1;

      var parsed = parse(raw);
      var willResolve = !!(parsed && parsed.version && parsed.version !== 'latest' &&
        !FULL_SHA.test(parsed.version) && opts.resolve !== false);
      if (willResolve) needResolve += 1;

      var tooMany = willResolve && needResolve > MAX_RESOLVE;
      var o = Object.assign({}, opts);
      if (tooMany) o.resolve = false;

      return convert(raw, o).then(function (res) {
        if (tooMany && res.meta && res.meta.kind === 'branch') res.meta.reason = 'too-many';
        out.push(res);
        if (typeof onEach === 'function') { try { onEach(res, idx, list.length); } catch (e) {} }
        return step();
      });
    }
    return step();
  }

  /* 把整段文本切成链接列表：按行拆，去空行，去重复 */
  function splitLinks(text) {
    var seen = {};
    var lines = String(text || '').split(/[\r\n]+/);
    var out = [];
    lines.forEach(function (l) {
      var s = l.trim();
      if (!s || seen[s]) return;
      seen[s] = 1;
      out.push(s);
    });
    return out;
  }

  T.GitHub2JsDelivr = {
    CDN_HOST: CDN_HOST,
    DEFAULT_ERROR: DEFAULT_ERROR,
    parse: parse,
    build: build,
    classify: classify,
    convert: convert,
    convertMany: convertMany,
    splitLinks: splitLinks,
    isCommitPrefixOrTag: isCommitPrefixOrTag
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = T.GitHub2JsDelivr;
})(typeof window !== 'undefined' ? window : globalThis);
