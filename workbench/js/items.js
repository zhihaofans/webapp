/* ==========================================================================
   9. 物品管理器
   --------------------------------------------------------------------------
   记录个人物品（电子设备 / 化妆品 / 食品 / 药品 / 日用品），按分类显示
   各自关心的属性（保质期、保修期、开封日期…），并支持：
     · 条码扫码 + 商品信息查询（Open Food Facts / Open Beauty Facts，免费无 Key）
     · AI 拍照识别商品（视觉模型，把照片读成结构化字段）
     · AI 读条码（iOS 无原生 BarcodeDetector 时的兜底，让模型看图念出条码数字）

   设计原则：所有增强能力（扫码 / 识图）都必须在「用不了」时优雅退化到手工填写，
   绝不让任何一个入口点下去只有一句报错。所以每条路径都有三层兜底。
   ========================================================================== */

/** 物品模块的界面状态（只活在本次会话，不进 localStorage） */
const ITEM_UI = { cat: 'all', state: 'all', q: '', sort: 'exp' };

/* ------------------------------ 小工具 ------------------------------ */

/** 'YYYY-MM-DD' → 本地时间的当天 0 点（不能用 new Date(s)，那是 UTC） */
function ymdToDate(s){
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return isFinite(dt.getTime()) ? dt : null;
}
/** 今天的 0 点 */
function todayStart(){
  const d = new Date(); d.setHours(0, 0, 0, 0); return d;
}
/** 距今天还有多少天（负数=已过期）。传空返回 null */
function daysUntil(ymd){
  const d = ymdToDate(ymd);
  if (!d) return null;
  return Math.round((d - todayStart()) / 86400000);
}
/** 到期状态：level 决定配色，text 是给人看的一句话 */
function expInfo(it){
  const n = daysUntil(it.expAt);
  if (n === null) return { level: 'none', text: '', days: null };
  if (n < 0)  return { level: 'over', text: '已过期 ' + Math.abs(n) + ' 天', days: n };
  if (n === 0) return { level: 'over', text: '今天到期', days: 0 };
  if (n <= 7)  return { level: 'soon', text: '剩 ' + n + ' 天', days: n };
  if (n <= 30) return { level: 'warn', text: '剩 ' + n + ' 天', days: n };
  return { level: 'ok', text: '剩 ' + n + ' 天', days: n };
}
/** 物品是否「还需要留意」（在库 且 已过期或 7 天内到期） */
function itemNeedsCare(it){
  if (it.state !== 'in') return false;
  const e = expInfo(it);
  return e.days !== null && e.days <= 7;
}
/** 数量 + 单位的展示文本 */
function qtyText(it){
  const q = it.qty;
  return (Number.isInteger(q) ? q : Math.round(q * 100) / 100) + ' ' + (it.unit || '件');
}
/** 金额（¥，两位小数，整数不显示小数） */
function yuan(v){
  const n = Number(v) || 0;
  return '¥' + (Number.isInteger(n) ? n : n.toFixed(2));
}

/* ------------------------------ 主视图 ------------------------------ */

function renderItems(){
  const box = $('#view');
  if (!box) return;
  const all = Store.db.items || [];

  // ── 统计 ──
  const inStock = all.filter(i => i.state === 'in');
  const over = inStock.filter(i => { const e = expInfo(i); return e.days !== null && e.days < 0; });
  const soon = inStock.filter(i => { const e = expInfo(i); return e.days !== null && e.days >= 0 && e.days <= 7; });
  const value = all.reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 0), 0);
  const care = inStock.filter(itemNeedsCare)
    .sort((a, b) => (daysUntil(a.expAt) ?? 0) - (daysUntil(b.expAt) ?? 0));

  // ── 过滤 + 排序 ──
  let list = all.filter(i => {
    if (ITEM_UI.cat !== 'all' && i.cat !== ITEM_UI.cat) return false;
    if (ITEM_UI.state === 'care'){ if (!itemNeedsCare(i)) return false; }
    else if (ITEM_UI.state !== 'all' && i.state !== ITEM_UI.state) return false;
    if (ITEM_UI.q){
      const q = ITEM_UI.q.toLowerCase();
      const hay = [i.name, i.brand, i.note, i.channel, i.barcode].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  list = list.slice().sort((a, b) => {
    if (ITEM_UI.sort === 'new')  return (b.at || 0) - (a.at || 0);
    if (ITEM_UI.sort === 'price') return (Number(b.price) || 0) - (Number(a.price) || 0);
    if (ITEM_UI.sort === 'name') return String(a.name).localeCompare(String(b.name), 'zh');
    // 默认「按到期」：有到期日的排前面，越紧急越靠前；无到期日的沉底
    const da = daysUntil(a.expAt), db = daysUntil(b.expAt);
    if (da === null && db === null) return (b.at || 0) - (a.at || 0);
    if (da === null) return 1;
    if (db === null) return -1;
    return da - db;
  });

  const catTabs = [{ id: 'all', name: '全部', icon: 'box' }].concat(ITEM_CATS);
  const cntOf = id => id === 'all' ? all.length : all.filter(i => i.cat === id).length;

  box.innerHTML =
    // ── 工具条 ──
    '<div class="itm__bar">' +
      '<button class="btn btn--primary" id="itmAdd">' + ic('plus') + '添加物品</button>' +
      '<button class="btn" id="itmScan">' + ic('scan') + '扫码</button>' +
      '<button class="btn" id="itmCam">' + ic('cam') + '拍照识别</button>' +
      '<div class="itm__search">' + ic('search') +
        '<input id="itmQ" type="search" placeholder="搜名称 / 品牌 / 条码 / 备注" value="' + escAttr(ITEM_UI.q) + '">' +
      '</div>' +
    '</div>' +

    // ── 统计卡 ──
    '<div class="grid g-4 itm__stats">' +
      itmStat('在库物品', String(inStock.length), '件', '') +
      itmStat('7 天内到期', String(soon.length), '件', soon.length ? 'is-warn' : '') +
      itmStat('已过期', String(over.length), '件', over.length ? 'is-over' : '') +
      itmStat('物品总值', yuan(value), '', '') +
    '</div>' +

    // ── 需留意（呼应「今天要处理」：临期/过期置顶，每条给一键处理）──
    (care.length ?
      '<div class="card itm__warn"><div class="card__hd"><h3>' + ic('warn') + '需要留意</h3>' +
        '<span class="tag">' + care.length + ' 件</span></div>' +
        '<div class="card__bd itm__warnlist">' +
        care.slice(0, 8).map(i => {
          const e = expInfo(i);
          return '<div class="itm__wrow' + (e.level === 'over' ? ' is-over' : '') + '">' +
            itmThumb(i, 34) +
            '<div class="itm__wtx"><b>' + esc(i.name) + '</b>' +
              '<span>' + esc(e.text) + (i.brand ? ' · ' + esc(i.brand) : '') + '</span></div>' +
            '<button class="btn btn--sm" data-use="' + escAttr(i.id) + '">已用完</button>' +
            '<button class="btn btn--sm btn--ghost" data-edit="' + escAttr(i.id) + '">改日期</button>' +
          '</div>';
        }).join('') +
        (care.length > 8 ? '<p class="hint">还有 ' + (care.length - 8) + ' 件，见下方列表。</p>' : '') +
        '</div></div>' : '') +

    // ── 分类 chips ──
    '<div class="itm__cats">' +
      catTabs.map(c =>
        '<button class="itm__chip' + (ITEM_UI.cat === c.id ? ' is-on' : '') + '" data-cat="' + c.id + '">' +
        ic(c.icon || 'box') + esc(c.name) +
        '<em>' + cntOf(c.id) + '</em></button>').join('') +
    '</div>' +

    // ── 状态筛选 + 排序 ──
    '<div class="itm__filters">' +
      '<div class="seg" id="itmState">' +
        ['all:全部', 'care:需留意', 'in:在用', 'out:已用完', 'gone:已丢弃'].map(s => {
          const [k, n] = s.split(':');
          return '<button data-s="' + k + '"' + (ITEM_UI.state === k ? ' class="is-on"' : '') + '>' + n + '</button>';
        }).join('') +
      '</div>' +
      '<label class="itm__sort"><span>排序</span>' +
        '<select id="itmSort">' +
          ['exp:按到期', 'new:最近添加', 'price:按价格', 'name:按名称'].map(s => {
            const [k, n] = s.split(':');
            return '<option value="' + k + '"' + (ITEM_UI.sort === k ? ' selected' : '') + '>' + n + '</option>';
          }).join('') +
        '</select></label>' +
    '</div>' +

    // ── 列表 ──
    (list.length
      ? '<div class="itm__grid">' + list.map(itmCard).join('') + '</div>'
      : '<div class="empty">' + ic('box') +
        '<p>' + (all.length ? '没有符合条件的物品' : '还没有记录任何物品') + '</p>' +
        '<small>' + (all.length ? '换个分类或清空搜索词试试。' : '点上方「添加物品」，或用「扫码」「拍照识别」快速录入。') + '</small>' +
        (all.length ? '' : '<div style="margin-top:14px"><button class="btn btn--sm btn--primary" id="itmAdd2">' + ic('plus') + '添加物品</button></div>') +
        '</div>');

  /* ---------------------------- 事件绑定 ---------------------------- */
  // 注意：这里不能把包装函数命名成 go —— 全局的 go() 是路由函数，
  // 局部同名会把它遮住，将来在本函数里调 go('xxx') 会静默失效。
  const stop = (fn) => (e) => { e.stopPropagation(); fn(); };

  $('#itmAdd').onclick = () => openItemEditor(null);
  if ($('#itmAdd2')) $('#itmAdd2').onclick = () => openItemEditor(null);
  $('#itmScan').onclick = () => openScanSheet();
  $('#itmCam').onclick = () => openPhotoSheet();

  const qIn = $('#itmQ');
  let qTimer = null;
  qIn.oninput = () => {
    // 防抖：输入时不整页重渲染（会丢焦点），停 260ms 再刷
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      ITEM_UI.q = qIn.value.trim();
      renderItems();
      const again = $('#itmQ');
      if (again){ again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
    }, 260);
  };

  $$('.itm__chip[data-cat]').forEach(b => b.onclick = () => { ITEM_UI.cat = b.dataset.cat; renderItems(); });
  $$('#itmState button').forEach(b => b.onclick = () => { ITEM_UI.state = b.dataset.s; renderItems(); });
  $('#itmSort').onchange = (e) => { ITEM_UI.sort = e.target.value; renderItems(); };

  $$('[data-edit]').forEach(b => b.onclick = stop(() => openItemEditor(b.dataset.edit)));
  $$('[data-use]').forEach(b => b.onclick = stop(() => {
    const it = (Store.db.items || []).find(x => x.id === b.dataset.use);
    if (!it) return;
    Store.mutate(db => { const t = db.items.find(x => x.id === it.id); if (t) t.state = 'out'; });
    renderItems();
    toast('ok', '已标记「' + it.name + '」用完', '', 2400);
  }));

  $$('.itm__card').forEach(c => c.onclick = () => openItemDetail(c.dataset.id));
}

/** 统计小卡 */
function itmStat(label, val, unit, cls){
  return '<div class="card itm__stat ' + cls + '"><span>' + esc(label) + '</span>' +
    '<b>' + esc(val) + (unit ? '<i>' + esc(unit) + '</i>' : '') + '</b></div>';
}

/** 缩略图：有照片显示照片，否则显示分类图标 */
function itmThumb(it, size){
  const s = size || 44;
  if (it.photo){
    return '<span class="itm__ph" style="width:' + s + 'px;height:' + s + 'px">' +
      '<img src="' + escAttr(it.photo) + '" alt="" loading="lazy"></span>';
  }
  const c = itemCat(it.cat);
  return '<span class="itm__ph itm__ph--' + c.color + '" style="width:' + s + 'px;height:' + s + 'px">' +
    ic(c.icon) + '</span>';
}

/** 单张物品卡 */
function itmCard(it){
  const c = itemCat(it.cat);
  const e = expInfo(it);
  const dead = it.state !== 'in';
  return '<article class="itm__card' + (dead ? ' is-dead' : '') + '" data-id="' + escAttr(it.id) + '">' +
    '<div class="itm__cdtop">' + itmThumb(it, 44) +
      '<div class="itm__cdhd">' +
        '<b class="itm__nm">' + esc(it.name) + '</b>' +
        '<span class="itm__brand">' + esc(it.brand || c.name) + (it.brand ? ' · ' + esc(c.name) : '') + '</span>' +
      '</div>' +
    '</div>' +
    '<div class="itm__cdmeta">' +
      '<span class="itm__pill itm__pill--' + c.color + '">' + esc(c.name) + '</span>' +
      (it.qty != null ? '<span class="itm__qty">' + esc(qtyText(it)) + '</span>' : '') +
      (it.price ? '<span class="itm__price">' + esc(yuan(it.price)) + '</span>' : '') +
    '</div>' +
    (dead
      ? '<div class="itm__cdft itm__cdft--dead">' + esc(ITEM_STATES.find(s => s.id === it.state).name) + '</div>'
      : (e.days !== null
          ? '<div class="itm__cdft itm__exp--' + e.level + '">' + ic(e.level === 'over' ? 'warn' : 'clock') + esc(e.text) + '</div>'
          : '<div class="itm__cdft itm__cdft--none">未设到期日</div>')) +
    (it.src !== 'manual'
      ? '<span class="itm__srctag" title="' + (it.src === 'scan' ? '条码查询录入' : 'AI 识别录入') + '">' +
        (it.src === 'scan' ? '扫码' : 'AI') + '</span>' : '') +
  '</article>';
}

/* ------------------------------ 图片压缩 ------------------------------ */

/**
 * 把用户选的照片压成可直接存 localStorage 的 data URL。
 *
 * 为什么要压：localStorage 总量通常只有 5MB，手机直出照片动辄 3~5MB，
 * 一张就能把配额撑满（然后整个应用写不进去）。压到 800px 宽 + JPEG 0.72
 * 一般能到 60~150KB，够看清是什么东西，又不至于炸库。
 *
 * 为什么不用 canvas.toBlob：toBlob 是异步回调，这里用同步的 toDataURL 更好串进
 * Promise 链，且 JPEG 编码结果两者一致。
 */
function compressImage(file, maxW, quality){
  maxW = maxW || 800; quality = quality || 0.72;
  return new Promise((resolve, reject) => {
    if (!file) { reject(new Error('没有选择图片')); return; }
    if (!/^image\//.test(file.type || '')){ reject(new Error('这不是图片文件')); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        let w = img.naturalWidth, h = img.naturalHeight;
        if (!w || !h) throw new Error('图片尺寸异常');
        if (w > maxW){ h = Math.max(1, Math.round(h * maxW / w)); w = maxW; }
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        const out = cv.toDataURL('image/jpeg', quality);
        resolve({ data: out, w, h });
      } catch (e){ URL.revokeObjectURL(url); reject(e); }
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('无法读取这张图片')); };
    img.src = url;
  });
}

/** 弹出选图（拍照或从相册），返回压缩后的 data URL（取消则 resolve(null)） */
function pickImage(){
  return new Promise(resolve => {
    const fi = document.createElement('input');
    fi.type = 'file';
    fi.accept = 'image/*';
    // capture 让手机直接唤起相机；桌面端会退化成普通文件选择
    fi.setAttribute('capture', 'environment');
    fi.style.display = 'none';
    document.body.appendChild(fi);
    let settled = false;
    const done = v => { if (!settled){ settled = true; fi.remove(); resolve(v); } };
    fi.onchange = async () => {
      const f = fi.files && fi.files[0];
      if (!f){ done(null); return; }
      try { done(await compressImage(f)); }
      catch (e){ toast('err', '图片处理失败', e.message); done(null); }
    };
    // 用户取消时 change 不会触发，靠 focus 回来后的延时兜底关掉
    window.addEventListener('focus', () => setTimeout(() => { if (!settled && !(fi.files && fi.files.length)) done(null); }, 800), { once: true });
    fi.click();
  });
}

/* ------------------------------ 字段标签 ------------------------------ */

/** 按分类解析字段显示名（同一个 key 在不同分类下叫法不一样） */
function fieldLabel(cat, key){
  if (key === 'expAt') return cat.expLabel;
  if (key === cat.madeKey) return cat.madeLabel;
  return {
    buyAt: '购买日期', madeAt: '生产日期', expAt: '到期日期',
    qty: '数量', price: '价格', channel: '购买渠道', barcode: '条形码', note: '备注'
  }[key] || key;
}

/* ------------------------------ 物品详情 ------------------------------ */

function openItemDetail(id){
  const it = (Store.db.items || []).find(x => x.id === id);
  if (!it) return;
  const c = itemCat(it.cat);
  const e = expInfo(it);
  const rows = [];
  const push = (label, val) => { if (val !== '' && val != null) rows.push([label, val]); };

  push('分类', c.name);
  push('品牌', it.brand);
  push('数量', qtyText(it));
  rows.push([fieldLabel(c, 'buyAt'), it.buyAt || '—']);
  if (c.madeKey === 'madeAt') push('生产日期', it.madeAt);
  rows.push([c.expLabel, it.expAt || '—']);
  if (it.expAt) rows.push(['到期状态', e.text]);
  push('条形码', it.barcode);
  push('购买渠道', it.channel);
  push('价格', it.price ? yuan(it.price) : '');
  push('录入方式', it.src === 'scan' ? '条码查询' : it.src === 'ai' ? 'AI 识别' : '手动录入');
  push('备注', it.note);

  const d = drawer({
    title: it.name,
    sub: (it.brand ? it.brand + ' · ' : '') + c.name,
    body:
      (it.photo ? '<img class="itm__bigph" src="' + escAttr(it.photo) + '" alt="">' : '') +
      '<div class="itm__stateRow">' +
        ITEM_STATES.map(s => '<button class="itm__stbtn' + (it.state === s.id ? ' is-on' : '') +
          '" data-st="' + s.id + '">' + esc(s.name) + '</button>').join('') +
      '</div>' +
      '<dl class="itm__dl">' + rows.map(r =>
        '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd></div>').join('') + '</dl>' +
      '<div class="row" style="margin-top:14px">' +
        '<button class="btn" id="itmDScan">' + ic('scan') + '扫码查同款</button>' +
        '<button class="btn" id="itmDCam">' + ic('cam') + 'AI 识别</button>' +
      '</div>',
    foot: '<button class="btn btn--danger" id="itmDDel">' + ic('trash') + '删除</button>' +
          '<button class="btn btn--primary" id="itmDEdit">' + ic('edit') + '编辑</button>'
  });

  $$('.itm__stbtn', d.body).forEach(b => b.onclick = () => {
    const st = b.dataset.st;
    Store.mutate(db => { const t = db.items.find(x => x.id === it.id); if (t) t.state = st; });
    d.close(); renderItems();
    toast('ok', '已改为「' + ITEM_STATES.find(s => s.id === st).name + '」', '', 2200);
  });

  $('#itmDEdit', d.foot).onclick = () => { d.close(); openItemEditor(it.id); };
  $('#itmDScan', d.body).onclick = () => { d.close(); openScanSheet(); };
  $('#itmDCam', d.body).onclick = () => { d.close(); openPhotoSheet(); };
  $('#itmDDel', d.foot).onclick = () => {
    modal({
      title: '删除物品', desc: '「' + it.name + '」将从本机移除，此操作不可撤销。',
      okText: '确认删除', danger: true,
      onOk: () => { Store.mutate(db => { db.items = db.items.filter(x => x.id !== it.id); }); d.close(); renderItems(); toast('ok', '已删除'); }
    });
  };
}

/* ------------------------------ 物品编辑器 ------------------------------ */

/**
 * 新增 / 编辑物品。
 * preset 用于「扫码」「AI 识别」拿到信息后直接带出来（形如 { name, brand, barcode… }）。
 * opts.autoAI = true 时，打开后自动对已有照片跑一次识别（工具栏「拍照识别」用）。
 */
function openItemEditor(id, preset, opts){
  opts = opts || {};
  const editing = id ? (Store.db.items || []).find(x => x.id === id) : null;
  if (id && !editing) return;
  const base = editing ? { ...editing } : (preset ? { ...preset } : {});
  let cat = itemCat(base.cat || (preset && preset.cat) || 'other').id;
  let photo = base.photo || '';

  const d = drawer({
    title: editing ? '编辑物品' : '添加物品',
    sub: editing ? editing.name : '手动填写，或用扫码 / 拍照识别快速录入',
    body: itmFormHTML(base, cat, photo),
    foot: '<button class="btn" id="itmECancel">取消</button>' +
          '<button class="btn btn--primary" id="itmESave">' + ic('check') + (editing ? '保存' : '添加') + '</button>'
  });

  /* ---- 分类切换：换分类要重画字段区（不同分类字段不一样）---- */
  $$('.itm__catpick button', d.body).forEach(b => b.onclick = () => {
    // 先把已填的值读出来，重画后写回去，避免切分类把用户输入清空
    const keep = readForm(d.body);
    cat = b.dataset.c;
    const fields = d.body.querySelector('#itmFields');
    fields.outerHTML = itmFieldsWrap(cat, keep);
    $$('.itm__catpick button', d.body).forEach(x => x.classList.toggle('is-on', x.dataset.c === cat));
    paintCatHint(d.body, cat);   // 这句提示也要跟着换，否则会停在旧分类的字段说明上
    bindPhoto(d.body, () => photo, v => { photo = v; });
    bindFieldBtns();   // 字段区是新的，条码按钮要重新绑
  });
  bindPhoto(d.body, () => photo, v => { photo = v; });

  /* ---- 条码：就地查商品信息 / 扫码填入 ----
     必须包成函数并在每次重画字段区之后重新调用：
     #itmBcLook、#itmBcScan 都在 #itmFields 内部，切分类时整块 outerHTML 替换会把
     旧按钮连同事件一起丢掉 —— 不重绑就会出现「切过分类之后扫码/查信息按钮点了没反应」。 */
  function bindFieldBtns(){
    const bcBtn = $('#itmBcLook', d.body);
    if (bcBtn) bcBtn.onclick = async () => {
      const code = ($('#itmBarcode', d.body)?.value || '').trim();
      if (!code){ toast('warn', '先填或扫一个条码'); return; }
      bcBtn.disabled = true;
      const old = bcBtn.innerHTML;
      bcBtn.innerHTML = ic('refresh', 'spin') + '查询中…';
      try {
        const r = await lookupBarcode(code);
        if (!r){ toast('warn', '没查到', '这个条码不在公开商品库里，手动填一下吧。', 4000); return; }
        fillForm(d.body, r);
        toast('ok', '已查到「' + (r.name || code) + '」', '数据来自 ' + r.from + '，请核对后保存。', 5000);
      } catch (e){
        toast('warn', '查询失败', e.message + '，可以手动填写。', 4500);
      } finally { bcBtn.disabled = false; bcBtn.innerHTML = old; }
    };

    const bcScan = $('#itmBcScan', d.body);
    if (bcScan) bcScan.onclick = () => {
      openScanSheet(code => {
        const el = $('#itmBarcode', d.body);
        if (el && code){ el.value = code; }
      });
    };
  }
  bindFieldBtns();

  /* ---- AI 识别：拍照（或直接用已有照片）→ 回填 ---- */
  const aiBtn = $('#itmAiFill', d.body);

  /** 跑一次识别。allowPick=false 时只用已有照片（自动流程用，不再弹一次选图） */
  async function runAI(allowPick){
    if (!photo){
      if (!allowPick){ toast('warn', '还没有照片', '先选一张商品照片再让 AI 识别。'); return; }
      const picked = await pickImage();
      if (!picked) return;
      photo = picked.data;
      paintPhoto(d.body, photo);
    }
    if (!aiBtn) return;
    aiBtn.disabled = true;
    const old = aiBtn.innerHTML;
    aiBtn.innerHTML = ic('refresh', 'spin') + '识别中…';
    const out = $('#itmAiOut', d.body);
    if (out) out.innerHTML = '<div class="itm__ainote">' + ic('spark') +
      '<div><b>正在识别…</b><span>需要 10~30 秒，稍等一下</span></div></div>';
    try {
      const r = await aiReadProduct(photo);
      fillForm(d.body, r);
      if (r.cat){
        // 分类变了要连带重画字段区，否则新分类的字段出不来
        cat = itemCat(r.cat).id;
        d.body.querySelector('#itmFields').outerHTML = itmFieldsWrap(cat, readForm(d.body));
        $$('.itm__catpick button', d.body).forEach(x => x.classList.toggle('is-on', x.dataset.c === cat));
        paintCatHint(d.body, cat);
        bindPhoto(d.body, () => photo, v => { photo = v; });
        bindFieldBtns();
      }
      if (out) out.innerHTML = '<div class="itm__ainote">' + ic('spark') +
        '<div><b>AI 识别完成' + (r.model ? ' · ' + esc(r.model) : '') + '</b>' +
        '<span>' + esc(r.basis || '已按图片填写') + ' · 请核对后再保存</span></div></div>';
    } catch (e){
      if (out) out.innerHTML = '<div class="itm__ainote itm__ainote--err">' + ic('warn') +
        '<div><b>识别失败</b><span>' + esc(e.message || '未知错误') + '</span></div></div>';
    } finally {
      aiBtn.disabled = false;
      aiBtn.innerHTML = old;
    }
  }

  if (aiBtn) aiBtn.onclick = () => runAI(true);
  // 从「拍照识别」工具入口进来时自动跑一次（照片已经在了）
  if (opts.autoAI) setTimeout(() => runAI(false), 400);

  /* ---- 保存 ---- */
  $('#itmECancel', d.foot).onclick = () => d.close();
  $('#itmESave', d.foot).onclick = () => {
    const f = readForm(d.body);
    if (!f.name){ toast('warn', '名称不能为空', '给这个物品起个名字吧。'); return; }
    const item = {
      id: editing ? editing.id : uid(),
      name: f.name, cat, brand: f.brand,
      qty: f.qty === '' ? 1 : Math.max(0, Number(f.qty) || 0),
      unit: f.unit || '件',
      buyAt: f.buyAt, madeAt: f.madeAt, expAt: f.expAt,
      barcode: f.barcode, channel: f.channel,
      price: Math.max(0, Number(f.price) || 0),
      note: f.note, photo,
      state: editing ? editing.state : 'in',
      src: base.src || 'manual',
      at: editing ? editing.at : Date.now()
    };
    Store.mutate(db => {
      db.items = db.items || [];
      if (editing){ db.items = db.items.map(x => x.id === editing.id ? item : x); }
      else { db.items.push(item); db.demo = false; }
    });
    d.close(); renderItems();
    toast('ok', editing ? '已保存' : '已添加「' + item.name + '」', '', 2400);
    Store.checkBackupHint();
  };

  setTimeout(() => $('#itmName', d.body)?.focus?.(), 300);
}

/* ------------------------------ 表单构件 ------------------------------ */

/** 物品表单的完整 HTML（分类选择 + 名称 + 照片 + 分类相关字段 + AI 输出区） */
function itmFormHTML(base, cat, photo){
  return '<div class="stack">' +
      '<div class="itm__phrow">' +
        '<div class="itm__phbox" id="itmPhBox">' + itmPhotoInner(photo, base.cat || cat) + '</div>' +
        '<div class="itm__phbtns">' +
          '<button class="btn btn--sm" id="itmPhPick">' + ic('cam') + '照片</button>' +
          '<button class="btn btn--sm btn--ghost" id="itmPhDel">' + ic('x') + '删除照片</button>' +
          '<p class="hint" id="itmPhHint">照片会自动压缩后存在本机，不上传服务器（AI 识别时才会把这张图发给模型）。</p>' +
        '</div>' +
      '</div>' +

      '<div class="sect"><h4>分类</h4>' +
        '<div class="itm__catpick">' +
          ITEM_CATS.map(c => '<button type="button" data-c="' + c.id + '"' +
            (c.id === cat ? ' class="is-on"' : '') + '>' + ic(c.icon) + esc(c.name) + '</button>').join('') +
        '</div>' +
        '<p class="hint" id="itmCatHint">' + catHintText(cat) + '</p>' +
      '</div>' +

      '<div class="sect"><h4>基本信息</h4>' +
        '<label class="fld"><span>名称 <i class="req">必填</i></span>' +
          '<input id="itmName" type="text" maxlength="60" placeholder="例如：维生素 C 泡腾片" value="' + escAttr(base.name || '') + '"></label>' +
        '<label class="fld"><span>品牌</span>' +
          '<input id="itmBrand" type="text" maxlength="40" placeholder="例如：力度伸" value="' + escAttr(base.brand || '') + '"></label>' +
      '</div>' +

      '<div id="itmFields">' + itmFieldsHTML(cat, base) + '</div>' +

      '<div class="itm__aiblock">' +
        '<button class="btn btn--block" id="itmAiFill">' + ic('spark') + 'AI 识别照片，自动填写</button>' +
        '<p class="hint">拍一张商品正脸（能拍到品名/规格最好），让模型读出名称、品牌、分类与规格。需默认 AI 支持看图。</p>' +
      '</div>' +
      '<div id="itmAiOut"></div>' +
    '</div>';
}

/**
 * 分类提示文案。必须和字段区一起更新 —— 只换字段不换提示的话，
 * 切到「化妆品」后上方还会写着「购入日期、数量」这种旧分类的说明，自相矛盾。
 */
function catHintText(catId){
  const c = itemCat(catId);
  return esc(c.name) + ' 关心的字段：' +
    esc(c.fields.map(k => fieldLabel(c, k)).slice(0, 5).join('、')) + ' 等。';
}
function paintCatHint(scope, catId){
  const el = $('#itmCatHint', scope);
  if (el) el.innerHTML = catHintText(catId);
}

/** 照片预览区内容 */
function itmPhotoInner(photo, catId){
  if (photo && /^data:image\//.test(photo)){
    return '<img src="' + escAttr(photo) + '" alt="">';
  }
  const c = itemCat(catId);
  return '<span class="itm__phicon">' + ic(c.icon) + '</span>';
}

/**
 * 带容器 id 的字段区包装。
 *
 *  切分类时要整块替换 #itmFields，如果用 itmFieldsHTML 的返回值（它是 <div class="sect">）
 *  直接 outerHTML 赋值，id 会跟着消失 —— 第二次切分类就找不到 #itmFields，
 *  表现为「只能切一次分类，之后再点没反应」。必须把 id 一起带上。
 */
function itmFieldsWrap(catId, v){
  return '<div id="itmFields">' + itmFieldsHTML(catId, v) + '</div>';
}

/** 分类相关字段区的内层内容（外层容器与 id 由调用方负责） */
function itmFieldsHTML(catId, v){
  const c = itemCat(catId);
  v = v || {};
  const out = [];

  for (const k of c.fields){
    if (k === 'qty'){
      const units = ['件', '个', '盒', '瓶', '袋', '包', '支', '片', '卷', '台', '双', '张', 'kg', 'g', 'ml', 'L'];
      out.push('<div class="row">' +
        '<label class="fld" style="flex:1"><span>数量</span>' +
          '<input id="itmQty" type="number" inputmode="decimal" min="0" step="1" value="' + escAttr(v.qty != null && v.qty !== '' ? v.qty : 1) + '"></label>' +
        '<label class="fld" style="flex:1"><span>单位</span>' +
          '<input id="itmUnit" type="text" list="itmUnits" maxlength="8" value="' + escAttr(v.unit || '件') + '"></label>' +
        '<datalist id="itmUnits">' + units.map(u => '<option value="' + u + '">').join('') + '</datalist>' +
      '</div>');
    } else if (k === 'price'){
      out.push('<label class="fld"><span>价格 (¥)</span>' +
        '<input id="itmPrice" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0.00" value="' + escAttr(v.price ? v.price : '') + '"></label>');
    } else if (k === 'channel'){
      out.push('<label class="fld"><span>购买渠道</span>' +
        '<input id="itmChannel" type="text" maxlength="40" placeholder="例如：京东 / 盒马 / 天猫国际" value="' + escAttr(v.channel || '') + '"></label>');
    } else if (k === 'barcode'){
      out.push('<label class="fld"><span>条形码</span>' +
        '<input id="itmBarcode" type="text" inputmode="numeric" maxlength="32" placeholder="扫码或手动输入数字" value="' + escAttr(v.barcode || '') + '"></label>' +
        '<div class="row row--tight" style="margin-top:-4px">' +
          '<button type="button" class="btn btn--sm" id="itmBcScan">' + ic('scan') + '扫码</button>' +
          '<button type="button" class="btn btn--sm btn--ghost" id="itmBcLook">' + ic('search') + '查商品信息</button>' +
        '</div>' +
        '<p class="hint">条码查询走 Open Food Facts 公开库（食品 / 饮料 / 个护收录较多，电子产品基本查不到，那种就手动填）。</p>');
    } else if (k === 'note'){
      out.push('<label class="fld"><span>备注</span>' +
        '<textarea id="itmNote" rows="2" maxlength="300" placeholder="存放位置、用法、发票在哪…">' + esc(v.note || '') + '</textarea></label>');
    } else {
      // 日期类：buyAt / madeAt / expAt
      out.push('<label class="fld"><span>' + esc(fieldLabel(c, k)) + '</span>' +
        '<input id="itm' + k.charAt(0).toUpperCase() + k.slice(1) + '" type="date" value="' + escAttr(v[k] || '') + '"></label>');
    }
  }
  return '<div class="sect"><h4>' + esc(c.name) + ' · 属性</h4>' + out.join('') + '</div>';
}

/** 读出表单里所有字段（元素不存在时给空串，切分类后字段会变少） */
function readForm(scope){
  const val = id => { const e = $('#' + id, scope); return e ? String(e.value || '').trim() : ''; };
  return {
    name: val('itmName'), brand: val('itmBrand'),
    qty: val('itmQty'), unit: val('itmUnit'),
    buyAt: val('itmBuyAt'), madeAt: val('itmMadeAt'), expAt: val('itmExpAt'),
    barcode: val('itmBarcode').replace(/[^0-9A-Za-z]/g, ''),
    channel: val('itmChannel'), price: val('itmPrice'), note: val('itmNote')
  };
}

/** 把查到的信息写回表单；只写「有值且表单里存在」的字段，绝不覆盖成空 */
function fillForm(scope, r){
  const set = (id, v) => {
    if (v === '' || v == null) return;
    const e = $('#' + id, scope);
    if (e) e.value = v;
  };
  set('itmName', r.name);
  set('itmBrand', r.brand);
  set('itmBarcode', r.barcode);
  set('itmPrice', r.price);
  set('itmChannel', r.channel);
  set('itmNote', r.note);
  if (r.qty != null) set('itmQty', r.qty);
  if (r.unit) set('itmUnit', r.unit);
  set('itmExpAt', r.expAt);
  set('itmMadeAt', r.madeAt);
  set('itmBuyAt', r.buyAt);
}

/** 重画照片预览 */
function paintPhoto(scope, photo){
  const box = $('#itmPhBox', scope);
  if (!box) return;
  const catId = ($$('.itm__catpick button', scope).find(b => b.classList.contains('is-on')) || {}).dataset?.c || 'other';
  box.innerHTML = itmPhotoInner(photo, catId);
}

/** 绑定照片区的三个按钮 */
function bindPhoto(scope, getPhoto, setPhoto){
  const pick = $('#itmPhPick', scope);
  const del = $('#itmPhDel', scope);
  if (pick) pick.onclick = async () => {
    const r = await pickImage();
    if (!r) return;
    setPhoto(r.data);
    paintPhoto(scope, r.data);
    toast('ok', '照片已压缩到 ' + r.w + '×' + r.h, '约 ' + Math.round(r.data.length / 1024) + 'KB', 3200);
  };
  if (del) del.onclick = () => { setPhoto(''); paintPhoto(scope, ''); };
}

/* ------------------------------ 条码商品查询 ------------------------------ */

/**
 * 商品公开库。两个都是 Open*Facts 同一套基础设施：
 *   · 免费、无需 API Key、带 CORS（access-control-allow-origin: *）
 *   · 数据由社区维护，食品饮料覆盖最好，中文条码也有不少
 * 电子产品、奢侈品基本查不到 —— 这是数据源的客观限制，不是实现问题，
 * 所以查不到时直接引导手填，不做无意义的多次重试。
 */
const BARCODE_LIBS = [
  { id: 'food',   name: 'Open Food Facts',   host: 'https://world.openfoodfacts.org' },
  { id: 'beauty', name: 'Open Beauty Facts', host: 'https://world.openbeautyfacts.org' }
];

/** 用库返回的分类文本猜一个我们的分类 id */
function guessCatFromText(txt){
  const s = String(txt || '').toLowerCase();
  if (/cosmetic|skincare|shampoo|makeup|beauty|sunscreen|toothpaste|soap|deodorant|perfume|化妆品|护肤|洗发|牙膏|香皂/.test(s)) return 'cosmetic';
  if (/medicine|pharma|drug|supplement|vitamin|tablet|pills|药品|保健|维生素/.test(s)) return 'medicine';
  if (/beverage|drink|food|snack|dairy|cereal|sauce|noodle|coffee|tea|juice|water|milk|食品|饮料|零食|乳|茶|咖啡|水/.test(s)) return 'food';
  if (/household|detergent|cleaner|paper|日用品|清洁|纸巾/.test(s)) return 'daily';
  if (/electronic|battery|cable|charger|phone|电脑|电子|充电|数据线/.test(s)) return 'device';
  return '';
}

/**
 * 按条码查商品信息。查到返回结构化对象，查不到返回 null（不抛错）。
 * 依次试两个库，命中即返回；网络异常也继续试下一个，全失败才返回 null。
 */
async function lookupBarcode(code){
  code = String(code || '').replace(/[^0-9A-Za-z]/g, '');
  if (!code) return null;
  for (const lib of BARCODE_LIBS){
    try {
      const url = lib.host + '/api/v2/product/' + encodeURIComponent(code) +
        '.json?fields=product_name,product_name_zh,brands,quantity,categories,image_front_small_url';
      const d = await jjson(url, {}, 12000);
      if (d && d.status === 1 && d.product){
        const p = d.product;
        const name = String(p.product_name_zh || p.product_name || '').trim();
        if (!name && !p.brands) continue;
        const cats = [p.categories, p.product_name, p.product_name_zh].filter(Boolean).join(' ');
        return {
          name, brand: String(p.brands || '').split(',')[0].trim(),
          barcode: code,
          qty: null, unit: '',
          cat: guessCatFromText(cats) || 'food',
          note: p.quantity ? '规格：' + String(p.quantity).slice(0, 40) : '',
          from: lib.name, imageUrl: p.image_front_small_url || ''
        };
      }
    } catch (e){ /* 这个库挂了或没收录，试下一个 */ }
  }
  return null;
}

/* ------------------------------ 扫码 ------------------------------ */

/** 原生条码识别是否可用（Chrome/Edge on Android & 桌面支持；Safari 目前不支持） */
function hasBarcodeDetector(){
  return typeof window.BarcodeDetector === 'function';
}
/** 想要支持的条码格式（商品条码为主，附带 code128 兼容内部码） */
const WANT_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'codabar'];

/**
 * 打开扫码面板。
 *   onDone 有值 → 只把扫到的码回调出去（从编辑器里点「扫码」进来）
 *   onDone 无值 → 扫到后自动查商品库并打开新建编辑器（从工具栏进来）
 */
function openScanSheet(onDone){
  const inline = typeof onDone === 'function';
  let stream = null, timer = null, finished = false;

  const d = drawer({
    title: '扫码录入',
    sub: hasBarcodeDetector() ? '对准条形码，识别到会自动填入' : '此浏览器不支持实时扫码，可用拍照或手动输入',
    body:
      (hasBarcodeDetector()
        ? '<div class="itm__camwrap">' +
            '<video id="itmCam" playsinline muted></video>' +
            '<div class="itm__camfra"></div>' +
            '<div class="itm__camst" id="itmCamSt">正在启动相机…</div>' +
          '</div>'
        : '<div class="itm__camwrap itm__camwrap--off">' + ic('scan') +
            '<p>当前浏览器没有提供原生条码识别能力</p>' +
            '<small>Safari（含 iOS）尚未支持。可以用下面的「拍照读码」让 AI 念出条码数字，或直接手动输入。</small>' +
          '</div>') +

      '<div class="sect"><h4>其他方式</h4>' +
        '<div class="stack--sm">' +
          '<button class="btn btn--block" id="itmScanPhoto">' + ic('cam') + '拍照读码（AI 认数字）</button>' +
          '<button class="btn btn--block" id="itmScanManual">' + ic('edit') + '手动输入条码</button>' +
        '</div>' +
        '<div id="itmScanOut"></div>' +
      '</div>' +
      '<p class="hint">条码只用来在本机查公开商品库，不会上传到任何地方（走 AI 读码时会把照片发给模型）。</p>',
    foot: '<button class="btn" id="itmScanClose">关闭</button>'
  });

  const out = $('#itmScanOut', d.body);
  const st = $('#itmCamSt', d.body);

  /** 拿到条码后的统一出口 */
  async function accept(code){
    if (finished) return;
    code = String(code || '').replace(/[^0-9A-Za-z]/g, '');
    if (!code){ toast('warn', '没识别到条码', '换个角度或光线再试。'); return; }
    finished = true;
    cleanup();
    try { navigator.vibrate && navigator.vibrate(30); } catch (e){}
    if (inline){ onDone(code); d.close(); toast('ok', '已填入条码 ' + code, '', 2600); return; }

    // 从工具栏进来：查库 → 打开编辑器（查不到也打开，只是不带信息）
    out.innerHTML = '<div class="itm__ainote">' + ic('refresh', 'spin') +
      '<div><b>正在查商品库…</b><span>条码 ' + esc(code) + '</span></div></div>';
    let r = null;
    try { r = await lookupBarcode(code); }
    catch (e){ /* 忽略，走「查不到」分支 */ }
    d.close();
    if (r){
      openItemEditor(null, { ...r, src: 'scan', barcode: code });
      toast('ok', '查到「' + r.name + '」', '来自 ' + r.from + '，核对后保存。', 5000);
    } else {
      openItemEditor(null, { barcode: code, src: 'scan' });
      toast('warn', '公开库里没有这个条码', '已把条码填好，其余信息手动补一下。', 5000);
    }
  }

  function cleanup(){
    try { if (timer) clearInterval(timer); } catch (e){}
    timer = null;
    try { if (stream) stream.getTracks().forEach(t => t.stop()); } catch (e){}
    stream = null;
    const v = $('#itmCam', d.body);
    if (v) { try { v.srcObject = null; } catch (e){} }
  }

  d.onClose = cleanup;
  $('#itmScanClose', d.foot).onclick = () => d.close();

  /* ---- 实时扫码 ---- */
  if (hasBarcodeDetector()){
    (async () => {
      const video = $('#itmCam', d.body);
      if (!video) return;
      try {
        const formats = await window.BarcodeDetector.getSupportedFormats().catch(() => []);
        const want = WANT_FORMATS.filter(f => !formats.length || formats.includes(f));
        const det = new window.BarcodeDetector(want.length ? { formats: want } : undefined);
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        });
        video.srcObject = stream;
        await video.play();
        if (st) st.textContent = '对准条形码，保持稳定';
        // 每 180ms 解码一次：比 requestAnimationFrame 省电，识别速度也够用
        timer = setInterval(async () => {
          if (finished) return;
          try {
            const codes = await det.detect(video);
            if (codes && codes.length && codes[0].rawValue) accept(codes[0].rawValue);
          } catch (e){ /* 单帧失败忽略 */ }
        }, 180);
      } catch (e){
        if (st) st.textContent = '相机打不开：' + (e && e.message ? e.message : '未知原因');
        if (out) out.innerHTML = '<div class="itm__ainote itm__ainote--err">' + ic('warn') +
          '<div><b>无法使用相机</b><span>' + esc(e && e.message || '') +
          ' —— 可能是没授权、被其它应用占用，或当前不是 https。用下面的方式也能录入。</span></div></div>';
      }
    })();
  }

  /* ---- 拍照读码：先试原生 detect(图片)，不行再让 AI 念数字 ---- */
  $('#itmScanPhoto', d.body).onclick = async () => {
    const img = await pickImage();
    if (!img) return;
    out.innerHTML = '<div class="itm__ainote">' + ic('refresh', 'spin') + '<div><b>正在读取条码…</b><span>先本地解码，不行再交给 AI</span></div></div>';

    // ① 本地解码（Chrome 系有 BarcodeDetector 时可用，不用消耗 API 额度）
    if (hasBarcodeDetector()){
      try {
        const bmp = await createImageBitmap(await (await fetch(img.data)).blob());
        const formats = await window.BarcodeDetector.getSupportedFormats().catch(() => []);
        const want = WANT_FORMATS.filter(f => !formats.length || formats.includes(f));
        const det = new window.BarcodeDetector(want.length ? { formats: want } : undefined);
        const codes = await det.detect(bmp);
        try { bmp.close && bmp.close(); } catch (e){}
        if (codes && codes.length && codes[0].rawValue){ accept(codes[0].rawValue); return; }
      } catch (e){ /* 落到 AI 分支 */ }
    }

    // ② AI 读码
    try {
      const code = await aiReadBarcode(img.data);
      if (code){ accept(code); return; }
      out.innerHTML = '<div class="itm__ainote itm__ainote--err">' + ic('warn') +
        '<div><b>没读出条码</b><span>把条形码拍清楚一点（占画面大部分、对焦清晰、避开反光）再试，或手动输入。</span></div></div>';
    } catch (e){
      out.innerHTML = '<div class="itm__ainote itm__ainote--err">' + ic('warn') +
        '<div><b>读码失败</b><span>' + esc(e.message || '未知错误') + '</span></div></div>';
    }
  };

  /* ---- 手动输入 ---- */
  $('#itmScanManual', d.body).onclick = () => {
    out.innerHTML =
      '<div class="row row--tight" style="margin-top:10px">' +
        '<input class="inp" id="itmManualCode" inputmode="numeric" placeholder="输入条码数字，如 6921168509256" style="flex:1">' +
        '<button class="btn btn--primary" id="itmManualGo">确定</button>' +
      '</div>';
    const el = $('#itmManualCode');
    el.focus();
    const go = () => accept(el.value);
    $('#itmManualGo').onclick = go;
    el.onkeydown = e => { if (e.key === 'Enter') go(); };
  };
}

/* ------------------------------ AI 读图 ------------------------------ */

/** 把模型返回的 JSON 抠出来（容忍 ```json 包裹与前后杂字） */
function parseAIJSON(text){
  let t = String(text || '').trim();
  t = t.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const m = t.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('模型没有返回可解析的 JSON');
  try { return JSON.parse(m[0]); }
  catch (e){ throw new Error('模型返回的 JSON 格式不正确'); }
}

/** 取默认 AI，并在明显不支持看图时提前给一句人话提示 */
function visionProvider(){
  const p = AI.pickDefault();
  if (!p) throw new Error('还没有可用的 AI 供应商。先去「AI 余额」填一个 API Key，再到「设置 → 默认 AI」选择它。');
  return p;
}

/** 让模型念出图片里的条码数字 */
async function aiReadBarcode(image){
  const p = visionProvider();
  const r = await AI.vision(p.id, {
    image,
    sys: '你是条码识别工具。只输出一个 JSON 对象，不要解释、不要 markdown 代码块。',
    ask: '读出这张图片里的商品条形码数字，返回 {"barcode":"纯数字","confidence":"high|medium|low"}。' +
         '只输出条码本身的数字，不要空格、不要字母前缀。看不清就给空字符串。',
    maxTokens: 120, temperature: 0.1, timeout: 45000
  });
  const o = parseAIJSON(r.text);
  const code = String(o.barcode || '').replace(/[^0-9A-Za-z]/g, '');
  return code.length >= 6 ? code : '';
}

/**
 * 让模型看商品照片，读出结构化信息。
 * 分类必须落回我们自己的 6 个 id 之一，否则前端筛选会错位。
 */
async function aiReadProduct(image){
  const p = visionProvider();
  const r = await AI.vision(p.id, {
    image,
    sys: '你是商品信息识别助手。只输出一个 JSON 对象，不要解释文字、不要 markdown 代码块、不要单位。',
    ask: '看这张商品照片，识别并返回 JSON：\n' +
      '{"name":"品名","brand":"品牌","cat":"device|cosmetic|food|medicine|daily|other",' +
      '"qty":数量数字或null,"unit":"件/盒/瓶/袋 等","spec":"规格描述20字内",' +
      '"barcode":"能看清就填纯数字否则空","note":"能看清的补充信息30字内",' +
      '"confidence":"high|medium|low","basis":"判断依据20字内"}\n' +
      '要求：name 必填、用中文（包装是外文就翻译成中文）；cat 从给定 id 里选最贴近的一个；' +
      '看不清的字段给空字符串或 null，绝对不要编造。',
    maxTokens: 500, temperature: 0.2, timeout: 60000
  });
  const o = parseAIJSON(r.text);
  const name = String(o.name || '').trim().slice(0, 60);
  if (!name) throw new Error('模型没能认出这是什么商品，换张更清楚的照片试试');
  const catIds = ITEM_CATS.map(c => c.id);
  return {
    name,
    brand: String(o.brand || '').trim().slice(0, 40),
    cat: catIds.includes(o.cat) ? o.cat : '',
    qty: (o.qty != null && isFinite(Number(o.qty))) ? Math.max(0, Number(o.qty)) : null,
    unit: String(o.unit || '').trim().slice(0, 8),
    note: [o.spec, o.note].filter(Boolean).join(' · ').slice(0, 300),
    barcode: String(o.barcode || '').replace(/[^0-9A-Za-z]/g, '').slice(0, 32),
    from: 'AI 识别', src: 'ai',
    basis: String(o.basis || '').slice(0, 40) + (o.confidence ? ' · 把握 ' + ({ high: '较高', medium: '中等', low: '较低' }[o.confidence] || '中等') : ''),
    model: r.model
  };
}

/**
 * 从工具栏「拍照识别」进入：选图 → 先开编辑器（带照片）→ 自动跑一次 AI。
 *
 *  为什么不在弹 toast 里等 AI：识别要 10~30 秒，这期间只有一条吐司撑着体验很差。
 *  先把编辑器连同照片打开，再复用编辑器里那套「识别中…」按钮态 + 结果提示，
 *  用户看得见进度，失败了也能立刻手填，不会卡在一个空白等待上。
 *  另外 AI 可能认错，所以一律不直接落库，留给用户确认。
 */
function openPhotoSheet(){
  pickImage().then(img => {
    if (!img) return;
    openItemEditor(null, { photo: img.data, src: 'ai' }, { autoAI: true });
  });
}
