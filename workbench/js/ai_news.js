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
              // 顺手把币种也写进档案：它要持久化，刷新页面后才能显示对（OpenRouter 是 USD）
              cur: (r.ok && r.currency) ? r.currency : x.cur,
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

    /**
     * 联网查证（v1.27）：内置官方表没覆盖的品牌饮品，先搜一下它的营养标注。
     *
     * 只在「官方表缺值」时才搜 —— 官方值已经拿到热量与咖啡因时，联网只能补一个
     * 糖分，边际收益低却要多花两次调用，不划算。
     *
     * 整段包在 try 里且不重新抛出：联网是锦上添花，任何失败（限流、Key 失效、
     * 目标站反爬）都必须静默退回到纯 AI 估算，绝不能让「查不到」变成「用不了」。
     */
    let refs = '', srcHost = '';
    const lackOfficial = !official || official.k == null || official.c == null;
    if (lackOfficial && WebSearch.ready()){
      try {
        const rs = await WebSearch.search(
          name + ' ' + (volume || '') + 'ml 热量 咖啡因 添加糖 营养成分',
          { count: 4, content: true, timeout: 15000 }
        );
        // 优先用带正文的（content），退而用摘要（summary）；两者都空就丢掉这条
        const picked = rs.filter(r => r && (r.content || r.summary)).slice(0, 3);
        if (picked.length){
          refs = picked.map((r, i) =>
            '【资料' + (i + 1) + '】' + String(r.title || '').slice(0, 60) +
            '（' + String(r.site_name || '网页') + '）\n' +
            String(r.content || r.summary || '').replace(/\s+/g, ' ').slice(0, 1200)
          ).join('\n\n');
          srcHost = String(picked[0].site_name || '').slice(0, 30);
        }
      } catch (e){ refs = ''; }
    }

    const refBlock = refs
      ? '\n\n以下是刚检索到的网络资料，请**优先依据它们**给出数值；资料之间矛盾时取更具体、更接近官方的那条：\n' +
        refs + '\n\n若资料里没有某项数据，再按常识估算，并在 basis 里说明是估算。'
      : '';

    const ask = '饮品名称：' + name + '（容量约 ' + volume + 'ml）\n' + known + refBlock +
      '\n请返回 JSON，字段：\n' +
      '{"kcal":热量千卡整数,"caffeine":咖啡因毫克整数,"sugar":添加糖克整数,"confidence":"high|medium|low","basis":"依据简述20字内","source":"资料来源站点名，没有就留空"}\n' +
      '要求：三个数值都必须是不带单位的纯数字；不确定的字段给最接近的整数，不要写 null；' +
      'sugar 指添加糖（不含牛奶等天然存在的乳糖）；confidence 表示你对估算的把握，' +
      '依据了检索资料时用 high，纯凭记忆时用 medium 或 low。';

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
      // 是否真的依据了联网资料 + 来源站点。UI 靠它把「查证」与「估算」区分开，
      // 不能让用户以为纯凭记忆猜出来的数字也是查到的。
      web: !!refs,
      source: String(o.source || srcHost || '').slice(0, 30),
      model: r.model
    };
    if (out.kcal === null && out.caffeine === null && out.sugar === null){
      throw new Error('模型返回的数值都不可用');
    }
    return out;
  },

  /**
   * 让默认 AI 根据当日天气给一段「今天怎么穿」的穿搭建议。
   *
   *  与 advice() 的关系：advice() 是纯本地的规则拼接（阈值硬编码），
   *  离线可用、零成本，但文案机械、不会结合湿度/风/温差综合取舍。
   *  AI 版把结构化的天气数据交给模型，让它给一段更自然、更有针对性的建议。
   *
   *  约束（和 estimateDrink 同思路）：
   *    · 只输出一段纯文本，不要 markdown、不要列表符号、不要标题；
   *    · 限制字数，避免手机端卡片被撑爆；
   *    · 明确「不要编造天气数据」，只用给定的数值；
   *    · 不要医疗建议、不要问句、不要寒暄。
   */
  async weatherDress(providerId, w){
    const sys = '你是一位生活化的穿搭助手。只输出一段中文纯文本建议，不要 markdown、不要标题、不要列表符号、不要换行、不要问句、不要寒暄。';
    const lines = [
      '地点：' + (w.place || '未提供'),
      '时间：' + (w.date || '今天'),
      '天气：' + (w.desc || '未知'),
      '气温：' + fmtNum(w.temp, '°C') + '（体感 ' + fmtNum(w.feels, '°C') + '）',
      '今日温度区间：' + (w.min != null && w.max != null ? fmtNum(w.min, '°C') + ' ~ ' + fmtNum(w.max, '°C') : '未知'),
      '昼夜温差：' + fmtNum(w.diff, '°C'),
      '湿度：' + fmtNum(w.humidity, '%'),
      '风速：' + fmtNum(w.windK, ' km/h') + (w.windDir ? '（' + w.windDir + '）' : ''),
      '降水：' + fmtNum(w.precip, 'mm'),
      '紫外线指数：' + (w.uv != null ? String(w.uv) : '未知'),
      '能见度：' + fmtNum(w.vis, 'km')
    ].join('\n');

    const ask = '今天的天气数据如下（请只依据这些数据，不要编造）：\n' + lines + '\n\n' +
      '请用 60~110 个汉字给出一段「今天怎么穿」的建议，要具体到穿什么（上装/下装/外套/鞋子），' +
      '并顺带提醒今天最需要注意的一件事（如带伞、防晒、防风、早晚加衣、补水等）。' +
      '直接给建议，不要复述天气数据。';

    const r = await this.chat(providerId, [
      { role: 'system', content: sys },
      { role: 'user', content: ask }
    ], { maxTokens: 320, temperature: 0.5, timeout: 45000 });

    // 清掉模型偶发夹带的 markdown 符号与多余空白，压成一行
    let txt = String(r.text || '')
      .replace(/```[a-z]*/gi, '')
      .replace(/[#*`>_~]/g, '')
      .replace(/^\s*[-•·\d]+[.、)]\s*/gm, '')
      .replace(/\s*\n\s*/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (!txt) throw new Error('模型未返回内容');
    if (txt.length > 260) txt = txt.slice(0, 260).replace(/[，,。.]?$/, '') + '…';
    return { text: txt, model: r.model };
  },

  /**
   * 带图片的多模态请求（v1.26 物品管理器用）。
   *
   *  按 OpenAI 兼容格式把 user content 拼成数组：[{type:'text'}, {type:'image_url'}]。
   *  这是 OpenAI / OpenRouter / Moonshot / 多数国产兼容接口的通用写法。
   *
   *  注意：不是所有模型都能看图。DeepSeek 的 deepseek-chat 就不支持，会返回
   *  400/invalid content。调用方（items.js）负责把错误翻译成人话并引导换模型；
   *  这里只做「原样转发 + 把常见报错包装得可读一点」。
   */
  async vision(providerId, { sys, ask, image, maxTokens = 800, temperature = 0.2, timeout = 60000 } = {}){
    if (!image) throw new Error('没有图片数据');
    const m = /^data:(image\/[a-z0-9.+-]+);base64,/i.exec(String(image));
    const mime = m ? m[1] : 'image/jpeg';
    const b64 = String(image).replace(/^data:[^;]+;base64,/i, '');
    if (!b64) throw new Error('图片数据为空');
    try {
      return await this.chat(providerId, [
        { role: 'system', content: sys },
        { role: 'user', content: [
          { type: 'text', text: ask },
          { type: 'image_url', image_url: { url: 'data:' + mime + ';base64,' + b64 } }
        ] }
      ], { maxTokens, temperature, timeout });
    } catch (e){
      // 把「模型不支持看图」这类报错翻译成人话（其余交给 friendly() 统一成可读文案）
      const msg = String(e.message || '');
      if (/image|vision|multimodal|content.*type|unsupported/i.test(msg) && (e.status === 400 || e.status === 422)){
        throw new Error('当前模型不支持看图（' + msg.slice(0, 80) + '）。请到「设置 → 默认 AI」换一个支持视觉的模型，例如 OpenRouter 上的 gpt-4o-mini / gemini-flash。');
      }
      // HTTP 层错误（401/500/超时等）统一走 friendly()，
      // 否则用户只会看到接口原样返回的「boom」这种没法处理的字串。
      if (e.status || e.name === 'AbortError' || /Failed to fetch|NetworkError|load failed/i.test(msg)){
        throw new Error(this.friendly(e));
      }
      throw e;
    }
  }
};

/* ==========================================================================
   联网检索 —— DeepSeek Search / Fetch（v1.27）
   --------------------------------------------------------------------------
   两个接口 2026-10-17 上线，与 chat 用同一把 Bearer Key：
     POST https://api.deepseek.com/v1/tools/search   { query, count, need_content }
     POST https://api.deepseek.com/v1/tools/fetch    { url } → { title, content(Markdown) }

   为什么固定用 DeepSeek 的 Key、而不是「默认 AI」那把：
   这是 DeepSeek 独有的能力，换成 OpenRouter / Moonshot 的 Key 根本调不通。
   所以检索走 DeepSeek，整理（写结论）仍走用户选中的模型 —— 两者解耦。

   计费：¥5/1000 次，**只有返回内容才计费**（空结果 / 超时 / 4xx 都免费），
   所以「搜不到」不心疼，可以放心当兜底用。
   ========================================================================== */
const WebSearch = {
  HOST: 'https://api.deepseek.com/v1/tools',
  _lastAt: 0,
  _chain: Promise.resolve(),   // 串行闸门：让并发调用排队，而不是同时撞上去

  /** 找一把能用的 DeepSeek Key：先认 kind，再认 base（用户可能自建了一个 DeepSeek 供应商） */
  provider(){
    return AI.all.find(p => p.kind === 'deepseek' && p.key)
        || AI.all.find(p => p.key && /api\.deepseek\.com/i.test(p.base || ''))
        || null;
  },

  /** 用户是否在设置里打开了开关 */
  get on(){ return !!Store.db.settings.webSearch; },

  /** 真正可用的条件：开关打开 + 有 Key。UI 和调用方都用它判断 */
  ready(){ return this.on && !!this.provider(); },

  /**
   * 全局限流闸门。文档限 5 req/s（Search 与 Fetch 各自独立计），这里取 4 req/s 留余量。
   * 关键点：必须**串行**。若只用「记录上次调用时间」那种写法，多个并发调用会同时
   * 读到同一个旧时间戳、同时判定「可以发」，闸门形同虚设（总结要并发抓 8 条正文，
   * 正好会踩这个）。
   */
  _gate(){
    const run = this._chain.then(async () => {
      const wait = this._lastAt + 250 - Date.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      this._lastAt = Date.now();
    });
    this._chain = run.catch(() => {});
    return run;
  },

  async _post(path, body, timeout){
    const p = this.provider();
    if (!p) throw new Error('需要先在「AI 余额」里填好 DeepSeek 的 API Key');
    await this._gate();
    try {
      return await jjson(this.HOST + path, {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + p.key, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }, timeout || 20000);
    } catch (e){
      // 翻译成用户能处理的说法。其余错误交给调用方决定降级还是提示。
      if (e.status === 429) throw new Error('联网检索被限流了（5 次/秒），稍等几秒再试');
      if (e.status === 401 || e.status === 403) throw new Error('DeepSeek 的 Key 无效，去「AI 余额」检查一下');
      throw e;
    }
  },

  /**
   * 搜网页。content=true 时一并带回正文 —— 这一步能省掉后续的 fetch，
   * 文档里 content 在 need_content=false 时恒为空串。
   */
  async search(query, { count = 5, content = false, timeout = 20000 } = {}){
    const q = String(query || '').trim().slice(0, 128);   // 接口上限 128 字符
    if (!q) return [];
    const d = await this._post('/search', { query: q, count, need_content: !!content }, timeout);
    return (d && Array.isArray(d.results)) ? d.results : [];
  },

  /** 抓单个网页正文（Markdown）。返回 { title, content } */
  async fetch(url, { timeout = 20000 } = {}){
    const u = String(url || '').trim();
    if (!/^https?:\/\//i.test(u)) throw new Error('只支持 http/https 链接');
    const d = await this._post('/fetch', { url: u }, timeout);
    return { title: String((d && d.title) || ''), content: String((d && d.content) || '') };
  }
};

/** 数值格式化：null/undefined → 「未知」，否则带单位 */
function fmtNum(v, unit){
  if (v == null || !isFinite(Number(v))) return '未知';
  return Math.round(Number(v) * 10) / 10 + unit;
}

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
  sumNote: '',       // 抓正文时的进度文案（「正在抓取 6 条正文…」），抓完清空

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
    this.summarizing = true; this.summarizeErr = ''; this.sumNote = ''; this.render();

    /**
     * 联网抓正文（v1.27）。
     *
     * 只对「资讯类」来源抓 —— 微博热搜、知乎热榜、抖音、夸克、头条的链接都是
     * 站内页，反爬严格，抓取几乎必失败；IT之家 / AI快讯 / Hacker News 是正经
     * 文章页，成功率高。与其广撒网白烧钱，不如只抓能抓的。
     *
     * 条数上限 8 条：一是限流 5 req/s（这里串行排队约 250ms/条），二是计费
     * ¥0.005/条 —— 45 条全抓要 0.225 元还得等十几秒，不值。
     *
     * 抓不到就静默跳过，最终会退化回「仅标题」模式，不影响总结本身。
     */
    let briefs = '', webCount = 0;
    if (WebSearch.ready()){
      const FETCHABLE = { itnews: 1, ainews: 1, hn: 1 };
      const cands = this.items.filter(x => x.url && FETCHABLE[x.src]).slice(0, 8);
      if (cands.length){
        this.sumNote = '正在抓取 ' + cands.length + ' 条正文…';
        this.render();
        const got = await Promise.all(cands.map(async x => {
          try {
            const r = await WebSearch.fetch(x.url, { timeout: 15000 });
            // 正文压成一行再截断：省 token，也避免模型被排版符号带偏。
            // 少于 120 字的多半是登录墙 / 404 页，丢掉不用。
            const t = String(r.content || '').replace(/\s+/g, ' ').trim();
            return t.length >= 120 ? { head: '[' + x.srcName + '] ' + x.title, text: t.slice(0, 800) } : null;
          } catch (e){ return null; }
        }));
        const ok = got.filter(Boolean);
        if (ok.length){
          webCount = ok.length;
          briefs = '\n\n以下 ' + ok.length + ' 条附有正文（其余只有标题）：\n' +
            ok.map((b, i) => (i + 1) + '. ' + b.head + '\n' + b.text).join('\n\n');
        }
        this.sumNote = '';
        this.render();
      }
    }

    const list = this.items.slice(0, 45).map((x, i) =>
      (i + 1) + '. [' + x.srcName + '] ' + x.title).join('\n');

    const sys = '你是一位资讯编辑。' +
      (webCount
        ? '部分条目附有正文，请优先依据正文事实归纳；只有标题的条目只做概括，不要臆测其中的人物、数字或结论。'
        : '请只依据用户给出的热榜标题进行归纳，不要编造未出现的事实、数字或链接。') +
      '输出使用简体中文，Markdown 格式，结构如下（不要添加其他标题层级）：\n' +
      '## 一句话概览\n（40字以内概括当下舆论重心）\n' +
      '## 正在发生\n（4到6条要点，每条以「- 」开头，说明是什么事、为何受关注）\n' +
      '## 值得留意\n（2到3条更深一层的观察或趋势判断）\n' +
      '## 生活提示\n（1到2条与普通人日常生活相关的实用提示，例如出行、消费、天气相关注意事项）';

    const usr = '今日热榜（共 ' + this.items.length + ' 条，以下为节选）：\n\n' + list + briefs + '\n\n请按要求归纳。';

    try {
      const r = await AI.chat(providerId, [
        { role: 'system', content: sys },
        { role: 'user', content: usr }
      ], { maxTokens: 1500, temperature: 0.35 });
      this.summaries[providerId] = { text: r.text, at: Date.now(), model: r.model, usage: r.usage, webCount };
      toast('ok', p.name + ' 总结完成',
        '模型：' + r.model + (webCount ? ' · 参考了 ' + webCount + ' 篇正文' : ' · 仅依据标题'), 3200);
    } catch (e){
      this.summarizeErr = AI.friendly(e, p);
      toast('err', p.name + ' 总结失败', this.summarizeErr, 7000);
    }
    this.summarizing = false;
    this.sumNote = '';
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
