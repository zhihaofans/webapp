/* ==========================================================================
   5. AI 供应商 / 余额查询
   --------------------------------------------------------------------------
   各厂商余额接口并不统一，这里按 kind 分发到对应适配器。
   自定义项走「OpenAI 兼容」通用探测：依次尝试常见余额端点。
   ========================================================================== */
const AI = {
  /** 预置厂商档案 */
  PROFILES: {
    deepseek: { name: 'DeepSeek', base: 'https://api.deepseek.com', color: '#4d6bfe', letter: 'D',
      keys: 'https://platform.deepseek.com/api_keys',
      models: ['deepseek-chat', 'deepseek-reasoner'] },
    mimo: { name: 'Xiaomi MiMo', base: 'https://api.xiaomimimo.com/v1', color: '#ff6900', letter: 'M',
      keys: 'https://platform.xiaomimimo.com/#/console/api-keys',
      models: ['mimo-v2.6-pro', 'mimo-v2.6-flash', 'mimo-v2.6-pro-ultraspeed'] },
    moonshot: { name: 'Moonshot', base: 'https://api.moonshot.cn/v1', color: '#12b7a8', letter: 'K',
      keys: 'https://platform.moonshot.cn/console/api-keys',
      models: ['kimi-k3', 'kimi-k2.6', 'kimi-k2.5', 'moonshot-v1-32k'] },
    openrouter: { name: 'OpenRouter', base: 'https://openrouter.ai/api/v1', color: '#6a4fd8', letter: 'O',
      keys: 'https://openrouter.ai/settings/keys',
      models: ['openai/gpt-4o-mini', 'anthropic/claude-3.5-sonnet', 'google/gemini-flash-1.5', 'deepseek/deepseek-chat'] },
    custom: { name: '自定义', base: '', color: '#7a5c78', letter: 'C', keys: '', models: [] }
  },

  get all(){ return Store.db.providers; },
  get(id){ return Store.db.providers.find(p => p.id === id); },

  /** 当前默认供应商（v1.16）—— 所有「只需要一个 AI」的功能都走这里。
   *
   *  三级回退，保证任何历史数据状态下都能拿到一个合理结果：
   *    ① 用户显式选的默认项（且必须填了 Key，否则等于没配）
   *    ② 第一个填了 Key 的供应商（老用户没选过默认时的兜底，行为与升级前一致）
   *    ③ null —— 调用方据此渲染「去配置」引导，而不是抛错
   *
   *  为什么不让调用方各自 find(p => p.key)：那样每处都要重复写回退逻辑，
   *  迟早有一处写漏；而且用户在设置里选了默认，某些页面却不认，体验上很割裂。
   */
  pickDefault(){
    const list = this.all || [];
    const wantId = Store.db?.settings?.defaultAI;
    const want = wantId ? list.find(p => p.id === wantId) : null;
    if (want && want.key) return want;
    return list.find(p => p.key) || null;
  },

  /** 默认供应商的展示名，用于「AI 查值」等按钮旁的提示文案 */
  defaultName(){
    const p = this.pickDefault();
    return p ? p.name : '';
  },

  /** 结构化错误提示 */
  friendly(e, p){
    const s = e.status;
    // 适配器已经给出明确、可读的结论时（如「该厂商未开放余额接口」），直接采用，
    // 不要再降级成「接口地址不存在」这类会误导用户的通用文案。
    if (e.mimoModels || /未开放余额查询/.test(e.message || '')) return e.message;
    if (e.name === 'AbortError') return '请求超时，检查网络或代理';
    if (s === 401) return 'Key 无效或已失效（401）';
    if (s === 403) return 'Key 无权限访问该接口（403）';
    if (s === 404) return '接口地址不存在（404），请核对 Base URL';
    if (s === 429) return '请求过于频繁，稍后再试（429）';
    if (s >= 500) return '服务端异常（' + s + '），稍后重试';
    if (s) return 'HTTP ' + s + (e.message ? '：' + e.message : '');
    if (/Failed to fetch|NetworkError|load failed/i.test(e.message)) return '网络不可达：跨域被拦截或无法连接该域名';
    return e.message || '未知错误';
  },

  /** 查询单个供应商余额 */
  async fetchBalance(p){
    if (!p.key) return { ok: false, err: '尚未填写 API Key' };
    const H = { 'Authorization': 'Bearer ' + p.key, 'Content-Type': 'application/json' };
    try {
      let out = null;
      if (p.kind === 'deepseek')       out = await this._deepseek(p, H);
      else if (p.kind === 'moonshot')  out = await this._moonshot(p, H);
      else if (p.kind === 'mimo')      out = await this._mimo(p, H);
      else if (p.kind === 'openrouter') out = await this._openrouter(p, H);
      else                             out = await this._generic(p, H);
      return out;
    } catch (e){
      return { ok: false, err: this.friendly(e, p), consoleUrl: e.console || '' };
    }
  },

  /** DeepSeek: GET /user/balance */
  async _deepseek(p, H){
    const d = await jjson(p.base.replace(/\/$/, '') + '/user/balance', { headers: H }, 12000);
    if (!d.is_available && d.balance_infos?.length === 0) throw new Error('账户不可用');
    const info = (d.balance_infos || [])[0] || {};
    const total = parseFloat(info.total_balance ?? '0');
    return { ok: true, amount: total, currency: info.currency || 'CNY',
      granted: parseFloat(info.granted_balance ?? '0'), topped: parseFloat(info.topped_up_balance ?? '0'),
      available: d.is_available !== false, raw: d };
  },

  /** Moonshot: GET /users/me/balance */
  async _moonshot(p, H){
    const d = await jjson(p.base.replace(/\/$/, '') + '/users/me/balance', { headers: H }, 12000);
    const info = d.data || d;
    const amt = Number(info.available_balance ?? info.balance ?? 0);
    return { ok: true, amount: amt, currency: 'CNY',
      voucher: Number(info.voucher_balance ?? 0), cash: Number(info.cash_balance ?? 0), raw: d };
  },

  /**
   * 小米 MiMo
   * 官方文档（mimo.mi.com/docs）只提供 OpenAI 兼容的 /chat/completions，
   * 并未开放任何余额查询接口（实测 /user/balance、/balance、/users/me/balance、
   * /dashboard/billing/credit_grants 均返回 404）。
   * 因此这里不去盲试不存在的端点，改为用 GET /models 验证 Key 有效性，
   * 并明确告知用户去官方控制台查看用量。
   */
  async _mimo(p, H){
    const base = (p.base || '').replace(/\/$/, '');
    if (!base) throw new Error('未填写 Base URL');
    // 用 /models 做连通性与鉴权校验（401/403 会在此抛出并被 friendly() 转成可读提示）
    const d = await jjson(base + '/models', { headers: H }, 12000);
    const list = (d.data || d.models || []).map(m => m.id || m.name).filter(Boolean);
    const err = new Error('MiMo 未开放余额查询接口，请到官方控制台查看用量');
    err.status = 404;
    err.mimoModels = list;
    err.console = 'https://platform.xiaomimimo.com/#/console/usage';
    throw err;
  },

  /**
   * OpenRouter
   * 官方余额接口：GET /credits → { data: { total_credits, total_usage } }
   *   「可用余额」= total_credits - total_usage（单位 USD）。
   * 另有 GET /key → { data: { limit, usage, limit_remaining } }，
   *   适合设置了消费上限的 Key，可取 limit_remaining。
   * 两者都是 USD 计价。这里先取 /credits，失败再退回 /key。
   * 文档：https://openrouter.ai/docs/api-reference/credits
   */
  async _openrouter(p, H){
    const base = (p.base || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
    // 优先 /credits（账户总余额）
    try {
      const d = await jjson(base + '/credits', { headers: H }, 12000);
      const info = d.data || d;
      const total = Number(info.total_credits ?? NaN);
      const used = Number(info.total_usage ?? 0);
      if (!isNaN(total)){
        const remain = Math.max(0, total - used);
        return { ok: true, amount: remain, currency: 'USD',
          granted: total, topped: used, raw: d };
      }
    } catch (e){
      if (e.status === 401 || e.status === 403) throw e; // 鉴权错直接上报，不再退
    }
    // 退回 /key（按 Key 的额度）
    const k = await jjson(base + '/key', { headers: H }, 12000);
    const info = k.data || k;
    const remain = info.limit_remaining;
    if (remain === null || remain === undefined){
      // 未设置上限 = 用账户余额，无独立额度可显示
      const err = new Error('该 Key 未设置消费上限，请在 OpenRouter 控制台查看账户余额');
      err.status = 404; throw err;
    }
    return { ok: true, amount: Number(remain), currency: 'USD',
      granted: Number(info.limit ?? 0), topped: Number(info.usage ?? 0), raw: k };
  },

  /** 自定义 OpenAI 兼容：尝试一组常见余额端点 + /models 连通性探测 */
  async _generic(p, H){
    const base = (p.base || '').replace(/\/$/, '');
    if (!base) throw new Error('未填写 Base URL');
    const eps = ['/dashboard/billing/credit_grants', '/user/balance', '/balance', '/users/me/balance', '/credits'];
    let last = null;
    for (const ep of eps){
      try {
        const d = await jjson(base + ep, { headers: H }, 10000);
        const info = d.data || d;
        const amt = this._digAmount(info);
        if (amt !== null) return { ok: true, amount: amt, currency: info.currency || (info.total_granted !== undefined ? 'USD' : 'CNY'), raw: d, ep: base + ep };
      } catch (e){
        last = e;
        if (e.status === 401 || e.status === 403) throw e; // 鉴权错直接上报
      }
    }
    // 兜底：确认 key 可用，但余额端点确实没有
    try {
      await jjson(base + '/models', { headers: H }, 10000);
      const err = new Error('Key 有效，但该服务未开放余额查询接口，请在厂商后台查看');
      err.status = 404; throw err;
    } catch (e){
      if (e.status === 404 && /余额/.test(e.message)) throw e;
      throw last || e;
    }
  },

  /** 从任意结构里挖出金额字段 */
  _digAmount(o, depth = 0){
    if (!o || depth > 3) return null;
    const keys = ['total_available', 'total_balance', 'available_balance', 'balance', 'remaining',
                  'credit', 'credits', 'total_granted', 'amount', 'quota'];
    for (const k of keys){
      for (const obj of [o, o.data, o.result, o.balance, o.account]){
        if (obj && typeof obj === 'object' && obj[k] !== undefined){
          const v = Number(typeof obj[k] === 'object' ? (obj[k].amount ?? obj[k].total ?? NaN) : obj[k]);
          if (!isNaN(v)) return v;
        }
      }
    }
    for (const k of Object.keys(o)){
      if (o[k] && typeof o[k] === 'object'){
        const r = this._digAmount(o[k], depth + 1);
        if (r !== null) return r;
      }
    }
    return null;
  },

  /** 批量刷新 */
  async refreshAll(ids){
    const list = ids ? this.all.filter(p => ids.includes(p.id)) : this.all;
    if (!list.length) return;
    Bal.working = list.map(p => p.id);
    Bal.render();
    // finally 兜底：任何一步抛错（渲染异常、fetchBalance 之外的意外）都要把
    // working 清空并重绘，否则卡片会永远卡在「查询中…」的假象上。
    try {
      await Promise.all(list.map(async p => {
        const r = await this.fetchBalance(p);
        Store.db.providers = Store.db.providers.map(x => x.id === p.id
          ? { ...x, bal: r.ok ? r.amount : null, balAt: r.ok ? Date.now() : x.balAt,
              balErr: r.ok ? '' : r.err, balMeta: r.ok ? r : null,
              consoleUrl: r.ok ? '' : (r.consoleUrl || '') }
          : x);
      }));
      Store.save();
    } finally {
      Bal.working = [];
      Bal.render();
    }
    const okN = list.filter(p => p.bal !== null && !p.balErr).length;
    toast(okN ? 'ok' : 'warn', '余额刷新完成', okN + ' / ' + list.length + ' 个供应商查询成功', 3800);
  },

  /**
   * 部分模型的采样参数被厂商锁死，传别的值会直接 400。
   * 依据 Moonshot 官方说明（platform.kimi.com/docs/guide/benchmark-best-practice）：
   *   kimi-k2.5 / k2.6 / k2-thinking* / k3  → temperature 只能为 1.0
   *   kimi-k2-0711 / k2-0905 / k2-turbo     → 推荐 0.6
   *   moonshot-v1-*                         → 接受任意值（0~2）
   * 命中锁定的模型返回锁定值，其余沿用调用方传入的默认值。
   */
  tempFor(model, wanted){
    const m = String(model || '').toLowerCase().trim();
    // K2.5+ / K3 / thinking 系列：参数被锁死为 1
    if (/^kimi-k(3|2\.[5-9])\b/.test(m) || /^kimi-k2-thinking/.test(m)) return 1;
    // K2 早期版本：官方推荐 0.6
    if (/^kimi-k2-(0[0-9]{3}|turbo)/.test(m)) return 0.6;
    return wanted;
  },

  /** 供新闻总结调用：用指定供应商发一次 chat 请求 */
  async chat(providerId, messages, { maxTokens = 1400, temperature = 0.4, timeout = 70000 } = {}){
    const p = this.get(providerId);
    if (!p) throw new Error('供应商不存在');
    if (!p.key) throw new Error(p.name + ' 尚未填写 API Key');
    const base = (p.base || '').replace(/\/$/, '');
    const model = (p.models && p.models[0]) || 'gpt-4o-mini';
    const url = /\/v\d+$/.test(base) || /\/(chat\/)?completions$/.test(base)
      ? (/completions$/.test(base) ? base : base + '/chat/completions')
      : base + '/chat/completions';

    const call = async (t) => {
      const body = { model, messages, temperature: t, max_tokens: maxTokens, stream: false };
      return await jjson(url, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + p.key, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }, timeout);
    };

    let d;
    try {
      d = await call(this.tempFor(model, temperature));
    } catch (e){
      // 兜底：厂商锁定采样参数时会回 "invalid temperature: only N is allowed"，
      // 从报错里读出它要求的数值再试一次，避免以后新增模型又要改代码。
      const m = /invalid temperature[^0-9]*([0-9]*\.?[0-9]+)/i.exec(e.message || '');
      if (e.status === 400 && m){
        d = await call(Number(m[1]));
      } else {
        throw e;
      }
    }
    const c = d?.choices?.[0]?.message?.content;
    if (!c) throw new Error('模型未返回内容' + (d?.error?.message ? '：' + d.error.message : ''));
    return { text: c, model: d.model || model, usage: d.usage || null };
  },

  /** 探测可用模型（部分厂商支持 /models） */
  async listModels(p){
    const base = (p.base || '').replace(/\/$/, '');
    if (!base || !p.key) return null;
    try {
      const d = await jjson(base + '/models', { headers: { 'Authorization': 'Bearer ' + p.key } }, 10000);
      const arr = d.data || d.models || [];
      const ids = arr.map(m => (typeof m === 'string' ? m : m.id)).filter(Boolean);
      return ids.length ? ids : null;
    } catch (e){ return null; }
  },

  /** 让模型估算一杯饮品的糖分（官网不公开的字段）。
   *  热量与咖啡因优先用内置官方表，这里主要补糖分，顺便给一份兜底三件套。
   *
   *  为什么让模型只回 JSON：自然语言没法抄进输入框。
   *  prompt 里把「只回 JSON、不要解释、数字不带单位」写死，并做严格解析，
   *  解析失败就抛出——由调用方降级成「只填官网值，糖分留空」，不猜。 */
  async estimateDrink(providerId, { name, volume, official }){
    const sys = '你是一位饮品营养数据助手。只输出一个 JSON 对象，不要任何解释文字、不要 markdown 代码块、不要单位。';
    const known = official && (official.k != null || official.c != null)
      ? '已知该饮品的官方数据：' +
        (official.k != null ? '热量 ' + official.k + ' kcal；' : '') +
        (official.c != null ? '咖啡因 ' + official.c + ' mg；' : '') +
        '规格为「' + (official.d || '官方默认配置') + '」。这些已知值请原样返回，不要修改。'
      : '没有官方数据，请按你的知识估算。';

    const ask = '饮品名称：' + name + '（容量约 ' + volume + 'ml）\n' + known +
      '\n请返回 JSON，字段：\n' +
      '{"kcal":热量千卡整数,"caffeine":咖啡因毫克整数,"sugar":添加糖克整数,"confidence":"high|medium|low","basis":"依据简述20字内"}\n' +
      '要求：三个数值都必须是不带单位的纯数字；不确定的字段给最接近的整数，不要写 null；' +
      'sugar 指添加糖（不含牛奶等天然存在的乳糖）；confidence 表示你对估算的把握。';

    const r = await this.chat(providerId, [
      { role: 'system', content: sys },
      { role: 'user', content: ask }
    ], { maxTokens: 400, temperature: 0.2, timeout: 45000 });

    // 严格解析：剥掉可能包裹的 ``` 与前后杂字，取第一个 {...}
    let txt = String(r.text || '').trim();
    txt = txt.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const m = txt.match(/\{[\s\S]*?\}/);
    if (!m) throw new Error('模型没有返回可解析的 JSON');

    let o;
    try { o = JSON.parse(m[0]); }
    catch (e){ throw new Error('模型返回的 JSON 格式不正确'); }

    const n = (v, max) => {
      const x = Number(String(v).replace(/[^0-9.\-]/g, ''));
      return isFinite(x) && x >= 0 ? Math.min(Math.round(x), max) : null;
    };
    const out = {
      kcal: n(o.kcal, 3000),
      caffeine: n(o.caffeine, 2000),
      sugar: n(o.sugar, 500),
      confidence: ['high', 'medium', 'low'].includes(o.confidence) ? o.confidence : 'medium',
      basis: String(o.basis || '').slice(0, 40),
      model: r.model
    };
    if (out.kcal === null && out.caffeine === null && out.sugar === null){
      throw new Error('模型返回的数值都不可用');
    }
    return out;
  }
};

/* ==========================================================================
   6. 新闻热榜
   ========================================================================== */
const NEWS_SOURCES = [
  { id:'weibo',   name:'微博热搜',  tag:'综合', icon:'fire', api:'/v2/weibo',   kind:'ov' },
  { id:'zhihu',   name:'知乎热榜',  tag:'综合', icon:'fire', api:'/v2/zhihu',   kind:'ov' },
  { id:'toutiao', name:'头条热榜',  tag:'综合', icon:'news', api:'/v2/toutiao', kind:'ov' },
  { id:'douyin',  name:'抖音热点',  tag:'短视频', icon:'fire', api:'/v2/douyin', kind:'ov' },
  { id:'quark',   name:'夸克热点',  tag:'综合', icon:'spark',api:'/v2/quark',   kind:'ov' },
  { id:'itnews',  name:'IT 之家',   tag:'科技', icon:'book', api:'/v2/it-news', sort:'rank', kind:'ov' },
  { id:'ainews',  name:'AI 快讯',   tag:'AI',   icon:'spark',api:'/v2/ai-news', kind:'ov' },
  { id:'hn',      name:'Hacker News', tag:'开发', icon:'star', api:'/v2/hacker-news/top', kind:'ov' },
  { id:'history', name:'历史上的今天', tag:'生活', icon:'clock', api:'/v2/today-in-history', kind:'ov' }
];

/** 60s API 公共实例（主站优先，失败自动切换） */
const NEWS_HOSTS = [
  'https://60s-api.viki.moe',
  'https://60s.crystelf.top',
  'https://api.elysiayanyu.top',
  'https://60s.7se.cn'
];

const News = {
  items: [],
  loading: false,
  err: '',
  active: '',      // 当前聚焦来源
  summaries: {},   // providerId -> {text, at}
  summarizing: false,
  summarizeErr: '',

  get enabled(){ return new Set(Store.db.settings.newsSources || []); },

  /** 抓一个来源（多实例自动降级） */
  async fetchOne(src){
    if (!src.api) return [];
    let lastErr = null;
    for (const host of NEWS_HOSTS){
      try {
        const url = host + src.api + (src.sort ? '?sort=' + src.sort : '');
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 11000);
        let d;
        try { d = await (await fetch(url, { signal: ctl.signal })).json(); }
        finally { clearTimeout(timer); }
        const items = this.normalize(d, src);
        if (items.length) return items;
        lastErr = new Error('返回内容为空');
      } catch (e){ lastErr = e; }
    }
    throw lastErr || new Error('全部实例不可用');
  },

  /** 把各家接口结构统一成 {title,url,hot} */
  normalize(d, src){
    const raw = d && (d.data !== undefined ? d.data : d);
    const out = [];
    const push = (title, link, hot) => {
      const t = this._clean(title);
      if (!t || t.length < 4) return;
      out.push({
        id: uid(), title: t, url: safeUrl(link) || '',
        src: src.id, srcName: src.name, hot: Number(hot) || 0, rank: out.length + 1
      });
    };
    if (Array.isArray(raw)){
      raw.forEach(x => {
        if (!x || typeof x !== 'object') return;
        if (src.id === 'history'){
          // 历史事件：标题 + 年份
          push((x.year ? x.year + ' 年 · ' : '') + (x.title || ''), x.link, 0);
          return;
        }
        const title = x.title || x.name || x.word || x.query || x.Title || '';
        const link  = x.link || x.url || x.Link || x.Url || x.mobileUrl || '';
        const hot   = x.hot_value ?? x.hotValue ?? x.hot ?? x.hot_score ?? x.score ?? x.HotValue ?? x.views ?? 0;
        push(title, link, hot);
      });
    } else if (raw && typeof raw === 'object'){
      // 有的接口把列表放在子字段里
      for (const v of Object.values(raw)){
        if (Array.isArray(v) && v.length && typeof v[0] === 'object'){
          v.forEach(x => push(x.title || x.name || '', x.link || x.url || '', x.hot_value ?? x.hot ?? 0));
          break;
        }
      }
    }
    return out.slice(0, 40).map((x, i) => ({ ...x, rank: i + 1 }));
  },

  /** 清洗标题 */
  _clean(t){
    return String(t == null ? '' : t)
      .replace(/<[^>]*>/g, ' ')
      .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  },

  /** 兜底：从任意 HTML 抽取标题（旧式网页来源仍可用） */
  parseHtml(html, src){
    const out = [], seen = new Set();
    const re = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]{2,220}?)<\/a>/gi;
    let m, guard = 0;
    while ((m = re.exec(html)) && guard++ < 2500){
      let txt = m[2].replace(/<[^>]+>/g, ' ').replace(/&quot;/g,'"').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ');
      txt = this._clean(txt);
      if (!txt || txt.length < 6 || txt.length > 150) continue;
      if (/^(登录|注册|首页|更多|下载|客户端|广告|关于我们|隐私|条款)$/.test(txt)) continue;
      const k = txt.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      let href = m[1];
      try {
        if (/^\/\//.test(href)) href = 'https:' + href;
        else if (/^\//.test(href)) href = new URL(src.url).origin + href;
        else if (!/^https?:/i.test(href)) href = new URL(href, src.url).href;
      } catch (e){ href = ''; }
      out.push({ id: uid(), title: txt, url: safeUrl(href) || '', src: src.id, srcName: src.name, hot: 0, rank: out.length + 1 });
    }
    return out.slice(0, 30);
  },

  /** 抓取所有已启用来源 */
  async fetchAll(){
    if (this.loading) return;
    const srcs = NEWS_SOURCES.filter(s => this.enabled.has(s.id) && s.id !== 'ssr');
    if (!srcs.length){ toast('warn', '没有选中任何来源', '在左侧列表里挑几个想看的。'); return; }
    this.loading = true; this.err = ''; this.render();
    const results = await Promise.allSettled(srcs.map(s => this.fetchOne(s)));
    const all = []; const failed = [];
    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value.length){ all.push(...r.value); }
      else failed.push(srcs[i].name);
    });
    // 交错合并，避免同一来源扎堆
    const bySrc = {};
    all.forEach(x => { (bySrc[x.src] = bySrc[x.src] || []).push(x); });
    const order = Object.keys(bySrc);
    const merged = [];
    for (let round = 0; merged.length < all.length && round < 40; round++){
      order.forEach(k => { const it = bySrc[k][round]; if (it) merged.push(it); });
    }
    this.items = merged.map((x, i) => ({ ...x, rank: i + 1 }));
    this.loading = false;
    if (!this.items.length){
      this.err = failed.length ? ('以下来源抓取失败：' + failed.join('、')) : '没有抓到内容，稍后再试。';
    }
    Store.db.settings.lastNews = { items: this.items.slice(0, 80), at: Date.now(), failed };
    Store.save();
    this.render();
    if (this.items.length) toast('ok', '热榜已更新', '共 ' + this.items.length + ' 条，来自 ' + Object.keys(bySrc).length + ' 个来源', 3200);
    else toast('err', '抓取失败', this.err, 6000);
  },

  /** 重绘当前新闻视图（保持滚动位置） */
  render(){
    if (CUR !== 'news') return;
    const y = window.scrollY;
    renderNews();
    window.scrollTo(0, y);
  },

  /** AI 总结 —— 使用选定供应商 */
  async summarize(providerId){
    const p = AI.get(providerId);
    if (!p){ toast('err', '供应商不存在'); return; }
    if (!p.key){
      toast('warn', p.name + ' 缺少 API Key', '先在「AI 余额」里填好 Key，再回来总结。', 6000, [
        { text: '去填写', fn: () => Bal.openEditor(p.id) }
      ]);
      return;
    }
    if (!this.items.length){ toast('warn', '还没有热榜内容', '先刷新一次热榜。'); return; }
    this.summarizing = true; this.summarizeErr = ''; this.render();

    const list = this.items.slice(0, 45).map((x, i) =>
      (i + 1) + '. [' + x.srcName + '] ' + x.title).join('\n');

    const sys = '你是一位资讯编辑。请只依据用户给出的热榜标题进行归纳，不要编造未出现的事实、数字或链接。输出使用简体中文，Markdown 格式，结构如下（不要添加其他标题层级）：\n' +
      '## 一句话概览\n（40字以内概括当下舆论重心）\n' +
      '## 正在发生\n（4到6条要点，每条以「- 」开头，说明是什么事、为何受关注）\n' +
      '## 值得留意\n（2到3条更深一层的观察或趋势判断）\n' +
      '## 生活提示\n（1到2条与普通人日常生活相关的实用提示，例如出行、消费、天气相关注意事项）';

    const usr = '今日热榜（共 ' + this.items.length + ' 条，以下为节选）：\n\n' + list + '\n\n请按要求归纳。';

    try {
      const r = await AI.chat(providerId, [
        { role: 'system', content: sys },
        { role: 'user', content: usr }
      ], { maxTokens: 1500, temperature: 0.35 });
      this.summaries[providerId] = { text: r.text, at: Date.now(), model: r.model, usage: r.usage };
      toast('ok', p.name + ' 总结完成', '模型：' + r.model, 3200);
    } catch (e){
      this.summarizeErr = AI.friendly(e, p);
      toast('err', p.name + ' 总结失败', this.summarizeErr, 7000);
    }
    this.summarizing = false;
    this.render();
  },

  /** 多 AI 并行总结并做交叉对照 */
  async summarizeMulti(ids){
    const list = ids.filter(id => (AI.get(id)?.key));
    if (!list.length){ toast('warn', '没有可用的 AI', '至少给一个供应商填上 API Key。'); return; }
    this.summarizing = true; this.summarizeErr = ''; this.render();
    const res = await Promise.allSettled(list.map(id => this.summarize(id)));
    this.summarizing = false;
    this.compareMode = list.length > 1;
    this.render();
    const ok = list.filter(id => this.summaries[id]).length;
    toast(ok ? 'ok' : 'err', '多模型汇总完成', ok + ' / ' + list.length + ' 个模型返回了结果', 4000);
  },

  /** 极简 Markdown → HTML（只支持总结所需的子集，全程转义） */
  md(src){
    const lines = String(src || '').split(/\r?\n/);
    let html = '', inUl = false, inOl = false;
    const inline = s => esc(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code style="font-family:var(--f-num);font-size:12.5px;background:var(--surface-3);padding:1px 4px;border-radius:4px">$1</code>');
    const closeLists = () => {
      if (inUl){ html += '</ul>'; inUl = false; }
      if (inOl){ html += '</ol>'; inOl = false; }
    };
    for (let raw of lines){
      const line = raw.replace(/\s+$/, '');
      if (!line.trim()){ closeLists(); continue; }
      let m;
      if ((m = line.match(/^#{1,6}\s+(.*)$/))){ closeLists(); html += '<h4>' + inline(m[1]) + '</h4>'; continue; }
      if ((m = line.match(/^\s*[-*+]\s+(.*)$/))){
        if (!inUl){ closeLists(); html += '<ul>'; inUl = true; }
        html += '<li>' + inline(m[1]) + '</li>'; continue;
      }
      if ((m = line.match(/^\s*\d+[.、)]\s+(.*)$/))){
        if (!inOl){ closeLists(); html += '<ol style="margin:0;padding-left:22px;display:flex;flex-direction:column;gap:6px">'; inOl = true; }
        html += '<li style="list-style:decimal">' + inline(m[1]) + '</li>'; continue;
      }
      closeLists();
      html += '<p>' + inline(line) + '</p>';
    }
    closeLists();
    return html || '<p class="muted">（内容为空）</p>';
  }
};
