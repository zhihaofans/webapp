"use strict";
/* ============================================================================
   日常 · 生活工作台
   多文件 / 零依赖 / 纯本地存储
   模块顺序： utils → store → ui → weather → balance → news
             → notes → money → todo → habits → backup → router → boot
   ============================================================================ */

/* ==========================================================================
   0. 工具
   ========================================================================== */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const LS_MAIN = 'lifehub.v1';
const LS_BAK  = 'lifehub.v1.bak';
const SCHEMA  = 1;

/* 应用版本 —— 改代码时同步 +0.1，方便一眼看出线上跑的是哪一版。
   APP_VER 是「发布版本」，SCHEMA 是「数据架构版本」，两者独立：
   只改样式/文案时 APP_VER 变、SCHEMA 不变，老数据不会被误判为过期。 */
const APP_VER    = '1.19';
const APP_NAME   = '日常 · 生活工作台';
const APP_BUILD  = '2026-10-02';

/** HTML 转义 —— 所有用户输入渲染前必过 */
function esc(v){
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
/** 属性值专用（更严格） */
function escAttr(v){ return esc(v).replace(/`/g, '&#96;'); }

/** 只允许 http/https 链接，阻断 javascript: 等 */
function safeUrl(u){
  if (!u) return '';
  const s = String(u).trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (/^\/\//.test(s)) return 'https:' + s;
  return '';
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const pad2 = n => String(n).padStart(2, '0');
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

/** 本地日期键 YYYY-MM-DD（不用 toISOString，避免时区偏移） */
function dayKey(d = new Date()){
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
function addDays(d, n){ const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function fromKey(k){ const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }

const WEEK = ['周日','周一','周二','周三','周四','周五','周六'];
function fmtDay(d){
  const t = new Date();
  const diff = Math.round((fromKey(dayKey(d)) - fromKey(dayKey(t))) / 86400000);
  if (diff === 0) return '今天';
  if (diff === -1) return '昨天';
  if (diff === 1) return '明天';
  if (diff === -2) return '前天';
  return (d.getMonth() + 1) + '月' + d.getDate() + '日';
}
function fmtAgo(ts){
  const s = (Date.now() - ts) / 1000;
  if (s < 45) return '刚刚';
  if (s < 3600) return Math.floor(s / 60) + ' 分钟前';
  if (s < 86400) return Math.floor(s / 3600) + ' 小时前';
  if (s < 86400 * 30) return Math.floor(s / 86400) + ' 天前';
  return fmtDay(new Date(ts));
}
function fmtTime(ts){ const d = new Date(ts); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
function fmtDT(ts){ const d = new Date(ts); return fmtDay(d) + ' ' + fmtTime(ts); }

/** 金额：最多 2 位小数，去掉无意义的 .00 */
function money(n){
  const v = Number(n) || 0;
  if (Math.abs(v) >= 1000) return v.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (Math.round(v * 100) / 100).toFixed(2).replace(/\.00$/, '');
}

/** 数字缩写：1234 → 1.2k，12345678 → 1234.6万 */
function abbr(n){
  const v = Number(n) || 0;
  if (v >= 1e8) return (v / 1e8).toFixed(1).replace(/\.0$/, '') + '亿';
  if (v >= 1e4) return (v / 1e4).toFixed(1).replace(/\.0$/, '') + '万';
  if (v >= 1e3) return (v / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(v);
}

/** 防抖 */
function debounce(fn, ms = 300){
  let t; return function(...a){ clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
}

/** 带超时的 fetch */
async function jget(url, opts = {}, ms = 12000){
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { ...opts, signal: ctl.signal });
    return r;
  } finally { clearTimeout(timer); }
}
async function jjson(url, opts = {}, ms = 12000){
  const r = await jget(url, opts, ms);
  const txt = await r.text();
  let data = null;
  try { data = JSON.parse(txt); } catch (e) { throw new Error('返回内容不是合法 JSON（HTTP ' + r.status + '）'); }
  if (!r.ok) {
    const m = (data && (data.error?.message || data.message || data.msg)) || ('HTTP ' + r.status);
    const err = new Error(m); err.status = r.status; err.data = data; throw err;
  }
  return data;
}

/** 依次尝试多个候选源，返回第一个成功的 */
async function firstOk(tasks, timeoutMs = 9000){
  let lastErr = null;
  for (const t of tasks) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      try { return await t(ctl.signal); }
      finally { clearTimeout(timer); }
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('全部数据源均不可用');
}

/* ==========================================================================
   1. 图标（内联 SVG sprite，零外部依赖）
   ========================================================================== */
const ICONS = {
  sun:'<circle cx="12" cy="12" r="4.2"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"/>',
  cloud:'<path d="M6.5 18.5h10a3.5 3.5 0 0 0 .3-6.99A5 5 0 0 0 7.3 10.2a4.15 4.15 0 0 0-.8 8.3z"/>',
  rain:'<path d="M6.5 15.5h10a3.5 3.5 0 0 0 .3-6.99A5 5 0 0 0 7.3 7.7a4.15 4.15 0 0 0-.8 7.8z"/><path d="M8.5 18.5l-.8 2M12 18.5l-.8 2M15.5 18.5l-.8 2"/>',
  snow:'<path d="M6.5 15.5h10a3.5 3.5 0 0 0 .3-6.99A5 5 0 0 0 7.3 7.7a4.15 4.15 0 0 0-.8 7.8z"/><path d="M9 18.9v.1M12 19.9v.1M15 18.9v.1" stroke-width="2.4"/>',
  storm:'<path d="M6.5 14.5h10a3.5 3.5 0 0 0 .3-6.99A5 5 0 0 0 7.3 6.7a4.15 4.15 0 0 0-.8 7.8z"/><path d="M12.5 16.5l-2.2 3.6h3.2l-2.2 3.4" stroke-width="1.9"/>',
  fog:'<path d="M6.5 13.5h10a3.5 3.5 0 0 0 .3-6.99A5 5 0 0 0 7.3 5.7a4.15 4.15 0 0 0-.8 7.8z"/><path d="M5 17h14M7 20.5h10"/>',
  moon:'<path d="M20 14.6A8.6 8.6 0 0 1 9.4 4a8.7 8.7 0 1 0 10.6 10.6z"/>',
  partly:'<circle cx="8.5" cy="8.5" r="3"/><path d="M8.5 2.6v1.4M2.6 8.5h1.4M4.3 4.3l1 1M12.7 4.3l-1 1M4.3 12.7l1-1"/><path d="M10 19.6h8a3.3 3.3 0 0 0 .3-6.6A4.7 4.7 0 0 0 9.2 12a3.9 3.9 0 0 0 .8 7.6z"/>',
  loc:'<path d="M12 21.5s7-6.2 7-11.2a7 7 0 1 0-14 0c0 5 7 11.2 7 11.2z"/><circle cx="12" cy="10.3" r="2.6"/>',
  search:'<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  refresh:'<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.5 4.2v4.6h-4.6"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  x:'<path d="M6 6l12 12M18 6L6 18"/>',
  check:'<path d="M4.5 12.5l5 5 10-11"/>',
  trash:'<path d="M4 7h16M9.5 7V4.8h5V7M6.5 7l1 13h9l1-13"/><path d="M10.5 11v5.5M13.5 11v5.5"/>',
  edit:'<path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z"/><path d="M14.5 6.5l3 3"/>',
  dl:'<path d="M12 3.5v11M7.5 10.5l4.5 4.5 4.5-4.5"/><path d="M4.5 19.5h15"/>',
  ul:'<path d="M12 20.5v-11M7.5 13.5l4.5-4.5 4.5 4.5"/><path d="M4.5 4.5h15"/>',
  gear:'<circle cx="12" cy="12" r="3.2"/><path d="M12 2.6l1.4 2.6a7.6 7.6 0 0 1 2.2.9l2.8-.8 1.3 2.3-2 2.1a7.7 7.7 0 0 1 0 2.4l2 2.1-1.3 2.3-2.8-.8a7.6 7.6 0 0 1-2.2.9L12 21.4l-1.4-2.6a7.6 7.6 0 0 1-2.2-.9l-2.8.8-1.3-2.3 2-2.1a7.7 7.7 0 0 1 0-2.4l-2-2.1 1.3-2.3 2.8.8a7.6 7.6 0 0 1 2.2-.9z"/>',
  home:'<path d="M3.5 10.5L12 3.5l8.5 7"/><path d="M5.5 9.5v11h13v-11"/><path d="M10 20.5v-6h4v6"/>',
  news:'<path d="M4 5.5h13a2 2 0 0 1 2 2v11H6a2 2 0 0 1-2-2z"/><path d="M19 9h1.5v7.5a2 2 0 0 1-2 2"/><path d="M7.5 9h6M7.5 12.5h6M7.5 16h4"/>',
  wallet:'<path d="M3.5 7.5A2 2 0 0 1 5.5 5.5h11a2 2 0 0 1 2 2v1"/><rect x="3.5" y="7.5" width="17" height="11.5" rx="2.2"/><circle cx="16.5" cy="13.2" r="1.2"/>',
  spark:'<path d="M12 3.2l1.9 4.9 4.9 1.9-4.9 1.9L12 16.8l-1.9-4.9-4.9-1.9 4.9-1.9z"/><path d="M18.5 15.5l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8z"/>',
  jar:'<path d="M6.5 8.5h11v10a3 3 0 0 1-3 3h-5a3 3 0 0 1-3-3z"/><path d="M5.2 4.5h13.6v4H5.2z"/><path d="M9.5 12.5h5"/>',
  cup:'<path d="M5.6 7h11.3l-1 12.1a2 2 0 0 1-2 1.8h-5.3a2 2 0 0 1-2-1.8z"/><path d="M4.4 7h13.6"/><path d="M16.9 10.2h1.3a2.3 2.3 0 0 1 0 4.6h-1.4"/>',
  list:'<path d="M8 6.5h12M8 12h12M8 17.5h12"/><path d="M4 6.5h.01M4 12h.01M4 17.5h.01" stroke-width="2.6"/>',
  fire:'<path d="M12 21.5c3.6 0 6.2-2.4 6.2-5.7 0-4.4-4.3-5.5-4.3-9.3 0-1.2.4-2.3 1-3.2-3.3.5-5.4 2.6-5.4 5.3 0 1.7.8 2.6.8 3.5 0 .9-.7 1.5-1.5 1.5-.9 0-1.6-.7-1.8-1.6-.6.9-1 2-1 3.3 0 3.4 2.6 6.2 6 6.2z"/>',
  clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.2V12l3.2 2"/>',
  info:'<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.1" stroke-width="2.2"/>',
  warn:'<path d="M12 3.5l9 15.5H3z"/><path d="M12 9.5v4.5M12 16.6v.1" stroke-width="2.2"/>',
  key:'<circle cx="8" cy="14" r="4.2"/><path d="M11.2 11.2L19 3.4M16.5 6l2.2 2.2M14 8.5l2.2 2.2"/>',
  eye:'<path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  chev:'<path d="M9 6l6 6-6 6"/>',
  save:'<path d="M5 4.5h11l3.5 3.5v11.5h-14z"/><path d="M8.5 4.5v5h7v-5M8.5 19.5v-5.5h7v5.5"/>',
  file:'<path d="M6 3.5h7l5 5v12H6z"/><path d="M13 3.5v5h5"/>',
  barchart:'<path d="M4 20.5h16"/><rect x="6" y="11" width="3.2" height="7" rx="1"/><rect x="11" y="7" width="3.2" height="11" rx="1"/><rect x="16" y="13.5" width="3.2" height="4.5" rx="1"/>',
  piechart:'<path d="M12 3.8a8.2 8.2 0 1 0 8.2 8.2H12z"/><path d="M14.6 2.6a8.2 8.2 0 0 1 6.8 6.8h-6.8z"/>',
  arrowUp:'<path d="M12 19V5M6 11l6-6 6 6"/>',
  arrowDown:'<path d="M12 5v14M6 13l6 6 6-6"/>',
  link:'<path d="M10 14a4 4 0 0 1 0-5.6l2.4-2.4a4 4 0 0 1 5.6 5.6l-1.2 1.2"/><path d="M14 10a4 4 0 0 1 0 5.6l-2.4 2.4a4 4 0 0 1-5.6-5.6l1.2-1.2"/>',
  target:'<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.8"/><circle cx="12" cy="12" r="1.3"/>',
  book:'<path d="M4 4.5h6.5a2 2 0 0 1 2 2v14A1.6 1.6 0 0 0 10.9 19H4z"/><path d="M20 4.5h-6.5a2 2 0 0 0-2 2v14A1.6 1.6 0 0 1 13.1 19H20z"/>',
  copy:'<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.2"/><path d="M15.5 5.5H6.5a2 2 0 0 0-2 2v9"/>',
  shield:'<path d="M12 3.2l7.5 3v5.4c0 4.6-3.1 8.4-7.5 9.7-4.4-1.3-7.5-5.1-7.5-9.7V6.2z"/><path d="M9 12l2.2 2.2 4.3-4.4"/>',
  drag:'<path d="M8 7h.01M8 12h.01M8 17h.01M16 7h.01M16 12h.01M16 17h.01" stroke-width="2.6"/>',
  star:'<path d="M12 3.4l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.9l6.1-.9z"/>',
  cal:'<rect x="3.5" y="5" width="17" height="15.5" rx="2.4"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><rect x="7.4" y="12.4" width="3" height="3" rx=".7" fill="currentColor" stroke="none"/><rect x="13.6" y="12.4" width="3" height="3" rx=".7" fill="currentColor" stroke="none"/>'
};
/** 渲染图标 */
function ic(name, extra = ''){
  const d = ICONS[name] || ICONS.info;
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"' + (extra ? ' class="' + extra + '"' : '') + '>' + d + '</svg>';
}

/* ==========================================================================
   2. 存储层  — 输入即存 / 损坏检测 / 自动恢复
   ========================================================================== */
const DEFAULT_SETTINGS = {
  theme: 'auto',
  city: { name: '深圳', lat: 22.54554, lon: 114.0683, region: '广东', manual: false, source: 'builtin' },
  cityHistory: [{ name: '深圳', lat: 22.54554, lon: 114.0683, region: '广东' },
                { name: '北京', lat: 39.9042, lon: 116.4074, region: '北京' },
                { name: '上海', lat: 31.2304, lon: 121.4737, region: '上海' },
                { name: '广州', lat: 23.1291, lon: 113.2644, region: '广东' }],
  newsSources: ['zhihu', 'weibo', 'baidu', '36kr'],
  newsAI: 'deepseek',
  // 默认 AI（v1.16）：饮品查值、摘要等「只用一个模型」的功能统一读它。
  // 空串表示还没选过 —— 运行时由 AI.pickDefault() 回退到第一个有 Key 的供应商。
  defaultAI: '',
  lastNews: null,
  lastWeather: null,
  backupHint: 20,
  moneyMode: 'expense',
  // 通勤时间：用于「今日」页展示上下班时段的天气。on 为总开关，
  // 默认关闭，避免打扰不关心通勤的用户。
  commute: { on: false, goH: 8, goM: 0, homeH: 18, homeM: 30, workdays: [1,2,3,4,5] },
  // 放假倒计时（v1.18）：首页展示「下次放假」的卡片。on 为总开关，默认关闭。
  // type 取值：'weekend'（周末）| 'tiaoxiu'（调休放假）| 'first'（国家节假日首天）。
  holiday: { on: false, type: 'weekend' }
};

function blankDB(){
  return { schema: SCHEMA, createdAt: Date.now(), demo: true,
           settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
           providers: seedProviders(), notes: [], money: [], todo: [], habits: [], drinks: [] };
}

/**
 * 供应商配置迁移 —— 修正历史上写错的第三方地址与已停产的模型名。
 *
 * 1) Xiaomi MiMo：老版本把 Base URL 写成了 https://api.mimo.ai/v1，
 *    该域名实际不存在（DNS 无法解析），导致余额与总结必然失败。
 *    正确地址见 https://mimo.mi.com/docs/zh-CN/tokenplan/integration/tools-overview
 *
 * 2) Moonshot：kimi-k2-0905-preview / moonshot-v1-* 等已在 2026 年停产，
 *    且 kimi-k2.5+ 系列把 temperature 锁死为 1，旧模型名会导致调用失败。
 *
 * 只改「确实是我们写错或已失效的那一条」，用户自定义填的内容一律不动。
 */
const BAD_MIMO_BASES = ['https://api.mimo.ai/v1', 'https://api.mimo.ai', 'http://api.mimo.ai/v1'];
const OLD_MIMO_MODELS = ['MiMo-7B-RL', 'MiMo-VL-7B-RL', 'mimo-7b-rl', 'mimo-vl-7b-rl'];
const NEW_MIMO_MODELS = ['mimo-v2.6-pro', 'mimo-v2.6-flash', 'mimo-v2.6-pro-ultraspeed'];
// 已停产 / 已下线的 Moonshot 模型 → 现役模型
const RETIRED_MOONSHOT = /^(kimi-k2-(0711|0905|turbo)(-preview)?|kimi-k2-thinking(-turbo)?|kimi-latest|moonshot-v1-(8k|32k|128k|auto)(-vision-preview)?)$/i;
const NEW_MOONSHOT_MODELS = ['kimi-k3', 'kimi-k2.6', 'kimi-k2.5'];

function migrateProviders(list){
  // 0) 移除已下线的预置供应商（v1.8 起不再提供 Xiaomi Token Plan）。
  //    判定条件收得很紧，只删「从来没被用过」的那一个，避免误删用户数据：
  //      · 名字与预置完全一致（没被改过名）
  //      · base 指向 token-plan（确认是那一个，而非用户自建的同名项）
  //      · 没填 Key、也没查过余额（说明用户从未真正使用）
  //    任何一条不满足就原样保留 —— 宁可多留一个卡片，也不能删掉用户的 Key。
  const RETIRED_PRESET_IDS = new Set(['token-plan-cn.xiaomimimo.com']);
  list = list.filter(p => {
    const host = String((p.base || '').replace(/^https?:\/\//, '')).split('/')[0];
    const untouched = String(p.name || '').trim() === 'MiMo Token Plan'
      && RETIRED_PRESET_IDS.has(host)
      && !p.key && !p.balAt;
    return !untouched;
  });

  return list.map(p => {
    const q = { ...p };
    if (q.kind === 'mimo'){
      let hit = false;
      // 1) 地址纠错
      if (BAD_MIMO_BASES.includes(String(q.base || '').replace(/\/$/, '')) || BAD_MIMO_BASES.includes(String(q.base || ''))){
        q.base = 'https://api.xiaomimimo.com/v1';
        hit = true;
      }
      // 2) 旧模型名 → 现役模型名（仅当全部都是旧名时才替换，避免覆盖用户自选）
      const ms = (q.models || []).filter(Boolean);
      if (ms.length > 0 && ms.every(m => OLD_MIMO_MODELS.includes(m) || /^mimo-(7b|vl)/i.test(m))){
        q.models = NEW_MIMO_MODELS.slice();
        hit = true;
      }
      // 3) 清掉因旧地址失败而残留的错误状态
      if (hit){ q.balErr = ''; q.bal = null; q.balMeta = null; }
    }
    if (q.kind === 'moonshot'){
      const ms = (q.models || []).filter(Boolean);
      // 全部都是已停产模型才替换；用户混搭过新模型的保持原样
      if (ms.length > 0 && ms.every(m => RETIRED_MOONSHOT.test(m))){
        q.models = NEW_MOONSHOT_MODELS.slice();
      }
    }
    return q;
  });
}

/** 预置供应商（Key 为空，仅骨架） */
function seedProviders(){
  return [
    { id: uid(), name: 'DeepSeek', kind: 'deepseek', key: '', base: 'https://api.deepseek.com',
      color: '#4d6bfe', letter: 'D', bal: null, balAt: 0, balErr: '', models: ['deepseek-chat', 'deepseek-reasoner'] },
    { id: uid(), name: 'Xiaomi MiMo', kind: 'mimo', key: '', base: 'https://api.xiaomimimo.com/v1',
      color: '#ff6900', letter: 'M', bal: null, balAt: 0, balErr: '',
      models: ['mimo-v2.6-pro', 'mimo-v2.6-flash', 'mimo-v2.6-pro-ultraspeed'] },
    { id: uid(), name: 'Moonshot', kind: 'moonshot', key: '', base: 'https://api.moonshot.cn/v1',
      color: '#12b7a8', letter: 'K', bal: null, balAt: 0, balErr: '', models: ['kimi-k3', 'kimi-k2.6', 'kimi-k2.5'] }
  ];
}

/** 预置演示数据 —— 一键可清空 */
function seedDemo(){
  const t = Date.now();
  const H = 3600000, D = 86400000;
  return {
    notes: [
      { id: uid(), title: '本周想做的事', body: '1. 把阳台那盆快枯的薄荷换个大点的盆\n2. 试试楼下新开的面包店的可颂\n3. 周日去海边骑车，赶在日落前',
        tags: ['生活','计划'], pin: true, color: 'amber', createdAt: t - 36 * H, updatedAt: t - 5 * H },
      { id: uid(), title: '记账小心得', body: '外卖和小额消费最容易被忽略。\n先把「固定支出」拎出来看，剩下的再谈省钱。',
        tags: ['理财'], pin: false, color: 'sage', createdAt: t - 4 * D, updatedAt: t - 2 * D },
      { id: uid(), title: '想读的书', body: '《创造者的时间》\n《一人企业》\n《我们仨》', tags: ['阅读'],
        pin: false, color: 'plum', createdAt: t - 9 * D, updatedAt: t - 9 * D }
    ],
    money: [
      { id: uid(), type: 'expense', amount: 32.5, cat: '餐饮', note: '公司楼下简餐', date: dayKey(), createdAt: t - 6 * H },
      { id: uid(), type: 'expense', amount: 168, cat: '购物', note: '一双跑步袜', date: dayKey(), createdAt: t - 9 * H },
      { id: uid(), type: 'expense', amount: 1280, cat: '居住', note: '本月房租', date: dayKey(addDays(new Date(), -3)), createdAt: t - 3 * D },
      { id: uid(), type: 'income', amount: 8600, cat: '工资', note: '月度工资', date: dayKey(addDays(new Date(), -5)), createdAt: t - 5 * D },
      { id: uid(), type: 'expense', amount: 9.9, cat: '订阅', note: '音乐会员', date: dayKey(addDays(new Date(), -2)), createdAt: t - 2 * D },
      { id: uid(), type: 'expense', amount: 45, cat: '交通', note: '地铁充值', date: dayKey(addDays(new Date(), -1)), createdAt: t - 1 * D }
    ],
    todo: [
      { id: uid(), text: '给妈妈打个电话', done: false, due: dayKey(), pri: 1, createdAt: t - 3 * H },
      { id: uid(), text: '预约周末的牙医', done: false, due: dayKey(addDays(new Date(), 2)), pri: 2, createdAt: t - 8 * H },
      { id: uid(), text: '整理上个月的照片', done: true, due: '', pri: 0, createdAt: t - 2 * D },
      { id: uid(), text: '交房租', done: false, due: dayKey(addDays(new Date(), 4)), pri: 2, createdAt: t - D }
    ],
    habits: [
      { id: uid(), name: '喝够 8 杯水', color: 'sky', days: last(9), createdAt: t - 12 * D },
      { id: uid(), name: '走够 6000 步', color: 'sage', days: last(6), createdAt: t - 12 * D },
      { id: uid(), name: '睡前不刷手机', color: 'plum', days: last(3), createdAt: t - 12 * D }
    ],
    drinks: [
      // at 为时间戳；c=咖啡因mg  s=糖g  k=热量kcal  v=容量ml
      { id: uid(), name: '美式咖啡', v: 355, s: 0,  c: 150, k: 5,   at: demoAt(0, 3) },
      { id: uid(), name: '拿铁',     v: 355, s: 15, c: 75,  k: 190, at: demoAt(1, 3) },
      { id: uid(), name: '珍珠奶茶', v: 500, s: 35, c: 30,  k: 350, at: demoAt(2, 3) }
    ]
  };
  /** 演示时间戳：在「今天已经过去的那段时间」里均匀铺开。
      不能写成 now - N 小时 —— 凌晨打开时会整批退到昨天，今日列表直接变空。 */
  function demoAt(i, n){
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const span = Math.max(Date.now() - start.getTime() - 15 * 60000, 300000);
    return Math.round(start.getTime() + 15 * 60000 + span * (i + 1) / (n + 1));
  }
  /** 过去 9 天中命中 n 天的日期键 */
  function last(n){
    const out = [];
    for (let i = 0; i < 9; i++){ if (i < n) out.push(dayKey(addDays(new Date(), -i))); }
    return out;
  }
}

const Store = {
  db: null,
  corrupt: false,
  lastErr: '',
  _failShown: false,

  /** 数据修复：把任意输入规整为合法结构 */
  normalize(raw){
    const base = blankDB();
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('根节点不是对象');
    const out = base;
    out.createdAt = Number(raw.createdAt) || Date.now();
    out.demo = !!raw.demo;
    // settings
    if (raw.settings && typeof raw.settings === 'object'){
      const s = raw.settings;
      if (typeof s.theme === 'string' && ['auto','light','dark'].includes(s.theme)) out.settings.theme = s.theme;
      if (s.city && typeof s.city === 'object' && typeof s.city.name === 'string'){
        out.settings.city = {
          name: String(s.city.name).slice(0, 40),
          lat: Number(s.city.lat) || 22.54554,
          lon: Number(s.city.lon) || 114.0683,
          region: String(s.city.region || '').slice(0, 40),
          manual: !!s.city.manual,
          source: String(s.city.source || 'manual')
        };
      }
      if (Array.isArray(s.cityHistory)) out.settings.cityHistory = s.cityHistory.slice(0, 30).map(c => ({
        name: String(c?.name || '').slice(0, 40), lat: Number(c?.lat) || 0,
        lon: Number(c?.lon) || 0, region: String(c?.region || '').slice(0, 40)
      })).filter(c => c.name);
      if (Array.isArray(s.newsSources)) out.settings.newsSources = s.newsSources.filter(x => typeof x === 'string').slice(0, 30);
      if (typeof s.newsAI === 'string') out.settings.newsAI = s.newsAI;
      // 默认 AI（v1.16）：只做字符串登记，合法性交给 AI.pickDefault() 运行时判断。
      // 这里不校验 id 是否存在 —— 供应商是后加载的，normalize 阶段拿到的是原始数组，
      // 在这里判断容易误杀；且用户删掉供应商后 id 会短暂失效，运行时回退更稳。
      if (typeof s.defaultAI === 'string') out.settings.defaultAI = s.defaultAI.slice(0, 60);
      if (s.lastNews && typeof s.lastNews === 'object') out.settings.lastNews = s.lastNews;
      if (s.lastWeather && typeof s.lastWeather === 'object') out.settings.lastWeather = s.lastWeather;
      out.settings.backupHint = clamp(Number(s.backupHint) || 20, 5, 500);
      if (['expense','income'].includes(s.moneyMode)) out.settings.moneyMode = s.moneyMode;
      // 通勤设置：老数据没有这个字段，缺省保持关闭（blankDB 里的默认值）。
      // 用户显式存过才覆盖，避免把老用户强行拉进通勤模式。
      if (s.commute && typeof s.commute === 'object'){
        const c = s.commute;
        out.settings.commute = {
          on: !!c.on,
          goH: clamp(Number(c.goH) ?? 8, 0, 23),
          goM: clamp(Number(c.goM) ?? 0, 0, 59),
          homeH: clamp(Number(c.homeH) ?? 18, 0, 23),
          homeM: clamp(Number(c.homeM) ?? 30, 0, 59),
          workdays: Array.isArray(c.workdays)
            ? c.workdays.map(Number).filter(n => n >= 0 && n <= 6).slice(0, 7)
            : [1,2,3,4,5]
        };
      }
      // 放假倒计时（v1.18）：缺省保持关闭，避免打扰未开启的用户。
      if (s.holiday && typeof s.holiday === 'object'){
        const h = s.holiday;
        const TYPES = ['weekend','tiaoxiu','first'];
        out.settings.holiday = {
          on: !!h.on,
          type: TYPES.includes(h.type) ? h.type : 'weekend'
        };
      }
    }
    // providers
    if (Array.isArray(raw.providers)){
      out.providers = raw.providers.map(p => ({
        id: String(p?.id || uid()),
        name: String(p?.name || '未命名').slice(0, 40),
        kind: String(p?.kind || 'custom'),
        key: String(p?.key || ''),
        base: String(p?.base || '').slice(0, 300),
        color: String(p?.color || '#bd5f3e').slice(0, 20),
        letter: String(p?.letter || (String(p?.name || 'A')[0] || 'A')).slice(0, 2),
        bal: p?.bal === null || p?.bal === undefined ? null : Number(p.bal),
        balAt: Number(p?.balAt) || 0,
        balErr: String(p?.balErr || ''),
        consoleUrl: safeUrl(p?.consoleUrl) || '',
        models: Array.isArray(p?.models) ? p.models.filter(m => typeof m === 'string').slice(0, 20) : []
      }));
      if (!out.providers.length) out.providers = seedProviders();
      out.providers = migrateProviders(out.providers);
    }
    const arr = (v) => Array.isArray(v) ? v : [];
    out.notes = arr(raw.notes).slice(0, 5000).map(n => ({
      id: String(n?.id || uid()), title: String(n?.title || '无标题').slice(0, 200),
      body: String(n?.body || '').slice(0, 20000),
      tags: arr(n?.tags).filter(x => typeof x === 'string').slice(0, 12),
      pin: !!n?.pin, color: String(n?.color || '').slice(0, 12),
      createdAt: Number(n?.createdAt) || Date.now(), updatedAt: Number(n?.updatedAt) || Date.now()
    }));
    out.money = arr(raw.money).slice(0, 20000).map(m => ({
      id: String(m?.id || uid()),
      type: m?.type === 'income' ? 'income' : 'expense',
      amount: Math.abs(Number(m?.amount) || 0),
      cat: String(m?.cat || '其他').slice(0, 24),
      note: String(m?.note || '').slice(0, 200),
      date: /^\d{4}-\d{2}-\d{2}$/.test(m?.date) ? m.date : dayKey(),
      createdAt: Number(m?.createdAt) || Date.now()
    }));
    out.todo = arr(raw.todo).slice(0, 5000).map(x => ({
      id: String(x?.id || uid()), text: String(x?.text || '').slice(0, 400),
      done: !!x?.done, due: /^\d{4}-\d{2}-\d{2}$/.test(x?.due) ? x.due : '',
      pri: clamp(Number(x?.pri) || 0, 0, 3), createdAt: Number(x?.createdAt) || Date.now()
    })).filter(x => x.text);
    out.habits = arr(raw.habits).slice(0, 200).map(h => ({
      id: String(h?.id || uid()), name: String(h?.name || '习惯').slice(0, 60),
      color: String(h?.color || 'sage').slice(0, 12),
      days: arr(h?.days).filter(d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 4000),
      createdAt: Number(h?.createdAt) || Date.now()
    })).filter(h => h.name);
    // 饮品记录：v=容量ml  s=糖g  c=咖啡因mg  k=热量kcal  at=时间戳
    // src（v1.15 新增）=数据来源标记数组，取值 official（瑞幸官网实测）/ ai（AI 估算）。
    // 忘登记就会像 v1.12 那样「记录了，刷新就没了」—— normalize 是逐字段重建。
    out.drinks = arr(raw.drinks).slice(0, 20000).map(x => ({
      id: String(x?.id || uid()), name: String(x?.name || '饮品').slice(0, 24),
      v: clamp(Number(x?.v) || 0, 0, 3000),
      s: clamp(Number(x?.s) || 0, 0, 200),
      c: clamp(Number(x?.c) || 0, 0, 1000),
      k: clamp(Number(x?.k) || 0, 0, 2000),
      at: Number(x?.at) || Date.now(),
      src: arr(x?.src).filter(t => t === 'official' || t === 'ai').slice(0, 4)
    })).filter(x => x.name);
    return out;
  },

  /** 启动加载 */
  load(){
    // 每轮加载重置状态
    this.corrupt = false; this.lastErr = ''; this._recoveredFrom = null;
    this._loadIssue = null;          // 供 boot 阶段读取的快照，不会被后续 save 覆盖
    let raw = null;
    try { raw = localStorage.getItem(LS_MAIN); }
    catch (e){ this.lastErr = '浏览器拒绝访问本地存储：' + e.message; this.corrupt = false; this.db = blankDB(); return this; }

    if (!raw){ this.db = blankDB(); return this; }

    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (e){
      // JSON 损坏 → 尝试备份
      this.corrupt = true;
      this.lastErr = '主数据不是合法 JSON：' + e.message;
      const recovered = this._tryBak();
      this.db = recovered || blankDB();
      this._loadIssue = { kind:'corrupt', reason:this.lastErr, recovered:!!recovered };
      return this;
    }
    try { this.db = this.normalize(parsed); }
    catch (e){
      this.corrupt = true;
      this.lastErr = '数据结构异常：' + e.message;
      const recovered = this._tryBak();
      this.db = recovered || blankDB();
      this._loadIssue = { kind:'corrupt', reason:this.lastErr, recovered:!!recovered };
      return this;
    }
    // 结构合法但被规整过（字段缺失/类型错误）→ 轻量提示
    if (this._repairedSomething){
      this._loadIssue = { kind:'repaired', reason:'部分字段缺失或类型异常，已自动补全。' };
      this._repairedSomething = false;
    }
    return this;
  },
  _tryBak(){
    try {
      const b = localStorage.getItem(LS_BAK);
      if (!b) return null;
      const p = JSON.parse(b);
      const n = this.normalize(p);
      this._recoveredFrom = 'bak';
      return n;
    } catch (e){ return null; }
  },

  /** 主动校验当前数据（供「存储与恢复」里的自检按钮使用） */
  healthCheck(){
    try {
      const raw = localStorage.getItem(LS_MAIN);
      if (!raw) return { ok: false, msg: '本地没有找到数据。' };
      JSON.parse(raw);
      return { ok: true, msg: '数据结构完整，可以正常解析。' };
    } catch (e){
      return { ok: false, msg: '数据已损坏：' + e.message };
    }
  },

  /** 保存 —— 失败必须明确提示 */
  save(){
    const str = JSON.stringify(this.db);
    try {
      // 先滚动一份备份（仅当主数据本身可用时）
      const cur = localStorage.getItem(LS_MAIN);
      if (cur) { try { localStorage.setItem(LS_BAK, cur); } catch(e){} }
      localStorage.setItem(LS_MAIN, str);
      this._failShown = false;
      return true;
    } catch (e){
      const quota = /quota|exceed/i.test(e.name + e.message);
      const msg = quota
        ? '本地存储空间已满，最新改动没能保存。建议先导出备份，再清理一些旧数据。'
        : '本地存储写入失败：' + e.message;
      if (!this._failShown){ this._failShown = true; persistFail(msg); }
      this.lastErr = msg;
      return false;
    }
  },

  /** 变更入口：改数据 → 立即落盘 → 重绘 */
  mutate(fn){
    try { fn(this.db); }
    catch (e){ toast('err','操作失败', e.message); return false; }
    const ok = this.save();
    if (ok) this.onChange && this.onChange();
    return ok;
  },

  /** 存储用量估算 */
  usage(){
    try {
      const s = localStorage.getItem(LS_MAIN) || '';
      const kb = new Blob([s]).size / 1024;
      return { bytes: new Blob([s]).size, kb: kb, items: this.count() };
    } catch (e){ return { bytes: 0, kb: 0, items: 0 }; }
  },
  count(){
    const d = this.db; if (!d) return 0;
    return (d.notes?.length || 0) + (d.money?.length || 0) + (d.todo?.length || 0) +
           (d.habits?.length || 0) + (d.drinks?.length || 0);
  },

  /** 检查是否该提醒备份 */
  checkBackupHint(){
    const n = this.count(), limit = this.db.settings.backupHint || 20;
    const marks = Math.floor(n / limit);
    const lastMark = Number(localStorage.getItem('lifehub.v1.lastHint') || 0);
    if (marks > lastMark){
      try { localStorage.setItem('lifehub.v1.lastHint', String(marks)); } catch(e){}
      toast('warn', '建议备份一下', '数据已累计 ' + n + ' 条。导出一份 JSON 存到安全的地方，多一份安心。', 9000, [
        { text: '立即导出', fn: () => Backup.exportAll() },
        { text: '稍后', fn: () => toast('ok','好','记得有空回来备份。', 3000) }
      ]);
      return true;
    }
    return false;
  }
};

/** 持久化失败提示（独立于 toast，因为可能连 DOM 都不可用） */
function persistFail(msg){
  try {
    toast('err', '数据未能保存', msg + ' 请立即导出备份，不要关闭页面。', 15000, [
      { text: '导出备份', fn: () => Backup.exportAll() },
      { text: '查看详情', fn: () => Backup.openPanel() }
    ]);
  } catch (e){ alert('数据保存失败：' + msg); }
  try { console.error('[LifeHub] 持久化失败', msg); } catch(e){}
}

/* ==========================================================================
   3. UI 基础：吐司 / 弹窗 / 抽屉
   ========================================================================== */
function toast(kind, title, body, ms = 4200, actions = []){
  const box = $('#toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = 'toast toast--' + (kind || 'i');
  const ik = kind === 'ok' ? 'check' : kind === 'err' ? 'warn' : kind === 'warn' ? 'warn' : 'info';
  el.innerHTML =
    ic(ik) + '<div class="toast__bd"><b>' + esc(title) + '</b>' +
    (body ? '<small>' + esc(body) + '</small>' : '') + '</div>';
  actions.forEach(a => {
    const b = document.createElement('button');
    b.textContent = a.text;
    b.onclick = () => { close(); a.fn && a.fn(); };
    el.appendChild(b);
  });
  const close = () => {
    if (!el.parentNode) return;
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 240);
  };
  const x = document.createElement('button');
  x.textContent = '关闭'; x.onclick = close;
  el.appendChild(x);
  box.appendChild(el);
  while (box.children.length > 4) box.firstChild.remove();
  if (ms > 0) setTimeout(close, ms);
  return close;
}

/** 通用弹窗 */
function modal({ title, desc, body, okText = '确认', cancelText = '取消', onOk, danger = false, wide = false }){
  const wrap = document.createElement('div');
  wrap.className = 'modal';
  wrap.innerHTML =
    '<div class="modal__box" role="dialog" aria-modal="true"' + (wide ? ' style="width:min(680px,100%)"' : '') + '>' +
      '<div class="modal__hd"><h3>' + esc(title) + '</h3>' +
      (desc ? '<p>' + esc(desc) + '</p>' : '') + '</div>' +
      '<div class="modal__bd"></div>' +
      '<div class="modal__ft">' +
        (cancelText ? '<button class="btn" data-x="c">' + esc(cancelText) + '</button>' : '') +
        '<button class="btn ' + (danger ? 'btn--danger' : 'btn--primary') + '" data-x="o">' + esc(okText) + '</button>' +
      '</div>' +
    '</div>';
  const bd = $('.modal__bd', wrap);
  if (typeof body === 'string') bd.innerHTML = body;
  else if (body instanceof Node) bd.appendChild(body);
  const layer = $('#layer');
  layer.appendChild(wrap);
  const close = () => { wrap.remove(); document.body.classList.remove('noscroll'); };
  document.body.classList.add('noscroll');
  // 用 $$ 遍历，别用 $（querySelector 只返回第一个）。
  // body 里若也写了 data-x="c"，$ 会永远只绑到那一个，弹窗自带按钮反而成了死键。
  $$('[data-x="c"]', wrap).forEach(b => b.addEventListener('click', close));
  $('[data-x="o"]', wrap).addEventListener('click', () => {
    const r = onOk && onOk(bd, close);
    if (r !== false) close();
  });
  wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
  document.addEventListener('keydown', function k(e){
    if (e.key === 'Escape'){ close(); document.removeEventListener('keydown', k); }
  });
  setTimeout(() => ($('.modal__ft .btn--primary', wrap) || $('.modal__ft .btn--danger', wrap))?.focus(), 30);
  return { close, body: bd };
}

/** 侧拉抽屉 */
function drawer({ title, sub, side = 'r', body, foot, onClose }){
  const wrap = document.createElement('div');
  wrap.className = 'scrim';
  const dr = document.createElement('aside');
  dr.className = 'drawer drawer--' + side;
  dr.setAttribute('role', 'dialog');
  dr.setAttribute('aria-modal', 'true');
  dr.innerHTML =
    '<div class="drawer__hd">' +
      '<h2>' + esc(title) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</h2>' +
      '<button class="btn btn--ghost btn--icon btn--sm" data-x="c" title="关闭">' + ic('x') + '</button>' +
    '</div>' +
    '<div class="drawer__bd"></div>' +
    (foot ? '<div class="drawer__ft"></div>' : '');
  const bd = $('.drawer__bd', dr);
  if (typeof body === 'string') bd.innerHTML = body;
  else if (body instanceof Node) bd.appendChild(body);
  if (foot){
    const ft = $('.drawer__ft', dr);
    if (typeof foot === 'string') ft.innerHTML = foot;
    else ft.appendChild(foot);
  }
  wrap.appendChild(dr);
  $('#layer').appendChild(wrap);
  document.body.classList.add('noscroll');
  const api = { close: null, body: bd, el: dr, foot: $('.drawer__ft', dr), onClose: null };
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    wrap.classList.add('is-out'); dr.classList.add('is-out');
    setTimeout(() => { wrap.remove(); document.body.classList.remove('noscroll'); }, 250);
    document.removeEventListener('keydown', onKey);
    // 统一关闭回调：无论点 ×、点遮罩、按 Esc 还是显式 close()，都会走到这里。
    // 视图需要「关闭后刷新」时用 onClose 传入（或返回后赋 d.onClose），
    // 不要再改写 d.close —— 那样只有显式调用才生效。
    try { const fn = api.onClose || onClose; fn && fn(); } catch (e){ console.error(e); }
  };
  api.close = close;
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  // 同上：抽屉头部有 ×，foot 里也可能有「取消/完成」。
  // 用 $$ 全绑，任何位置的 data-x="c" 都能关抽屉。
  $$('[data-x="c"]', dr).forEach(b => b.addEventListener('click', close));
  wrap.addEventListener('click', close);
  dr.addEventListener('click', e => e.stopPropagation());
  return api;
}

/* SVG 图标选择器（供天气调用） */
const SVG = { ic };
