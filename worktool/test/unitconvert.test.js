/* ============================================================
   纯逻辑用例：node test/unitconvert.test.js
   全部离线。单位换算最容易错在三处，这里都钉死：
     · 温度是仿射不是线性（0°C ≠ 0K）
     · 数据存储有两种进制（1000 与 1024），必须都认
     · 换算经过基准单位，浮点会留尾巴，必须收敛掉
   ============================================================ */
'use strict';

var U = require('../js/lib/unitconvert.js');

var pass = 0, fail = 0;
function check(name, got, want) {
  var ok = got === want;
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + name);
  if (!ok) console.log('         期望: ' + want + '\n         实际: ' + got);
}
function near(name, got, want, tol) {
  var ok = got !== null && Math.abs(got - want) <= (tol == null ? 1e-9 : tol);
  ok ? pass++ : fail++;
  console.log((ok ? '  ok   ' : '  FAIL ') + name);
  if (!ok) console.log('         期望: ' + want + ' ±' + (tol == null ? 1e-9 : tol) + '\n         实际: ' + got);
}

/* ---------- 结构完整性 ---------- */
console.log('\n── 结构 ──');
check('分类数量为 14', U.CATEGORIES.length, 14);
check('每个分类都有 id / name / base / units',
  U.CATEGORIES.every(function (c) { return c.id && c.name && c.base && c.units.length >= 3; }), true);
check('分类 id 不重复',
  new Set(U.CATEGORIES.map(function (c) { return c.id; })).size, U.CATEGORIES.length);
check('每个分类内的单位 id 不重复',
  U.CATEGORIES.every(function (c) { return new Set(c.units.map(function (x) { return x.id; })).size === c.units.length; }), true);
check('每个分类都含自己的基准单位',
  U.CATEGORIES.every(function (c) { return !!U.unit(c.id, c.base); }), true);
var total = U.CATEGORIES.reduce(function (a, c) { return a + c.units.length; }, 0);
console.log('    单位总数: ' + total);
check('单位总数 >= 120', total >= 120, true);

/* ---------- 长度 ---------- */
console.log('\n── 长度 ──');
near('1 米 = 100 厘米', U.convert(1, 'm', 'cm', 'length'), 100);
near('1 米 = 1000 毫米', U.convert(1, 'm', 'mm', 'length'), 1000);
near('1 千米 = 1000 米', U.convert(1, 'km', 'm', 'length'), 1000);
near('1 英寸 = 2.54 厘米', U.convert(1, 'in', 'cm', 'length'), 2.54, 1e-9);
near('1 英尺 = 12 英寸', U.convert(1, 'ft', 'in', 'length'), 12, 1e-9);
near('1 英里 = 1609.344 米', U.convert(1, 'mi', 'm', 'length'), 1609.344, 1e-6);
near('1 海里 = 1852 米', U.convert(1, 'nmi', 'm', 'length'), 1852);
near('1 市里 = 500 米', U.convert(1, 'li', 'm', 'length'), 500);
near('3 市尺 = 1 米', U.convert(3, 'chi', 'm', 'length'), 1, 1e-12);
near('1 米 = 3 市尺', U.convert(1, 'm', 'chi', 'length'), 3, 1e-9);
near('1 天文单位 ≈ 1.496e11 米', U.convert(1, 'au', 'm', 'length'), 1.495978707e11, 1e3);

/* ---------- 面积 / 体积 ---------- */
console.log('\n── 面积与体积 ──');
near('1 平方米 = 10000 平方厘米', U.convert(1, 'm2', 'cm2', 'area'), 1e4, 1e-6);
near('1 公顷 = 10000 平方米', U.convert(1, 'ha', 'm2', 'area'), 1e4, 1e-6);
near('1 亩 = 666.67 平方米', U.convert(1, 'mu', 'm2', 'area'), 1e4 / 15, 1e-6);
near('1 英亩 ≈ 4046.86 平方米', U.convert(1, 'ac', 'm2', 'area'), 4046.8564224, 1e-6);
near('1 平方英尺 = 144 平方英寸', U.convert(1, 'ft2', 'in2', 'area'), 144, 1e-6);
near('1 升 = 1000 毫升', U.convert(1, 'l', 'ml', 'volume'), 1000);
near('1 立方米 = 1000 升', U.convert(1, 'm3', 'l', 'volume'), 1000);
near('1 立方厘米 = 1 毫升', U.convert(1, 'cm3', 'ml', 'volume'), 1, 1e-12);
near('1 美制加仑 ≈ 3.785 升', U.convert(1, 'galus', 'l', 'volume'), 3.785411784, 1e-9);
near('1 英制加仑 = 4.54609 升', U.convert(1, 'galuk', 'l', 'volume'), 4.54609, 1e-9);

/* ---------- 质量 ---------- */
console.log('\n── 质量 ──');
near('1 千克 = 1000 克', U.convert(1, 'kg', 'g', 'mass'), 1000);
near('1 吨 = 1000 千克', U.convert(1, 't', 'kg', 'mass'), 1000);
near('1 斤 = 500 克', U.convert(1, 'jin', 'g', 'mass'), 500, 1e-9);
near('1 磅 = 453.59237 克', U.convert(1, 'lb', 'g', 'mass'), 453.59237, 1e-9);
near('1 盎司 = 28.3495 克', U.convert(1, 'oz', 'g', 'mass'), 28.349523125, 1e-9);
near('1 英石 = 14 磅', U.convert(1, 'st', 'lb', 'mass'), 14, 1e-9);

/* ---------- 温度（仿射，重点） ---------- */
console.log('\n── 温度 ──');
near('0°C = 273.15K', U.convert(0, 'c', 'k', 'temp'), 273.15, 1e-9);
near('0°C = 32°F', U.convert(0, 'c', 'f', 'temp'), 32, 1e-9);
near('100°C = 212°F', U.convert(100, 'c', 'f', 'temp'), 212, 1e-9);
near('100°C = 373.15K', U.convert(100, 'c', 'k', 'temp'), 373.15, 1e-9);
near('-40°C = -40°F（两者相等的那个点）', U.convert(-40, 'c', 'f', 'temp'), -40, 1e-9);
near('212°F = 100°C', U.convert(212, 'f', 'c', 'temp'), 100, 1e-9);
near('32°F = 0°C', U.convert(32, 'f', 'c', 'temp'), 0, 1e-9);
near('273.15K = 0°C', U.convert(273.15, 'k', 'c', 'temp'), 0, 1e-9);
near('同一单位原样返回', U.convert(37, 'c', 'c', 'temp'), 37, 1e-12);
near('体温 37°C = 98.6°F', U.convert(37, 'c', 'f', 'temp'), 98.6, 1e-9);

/* ---------- 数据存储（两种进制） ---------- */
console.log('\n── 数据存储 ──');
near('1 字节 = 8 比特', U.convert(1, 'b', 'bit', 'data'), 8, 1e-12);
near('1 KiB = 1024 字节', U.convert(1, 'kib', 'b', 'data'), 1024);
near('1 MiB = 1048576 字节', U.convert(1, 'mib', 'b', 'data'), 1048576);
near('1 GiB = 1024 MiB', U.convert(1, 'gib', 'mib', 'data'), 1024);
near('1 GiB = 1073741824 字节', U.convert(1, 'gib', 'b', 'data'), 1073741824);
near('1 GB（十进制）= 1000 MB', U.convert(1, 'gb', 'mb', 'data'), 1000);
near('1 GB = 1e9 字节', U.convert(1, 'gb', 'b', 'data'), 1e9);
near('1 GB ≈ 0.931 GiB', U.convert(1, 'gb', 'gib', 'data'), 1e9 / 1073741824, 1e-12);
near('1 TiB = 1024 GiB', U.convert(1, 'tib', 'gib', 'data'), 1024);

/* ---------- 速度 / 时间 / 角度 ---------- */
console.log('\n── 速度 / 时间 / 角度 ──');
near('1 米/秒 = 3.6 千米/小时', U.convert(1, 'ms', 'kmh', 'speed'), 3.6, 1e-9);
near('1 英里/小时 ≈ 1.609 千米/小时', U.convert(1, 'mph', 'kmh', 'speed'), 1.609344, 1e-9);
near('1 节 = 1.852 千米/小时', U.convert(1, 'kn2', 'kmh', 'speed'), 1.852, 1e-9);
near('1 小时 = 3600 秒', U.convert(1, 'h', 's', 'time'), 3600);
near('1 天 = 24 小时', U.convert(1, 'd', 'h', 'time'), 24);
near('1 周 = 7 天', U.convert(1, 'wk', 'd', 'time'), 7);
near('1 年 = 365 天', U.convert(1, 'yr', 'd', 'time'), 365);
near('180° = π 弧度', U.convert(180, 'deg', 'rad', 'angle'), Math.PI, 1e-12);
near('1 转 = 360 度', U.convert(1, 'turn', 'deg', 'angle'), 360);
near('1 度 = 60 角分', U.convert(1, 'deg', 'arcmin', 'angle'), 60, 1e-12);
near('1 角分 = 60 角秒', U.convert(1, 'arcmin', 'arcsec', 'angle'), 60, 1e-12);

/* ---------- 压力 / 功率 / 能量 / 力 / 密度 ---------- */
console.log('\n── 压力 / 功率 / 能量 / 力 / 密度 ──');
near('1 标准大气压 = 101325 帕', U.convert(1, 'atm', 'pa', 'pressure'), 101325, 1e-6);
near('1 巴 = 100000 帕', U.convert(1, 'bar', 'pa', 'pressure'), 1e5, 1e-6);
near('1 psi ≈ 6894.76 帕', U.convert(1, 'psi', 'pa', 'pressure'), 6894.757293168, 1e-6);
near('1 千瓦 = 1000 瓦', U.convert(1, 'kw', 'w', 'power'), 1000);
near('1 公制马力 = 735.49875 瓦', U.convert(1, 'ps', 'w', 'power'), 735.49875, 1e-9);
near('1 千瓦时 = 3.6e6 焦耳', U.convert(1, 'kwh', 'j', 'energy'), 3.6e6, 1e-6);
near('1 千卡 = 4184 焦耳', U.convert(1, 'kcal', 'j', 'energy'), 4184, 1e-9);
near('1 瓦时 = 3600 焦耳', U.convert(1, 'wh', 'j', 'energy'), 3600, 1e-9);
near('1 千克力 = 9.80665 牛', U.convert(1, 'kgf', 'n', 'force'), 9.80665, 1e-9);
near('1 磅力 ≈ 4.448 牛', U.convert(1, 'lbf', 'n', 'force'), 4.4482216152605, 1e-9);
near('1 克/立方厘米 = 1000 千克/立方米', U.convert(1, 'gcm3', 'kgm3', 'density'), 1000);

/* ---------- 基准单位自洽与往返 ---------- */
console.log('\n── 基准自洽与往返 ──');
U.CATEGORIES.forEach(function (c) {
  var self = U.convert(7.5, c.base, c.base, c.id);
  check(c.name + '：基准单位自身换算恒等', self === 7.5, true);
});
U.CATEGORIES.forEach(function (c) {
  var okAll = c.units.every(function (x) {
    var back = U.convert(U.convert(3.25, c.base, x.id, c.id), x.id, c.base, c.id);
    return Math.abs(back - 3.25) < 1e-6;
  });
  check(c.name + '：所有单位往返一致', okAll, true);
});

/* ---------- convertAll ---------- */
console.log('\n── 全单位对照 ──');
var all = U.convertAll(1, 'm', 'length');
check('对照表覆盖该分类所有单位', all.length, U.category('length').units.length);
check('对照表按定义顺序返回（长度类首项是纳米）', all[0].id, 'nm');
near('对照表里基准单位自身值等于输入', all.filter(function (x) { return x.id === 'm'; })[0].value, 1);
near('对照表里米→厘米为 100', all.filter(function (x) { return x.id === 'cm'; })[0].value, 100);
var allTemp = U.convertAll(100, 'c', 'temp');
near('温度对照表：100°C → 华氏 212',
  allTemp.filter(function (x) { return x.id === 'f'; })[0].value, 212, 1e-9);
near('温度对照表：100°C → 开尔文 373.15',
  allTemp.filter(function (x) { return x.id === 'k'; })[0].value, 373.15, 1e-9);

/* ---------- 精度与格式化 ---------- */
console.log('\n── 精度与格式化 ──');
check('浮点尾巴被收敛：1 m → cm 不出现 99.99999999999', U.fmt(U.convert(1, 'm', 'cm', 'length')), '100');
check('0.1+0.2 那类问题：3 英寸 → 厘米', U.fmt(U.convert(3, 'in', 'cm', 'length')), '7.62');
check('整数结果不带小数点', U.fmt(U.convert(1, 'm', 'mm', 'length')), '1000');
check('零值格式化为 0', U.fmt(0), '0');
check('极大值走科学计数法', /\d+e\d+/.test(U.fmt(U.convert(1, 'ly', 'nm', 'length'))), true);
check('极小值也走科学计数法', /\d+e-\d+/.test(U.fmt(1e-9)), true);
check('无意义的值返回空串', U.fmt(NaN), '');
check('1/3 不会出现一长串尾巴', U.fmt(1 / 3), '0.333333333333');

/* ---------- 非法输入 ---------- */
console.log('\n── 非法输入 ──');
check('未知分类返回 null', U.convert(1, 'm', 'cm', 'nope'), null);
check('未知单位返回 null', U.convert(1, 'nope', 'cm', 'length'), null);
check('非数字返回 null', U.convert('abc', 'm', 'cm', 'length'), null);
check('空串返回 null', U.convert('', 'm', 'cm', 'length'), null);
check('undefined 返回 null', U.convert(undefined, 'm', 'cm', 'length'), null);
check('字符串数字可以换算', U.convert('2.5', 'm', 'cm', 'length'), 250);
check('对照表遇到非法分类返回空数组', U.convertAll(1, 'm', 'nope').length, 0);
check('isNum("12") 为真', U.isNum('12'), true);
check('isNum("abc") 为假', U.isNum('abc'), false);
check('isNum(NaN) 为假', U.isNum(NaN), false);

console.log('\n' + '='.repeat(46));
console.log('结果: ' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) process.exit(1);
