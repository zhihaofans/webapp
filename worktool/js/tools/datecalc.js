/* ============================================================
   tools/datecalc.js — 日期天数计算
   两块功能（对应参考图的结构）：
     · 计算日期   —— 基准日往前 / 往后推 N 天（周 / 月 / 年），得到日期
     · 计算日期间隔 —— 两个日期相隔多少天，可勾选「包含起始日」
   计算逻辑全在 js/lib/datecalc.js，本文件只管界面与状态。
   所有计算都是本地的，不联网。
   ============================================================ */
(function (T) {
  'use strict';

  var $ = T.$;
  var DC = null;

  var state = { unitBefore: 'day', unitAfter: 'day', inclusive: false };
  var els = {};

  var UNITS = [['day', '天'], ['week', '周'], ['month', '月'], ['year', '年']];
  var PRESETS = [7, 30, 90, 100, 365, 1000];

  /* ---------------- 计算与渲染 ---------------- */
  function valDate(el) {
    return DC.parseYmd(el.value) || DC.today();
  }

  function recalc() {
    if (!DC) return;
    var base = valDate(els.base);

    /* 单位一律现读下拉框。
       之前这里读的是 state.unitBefore —— 那个只在离开页面时才同步，
       结果切换单位后数字不会重算，看起来像「下拉框点了没反应」。 */
    var ub = els.beforeU.value;
    var ua = els.afterU.value;
    state.unitBefore = ub;
    state.unitAfter = ua;

    /* 基准日的星期 */
    els.baseWk.textContent = DC.weekCN(base);

    /* 之前：offset 取负 */
    var nb = parseInt(els.beforeN.value, 10);
    if (isFinite(nb) && nb !== 0) {
      els.beforeOut.textContent = '公元 ' + DC.fmt(DC.add(base, -Math.abs(nb), ub));
      els.beforeOut.classList.remove('is-empty');
    } else {
      els.beforeOut.textContent = '填入数字后显示结果';
      els.beforeOut.classList.add('is-empty');
    }

    /* 之后 */
    var na = parseInt(els.afterN.value, 10);
    if (isFinite(na) && na !== 0) {
      els.afterOut.textContent = '公元 ' + DC.fmt(DC.add(base, Math.abs(na), ua));
      els.afterOut.classList.remove('is-empty');
    } else {
      els.afterOut.textContent = '填入数字后显示结果';
      els.afterOut.classList.add('is-empty');
    }

    /* 间隔 */
    var s = valDate(els.start), e = valDate(els.end);
    els.startWk.textContent = DC.weekCN(s);
    els.endWk.textContent = DC.weekCN(e);

    var raw = DC.diffDays(s, e);
    var days = Math.abs(raw);
    if (state.inclusive) days += 1;

    els.diffNum.textContent = days;
    els.diffExtra.innerHTML = buildExtra(s, e, raw, days);
  }

  function buildExtra(s, e, raw, days) {
    var parts = [];

    if (raw < 0) {
      parts.push('结束日早于开始日，上面按先后顺序取的距离');
    }

    /* 折合年月日：只在「未勾选包含起始日」时才有意义，
       勾选后是人为加的一天，折合会误导，所以那种情况只给周数 */
    if (!state.inclusive && days > 0) {
      var d = DC.diffYmd(s, e);
      var seg = [];
      if (d.years) seg.push(d.years + ' 年');
      if (d.months) seg.push(d.months + ' 个月');
      if (d.days) seg.push(d.days + ' 天');
      if (seg.length) parts.push('折合 ' + seg.join(' ') + '整');
    }

    if (days > 0) {
      var weeks = Math.floor(days / 7);
      var rest = days % 7;
      parts.push('约 ' + weeks + ' 周' + (rest ? '零 ' + rest + ' 天' : ''));
    }

    if (state.inclusive) parts.push('已按「包含起始日」加 1 天');
    if (!days && !state.inclusive) parts.push('两个日期是同一天');

    if (!parts.length) return '';
    return '<div class="dc__hint">' + T.ic('info', '', 0) +
      '<span>' + parts.map(T.esc).join('　·　') + '</span></div>';
  }

  /* ---------------- 视图 ---------------- */
  function unitOptions(cur) {
    return UNITS.map(function (u) {
      return '<option value="' + u[0] + '"' + (u[0] === cur ? ' selected' : '') + '>' + u[1] + '</option>';
    }).join('');
  }

  function render(host) {
    DC = T.DateCalc;
    if (!DC) {
      host.innerHTML = '<div class="capmsg">' + T.ic('warn', '', 0) +
        '<div><b>计算模块没有加载成功。</b>请刷新页面重试。</div></div>';
      return;
    }
    T.Settings.bindFileInput();

    var t = DC.ymd(DC.today());

    host.innerHTML =
      '<div class="dc">' +
        '<div class="dc__main">' +

          /* ---------- 计算日期 ---------- */
          '<section class="panel">' +
            '<div class="panel__hd"><h3>' + T.ic('clock', '', 0) + '计算日期</h3></div>' +
            '<div class="panel__bd">' +

              '<div class="dc__base">' +
                '<span class="dc__lbl">从</span>' +
                '<input type="date" class="inp dc__date" id="dcBase" value="' + t + '" aria-label="基准日期">' +
                '<span class="dc__wk" id="dcBaseWk"></span>' +
                '<span class="dc__lbl">开始</span>' +
                '<button class="btn btn--sm dc__today" type="button" data-act="today">回到今天</button>' +
              '</div>' +

              '<div class="dc__calc">' +
                '<div class="dc__row">' +
                  '<input type="number" class="inp dc__num" id="dcBeforeN" inputmode="numeric"' +
                    ' placeholder="输入数字计算" aria-label="往前的数量">' +
                  '<select class="inp dc__unit" id="dcBeforeU" aria-label="往前的时间单位">' +
                    unitOptions(state.unitBefore) + '</select>' +
                  '<span class="dc__lbl">之前</span>' +
                '</div>' +
                '<div class="dc__out is-empty" id="dcBeforeOut">填入数字后显示结果</div>' +

                '<div class="dc__row">' +
                  '<input type="number" class="inp dc__num" id="dcAfterN" inputmode="numeric"' +
                    ' placeholder="输入数字计算" aria-label="往后的数量">' +
                  '<select class="inp dc__unit" id="dcAfterU" aria-label="往后的时间单位">' +
                    unitOptions(state.unitAfter) + '</select>' +
                  '<span class="dc__lbl">之后</span>' +
                '</div>' +
                '<div class="dc__out is-empty" id="dcAfterOut">填入数字后显示结果</div>' +
              '</div>' +

              '<div class="dc__presets">' +
                '<span class="dc__lbl">快捷：</span>' +
                PRESETS.map(function (n) {
                  return '<button class="chip" type="button" data-preset="' + n + '">' + n + ' 天</button>';
                }).join('') +
              '</div>' +

            '</div>' +
          '</section>' +

          /* ---------- 计算日期间隔 ---------- */
          '<section class="panel">' +
            '<div class="panel__hd"><h3>' + T.ic('history', '', 0) + '计算日期间隔</h3></div>' +
            '<div class="panel__bd">' +

              '<div class="dc__base">' +
                '<span class="dc__lbl">从</span>' +
                '<input type="date" class="inp dc__date" id="dcStart" value="' + t + '" aria-label="开始日期">' +
                '<span class="dc__wk" id="dcStartWk"></span>' +
              '</div>' +
              '<div class="dc__base">' +
                '<span class="dc__lbl">至</span>' +
                '<input type="date" class="inp dc__date" id="dcEnd" value="' + t + '" aria-label="结束日期">' +
                '<span class="dc__wk" id="dcEndWk"></span>' +
              '</div>' +

              '<div class="dc__total">' +
                '<span class="dc__lbl">共</span>' +
                '<b id="dcDiffNum">0</b>' +
                '<span class="dc__unit-tag">天</span>' +
              '</div>' +

              '<label class="sw dc__inc">' +
                '<input type="checkbox" id="dcInclusive"' + (state.inclusive ? ' checked' : '') + '>' +
                '<span class="sw__track"></span>' +
                '<span class="sw__tx">包含起始日<small>开启后同一天算 1 天</small></span>' +
              '</label>' +

              '<div id="dcDiffExtra"></div>' +

            '</div>' +
          '</section>' +

        '</div>' +

        '<aside class="dc__side">' +
          '<div class="panel">' +
            '<div class="panel__hd"><h3>' + T.ic('info', '', 0) + '怎么算的</h3></div>' +
            '<div class="panel__bd">' +
              '<p class="note" style="margin-bottom:9px">' +
                '全部按<b>本地日期</b>计算，时分秒不参与 —— 所以不会出现「差一天」这种时区误差。' +
              '</p>' +
              '<p class="note" style="margin-bottom:9px">' +
                '<b style="color:var(--ink-3)">月份加减：</b>1 月 31 日往后 1 个月是 2 月的最后一天，' +
                '不是 3 月 3 日。这是各家日历的通行做法。' +
              '</p>' +
              '<p class="note">' +
                '<b style="color:var(--ink-3)">天数差：</b>按日历日计算，' +
                '不扣周末与节假日；需要工作日数请另算。' +
              '</p>' +
            '</div>' +
          '</div>' +
          '<div class="panel">' +
            '<div class="panel__hd"><h3>' + T.ic('spark', '', 0) + '常见用途</h3></div>' +
            '<div class="panel__bd">' +
              '<ul class="plist">' +
                '<li class="sitem"><span class="sitem__n">1</span><span class="sitem__t">算纪念日 / 倒计时还差几天</span></li>' +
                '<li class="sitem"><span class="sitem__n">2</span><span class="sitem__t">合同、试用期、保修期的到期日</span></li>' +
                '<li class="sitem"><span class="sitem__n">3</span><span class="sitem__t">项目排期：从某天往后推 N 个工作日</span></li>' +
              '</ul>' +
            '</div>' +
          '</div>' +
        '</aside>' +
      '</div>' +
      '<div class="pagefoot">' +
        '日期计算全部在你的浏览器里完成，不联网、不上传。' +
      '</div>';

    els.base = host.querySelector('#dcBase');
    els.baseWk = host.querySelector('#dcBaseWk');
    els.beforeN = host.querySelector('#dcBeforeN');
    els.beforeU = host.querySelector('#dcBeforeU');
    els.afterN = host.querySelector('#dcAfterN');
    els.afterU = host.querySelector('#dcAfterU');
    els.beforeOut = host.querySelector('#dcBeforeOut');
    els.afterOut = host.querySelector('#dcAfterOut');
    els.start = host.querySelector('#dcStart');
    els.end = host.querySelector('#dcEnd');
    els.startWk = host.querySelector('#dcStartWk');
    els.endWk = host.querySelector('#dcEndWk');
    els.diffNum = host.querySelector('#dcDiffNum');
    els.diffExtra = host.querySelector('#dcDiffExtra');
    els.inclusive = host.querySelector('#dcInclusive');

    bind(host);
    recalc();
  }

  /* ---------------- 事件 ---------------- */
  function bind(host) {
    ['#dcBase', '#dcBeforeN', '#dcBeforeU', '#dcAfterN', '#dcAfterU', '#dcStart', '#dcEnd']
      .forEach(function (sel) {
        var el = host.querySelector(sel);
        if (el) el.addEventListener('input', recalc);
        if (el) el.addEventListener('change', recalc);
      });

    if (els.inclusive) els.inclusive.addEventListener('change', function () {
      state.inclusive = els.inclusive.checked;
      recalc();
    });

    host.addEventListener('click', function (e) {
      var today = e.target.closest('[data-act="today"]');
      if (today) {
        var t = DC.ymd(DC.today());
        els.base.value = t;
        els.start.value = t;
        els.end.value = t;
        recalc();
        T.toast('已回到今天', { icon: 'check', ms: 1500 });
        return;
      }

      /* 快捷天数：填进「之后」并同步一份到「之前」，两个方向一次都能看到 */
      var p = e.target.closest('[data-preset]');
      if (p) {
        var n = p.getAttribute('data-preset');
        els.afterN.value = n;
        if (!els.beforeN.value) els.beforeN.value = n;
        recalc();
      }
    });
  }

  T.register('calc-date', {
    render: render,
    onLeave: function () {
      /* 记住单位与「包含起始日」，下次进来还是这套设置 */
      if (els.beforeU) state.unitBefore = els.beforeU.value;
      if (els.afterU) state.unitAfter = els.afterU.value;
      if (els.inclusive) state.inclusive = els.inclusive.checked;
      els = {};
    }
  });
})(window.Toolbox);
