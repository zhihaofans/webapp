/* ------------------------------ 笔记 ------------------------------ */
function renderNotes(){
  const box = $('#view');
  const ns = (Store.db.notes || []).slice().sort((a, b) => (b.pin ? 1 : 0) - (a.pin ? 1 : 0) || b.updatedAt - a.updatedAt);
  const allTags = [...new Set(ns.flatMap(n => n.tags || []))];
  const COLORS = { '':'var(--line-2)', accent:'var(--accent)', sage:'var(--sage)', amber:'var(--amber)', plum:'var(--plum)', sky:'var(--sky)' };

  box.innerHTML =
    '<div class="row row--mid" style="margin-bottom:14px">' +
      '<input class="inp" id="nSearch" placeholder="搜索标题、正文或标签…" style="max-width:300px">' +
      '<div style="flex:1"></div>' +
      (allTags.length ? '<div class="seg" id="nTag"><button data-t="" class="is-on">全部</button>' +
        allTags.map(t => '<button data-t="' + escAttr(t) + '">' + esc(t) + '</button>').join('') + '</div>' : '') +
      '<button class="btn btn--primary" id="nAdd">' + ic('plus') + '新建笔记</button>' +
    '</div>' +
    '<div class="grid g-auto" id="nGrid"></div>';

  let flt = '', tag = '';
  const draw = () => {
    let list = ns;
    if (tag) list = list.filter(n => (n.tags || []).includes(tag));
    if (flt) {
      const q = flt.toLowerCase();
      list = list.filter(n => (n.title + ' ' + n.body + ' ' + (n.tags || []).join(' ')).toLowerCase().includes(q));
    }
    const g = $('#nGrid');
    if (!list.length){
      g.innerHTML = '<div class="empty" style="grid-column:1/-1">' + ic('file') +
        '<p>' + (ns.length ? '没有匹配的笔记' : '还没有笔记') + '</p>' +
        '<small>' + (ns.length ? '换个关键词，或清空筛选条件。' : '随手记下想法、清单、灵感，都存在本机。') + '</small>' +
        (ns.length ? '' : '<div style="margin-top:14px"><button class="btn btn--primary" id="nAdd2">' + ic('plus') + '写第一条</button></div>') + '</div>';
      $('#nAdd2')?.addEventListener('click', () => openNoteEditor());
      return;
    }
    g.innerHTML = list.map(n =>
      '<article class="card" data-id="' + escAttr(n.id) + '" style="cursor:pointer;position:relative">' +
        (n.color ? '<div style="position:absolute;left:0;top:0;bottom:0;width:3px;background:' + (COLORS[n.color] || 'var(--accent)') + '"></div>' : '') +
        '<div class="card__bd" style="padding:15px 16px">' +
          '<div style="display:flex;align-items:flex-start;gap:8px;margin-bottom:6px">' +
            (n.pin ? '<span style="color:var(--accent);flex:none;margin-top:1px">' + ic('star') + '</span>' : '') +
            '<h4 style="margin:0;font-size:15px;font-weight:600;letter-spacing:-.01em;flex:1;line-height:1.4;word-break:break-word">' + esc(n.title) + '</h4>' +
          '</div>' +
          '<p style="margin:0;font-size:13px;color:var(--ink-3);line-height:1.65;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;white-space:pre-wrap">' +
            esc(n.body || '（空白笔记）') + '</p>' +
          '<div style="display:flex;align-items:center;gap:6px;margin-top:11px;flex-wrap:wrap">' +
            (n.tags || []).slice(0, 3).map(t => '<span class="tag">' + esc(t) + '</span>').join('') +
            '<span class="tiny muted" style="margin-left:auto">' + esc(fmtAgo(n.updatedAt)) + '</span>' +
          '</div>' +
        '</div>' +
      '</article>').join('');
    $$('#nGrid article').forEach(a => a.onclick = e => {
      if (e.target.closest('button')) return;
      openNoteEditor(a.dataset.id);
    });
  };
  draw();
  const deb = debounce(() => { flt = $('#nSearch').value.trim(); draw(); }, 180);
  $('#nSearch').addEventListener('input', deb);
  $('#nTag') && $$('#nTag button').forEach(b => b.onclick = () => {
    tag = b.dataset.t;
    $$('#nTag button').forEach(x => x.classList.toggle('is-on', x === b));
    draw();
  });
  $('#nAdd').onclick = () => openNoteEditor();
}

function openNoteEditor(id){
  // 新建时 editing 为 null；首次落盘后会把新记录写回 editing / createdId，
  // 否则每次输入都会走「新增」分支，产生重复笔记。
  let editing = id ? Store.db.notes.find(n => n.id === id) : null;
  let createdId = null;
  let deleted = false;
  const getNote = () => Store.db.notes.find(n => n.id === (createdId || editing?.id));
  const isBlank = () => {
    const t = ($('#neT', d.body)?.value || '').trim();
    const b = ($('#neB', d.body)?.value || '').trim();
    return !t && !b;
  };
  let color = editing?.color || '';
  const COLORS = { '':'默认', accent:'赤陶', sage:'苔绿', amber:'琥珀', plum:'梅紫', sky:'雾蓝' };
  const body =
    '<div class="stack">' +
      '<input class="inp" id="neT" placeholder="标题" value="' + escAttr(editing?.title || '') + '" style="height:42px;font-size:16px;font-weight:600">' +
      '<textarea class="ta" id="neB" placeholder="写点什么…" style="min-height:210px;font-size:14px">' + esc(editing?.body || '') + '</textarea>' +
      '<div class="field"><label for="neTags">标签（逗号分隔）</label>' +
        '<input class="inp" id="neTags" value="' + escAttr((editing?.tags || []).join(', ')) + '" placeholder="生活, 灵感"></div>' +
      '<div class="field"><label>标记色</label><div class="quickcities" id="neColor">' +
        Object.entries(COLORS).map(([k, v]) => '<button data-c="' + k + '" class="' + (color === k ? 'is-on' : '') + '"' +
          (color === k ? ' style="background:var(--accent);border-color:var(--accent);color:#fff"' : '') + '>' + v + '</button>').join('') +
      '</div></div>' +
      '<div class="row row--tight">' +
        '<button class="btn btn--sm" id="nePin">' + ic('star') + (editing?.pin ? '取消置顶' : '置顶') + '</button>' +
        (editing ? '<button class="btn btn--sm btn--danger" id="neDel">' + ic('trash') + '删除</button>' : '') +
      '</div>' +
      '<p class="tiny muted">输入即保存，关闭页面也不会丢。</p>' +
    '</div>';
  const d = drawer({ title: editing ? '编辑笔记' : '新建笔记', side: 'r', body });
  let pin = editing?.pin || false;
  const pinBtn = $('#nePin', d.body);
  pinBtn.onclick = () => {
    pin = !pin;
    pinBtn.innerHTML = ic('star') + (pin ? '取消置顶' : '置顶');
    pinBtn.classList.toggle('btn--primary', pin);
    save();
  };
  $$('#neColor button', d.body).forEach(b => b.onclick = () => {
    color = b.dataset.c;
    $$('#neColor button', d.body).forEach(x => {
      const on = x === b;
      x.classList.toggle('is-on', on);
      x.style.background = on ? 'var(--accent)' : '';
      x.style.borderColor = on ? 'var(--accent)' : '';
      x.style.color = on ? '#fff' : '';
    });
    save();
  });
  const onDelete = () => {
    const cur = getNote();
    const shown = ($('#neT', d.body)?.value || '').trim();
    modal({ title:'删除笔记', desc:'「' + (cur?.title || shown || '无标题') + '」将被永久删除。', okText:'删除', danger:true,
      onOk: () => {
        const delId = createdId || editing?.id;
        Store.mutate(db => { db.notes = db.notes.filter(n => n.id !== delId); });
        // 标记为已删除，防止 onClose 里的 save() 把它重新写回来
        createdId = null; editing = null; deleted = true;
        d.close(); toast('ok', '笔记已删除');
      }});
  };
  $('#neDel')?.addEventListener('click', onDelete);

  /** 输入即存 —— 同一编辑器实例最多只新建一条记录 */
  const save = () => {
    const title = $('#neT', d.body).value.trim();
    const txt = $('#neB', d.body).value;
    const tags = $('#neTags', d.body).value.split(/[,，、\s]+/).map(s => s.trim()).filter(Boolean).slice(0, 8);
    const cur = createdId || editing?.id || null;
    // 从未落盘过、且内容还是空的 → 不建记录（避免打开编辑器就产生空笔记）
    if (!cur && !title && !txt.trim()) return;
    let newId = null;
    Store.mutate(db => {
      const exist = cur ? db.notes.find(x => x.id === cur) : null;
      if (exist){
        Object.assign(exist, { title: title || '无标题', body: txt, tags, pin, color, updatedAt: Date.now() });
      } else {
        newId = uid();
        db.notes.push({ id: newId, title: title || '无标题', body: txt, tags, pin, color,
          createdAt: Date.now(), updatedAt: Date.now() });
        db.demo = false;
      }
    });
    // 记下新 id，后续所有输入/关闭都走「更新」分支，杜绝重复
    if (newId){
      createdId = newId; editing = Store.db.notes.find(x => x.id === newId) || editing;
      // 首次落盘后补上「删除」入口，并同步抽屉标题（否则新建的笔记本轮无法删除）
      const hd = d.el.querySelector('.drawer__hd h2');
      if (hd) hd.childNodes[0].nodeValue = '编辑笔记';
      if (!$('#neDel', d.body)){
        const del = document.createElement('button');
        del.className = 'btn btn--sm btn--danger'; del.id = 'neDel';
        del.innerHTML = ic('trash') + '删除';
        $('#nePin', d.body)?.parentElement?.appendChild(del);
        del.addEventListener('click', onDelete);
      }
    }
    if (d.foot){
      const st = d.foot.querySelector('#neSaved') || (() => {
        const s = document.createElement('span');
        s.id = 'neSaved'; s.className = 'tiny muted'; s.style.alignSelf = 'center';
        d.foot.prepend(s); return s;
      })();
      st.textContent = '已保存 · ' + fmtTime(Date.now());
    }
  };
  const debSave = debounce(save, 320);
  ['#neT', '#neB', '#neTags'].forEach(s => {
    $(s, d.body).addEventListener('input', () => { debSave(); });
  });
  // 关闭编辑器时刷新列表。用 onClose 而不是改写 d.close ——
  // 抽屉的 × / 遮罩 / Esc 都绑定内部 close，改写属性对它们无效。
  d.onClose = () => {
    if (deleted) { renderNotes(); return; }
    if (isBlank()) { renderNotes(); return; }   // 没写任何东西就不落盘
    save();                                      // 同一实例只会更新，不会再新增
    renderNotes();
  };
  if (!editing) setTimeout(() => $('#neT', d.body).focus(), 300);
}

/* ------------------------------ 收支记账 ------------------------------ */
const CATS = {
  expense: [
    { n:'餐饮', c:'var(--accent)' }, { n:'交通', c:'var(--sky)' }, { n:'购物', c:'var(--plum)' },
    { n:'居住', c:'var(--sage)' }, { n:'订阅', c:'var(--amber)' }, { n:'医疗', c:'#c26b7a' },
    { n:'娱乐', c:'#8a7fb5' }, { n:'其他', c:'var(--ink-4)' }
  ],
  income: [
    { n:'工资', c:'var(--sage)' }, { n:'奖金', c:'var(--amber)' },
    { n:'兼职', c:'var(--sky)' }, { n:'其他', c:'var(--ink-4)' }
  ]
};
function catColor(name){
  const all = [...CATS.expense, ...CATS.income];
  return (all.find(x => x.n === name) || {}).c || 'var(--ink-4)';
}

function renderMoney(){
  const box = $('#view');
  const ms = Store.db.money || [];
  const mode = Store.db.settings.moneyMode || 'expense';
  const list = ms.filter(m => m.type === mode);
  const today = dayKey(), month = today.slice(0, 7);

  const sum = a => a.reduce((s, x) => s + x.amount, 0);
  const monthList = list.filter(m => m.date.startsWith(month));
  const todayList = list.filter(m => m.date === today);
  const exp = ms.filter(m => m.type === 'expense'), inc = ms.filter(m => m.type === 'income');
  const bal = sum(inc) - sum(exp);

  // 近 7 天
  const days = [];
  for (let i = 6; i >= 0; i--){
    const k = dayKey(addDays(new Date(), -i));
    days.push({ k, v: sum(exp.filter(m => m.date === k)) });
  }
  const maxDay = Math.max(1, ...days.map(d => d.v));

  // 分类占比
  const byCat = {};
  monthList.forEach(m => { byCat[m.cat] = (byCat[m.cat] || 0) + m.amount; });
  const catArr = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
  const monthTotal = sum(monthList) || 1;

  box.innerHTML =
    '<div class="grid g-4" style="margin-bottom:18px">' +
      '<div class="stat"><span>' + (mode === 'expense' ? '本月支出' : '本月收入') + '</span>' +
        '<b style="color:' + (mode === 'expense' ? 'var(--ink)' : 'var(--sage)') + '">¥' + money(sum(monthList)) + '</b>' +
        '<em>共 ' + monthList.length + ' 笔</em></div>' +
      '<div class="stat"><span>今日支出</span><b>¥' + money(sum(todayList.filter(m => m.type === 'expense').length ? todayList : exp.filter(m => m.date === today))) + '</b>' +
        '<em>' + esc(today) + '</em></div>' +
      '<div class="stat"><span>结余（全部）</span><b style="color:' + (bal >= 0 ? 'var(--sage)' : 'var(--danger)') + '">¥' + money(bal) + '</b>' +
        '<em>收入 ¥' + money(sum(inc)) + ' − 支出 ¥' + money(sum(exp)) + '</em></div>' +
      '<div class="stat"><span>累计笔数</span><b>' + ms.length + '</b><em>全部记录</em></div>' +
    '</div>' +

    '<div class="grid g-2" style="margin-bottom:18px">' +
      '<div class="card"><div class="card__hd"><h3>' + ic('barchart') + '近 7 天支出</h3></div>' +
        '<div class="card__bd">' +
        '<svg class="chart" viewBox="0 0 320 128" style="height:128px">' +
          days.map((d, i) => {
            const h = Math.max(2, d.v / maxDay * 82);
            const x = 24 + i * 40;
            // 轴字号 10/9.5（v1.17 由 9.5/8.5 上调）：svg 宽 100% 后 viewBox 会整体
            // 缩到约 0.9 倍，原字号实际渲染不足 8px，手机上读起来费劲。
            return '<rect x="' + x + '" y="' + (96 - h) + '" width="24" height="' + h + '" rx="7" fill="var(--accent)" fill-opacity="' + (d.v ? .74 : .14) + '"/>' +
              (d.v ? '<text x="' + (x + 12) + '" y="' + (91 - h) + '" text-anchor="middle" font-size="10" fill="var(--ink-3)" font-family="var(--f-num)">' + money(d.v) + '</text>' : '') +
              '<text x="' + (x + 12) + '" y="112" text-anchor="middle" font-size="10" fill="var(--ink-4)">' +
                (i === 6 ? '今天' : WEEK[new Date(d.k).getDay()].slice(1)) + '</text>' +
              '<text x="' + (x + 12) + '" y="124" text-anchor="middle" font-size="10" fill="var(--ink-4)">' + d.k.slice(5).replace('-','/') + '</text>';
          }).join('') +
        '</svg>' +
        '<div class="tiny muted" style="margin-top:4px">7 日合计 ¥' + money(days.reduce((s, d) => s + d.v, 0)) + ' · 日均 ¥' + money(days.reduce((s, d) => s + d.v, 0) / 7) + '</div>' +
        '</div></div>' +

      '<div class="card"><div class="card__hd"><h3>' + ic('piechart') + '本月分类占比</h3></div>' +
        '<div class="card__bd">' +
        (catArr.length ? (() => {
          let acc = 0;
          const r = 42, cx = 60, cy = 60, C = 2 * Math.PI * r;
          const segs = catArr.map(([n, v]) => {
            const frac = v / monthTotal;
            const dash = frac * C;
            const el = '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="' + catColor(n) +
              '" stroke-width="17" stroke-dasharray="' + dash + ' ' + (C - dash) + '" stroke-dashoffset="' + (-acc) + '" transform="rotate(-90 ' + cx + ' ' + cy + ')"/>';
            acc += dash;
            return el;
          }).join('');
          return '<div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">' +
            '<svg width="120" height="120" viewBox="0 0 120 120" style="flex:none">' + segs +
              '<text x="60" y="57" text-anchor="middle" font-size="15" font-weight="600" fill="var(--ink)" font-family="var(--f-serif)">¥' + money(sum(monthList)) + '</text>' +
              '<text x="60" y="72" text-anchor="middle" font-size="10" fill="var(--ink-4)">本月</text></svg>' +
            '<div style="flex:1;min-width:130px;display:flex;flex-direction:column;gap:6px">' +
            catArr.slice(0, 6).map(([n, v]) =>
              '<div style="display:flex;align-items:center;gap:7px;font-size:12.5px">' +
                '<i style="width:9px;height:9px;border-radius:3px;background:' + catColor(n) + ';flex:none;display:block"></i>' +
                '<span style="flex:1">' + esc(n) + '</span>' +
                '<b class="num" style="font-weight:600">¥' + money(v) + '</b>' +
                '<span class="muted num" style="width:38px;text-align:right">' + (v / monthTotal * 100).toFixed(0) + '%</span>' +
              '</div>').join('') + '</div></div>';
        })() : '<div class="empty" style="padding:26px">' + ic('piechart') + '<p>本月还没有记录</p><small>记一笔，这里就会出现分类占比。</small></div>') +
        '</div></div>' +
    '</div>' +

    '<div class="card">' +
      '<div class="card__hd">' +
        '<div class="seg" id="mSeg">' +
          '<button data-m="expense" class="' + (mode === 'expense' ? 'is-on' : '') + '">支出</button>' +
          '<button data-m="income" class="' + (mode === 'income' ? 'is-on' : '') + '">收入</button>' +
        '</div>' +
        '<div style="flex:1"></div>' +
        '<button class="btn btn--primary btn--sm" id="mAdd">' + ic('plus') + '记一笔</button>' +
      '</div>' +
      '<div class="card__bd" style="padding:0">' +
        (list.length ? '<div class="tbwrap"><table class="tb"><thead><tr>' +
          '<th>日期</th><th>分类</th><th>备注</th><th style="text-align:right">金额</th><th style="width:40px"></th>' +
          '</tr></thead><tbody id="mTb"></tbody></table></div>'
          : '<div class="empty" style="margin:16px;border:0">' + ic('wallet') +
            '<p>还没有' + (mode === 'expense' ? '支出' : '收入') + '记录</p><small>顺手记一笔，月底看趋势就没那么费劲了。</small>' +
            '<div style="margin-top:14px"><button class="btn btn--primary" id="mAdd2">' + ic('plus') + '记一笔</button></div></div>') +
      '</div>' +
    '</div>';

  if (list.length){
    const sorted = list.slice().sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
    $('#mTb').innerHTML = sorted.map(m =>
      '<tr data-id="' + escAttr(m.id) + '">' +
        '<td><span class="num tiny">' + esc(fmtDay(fromKey(m.date))) + '</span><br><span class="tiny muted num">' + esc(m.date.slice(5)) + '</span></td>' +
        '<td><span class="tag" style="background:' + catColor(m.cat) + '1f;color:' + catColor(m.cat) + ';border-color:transparent">' + esc(m.cat) + '</span></td>' +
        '<td style="color:var(--ink-2);font-size:13px">' + esc(m.note || '—') + '</td>' +
        '<td class="num" style="text-align:right;font-weight:600;color:' + (m.type === 'expense' ? 'var(--ink)' : 'var(--sage)') + '">' +
          (m.type === 'expense' ? '-' : '+') + '¥' + esc(money(m.amount)) + '</td>' +
        '<td><button class="btn btn--ghost btn--icon btn--sm del" data-d="' + escAttr(m.id) + '" title="删除">' + ic('x') + '</button></td>' +
      '</tr>').join('');
    $$('#mTb [data-d]').forEach(b => b.onclick = () => {
      const m = Store.db.money.find(x => x.id === b.dataset.d);
      Store.mutate(db => { db.money = db.money.filter(x => x.id !== b.dataset.d); });
      renderMoney();
      toast('ok', '已删除', '「' + (m?.note || m?.cat || '') + '」', 5000, [{ text:'撤销', fn: () => {
        Store.mutate(db => { db.money.push(m); }); renderMoney(); toast('ok','已恢复');
      }}]);
    });
  }
  $$('#mSeg button').forEach(b => b.onclick = () => {
    Store.db.settings.moneyMode = b.dataset.m; Store.save(); renderMoney();
  });
  $('#mAdd').onclick = () => openMoneyEditor(mode);
  $('#mAdd2')?.addEventListener('click', () => openMoneyEditor(mode));
}

function openMoneyEditor(mode){
  let type = mode || 'expense';
  const d = drawer({
    title: '记一笔',
    sub: '金额和分类随手填，输入即存',
    body:
      '<div class="sect"><h4>类型</h4><div class="seg" id="meType" style="width:100%">' +
        '<button data-t="expense" class="' + (type === 'expense' ? 'is-on' : '') + '" style="flex:1">支出</button>' +
        '<button data-t="income" class="' + (type === 'income' ? 'is-on' : '') + '" style="flex:1">收入</button>' +
      '</div></div>' +
      '<div class="sect"><h4>金额</h4>' +
        '<input class="inp" id="meAmt" type="number" inputmode="decimal" step="0.01" min="0" placeholder="0.00" style="height:56px;font-size:28px;font-family:var(--f-serif);text-align:center">' +
        '<p class="hint" id="meAmtHint">输入金额后按回车即可保存，也可以点下面的常用额度。</p>' +
      '</div>' +
      '<div class="sect"><h4>分类</h4><div class="quickcities" id="meCat"></div></div>' +
      '<div class="sect"><h4>备注</h4>' +
        '<input class="inp" id="meNote" placeholder="花在哪儿了？（可选）" maxlength="60">' +
        '<p class="hint">日期默认今天，保存后可在列表里再调整。</p></div>' +
      '<div class="sect"><h4>快速金额</h4><div class="quickcities" id="meQuick"></div></div>',
    foot: '<button class="btn btn--primary btn--block" id="meSave">' + ic('check') + '保存</button>'
  });
  let cat = CATS[type][0].n, amt = 0;
  const drawCats = () => {
    $('#meCat', d.body).innerHTML = CATS[type].map(c =>
      '<button data-c="' + escAttr(c.n) + '" class="' + (cat === c.n ? 'is-on' : '') + '"' +
      (cat === c.n ? ' style="background:' + c.c + ';border-color:' + c.c + ';color:#fff"' : '') + '>' + esc(c.n) + '</button>').join('');
    $$('#meCat button', d.body).forEach(b => b.onclick = () => { cat = b.dataset.c; drawCats(); });
  };
  const quick = type === 'expense' ? [10, 20, 35, 50, 100, 200] : [1000, 3000, 5000, 8000];
  $('#meQuick', d.body).innerHTML = quick.map(v => '<button data-v="' + v + '">' + v + '</button>').join('');
  $$('#meQuick button', d.body).forEach(b => b.onclick = () => {
    const i = $('#meAmt', d.body);
    i.value = String((Number(i.value) || 0) + Number(b.dataset.v));
    i.focus();
  });
  drawCats();
  $$('#meType button', d.body).forEach(b => b.onclick = () => {
    type = b.dataset.t; cat = CATS[type][0].n;
    $$('#meType button', d.body).forEach(x => x.classList.toggle('is-on', x === b));
    drawCats();
    const q = type === 'expense' ? [10, 20, 35, 50, 100, 200] : [1000, 3000, 5000, 8000];
    $('#meQuick', d.body).innerHTML = q.map(v => '<button data-v="' + v + '">' + v + '</button>').join('');
    $$('#meQuick button', d.body).forEach(bb => bb.onclick = () => {
      const i = $('#meAmt', d.body); i.value = String((Number(i.value) || 0) + Number(bb.dataset.v));
    });
  });
  const commit = () => {
    const a = Math.abs(Number($('#meAmt', d.body).value));
    if (!a || a <= 0){ toast('warn', '请填写金额'); return false; }
    const note = $('#meNote', d.body).value.trim();
    Store.mutate(db => {
      db.money.push({ id: uid(), type, amount: a, cat, note, date: dayKey(), createdAt: Date.now() });
      db.demo = false;
    });
    const i = $('#meAmt', d.body); i.value = '';
    $('#meNote', d.body).value = '';
    $('#meAmtHint', d.body).innerHTML = '<span style="color:var(--sage)">已记下 ¥' + money(a) + '（' + esc(cat) + '）</span>，可以继续记下一笔。';
    i.focus();
    Store.checkBackupHint();
    return true;
  };
  $('#meSave').onclick = () => { if (commit()) toast('ok', '已保存'); };
  $('#meAmt', d.body).addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); if (commit()) toast('ok', '已保存'); } });
  d.onClose = () => renderMoney();
  setTimeout(() => $('#meAmt', d.body).focus(), 320);
}

/* ------------------------------ 待办 ------------------------------ */
function renderTodo(){
  const box = $('#view');
  const ts = Store.db.todo || [];
  const pending = ts.filter(t => !t.done);
  const done = ts.filter(t => t.done);
  const overdue = pending.filter(t => t.due && t.due < dayKey());
  const todayD = pending.filter(t => t.due === dayKey());

  box.innerHTML =
    '<div class="grid g-stats" style="margin-bottom:18px">' +
      '<div class="stat"><span>待完成</span><b>' + pending.length + '</b><em>共 ' + ts.length + ' 条记录</em></div>' +
      '<div class="stat"><span>今天到期</span><b style="color:' + (todayD.length ? 'var(--accent)' : 'var(--ink)') + '">' + todayD.length + '</b><em>' + esc(fmtDay(new Date())) + '</em></div>' +
      '<div class="stat"><span>已逾期</span><b style="color:' + (overdue.length ? 'var(--danger)' : 'var(--sage)') + '">' + overdue.length + '</b>' +
        '<em>' + (overdue.length ? '尽快处理一下' : '没有拖欠，很好') + '</em></div>' +
    '</div>' +

    '<div class="card" style="margin-bottom:18px"><div class="card__bd" style="display:flex;gap:9px;flex-wrap:wrap;align-items:center">' +
      '<input class="inp" id="tdNew" placeholder="要做什么？回车添加" style="flex:1;min-width:180px">' +
      '<input class="inp" id="tdDue" type="date" style="width:150px">' +
      '<button class="btn btn--primary" id="tdAdd">' + ic('plus') + '添加</button>' +
    '</div></div>' +

    '<div class="grid g-2">' +
      '<div class="card"><div class="card__hd"><h3>' + ic('list') + '待办清单</h3>' +
        '<span class="tag">' + pending.length + '</span>' +
        (done.length ? '<button class="btn btn--sm btn--ghost" id="tdClear">' + ic('trash') + '清理已完成</button>' : '') + '</div>' +
        '<div class="card__bd" id="tdList" style="padding:8px 15px"></div></div>' +
      (done.length ? '<div class="card"><div class="card__hd"><h3>' + ic('check') + '已完成</h3>' +
        '<span class="tag tag--sage">' + done.length + '</span></div>' +
        '<div class="card__bd" id="tdDone" style="padding:8px 15px"></div></div>' : '') +
    '</div>';

  const drawItem = (t, isDone) => {
    const overdueFlag = t.due && !t.done && t.due < dayKey();
    const isToday = t.due === dayKey();
    const priMap = { 0:'', 1:'低', 2:'中', 3:'高' };
    const priColor = { 0:'', 1:'var(--sky)', 2:'var(--amber)', 3:'var(--danger)' };
    return '<div class="li' + (t.done ? ' is-done' : '') + '" data-id="' + escAttr(t.id) + '">' +
      '<button class="li__ck" data-t="' + escAttr(t.id) + '" aria-label="切换完成">' + ic('check') + '</button>' +
      '<div class="li__bd"><div class="li__t">' + esc(t.text) + '</div>' +
        '<div class="li__m">' +
          (t.due ? '<span style="color:' + (overdueFlag ? 'var(--danger)' : isToday ? 'var(--accent)' : 'inherit') + '">' +
            ic('clock') + ' ' + esc(fmtDay(fromKey(t.due))) + (overdueFlag ? ' · 已逾期' : '') + '</span>' : '') +
          (t.pri ? '<span style="color:' + priColor[t.pri] + '">' + ic('target') + ' ' + priMap[t.pri] + '优先</span>' : '') +
          '<span style="color:var(--ink-4)">' + esc(fmtAgo(t.createdAt)) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="li__acts">' +
        '<button data-p="' + escAttr(t.id) + '" title="优先级">' + ic('target') + '</button>' +
        '<button data-e="' + escAttr(t.id) + '" title="编辑">' + ic('edit') + '</button>' +
        '<button class="del" data-d="' + escAttr(t.id) + '" title="删除">' + ic('trash') + '</button>' +
      '</div></div>';
  };
  const sortFn = (a, b) => (b.pri - a.pri) || ((a.due || '9999') .localeCompare(b.due || '9999')) || (b.createdAt - a.createdAt);

  const pend = pending.slice().sort(sortFn);
  $('#tdList').innerHTML = pend.length
    ? '<div class="list">' + pend.map(t => drawItem(t)).join('') + '</div>'
    : '<div class="empty" style="border:0;padding:30px">' + ic('check') + '<p>清单是空的</p><small>上面输入框敲一下回车就能加一条。</small></div>';
  if (done.length){
    $('#tdDone').innerHTML = '<div class="list">' + done.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 30).map(t => drawItem(t)).join('') + '</div>';
  }
  bind();
  function bind(){
    $$('[data-t]').forEach(b => b.onclick = () => {
      const t = Store.db.todo.find(x => x.id === b.dataset.t);
      Store.mutate(db => { db.todo = db.todo.map(x => x.id === b.dataset.t ? { ...x, done: !x.done, doneAt: !x.done ? Date.now() : 0 } : x); });
      renderTodo();
      if (!t.done) toast('ok', '完成得不错', t.text, 2600);
    });
    $$('[data-d]').forEach(b => b.onclick = () => {
      const t = Store.db.todo.find(x => x.id === b.dataset.d);
      Store.mutate(db => { db.todo = db.todo.filter(x => x.id !== b.dataset.d); });
      renderTodo();
      toast('ok', '已删除', '', 5000, [{ text:'撤销', fn: () => {
        Store.mutate(db => { db.todo.push(t); }); renderTodo();
      }}]);
    });
    $$('[data-p]').forEach(b => b.onclick = () => {
      const t = Store.db.todo.find(x => x.id === b.dataset.p);
      const next = (t.pri + 1) % 4;
      Store.mutate(db => { db.todo = db.todo.map(x => x.id === t.id ? { ...x, pri: next } : x); });
      renderTodo();
      toast('ok', '优先级：' + (['无','低','中','高'][next]), t.text, 2200);
    });
    $$('[data-e]').forEach(b => b.onclick = () => {
      const t = Store.db.todo.find(x => x.id === b.dataset.e);
      modal({
        title: '编辑待办', okText: '保存',
        body: '<div class="stack">' +
          '<div class="field"><label>内容</label><input class="inp" id="tdeT" value="' + escAttr(t.text) + '"></div>' +
          '<div class="field"><label>截止日期</label><input class="inp" id="tdeD" type="date" value="' + escAttr(t.due || '') + '"></div>' +
          '<div class="field"><label>优先级</label><select class="sel" id="tdeP">' +
            [0,1,2,3].map(v => '<option value="' + v + '"' + (t.pri === v ? ' selected' : '') + '>' + ['无','低','中','高'][v] + '</option>').join('') +
          '</select></div></div>',
        onOk: bd => {
          const txt = $('#tdeT', bd).value.trim();
          if (!txt){ toast('warn', '内容不能为空'); return false; }
          Store.mutate(db => {
            db.todo = db.todo.map(x => x.id === t.id
              ? { ...x, text: txt, due: $('#tdeD', bd).value, pri: Number($('#tdeP', bd).value) } : x);
          });
          renderTodo(); toast('ok', '已保存');
        }
      });
    });
  }
  const add = () => {
    const i = $('#tdNew'), v = i.value.trim();
    if (!v) { toast('warn', '写点什么再加'); return; }
    Store.mutate(db => {
      db.todo.push({ id: uid(), text: v, done: false, due: $('#tdDue').value || '', pri: 0, createdAt: Date.now() });
      db.demo = false;
    });
    i.value = ''; $('#tdDue').value = '';
    renderTodo();
    Store.checkBackupHint();
    setTimeout(() => $('#tdNew')?.focus(), 30);
  };
  $('#tdAdd').onclick = add;
  $('#tdNew').addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); add(); } });
  $('#tdClear')?.addEventListener('click', () => {
    const n = done.length;
    modal({ title:'清理已完成', desc:'将删除 ' + n + ' 条已完成的待办，无法撤销。', okText:'清理', danger:true,
      onOk: () => {
        const backup = Store.db.todo.filter(t => t.done);
        Store.mutate(db => { db.todo = db.todo.filter(t => !t.done); });
        renderTodo();
        toast('ok', '已清理 ' + n + ' 条', '', 6000, [{ text:'撤销', fn: () => {
          Store.mutate(db => { db.todo.push(...backup); }); renderTodo();
        }}]);
      }});
  });
}

/* ------------------------------ 习惯打卡 ------------------------------ */
const HABIT_COLORS = { sage:'var(--sage)', accent:'var(--accent)', amber:'var(--amber)', plum:'var(--plum)', sky:'var(--sky)', ink:'var(--ink-3)' };

function renderHabits(){
  const box = $('#view');
  const hs = Store.db.habits || [];
  const today = dayKey();
  const totalToday = hs.filter(h => (h.days || []).includes(today)).length;

  box.innerHTML =
    '<div class="grid g-stats" style="margin-bottom:18px">' +
      '<div class="stat"><span>今日完成</span><b>' + totalToday + '<small> / ' + hs.length + '</small></b>' +
        '<em>' + (hs.length ? (totalToday === hs.length ? '全部打卡，漂亮' : '继续加油') : '还没有习惯') + '</em></div>' +
      '<div class="stat"><span>最长连续</span><b>' + (hs.length ? Math.max(...hs.map(h => streak(h))) : 0) + '<small> 天</small></b>' +
        '<em>' + (hs.length ? '来自「' + (hs.slice().sort((a,b) => streak(b) - streak(a))[0].name) + '」' : '—') + '</em></div>' +
      '<div class="stat"><span>近 7 天完成率</span><b>' + (hs.length ? Math.round(hs.reduce((s, h) => s + last7rate(h), 0) / hs.length) : 0) + '<small>%</small></b>' +
        '<em>所有习惯平均</em></div>' +
    '</div>' +

    '<div class="row row--mid" style="margin-bottom:14px">' +
      '<div style="flex:1"></div>' +
      (hs.length ? '<button class="btn" id="hbAll">' + ic('check') + '今日全部打卡</button>' : '') +
      '<button class="btn btn--primary" id="hbAdd">' + ic('plus') + '新增习惯</button>' +
    '</div>' +

    '<div class="habits" id="hbList"></div>';

  if (!hs.length){
    $('#hbList').innerHTML = '<div class="empty">' + ic('jar') +
      '<p>还没有习惯</p><small>每天坚持一件小事，30 天后回头看会很不一样。</small>' +
      '<div style="margin-top:14px"><button class="btn btn--primary" id="hbAdd2">' + ic('plus') + '加一个习惯</button></div></div>';
    $('#hbAdd2').onclick = () => openHabitEditor();
  } else {
    const DAYS = 21;
    $('#hbList').innerHTML = hs.map(h => {
      const days = [];
      for (let i = DAYS - 1; i >= 0; i--) days.push(dayKey(addDays(new Date(), -i)));
      const c = HABIT_COLORS[h.color] || HABIT_COLORS.sage;
      const st = streak(h);
      const rate = h.days.length ? Math.round(h.days.length / Math.max(1, Math.ceil((Date.now() - h.createdAt) / 86400000)) * 100) : 0;
      return '<div class="habit" data-id="' + escAttr(h.id) + '">' +
        '<div class="habit__hd">' +
          '<span class="dot" style="background:' + c + ';width:9px;height:9px"></span>' +
          '<b>' + esc(h.name) + '</b>' +
          (st ? '<span class="habit__streak">' + ic('fire') + st + ' 天</span>' : '<span class="tag">今天还没打</span>') +
          '<button class="btn btn--ghost btn--icon btn--sm" data-he="' + escAttr(h.id) + '" title="编辑">' + ic('gear') + '</button>' +
        '</div>' +
        '<div class="habit__grid">' + days.map(k => {
          const on = (h.days || []).includes(k);
          const isToday = k === today;
          const dt = fromKey(k);
          return '<button class="hday' + (on ? ' is-on' : '') + (isToday ? ' is-today' : '') + '" ' +
            'data-h="' + escAttr(h.id) + '" data-k="' + k + '" ' +
            'title="' + esc(k) + ' ' + WEEK[dt.getDay()] + (on ? ' · 已完成' : '') + '" ' +
            'style="' + (on ? 'background:' + c + ';border-color:' + c : '') + '"></button>';
        }).join('') + '</div>' +
        '<div class="habit__ft">' +
          '<small>累计 ' + (h.days || []).length + ' 天 · 完成率约 ' + clamp(rate, 0, 100) + '%</small>' +
          '<button class="btn btn--sm ' + ((h.days || []).includes(today) ? '' : 'btn--primary') + '" data-ht="' + escAttr(h.id) + '">' +
            ((h.days || []).includes(today) ? '取消今日' : '今日打卡') + '</button>' +
        '</div>' +
      '</div>';
    }).join('');
    // 窄屏下 30 个格子放不下，网格会横滑 —— 默认滚到最右端让「今天」可见。
    // 之前从第 1 天开始显示，今天被截在视口外，用户最关心的格子反而看不见。
    // 打卡后重绘也走这里，视图不会因操作跳回月初。
    $$('.habit__grid').forEach(g => { g.scrollLeft = g.scrollWidth; });
    $$('[data-h]').forEach(b => b.onclick = () => {
      const id = b.dataset.h, k = b.dataset.k;
      Store.mutate(db => {
        db.habits = db.habits.map(h => {
          if (h.id !== id) return h;
          const has = h.days.includes(k);
          return { ...h, days: has ? h.days.filter(x => x !== k) : [...h.days, k].sort() };
        });
        db.demo = false;
      });
      renderHabits();
      if (k === today && Store.db.habits.find(x => x.id === id).days.includes(today)){
        const s = streak(Store.db.habits.find(x => x.id === id));
        if (s >= 3) toast('ok', '连续 ' + s + ' 天了', '保持住这个节奏。', 3000);
      }
    });
    $$('[data-ht]').forEach(b => b.onclick = () => {
      const id = b.dataset.ht;
      Store.mutate(db => {
        db.habits = db.habits.map(h => {
          if (h.id !== id) return h;
          const has = h.days.includes(today);
          return { ...h, days: has ? h.days.filter(x => x !== today) : [...h.days, today].sort() };
        });
        db.demo = false;
      });
      renderHabits();
    });
    $$('[data-he]').forEach(b => b.onclick = () => openHabitEditor(b.dataset.he));
    $('#hbAll').onclick = () => {
      let n = 0;
      Store.mutate(db => {
        db.habits = db.habits.map(h => {
          if (h.days.includes(today)) return h;
          n++; return { ...h, days: [...h.days, today].sort() };
        });
      });
      renderHabits();
      toast('ok', n ? '今日全部打卡完成' : '今天已经都打过了', n ? '共 ' + n + ' 个习惯' : '', 3000);
    };
  }
  $('#hbAdd').onclick = () => openHabitEditor();

  function streak(h){
    let n = 0, d = new Date();
    if (!(h.days || []).includes(dayKey(d))) d = addDays(d, -1);
    while ((h.days || []).includes(dayKey(d))){ n++; d = addDays(d, -1); }
    return n;
  }
  function last7rate(h){
    let n = 0;
    for (let i = 0; i < 7; i++) if ((h.days || []).includes(dayKey(addDays(new Date(), -i)))) n++;
    return n / 7 * 100;
  }
}

function openHabitEditor(id){
  const editing = id ? Store.db.habits.find(h => h.id === id) : null;
  let color = editing?.color || 'sage';
  const d = drawer({
    title: editing ? '编辑习惯' : '新增习惯',
    body:
      '<div class="stack">' +
        '<div class="field"><label for="hbN">习惯名称</label>' +
          '<input class="inp" id="hbN" placeholder="例如 每天喝够 8 杯水" value="' + escAttr(editing?.name || '') + '" maxlength="40"></div>' +
        '<div class="field"><label>颜色</label><div class="quickcities" id="hbC">' +
          Object.keys(HABIT_COLORS).map(k => '<button data-c="' + k + '"' +
            (color === k ? ' style="background:' + HABIT_COLORS[k] + ';border-color:' + HABIT_COLORS[k] + ';color:#fff"' : '') + '>' +
            ['苔绿','赤陶','琥珀','梅紫','雾蓝','石墨'][Object.keys(HABIT_COLORS).indexOf(k)] + '</button>').join('') +
        '</div></div>' +
        '<p class="hint">创建后，在下方的 21 天网格里点格子即可补打卡，也可以点历史日期回填。</p>' +
        (editing ? '<button class="btn btn--danger" id="hbDel">' + ic('trash') + '删除这个习惯</button>' : '') +
      '</div>',
    foot: '<button class="btn btn--primary btn--block" id="hbSave">' + ic('check') + (editing ? '保存' : '创建') + '</button>'
  });
  $$('#hbC button', d.body).forEach(b => b.onclick = () => {
    color = b.dataset.c;
    $$('#hbC button', d.body).forEach(x => {
      const on = x === b;
      x.style.background = on ? HABIT_COLORS[color] : '';
      x.style.borderColor = on ? HABIT_COLORS[color] : '';
      x.style.color = on ? '#fff' : '';
    });
  });
  $('#hbDel')?.addEventListener('click', () => {
    modal({ title:'删除习惯', desc:'「' + editing.name + '」的打卡记录会一并删除。', okText:'删除', danger:true,
      onOk: () => {
        Store.mutate(db => { db.habits = db.habits.filter(h => h.id !== editing.id); });
        d.close(); renderHabits(); toast('ok', '已删除');
      }});
  });
  $('#hbSave').onclick = () => {
    const name = $('#hbN', d.body).value.trim();
    if (!name){ toast('warn', '给习惯起个名字'); return; }
    if (editing){
      Store.mutate(db => { db.habits = db.habits.map(h => h.id === editing.id ? { ...h, name, color } : h); });
    } else {
      Store.mutate(db => {
        db.habits.push({ id: uid(), name, color, days: [], createdAt: Date.now() });
        db.demo = false;
      });
    }
    d.close(); renderHabits();
    toast('ok', editing ? '已保存' : '已创建「' + name + '」');
    Store.checkBackupHint();
  };
  setTimeout(() => $('#hbN', d.body).focus(), 320);
}

/* ==========================================================================
   5. 饮品记录 —— 咖啡因 / 添加糖 / 热量
   --------------------------------------------------------------------------
   与「习惯」模块刻意分开，原因是两者的数据模型根本不同：
     习惯 = 每天一个布尔值（打没打卡），关心「连续几天」；
     饮品 = 每次一条记录（一天可能好几杯），关心「当日累计多少」。
   硬塞进习惯会把 habit.days 从日期数组改成嵌套结构，还得迁移老数据，不划算。
   ========================================================================== */

/** 每日参考上限。热量不设上限 —— 饮品热量差异大且非主要风险，只求和展示。 */
const DRINK_LIMIT = { caffeine: 400, sugar: 50 };

/** 常见饮品典型值（按「常规一份」计），选中后仍可逐项微调。
 *  v=容量ml  s=添加糖g  c=咖啡因mg  k=热量kcal
 *  数值取各品牌中杯/常规份量的常见区间，仅供参考，不作营养建议。 */
const DRINK_PRESETS = [
  { n:'美式咖啡',   v:355, s:0,  c:150, k:5,   g:'咖啡' },
  { n:'拿铁',       v:355, s:15, c:75,  k:190, g:'咖啡' },
  { n:'卡布奇诺',   v:355, s:12, c:75,  k:140, g:'咖啡' },
  { n:'摩卡',       v:355, s:30, c:90,  k:290, g:'咖啡' },
  { n:'冷萃咖啡',   v:355, s:0,  c:200, k:5,   g:'咖啡' },
  { n:'速溶咖啡',   v:200, s:8,  c:60,  k:60,  g:'咖啡' },
  { n:'珍珠奶茶',   v:500, s:35, c:30,  k:350, g:'奶茶' },
  { n:'奶茶（半糖）',v:500, s:20, c:25,  k:260, g:'奶茶' },
  { n:'芝士奶盖茶', v:500, s:25, c:25,  k:300, g:'奶茶' },
  { n:'水果茶',     v:500, s:30, c:0,   k:150, g:'奶茶' },
  { n:'无糖茶饮',   v:500, s:0,  c:20,  k:0,   g:'茶'   },
  { n:'绿茶',       v:250, s:0,  c:30,  k:0,   g:'茶'   },
  { n:'红茶',       v:250, s:0,  c:45,  k:2,   g:'茶'   },
  { n:'可乐',       v:330, s:35, c:35,  k:140, g:'碳酸' },
  { n:'无糖可乐',   v:330, s:0,  c:35,  k:0,   g:'碳酸' },
  { n:'能量饮料',   v:250, s:27, c:80,  k:110, g:'功能' },
  { n:'运动饮料',   v:500, s:30, c:0,   k:120, g:'功能' },
  { n:'果汁',       v:250, s:24, c:0,   k:110, g:'果汁' },
  { n:'豆浆',       v:300, s:5,  c:0,   k:100, g:'其他' },
  { n:'热可可',     v:250, s:20, c:10,  k:150, g:'其他' },
  { n:'柠檬茶',     v:400, s:10, c:15,  k:40,  g:'其他' }
];

/* ==========================================================================
   瑞幸官方产品营养表（内置）
   --------------------------------------------------------------------------
   数据来源：瑞幸官网产品页 https://lkcoffee.com/products 各分类页，
   抓取日期 2026-09-24，共 36 款在售饮品。

   为什么值得内置一张表，而不是全靠 AI 估：
     ① 官网给的是实测值，AI 只能凭印象估。像「茉莉花香拿铁」76kcal 却有
        236mg 咖啡因、「生椰三重奏拿铁」470kcal 但只有 148mg —— 热量和
        咖啡因根本不同向变化，凭常识猜必错。
     ② 联表命中时零网络、零 API 消耗、离线可用。
     ③ AI 只负责「表里没有的」和「官网不公开的糖分」。

   字段：n=名称  g=分类  k=热量kcal  c=咖啡因mg  d=官网标注的杯型/甜度规格
   注意 k / c 可能缺省（官网部分产品只标了热量）——缺的交给 AI 补。
   ========================================================================== */
const LUCKIN_TABLE = [
  { n:'生椰拿铁',           g:'拿铁',   k:179, c:118, d:'大杯/冰/默认浓度/不另外加糖' },
  { n:'茉莉花香拿铁',       g:'拿铁',   k:76,  c:236, d:'大杯/冰/默认浓度/不另外加糖' },
  { n:'拿铁',               g:'拿铁',   k:268, c:99,  d:'大杯/热/默认浓度/不另外加糖' },
  { n:'冰吸生椰拿铁',       g:'拿铁',   k:196, c:163, d:'大杯/冰/默认浓度/不另外加糖' },
  { n:'小黄油拿铁',         g:'拿铁',   k:250, c:172, d:'大杯/冰/默认浓度/不另外加糖' },
  { n:'生椰三重奏拿铁',     g:'拿铁',   k:470, c:148, d:'大杯/冰/默认浓度/微甜' },
  { n:'轻椰茉莉拿铁',       g:'拿铁',   k:120, c:179, d:'大杯/冰/默认浓度/不另外加糖' },
  { n:'丝绒拿铁',           g:'拿铁',   k:376,           d:'大杯/热/默认浓度/不另外加糖' },
  { n:'钱塘龙井拿铁',       g:'拿铁',   k:76,  c:228, d:'大杯/冰/少少甜' },
  { n:'海盐焦糖拿铁',       g:'拿铁',   k:206, c:152, d:'16oz/冰/少甜' },
  { n:'绿沙沙拿铁',         g:'拿铁',   k:197, c:130, d:'16oz/冰/不另外加糖' },
  { n:'桂花米酿拿铁',       g:'拿铁',   k:198, c:136, d:'16oz/冰/少甜' },

  { n:'标准美式',           g:'美式',   k:11,  c:164, d:'大杯/冰/不另外加糖' },
  { n:'加浓美式',           g:'美式',   k:14,  c:199, d:'大杯/冰/不另外加糖' },
  { n:'小黄油美式',         g:'美式',   k:173, c:212, d:'大杯/冰' },
  { n:'柚C美式',            g:'美式',   k:137, c:184, d:'大杯/冰' },
  { n:'苹果C美式',          g:'美式',   k:133, c:172, d:'大杯/冰' },
  { n:'橙C美式',            g:'美式',   k:122, c:158, d:'大杯/冰' },
  { n:'小青桔C美式',        g:'美式',   k:115, c:154, d:'大杯/冰' },
  { n:'柠C气泡美式',        g:'美式',   k:83,  c:134, d:'鲜果版/大杯/冰' },
  { n:'缤纷C美式',          g:'美式',   k:100, c:37,  d:'大杯/冰' },
  { n:'全冰黑巧美式',       g:'美式',   k:132, c:36,  d:'大杯/冰' },

  { n:'Hello苹果茉莉',      g:'冰茶',   k:173, c:42,  d:'16oz/冰/不另外加糖' },
  { n:'小青桔茉莉冰奶',     g:'冰茶',   k:148, c:30,  d:'16oz/冰/不另外加糖' },
  { n:'荔枝茉莉冰奶',       g:'冰茶',   k:128, c:26,  d:'16oz/冰/不另外加糖' },
  { n:'弗朗明戈跳跳冰茶',   g:'冰茶',   k:149, c:24,  d:'超大杯/24oz/冰/少少甜' },
  { n:'苹果C冰茶',          g:'冰茶',   k:130,           d:'大杯/冰/不另外加糖' },
  { n:'葡萄冰茶',           g:'冰茶',   k:115,           d:'大杯/16oz/冰/不另外加糖' },
  { n:'皇后限定苹果C冰茶',  g:'冰茶',   k:130           },

  { n:'桂花米酿乌龙',       g:'轻乳茶', k:219, c:78,  d:'大杯/冰/少甜' },
  { n:'鲜萃轻轻茉莉',       g:'轻乳茶', k:95            },

  { n:'瑰夏之梦',           g:'冷萃',   k:161, c:79,  d:'大杯/冰' },
  { n:'大西瓜生椰冷萃',     g:'冷萃',   k:112, c:13,  d:'大杯/冰' },

  { n:'羽衣轻体果蔬茶',     g:'果蔬茶', k:94            },
  { n:'生椰杨枝甘露',       g:'非咖啡', k:176           },
  { n:'牛油果羽衣酸奶昔',   g:'非咖啡', k:305           }
];

/** 名称归一化：去掉空格、大小写、常见修饰词，便于模糊匹配。
 *  用户输入千奇百怪（「瑞幸生椰拿铁」「生椰拿铁 大杯」「luckin 生椰拿铁」），
 *  归一化后再比对，命中率明显提高。 */
function normDrinkName(s){
  return String(s || '')
    .toLowerCase()
    .replace(/瑞幸|luckin|咖啡|饮品/g, '')   // 品牌/通用词：去掉，「瑞幸咖啡」类前缀太多
    .replace(/[的的了]/g, '')                // 去掉虚词：「瑞幸的美式咖啡」→「美式」
    .replace(/[\s·•・\-—_（）()【】\[\]「」]/g, '')
    .trim();
}

/** 在瑞幸官方表里找最匹配的一条。
 *  策略：先精确（归一化后相等），再包含（双向），最后取公共字符最多的。
 *  返回 {row, score} 或 null。score 用于 UI 上提示匹配可信度。 */
function matchLuckin(name){
  const q = normDrinkName(name);
  if (q.length < 2) return null;

  // ① 归一化后完全相等
  for (const row of LUCKIN_TABLE){
    if (normDrinkName(row.n) === q) return { row, score: 1 };
  }
  // ② 双向包含（「生椰拿铁」↔「冰吸生椰拿铁」都算）
  //    短的一侧只要 ≥2 字即可 —— 用户常只输入「美式」「拿铁」这种通用名。
  //    但 2 字匹配容易歧义（表里有 10 款美式），所以要求「该长度下候选唯一」，
  //    多候选取最长公共子串更长的那个（更具体），仍并列则放弃。
  const cands = [];
  for (const row of LUCKIN_TABLE){
    const t = normDrinkName(row.n);
    if (t.includes(q) || q.includes(t)){
      const shorter = Math.min(t.length, q.length);
      if (shorter >= 2) cands.push({ row, score: shorter / Math.max(t.length, q.length) });
    }
  }
  if (cands.length){
    cands.sort((a, b) => b.score - a.score || a.row.n.length - b.row.n.length);
    // 通用名（2 字）只有在没有更具体的候选时才用，避免「美式」压过「标准美式」
    const top = cands[0];
    const tie = cands.filter(c => Math.abs(c.score - top.score) < 1e-6);
    if (tie.length === 1) return top;
    // 同分多个：取名字最短的（最接近通用名），但仅当它明显是「基础款」
    return tie.sort((a, b) => a.row.n.length - b.row.n.length)[0];
  }
  // ③ 最长公共子串兜底：要求至少 4 个连续字相同，避免乱匹配
  //    （用户会把名字写长写歪，比如「瑞幸的绿沙沙冰拿铁」）
  let best = null;
  for (const row of LUCKIN_TABLE){
    const t = normDrinkName(row.n);
    let longest = 0;
    for (let i = 0; i < t.length; i++){
      for (let len = Math.min(t.length - i, q.length); len > longest; len--){
        if (q.includes(t.slice(i, i + len))){ longest = len; break; }
      }
    }
    if (longest >= 4){
      const score = longest / Math.max(t.length, q.length) * 0.8;
      if (!best || score > best.score) best = { row, score };
    }
  }
  return best;
}

/** 按天聚合求和 */
function drinkTotals(list){
  return list.reduce((a, d) => ({
    caffeine: a.caffeine + (Number(d.c) || 0),
    sugar:    a.sugar    + (Number(d.s) || 0),
    kcal:     a.kcal     + (Number(d.k) || 0),
    vol:      a.vol      + (Number(d.v) || 0),
    n:        a.n + 1
  }), { caffeine: 0, sugar: 0, kcal: 0, vol: 0, n: 0 });
}

function drinksOfDay(k){
  return (Store.db.drinks || []).filter(d => dayKey(new Date(d.at)) === k);
}

function renderDrinks(){
  const box = $('#view');
  const all = (Store.db.drinks || []).slice().sort((a, b) => b.at - a.at);
  const todayKey = dayKey();
  const today = all.filter(d => dayKey(new Date(d.at)) === todayKey);
  const tot = drinkTotals(today);

  // 近 7 天（含今天）咖啡因与糖
  const days = [];
  for (let i = 6; i >= 0; i--){
    const dt = addDays(new Date(), -i);
    const k = dayKey(dt);
    days.push({ k, label: (dt.getMonth() + 1) + '/' + dt.getDate(), ...drinkTotals(drinksOfDay(k)) });
  }
  const maxCaf = Math.max(DRINK_LIMIT.caffeine, ...days.map(d => d.caffeine));

  const pct = (v, lim) => Math.min(100, Math.round(v / lim * 100));
  const over = (v, lim) => v > lim;
  // 达到 80% 即提醒，留一点缓冲
  const near = (v, lim) => v >= lim * 0.8 && v <= lim;

  box.innerHTML =
    /* ① 今日摄入：三指标，咖啡因与糖带上限进度 */
    '<div class="grid g-stats" style="margin-bottom:16px">' +
      '<div class="stat"><span>咖啡因</span><b>' + tot.caffeine + '<small> / ' + DRINK_LIMIT.caffeine + 'mg</small></b>' +
        '<em>' + (tot.caffeine === 0 ? '今天还没摄入'
          : over(tot.caffeine, DRINK_LIMIT.caffeine) ? '已超上限'
          : near(tot.caffeine, DRINK_LIMIT.caffeine) ? '接近上限了'
          : '还在安全范围') + '</em></div>' +
      '<div class="stat"><span>添加糖</span><b>' + tot.sugar + '<small> / ' + DRINK_LIMIT.sugar + 'g</small></b>' +
        '<em>' + (tot.sugar === 0 ? '无糖，很好'
          : over(tot.sugar, DRINK_LIMIT.sugar) ? '已超上限'
          : near(tot.sugar, DRINK_LIMIT.sugar) ? '接近上限了'
          : '还在安全范围') + '</em></div>' +
      '<div class="stat"><span>热量</span><b>' + tot.kcal + '<small> kcal</small></b>' +
        '<em>今日 ' + tot.n + ' 杯 · ' + tot.vol + 'ml</em></div>' +
    '</div>' +

    '<div class="card" style="margin-bottom:18px"><div class="card__bd">' +
      bar('咖啡因', tot.caffeine, DRINK_LIMIT.caffeine, 'mg', 'var(--accent)') +
      bar('添加糖', tot.sugar, DRINK_LIMIT.sugar, 'g', 'var(--amber)') +
      '<div class="dk__note">' + ic('info') +
        '<span>上限参考：咖啡因 400mg（成人每日建议上限）、添加糖 50g（WHO 建议，理想 25g）。数值来自公开资料，不作医疗建议。</span></div>' +
    '</div></div>' +

    /* ① 今日记录（放在最前 —— 最常看的是「今天喝了什么」） */
    '<div class="card" style="margin-bottom:18px">' +
      '<div class="card__hd"><h3>' + ic('clock') + '今天喝过</h3>' +
        (today.length ? '<span class="tag">' + today.length + ' 杯</span>' : '') + '</div>' +
      '<div class="card__bd" style="padding:0" id="dkToday"></div>' +
    '</div>' +

    /* ② 快速记录：预设宫格 */
    '<div class="card" style="margin-bottom:18px">' +
      '<div class="card__hd"><h3>' + ic('cup') + '记一杯</h3>' +
        '<button class="btn btn--sm btn--ghost" id="dkCustom">' + ic('edit') + '自定义</button></div>' +
      '<div class="card__bd"><div class="dk__grid">' +
        DRINK_PRESETS.map((p, i) =>
          '<button class="dk__chip" data-preset="' + i + '">' +
            '<b>' + esc(p.n) + '</b>' +
            '<small>' + p.v + 'ml · ' + (p.c ? p.c + 'mg 咖啡因' : '无咖啡因') +
            (p.s ? ' · ' + p.s + 'g 糖' : '') + '</small>' +
          '</button>').join('') +
      '</div></div>' +
    '</div>' +

    /* ④ 近 7 天咖啡因趋势（内联 SVG 手写，不引图表库） */
    '<div class="card"><div class="card__hd"><h3>' + ic('barchart') + '近 7 天咖啡因</h3>' +
      '<span class="tag">mg</span></div>' +
      '<div class="card__bd">' + sparkBars(days, maxCaf) + '</div>' +
    '</div>';

  // ---- 局部渲染函数（供上面模板调用，保持单向依赖） ----
  function bar(label, val, lim, unit, color){
    const p = pct(val, lim);
    const bad = over(val, lim);
    const warn = near(val, lim);
    return '<div class="dk__bar">' +
      '<div class="dk__barhd"><span>' + esc(label) + '</span>' +
        '<b style="color:' + (bad ? 'var(--danger)' : warn ? 'var(--amber)' : 'var(--ink-2)') + '">' +
        val + unit + ' / ' + lim + unit + '</b></div>' +
      '<div class="dk__track"><i style="width:' + p + '%;background:' +
        (bad ? 'var(--danger)' : warn ? 'var(--amber)' : color) + '"></i></div>' +
    '</div>';
  }

  function sparkBars(days, max){
    const W = 100, H = 46, gap = 2;
    const bw = (W - gap * (days.length - 1)) / days.length;
    const limY = H - (DRINK_LIMIT.caffeine / max) * H;
    let s = '<div class="chart" data-chart style="position:relative;height:' + (H + 22) + 'px">' +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" style="width:100%;height:' + H + 'px;display:block">' +
      '<line x1="0" y1="' + limY.toFixed(1) + '" x2="' + W + '" y2="' + limY.toFixed(1) +
        '" stroke="var(--danger)" stroke-width="0.4" stroke-dasharray="2 2" opacity="0.55"/>';
    days.forEach((d, i) => {
      const h = max ? (d.caffeine / max) * H : 0;
      const x = i * (bw + gap);
      const over = d.caffeine > DRINK_LIMIT.caffeine;
      s += '<rect x="' + x.toFixed(2) + '" y="' + (H - h).toFixed(2) + '" width="' + bw.toFixed(2) +
        '" height="' + Math.max(h, 0.6).toFixed(2) + '" rx="0.8" fill="' +
        (over ? 'var(--danger)' : 'var(--accent)') + '" opacity="' + (i === days.length - 1 ? '1' : '0.75') + '"/>';
    });
    s += '</svg><div style="display:flex;justify-content:space-between;margin-top:4px">' +
      days.map(d => '<span class="tiny" style="flex:1;text-align:center;color:var(--ink-4)">' + esc(d.label) + '</span>').join('') +
    '</div></div>';
    return s;
  }

  // ---- 事件绑定 ----
  $$('#view .dk__chip').forEach(b => b.onclick = () => openDrinkEditor(DRINK_PRESETS[Number(b.dataset.preset)]));
  $('#dkCustom').onclick = () => openDrinkEditor(null);
  drawToday();

  function drawToday(){
    const el = $('#dkToday');
    if (!today.length){
      el.innerHTML = '<div class="empty" style="border:0;padding:26px">' + ic('cup') +
        '<p>今天还没喝</p><small>点上面任一饮品，或「自定义」手动填写。</small></div>';
      return;
    }
    el.innerHTML = '<div class="list">' + today.map(d => {
      // 数据来源小标：让「官方实测值」和「AI 估算值」在列表里也分得清
      const hasOfficial = (d.src || []).includes('official');
      const hasAi = (d.src || []).includes('ai');
      const tag = hasOfficial ? '<i class="dk__tag dk__tag--official">官网</i>'
                : hasAi ? '<i class="dk__tag">AI估</i>' : '';
      return '<div class="li" data-id="' + escAttr(d.id) + '">' +
        '<div class="li__bd"><div class="li__t">' + esc(d.name) + tag + '</div>' +
          '<div class="li__m">' +
            '<span>' + ic('clock') + ' ' + esc(fmtTime(d.at)) + '</span>' +
            '<span>' + (Number(d.v) || 0) + 'ml</span>' +
            (d.c ? '<span>' + d.c + 'mg 咖啡因</span>' : '') +
            (d.s ? '<span>' + d.s + 'g 糖</span>' : '') +
            (d.k ? '<span>' + d.k + 'kcal</span>' : '') +
          '</div>' +
        '</div>' +
        '<div class="li__acts"><button class="del" data-dk="' + escAttr(d.id) + '" title="删除">' + ic('trash') + '</button></div>' +
      '</div>';
    }).join('') + '</div>';
    $$('[data-dk]', el).forEach(b => b.onclick = () => {
      const id = b.dataset.dk;
      const one = (Store.db.drinks || []).find(x => x.id === id);
      modal({ title:'删除这条记录', desc:'「' + (one?.name || '') + '」将被移除。', okText:'删除', danger:true,
        onOk: () => {
          Store.mutate(db => { db.drinks = (db.drinks || []).filter(x => x.id !== id); });
          renderDrinks(); toast('ok', '已删除');
        }});
    });
  }
}

/** 记一杯：preset 为预设项，null 表示完全自定义
 *  opts.type：可选，直接指定饮品名（如从 AI 查值入口进来） */
function openDrinkEditor(preset){
  const now = new Date();
  // datetime-local 要求「本地时间」的 YYYY-MM-DDTHH:mm。
  // 不能用 toISOString().slice(0,16) —— 那是 UTC，东八区会差 8 小时。
  const nowInput = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate()) +
                   'T' + pad2(now.getHours()) + ':' + pad2(now.getMinutes());

  // 打开时先看看名字是否命中瑞幸官方表，命中就直接带出准确值
  const presetName = preset ? preset.n : '';
  const hit = presetName ? matchLuckin(presetName) : null;
  const official = hit ? hit.row : null;

  const initC = official && official.c != null ? official.c : (preset ? preset.c : 0);
  const initK = official && official.k != null ? official.k : (preset ? preset.k : 0);
  const initS = preset ? preset.s : 0;

  const d = drawer({
    title: preset ? '记一杯 · ' + preset.n : '自定义饮品',
    sub: '数值可改，按你的实际杯量调整',
    body:
      '<div class="stack">' +
        '<label class="fld"><span>名称</span>' +
          '<input id="dkN" type="text" value="' + escAttr(presetName) + '" placeholder="例如：瑞幸 生椰拿铁" maxlength="30"></label>' +

        /* AI 查值入口 —— 放在名称下方，填完名字下一步就点它 */
        '<div class="dk__ai">' +
          '<button class="btn btn--sm" id="dkAi">' + ic('spark') + 'AI 查热量 / 咖啡因 / 糖</button>' +
          '<span class="dk__aihint" id="dkAiHint">' +
            (official
              ? '已命中瑞幸官方表：' + esc(official.n)
              : '填好名称和容量，点左边的按钮让 AI 估算') +
          '</span>' +
        '</div>' +
        '<div id="dkAiOut"></div>' +

        '<div class="row">' +
          '<label class="fld" style="flex:1"><span>容量 (ml)</span>' +
            '<input id="dkV" type="number" inputmode="numeric" min="0" max="3000" step="10" value="' + (preset ? preset.v : 355) + '"></label>' +
          '<label class="fld" style="flex:1"><span>咖啡因 (mg)<i class="dk__badge" id="dkBC"></i></span>' +
            '<input id="dkC" type="number" inputmode="numeric" min="0" max="1000" step="1" value="' + initC + '"></label>' +
        '</div>' +
        '<div class="row">' +
          '<label class="fld" style="flex:1"><span>添加糖 (g)<i class="dk__badge" id="dkBS"></i></span>' +
            '<input id="dkS" type="number" inputmode="numeric" min="0" max="200" step="1" value="' + initS + '"></label>' +
          '<label class="fld" style="flex:1"><span>热量 (kcal)<i class="dk__badge" id="dkBK"></i></span>' +
            '<input id="dkK" type="number" inputmode="numeric" min="0" max="2000" step="1" value="' + initK + '"></label>' +
        '</div>' +
        '<label class="fld"><span>时间</span>' +
          '<input id="dkT" type="datetime-local" value="' + nowInput + '"></label>' +
      '</div>',
    foot: '<button class="btn" id="dkCancel">取消</button>' +
          '<button class="btn btn--primary" id="dkSave">' + ic('check') + '记录</button>'
  });

  // 取消必须显式绑 close()：抽屉内部有 stopPropagation，靠冒泡到遮罩是不生效的。
  // 另外别用 data-x="c" 当钩子 —— drawer() 用 querySelector 只抓第一个，
  // 那个位置永远属于头部的 ×，底部按钮拿不到任何事件。
  $('#dkCancel', d.foot).onclick = () => d.close();

  /* ---------------- 数据来源标注 ----------------
   * 三个字段各自记住「这个值是怎么来的」，在标签上挂一个小徽标。
   * 官方实测值与 AI 估值必须能一眼分清 —— 否则用户会以为糖分也是官方数据。 */
  const src = {
    c: official && official.c != null ? 'official' : (preset && preset.c ? 'preset' : 'manual'),
    k: official && official.k != null ? 'official' : (preset && preset.k ? 'preset' : 'manual'),
    s: preset && preset.s ? 'preset' : 'manual'
  };
  const SRC_TEXT = { official: '官方', ai: 'AI估', preset: '参考', manual: '' };

  function paintBadges(){
    [['dkBC', 'c'], ['dkBK', 'k'], ['dkBS', 's']].forEach(([id, key]) => {
      const el = $('#' + id, d.body);
      if (!el) return;
      const t = SRC_TEXT[src[key]] || '';
      el.textContent = t;
      el.className = 'dk__badge' + (t ? ' dk__badge--' + src[key] : '');
    });
  }
  /** 用户手动改过输入框，来源就降级为「手动」 —— 不能继续挂着「官方」误导人 */
  function watchManual(id, key){
    const el = $('#' + id, d.body);
    if (el) el.addEventListener('input', () => { src[key] = 'manual'; paintBadges(); });
  }
  ['dkC:c', 'dkK:k', 'dkS:s'].forEach(p => watchManual(p.split(':')[0], p.split(':')[1]));
  paintBadges();

  /* ---------------- AI 查值 ---------------- */
  const aiBtn = $('#dkAi', d.body);
  const out = $('#dkAiOut', d.body);

  // 输入名字时实时看能不能命中官方表，给个即时反馈（不发请求，纯本地）
  const nameIn = $('#dkN', d.body);
  nameIn.addEventListener('blur', () => {
    const n = (nameIn.value || '').trim();
    const hit = matchLuckin(n);
    const h = $('#dkAiHint', d.body);
    if (!h) return;
    h.textContent = hit && hit.score >= 0.5
      ? '这个名字在瑞幸官方表里，点右侧按钮直接取官方值'
      : '填好名称和容量，点左侧按钮让 AI 估算';
  });

  aiBtn.onclick = async () => {
    const name = (nameIn.value || '').trim();
    if (!name){
      // 双通道反馈：toast 容易被忽略，输入框旁边再给一条内联提示
      out.innerHTML = notice('warn', '先填饮品名称', '例如「瑞幸 生椰拿铁」「珍珠奶茶」。');
      nameIn.focus();
      toast('warn', '先填饮品名称', '填好名字再点「AI 查值」。', 3500);
      return;
    }
    const vol = Number($('#dkV', d.body).value) || 355;

    // 走统一的默认 AI（设置页可指定；没指定则第一个有 Key 的）
    const prov = AI.pickDefault();
    if (!prov){
      out.innerHTML = notice('warn', '还没有可用的 AI 供应商',
        '去「AI 余额」页填一个 API Key，再到「设置 → 默认 AI」里选它。');
      return;
    }

    // ① 先查本地官方表 —— 零成本，命中就不用发请求
    const localHit = matchLuckin(name);
    const local = localHit && localHit.score >= 0.5 ? localHit.row : null;

    aiBtn.disabled = true;
    const oldHtml = aiBtn.innerHTML;
    aiBtn.innerHTML = ic('refresh') + '查询中…';
    out.innerHTML = '';

    try {
      // ② 需要 AI 的场景：没命中官方表，或命中了但缺值（官网部分产品没标咖啡因）
      const needAI = !local || local.c == null || local.k == null;
      let r = null, aiErr = null;

      if (needAI){
        try {
          r = await AI.estimateDrink(prov.id, { name, volume: vol, official: local });
        } catch (e){ aiErr = e; }
      }

      // ③ 合并结果：官方值优先，AI 只补缺
      const merged = { c: null, k: null, s: null };
      if (local){
        merged.c = local.c; merged.k = local.k;
      }
      if (r){
        if (merged.c == null) merged.c = r.caffeine;
        if (merged.k == null) merged.k = r.kcal;
        merged.s = r.sugar;
      }

      if (merged.c == null && merged.k == null && merged.s == null){
        out.innerHTML = notice('warn', '没查到数据',
          aiErr ? 'AI 返回异常：' + esc(aiErr.message) + '。可以手动填。' : '可以手动填写数值。');
        return;
      }

      // ④ 回填输入框并更新来源标注
      const fill = (id, key, v, from) => {
        if (v == null) return;
        $('#' + id, d.body).value = v;
        src[key] = from;
      };
      fill('dkC', 'c', merged.c, local && local.c != null ? 'official' : 'ai');
      fill('dkK', 'k', merged.k, local && local.k != null ? 'official' : 'ai');
      fill('dkS', 's', merged.s, 'ai');
      paintBadges();

      out.innerHTML = resultCard(local, r, aiErr, prov);

    } catch (e){
      out.innerHTML = notice('err', '查询失败', esc(e.message || '未知错误'));
    } finally {
      aiBtn.disabled = false;
      aiBtn.innerHTML = oldHtml;
    }
  };

  /** 内联 SVG 提示条（不引外部资源） */
  function notice(kind, title, desc){
    const iconName = kind === 'err' ? 'warn' : kind === 'warn' ? 'info' : 'check';
    const cls = kind === 'err' ? 'dk__msg--err' : kind === 'warn' ? 'dk__msg--warn' : 'dk__msg--ok';
    return '<div class="dk__msg ' + cls + '">' + ic(iconName, 'dk__msgIc') +
      '<div><b>' + esc(title) + '</b>' + (desc ? '<span>' + desc + '</span>' : '') + '</div></div>';
  }

  /** 查询结果卡片：显示数据来源与依据，让用户知道该信几分 */
  function resultCard(local, ai, err, prov){
    const rows = [];
    if (local){
      rows.push('<div class="dk__src"><b>瑞幸官网</b><span>' + esc(local.n) + '　' +
        (local.k != null ? '热量 ' + local.k + 'kcal' : '') +
        (local.c != null ? '　咖啡因 ' + local.c + 'mg' : '') +
        (local.d ? '<br><em>' + esc(local.d) + '</em>' : '') + '</span></div>');
    }
    if (ai){
      rows.push('<div class="dk__src"><b>AI 估算</b><span>' +
        '糖 ' + ai.sugar + 'g　热量 ' + ai.kcal + 'kcal　咖啡因 ' + ai.caffeine + 'mg' +
        (ai.basis ? '<br><em>' + esc(ai.basis) + '</em>' : '') +
        '<br><em>把握：' + ({ high: '较高', medium: '中等', low: '较低' }[ai.confidence] || '中等') +
        ' · 模型 ' + esc(ai.model) + '</em></span></div>');
    }
    const tip = local
      ? '热量和咖啡因来自瑞幸官网，糖分为 AI 估算（官网未公开）。数值会随杯型/甜度变化，可手动微调。'
      : '三项均为 AI 估算，仅供参考。如果包装上有标注，建议按实际填写。';
    if (err) rows.push('<div class="dk__src dk__src--warn"><b>部分失败</b><span>' + esc(err.message) + '</span></div>');
    return '<div class="dk__result">' + rows.join('') +
      '<p class="tiny">' + esc(tip) + '</p></div>';
  }

  $('#dkSave', d.body.parentNode).onclick = () => {
    const name = ($('#dkN', d.body).value || '').trim() || '未命名饮品';
    const num = (id, def) => { const v = Number($('#' + id, d.body).value); return isFinite(v) && v >= 0 ? v : def; };
    const tRaw = $('#dkT', d.body).value;
    const at = tRaw ? new Date(tRaw).getTime() : Date.now();
    const item = {
      id: uid(), name,
      v: num('dkV', 0), c: num('dkC', 0), s: num('dkS', 0), k: num('dkK', 0),
      at: isFinite(at) ? at : Date.now()
    };
    // 记下数据来源，列表里可以标出来（official=官网实测，ai=AI 估算，manual=手填）
    const tags = [];
    if (src.k === 'official' || src.c === 'official') tags.push('official');
    if (src.s === 'ai' || src.k === 'ai' || src.c === 'ai') tags.push('ai');
    if (tags.length) item.src = tags;
    Store.mutate(db => { db.drinks = db.drinks || []; db.drinks.push(item); db.demo = false; });
    d.close(); renderDrinks();
    toast('ok', '已记录「' + name + '」', '', 2200);
    Store.checkBackupHint();
  };
  setTimeout(() => $('#dkN', d.body)?.select?.(), 320);
}
