/* ============================================================
   lib/unitconvert.js — 单位换算（纯逻辑）
   零依赖，不碰 DOM，可以被 node 直接跑。

   统一模型：每个分类选一个**基准单位**，其余单位只要能「转到基准」
   和「从基准转回」就够了 —— 任意两个单位之间的换算都走
   单位A → 基准 → 单位B，不必写 N×(N-1) 条两两规则。

   两种单位用同一套接口表达：
     · 线性单位（绝大多数）：给系数 f，表示 1 该单位 = f 个基准单位
     · 仿射单位（温度）：给 to / from 两个函数，因为 0°C ≠ 0K，
       单纯乘系数表达不了偏移

   精度处理：换算会经过基准单位，浮点上会留下 0.30000000000000004
   这类尾巴，所以输出前统一按 12 位有效数字收敛一次。
   ============================================================ */
(function (root) {
  'use strict';

  var T = root.Toolbox = root.Toolbox || {};

  /* u(id, 名称, 符号, 系数) —— 线性单位 */
  function u(id, name, sym, f) { return { id: id, name: name, sym: sym, f: f }; }

  var CATEGORIES = [
    {
      id: 'length', name: '长度', base: 'm',
      units: [
        u('nm', '纳米', 'nm', 1e-9),
        u('um', '微米', 'μm', 1e-6),
        u('mm', '毫米', 'mm', 1e-3),
        u('cm', '厘米', 'cm', 1e-2),
        u('dm', '分米', 'dm', 0.1),
        u('m', '米', 'm', 1),
        u('km', '千米', 'km', 1000),
        u('in', '英寸', 'in', 0.0254),
        u('ft', '英尺', 'ft', 0.3048),
        u('yd', '码', 'yd', 0.9144),
        u('mi', '英里', 'mi', 1609.344),
        u('nmi', '海里', 'nmi', 1852),
        u('li', '市里', '里', 500),
        u('chi', '市尺', '尺', 1 / 3),
        u('cun', '市寸', '寸', 1 / 30),
        u('au', '天文单位', 'AU', 1.495978707e11),
        u('ly', '光年', 'ly', 9.4607304725808e15)
      ]
    },
    {
      id: 'area', name: '面积', base: 'm2',
      units: [
        u('mm2', '平方毫米', 'mm²', 1e-6),
        u('cm2', '平方厘米', 'cm²', 1e-4),
        u('m2', '平方米', 'm²', 1),
        u('km2', '平方千米', 'km²', 1e6),
        u('ha', '公顷', 'ha', 1e4),
        u('mu', '亩', '亩', 1e4 / 15),
        u('in2', '平方英寸', 'in²', 0.00064516),
        u('ft2', '平方英尺', 'ft²', 0.09290304),
        u('yd2', '平方码', 'yd²', 0.83612736),
        u('ac', '英亩', 'ac', 4046.8564224),
        u('mi2', '平方英里', 'mi²', 2589988.110336)
      ]
    },
    {
      id: 'volume', name: '体积', base: 'l',
      units: [
        u('ml', '毫升', 'mL', 0.001),
        u('cl', '厘升', 'cL', 0.01),
        u('l', '升', 'L', 1),
        u('m3', '立方米', 'm³', 1000),
        u('cm3', '立方厘米', 'cm³', 0.001),
        u('in3', '立方英寸', 'in³', 0.016387064),
        u('ft3', '立方英尺', 'ft³', 28.316846592),
        u('galus', '加仑（美）', 'gal', 3.785411784),
        u('galuk', '加仑（英）', 'gal(UK)', 4.54609),
        u('qtus', '夸脱（美）', 'qt', 0.946352946),
        u('ptus', '品脱（美）', 'pt', 0.473176473),
        u('cupus', '杯（美）', 'cup', 0.2365882365),
        u('tbsp', '汤匙（美）', 'tbsp', 0.01478676478125),
        u('tsp', '茶匙（美）', 'tsp', 0.00492892159375),
        u('floz', '液量盎司（美）', 'fl oz', 0.0295735295625)
      ]
    },
    {
      id: 'mass', name: '质量', base: 'kg',
      units: [
        u('ug', '微克', 'μg', 1e-9),
        u('mg', '毫克', 'mg', 1e-6),
        u('g', '克', 'g', 1e-3),
        u('kg', '千克', 'kg', 1),
        u('t', '吨', 't', 1000),
        u('jin', '斤', '斤', 0.5),
        u('liang', '两', '两', 0.05),
        u('ct', '克拉', 'ct', 0.0002),
        u('oz', '盎司', 'oz', 0.028349523125),
        u('lb', '磅', 'lb', 0.45359237),
        u('st', '英石', 'st', 6.35029318)
      ]
    },
    {
      id: 'temp', name: '温度', base: 'k',
      units: [
        { id: 'c', name: '摄氏度', sym: '°C', to: function (v) { return v + 273.15; }, from: function (v) { return v - 273.15; } },
        { id: 'f', name: '华氏度', sym: '°F', to: function (v) { return (v - 32) * 5 / 9 + 273.15; }, from: function (v) { return (v - 273.15) * 9 / 5 + 32; } },
        { id: 'k', name: '开尔文', sym: 'K', to: function (v) { return v; }, from: function (v) { return v; } }
      ]
    },
    {
      id: 'pressure', name: '压力', base: 'pa',
      units: [
        u('pa', '帕斯卡', 'Pa', 1),
        u('hpa', '百帕', 'hPa', 100),
        u('kpa', '千帕', 'kPa', 1000),
        u('mpa', '兆帕', 'MPa', 1e6),
        u('mbar', '毫巴', 'mbar', 100),
        u('bar', '巴', 'bar', 1e5),
        u('atm', '标准大气压', 'atm', 101325),
        u('mmhg', '毫米汞柱', 'mmHg', 133.322387415),
        u('psi', '磅力/平方英寸', 'psi', 6894.757293168)
      ]
    },
    {
      id: 'power', name: '功率', base: 'w',
      units: [
        u('mw', '毫瓦', 'mW', 1e-3),
        u('w', '瓦特', 'W', 1),
        u('kw', '千瓦', 'kW', 1000),
        u('mw2', '兆瓦', 'MW', 1e6),
        u('ps', '公制马力', 'PS', 735.49875),
        u('hp', '英制马力', 'hp', 745.6998715822702)
      ]
    },
    {
      id: 'energy', name: '能量', base: 'j',
      units: [
        u('j', '焦耳', 'J', 1),
        u('kj', '千焦', 'kJ', 1000),
        u('cal', '卡', 'cal', 4.184),
        u('kcal', '千卡（大卡）', 'kcal', 4184),
        u('wh', '瓦时', 'Wh', 3600),
        u('kwh', '千瓦时（度）', 'kWh', 3.6e6),
        u('btu', '英热单位', 'BTU', 1055.05585262),
        u('ev', '电子伏', 'eV', 1.602176634e-19)
      ]
    },
    {
      id: 'force', name: '力', base: 'n',
      units: [
        u('n', '牛顿', 'N', 1),
        u('kn', '千牛', 'kN', 1000),
        u('dyn', '达因', 'dyn', 1e-5),
        u('kgf', '千克力', 'kgf', 9.80665),
        u('lbf', '磅力', 'lbf', 4.4482216152605)
      ]
    },
    {
      id: 'density', name: '密度', base: 'kgm3',
      units: [
        u('kgm3', '千克/立方米', 'kg/m³', 1),
        u('gcm3', '克/立方厘米', 'g/cm³', 1000),
        u('gl', '克/升', 'g/L', 1),
        u('kgl', '千克/升', 'kg/L', 1000),
        u('lbft3', '磅/立方英尺', 'lb/ft³', 16.018463373960142),
        u('lbin3', '磅/立方英寸', 'lb/in³', 27679.904710191)
      ]
    },
    {
      id: 'speed', name: '速度', base: 'ms',
      units: [
        u('ms', '米/秒', 'm/s', 1),
        u('kmh', '千米/小时', 'km/h', 1 / 3.6),
        u('mph', '英里/小时', 'mph', 0.44704),
        u('fts', '英尺/秒', 'ft/s', 0.3048),
        u('kn2', '节', 'kn', 1852 / 3600),
        u('mach', '马赫', 'Ma', 340.29)
      ]
    },
    {
      id: 'time', name: '时间', base: 's',
      units: [
        u('us', '微秒', 'μs', 1e-6),
        u('ms2', '毫秒', 'ms', 1e-3),
        u('s', '秒', 's', 1),
        u('min', '分钟', 'min', 60),
        u('h', '小时', 'h', 3600),
        u('d', '天', 'd', 86400),
        u('wk', '周', 'wk', 604800),
        u('mo', '月（平均 30.44 天）', 'mo', 2629746),
        u('yr', '年（365 天）', 'yr', 31536000)
      ]
    },
    {
      id: 'data', name: '数据存储', base: 'b',
      units: [
        u('bit', '比特', 'bit', 0.125),
        u('b', '字节', 'B', 1),
        u('kb', '千字节（1000）', 'KB', 1e3),
        u('mb', '兆字节（1000²）', 'MB', 1e6),
        u('gb', '吉字节（1000³）', 'GB', 1e9),
        u('tb', '太字节（1000⁴）', 'TB', 1e12),
        u('kib', '千字节（1024）', 'KiB', 1024),
        u('mib', '兆字节（1024²）', 'MiB', 1048576),
        u('gib', '吉字节（1024³）', 'GiB', 1073741824),
        u('tib', '太字节（1024⁴）', 'TiB', 1099511627776)
      ]
    },
    {
      id: 'angle', name: '角度', base: 'deg',
      units: [
        u('deg', '度', '°', 1),
        u('rad', '弧度', 'rad', 180 / Math.PI),
        u('mrad', '毫弧度', 'mrad', 0.18 / Math.PI),
        u('grad', '百分度', 'grad', 0.9),
        u('turn', '转', 'turn', 360),
        u('arcmin', '角分', "'", 1 / 60),
        u('arcsec', '角秒', '"', 1 / 3600)
      ]
    }
  ];

  var INDEX = {};
  CATEGORIES.forEach(function (c) {
    INDEX[c.id] = c;
    c.map = {};
    c.units.forEach(function (x) { c.map[x.id] = x; });
  });

  function category(id) { return INDEX[id] || null; }
  function unit(catId, unitId) {
    var c = INDEX[catId];
    return (c && c.map[unitId]) || null;
  }

  /* 到基准 / 从基准 —— 线性与仿射在这里统一 */
  function toBase(x, v) { return x.to ? x.to(v) : v * x.f; }
  function fromBase(x, v) { return x.from ? x.from(v) : v / x.f; }

  function isNum(v) {
    if (typeof v === 'number') return isFinite(v);
    if (v === '' || v === null || v === undefined) return false;
    return isFinite(Number(v));
  }

  /* 把输入转成数字。注意 Number('') === 0、Number(null) === 0 —— 
     用户还没输入任何东西时，必须让它是「无结果」而不是「0」。 */
  function toNum(v) {
    if (v === '' || v === null || v === undefined) return NaN;
    if (typeof v === 'boolean') return NaN;
    return Number(v);
  }

  /* 单个换算：value 从 fromId 到 toId */
  function convert(value, fromId, toId, catId) {
    var c = INDEX[catId];
    if (!c) return null;
    var a = c.map[fromId], b = c.map[toId];
    if (!a || !b) return null;
    var n = toNum(value);
    if (!isFinite(n)) return null;
    return fromBase(b, toBase(a, n));
  }

  /* 同一数值在该分类下的所有单位对照，按定义顺序返回 */
  function convertAll(value, fromId, catId) {
    var c = INDEX[catId];
    if (!c) return [];
    var a = c.map[fromId];
    if (!a) return [];
    var n = toNum(value);
    if (!isFinite(n)) return [];
    var base = toBase(a, n);
    return c.units.map(function (x) {
      return { id: x.id, name: x.name, sym: x.sym, value: fromBase(x, base) };
    });
  }

  /* 数字格式化：
     去掉浮点尾巴（12 位有效数字收敛），极大极小值改走科学计数法 —— 
     否则 1 光年换算成纳米会得到 24 位数字堆在一起，读不了。 */
  function fmt(n) {
    if (!isFinite(n)) return '';
    if (n === 0) return '0';
    var abs = Math.abs(n);
    if (abs >= 1e15 || abs < 1e-6) {
      return n.toExponential(6).replace(/\.?0+e/, 'e').replace('e+', 'e');
    }
    var r = Number(n.toPrecision(12));
    return String(r);
  }

  T.UnitConvert = {
    CATEGORIES: CATEGORIES,
    category: category,
    unit: unit,
    toBase: toBase,
    fromBase: fromBase,
    convert: convert,
    convertAll: convertAll,
    fmt: fmt,
    isNum: isNum
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = T.UnitConvert;
})(typeof window !== 'undefined' ? window : globalThis);
