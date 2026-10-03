/* ==========================================================================
   7. 视图内渲染器：天气 / 余额 / 新闻 / 笔记 / 收支 / 待办 / 习惯
   ========================================================================== */

/* ==========================================================================
   放假倒计时（v1.18）
   --------------------------------------------------------------------------
   内置国务院公布的法定节假日安排。2026 为官方已发文数据（国办发明电〔2025〕7号）；
   2027 官方安排通常于前一年 11-12 月发布，这里先用「预估」区间（仅假期首尾，
   不含调休补班日），待官方公布后会替换。区间之外的周六日均按「普通周末」处理，
   不会计入「调休放假」模式（该模式只看法定假期区间），避免误把补班日当成放假。
   ========================================================================== */
const HOLIDAYS = {
  2026: {
    periods: [
      { name: '元旦', start: '2026-01-01', end: '2026-01-03' },
      { name: '春节', start: '2026-02-15', end: '2026-02-23' },
      { name: '清明', start: '2026-04-04', end: '2026-04-06' },
      { name: '劳动节', start: '2026-05-01', end: '2026-05-05' },
      { name: '端午', start: '2026-06-19', end: '2026-06-21' },
      { name: '中秋', start: '2026-09-25', end: '2026-09-27' },
      { name: '国庆', start: '2026-10-01', end: '2026-10-07' }
    ],
    // 调休补班日（周末也要上班）
    work: ['2026-01-04', '2026-02-14', '2026-02-28', '2026-05-09', '2026-09-20', '2026-10-10']
  },
  2027: {
    periods: [
      { name: '元旦', start: '2027-01-01', end: '2027-01-03' },
      { name: '春节', start: '2027-02-06', end: '2027-02-12' },
      { name: '清明', start: '2027-04-04', end: '2027-04-06' },
      { name: '劳动节', start: '2027-05-01', end: '2027-05-05' },
      { name: '端午', start: '2027-06-09', end: '2027-06-11' },
      { name: '中秋', start: '2027-09-15', end: '2027-09-17' },
      { name: '国庆', start: '2027-10-01', end: '2027-10-07' }
    ],
    // 2027 调休补班日尚未公布，置空（不影响假期区间本身）
    work: []
  }
};

const Holiday = {
  /** 某天是否为「放假中」：在假期区间内且不是补班日。返回 {name,start,end} 或 null */
  restOf(key){
    const y = Number(key.slice(0, 4));
    const data = HOLIDAYS[y];
    if (!data) return null;
    if (data.work.includes(key)) return null;
    for (const p of data.periods) if (key >= p.start && key <= p.end) return { name: p.name, start: p.start, end: p.end };
    return null;
  },
  /** 计算倒计时结果；from 默认为现在。
      注意：先把 from 归一到「今天 0 点」——否则用带时刻的 now 去减目标日的 0 点，
      不足一天的零头会被 Math.round 抹掉（9/30 14 点看 10/1 会算成 0 天）。 */
  compute(type, from = new Date()){
    const base = fromKey(dayKey(from));
    const todayKey = dayKey(base);
    const dow = base.getDay();

    if (type === 'weekend'){
      const inWeekend = (dow === 0 || dow === 6);
      let off = (6 - dow + 7) % 7;                 // 今天周六 → 0
      const target = inWeekend ? new Date(base) : addDays(base, off);
      const days = Math.max(0, Math.round((target - base) / 86400000));
      const nextSat = addDays(base, off === 0 ? 7 : off);
      return { type, resting: inWeekend, name: '周末', target, days,
               nextTarget: nextSat, nextDays: off === 0 ? 7 : off };
    }

    // 收集各假期「首天」候选（按日期排序）
    const firsts = [];
    for (const y of Object.keys(HOLIDAYS).map(Number).sort((a, b) => a - b)){
      const data = HOLIDAYS[y];
      for (const p of data.periods) firsts.push({ key: p.start, name: p.name, date: fromKey(p.start), end: p.end });
    }
    firsts.sort((a, b) => a.date - b.date);

    // 今天是否在放假
    const todays = this.restOf(todayKey);
    if (todays){
      const endD = fromKey(todays.end);
      const remaining = Math.round((endD - base) / 86400000) + 1; // 含今天
      const nx = firsts.find(f => f.key > todays.end);            // 下一个首天（严格晚于本次结束）
      return { type, resting: true, name: todays.name, target: base, days: 0, endsOn: endD, remaining,
               nextName: nx?.name, nextTarget: nx ? nx.date : null, nextDays: nx ? Math.round((nx.date - base) / 86400000) : null };
    }

    // 未来首天
    const fut = firsts.filter(f => f.key >= todayKey);
    if (!fut.length) return { type, error: true };
    const nxt = fut[0];
    const days = Math.round((nxt.date - base) / 86400000);
    return { type, resting: false, name: nxt.name, target: nxt.date, days, isFirst: true };
  },
  /** 中文类型标签 */
  label(type){
    return ({ weekend: '周末', tiaoxiu: '调休放假', first: '国家节假日首天' })[type] || '周末';
  }
};

/** 放假倒计时卡片（首页） */
let holiTimer = null;   // 时分倒计时的定时刷新句柄（明天放假 + 启用下班时间时使用）
function renderHolidayCountdown(){
  const host = $('#holidayHost');
  if (!host) return;
  // 每次渲染先取消上一次的定时刷新，避免多次调度累积
  if (holiTimer){ clearTimeout(holiTimer); holiTimer = null; }
  const h = Store.db.settings.holiday;
  // 关闭时清空并把上边距归零，避免留下一个空白的 18px 间隙
  if (!h || !h.on){ host.innerHTML = ''; host.style.marginTop = '0'; return; }
  host.style.marginTop = '18px';

  const r = Holiday.compute(h.type);
  const dateText = d => {
    const y = d.getFullYear(), m = d.getMonth() + 1, dd = d.getDate();
    return y + '年' + m + '月' + dd + '日 ' + WEEK[d.getDay()];
  };

  let inner;
  if (r.error){
    inner =
      '<div class="holi__hd"><span class="holi__tt">' + ic('cal') + '放假倒计时</span>' +
        '<span class="tag tag--accent">' + esc(Holiday.label(h.type)) + '</span></div>' +
      '<div class="holi__big"><div class="holi__lead">暂无后续假期数据</div>' +
        '<div class="holi__name">内置安排已用完（2027 待官方公布）</div></div>';
  } else if (r.resting){
    inner =
      '<div class="holi__hd"><span class="holi__tt">' + ic('cal') + '放假倒计时</span>' +
        '<span class="tag tag--accent">' + esc(Holiday.label(h.type)) + '</span></div>' +
      '<div class="holi__big">' +
        '<div class="holi__state">正在放假</div>' +
        '<div class="holi__name">' + esc(r.name) + '</div>' +
        '<div class="holi__rem">还剩 <b>' + r.remaining + '</b> 天（至 ' + esc(dateText(r.endsOn)) + '）</div>' +
      '</div>' +
      '<div class="holi__ft">' +
        (r.nextName ? '<span>下次 ' + esc(r.nextName) + ' 还有 <b>' + r.nextDays + '</b> 天</span>' : '') +
      '</div>';
  } else {
    // 明天放假 + 启用下班时间 → 从「N 天」升级为「时分」倒计时（精确到分，不显示秒）
    const cm = Store.db.settings.commute;
    if (cm && cm.on && r.days === 1){
      const now = new Date();
      const off = new Date(now.getFullYear(), now.getMonth(), now.getDate(),
                           cm.homeH ?? 18, cm.homeM ?? 30, 0, 0);
      const diffMin = Math.ceil((off - now) / 60000);
      if (diffMin > 0){
        const H = Math.floor(diffMin / 60), M = diffMin % 60;
        inner =
          '<div class="holi__hd"><span class="holi__tt">' + ic('cal') + '放假倒计时</span>' +
            '<span class="tag tag--accent">' + esc(Holiday.label(h.type)) + '</span></div>' +
          '<div class="holi__big">' +
            '<div class="holi__lead">明天放假 · 距下班还有</div>' +
            '<div class="holi__num">' + H + '<small>小时 ' + pad2(M) + ' 分</small></div>' +
            '<div class="holi__date">' + esc(r.name) + ' · ' + esc(dateText(r.target)) + '</div>' +
          '</div>';
        // 30 秒刷新一次，保证分钟数准确（不显示秒，无需秒级刷新）
        holiTimer = setTimeout(renderHolidayCountdown, 30000);
      } else {
        // 已过今天下班时刻：假期前夜已开始，不再倒计时
        inner =
          '<div class="holi__hd"><span class="holi__tt">' + ic('cal') + '放假倒计时</span>' +
            '<span class="tag tag--accent">' + esc(Holiday.label(h.type)) + '</span></div>' +
          '<div class="holi__big">' +
            '<div class="holi__lead">已下班 · 明天放假</div>' +
            '<div class="holi__name">' + esc(r.name) + '</div>' +
            '<div class="holi__date">' + esc(dateText(r.target)) + '</div>' +
          '</div>';
      }
    } else {
      inner =
        '<div class="holi__hd"><span class="holi__tt">' + ic('cal') + '放假倒计时</span>' +
          '<span class="tag tag--accent">' + esc(Holiday.label(h.type)) + '</span></div>' +
        '<div class="holi__big">' +
          '<div class="holi__lead">距离 <b>' + esc(r.name) + '</b> 还有</div>' +
          '<div class="holi__num">' + r.days + '<small>天</small></div>' +
          '<div class="holi__date">' + esc(dateText(r.target)) + '</div>' +
        '</div>';
    }
  }

  host.innerHTML = '<div class="holi holi--' + h.type + '">' + inner + '</div>';
}

/* ------------------------------ 天气视图 ------------------------------ */
async function renderWeather(){
  const box = $('#view');
  const st = Store.db.settings;
  const city = st.city;
  box.innerHTML =
    '<div id="wxHost"><div class="card" style="padding:40px;text-align:center">' +
      '<div class="skeleton" style="height:14px;width:120px;margin:0 auto 12px"></div>' +
      '<div class="skeleton" style="height:64px;width:200px;margin:0 auto 16px"></div>' +
      '<div class="skeleton" style="height:10px;width:260px;margin:0 auto"></div>' +
      '<p class="muted tiny" style="margin-top:18px">正在获取 ' + esc(city.name) + ' 的天气…</p>' +
    '</div></div>' +
    '<div id="holidayHost" style="margin-top:18px"></div>' +
    '<div class="grid g-3" style="margin-top:18px" id="wxExtra"></div>';

  // 放假倒计时卡片：不依赖天气，立即渲染（即使天气拉取失败也照常显示）
  renderHolidayCountdown();

  let d = null;
  try {
    d = await Weather.fetch(city);
    Weather.data = d;
    Store.db.settings.lastWeather = { data: d, at: Date.now() };
    Store.save();
  } catch (e){
    d = st.lastWeather?.data || null;
    Weather.err = e.message;
  }

  // ── 异步回来后做「视图存活」校验 ──
  // 请求期间用户可能已切到别的页面，此时 #view 已被其它渲染函数重写，
  // 继续往下写会命中 null。仅在当前仍是天气页且宿主节点还在时才继续。
  if (CUR !== 'weather' || !$('#wxHost')) return;

  if (!d){
    $('#wxHost').innerHTML =
      '<div class="empty">' + ic('cloud') +
      '<p>天气暂时拿不到</p><small>' + esc(Weather.err || '网络异常') + '<br>可以换一个城市试试，或稍后刷新。</small>' +
      '<div style="margin-top:14px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">' +
      '<button class="btn btn--sm" id="wxRetry">' + ic('refresh') + '重试</button>' +
      '<button class="btn btn--sm" id="wxPick2">' + ic('loc') + '选择城市</button></div></div>';
    $('#wxRetry').onclick = () => renderWeather();
    $('#wxPick2').onclick = () => openCityPicker();
    return;
  }
  drawWeatherMain(d);
  renderWeatherExtra(d);
}

function drawWeatherMain(d){
  const m = wxMeta(d.code, isDayNow(d), d.desc);
  // 统一走一层中文兜底：老缓存里可能还存着英文 desc（数据层已修，但缓存 15 分钟内不会重取）
  const dDesc = wxText(d.code, d.desc);
  const dRegion = regionText(d.region);   // 地区名同样兜底，老缓存可能存着英文
  const host = $('#wxHost');
  if (!host) return;                       // 宿主已不存在（视图已切换），安全退出
  const tc = Weather.tempColor(d.temp);
  const today = d.days?.[0] || {};
  const stale = Date.now() - (d.at || 0) > 40 * 60 * 1000;

  host.innerHTML =
    '<div class="wx" style="background:linear-gradient(170deg,' + m.tone.bg + ',' + 'var(--surface)' + ' 78%)">' +
      '<canvas class="wx__canvas" id="wxCv"></canvas>' +
      '<div class="wx__inner">' +
        '<div class="wx__top">' +
          '<div>' +
            '<div class="wx__place">' + ic('loc') + '<span>' + esc(String(d.place || Store.db.settings.city.name).split(/\s*·\s*/)[0]) + '</span>' +
              (dRegion ? '<span class="muted tiny" style="font-weight:400">· ' + esc(dRegion) + '</span>' : '') +
              '<button id="wxPick" title="切换城市" aria-label="切换城市">' + ic('chev') + '</button>' +
            '</div>' +
            '<div class="tiny muted" style="margin-top:3px;padding-left:22px">' +
              esc(fmtDay(new Date())) + ' ' + esc(WEEK[new Date().getDay()]) + ' · ' +
              (stale ? '数据可能已过期' : '更新于 ' + esc(fmtTime(d.at || Date.now()))) +
              ' · 来源 ' + esc(d.src || '') +
            '</div>' +
          '</div>' +
          '<div style="display:flex;gap:6px;flex-wrap:wrap">' +
            (dDesc ? '<span class="tag' + (/雨|雪|雷/.test(dDesc) ? ' tag--sky' : /晴/.test(dDesc) ? ' tag--amber' : '') + '">' + esc(dDesc) + '</span>' : '') +
            (today.max != null ? '<span class="tag">' + esc(Math.round(today.min)) + '° ~ ' + esc(Math.round(today.max)) + '°</span>' : '') +
            '<button class="btn btn--sm btn--icon" id="wxRefresh" title="刷新天气">' + ic('refresh') + '</button>' +
          '</div>' +
        '</div>' +

        '<div class="wx__main">' +
          '<div class="wx__icon">' + wxIconBig(m.key, 88) + '</div>' +
          '<div>' +
            '<div class="wx__temp" style="color:' + tc + '">' + esc(Math.round(d.temp)) + '<sup>°C</sup></div>' +
            '<div class="wx__desc" style="margin-top:8px">' + esc(dDesc || '—') + '</div>' +
            '<div class="wx__feels">体感 ' + esc(Math.round(d.feels ?? d.temp)) + '°C' +
              (d.precip > 0 ? ' · 降水 ' + esc(d.precip) + 'mm' : '') + '</div>' +
          '</div>' +
          '<div class="wx__meta">' +
            stat('湿度', (d.humidity != null ? d.humidity + '%' : '—')) +
            stat('风力', (d.windK != null ? Math.round(d.windK) + ' km/h' : '—') + (d.windDir ? ' ' + esc(d.windDir) : '')) +
            stat('气压', (d.pressure != null ? Math.round(d.pressure) + ' hPa' : '—')) +
            stat('能见度', (d.vis != null ? Number(d.vis).toFixed(1) + ' km' : '—')) +
            stat('紫外线', (d.uv != null ? 'UV ' + d.uv : '—')) +
            stat('日出/日落', (d.sunrise || '—') + ' / ' + (d.sunset || '—')) +
          '</div>' +
        '</div>' +

        (d.hours?.length ?
        '<div class="wx__hours">' + d.hours.slice(0, 12).map((h, i) => {
          const hDesc = wxText(h.code, h.desc);
          const hm = wxMeta(h.code, h.h >= 6 && h.h < 19, h.desc);
          return '<div class="wx__hr' + (i === 0 ? ' is-now' : '') + '" title="' + escAttr(hDesc) + '">' +
            '<time>' + (i === 0 ? '现在' : esc(pad2(h.h) + ':00')) + '</time>' +
            wxIconSmall(hm.key) + '<b>' + esc(Math.round(h.t)) + '°</b></div>';
        }).join('') + '</div>' : '') +

        (d.days?.length > 1 ?
        '<div class="wx__days">' + d.days.slice(0, 5).map((x, i) => {
          const xDesc = wxText(x.code, x.desc);
          const dm = wxMeta(x.code, true, x.desc);
          const dt = i === 0 ? '今天' : WEEK[new Date(x.date).getDay()];
          return '<div class="wx__day" title="' + escAttr(xDesc) + '">' +
            '<span>' + esc(dt) + '</span>' + wxIconSmall(dm.key) +
            '<b>' + esc(Math.round(x.max)) + '° <i style="color:var(--ink-4);font-style:normal">' + esc(Math.round(x.min)) + '°</i></b>' +
            (xDesc ? '<i style="display:block;margin-top:2px">' + esc(xDesc.slice(0, 6)) + '</i>' : '') +
            '</div>';
        }).join('') + '</div>' : '') +

        commuteBlock(d) +

        '<div class="wx__advice">' + ic('spark') + ' ' + esc(Weather.advice(d)) + '</div>' +
      '</div>' +
    '</div>';

  $('#wxPick').onclick = () => openCityPicker();
  $('#wxRefresh').onclick = () => {
    try { localStorage.removeItem('lifehub.v1.wx.' + Store.db.settings.city.lat.toFixed(2) + '.' + Store.db.settings.city.lon.toFixed(2)); } catch(e){}
    renderWeather();
    toast('ok', '正在刷新天气');
  };
  WxCanvas.start($('#wxCv'), m.key);
  const cEdit = $('#wxComute'); if (cEdit) cEdit.onclick = openCommuteSettings;

  function stat(label, val){
    return '<div class="wx__stat"><span>' + esc(label) + '</span><b class="num">' + val + '</b></div>';
  }
}

/**
 * 通勤天气块 —— 展示上班、下班两个时刻的天气与提醒。
 * 仅在设置里开启时渲染；未开启时给一行轻量入口，不占地方。
 *
 * 日期切换规则：一旦当前时间过了「下班时间」，今天这两段通勤都已经过去了，
 * 再看今天的没有意义 —— 整块切到「明天」，标题上注明「明天」。
 */
function commuteBlock(d){
  const c = Store.db.settings.commute || {};
  if (!c.on){
    return '<div class="cmt cmt--off">' + ic('clock') +
      '<span>想看上下班时的天气？<button class="cmt__lnk" id="wxComute">设置通勤时间</button></span></div>';
  }
  const wd = Array.isArray(c.workdays) ? c.workdays : [1,2,3,4,5];

  // 是否已经过了今天的下班时间 → 决定看今天还是明天
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const homeMin = c.homeH * 60 + c.homeM;
  const isNext = nowMin > homeMin;          // 过了下班点，切到明天
  const off = isNext ? 1 : 0;

  const dayRef = new Date(now);
  dayRef.setDate(dayRef.getDate() + off);
  const dayName = WEEK[dayRef.getDay()];
  const isWork = wd.includes(dayRef.getDay());   // 注意：判断的是「要看的那天」

  const go = Weather.atHour(d, c.goH, c.goM, off);
  const hm = Weather.atHour(d, c.homeH, c.homeM, off);
  const cell = (label, time, x, iconCls) => {
    if (!x) return '<div class="cmt__c"><span class="cmt__lb">' + esc(label) + '</span>' +
      '<b class="cmt__tm">' + esc(time) + '</b><span class="cmt__d">暂无数据</span></div>';
    const xDesc = wxText(x.code, x.desc);   // 通勤块里也过一层，防止缓存旧英文
    const mk = wxMeta(x.code, x.h >= 6 && x.h < 19, x.desc);
    const wet = /雨|雪|雷/.test(xDesc);
    return '<div class="cmt__c' + (wet ? ' is-wet' : '') + '">' +
      '<span class="cmt__lb">' + esc(label) + '<i>' + esc(time) + '</i></span>' +
      '<div class="cmt__m">' + wxIconSmall(mk.key) +
        '<b class="num">' + esc(Math.round(x.t)) + '°</b>' +
        '<span class="cmt__d">' + esc(xDesc.slice(0, 8)) + '</span>' +
      '</div></div>';
  };
  const tips = [];
  const dGo = go ? wxText(go.code, go.desc) : '', dHm = hm ? wxText(hm.code, hm.desc) : '';
  if (/雨|雪|雷/.test(dGo)) tips.push('上班时段有降水，伞别忘');
  if (/雨|雪|雷/.test(dHm)) tips.push('下班时段有降水，记得带伞');
  if (go && go.t <= 8) tips.push('早上偏冷，加件外套');
  if (hm && hm.t >= 30) tips.push('下班时闷热，注意补水');
  if (go && hm && go.t - hm.t >= 10) tips.push('早晚温差大，穿脱方便些');

  return '<div class="cmt">' +
    '<div class="cmt__hd">' +
      '<span class="cmt__tt">' + ic('clock') + '通勤天气' +
        '<span class="cmt__day' + (isNext ? ' is-next' : '') + '">' + (isNext ? '明天' : '今天') + ' ' + dayName + '</span>' +
      '</span>' +
      (isWork ? '' : '<span class="tag tag--sky" style="font-size:10.5px">' + (isNext ? '次日休息' : '今天休息') + '</span>') +
      '<button class="cmt__set" id="wxComute" title="修改通勤时间">' + ic('gear') + '</button>' +
    '</div>' +
    '<div class="cmt__row">' +
      cell('上班', pad2(c.goH) + ':' + pad2(c.goM), go) +
      cell('下班', pad2(c.homeH) + ':' + pad2(c.homeM), hm) +
    '</div>' +
    (isNext ? '<div class="cmt__note">' + ic('info') + '今天的通勤时段已过，这里显示的是明天。</div>' : '') +
    (tips.length ? '<div class="cmt__tip">' + esc(tips.slice(0, 2).join('；')) + '</div>' : '') +
  '</div>';
}
/**
 * 通勤天气设置 —— 开关 + 上下班时刻 + 工作日选择。
 * 改完即存；关闭后重渲染天气页，让新设置立刻生效。
 */
function openCommuteSettings(){
  const c = Store.db.settings.commute || { on:false, goH:8, goM:0, homeH:18, homeM:30, workdays:[1,2,3,4,5] };
  const WD = [['周一',1],['周二',2],['周三',3],['周四',4],['周五',5],['周六',6],['周日',0]];
  const timeSel = (id, h, m) =>
    '<div class="cmt__pick">' +
      '<select class="sel" id="' + id + 'H">' +
        Array.from({ length: 24 }, (_, i) => '<option value="' + i + '"' + (i === h ? ' selected' : '') + '>' + pad2(i) + '</option>').join('') +
      '</select><span class="cmt__colon">:</span>' +
      '<select class="sel" id="' + id + 'M">' +
        [0,5,10,15,20,25,30,35,40,45,50,55].map(i => '<option value="' + i + '"' + (i === m ? ' selected' : '') + '>' + pad2(i) + '</option>').join('') +
      '</select>' +
    '</div>';

  const d = drawer({
    title: '通勤天气',
    sub: '上下班时段单独看天气',
    body:
      '<div class="sect"><h4>开关</h4>' +
        '<label class="swrow"><input type="checkbox" id="cmOn"' + (c.on ? ' checked' : '') + '>' +
          '<span class="switch" aria-hidden="true"></span>' +
          '<span class="swrow__t">在「今日」页显示通勤天气</span></label>' +
        '<p class="hint">开启后，天气卡里会多出一块，分别显示上班和下班时刻的温度与天气。</p>' +
      '</div>' +

      '<div class="sect"><h4>上班时间</h4>' + timeSel('cmGo', c.goH, c.goM) + '</div>' +
      '<div class="sect"><h4>下班时间</h4>' + timeSel('cmHome', c.homeH, c.homeM) + '</div>' +

      '<div class="sect"><h4>哪些天需要通勤</h4>' +
        '<div class="cmt__wd">' + WD.map(([n, v]) =>
          '<button class="cmt__wdb' + ((c.workdays || []).includes(v) ? ' is-on' : '') + '" data-wd="' + v + '">' + n + '</button>').join('') +
        '</div>' +
        '<p class="hint">非通勤日在卡片上会标出「今天休息」，时刻仍会显示，方便你临时参考。</p>' +
      '</div>',

    foot: '<button class="btn btn--primary btn--block" id="cmSave">' + ic('check') + '保存</button>'
  });

  const read = id => ({
    h: Number($('#' + id + 'H', d.body).value),
    m: Number($('#' + id + 'M', d.body).value)
  });

  $$('.cmt__wdb', d.body).forEach(b => b.onclick = () => {
    b.classList.toggle('is-on');
    // 允许全不选（比如自由职业者），但至少提示一下
  });

  $('#cmSave', d.el).onclick = () => {
    const go = read('cmGo'), home = read('cmHome');
    const wd = $$('.cmt__wdb', d.body).filter(b => b.classList.contains('is-on')).map(b => Number(b.dataset.wd));
    const on = $('#cmOn', d.body).checked;
    Store.mutate(db => {
      db.settings.commute = { on, goH: go.h, goM: go.m, homeH: home.h, homeM: home.m, workdays: wd };
    });
    d.close();
    toast('ok', on ? '已开启通勤天气' : '已关闭通勤天气');
    // 抽屉关闭后重渲染当前视图。用 renderWeather 而非构造通用刷新入口：
    // 这里只改天气相关设置，且调用方始终是天气页，不构成渲染函数互调环路。
    setTimeout(() => { if (typeof renderWeather === 'function') renderWeather(); }, 60);
  };

  // 勾选时同步自绘开关的视觉状态（原生 checkbox 只做状态存储）
  const onBox = $('#cmOn', d.body);
  const syncSw = () => onBox.closest('.swrow')?.querySelector('.switch')?.classList.toggle('is-on', onBox.checked);
  onBox.onchange = syncSw;
  syncSw();
}

function wxIconSmall(key){
  const c = { sun:'#d9962f', moon:'#6b7699', cloud:'#8a9099', partly:'#c99a3c',
              rain:'#4a7189', storm:'#7a5c78', snow:'#7d97ab', fog:'#8c8578' }[key] || '#8a9099';
  const paths = {
    sun:'<circle cx="12" cy="12" r="4.6" fill="' + c + '" fill-opacity=".22"/><circle cx="12" cy="12" r="4.6"/><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6"/>',
    moon:'<path d="M15.6 12.9A6.6 6.6 0 0 1 8.9 4.8 6.7 6.7 0 1 0 15.6 12.9z" fill="' + c + '" fill-opacity=".2"/>',
    partly:'<circle cx="8.6" cy="8.6" r="3.1" fill="' + c + '" fill-opacity=".22"/><path d="M8.6 2.6v1.6M2.6 8.6h1.6M4.4 4.4l1.1 1.1M12.8 4.4l-1.1 1.1M4.4 12.8l1.1-1.1"/><path d="M10.4 19.4h7.6a3 3 0 0 0 .3-6A4.4 4.4 0 0 0 9.7 12a3.7 3.7 0 0 0 .7 7.4z" fill="' + c + '" fill-opacity=".16"/>',
    cloud:'<path d="M6.6 18h10.8a3.5 3.5 0 0 0 .3-6.9A5 5 0 0 0 7.5 9.6 4.2 4.2 0 0 0 6.6 18z" fill="' + c + '" fill-opacity=".18"/>',
    rain:'<path d="M6.6 15.6h10.8a3.5 3.5 0 0 0 .3-6.9A5 5 0 0 0 7.5 7.2 4.2 4.2 0 0 0 6.6 15.6z" fill="' + c + '" fill-opacity=".16"/><path d="M8.8 18.4l-.7 2.2M12 18.4l-.7 2.2M15.2 18.4l-.7 2.2"/>',
    storm:'<path d="M6.6 14.6h10.8a3.5 3.5 0 0 0 .3-6.9A5 5 0 0 0 7.5 6.2 4.2 4.2 0 0 0 6.6 14.6z" fill="' + c + '" fill-opacity=".16"/><path d="M13 16.6l-2.4 3.6h3.1l-2 3.2"/>',
    snow:'<path d="M6.6 14.6h10.8a3.5 3.5 0 0 0 .3-6.9A5 5 0 0 0 7.5 6.2 4.2 4.2 0 0 0 6.6 14.6z" fill="' + c + '" fill-opacity=".16"/><path d="M9 18v2.6M7.8 18.8l2.4 1.2M10.2 18.8l-2.4 1.2M15 18v2.6M13.8 18.8l2.4 1.2M16.2 18.8l-2.4 1.2"/>',
    fog:'<path d="M6.6 13.6h10.8a3.5 3.5 0 0 0 .3-6.9A5 5 0 0 0 7.5 5.2 4.2 4.2 0 0 0 6.6 13.6z" fill="' + c + '" fill-opacity=".16"/><path d="M4.6 16.6h14.8M7.6 19.6h11.8"/>'
  }[key] || '<path d="M6.6 18h10.8a3.5 3.5 0 0 0 .3-6.9A5 5 0 0 0 7.5 9.6 4.2 4.2 0 0 0 6.6 18z" fill="' + c + '" fill-opacity=".18"/>';
  return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="' + c + '" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>';
}
function isDayNow(d){
  if (!d.sunrise || !d.sunset) { const h = new Date().getHours(); return h >= 6 && h < 19; }
  const hm = s => { const [a, b] = String(s).split(':').map(Number); return a * 60 + (b || 0); };
  const now = new Date(); const n = now.getHours() * 60 + now.getMinutes();
  return n >= hm(d.sunrise) && n <= hm(d.sunset);
}

/** 天气页的附加卡片：三日趋势 + 出行建议 + 城市 */
function renderWeatherExtra(d){
  const box = $('#wxExtra');
  if (!box) return;
  const days = (d.days || []).slice(0, 5);
  const all = days.flatMap(x => [Number(x.max), Number(x.min)]);
  const lo = Math.min(...all), hi = Math.max(...all), span = Math.max(1, hi - lo);
  const bars = days.map((x, i) => {
    const h = 100 - ((Number(x.max) - lo) / span) * 70;
    const bh = Math.max(10, ((Number(x.max) - Number(x.min)) / span) * 70 + 12);
    const dm = wxMeta(x.code, true, x.desc);
    return { i, x, h, bh, dm };
  });
  const st = Store.db.settings;
  const hist = (st.cityHistory || []).filter(c => c.name !== st.city.name).slice(0, 6);

  box.innerHTML =
    '<div class="card"><div class="card__hd"><h3>' + ic('barchart') + '气温走势</h3></div>' +
      '<div class="card__bd">' +
      '<svg class="chart" viewBox="0 0 300 130" preserveAspectRatio="none" style="height:130px">' +
        bars.map((b, i) => {
          const x = 16 + i * (268 / Math.max(1, bars.length - 1 || 1)) - 15;
          return '<rect x="' + x + '" y="' + (108 - b.bh) + '" width="30" height="' + b.bh + '" rx="9" fill="' + b.dm.tone.c + '" fill-opacity=".24"/>' +
                 '<rect x="' + x + '" y="' + (108 - b.bh) + '" width="30" height="' + Math.min(b.bh, 5) + '" rx="4" fill="' + b.dm.tone.c + '" fill-opacity=".75"/>' +
                 '<text x="' + (x + 15) + '" y="' + (102 - b.bh) + '" text-anchor="middle" font-size="11" fill="var(--ink-2)" font-weight="600">' + Math.round(b.x.max) + '°</text>' +
                 '<text x="' + (x + 15) + '" y="121" text-anchor="middle" font-size="10" fill="var(--ink-4)">' + (i === 0 ? '今天' : WEEK[new Date(b.x.date).getDay()]) + '</text>';
        }).join('') +
      '</svg>' +
      '<div class="tiny muted" style="margin-top:6px">最低 ' + Math.round(lo) + '° · 最高 ' + Math.round(hi) + '° · 温差 ' + Math.round(span) + '°</div>' +
      '</div></div>' +

    '<div class="card"><div class="card__hd"><h3>' + ic('target') + '今天怎么穿</h3></div>' +
      '<div class="card__bd"><div class="reading">' + ic('info') + '<span>' + esc(Weather.advice(d)) + '</span></div>' +
      (d.hours?.length ? '<div class="hr"></div><div class="tiny muted">未来几小时：' +
        d.hours.slice(0, 5).map(h => pad2(h.h) + ':00 ' + Math.round(h.t) + '°').join(' · ') + '</div>' : '') +
      '</div></div>' +

    '<div class="card"><div class="card__hd"><h3>' + ic('loc') + '常看的城市</h3>' +
      '<button class="btn btn--sm btn--ghost" id="wxAddCity">' + ic('plus') + '添加</button></div>' +
      '<div class="card__bd">' +
      '<div class="quickcities">' +
        '<button data-c="' + escAttr(JSON.stringify(st.city)) + '" style="background:var(--accent);border-color:var(--accent);color:#fff">' + esc(st.city.name) + '（当前）</button>' +
        hist.map(c => '<button data-c="' + escAttr(JSON.stringify(c)) + '">' + esc(c.name) + (c.region ? '<span style="opacity:.6"> · ' + esc(String(c.region).split(' · ')[0]) + '</span>' : '') + '</button>').join('') +
      '</div>' +
      '<p class="hint">点一下即可切换。数据来源 wttr.in / open-meteo，均为免费公开接口，无需登录。</p>' +
      '</div></div>';

  $$('.quickcities button[data-c]', box).forEach(b => {
    b.onclick = () => {
      try {
        const c = JSON.parse(b.dataset.c);
        st.city = { ...c, manual: true, source: 'history' };
        Store.save();
        toast('ok', '已切换到 ' + c.name);
        location.hash = '#/weather';
        renderWeather();
      } catch (e){}
    };
  });
  $('#wxAddCity').onclick = () => openCityPicker();
}

/** 城市选择器 */
function openCityPicker(){
  const st = Store.db.settings;
  const d = drawer({
    title: '选择位置',
    sub: '默认按网络定位，也可以手动指定',
    body:
      '<div class="sect">' +
        '<h4>自动</h4>' +
        '<button class="btn btn--primary btn--block" id="cpLoc">' + ic('loc') + '使用当前位置（IP 定位）</button>' +
        '<p class="hint">通过 IP 粗略判断所在城市，精度到市级。首次使用会向定位服务发起一次请求。</p>' +
      '</div>' +
      '<div class="sect">' +
        '<h4>搜索城市</h4>' +
        '<div class="row row--tight" style="align-items:center">' +
          '<input class="inp" id="cpQ" placeholder="输入城市名，如 杭州 / Shenzhen" autocomplete="off" style="flex:1">' +
          '<button class="btn btn--primary" id="cpGo" style="height:37px">' + ic('search') + '</button>' +
        '</div>' +
        '<div id="cpRes"></div>' +
      '</div>' +
      '<div class="sect">' +
        '<h4>常用城市</h4>' +
        '<div class="quickcities" id="cpQuick"></div>' +
        '<p class="hint">搜索使用 open-meteo 地理编码，支持中文、拼音与英文。</p>' +
      '</div>'
  });

  const quick = $('#cpQuick', d.body);
  quick.innerHTML = (st.cityHistory || []).map((c, i) =>
    '<button data-i="' + i + '">' + esc(c.name) + '</button>').join('') || '<span class="tiny muted">暂无记录</span>';
  $$('button[data-i]', quick).forEach(b => {
    b.onclick = () => {
      const c = st.cityHistory[Number(b.dataset.i)];
      st.city = { ...c, manual: true, source: 'quick' };
      Store.save(); d.close();
      toast('ok', '已切换到 ' + c.name);
      renderWeather();
    };
  });

  $('#cpLoc', d.body).onclick = async () => {
    const btn = $('#cpLoc', d.body);
    btn.disabled = true; btn.innerHTML = ic('refresh', 'spin') + '定位中…';
    try {
      const c = await Weather.locate();
      st.city = { name: c.name, lat: c.lat, lon: c.lon, region: c.region, manual: false, source: 'ip' };
      pushCityHistory(st, { name: c.name, lat: c.lat, lon: c.lon, region: c.region });
      Store.save(); d.close();
      toast('ok', '定位成功', '当前城市：' + c.name);
      renderWeather();
    } catch (e){
      btn.disabled = false; btn.innerHTML = ic('loc') + '使用当前位置（IP 定位）';
      toast('err', '定位失败', '所有定位服务都不可用，可能是网络或浏览器限制。可以手动选择城市。', 7000);
    }
  };

  const input = $('#cpQ', d.body), resBox = $('#cpRes', d.body);
  const doSearch = async () => {
    const q = input.value.trim();
    if (q.length < 1) return;
    resBox.innerHTML = '<div class="skeleton" style="height:52px;margin-top:9px"></div>';
    try {
      const rs = await Weather.searchCity(q);
      if (!rs.length){ resBox.innerHTML = '<p class="hint">没有找到「' + esc(q) + '」，换个说法试试。</p>'; return; }
      resBox.innerHTML = '<div class="citypick">' + rs.map((r, i) =>
        '<button class="citypick__i" data-i="' + i + '"><b>' + esc(r.name) + '</b>' +
        (r.pop ? '<small class="num">' + abbr(r.pop) + '人</small>' : '') +
        '<small>' + esc(r.region || '') + '</small></button>').join('') + '</div>';
      $$('.citypick__i', resBox).forEach(b => {
        b.onclick = () => {
          const r = rs[Number(b.dataset.i)];
          st.city = { name: r.name, lat: r.lat, lon: r.lon, region: r.region, manual: true, source: 'search' };
          pushCityHistory(st, r);
          Store.save(); d.close();
          toast('ok', '已切换到 ' + r.name, r.region);
          renderWeather();
        };
      });
    } catch (e){
      resBox.innerHTML = '<p class="hint" style="color:var(--danger)">搜索失败：' + esc(e.message) + '</p>';
    }
  };
  $('#cpGo', d.body).onclick = doSearch;
  input.addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); doSearch(); } });
  setTimeout(() => input.focus(), 320);
}
function pushCityHistory(st, c){
  st.cityHistory = [{ name: c.name, lat: c.lat, lon: c.lon, region: c.region || '' }]
    .concat((st.cityHistory || []).filter(x => x.name !== c.name)).slice(0, 12);
}

/* ------------------------------ 余额视图 ------------------------------ */
const Bal = { working: [], filter: 'all' };
// AI.refreshAll()（part5）批量查询时需要触发本页重绘来显示/结束 loading。
// 方法挂在这里而不是在 part5 里直接调 renderBalance：part5 先于本文件执行，
// 直接引用全局函数依赖加载顺序，挂在 Bal 上内聚且不会写成不存在的方法名
// （v1.16 及之前 refreshAll 调的是 Bal.render()，而 Bal 从来没定义过这个方法 ——
//  批量刷新一按就抛 TypeError，请求根本发不出去）。
Bal.render = () => renderBalance();

function renderBalance(){
  const box = $('#view');
  const ps = AI.all;
  const withKey = ps.filter(p => p.key);
  const totalCny = withKey.reduce((s, p) => s + (p.bal || 0), 0);
  const low = withKey.filter(p => p.bal !== null && p.balErr === '' && p.bal < 10);
  const needKey = ps.filter(p => !p.key);

  box.innerHTML =
    '<div class="grid g-4" style="margin-bottom:18px">' +
      statCard('可用供应商', withKey.length + ' / ' + ps.length, '已填 Key 的账户') +
      statCard('余额合计（约）', '¥' + money(totalCny), '仅统计成功查询的账户') +
      statCard('需要关注', String(low.length), low.length ? low.map(p => p.name).join('、') + ' 余额偏低' : '余额都还充足') +
      statCard('最近汇总', AI.all.filter(p => p.balAt).length ? fmtAgo(Math.max(...AI.all.map(p => p.balAt || 0))) : '—', '最后一次成功查询') +
    '</div>' +

    (needKey.length ? '<div class="card" style="margin-bottom:18px;border-color:color-mix(in srgb,var(--amber) 34%,var(--line))">' +
      '<div class="card__bd" style="display:flex;gap:12px;align-items:flex-start;background:var(--amber-soft);border-radius:0">' +
        ic('warn', 'bal__warnIc') + '<div style="flex:1"><b style="font-size:14px">还有 ' + needKey.length + ' 个供应商没填 Key</b>' +
        '<div class="tiny" style="color:var(--ink-2);margin-top:3px">' + esc(needKey.map(p => p.name).join('、')) + '。填好之后就能查余额、也能用来总结新闻。</div></div>' +
        '<button class="btn btn--sm" id="balFill">去填写</button>' +
      '</div></div>' : '') +

    '<div class="row row--mid" style="margin-bottom:14px">' +
      '<div class="seg" id="balSeg">' +
        '<button data-f="all" class="' + (Bal.filter === 'all' ? 'is-on' : '') + '">全部</button>' +
        '<button data-f="key" class="' + (Bal.filter === 'key' ? 'is-on' : '') + '">已配置</button>' +
        '<button data-f="nokey" class="' + (Bal.filter === 'nokey' ? 'is-on' : '') + '">待配置</button>' +
      '</div>' +
      '<div style="flex:1"></div>' +
      '<button class="btn" id="balAdd">' + ic('plus') + '添加供应商</button>' +
      '<button class="btn btn--primary" id="balRefresh">' + ic('refresh') + '刷新余额</button>' +
    '</div>' +

    '<div class="grid g-3" id="balGrid"></div>' +
    '<p class="hint" style="margin-top:18px">余额直接向各厂商官方接口查询，仅在你的浏览器与厂商服务器之间通信；API Key 只保存在你本机的 localStorage，不会上传到任何第三方。部分厂商（如小米 MiMo）可能未开放余额接口，此时会给出明确说明。</p>';

  $('#balAdd').onclick = () => openProviderEditor();
  $('#balRefresh').onclick = () => {
    if (!AI.all.some(p => p.key)){ toast('warn', '还没有可查询的账户', '先给至少一个供应商填上 API Key。', 5000, [{ text:'去添加', fn: () => openProviderEditor() }]); return; }
    AI.refreshAll();
  };
  $('#balFill')?.addEventListener('click', () => {
    const p = needKey[0];
    if (p) openProviderEditor(p.id);
  });
  $$('#balSeg button').forEach(b => b.onclick = () => { Bal.filter = b.dataset.f; renderBalance(); });
  drawBalGrid();

  function statCard(label, val, sub){
    return '<div class="stat"><span>' + esc(label) + '</span><b>' + esc(val) + '</b><em>' + esc(sub) + '</em></div>';
  }
}

function drawBalGrid(){
  const grid = $('#balGrid');
  if (!grid) return;
  let ps = AI.all;
  if (Bal.filter === 'key') ps = ps.filter(p => p.key);
  if (Bal.filter === 'nokey') ps = ps.filter(p => !p.key);
  if (!ps.length){
    grid.innerHTML = '<div class="empty" style="grid-column:1/-1">' + ic('key') +
      '<p>这里还没有供应商</p><small>添加一个，填入 API Key 就能查看余额。</small>' +
      '<div style="margin-top:14px"><button class="btn btn--primary" id="balAdd2">' + ic('plus') + '添加供应商</button></div></div>';
    $('#balAdd2').onclick = () => openProviderEditor();
    return;
  }
  grid.innerHTML = ps.map(p => {
    const working = Bal.working.includes(p.id);
    const has = p.key && p.balErr === '';
    const bal = p.bal;
    const pct = has && bal !== null ? clamp(bal / 50 * 100, 2, 100) : 0;
    return '<div class="bal" style="--bal-c:' + escAttr(p.color) + '">' +
      '<div class="bal__hd">' +
        '<div class="bal__logo">' + esc(p.letter || p.name[0]) + '</div>' +
        '<div class="bal__meta"><b>' + esc(p.name) + '</b><small>' + esc(shortBase(p.base)) + '</small></div>' +
        '<button class="btn btn--ghost btn--icon btn--sm" data-edit="' + escAttr(p.id) + '" title="设置">' + ic('gear') + '</button>' +
      '</div>' +
      (working
        ? '<div class="bal__amt" style="color:var(--ink-4);font-family:var(--f-sans);font-size:14px;display:flex;align-items:center;gap:7px">' + ic('refresh','spin') + '查询中…</div>'
        : !p.key
          ? '<div class="bal__amt is-err" style="color:var(--amber)">尚未配置 API Key</div>'
          : p.balErr
            ? (/未开放余额查询/.test(p.balErr)
                ? '<div class="bal__note">' + ic('info') + '<span>' + esc(p.balErr) + '</span></div>' +
                  (p.consoleUrl
                    ? '<a class="btn btn--sm btn--block" style="margin-top:8px;text-decoration:none" href="' +
                        escAttr(p.consoleUrl) +
                        '" target="_blank" rel="noopener">' + ic('wallet') + '去官方控制台查看</a>'
                    : '')
                : '<div class="bal__amt is-err">' + esc(p.balErr) + '</div>')
            : '<div class="bal__amt">¥' + esc(money(bal)) + ' <i>' + esc(p.balMeta?.currency || 'CNY') + '</i></div>') +
      (has && bal !== null ?
        '<div class="bal__bar"><i style="width:' + pct + '%"></i></div>' +
        (p.balMeta?.granted || p.balMeta?.topped ?
          '<div class="bal__row"><span>赠送</span><b>¥' + esc(money(p.balMeta.granted || 0)) + '</b></div>' +
          '<div class="bal__row"><span>充值</span><b>¥' + esc(money(p.balMeta.topped || 0)) + '</b></div>' : '')
        : '') +
      '<div class="bal__ft">' +
        '<span class="tiny">' + (p.balAt ? '更新于 ' + fmtAgo(p.balAt) : '尚未查询') + '</span>' +
        '<button class="btn btn--sm btn--ghost" data-q="' + escAttr(p.id) + '">' + ic('refresh') + '刷新</button>' +
        '<button class="btn btn--sm ' + (p.key ? 'btn--primary' : '') + '" data-set="' + escAttr(p.id) + '">' +
          (p.key ? '编辑 Key' : '填 Key') + '</button>' +
      '</div>' +
    '</div>';
  }).join('');
  $$('[data-edit]', grid).forEach(b => b.onclick = () => openProviderEditor(b.dataset.edit));
  $$('[data-set]', grid).forEach(b => b.onclick = () => openProviderEditor(b.dataset.set));
  $$('[data-q]', grid).forEach(b => b.onclick = async () => {
    const p = AI.get(b.dataset.q);
    Bal.working = [p.id]; drawBalGrid();
    // 同 refreshAll：finally 保证 loading 态一定被清掉
    let r;
    try { r = await AI.fetchBalance(p); }
    finally { Bal.working = []; }
    if (!r){ drawBalGrid(); toast('err', p.name + ' 查询异常', '请求意外中断，请重试。', 5000); return; }
    Store.db.providers = Store.db.providers.map(x => x.id === p.id
      ? { ...x, bal: r.ok ? r.amount : null, balAt: r.ok ? Date.now() : x.balAt, balErr: r.ok ? '' : r.err, balMeta: r.ok ? r : null } : x);
    Store.save(); drawBalGrid();
    if (r.ok) toast('ok', p.name + ' 余额 ¥' + money(r.amount));
    else toast('err', p.name + ' 查询失败', r.err, 6500);
  });
  function shortBase(u){
    if (!u) return '未设置地址';
    try { return new URL(u).host; } catch (e){ return String(u).slice(0, 40); }
  }
}

/** 添加 / 编辑供应商 */
function openProviderEditor(id){
  const editing = id ? AI.get(id) : null;
  let kind = editing ? editing.kind : 'custom';
  const preseeds = Object.keys(AI.PROFILES).filter(k => k !== 'custom');

  const parts = [];
  parts.push('<div class="sect"><h4>供应商</h4><div class="provgrid" id="pvGrid">' +
    preseeds.map(k => {
      const pr = AI.PROFILES[k];
      return '<button class="prov' + (kind === k ? ' is-on' : '') + '" data-k="' + k + '" style="--prov-c:' + pr.color + '">' +
        '<b><i></i>' + esc(pr.name) + '</b><small>' + esc(pr.base.replace('https://', '')) + '</small></button>';
    }).join('') +
    '<button class="prov' + (kind === 'custom' ? ' is-on' : '') + '" data-k="custom" style="--prov-c:' + AI.PROFILES.custom.color + '">' +
      '<b><i></i>自定义</b><small>OpenAI 兼容接口</small></button>' +
    '</div></div>');

  parts.push('<div class="sect"><h4>账户信息</h4><div class="stack">' +
    '<div class="field"><label for="pvName">显示名称</label>' +
      '<input class="inp" id="pvName" value="' + escAttr(editing?.name || '') + '" placeholder="例如 我的 DeepSeek"></div>' +
    '<div class="field"><label for="pvBase">API Base URL</label>' +
      '<input class="inp inp--mono" id="pvBase" value="' + escAttr(editing?.base || '') + '" placeholder="https://api.example.com/v1" autocomplete="off" spellcheck="false"></div>' +
    '<div class="field"><label for="pvKey">API Key</label>' +
      '<div style="position:relative"><input class="inp inp--mono" id="pvKey" type="password" value="' + escAttr(editing?.key || '') +
        '" placeholder="sk-..." autocomplete="off" spellcheck="false" style="padding-right:40px">' +
      '<button class="btn btn--ghost btn--icon btn--sm" id="pvEye" title="显示/隐藏" style="position:absolute;right:2px;top:2px">' + ic('eye') + '</button></div>' +
      '<p class="hint" id="pvKeyHint">Key 只存在这台设备的 localStorage 里，不会上传。点「测试连接」可以验证是否可用。</p></div>' +
    '<div class="field"><label for="pvModel">默认模型（用于 AI 总结，可留空）</label>' +
      '<input class="inp inp--mono" id="pvModel" value="' + escAttr((editing?.models || [])[0] || '') +
        '" placeholder="deepseek-chat" autocomplete="off" spellcheck="false">' +
      '<p class="hint" id="pvModelHint"></p></div>' +
    '</div></div>');

  parts.push('<div class="sect"><h4>操作</h4><div class="row row--tight">' +
    '<button class="btn" id="pvTest">' + ic('shield') + '测试连接</button>' +
    '<button class="btn" id="pvBal">' + ic('wallet') + '查余额</button>' +
    '<button class="btn" id="pvModels">' + ic('list') + '拉取模型列表</button>' +
    (editing ? '<button class="btn btn--danger" id="pvDel">' + ic('trash') + '删除</button>' : '') +
    '</div><div id="pvOut" style="margin-top:12px"></div></div>');

  const d = drawer({
    title: editing ? '编辑供应商' : '添加供应商',
    sub: editing ? editing.name : '支持主流厂商与任意 OpenAI 兼容接口',
    body: parts.join(''),
    foot: '<button class="btn" id="pvCancel">取消</button><button class="btn btn--primary" id="pvSave">' + ic('save') + '保存</button>'
  });

  // 显式绑 close()：不依赖 drawer() 的通用关闭钩子，按钮自己就是一个确定入口。
  $('#pvCancel', d.foot).onclick = () => d.close();

  const applyKind = (k, force) => {
    kind = k;
    $$('#pvGrid .prov').forEach(b => b.classList.toggle('is-on', b.dataset.k === k));
    const pr = AI.PROFILES[k];
    if (force || !editing || editing.kind !== k){
      $('#pvBase').value = pr.base || '';
      $('#pvName').value = pr.name === '自定义' ? ($('#pvName').value || '') : pr.name;
      $('#pvModel').value = (pr.models || [])[0] || '';
    }
    $('#pvModelHint').innerHTML = (pr.models && pr.models.length)
      ? '常用：' + pr.models.map(m => '<code style="font-family:var(--f-num)">' + esc(m) + '</code>').join('、')
      : '自定义服务请填写该服务支持的模型名，例如 <code style="font-family:var(--f-num)">gpt-4o-mini</code>';
    $('#pvKeyHint').innerHTML = pr.keys
      ? '还没有 Key？到 <a href="' + escAttr(pr.keys) + '" target="_blank" rel="noopener noreferrer">' + esc(pr.name) + ' 控制台</a> 申请。Key 只存在本机，不会上传。'
      : 'Key 只存在这台设备的 localStorage 里，不会上传。点「测试连接」可以验证是否可用。';
  };
  $$('#pvGrid .prov', d.body).forEach(b => b.onclick = () => applyKind(b.dataset.k, true));
  if (!editing) applyKind(kind, true);
  else {
    $$('#pvGrid .prov').forEach(b => b.classList.toggle('is-on', b.dataset.k === kind));
    $('#pvModelHint').innerHTML = '常用模型请参考厂商文档。';
  }

  $('#pvEye').onclick = () => {
    const i = $('#pvKey');
    i.type = i.type === 'password' ? 'text' : 'password';
  };

  const collect = () => ({
    name: $('#pvName').value.trim() || AI.PROFILES[kind].name || '未命名',
    kind,
    base: $('#pvBase').value.trim().replace(/\/$/, ''),
    key: $('#pvKey').value.trim(),
    color: AI.PROFILES[kind].color,
    letter: (AI.PROFILES[kind].name || '自')[0],
    models: [$('#pvModel').value.trim()].filter(Boolean)
  });

  const out = (html, kindCls) => {
    $('#pvOut').innerHTML = '<div style="padding:11px 13px;border-radius:10px;font-size:13px;line-height:1.6;background:var(--' +
      (kindCls || 'surface-3') + ');color:var(--ink-2)">' + html + '</div>';
  };

  $('#pvTest').onclick = async () => {
    const c = collect();
    if (!c.base){ out('请先填写 API Base URL。'); return; }
    if (!c.key){ out('请先填写 API Key。'); return; }
    $('#pvTest').disabled = true;
    out(ic('refresh','spin') + ' 正在测试 /models 接口…');
    const tmp = { ...c, id: 'tmp' };
    const m = await AI.listModels(tmp);
    const r = await AI.fetchBalance(tmp);
    $('#pvTest').disabled = false;
    if (r.ok){
      out('<b style="color:var(--sage)">连接正常。</b>余额接口可用，当前余额 ¥' + money(r.amount) + '（' + esc(r.currency || 'CNY') + '）。' +
          (m ? '<br>可用模型 ' + m.length + ' 个：' + m.slice(0, 6).map(x => '<code style="font-family:var(--f-num)">' + esc(x) + '</code>').join('、') + (m.length > 6 ? ' 等' : '') : ''), 'sage-soft');
    } else if (m && m.length){
      out('<b style="color:var(--sage)">Key 有效。</b>/models 返回 ' + m.length + ' 个模型，但余额查询不可用：' + esc(r.err) + '<br>这不影响用这个 Key 做新闻总结。', 'sage-soft');
    } else {
      out('<b style="color:var(--danger)">连接失败：</b>' + esc(r.err) + '<br>请检查 Base URL 与 Key 是否正确；部分厂商可能不支持浏览器直连（CORS），这种情况需要其官方代理地址。', 'danger-soft');
    }
  };
  $('#pvBal').onclick = async () => {
    const c = collect();
    if (!c.key){ out('请先填写 API Key。'); return; }
    out(ic('refresh','spin') + ' 查询余额…');
    const r = await AI.fetchBalance({ ...c, id: 'tmp' });
    if (r.ok) out('<b style="color:var(--sage)">余额：¥' + money(r.amount) + '</b> （' + esc(r.currency || 'CNY') + '）' +
      (r.granted || r.topped ? '<br>赠送 ¥' + money(r.granted || 0) + ' · 充值 ¥' + money(r.topped || 0) : '') +
      (r.ep ? '<br><span class="tiny muted">接口：' + esc(r.ep) + '</span>' : ''), 'sage-soft');
    else out('<b style="color:var(--danger)">查询失败：</b>' + esc(r.err), 'danger-soft');
  };
  $('#pvModels').onclick = async () => {
    const c = collect();
    if (!c.key){ out('请先填写 API Key。'); return; }
    out(ic('refresh','spin') + ' 拉取中…');
    const m = await AI.listModels({ ...c, id: 'tmp' });
    if (!m){ out('该服务未提供 /models 接口，或者浏览器无法直连。', 'amber-soft'); return; }
    out('<b>共 ' + m.length + ' 个模型</b><div style="margin-top:9px;max-height:190px;overflow-y:auto">' +
      m.map(x => '<button class="btn btn--sm" style="margin:0 4px 4px 0" data-m="' + escAttr(x) + '">' + esc(x) + '</button>').join('') +
      '</div><p class="hint">点一个即可填入上方模型框。</p>');
    $$('#pvOut [data-m]').forEach(b => b.onclick = () => { $('#pvModel').value = b.dataset.m; toast('ok', '已填入模型 ' + b.dataset.m, '', 2400); });
  };
  if (editing){
    $('#pvDel').onclick = () => {
      modal({
        title: '删除供应商', desc: '「' + editing.name + '」及其密钥将从本机移除，此操作不可撤销。',
        okText: '确认删除', danger: true,
        onOk: () => {
          Store.mutate(db => { db.providers = db.providers.filter(p => p.id !== editing.id); });
          d.close(); renderBalance();
          toast('ok', '已删除 ' + editing.name);
        }
      });
    };
  }
  $('#pvSave').onclick = () => {
    const c = collect();
    if (!c.base){ toast('warn', 'Base URL 不能为空', '每个供应商都需要一个接口地址。'); return; }
    if (editing){
      Store.mutate(db => {
        db.providers = db.providers.map(p => p.id === editing.id ? { ...p, ...c } : p);
      });
    } else {
      Store.mutate(db => {
        db.providers.push({ id: uid(), ...c, bal: null, balAt: 0, balErr: '' });
        db.demo = false;
      });
    }
    d.close(); renderBalance();
    toast('ok', editing ? '已保存修改' : '已添加 ' + c.name, c.key ? '可以点「刷新余额」查看了。' : '还没填 Key，暂时无法查询。');
    if (editing && !c.key) return;
  };
}

/* ------------------------------ 新闻视图 ------------------------------ */
function renderNews(){
  const box = $('#view');
  const en = Store.db.settings.newsSources || [];
  const models = AI.all.filter(p => p.key);
  const pick = Store.db.settings.newsAI;
  const last = Store.db.settings.lastNews;

  box.innerHTML =
    '<div class="newsbar">' +
      '<button class="btn btn--primary" id="nwFetch">' + ic('refresh') + '刷新热榜</button>' +
      '<button class="btn" id="nwSrc">' + ic('list') + '管理来源 <span class="tag" style="margin-left:2px">' + en.length + '</span></button>' +
      (last?.at ? '<span class="tiny muted">上次更新 ' + esc(fmtAgo(last.at)) + '</span>' : '') +
      '<div style="flex:1"></div>' +
      (News.items.length ? '<button class="btn" id="nwExport">' + ic('copy') + '复制全部</button>' : '') +
    '</div>' +

    '<div class="newslayout">' +
      '<div class="card newsside">' +
        '<div class="card__hd"><h3>' + ic('spark') + 'AI 总结</h3></div>' +
        '<div class="card__bd">' +
          (models.length ? '' :
            '<div class="empty" style="padding:22px 14px;margin-bottom:12px">' + ic('key') +
            '<p>还没有可用的 AI</p><small>填一个 API Key 就能让模型帮你把热榜读成摘要。</small>' +
            '<div style="margin-top:12px"><button class="btn btn--sm btn--primary" id="nwGoBal">去配置</button></div></div>') +
          '<div class="aipick" id="nwPick">' +
            (models.length ? models.map(p =>
              '<button data-p="' + escAttr(p.id) + '" class="' + (pick === p.id ? 'is-on' : '') + '">' +
              '<i style="background:' + escAttr(p.color) + '"></i>' + esc(p.name) + '</button>').join('')
              : '<span class="tiny muted">配置后这里会出现可选模型</span>') +
          '</div>' +
          '<div class="stack--sm" style="display:flex;flex-direction:column;gap:8px">' +
            '<button class="btn btn--primary btn--block" id="nwSum"' + (models.length && News.items.length ? '' : ' disabled') + '>' +
              (News.summarizing ? ic('refresh','spin') + '总结中…' : ic('spark') + '生成总结') + '</button>' +
            (models.length > 1 ? '<button class="btn btn--block" id="nwSumAll"' + (News.items.length ? '' : ' disabled') + '>' + ic('list') + '多模型交叉对比</button>' : '') +
          '</div>' +
          '<p class="hint" style="margin-top:11px">模型只读取热榜标题文本，不会抓取网页正文。结果仅供参考，重要信息请核对原始来源。</p>' +
        '</div>' +
      '</div>' +

      '<div>' +
        (News.loading ? '<div class="card" style="padding:38px;text-align:center"><div class="skeleton" style="height:16px;width:60%;margin:0 auto 10px"></div><div class="skeleton" style="height:16px;width:80%;margin:0 auto 10px"></div><div class="skeleton" style="height:16px;width:45%;margin:0 auto"></div><p class="muted tiny" style="margin-top:16px">正在抓取热榜…</p></div>' :
         News.err ? '<div class="empty" style="margin-bottom:14px">' + ic('warn') + '<p>抓取遇到问题</p><small>' + esc(News.err) + '</small></div>' : '') +
        (News.items.length ? '' : (News.loading ? '' :
          '<div class="empty">' + ic('news') + '<p>还没有热榜数据</p><small>点上方「刷新热榜」抓取一次。若长时间无结果，可能是聚合代理被限流，稍后再试即可。</small></div>')) +
        '<div id="nwList"></div>' +
      '</div>' +
    '</div>';

  // AI 选择
  $$('#nwPick button').forEach(b => b.onclick = () => {
    Store.db.settings.newsAI = b.dataset.p; Store.save();
    $$('#nwPick button').forEach(x => x.classList.toggle('is-on', x === b));
  });
  $('#nwFetch')?.addEventListener('click', () => News.fetchAll());
  $('#nwExport')?.addEventListener('click', () => {
    const txt = News.items.map((x, i) => (i + 1) + '. ' + x.title + '（' + x.srcName + '）\n    ' + x.url).join('\n');
    navigator.clipboard?.writeText(txt).then(
      () => toast('ok', '已复制全部热榜', News.items.length + ' 条已放入剪贴板'),
      () => toast('err', '复制失败', '浏览器拒绝了剪贴板访问。')
    );
  });
  $('#nwGoBal')?.addEventListener('click', () => { location.hash = '#/balance'; });
  $('#nwSum')?.addEventListener('click', () => {
    const sel = Store.db.settings.newsAI;
    const p = AI.get(sel) || models[0];
    if (!p){ toast('warn', '没有可用 AI'); return; }
    News.summarize(p.id);
  });
  $('#nwSumAll')?.addEventListener('click', () => News.summarizeMulti(models.map(p => p.id)));
  $('#nwSrc')?.addEventListener('click', () => openSourcePicker());

  $('#nwList').innerHTML = renderNewsList();
  bindNewsList();
}

function renderNewsList(){
  if (!News.items.length) return '';
  const cats = {};
  News.items.forEach(x => { (cats[x.src] = cats[x.src] || []).push(x); });
  let html = '';
  // AI 总结显示在前
  const ids = Object.keys(News.summaries);
  if (ids.length && !News.summarizing){
    html += '<div class="newsai" style="margin-bottom:14px">' +
      '<div class="newsai__hd">' + ic('spark') +
        '<b>' + (ids.length > 1 ? ids.length + ' 个模型的总结对照' : esc(AI.get(ids[0])?.name || '') + ' 的总结') + '</b>' +
        '<span class="tag tag--accent">' + esc(AI.get(Store.db.settings.newsAI)?.models?.[0] || '') + '</span>' +
        '<div style="flex:1"></div>' +
        (ids.length > 1 ? '<div class="seg" id="sumTab">' + ids.map((id, i) =>
          '<button data-s="' + escAttr(id) + '" class="' + (i === 0 ? 'is-on' : '') + '">' + esc(AI.get(id)?.name || id) + '</button>').join('') + '</div>' : '') +
        '<button class="btn btn--sm btn--ghost" id="sumCopy">' + ic('copy') + '复制</button>' +
        '<button class="btn btn--sm btn--ghost" id="sumClear">' + ic('x') + '</button>' +
      '</div>' +
      '<div id="sumBody">' + News.md(News.summaries[ids[0]].text) + '</div>' +
      '<div class="tiny muted" style="margin-top:11px;padding-top:10px;border-top:1px solid var(--line)">' +
        '生成于 ' + esc(fmtTime(News.summaries[ids[0]].at)) + ' · 模型 ' + esc(News.summaries[ids[0]].model || '') +
        (News.summaries[ids[0]].usage ? ' · 消耗 ' + esc(News.summaries[ids[0]].usage.total_tokens || '?') + ' tokens' : '') +
        ' · 内容由 AI 生成，请自行核实' +
      '</div>' +
    '</div>';
  } else if (News.summarizing){
    html += '<div class="newsai" style="margin-bottom:14px"><div class="newsai__hd">' + ic('spark','spin') +
      '<b>正在让模型阅读热榜…</b></div>' +
      '<div class="skeleton" style="height:13px;width:85%;margin-bottom:9px"></div>' +
      '<div class="skeleton" style="height:13px;width:70%;margin-bottom:9px"></div>' +
      '<div class="skeleton" style="height:13px;width:78%"></div></div>';
  }
  html += '<div class="newsfeed">' + News.items.map((x, i) => {
    const hot = x.hot ? '<small class="num">' + ic('fire') + abbr(x.hot) + '</small>' : '';
    return '<a class="newsi" href="' + escAttr(safeUrl(x.url) || '#') + '" target="_blank" rel="noopener noreferrer" data-i="' + i + '">' +
      '<div class="newsi__rk">' + (i + 1) + '</div>' +
      '<div class="newsi__bd"><div class="newsi__t">' + esc(x.title) + '</div>' +
      '<div class="newsi__m"><small>' + ic('link') + esc(x.srcName) + '</small>' + hot +
      (x.sort === 'hot' ? '<small style="color:var(--accent)">热度榜</small>' : '') + '</div></div>' +
      ic('chev', 'newsi__go') +
      '</a>';
  }).join('') + '</div>';
  return html;
}
function bindNewsList(){
  const ids = Object.keys(News.summaries);
  $('#sumTab') && $$('#sumTab button').forEach(b => b.onclick = () => {
    $$('#sumTab button').forEach(x => x.classList.toggle('is-on', x === b));
    const s = News.summaries[b.dataset.s];
    $('#sumBody').innerHTML = News.md(s.text);
  });
  $('#sumCopy')?.addEventListener('click', () => {
    const id = $('#sumTab') ? ($('#sumTab .is-on')?.dataset.s || ids[0]) : ids[0];
    const s = News.summaries[id];
    if (!s) return;
    navigator.clipboard?.writeText(s.text).then(
      () => toast('ok', '已复制总结到剪贴板'),
      () => toast('err', '复制失败', '浏览器拒绝了剪贴板访问。')
    );
  });
  $('#sumClear')?.addEventListener('click', () => {
    News.summaries = {}; News.summarizeErr = ''; renderNews();
  });
}

/** 来源管理 */
function openSourcePicker(){
  const st = Store.db.settings;
  const set = new Set(st.newsSources || []);
  const d = drawer({
    title: '管理新闻来源',
    sub: '选中的来源会一起抓取并交错展示',
    side: 'l',
    body:
      '<div class="sect"><h4>榜单来源（' + NEWS_SOURCES.length + '）</h4><div class="srclist" id="spList">' +
      NEWS_SOURCES.map(s => '<button class="srcitem' + (set.has(s.id) ? ' is-on' : '') + '" data-s="' + s.id + '">' +
        '<span class="srcitem__box">' + ic('check') + '</span>' +
        '<b>' + esc(s.name) + '</b><small>' + esc(s.tag) + '</small></button>').join('') +
      '</div></div>' +
      '<div class="sect"><h4>快捷操作</h4><div class="row row--tight">' +
        '<button class="btn btn--sm" id="spAll">全选</button>' +
        '<button class="btn btn--sm" id="spNone">全不选</button>' +
        '<button class="btn btn--sm" id="spHot">只留热度类</button>' +
      '</div><p class="hint">数据来自开源公开接口（60s API），无需登录。主站不可用时会自动切换到备用实例；某个来源失败会被跳过，不影响其余来源。建议保持 3–6 个，加载更快。</p></div>',
    foot: '<button class="btn btn--primary btn--block" id="spSave">保存并刷新</button>'
  });
  const list = $('#spList', d.body);
  list.onclick = e => {
    const b = e.target.closest('.srcitem'); if (!b) return;
    b.classList.toggle('is-on');
  };
  const setAll = k => {
    const ids = k === 'all' ? NEWS_SOURCES.map(s => s.id)
      : k === 'none' ? []
      : ['weibo', 'zhihu', 'toutiao', 'douyin'];   // 热搜类
    $$('.srcitem', list).forEach(b => b.classList.toggle('is-on', ids.includes(b.dataset.s)));
  };
  $('#spAll', d.body).onclick = () => setAll('all');
  $('#spNone', d.body).onclick = () => setAll('none');
  $('#spHot', d.body).onclick = () => setAll('hot');
  const spSave = $('#spSave', d.el) || $('#spSave');   // 该按钮在抽屉底部
  spSave.onclick = () => {
    const ids = $$('.srcitem.is-on', list).map(b => b.dataset.s);
    if (!ids.length){ toast('warn', '至少要选一个来源'); return; }
    st.newsSources = ids; Store.save();
    d.close(); renderNews();
    News.fetchAll();
  };
}
