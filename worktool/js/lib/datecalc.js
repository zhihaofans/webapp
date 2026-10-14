/* ============================================================
   lib/datecalc.js — 日期计算（纯逻辑）
   零依赖，不碰 DOM，可以被 node 直接跑。

   全部按**本地时间**算，并且一律把时间归一到当天 00:00 —— 否则
   「10-14 到 10-15」会因为时分秒不同算出 0 天或 1 天，跨夏令时
   时误差还会再放大。

   三件事各有一个坑，单独写清楚：
     · 天数差用 round 而不是 floor —— 夏令时那天只有 23 小时，
       floor 会少算一天；
     · 月份加减要处理月末 —— 1 月 31 日 + 1 个月不是 3 月 3 日，
       而是 2 月的最后一天；
     · 解析日期要回读校验 —— new Date(2026,1,30) 会静默进位到 3 月 2 日。
   ============================================================ */
(function (root) {
  'use strict';

  var T = root.Toolbox = root.Toolbox || {};

  var MS_DAY = 86400000;
  var WEEK_CN = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* 归一到当天 00:00（本地） */
  function norm(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function today() { return norm(new Date()); }

  /* 'YYYY-MM-DD' → Date（本地 00:00）；非法或不存在返回 null */
  function parseYmd(s) {
    if (typeof s !== 'string') return null;
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s.trim());
    if (!m) return null;
    var y = +m[1], mo = +m[2] - 1, d = +m[3];
    var dt = new Date(y, mo, d);
    /* 回读校验：2 月 30 日这种会被 Date 自动进位，必须挡掉 */
    if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) return null;
    return dt;
  }

  function ymd(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function weekCN(d) { return WEEK_CN[d.getDay()]; }
  /* 界面上的统一写法：2026-10-14 星期三 */
  function fmt(d) { return ymd(d) + ' ' + weekCN(d); }

  /* 月份加减：1 月 31 日 + 1 个月 → 2 月的最后一天。
     直接用 new Date(y, m+1, 31) 会溢出到 3 月，那是错的。 */
  function addMonths(d, n) {
    var day = d.getDate();
    var first = new Date(d.getFullYear(), d.getMonth() + n, 1);
    var lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    return new Date(first.getFullYear(), first.getMonth(), Math.min(day, lastDay));
  }

  /* 按单位加减。n 可以是负数；unit 认 day / week / month / year，其余按天处理 */
  function add(d, n, unit) {
    var b = norm(d);
    var k = Number(n);
    if (!isFinite(k)) return b;
    switch (unit) {
      case 'week': return new Date(b.getFullYear(), b.getMonth(), b.getDate() + k * 7);
      case 'month': return addMonths(b, k);
      case 'year': return addMonths(b, k * 12);
      default: return new Date(b.getFullYear(), b.getMonth(), b.getDate() + k);
    }
  }

  /* b - a 的天数（可为负）。用 round 而不是 floor，见文件头说明。 */
  function diffDays(a, b) {
    return Math.round((norm(b) - norm(a)) / MS_DAY);
  }

  /* 起止相差的「几年几个月零几天」。
     内部自动交换，返回的数值一律为正，用 swapped 标明是否换过顺序。

     实现用「逐年逐月往前推」而不是各字段直接相减 —— 后者在
     「1-31 → 3-01」这种跨月末的情形会借错月份的天数，算出负数。
     推进法最多循环 12 次，代价可忽略，但不会错。 */
  function diffYmd(a, b) {
    var s = norm(a), e = norm(b);
    var swapped = false;
    if (e < s) { var t = s; s = e; e = t; swapped = true; }

    var years = e.getFullYear() - s.getFullYear();
    var cursor = addMonths(s, years * 12);
    /* 2-29 加一年落到 2-28，可能反而超出终点，退一年 */
    if (cursor > e) {
      years -= 1;
      cursor = addMonths(s, years * 12);
    }

    var months = 0;
    while (months < 12) {
      var next = addMonths(cursor, 1);
      if (next > e) break;
      cursor = next;
      months += 1;
    }

    return {
      years: years,
      months: months,
      days: diffDays(cursor, e),
      total: Math.abs(diffDays(a, b)),
      swapped: swapped
    };
  }

  /* 年 / 月 / 日的最大值，供日期输入框使用 */
  function clampDay(y, m, d) {
    var last = new Date(y, m + 1, 0).getDate();
    return Math.min(Math.max(1, d), last);
  }

  T.DateCalc = {
    MS_DAY: MS_DAY,
    WEEK_CN: WEEK_CN,
    norm: norm,
    today: today,
    parseYmd: parseYmd,
    ymd: ymd,
    weekCN: weekCN,
    fmt: fmt,
    addMonths: addMonths,
    add: add,
    diffDays: diffDays,
    diffYmd: diffYmd,
    clampDay: clampDay
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = T.DateCalc;
})(typeof window !== 'undefined' ? window : globalThis);
