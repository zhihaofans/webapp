/* ============================================================
   tools/unitconvert.js — 单位换算
   分三段：选分类 → 填数值与两个单位 → 看结果。
   换算逻辑全在 js/lib/unitconvert.js，本文件只管界面与状态。

   比常见单位换算器多做了一件事：结果下面直接列出**该数值在
   所有单位下的取值**，点任意一行就能把它设为换算目标 ——
   不用为了看一眼别的单位来回切下拉框。
   ============================================================ */
(function (T) {
  'use strict';

  var $ = T.$;
  var U = null;

  var state = { cat: 'length', from: '', to: '' };
  var els = {};

  function cat(id) { return U ? U.category(id) : null; }

  /* ---------------- 计算与渲染 ---------------- */
  function unitOptions(c, selected) {
    return c.units.map(function (x) {
      return '<option value="' + x.id + '"' + (x.id === selected ? ' selected' : '') + '>' +
        T.esc(x.name) + '（' + T.esc(x.sym) + '）</option>';
    }).join('');
  }

  /* 切分类时给一对合理的默认单位（基准 ↔ 第二个），免得两边一样看不出效果 */
  function defaultPair(c) {
    var base = c.base;
    var other = c.units.filter(function (x) { return x.id !== base; })[0];
    return { from: base, to: other ? other.id : base };
  }

  function recalc() {
    if (!U) return;
    var c = cat(state.cat);
    if (!c) return;

    state.from = els.from.value || c.base;
    state.to = els.to.value || c.base;

    var raw = els.val.value.trim();
    var a = U.unit(state.cat, state.from);
    var b = U.unit(state.cat, state.to);

    /* 空输入 / 非法输入：结果区留白，不显示 0，免得像是「算出来就是 0」 */
    if (!U.isNum(raw)) {
      els.rnum.textContent = '—';
      els.rnum.classList.add('is-empty');
      els.formula.textContent = raw ? '请输入一个数字' : '输入数值后即时换算';
      els.list.innerHTML = emptyListHTML(c);
      return;
    }

    var v = U.convert(raw, state.from, state.to, state.cat);
    els.rnum.textContent = U.fmt(v);
    els.rnum.classList.remove('is-empty');
    els.formula.innerHTML = '<b>' + T.esc(U.fmt(Number(raw))) + ' ' + T.esc(a.sym) + '</b>' +
      ' = ' + T.esc(U.fmt(v)) + ' ' + T.esc(b.sym);

    els.list.innerHTML = listHTML(c, raw);
  }

  function emptyListHTML(c) {
    return '<div class="uc__lhint">输入数值后，这里会列出它在 ' + c.units.length +
      ' 个单位下的全部取值，点一行即可把它设为目标单位。</div>';
  }

  function listHTML(c, raw) {
    var rows = U.convertAll(raw, state.from, state.cat);
    if (!rows.length) return emptyListHTML(c);
    return rows.map(function (r) {
      var on = r.id === state.to ? ' is-on' : '';
      var isFrom = r.id === state.from;
      return '<button class="uc__row' + on + (isFrom ? ' is-src' : '') + '" type="button"' +
        ' data-row="' + r.id + '"' + (isFrom ? ' data-src="1"' : '') + '>' +
        '<span class="uc__row-n">' + T.esc(r.name) +
          (isFrom ? '<em>源</em>' : (on ? '<em>目标</em>' : '')) + '</span>' +
        '<span class="uc__row-v">' + T.esc(U.fmt(r.value)) + '</span>' +
        '<span class="uc__row-s">' + T.esc(r.sym) + '</span>' +
      '</button>';
    }).join('');
  }

  function paintCats() {
    Array.prototype.forEach.call(els.cats.querySelectorAll('[data-cat]'), function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-cat') === state.cat);
    });
  }

  /* 换分类：重建两个下拉，其余保持 */
  function switchCat(id) {
    var c = cat(id);
    if (!c) return;
    state.cat = id;
    var d = defaultPair(c);
    state.from = d.from;
    state.to = d.to;
    els.from.innerHTML = unitOptions(c, state.from);
    els.to.innerHTML = unitOptions(c, state.to);
    els.base.textContent = '基准单位：' + U.unit(id, c.base).name;
    elRefs.current.textContent = c.units.length + ' 个单位';
    paintCats();
    recalc();
  }

  var elRefs = { current: null };

  /* ---------------- 视图 ---------------- */
  function render(host) {
    U = T.UnitConvert;
    if (!U) {
      host.innerHTML = '<div class="capmsg">' + T.ic('warn', '', 0) +
        '<div><b>换算模块没有加载成功。</b>请刷新页面重试。</div></div>';
      return;
    }
    T.Settings.bindFileInput();

    host.innerHTML =
      '<div class="uc">' +
        '<div class="uc__main">' +

          '<section class="panel">' +
            '<div class="panel__hd"><h3>' + T.ic('convert', '', 0) + '单位换算</h3>' +
              '<span class="uc__meta" id="ucMeta"></span></div>' +
            '<div class="panel__bd">' +

              '<div class="uc__cats" id="ucCats" role="tablist">' +
                U.CATEGORIES.map(function (c) {
                  return '<button class="uc__cat" type="button" role="tab" data-cat="' + c.id + '">' +
                    T.esc(c.name) + '</button>';
                }).join('') +
              '</div>' +

              '<div class="uc__field">' +
                '<label class="uc__lbl" for="ucVal">输入数值</label>' +
                '<input type="text" class="inp uc__val" id="ucVal" inputmode="decimal"' +
                  ' autocomplete="off" placeholder="输入要转换的数值">' +
              '</div>' +

              '<div class="uc__pair">' +
                '<select class="inp uc__sel" id="ucFrom" aria-label="源单位"></select>' +
                '<button class="btn btn--icon uc__swap" type="button" id="ucSwap" title="交换两个单位">' +
                  T.ic('swap', '', 0) + '</button>' +
                '<select class="inp uc__sel" id="ucTo" aria-label="目标单位"></select>' +
              '</div>' +

              '<div class="uc__out">' +
                '<div class="uc__rnum is-empty" id="ucRnum">—</div>' +
                '<div class="uc__formula" id="ucFormula">输入数值后即时换算</div>' +
              '</div>' +

            '</div>' +
          '</section>' +

          '<section class="panel">' +
            '<div class="panel__hd"><h3>' + T.ic('grid', '', 0) + '全部单位</h3>' +
              '<span class="uc__meta" id="ucBase"></span></div>' +
            '<div class="panel__bd">' +
              '<div class="uc__list" id="ucList"></div>' +
            '</div>' +
          '</section>' +

        '</div>' +

        '<aside class="uc__side">' +
          '<div class="panel">' +
            '<div class="panel__hd"><h3>' + T.ic('info', '', 0) + '怎么用</h3></div>' +
            '<div class="panel__bd">' +
              '<p class="note" style="margin-bottom:9px">' +
                '选分类 → 填数值 → 结果即时出来，不用点按钮。' +
                '下面那张对照表会同时列出这个数值在<b>所有单位</b>下的取值。' +
              '</p>' +
              '<p class="note">' +
                '点对照表里任意一行，就能把它设成右边的目标单位。' +
              '</p>' +
            '</div>' +
          '</div>' +
          '<div class="panel">' +
            '<div class="panel__hd"><h3>' + T.ic('shield', '', 0) + '换算口径</h3></div>' +
            '<div class="panel__bd">' +
              '<ul class="plist">' +
                '<li class="sitem"><span class="sitem__n">1</span><span class="sitem__t">' +
                  '温度是仿射换算（0°C = 273.15K），不是简单乘系数</span></li>' +
                '<li class="sitem"><span class="sitem__n">2</span><span class="sitem__t">' +
                  '数据存储同时提供 1000 与 1024 两种进制，已分别标注</span></li>' +
                '<li class="sitem"><span class="sitem__n">3</span><span class="sitem__t">' +
                  '「月」按平均 30.44 天、「年」按 365 天，跨日历的精确天数请用「日期天数计算」</span></li>' +
              '</ul>' +
            '</div>' +
          '</div>' +
        '</aside>' +
      '</div>' +
      '<div class="pagefoot">' +
        '换算全部在你的浏览器里完成，不联网、不上传。' +
      '</div>';

    els.cats = host.querySelector('#ucCats');
    els.val = host.querySelector('#ucVal');
    els.from = host.querySelector('#ucFrom');
    els.to = host.querySelector('#ucTo');
    els.swap = host.querySelector('#ucSwap');
    els.rnum = host.querySelector('#ucRnum');
    els.formula = host.querySelector('#ucFormula');
    els.list = host.querySelector('#ucList');
    els.base = host.querySelector('#ucBase');
    elRefs.current = host.querySelector('#ucMeta');

    bind(host);
    switchCat(state.cat);
  }

  /* ---------------- 事件 ---------------- */
  function bind(host) {
    els.val.addEventListener('input', recalc);

    els.from.addEventListener('change', recalc);
    els.to.addEventListener('change', recalc);

    els.swap.addEventListener('click', function () {
      var a = els.from.value;
      els.from.value = els.to.value;
      els.to.value = a;
      recalc();
    });

    host.addEventListener('click', function (e) {
      var c = e.target.closest('[data-cat]');
      if (c && !c.hasAttribute('data-row')) {
        switchCat(c.getAttribute('data-cat'));
        return;
      }

      /* 点对照表某一行 → 设为目标单位（点源单位那一行则忽略，避免两边相同） */
      var row = e.target.closest('[data-row]');
      if (row) {
        if (row.hasAttribute('data-src')) {
          T.toast('这就是当前的源单位', { icon: 'info', ms: 1800 });
          return;
        }
        els.to.value = row.getAttribute('data-row');
        recalc();
      }
    });
  }

  T.register('calc-unit', {
    render: render,
    onLeave: function () {
      els = {};
      elRefs.current = null;
    }
  });
})(window.Toolbox);
