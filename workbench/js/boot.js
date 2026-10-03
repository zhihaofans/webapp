/* ==========================================================================
   8. 备份 / 导出 / 导入
   ========================================================================== */
const Backup = {
  /** 导出全部数据（不限条数） */
  exportAll(){
    const payload = {
      _app: 'lifehub', _schema: SCHEMA, _version: 1,
      _exportedAt: new Date().toISOString(),
      _counts: {
        notes: Store.db.notes.length, money: Store.db.money.length,
        todo: Store.db.todo.length, habits: Store.db.habits.length,
        providers: Store.db.providers.length
      },
      settings: Store.db.settings,
      providers: Store.db.providers,
      notes: Store.db.notes, money: Store.db.money,
      todo: Store.db.todo, habits: Store.db.habits,
      createdAt: Store.db.createdAt, demo: Store.db.demo
    };
    const s = JSON.stringify(payload, null, 2);
    const ts = new Date();
    const name = 'lifehub-backup-' + dayKey(ts) + '-' + pad2(ts.getHours()) + pad2(ts.getMinutes()) + '.json';
    download(name, s);
    try { localStorage.setItem('lifehub.v1.lastExport', String(Date.now())); } catch(e){}
    toast('ok', '备份已导出', name + '（' + (new Blob([s]).size / 1024).toFixed(1) + ' KB，' + Store.count() + ' 条记录）', 6000);
  },

  /** 导入（合并或覆盖），不限条数 */
  openImport(){
    const fi = document.createElement('input');
    fi.type = 'file'; fi.accept = '.json,application/json';
    fi.onchange = () => {
      const f = fi.files && fi.files[0];
      if (f) this.handleFile(f);
    };
    fi.click();
  },

  async handleFile(file){
    let txt;
    try { txt = await file.text(); }
    catch (e){ toast('err', '读取文件失败', e.message); return; }
    await this.importText(txt, file.name);
  },

  /** 允许粘贴 JSON 文本导入 */
  openPaste(){
    modal({
      title: '粘贴 JSON 导入',
      desc: '把之前导出的备份内容整段粘贴进来即可。',
      okText: '解析并预览', wide: true,
      body: '<textarea class="ta" id="impTa" placeholder="粘贴 JSON…" style="min-height:220px;font-family:var(--f-num);font-size:12px"></textarea>',
      onOk: bd => {
        const t = $('#impTa', bd).value.trim();
        if (!t){ toast('warn', '还没有粘贴内容'); return false; }
        setTimeout(() => this.importText(t, '（粘贴内容）'), 60);
      }
    });
  },

  async importText(txt, sourceName){
    let raw;
    try { raw = JSON.parse(txt); }
    catch (e){
      this._showBad('JSON 语法错误', e.message, txt, sourceName);
      return;
    }
    let parsed;
    try { parsed = Store.normalize(raw); }
    catch (e){
      this._showBad('数据结构无法识别', e.message, txt, sourceName);
      return;
    }
    const c = {
      notes: parsed.notes.length, money: parsed.money.length,
      todo: parsed.todo.length, habits: parsed.habits.length,
      providers: parsed.providers.length
    };
    const total = c.notes + c.money + c.todo + c.habits;
    if (!total && !c.providers){
      toast('warn', '文件里没有可导入的数据', '可能是个空备份，或者格式不对。', 6000);
      return;
    }
    modal({
      title: '导入确认',
      desc: '来自「' + sourceName + '」，共识别出 ' + total + ' 条记录。',
      wide: true,
      body:
        '<div class="grid g-3" style="gap:10px">' +
          mini('笔记', c.notes) + mini('收支', c.money) + mini('待办', c.todo) +
          mini('习惯', c.habits) + mini('供应商', c.providers) + mini('当前已有', Store.count()) +
        '</div>' +
        '<div class="hr"></div>' +
        '<p style="font-size:13px;color:var(--ink-2);margin:0 0 10px">选择导入方式。合并会按 id 去重，不会覆盖你现有的记录。</p>' +
        '<div class="seg" id="impMode" style="width:100%">' +
          '<button data-m="merge" class="is-on" style="flex:1">合并（推荐）</button>' +
          '<button data-m="replace" style="flex:1">覆盖现有数据</button>' +
        '</div>' +
        '<p class="hint" style="margin-top:10px">无论选哪种，导入前都会自动生成一份当前数据的快照，可在「存储与恢复」里回滚。</p>',
      okText: '开始导入',
      onOk: bd => {
        const mode = $('#impMode .is-on', bd)?.dataset.m || 'merge';
        this.applyImport(parsed, mode);
      },
      footer: ''
    });
    function mini(l, v){ return '<div class="stat" style="padding:11px 12px"><span>' + esc(l) + '</span><b style="font-size:22px">' + v + '</b></div>'; }
  },

  applyImport(p, mode){
    // 先做快照
    try { localStorage.setItem('lifehub.v1.preImport', JSON.stringify(Store.db)); } catch (e){}

    if (mode === 'replace'){
      Store.db = p;
      Store.db.demo = false;
      Store.save();
      toast('ok', '导入完成（覆盖）', '共 ' + Store.count() + ' 条记录已替换原有数据', 6000);
    } else {
      const byId = (arr) => new Map((arr || []).map(x => [x.id, x]));
      const mergeArr = (cur, inc) => {
        const m = byId(cur);
        let added = 0;
        (inc || []).forEach(x => { if (!m.has(x.id)){ m.set(x.id, x); added++; } });
        return { list: [...m.values()], added };
      };
      let added = 0;
      const n = mergeArr(Store.db.notes, p.notes); added += n.added;
      const mo = mergeArr(Store.db.money, p.money); added += mo.added;
      const td = mergeArr(Store.db.todo, p.todo); added += td.added;
      const hb = mergeArr(Store.db.habits, p.habits); added += hb.added;
      // 供应商合并 —— 分两类处理：
      //
      // ① 预置厂商（deepseek/mimo/moonshot/openrouter）：按 kind 去重。
      //    预置项每次安装都用随机 uid() 生成 id，换设备/清空后「合并」导入时，
      //    本地未配置的空壳与备份里已配置的同一厂商 id 不同 → 会被叠加，
      //    导致「还有 N 个供应商没填 Key」误报。规则：
      //      · 本地是未配置的空壳 → 用备份里已配置的替换
      //      · 本地已配置 → 保留现有，跳过备份项
      //
      // ② 自定义供应商（kind === 'custom' 或其它）：同样按「业务指纹」去重。
      //    自定义项也是随机 uid()，直接按 id 比对永远对不上 → 每次导入都会重复一份。
      //    指纹取「kind + base + name（归一化后）」：同一个接入地址+同名，视为同一项。
      //    命中时按「缺 Key 的让位、有 Key 的保留」处理，避免重复也不覆盖用户的密钥。
      const DEDUP_KINDS = ['deepseek', 'mimo', 'moonshot', 'openrouter'];
      const fp = x => [
        String(x.kind || 'custom').toLowerCase(),
        String(x.base || '').trim().replace(/\/+$/, '').toLowerCase(),
        String(x.name || '').trim().toLowerCase()
      ].join('|');
      const pv = (() => {
        const out = (Store.db.providers || []).slice();
        const isPre = x => DEDUP_KINDS.includes(x.kind);
        const curByKind = {}, curByFp = {};
        out.forEach(x => {
          if (isPre(x)) curByKind[x.kind] = x;
          else curByFp[fp(x)] = x;          // 自定义项建指纹索引
        });
        (p.providers || []).forEach(x => {
          if (isPre(x) && curByKind[x.kind]){
            const ex = curByKind[x.kind];
            // 本地是未配置的默认空壳 → 用备份里已配置的同一厂商替换，不再重复
            if (!ex.key){ const i = out.indexOf(ex); if (i >= 0) out[i] = x; }
            // 本地已配置 → 保留现有工作账户，跳过备份项（不重复、不覆盖）
            return;
          }
          // 自定义供应商：先按指纹查重
          const k = fp(x);
          const dup = !isPre(x) ? curByFp[k] : null;
          if (dup){
            // 同一接入点：本地没填 Key 而备份有 → 用备份补齐；否则保留本地
            if (!dup.key && x.key){
              const i = out.indexOf(dup);
              if (i >= 0){ out[i] = { ...dup, ...x }; curByFp[k] = out[i]; }
            }
            // 两边都有 Key 或都没有 → 视为同一条，跳过，避免重复
            return;
          }
          // 全新项 → 加入，并登记指纹，防止备份内部自身有重复
          out.push(x);
          if (!isPre(x)) curByFp[k] = x;
        });
        return { list: out };
      })();
      Store.mutate(db => {
        db.notes = n.list; db.money = mo.list; db.todo = td.list;
        db.habits = hb.list; db.providers = pv.list;
        // 习惯打卡日期取并集
        p.habits.forEach(ph => {
          const t = db.habits.find(x => x.id === ph.id);
          if (t){ t.days = [...new Set([...(t.days || []), ...(ph.days || [])])].sort(); }
        });
        db.demo = false;
      });
      toast('ok', '导入完成（合并）', '新增 ' + added + ' 条，去重后共 ' + Store.count() + ' 条', 6000);
    }
    Store.checkBackupHint();
    go(location.hash.replace('#/', '') || 'weather');
  },

  /** 损坏文件的修复界面 */
  _showBad(kind, reason, rawTxt, sourceName){
    modal({
      title: '无法直接导入这个文件',
      desc: kind + '：' + reason,
      wide: true,
      okText: '尝试自动修复',
      cancelText: '关闭',
      body:
        '<div style="padding:13px 15px;border-radius:12px;background:var(--danger-soft);color:var(--ink-2);font-size:13px;line-height:1.65">' +
          '<b style="color:var(--danger)">原因：</b>' + esc(reason) +
        '</div>' +
        '<p class="hint" style="margin-top:12px">自动修复会尝试：① 去掉首尾多余字符；② 修补常见的中文引号与尾随逗号；③ 只提取能识别的记录。</p>' +
        '<details style="margin-top:12px"><summary style="cursor:pointer;font-size:13px;color:var(--ink-3)">查看原始内容片段</summary>' +
        '<pre style="font-family:var(--f-num);font-size:11px;background:var(--surface-2);border:1px solid var(--line);border-radius:10px;padding:11px;overflow:auto;max-height:180px;margin-top:9px">' +
        esc(String(rawTxt).slice(0, 2500)) + '</pre></details>',
      onOk: () => {
        const fixed = this._repair(rawTxt);
        if (fixed){
          this.applyImport(fixed, 'merge');
        } else {
          toast('err', '修复失败', '这个文件的结构损坏比较严重，建议找到上一次的备份重新导入。', 8000);
        }
      }
    });
  },
  _repair(txt){
    let t = String(txt).trim();
    // 去 BOM 与常见包裹字符
    t = t.replace(/^\uFEFF/, '').replace(/^[^{[]*([{\[])/, '$1').replace(/([}\]])[^}\]`]*$/, '$1');
    // 全角引号 → 半角
    t = t.replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");
    // 尾随逗号
    t = t.replace(/,(\s*[}\]])/g, '$1');
    try { return Store.normalize(JSON.parse(t)); } catch (e){}
    // 最后一招：逐个提取对象数组
    const out = blankDB();
    out.demo = false;
    let got = false;
    ['notes', 'money', 'todo', 'habits', 'providers'].forEach(k => {
      const re = new RegExp('"' + k + '"\\s*:\\s*\\[([\\s\\S]*?)\\]\\s*[,}]', 'm');
      const m = t.match(re);
      if (!m) return;
      const items = [];
      let depth = 0, cur = '', inStr = false, esc2 = false;
      for (const ch of m[1]){
        if (esc2){ cur += ch; esc2 = false; continue; }
        if (ch === '\\'){ cur += ch; esc2 = true; continue; }
        if (ch === '"'){ inStr = !inStr; cur += ch; continue; }
        if (!inStr){
          if (ch === '{') depth++;
          if (ch === '}'){ depth--; }
        }
        cur += ch;
        if (!inStr && depth === 0 && ch === '}'){
          try { items.push(JSON.parse(cur)); } catch (e){}
          cur = '';
        }
      }
      if (items.length){
        try {
          const norm = Store.normalize({ [k]: items, settings: out.settings, providers: out.providers });
          out[k] = norm[k];
          got = true;
        } catch (e){}
      }
    });
    return got ? out : null;
  },

  /** 存储与恢复面板 */
  openPanel(){
    const u = Store.usage();
    const lastExp = Number(localStorage.getItem('lifehub.v1.lastExport') || 0);
    const hasBak = !!localStorage.getItem(LS_BAK);
    const hasPre = !!localStorage.getItem('lifehub.v1.preImport');
    const d = drawer({
      title: '存储与恢复',
      sub: '全部数据保存在本机浏览器中',
      body:
        '<div class="sect"><h4>当前用量</h4>' +
          '<div class="grid g-2" style="gap:10px">' +
            '<div class="stat" style="padding:12px"><span>记录总数</span><b style="font-size:23px">' + u.items + '</b></div>' +
            '<div class="stat" style="padding:12px"><span>占用空间</span><b style="font-size:23px">' + u.kb.toFixed(1) + '<small> KB</small></b></div>' +
          '</div>' +
          '<div style="margin-top:11px">' +
            '<div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--ink-4);margin-bottom:5px">' +
              '<span>浏览器 localStorage 通常上限约 5 MB</span><span class="num">' + (u.kb / 5120 * 100).toFixed(1) + '%</span></div>' +
            '<div class="pbar"><i style="width:' + clamp(u.kb / 5120 * 100, .5, 100) + '%;background:' + (u.kb > 3500 ? 'var(--danger)' : 'var(--sage)') + '"></i></div>' +
          '</div>' +
          '<p class="hint">上次导出：' + (lastExp ? esc(fmtAgo(lastExp)) : '从未导出过（建议现在就导一份）') + '</p>' +
          (u.items >= (Store.db.settings.backupHint || 20) ? '<p class="hint" style="color:var(--amber)">记录已超过 ' + (Store.db.settings.backupHint || 20) + ' 条，建议导出备份。</p>' : '') +
        '</div>' +

        '<div class="sect"><h4>导出</h4><div class="stack--sm" style="display:flex;flex-direction:column;gap:8px">' +
          '<button class="btn btn--primary btn--block" id="bkExp">' + ic('dl') + '导出全部数据（JSON）</button>' +
          '<p class="hint">包含笔记、收支、待办、习惯、供应商配置与偏好设置。不限条数，随时可以导入回来。</p>' +
        '</div></div>' +

        '<div class="sect"><h4>导入</h4><div class="stack--sm" style="display:flex;flex-direction:column;gap:8px">' +
          '<button class="btn btn--block" id="bkImp">' + ic('ul') + '从文件导入</button>' +
          '<button class="btn btn--block" id="bkPaste">' + ic('file') + '粘贴 JSON 导入</button>' +
          '<p class="hint">导入前会自动留一份快照，选错模式也能回滚。合并模式按 id 去重，不会覆盖现有内容。</p>' +
        '</div></div>' +

        '<div class="sect"><h4>恢复</h4><div class="stack--sm" style="display:flex;flex-direction:column;gap:8px">' +
          '<button class="btn btn--block"' + (hasBak ? '' : ' disabled') + ' id="bkRoll">' + ic('clock') + '回滚到上一次自动快照</button>' +
          '<button class="btn btn--block"' + (hasPre ? '' : ' disabled') + ' id="bkPre">' + ic('shield') + '撤销上一次导入</button>' +
          '<p class="hint">每次保存前，系统都会把上一份数据留在本地作为安全网。' + (hasBak ? '' : '（当前还没有可用快照）') + '</p>' +
        '</div></div>' +

        '<div class="sect"><h4>备份提醒</h4>' +
          '<div class="field"><label>每累计多少条提醒一次</label>' +
            '<select class="sel" id="bkHint">' +
              [10, 20, 30, 50, 100].map(v => '<option value="' + v + '"' + ((Store.db.settings.backupHint || 20) === v ? ' selected' : '') + '>' + v + ' 条</option>').join('') +
            '</select></div>' +
          '<p class="hint">每次新增记录达到这个数量时，会提醒你导出一份备份。</p>' +
        '</div>' +

        '<div class="sect"><h4>危险操作</h4><div class="stack--sm" style="display:flex;flex-direction:column;gap:8px">' +
          '<button class="btn btn--block" id="bkDemo">' + ic('spark') + '清空演示数据</button>' +
          '<button class="btn btn--danger btn--block" id="bkWipe">' + ic('trash') + '清空全部数据</button>' +
          '<p class="hint">清空前会先导出一份备份文件到你的下载目录，避免误操作。</p>' +
        '</div></div>',
      foot: '<button class="btn btn--primary btn--block" id="bkDone">完成</button>'
    });
    $('#bkDone', d.foot).onclick = () => d.close();   // 同上：显式绑，别只靠通用钩子
    $('#bkExp', d.body).onclick = () => this.exportAll();
    $('#bkImp', d.body).onclick = () => this.openImport();
    $('#bkPaste', d.body).onclick = () => this.openPaste();
    $('#bkRoll', d.body).onclick = () => {
      modal({ title:'回滚到上一次快照', desc:'当前数据将被替换为最近一次自动保存前的版本。', okText:'确认回滚', danger:true,
        onOk: () => {
          try {
            const b = localStorage.getItem(LS_BAK);
            if (!b) throw new Error('没有可用的快照');
            const n = Store.normalize(JSON.parse(b));
            const now = JSON.stringify(Store.db);
            localStorage.setItem(LS_MAIN, now);   // 先备份当前
            Store.db = n; Store.save();
            d.close(); go(location.hash.replace('#/','') || 'weather');
            toast('ok', '已回滚', '数据恢复到上一次快照的状态。', 5000);
          } catch (e){ toast('err', '回滚失败', e.message, 7000); }
        }});
    };
    $('#bkPre', d.body).onclick = () => {
      modal({ title:'撤销上一次导入', desc:'恢复到导入前的数据状态。', okText:'确认撤销', danger:true,
        onOk: () => {
          try {
            const p = localStorage.getItem('lifehub.v1.preImport');
            if (!p) throw new Error('没有可用的导入快照');
            Store.db = Store.normalize(JSON.parse(p));
            Store.save();
            d.close(); go(location.hash.replace('#/','') || 'weather');
            toast('ok', '已撤销导入');
          } catch (e){ toast('err', '撤销失败', e.message, 7000); }
        }});
    };
    $('#bkHint', d.body).onchange = e => {
      Store.mutate(db => { db.settings.backupHint = Number(e.target.value); });
      toast('ok', '提醒阈值已设为 ' + e.target.value + ' 条');
    };
    $('#bkDemo', d.body).onclick = () => {
      const hasDemo = Store.db.notes.some(n => ['本周想做的事','记账小心得','想读的书'].includes(n.title));
      if (!hasDemo && !Store.db.demo){ toast('warn', '演示数据已经清理过了'); return; }
      modal({ title:'清空演示数据', desc:'将移除预置的三条笔记、六笔收支、四条待办、三个习惯与三条饮品记录。你自己添加的内容不受影响。', okText:'清空', danger:true,
        onOk: () => {
          Store.mutate(db => {
            const demoTitles = ['本周想做的事','记账小心得','想读的书'];
            db.notes = db.notes.filter(n => !demoTitles.includes(n.title));
            const demoIds = Object.keys(Store._demoIds || {});
            db.money = db.money.filter(m => !(Store._demoIds?.money || []).includes(m.id));
            db.todo = db.todo.filter(t => !(Store._demoIds?.todo || []).includes(t.id));
            db.habits = db.habits.filter(h => !(Store._demoIds?.habits || []).includes(h.id));
            db.drinks = db.drinks.filter(x => !(Store._demoIds?.drinks || []).includes(x.id));
            db.demo = false;
          });
          d.close(); go(location.hash.replace('#/','') || 'weather');
          toast('ok', '演示数据已清空', '现在开始记录你自己的东西吧。');
        }});
    };
    $('#bkWipe', d.body).onclick = () => {
      modal({ title:'清空全部数据', desc:'所有笔记、收支、待办、习惯与供应商配置都会被删除。此操作不可撤销。', okText:'先导出备份，再清空', danger:true,
        onOk: () => {
          this.exportAll();
          setTimeout(() => {
            try { localStorage.removeItem(LS_MAIN); localStorage.removeItem(LS_BAK); localStorage.removeItem('lifehub.v1.preImport'); localStorage.removeItem('lifehub.v1.lastHint'); } catch(e){}
            Store.db = blankDB();
            Store._demoIds = { money: [], todo: [], habits: [] };
            Store.save();
            d.close(); go('weather');
            toast('ok', '已清空', '备份文件已下载到浏览器默认目录。', 6000);
          }, 500);
        }});
    };
  }
};

function download(name, text){
  try {
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1200);
  } catch (e){ toast('err', '导出失败', e.message); }
}

/* ==========================================================================
   9. 设置面板
   ========================================================================== */
function openSettings(){
  const st = Store.db.settings;
  const d = drawer({
    title: '设置',
    sub: '外观、备份与关于',
    body:
      '<div class="sect"><h4>外观</h4>' +
        '<div class="seg" id="stTheme" style="width:100%">' +
          ['auto','light','dark'].map(v => '<button data-v="' + v + '" class="' + (st.theme === v ? 'is-on' : '') + '" style="flex:1">' +
            ({ auto:'跟随系统', light:'浅色', dark:'深色' })[v] + '</button>').join('') +
        '</div>' +
        '<p class="hint">深色模式对夜间使用更友好，选择会一并保存。</p>' +
      '</div>' +

      '<div class="sect"><h4>首页</h4>' +
        '<div class="field"><label>启动时打开</label>' +
          '<select class="sel" id="stHome">' +
            VIEWS.map(v => '<option value="' + v.id + '"' + ((localStorage.getItem('lifehub.v1.home') || 'weather') === v.id ? ' selected' : '') + '>' + v.name + '</option>').join('') +
          '</select></div>' +
        '<p class="hint">下次打开页面时会直接进入这个模块。</p>' +
        '<button class="btn btn--block" id="stCommute" style="margin-top:9px">' + ic('clock') +
          '通勤天气' + (st.commute?.on ? ' · 已开启' : ' · 未开启') + '</button>' +
        '<label class="swrow" style="margin-top:14px">' +
          '<input type="checkbox" id="stHoliOn"' + (st.holiday?.on ? ' checked' : '') + '>' +
          '<span class="switch" aria-hidden="true"></span>' +
          '<span class="swrow__t">首页显示放假倒计时</span></label>' +
        '<div class="seg" id="stHoliType" style="width:100%;margin-top:10px">' +
          [['weekend','周末'],['tiaoxiu','调休放假'],['first','国家节假日首天']].map(([v, t]) =>
            '<button data-v="' + v + '" class="' + ((st.holiday?.type || 'weekend') === v ? 'is-on' : '') + '" style="flex:1">' + t + '</button>').join('') +
        '</div>' +
        '<p class="hint">倒计时目标：周末 / 调休放假（法定连休，不含普通周末）/ 国家节假日首天。</p>' +
      '</div>' +

      '<div class="sect"><h4>默认 AI</h4>' +
        '<p class="hint" style="margin:-2px 0 10px">饮品查值、摘要等「只需要一个模型」的功能都走这里。多模型交叉对比不受影响。</p>' +
        (AI.all.length
          ? '<div class="aipick aipick--col" id="stAI">' +
              AI.all.map(p => {
                // 没填 Key 的项也给出来，但标记为不可选 —— 让用户看得见「还差什么」，
                // 比直接藏起来更好，否则他会疑惑「我明明配过为什么列表里没有」。
                const usable = !!p.key;
                const on = AI.pickDefault()?.id === p.id;
                return '<button data-p="' + escAttr(p.id) + '"' + (usable ? '' : ' disabled') +
                  ' class="' + (on ? 'is-on' : '') + '">' +
                  '<i style="background:' + escAttr(p.color) + '"></i>' +
                  '<span class="aipick__tx"><b>' + esc(p.name) + '</b>' +
                  '<small>' + esc(usable ? (p.models?.[0] || '未指定模型') : '未填 API Key') + '</small></span>' +
                  (on ? '<span class="aipick__cur">当前</span>' : '') +
                '</button>';
              }).join('') +
            '</div>'
          : '<div class="empty" style="padding:22px 14px">' + ic('key') +
            '<p>还没有供应商</p><small>先在「AI 余额」里加一个，填上 API Key。</small></div>') +
      '</div>' +

      '<div class="sect"><h4>数据</h4><div class="stack--sm" style="display:flex;flex-direction:column;gap:8px">' +
        '<button class="btn btn--primary btn--block" id="stExp">' + ic('dl') + '导出备份</button>' +
        '<button class="btn btn--block" id="stImp">' + ic('ul') + '导入备份</button>' +
        '<button class="btn btn--block" id="stPanel">' + ic('shield') + '存储与恢复</button>' +
      '</div></div>' +

      '<div class="sect"><h4>隐私</h4>' +
        '<div class="stPrivacy" style="padding:13px 15px;border-radius:12px;background:var(--sage-soft);font-size:13px;line-height:1.65;color:var(--ink-2)">' +
          ic('shield', 'noteIc') + ' <b style="color:var(--sage)">数据不出本机。</b><br>' +
          '所有记录都保存在这个浏览器的 localStorage 中，不上传服务器，也没有账号体系。' +
          'API Key 同样只存在本机，仅在与对应厂商接口通信时使用。' +
          '清除浏览器数据会导致记录丢失，请定期导出备份。' +
        '</div>' +
      '</div>' +

      '<div class="sect"><h4>数据来源</h4>' +
        '<ul style="margin:0;padding-left:17px;font-size:13px;line-height:1.9;color:var(--ink-3)">' +
          '<li>天气：wttr.in（主）、open-meteo（备）</li>' +
          '<li>定位：ipapi.co / ipwho.is / ip-api.com / ipinfo.io</li>' +
          '<li>城市搜索：open-meteo 地理编码</li>' +
          '<li>新闻热榜：60s API（开源公开接口，多实例自动降级）</li>' +
          '<li>AI 总结与余额：你配置的厂商官方接口</li>' +
        '</ul>' +
        '<p class="hint">这些服务均为第三方公开接口，可用性不由本工具保证。</p>' +
      '</div>' +

      '<div class="sect"><h4>关于</h4>' +
        '<div class="row row--mid" style="gap:11px">' +
          '<div class="rail__logo" style="margin:0;width:44px;height:44px;font-size:19px;border-radius:12px">日</div>' +
          '<div><b style="font-size:14.5px">' + esc(APP_NAME) + '</b>' +
          '<div class="tiny muted">多文件模块化 · 无外部依赖 · 本地存储</div></div>' +
          '<span class="tag tag--accent" style="margin-left:auto;flex:none">v' + esc(APP_VER) + '</span>' +
        '</div>' +
        '<div class="kv" style="margin-top:12px">' +
          '<div><span>应用版本</span><b>v' + esc(APP_VER) + '</b></div>' +
          '<div><span>构建日期</span><b>' + esc(APP_BUILD) + '</b></div>' +
          '<div><span>数据架构</span><b>v' + esc(SCHEMA) + '</b></div>' +
          '<div><span>创建于</span><b>' + esc(new Date(Store.db.createdAt).toLocaleDateString('zh-CN')) + '</b></div>' +
          '<div><span>记录条数</span><b>' + Store.count() + ' 条</b></div>' +
          '<div><span>占用空间</span><b>' + Store.usage().kb.toFixed(1) + ' KB</b></div>' +
        '</div>' +
        '<div class="row" style="margin-top:12px;gap:10px"><button class="btn btn--ghost" id="stUpdate" style="flex:1">检查更新</button></div>' +
        '<p class="hint" style="margin-top:10px">应用版本随每次功能更新递增；数据架构版本只在存储结构变化时变动，用于兼容老数据。</p>' +
      '</div>',
    // 关闭后若首页正在显示，刷新放假倒计时卡片（设置里改了开关/类型，需立即反映）
    onClose: () => { if (CUR === 'weather') renderHolidayCountdown(); }
  });
  $$('#stTheme button', d.body).forEach(b => b.onclick = () => {
    st.theme = b.dataset.v; Store.save(); applyTheme();
    $$('#stTheme button', d.body).forEach(x => x.classList.toggle('is-on', x === b));
    toast('ok', '主题：' + ({ auto:'跟随系统', light:'浅色', dark:'深色' })[b.dataset.v]);
  });
  $('#stHome', d.body).onchange = e => {
    try { localStorage.setItem('lifehub.v1.home', e.target.value); } catch(err){}
    toast('ok', '启动页面已设为「' + VIEWS.find(v => v.id === e.target.value).name + '」');
  };
  // 默认 AI：点选即存。重绘整个分组，保证「当前」徽标与 is-on 状态同步。
  $$('#stAI button', d.body).forEach(b => b.onclick = () => {
    const p = AI.get(b.dataset.p);
    if (!p || !p.key) return;
    Store.db.settings.defaultAI = p.id;
    Store.save();
    $$('#stAI button', d.body).forEach(x => {
      const cur = AI.pickDefault()?.id === x.dataset.p;
      x.classList.toggle('is-on', cur);
      // 徽标是动态文本，直接增删比在 HTML 里预留占位更省事
      const old = $('.aipick__cur', x);
      if (cur && !old) x.insertAdjacentHTML('beforeend', '<span class="aipick__cur">当前</span>');
      if (!cur && old) old.remove();
    });
    toast('ok', '默认 AI 已设为 ' + p.name, '模型：' + (p.models?.[0] || '未指定'));
  });
  $('#stExp', d.body).onclick = () => Backup.exportAll();  $('#stImp', d.body).onclick = () => Backup.openImport();
  $('#stPanel', d.body).onclick = () => { d.close(); setTimeout(() => Backup.openPanel(), 260); };
  $('#stUpdate', d.body).onclick = checkUpdate;
  // 通勤设置：先关掉当前抽屉再打开，避免两层抽屉叠在一起
  $('#stCommute', d.body).onclick = () => { d.close(); setTimeout(() => openCommuteSettings(), 260); };
  // 放假倒计时：开关 + 类型
  const holiOnBox = $('#stHoliOn', d.body);
  const syncHoliSw = () => holiOnBox.closest('.swrow')?.querySelector('.switch')?.classList.toggle('is-on', holiOnBox.checked);
  holiOnBox.onchange = () => {
    syncHoliSw();
    Store.mutate(db => { db.settings.holiday.on = holiOnBox.checked; });
    toast('ok', holiOnBox.checked ? '已开启放假倒计时' : '已关闭放假倒计时');
  };
  syncHoliSw();
  $$('#stHoliType button', d.body).forEach(b => b.onclick = () => {
    Store.mutate(db => { db.settings.holiday.type = b.dataset.v; });
    $$('#stHoliType button', d.body).forEach(x => x.classList.toggle('is-on', x === b));
    toast('ok', '倒计时目标：' + Holiday.label(b.dataset.v));
  });
}

function applyTheme(){
  const t = Store.db?.settings?.theme || 'auto';
  const dark = t === 'dark' || (t === 'auto' && matchMedia('(prefers-color-scheme:dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const mt = document.querySelector('meta[name="theme-color"]');
  if (mt) mt.setAttribute('content', dark ? '#17181a' : '#f6f3ee');
}

/* ==========================================================================
   10. 路由 / 导航 / 顶栏
   ========================================================================== */
const VIEWS = [
  { id:'weather', name:'今日',   icon:'home',   sub:'天气与生活提示', render:() => renderWeather() },
  { id:'balance', name:'AI 余额', icon:'wallet', sub:'供应商账户与用量', render:() => renderBalance() },
  { id:'news',    name:'热榜',   icon:'news',   sub:'今日资讯与 AI 摘要', render:() => renderNews() },
  { id:'notes',   name:'笔记',   icon:'file',   sub:'随手记下的想法', render:() => renderNotes() },
  { id:'money',   name:'收支',   icon:'barchart',sub:'记账与消费结构', render:() => renderMoney() },
  { id:'todo',    name:'待办',   icon:'list',   sub:'要做的事与截止日期', render:() => renderTodo() },
  { id:'habits',  name:'习惯',   icon:'jar',    sub:'每天坚持的一点小事', render:() => renderHabits() },
  { id:'drinks',  name:'饮品',   icon:'cup',    sub:'咖啡因 · 糖 · 热量', render:() => renderDrinks() }
];
let CUR = '';

function buildNav(){
  // logo 右下角挂一个版本徽标：PC 侧边栏和手机底部栏都能看到，一眼知道跑的是哪一版
  const logo = $('#rail .rail__logo');
  if (logo){
    logo.innerHTML = '日<span class="rail__ver">v' + APP_VER + '</span>';
    logo.title = APP_NAME + ' · 版本 v' + APP_VER;
  }
  $('#railNav').innerHTML = VIEWS.map(v =>
    '<button class="navbtn" data-v="' + v.id + '" title="' + esc(v.name) + '">' + ic(v.icon) + '<span>' + esc(v.name) + '</span></button>').join('');

  /* ---- 手机端菜单抽屉（与侧栏同源，一份数据两处渲染） ---- */
  const ml = $('#mNavList');
  if (ml){
    ml.innerHTML = VIEWS.map(v =>
      '<button class="mitem" data-mv="' + v.id + '">' + ic(v.icon) +
        '<span class="mitem__tx"><b>' + esc(v.name) + '</b><small>' + esc(v.sub) + '</small></span>' +
      '</button>').join('');
    $$('[data-mv]', ml).forEach(b => b.onclick = () => { closeMenu(); go(b.dataset.mv); });
  }
  const mf = $('#mNavFoot');
  if (mf){
    mf.innerHTML =
      '<button class="mtool" data-mact="theme" title="切换深浅色">' + ic('sun') + '<span>深浅色</span></button>' +
      '<button class="mtool" data-mact="backup" title="备份与导出">' + ic('shield') + '<span>备份</span></button>' +
      '<button class="mtool" data-mact="settings" title="设置">' + ic('gear') + '<span>设置</span></button>';
  }
  const mv = $('#mNavVer'); if (mv) mv.textContent = 'v' + APP_VER;
  if ($('#menuLabel')) $('#menuLabel').textContent = (VIEWS.find(v => v.id === CUR) || VIEWS[0]).name;

  $('#railFoot').innerHTML =
    // 宽高交给 .rail__foot .navbtn（46×44，与导航按钮一致），不写内联 style ——
    // 内联优先级最高，CSS 想统一调整时永远打不过它。
    '<button class="btn btn--ghost btn--icon btn--sm navbtn" data-act="theme" title="切换深浅色">' + ic('sun') + '</button>' +
    '<button class="btn btn--ghost btn--icon btn--sm navbtn" data-act="backup" title="备份与导出">' + ic('shield') + '</button>' +
    '<button class="btn btn--ghost btn--icon btn--sm navbtn" data-act="settings" title="设置">' + ic('gear') + '</button>';
  $$('[data-v]').forEach(b => b.onclick = () => go(b.dataset.v));
  const doAct = act => {
    if (act === 'settings') openSettings();
    else if (act === 'backup') Backup.openPanel();
    else {
      const cur = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      Store.db.settings.theme = cur; Store.save(); applyTheme();
      toast('ok', cur === 'dark' ? '已切到深色' : '已切到浅色', '', 1800);
    }
  };
  $$('[data-act]').forEach(b => b.onclick = () => doAct(b.dataset.act));
  $$('[data-mact]').forEach(b => b.onclick = () => { closeMenu(); doAct(b.dataset.mact); });

  // 菜单开关：按钮 / 关闭按钮 / 遮罩 / Esc
  const bm = $('#btnMenu'), mn = $('#mNav'), sc = $('#mScrim');
  if (bm) bm.onclick = openMenu;
  if ($('#mNavX')) $('#mNavX').onclick = closeMenu;
  if (sc) sc.onclick = closeMenu;
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
}

function openMenu(){
  const mn = $('#mNav'), sc = $('#mScrim'), bm = $('#btnMenu');
  if (!mn) return;
  mn.classList.add('is-on'); sc.classList.add('is-on');
  document.body.classList.add('mnav-open');
  if (bm) bm.setAttribute('aria-expanded', 'true');
}
function closeMenu(){
  const mn = $('#mNav'), sc = $('#mScrim'), bm = $('#btnMenu');
  if (!mn || !mn.classList.contains('is-on')) return;
  mn.classList.remove('is-on'); sc.classList.remove('is-on');
  document.body.classList.remove('mnav-open');
  if (bm) bm.setAttribute('aria-expanded', 'false');
}

function go(id){
  if (!VIEWS.find(v => v.id === id)) id = 'weather';
  CUR = id;
  const v = VIEWS.find(x => x.id === id);
  $$('[data-v]').forEach(b => b.classList.toggle('is-on', b.dataset.v === id));
  $$('[data-mv]').forEach(b => b.classList.toggle('is-on', b.dataset.mv === id));
  const mlb = $('#menuLabel'); if (mlb) mlb.textContent = v.name;
  $('#ttl').innerHTML = esc(v.name) + '<em>' + esc(greeting()) + '</em>';
  $('#sub').innerHTML = esc(v.sub) + '<span class="topbar__ver" title="' + escAttr(APP_NAME) + ' · 构建于 ' + escAttr(APP_BUILD) + '">v' + esc(APP_VER) + '</span>';
  WxCanvas.stop();
  location.hash = '#/' + id;
  v.render();
  renderTopActs(id);
}
function greeting(){
  const h = new Date().getHours();
  if (h < 6) return '夜深了，早点休息';
  if (h < 9) return '早上好，新的一天';
  if (h < 12) return '上午好，慢慢来';
  if (h < 14) return '中午好，记得吃饭';
  if (h < 18) return '下午好，喝口水';
  if (h < 22) return '晚上好';
  return '夜深了，别太累';
}
function renderTopActs(id){
  const box = $('#acts');
  const u = Store.usage();
  box.innerHTML =
    '<span class="tag tiny" style="display:none" id="tagUsage">' + u.items + ' 条 · ' + u.kb.toFixed(1) + 'KB</span>' +
    '<button class="btn btn--sm" id="actBak">' + ic('save') + '<span class="hide-sm">备份</span></button>' +
    '<button class="btn btn--sm btn--icon" id="actGear" title="设置">' + ic('gear') + '</button>';
  const su = $('#tagUsage');
  if (su && innerWidth > 900) su.style.display = '';
  $('#actBak').onclick = () => Backup.openPanel();
  $('#actGear').onclick = () => openSettings();
}

/* ==========================================================================
   11. 启动
   ========================================================================== */
function boot(){
  // 存储加载 + 损坏处理
  Store.load();
  applyTheme();

  // 记录演示数据 id，便于「清空演示数据」精确移除
  if (Store.db.demo){
    const demo = seedDemo();
    const existed = Store.db.notes.length || Store.db.money.length || Store.db.todo.length || Store.db.habits.length || Store.db.drinks.length || Store.db.providers.some(p => p.key);
    if (!existed){
      Store.db.notes = demo.notes;
      Store.db.money = demo.money;
      Store.db.todo = demo.todo;
      Store.db.habits = demo.habits;
      Store.db.drinks = demo.drinks;
      Store._demoIds = {
        money: demo.money.map(x => x.id),
        todo: demo.todo.map(x => x.id),
        habits: demo.habits.map(x => x.id),
        drinks: demo.drinks.map(x => x.id)
      };
      Store.save();
    } else {
      Store._demoIds = { money: [], todo: [], habits: [], drinks: [] };
    }
  } else {
    Store._demoIds = { money: [], todo: [], habits: [], drinks: [] };
  }

  // 数据损坏 / 恢复提示（读取加载阶段的快照，避免被后续 save 覆盖）
  const issue = Store._loadIssue;
  if (issue && issue.kind === 'corrupt'){
    setTimeout(() => {
      toast('err', issue.recovered ? '本地数据损坏，已从快照恢复' : '本地数据损坏，已重置',
        issue.reason + (issue.recovered
          ? ' 已自动回滚到最近一次完好的快照，请检查内容是否完整。'
          : ' 没有找到可用快照，已重置为初始状态。建议尽快导入之前的备份。'), 0, [
        { text: '去导入备份', fn: () => Backup.openImport() },
        { text: '存储与恢复', fn: () => Backup.openPanel() },
        { text: '我知道了', fn: () => {} }
      ]);
    }, 600);
  } else if (issue && issue.kind === 'repaired'){
    setTimeout(() => toast('warn', '数据已自动修复', issue.reason + ' 现有记录不受影响。', 8000, [
      { text: '存储与恢复', fn: () => Backup.openPanel() }
    ]), 600);
  } else if (Store._recoveredFrom === 'bak'){
    setTimeout(() => toast('warn', '已从快照恢复', '上次的数据写入似乎中断了，已回滚到最近的完好状态。', 8000, [
      { text: '查看详情', fn: () => Backup.openPanel() }
    ]), 600);
  }

  buildNav();

  // 主题跟随系统变化
  matchMedia('(prefers-color-scheme:dark)').addEventListener?.('change', () => {
    if ((Store.db.settings.theme || 'auto') === 'auto') applyTheme();
  });

  // 路由
  window.addEventListener('hashchange', () => {
    const id = location.hash.replace('#/', '') || (localStorage.getItem('lifehub.v1.home') || 'weather');
    if (id !== CUR) go(id);
  });

  // 窗口变化：重绘天气画布
  window.addEventListener('resize', debounce(() => {
    const cv = $('#wxCv');
    if (cv) WxCanvas.resize(cv);
  }, 250));

  // 数据变更 → 同步顶栏用量
  Store.onChange = () => {
    const u = Store.usage();
    const t = $('#tagUsage');
    if (t) t.textContent = u.items + ' 条 · ' + u.kb.toFixed(1) + 'KB';
  };

  // 全局快捷键
  document.addEventListener('keydown', e => {
    if (e.target.matches('input,textarea,select')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const map = { '1':'weather','2':'balance','3':'news','4':'notes','5':'money','6':'todo','7':'habits' };
    if (map[e.key]){ go(map[e.key]); return; }
    if (e.key === 'b' || e.key === 'B'){ Backup.openPanel(); }
    if (e.key === 'r' || e.key === 'R'){ if (CUR === 'weather') renderWeather(); else if (CUR === 'news') News.fetchAll(); }
  });

  // 页面隐藏时强制落盘一次
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') Store.save();
  });
  window.addEventListener('beforeunload', () => Store.save());

  // 首次进入引导
  const started = localStorage.getItem('lifehub.v1.started');
  const id = location.hash.replace('#/', '') || (localStorage.getItem('lifehub.v1.home') || 'weather');
  go(id);

  if (!started){
    try { localStorage.setItem('lifehub.v1.started', '1'); } catch(e){}
    setTimeout(() => showHello(), 700);
  }

  // 预取天气（已保存城市，静默）
  setTimeout(() => {
    if (CUR !== 'weather' && Store.db.settings.city) {
      Weather.fetch(Store.db.settings.city, true).then(d => {
        Store.db.settings.lastWeather = { data: d, at: Date.now() }; Store.save();
      }).catch(() => {});
    }
  }, 2600);

  // 备份提醒检查
  setTimeout(() => Store.checkBackupHint(), 1800);
}

function showHello(){
  modal({
    title: '欢迎用上「日常」',
    desc: '一个装自己生活的小台子，所有数据都留在这台设备上。',
    wide: true,
    okText: '开始使用',
    cancelText: '',
    body:
      '<div class="stack">' +
        '<div style="display:grid;gap:9px">' +
          item('loc', '天气', '默认按网络定位显示当前城市，也可以手动搜索切换。数据来自公开免费接口。') +
          item('wallet', 'AI 余额', '已预置 DeepSeek、Xiaomi MiMo、Moonshot，填入 API Key 即可查余额；自定义项可填任意 OpenAI 兼容地址。') +
          item('news', '热榜与 AI 摘要', '可同时抓取多个平台的榜单，再让模型帮你读成摘要，支持多个模型交叉对比。') +
          item('file', '笔记 · 收支 · 待办 · 习惯', '输入即保存，关闭页面也不会丢。每满 20 条会提醒你备份一次。') +
        '</div>' +
        '<div class="hello__warn" style="padding:12px 14px;border-radius:12px;background:var(--amber-soft);font-size:12.5px;line-height:1.65;color:var(--ink-2)">' +
          ic('warn', 'noteIc') + ' 数据存在浏览器里，清理浏览器数据会一并清掉。<b>记得偶尔导出备份</b>，在左侧「备份」里可以随时导出。' +
        '</div>' +
        '<p class="tiny muted" style="margin:0">当前是演示状态，已经预置了几条示例记录，可以在「备份 → 清空演示数据」里一键移除。</p>' +
      '</div>'
  });
  function item(i, t, s2){
    return '<div style="display:flex;gap:11px;align-items:flex-start">' +
      '<div class="hello__feat">' +
      ic(i) + '</div><div><b style="font-size:13.5px">' + esc(t) + '</b>' +
      '<div class="tiny" style="color:var(--ink-3);line-height:1.6">' + esc(s2) + '</div></div></div>';
  }
}


// 启动入口交给 loader 统一调度（多文件渐进加载）
window.__LIFEHUB_BOOT__ = boot;

/* ==========================================================================
   11. 手动检测更新
   ========================================================================== */
function parseVer(s){ return String(s || '').split('.').map(n => parseInt(n, 10) || 0); }
function cmpVer(a, b){
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++){
    const x = a[i] || 0, y = b[i] || 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}
async function checkUpdate(){
  const btn = document.getElementById('stUpdate');
  if (btn){ btn.disabled = true; btn.textContent = '检测中…'; }
  try {
    const res = await fetch('version.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const d = await res.json();
    if (!d || !d.ver) throw new Error('清单格式异常');
    if (cmpVer(parseVer(APP_VER), parseVer(d.ver)) < 0){
      const target = d.url || '';
      // 「立即更新」= 在当前站点强制拉取最新 Service Worker 并刷新。
      // 关键：用户数据都在 localStorage，刷新/清 SW 缓存都不会动它 —— 这就是「不清数据也能更新」。
      const forceUpdate = () => {
        if (typeof window.__LIFEHUB_FORCE_UPDATE__ === 'function') window.__LIFEHUB_FORCE_UPDATE__();
        else location.reload();
      };
      // 「前往新地址」= 站点迁移场景（如搬到 GitHub Pages）
      const gotoNew = () => { if (target) location.href = target; else forceUpdate(); };
      const actions = [{ text: '立即更新', fn: forceUpdate }];
      if (target) actions.push({ text: '前往新地址', fn: gotoNew });
      toast('ok', '发现新版本 v' + d.ver, (d.note || '点「立即更新」拉取最新（数据不会丢）'), 12000, actions);
      // 不再自动跳转，避免打断用户；由用户点按钮决定。
    } else {
      toast('ok', '已是最新版本 v' + APP_VER, '', 2600);
    }
  } catch (e){
    toast('warn', '无法检测更新', (e && e.message) ? e.message : '请联网后打开在线版', 3600);
  } finally {
    if (btn){ btn.disabled = false; btn.textContent = '检查更新'; }
  }
}
