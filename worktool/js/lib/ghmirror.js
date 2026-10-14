/* ============================================================
   lib/ghmirror.js — GitHub 链接 → 多个加速镜像地址
   纯逻辑，零依赖（只复用同目录 github2jsdelivr.js 的 URL 解析），
   不碰 DOM，可以被 node 直接跑（工具页只负责界面）。

   两类镜像，规则完全不同，不能混为一谈：

     ① 前缀代理 —— 把原始链接整条拼在镜像域名后面
          https://gh-proxy.com/https://github.com/u/r/raw/main/a.js
        适用面最广：仓库文件、Release 附件、archive 源码包、git clone
        都能走。代价是请求会经过第三方服务器。

     ② CDN 重写 —— 把链接改写成 CDN 自己的路径格式
          https://rawcdn.githack.com/u/r/main/a.js
        只适用于仓库内的文件，但走的是 CDN 节点，通常更快更稳。

   镜像站都是第三方公益服务，域名随时可能失效。所以这里只做
   「生成候选地址」，**不做可用性探测** —— 探测会被 CORS 拦住，
   而且不该把用户的链接挨个往第三方服务器上发。
   ============================================================ */
(function (root) {
  'use strict';

  var T = root.Toolbox = root.Toolbox || {};

  /* 排序即推荐顺序：越靠前越常用。 */
  var PROXIES = [
    { id: 'ghproxy', name: 'gh-proxy.com', prefix: 'https://gh-proxy.com/',
      note: 'raw / archive / API 三路线实测全通，一般先用它' },
    { id: 'ghfast', name: 'ghfast.top', prefix: 'https://ghfast.top/',
      note: '韩国首尔节点，raw 与 archive 通' },
    { id: 'ghproxy-net', name: 'ghproxy.net', prefix: 'https://ghproxy.net/',
      note: '日本大阪节点' },
    { id: 'mirror-ghproxy', name: 'mirror.ghproxy.com', prefix: 'https://mirror.ghproxy.com/',
      note: 'gh-proxy 官方备用域名，与第一个互为备份' },
    { id: 'moeyy', name: 'github.moeyy.xyz', prefix: 'https://github.moeyy.xyz/',
      note: '新加坡 / 美国等节点' },
    { id: 'gitmirror', name: 'hub.gitmirror.com', prefix: 'https://hub.gitmirror.com/',
      note: '对大体积 Release 附件较友好' },
    { id: 'llkk', name: 'gh.llkk.cc', prefix: 'https://gh.llkk.cc/',
      note: '国内 CDN，部分宽带连通更好' },
    { id: 'jiasu', name: 'gh.jiasu.in', prefix: 'https://gh.jiasu.in/',
      note: '美国节点' }
  ];

  /* style: gh    → {host}{user}/{repo}@{ref}/{path}
            plain → {host}{user}/{repo}/{ref}/{path}
     jsd: 属于 jsDelivr 系 —— 只有它们认「latest 省略版本段」这种老写法 */
  var CDNS = [
    { id: 'jsdelivr', name: 'jsDelivr', host: 'https://cdn.jsdelivr.net/gh/', style: 'gh', jsd: true,
      note: '全球 CDN，最稳；分支链接缓存 12 小时，用 tag 更放心' },
    { id: 'fastly', name: 'jsDelivr · Fastly', host: 'https://fastly.jsdelivr.net/gh/', style: 'gh', jsd: true,
      note: 'jsDelivr 备用节点，主域名打不开时换它' },
    { id: 'gcore', name: 'jsDelivr · Gcore', host: 'https://gcore.jsdelivr.net/gh/', style: 'gh', jsd: true,
      note: 'jsDelivr 备用节点' },
    { id: 'githack', name: 'GitHack', host: 'https://rawcdn.githack.com/', style: 'plain',
      note: '国内速度好，但不支持目录，只适合单个文件', noDir: true },
    { id: 'statically', name: 'Statically', host: 'https://cdn.statically.io/gh/', style: 'gh',
      note: '支持目录；缓存较激进，内容可能不是最新的' }
  ];

  function lib() { return T.GitHub2JsDelivr || null; }

  /* 只有「仓库文件树里的东西」才谈得上 CDN 重写。
     Release 附件（/releases/download/…）和 archive 源码包（/archive/…）
     的路径同样带斜杠、同样能被解析出 version 与 file，但它们不在仓库
     文件树里，任何 CDN 都取不到 —— 必须原样交给前缀代理。 */
  var RAW_HOST_RE = /^https?:\/\/raw\.githubusercontent\.com\//i;

  function isRepoPath(p) {
    if (p.kind === 'blob' || p.kind === 'raw' || p.kind === 'tree') return true;
    /* raw.githubusercontent.com 的链接没有 blob / tree 段，解析出来 kind 是空，
       但它本身就是「取文件内容」的地址 —— 同样属于仓库文件，理应能生成 CDN。 */
    return RAW_HOST_RE.test(p.normalized) && !!p.file;
  }

  /* 代理哪条链接最划算：确定是具体文件时，统一转成 /raw/ 形式 ——
     blob 页面是 HTML，代理回来的是网页而不是文件本体，下载场景不合适。
     目录（tree）不能这么转，GitHub 的 /raw/ 只认文件。 */
  function toRawUrl(p) {
    if ((p.kind === 'blob' || p.kind === 'raw') && p.version && p.file) {
      return 'https://github.com/' + p.user + '/' + p.repo + '/raw/' + p.version + '/' + p.file;
    }
    return p.normalized;
  }

  /* 用指定的 ref 生成 CDN 重写列表。
     单独抽出来是为了配合界面的「版本校验」：校验拿到完整 commit 之后，
     只需要重建这一组链接，不用把整条结果推倒重算。 */
  function buildCdns(parsed, version, opts) {
    opts = opts || {};
    var out = [];
    if (!isRepoPath(parsed) || !version || !parsed.file) return out;
    CDNS.forEach(function (m) {
      if (m.noDir && parsed.kind === 'tree') return;
      var url;
      if (m.style === 'gh') {
        /* latest 可以省略 @version 段 —— 只有 jsDelivr 系认这种老写法 */
        if (version === 'latest' && opts.omitLatest && m.jsd) {
          url = m.host + parsed.user + '/' + parsed.repo + '/' + parsed.file;
        } else {
          url = m.host + parsed.user + '/' + parsed.repo + '@' + version + '/' + parsed.file;
        }
      } else {
        url = m.host + parsed.user + '/' + parsed.repo + '/' + version + '/' + parsed.file;
      }
      out.push({ id: m.id, name: m.name, note: m.note, url: url });
    });
    return out;
  }

  /* 单条转换
     返回 { input, ok, error, parsed, rawUrl, proxies[], cdns[], total }
     解析失败时 ok 为 false，proxies / cdns 都是空数组。 */
  function convert(input, opts) {
    opts = opts || {};
    var G = lib();
    if (!G) {
      return { input: input, ok: false, error: '转换模块未加载', proxies: [], cdns: [], total: 0 };
    }
    var parsed = G.parse(input);
    if (!parsed) {
      return { input: input, ok: false, error: G.DEFAULT_ERROR, proxies: [], cdns: [], total: 0 };
    }

    var raw = toRawUrl(parsed);

    var proxies = PROXIES.map(function (m) {
      return { id: m.id, name: m.name, note: m.note, url: m.prefix + raw };
    });

    var cdns = buildCdns(parsed, parsed.version, opts);

    return {
      input: input, ok: true, error: null,
      parsed: parsed, rawUrl: raw,
      proxies: proxies, cdns: cdns,
      version: parsed.version,
      total: proxies.length + cdns.length
    };
  }

  /* 批量：逐条转换并回调，全部是同步的（没有任何联网步骤）。 */
  function convertMany(list, opts, onEach) {
    return list.map(function (raw, i) {
      var r = convert(raw, opts);
      if (typeof onEach === 'function') { try { onEach(r, i, list.length); } catch (e) {} }
      return r;
    });
  }

  T.GhMirror = {
    PROXIES: PROXIES,
    CDNS: CDNS,
    isRepoPath: isRepoPath,
    toRawUrl: toRawUrl,
    buildCdns: buildCdns,
    convert: convert,
    convertMany: convertMany
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = T.GhMirror;
})(typeof window !== 'undefined' ? window : globalThis);
