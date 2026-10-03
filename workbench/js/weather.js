/* ==========================================================================
   4. 天气模块
   ========================================================================== */
const WX_CACHE_MS = 15 * 60 * 1000; // 15 分钟内不重复请求

/* ── 天气文案中文化 ────────────────────────────────────────────────
   wttr.in 虽然支持 ?lang=zh，但实测它的 lang_zh 字段只是把英文原文
   原样复制了一份（{"value":"Light rain shower"}），并不翻译。所以想
   要中文只能自己映射。策略分三层，从可靠到兜底：
     1) 按 weatherCode 查 WWO 官方码表（最准，与文案无关）
     2) code 认不出时，按英文描述里的关键词匹配（覆盖未收录的新文案）
     3) 都不中则原样返回，至少不会显示空白
   中文命名参照「彩云天气 API · 天气现象」术语表：
     https://docs.caiyunapp.com/weather-api/v2/v2.6/tables/skycon.html
   即小/中/大/暴雨、小/中/大/暴雪、雾霾（不细分轻中重）、浮尘、沙尘、大风、雾。
   WWO 码表见 https://www.worldweatheronline.com/developer/api/docs/weather-icons.aspx */
const WWO_ZH = {
  113:'晴', 116:'多云', 119:'阴', 122:'阴',
  125:'雾霾', 134:'沙尘', 137:'沙尘', 143:'雾', 145:'雾', 148:'雾',
  149:'浮尘', 152:'雾霾', 154:'雾霾', 248:'雾', 251:'雾', 254:'雾', 260:'雾',
  176:'阵雨', 179:'阵雪', 182:'雨夹雪', 185:'冻毛毛雨',
  200:'雷阵雨', 227:'吹雪', 230:'暴雪',
  263:'毛毛雨', 266:'毛毛雨', 281:'冻雨', 284:'冻雨',
  293:'小雨', 296:'小雨', 299:'中雨', 302:'中雨',
  305:'大雨', 308:'大雨', 311:'冻雨', 314:'冻雨',
  317:'雨夹雪', 320:'雨夹雪', 323:'小雪', 326:'小雪',
  329:'中雪', 332:'中雪', 335:'大雪', 338:'大雪',
  350:'冰粒', 353:'阵雨', 356:'大雨', 359:'暴雨',
  362:'雨夹雪', 365:'雨夹雪', 368:'阵雪', 371:'大雪',
  374:'冰粒', 377:'冰粒',
  386:'雷阵雨', 389:'雷阵雨', 392:'雷阵雪', 395:'雷阵雪'
};
/** 英文描述关键词 → 中文（按「越具体越靠前」排序，命中即返回） */
const EN_ZH_PATTERNS = [
  [/freezing fog/i, '雾'], [/blizzard|storm snow/i, '暴雪'], [/blowing snow/i, '吹雪'],
  [/torrential rain|storm rain/i, '暴雨'],
  [/thunder|thundery/i, '雷阵雨'],
  [/heavy freezing drizzle/i, '冻雨'], [/freezing drizzle/i, '冻雨'],
  [/heavy freezing rain/i, '冻雨'], [/freezing rain/i, '冻雨'],
  [/heavy rain|storm_rain/i, '大雨'], [/moderate rain/i, '中雨'], [/light rain/i, '小雨'],
  [/drizzle/i, '毛毛雨'], [/rain shower|shower/i, '阵雨'], [/rain/i, '小雨'],
  [/heavy snow/i, '大雪'], [/moderate snow/i, '中雪'], [/light snow|snow/i, '小雪'],
  [/sleet/i, '雨夹雪'], [/ice pellet/i, '冰粒'],
  // 彩云术语：浮尘（Smoky haze）、沙尘（Sandstorm/Dust）、雾霾（Haze/Smog）、雾（Mist/Fog）
  [/smoky|dust|blowing dust/i, '浮尘'], [/sandstorm|sand/i, '沙尘'],
  [/smog|haze/i, '雾霾'], [/mist/i, '雾'], [/fog/i, '雾'], [/hail/i, '冰雹'],
  [/overcast/i, '阴'], [/partly cloudy|partly/i, '多云'], [/cloudy/i, '阴'],
  [/sunny|clear/i, '晴'], [/windy|gale/i, '大风']
];
/** WMO 码（open-meteo）→ 彩云天气术语。数字区间 0~99，与 WWO 表不重叠 */
const WMO_ZH = {
  0:'晴',1:'晴',2:'多云',3:'阴',45:'雾',48:'雾',51:'毛毛雨',53:'毛毛雨',55:'毛毛雨',
  56:'冻雨',57:'冻雨',61:'小雨',63:'中雨',65:'大雨',66:'冻雨',67:'冻雨',71:'小雪',73:'中雪',
  75:'大雪',77:'冰粒',80:'阵雨',81:'中雨',82:'大雨',85:'阵雪',86:'大雪',95:'雷阵雨',96:'雷阵雨',99:'雷阵雨'
};
/**
 * 天气描述转中文。
 * @param {number|string} code 天气码（优先按它查表）
 * @param {string} desc 上游返回的原文（中英不限）
 * @returns {string} 中文描述；已含中文则原样返回
 *
 * ⚠️ 两套码表数字不重叠，必须区分，否则会张冠李戴：
 *    WWO 码（wttr.in）  113 ~ 395
 *    WMO 码（open-meteo） 0 ~ 99
 *   例如 code=1 是 WMO 的「晴」，若误查 WWO 表会得到 113 对应的值。
 */
function wxText(code, desc){
  const raw = String(desc || '').trim();
  // 上游已经给了中文（如 open-meteo 的 wmoText 结果）就直接用
  if (/[\u4e00-\u9fa5]/.test(raw)) return raw;
  const c = Number(code);
  if (Number.isFinite(c)){
    // 按数字区间判断属于哪套码表
    if (c >= 113 && c <= 395 && WWO_ZH[c]) return WWO_ZH[c];
    if (c >= 0 && c <= 99 && WMO_ZH[c]) return WMO_ZH[c];
  }
  for (const [re, t] of EN_ZH_PATTERNS) if (re.test(raw)) return t;
  return raw || '未知';
}

/* ── 行政区名中文化 ────────────────────────────────────────────────
   wttr.in 返回的 region 是英文（Guangdong / Beijing），显示「广州 · Guangdong」
   很跳。这里映射中国省级行政区 + 常见国家名。查不到就原样返回。 */
const REGION_ZH = {
  'guangdong':'广东','guangxi':'广西','beijing':'北京','shanghai':'上海','tianjin':'天津',
  'chongqing':'重庆','hebei':'河北','shanxi':'山西','liaoning':'辽宁','jilin':'吉林',
  'heilongjiang':'黑龙江','jiangsu':'江苏','zhejiang':'浙江','anhui':'安徽','fujian':'福建',
  'jiangxi':'江西','shandong':'山东','henan':'河南','hubei':'湖北','hunan':'湖南',
  'hainan':'海南','sichuan':'四川','guizhou':'贵州','yunnan':'云南','shaanxi':'陕西',
  'gansu':'甘肃','qinghai':'青海','inner mongolia':'内蒙古','neimenggu':'内蒙古',
  'ningxia':'宁夏','xinjiang':'新疆','xizang':'西藏','tibet':'西藏',
  'hong kong':'中国香港','hong kong sar':'中国香港','macau':'中国澳门','macao':'中国澳门',
  'taiwan':'中国台湾',
  'china':'中国','japan':'日本','korea':'韩国','south korea':'韩国','singapore':'新加坡',
  'malaysia':'马来西亚','thailand':'泰国','vietnam':'越南','united states':'美国',
  'united kingdom':'英国','australia':'澳大利亚','canada':'加拿大'
};
/**
 * 地名/行政区名转中文。支持 "A · B" 这种拼接串，逐段转换。
 * @param {string} s 原始地区串
 */
function regionText(s){
  const raw = String(s || '').trim();
  if (!raw) return '';
  return raw.split(/\s*·\s*/).map(seg => {
    const t = seg.trim();
    if (!t) return '';
    if (/[\u4e00-\u9fa5]/.test(t)) return t;          // 已是中文
    const zh = REGION_ZH[t.toLowerCase()];
    return zh || t;
  }).filter(Boolean).join(' · ');
}

/** WMO / wttr 天气码 → 图标 + 文案 + 配色 */
function wxMeta(code, isDay = true, descText = ''){
  const c = Number(code);
  const d = (descText || '').toLowerCase();
  // wttr.in 用的是 WWO code，open-meteo 是 WMO code，这里做统一映射
  let key = 'cloud';
  if ([113, 116].includes(c) || /sunny|clear/i.test(d)) key = isDay ? 'sun' : 'moon';
  else if ([119, 122].includes(c) || /cloudy|overcast/i.test(d)) key = 'cloud';
  else if ([143, 248, 260].includes(c) || /fog|mist/i.test(d)) key = 'fog';
  else if ([200, 386, 389, 392, 395].includes(c) || /thunder/i.test(d)) key = 'storm';
  else if ([179, 182, 185, 227, 230, 320, 323, 326, 329, 332, 335, 338, 368, 371].includes(c) || /snow|sleet|blizzard/i.test(d)) key = 'snow';
  else if ([176, 263, 266, 281, 284, 293, 296, 299, 302, 305, 308, 311, 314, 353, 356, 359, 362, 365].includes(c) || /rain|drizzle|shower/i.test(d)) key = 'rain';
  else if (c === 0) key = isDay ? 'sun' : 'moon';
  else if ([1, 2].includes(c)) key = 'partly';
  else if (c === 3) key = 'cloud';
  else if ([45, 48].includes(c)) key = 'fog';
  else if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(c)) key = 'rain';
  else if ([71, 73, 75, 77, 85, 86].includes(c)) key = 'snow';
  else if ([95, 96, 99].includes(c)) key = 'storm';
  // 背景色走 CSS 变量：浅色/深色模式各自一套，避免深色模式下「白底白字」。
  // 变量定义见 part1_head.html 的 --wx-* ；此处只给 key，不再内联写死浅色。
  const tone = {
    sun:{c:'#d9962f',bg:'var(--wx-sun)'}, moon:{c:'#6b7699',bg:'var(--wx-moon)'},
    cloud:{c:'#8a9099',bg:'var(--wx-cloud)'}, partly:{c:'#c99a3c',bg:'var(--wx-partly)'},
    rain:{c:'#4a7189',bg:'var(--wx-rain)'}, storm:{c:'#7a5c78',bg:'var(--wx-storm)'},
    snow:{c:'#7d97ab',bg:'var(--wx-snow)'}, fog:{c:'#8c8578',bg:'var(--wx-fog)'}
  }[key] || {c:'#8a9099', bg:'var(--wx-cloud)'};
  return { key, tone, icon: key, label: wxText(c, descText) };
}
/** 天气大图标（彩色） */
function wxIconBig(key, size = 88){
  const stroke = {
    sun:'#d9962f', moon:'#6b7699', cloud:'#8a9099', partly:'#c99a3c',
    rain:'#4a7189', storm:'#7a5c78', snow:'#7d97ab', fog:'#8c8578'
  }[key] || '#8a9099';
  const fill = {
    sun:'rgba(217,150,47,.16)', moon:'rgba(107,118,153,.14)', cloud:'rgba(138,144,153,.16)',
    partly:'rgba(201,154,60,.15)', rain:'rgba(74,113,137,.14)',
    storm:'rgba(122,92,120,.15)', snow:'rgba(125,151,171,.15)', fog:'rgba(140,133,120,.14)'
  }[key] || 'transparent';
  let inner = '';
  const S = 'stroke="' + stroke + '" fill="none" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round"';
  const F = 'fill="' + fill + '" stroke="none"';
  switch(key){
    case 'sun':
      inner = '<circle cx="32" cy="32" r="13" ' + F + '/><circle cx="32" cy="32" r="13" ' + S + '/>' +
        '<g ' + S + '><path d="M32 9v5M32 50v5M9 32h5M50 32h5M15.7 15.7l3.6 3.6M44.7 44.7l3.6 3.6M48.3 15.7l-3.6 3.6M19.3 44.7l-3.6 3.6"/></g>';
      break;
    case 'moon':
      inner = '<path d="M41 33.5A16.5 16.5 0 0 1 24.2 13 16.8 16.8 0 1 0 41 33.5z" ' + F + '/>' +
        '<path d="M41 33.5A16.5 16.5 0 0 1 24.2 13 16.8 16.8 0 1 0 41 33.5z" ' + S + '/>';
      break;
    case 'partly':
      inner = '<circle cx="23" cy="22" r="8.5" ' + F + '/><circle cx="23" cy="22" r="8.5" ' + S + '/>' +
        '<g ' + S + '><path d="M23 7v3.4M23 33.6v3.4M8 22h3.4M34.6 22H38M12.6 11.6l2.4 2.4M31 30l2.4 2.4M33.4 11.6L31 14M14 30l-2.4 2.4"/></g>' +
        '<path d="M27 51h16a7.2 7.2 0 0 0 .6-14.3A10 10 0 0 0 24.4 35 7.7 7.7 0 0 0 27 51z" ' + F + '/>' +
        '<path d="M27 51h16a7.2 7.2 0 0 0 .6-14.3A10 10 0 0 0 24.4 35 7.7 7.7 0 0 0 27 51z" ' + S + '/>';
      break;
    case 'rain':
      inner = '<path d="M18 41h26a8.4 8.4 0 0 0 .7-16.7A11.7 11.7 0 0 0 21.2 22 9 9 0 0 0 18 41z" ' + F + '/>' +
        '<path d="M18 41h26a8.4 8.4 0 0 0 .7-16.7A11.7 11.7 0 0 0 21.2 22 9 9 0 0 0 18 41z" ' + S + '/>' +
        '<g ' + S + '><path d="M24 47l-2 5.5M33 47l-2 5.5M42 47l-2 5.5"/></g>';
      break;
    case 'storm':
      inner = '<path d="M18 39h26a8.4 8.4 0 0 0 .7-16.7A11.7 11.7 0 0 0 21.2 20 9 9 0 0 0 18 39z" ' + F + '/>' +
        '<path d="M18 39h26a8.4 8.4 0 0 0 .7-16.7A11.7 11.7 0 0 0 21.2 20 9 9 0 0 0 18 39z" ' + S + '/>' +
        '<path d="M34 43l-6 9h7.5l-6 9" ' + S + ' stroke-width="2"/>';
      break;
    case 'snow':
      inner = '<path d="M18 38h26a8.4 8.4 0 0 0 .7-16.7A11.7 11.7 0 0 0 21.2 19 9 9 0 0 0 18 38z" ' + F + '/>' +
        '<path d="M18 38h26a8.4 8.4 0 0 0 .7-16.7A11.7 11.7 0 0 0 21.2 19 9 9 0 0 0 18 38z" ' + S + '/>' +
        '<g ' + S + '><path d="M23 46v7M19.9 47.8l6.2 3.4M26.1 47.8l-6.2 3.4"/><path d="M41 46v7M37.9 47.8l6.2 3.4M44.1 47.8l-6.2 3.4"/></g>';
      break;
    case 'fog':
      inner = '<path d="M18 36h26a8.4 8.4 0 0 0 .7-16.7A11.7 11.7 0 0 0 21.2 17 9 9 0 0 0 18 36z" ' + F + '/>' +
        '<path d="M18 36h26a8.4 8.4 0 0 0 .7-16.7A11.7 11.7 0 0 0 21.2 17 9 9 0 0 0 18 36z" ' + S + '/>' +
        '<g ' + S + '><path d="M12 44h30M17 51h30"/></g>';
      break;
    default:
      inner = '<path d="M18 40h26a8.4 8.4 0 0 0 .7-16.7A11.7 11.7 0 0 0 21.2 21 9 9 0 0 0 18 40z" ' + F + '/>' +
        '<path d="M18 40h26a8.4 8.4 0 0 0 .7-16.7A11.7 11.7 0 0 0 21.2 21 9 9 0 0 0 18 40z" ' + S + '/>';
  }
  return '<svg viewBox="0 0 64 64" width="' + size + '" height="' + size + '" aria-hidden="true">' + inner + '</svg>';
}

const Weather = {
  loading: false,
  err: '',
  data: null,

  /** 定位：多源降级，全部失败则回退到已保存城市 */
  async locate(){
    const provs = [
      async (sig) => {
        const d = await (await fetch('https://ipapi.co/json/', { signal: sig })).json();
        if (!d || d.error || !d.latitude) throw new Error('ipapi 无数据');
        return { name: d.city || d.region || '未知', lat: d.latitude, lon: d.longitude, region: [d.region, d.country_name].filter(Boolean).join(' · ') };
      },
      async (sig) => {
        const d = await (await fetch('https://ipwho.is/', { signal: sig })).json();
        if (!d || !d.success) throw new Error('ipwho 无数据');
        return { name: d.city || d.region || '未知', lat: d.latitude, lon: d.longitude, region: [d.region, d.country].filter(Boolean).join(' · ') };
      },
      async (sig) => {
        const d = await (await fetch('http://ip-api.com/json/?lang=zh-CN', { signal: sig })).json();
        if (!d || d.status !== 'success') throw new Error('ip-api 无数据');
        return { name: d.city || d.regionName || '未知', lat: d.lat, lon: d.lon, region: [d.regionName, d.country].filter(Boolean).join(' · ') };
      },
      async (sig) => {
        const d = await (await fetch('https://ipinfo.io/json', { signal: sig })).json();
        if (!d || !d.loc) throw new Error('ipinfo 无数据');
        const [la, lo] = d.loc.split(',').map(Number);
        return { name: d.city || d.region || '未知', lat: la, lon: lo, region: [d.region, d.country].filter(Boolean).join(' · ') };
      }
    ];
    return await firstOk(provs.map(p => () => new Promise((res, rej) => {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 7000);
      p(ctl.signal).then(r => { clearTimeout(t); res(r); }).catch(e => { clearTimeout(t); rej(e); });
    })), 7500);
  },

  /** 中文城市搜索 */
  async searchCity(q){
    const url = 'https://geocoding-api.open-meteo.com/v1/search?name=' + encodeURIComponent(q) + '&count=8&language=zh&format=json';
    const d = await jjson(url, {}, 9000);
    return (d.results || []).map(r => ({
      name: r.name, lat: r.latitude, lon: r.longitude,
      region: [r.admin1, r.country].filter(Boolean).join(' · '),
      pop: r.population || 0
    }));
  },

  /** 拉取天气（wttr 主源 + open-meteo 备用） */
  async fetch(city, force = false){
    const ck = 'lifehub.v1.wx.' + city.lat.toFixed(2) + '.' + city.lon.toFixed(2);
    if (!force){
      try {
        const c = JSON.parse(localStorage.getItem(ck) || 'null');
        if (c && Date.now() - c.at < WX_CACHE_MS) return c.data;
      } catch (e){}
    }
    let data = null, errs = [];
    // 主源：wttr.in（按经纬度，最准）
    try { data = await this._wttr(city); } catch (e){ errs.push('wttr: ' + e.message); }
    // 备源：open-meteo
    if (!data){ try { data = await this._om(city); } catch (e){ errs.push('open-meteo: ' + e.message); } }
    if (!data) throw new Error(errs.join(' / ') || '天气服务不可用');
    try { localStorage.setItem(ck, JSON.stringify({ at: Date.now(), data })); } catch (e){}
    return data;
  },

  async _wttr(city){
    const url = 'https://wttr.in/' + city.lat.toFixed(4) + ',' + city.lon.toFixed(4) + '?format=j1&lang=zh';
    const d = await jjson(url, {}, 13000);
    const cur = d.current_condition && d.current_condition[0];
    if (!cur) throw new Error('无当前天气数据');
    const descZh = (cur.lang_zh && cur.lang_zh[0] && cur.lang_zh[0].value) || cur.weatherDesc?.[0]?.value || '';
    const area = d.nearest_area?.[0];
    const hours = [], today = d.weather?.[0];
    // hoursAll：今天 0~23 点的完整逐小时序列，供「通勤天气」按任意时刻取数。
    // 上面那个 hours 只截「当前时刻之后的 12 小时」，覆盖不到早班（如 8:00）。
    // 注意 wttr 的 hourly 是 3 小时间隔（每天只有 8 条：0/3/6/9/12/15/18/21），
    // 所以取到的是「最接近的一格」，精度不如 open-meteo 的逐小时。
    const mkHour = h => ({
      h: Math.floor(Number(h.time) / 100),
      t: Number(h.tempC),
      code: Number(h.weatherCode),
      desc: wxText(h.weatherCode, h.lang_zh?.[0]?.value || h.weatherDesc?.[0]?.value || ''),
      precip: Number(h.precipMM) || 0,
      chance: Number(h.chanceofrain) || 0
    });
    const hoursAll = (today?.hourly || []).map(mkHour)
      .filter(x => x.h >= 0 && x.h <= 23).sort((a, b) => a.h - b.h);
    // hoursByDay：按日期索引的逐小时表，供「过了下班时间看明天通勤」跨天取数。
    // 键是 YYYY-MM-DD，值是当天逐小时数组。
    const hoursByDay = {};
    (d.weather || []).forEach(w => {
      if (!w?.date) return;
      hoursByDay[w.date] = (w.hourly || []).map(mkHour)
        .filter(x => x.h >= 0 && x.h <= 23).sort((a, b) => a.h - b.h);
    });
    if (today?.hourly){
      const nowH = new Date().getHours();
      today.hourly.forEach(h => {
        const hh = Math.floor(Number(h.time) / 100);
        if (hh >= nowH) hours.push({ h: hh, t: Number(h.tempC), code: Number(h.weatherCode), desc: wxText(h.weatherCode, h.lang_zh?.[0]?.value || h.weatherDesc?.[0]?.value || '') });
      });
      today.hourly.slice(0, Math.max(0, 4 - hours.length)).forEach(h => {
        hours.push({ h: Math.floor(Number(h.time) / 100), t: Number(h.tempC), code: Number(h.weatherCode), desc: wxText(h.weatherCode, h.lang_zh?.[0]?.value || ''), next: true });
      });
    }
    // 用经纬度查 wttr 时会返回英文地名，若用户已知中文城市名则优先采用。
    // 注意：wttr 是「就近取站点」，边境地区常取到邻近行政区（如深圳坐标取到
    // 中国香港的 Ma Tso Lung）。用户手动选的城市名比它准，有中文名就一律用它。
    const wtName = area?.areaName?.[0]?.value || '';
    const cnName = city.name || '';
    const useCn = cnName && /[\u4e00-\u9fa5]/.test(cnName);
    // 地区串：优先用用户所在城市的省（中文，准确），否则退回 wttr 的英文并翻译
    const wtRegion = area?.region?.[0]?.value || '';
    const region = regionText(city.region || '') || regionText(wtRegion);
    // 城市名只保留市本身（去掉可能的「市 · 省」拼接），省名由 region 单独展示，
    // 否则会出现「广州 · 广东 · 广东」这种重复
    const place = String(useCn ? cnName : (wtName || cnName)).split(/\s*·\s*/)[0];
    return {
      src: 'wttr.in',
      place: place,
      region: region,
      temp: Number(cur.temp_C), feels: Number(cur.FeelsLikeC),
      code: Number(cur.weatherCode), desc: wxText(cur.weatherCode, descZh || cur.weatherDesc?.[0]?.value || ''),
      humidity: Number(cur.humidity), windK: Number(cur.windspeedKmph),
      windDir: cur.winddir16Point || '', pressure: Number(cur.pressure),
      vis: Number(cur.visibility), uv: Number(cur.uvIndex) || 0,
      precip: Number(cur.precipMM),
      obsTime: cur.observation_time || '',
      hours,
      hoursAll,
      hoursByDay,
      days: (d.weather || []).slice(0, 5).map(w => ({
        date: w.date, max: Number(w.maxtempC), min: Number(w.mintempC),
        code: Number(w.hourly?.[4]?.weatherCode ?? w.hourly?.[0]?.weatherCode ?? 113),
        desc: wxText(w.hourly?.[4]?.weatherCode ?? w.hourly?.[0]?.weatherCode, w.hourly?.[4]?.lang_zh?.[0]?.value || w.hourly?.[4]?.weatherDesc?.[0]?.value || ''),
        sunrise: w.astronomy?.[0]?.sunrise || '', sunset: w.astronomy?.[0]?.sunset || ''
      })),
      sunset: d.weather?.[0]?.astronomy?.[0]?.sunset || '',
      sunrise: d.weather?.[0]?.astronomy?.[0]?.sunrise || '',
      at: Date.now()
    };
  },

  async _om(city){
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + city.lat + '&longitude=' + city.lon +
      '&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,surface_pressure,precipitation,visibility' +
      '&hourly=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max' +
      '&timezone=auto&forecast_days=6';
    const d = await jjson(url, {}, 12000);
    const c = d.current; if (!c) throw new Error('无当前天气数据');
    const hours = [];
    const nowI = new Date();
    (d.hourly?.time || []).forEach((t, i) => {
      const dt = new Date(t);
      if (dt >= nowI && hours.length < 12) hours.push({ h: dt.getHours(), t: d.hourly.temperature_2m[i], code: d.hourly.weather_code[i], desc: '' });
    });
    // hoursAll：今天的完整逐小时序列（open-meteo 一天 24 条），供通勤天气取数。
    // 这里用「本地日期」而不是 toISOString()（那是 UTC，东八区晚 8 点后会差一天）
    const pad = n => String(n).padStart(2, '0');
    const nowD = new Date();
    const todayStr = nowD.getFullYear() + '-' + pad(nowD.getMonth() + 1) + '-' + pad(nowD.getDate());
    const mkHour = (t, i) => ({
      h: Number(String(t).slice(11, 13)),
      t: d.hourly.temperature_2m[i],
      code: d.hourly.weather_code[i],
      desc: wmoText(d.hourly.weather_code[i]),
      precip: d.hourly.precipitation?.[i] || 0,
      chance: 0
    });
    const hoursAll = (d.hourly?.time || []).map((t, i) => ({ t, i }))
      .filter(({ t }) => String(t).slice(0, 10) === todayStr)
      .map(({ t, i }) => mkHour(t, i)).sort((a, b) => a.h - b.h);
    // hoursByDay：按日期索引的逐小时表（open-meteo 给 6 天 × 24 小时，覆盖最全）
    const hoursByDay = {};
    (d.hourly?.time || []).forEach((t, i) => {
      const day = String(t).slice(0, 10);
      (hoursByDay[day] = hoursByDay[day] || []).push(mkHour(t, i));
    });
    Object.values(hoursByDay).forEach(arr => arr.sort((a, b) => a.h - b.h));
    const DAYNAME = ['周日','周一','周二','周三','周四','周五','周六'];
    return {
      src: 'open-meteo',
      place: city.name, region: regionText(city.region || ''),
      temp: c.temperature_2m, feels: c.apparent_temperature,
      code: c.weather_code, desc: wmoText(c.weather_code),
      humidity: c.relative_humidity_2m, windK: c.wind_speed_10m, windDir: '',
      pressure: c.surface_pressure, vis: (c.visibility || 0) / 1000, uv: d.daily?.uv_index_max?.[0] || 0,
      precip: c.precipitation || 0, obsTime: (c.time || '').slice(11, 16),
      hours,
      hoursAll,
      hoursByDay,
      days: (d.daily?.time || []).slice(0, 5).map((t, i) => ({
        date: t, max: d.daily.temperature_2m_max[i], min: d.daily.temperature_2m_min[i],
        code: d.daily.weather_code[i], desc: wmoText(d.daily.weather_code[i]),
        sunrise: fmtHM(d.daily.sunrise[i]), sunset: fmtHM(d.daily.sunset[i])
      })),
      sunrise: fmtHM(d.daily?.sunrise?.[0]), sunset: fmtHM(d.daily?.sunset?.[0]),
      at: Date.now()
    };
    function fmtHM(s){ return (s || '').slice(11, 16); }
    function wmoText(c){ return WMO_ZH[c] || '未知'; }
  },

  /**
   * 取「某天某个时刻」的天气，用于通勤卡。
   * 优先在当前数据源里找最接近的小时；找不到就退回到用日高低温估算，
   * 保证任何数据源（wttr 主 / open-meteo 备 / 缓存）都能出内容。
   * @param {object} d 天气数据
   * @param {number} hh 小时
   * @param {number} mm 分钟
   * @param {number} dayOffset 0=今天、1=明天（跨天时用 hoursByDay 取对应日期）
   * @returns {{h:number,t:number,code:number,desc:string,precip:number,est:boolean}|null}
   */
  atHour(d, hh, mm, dayOffset = 0){
    if (!d) return null;
    const target = hh + (mm || 0) / 60;
    // dayOffset=0 用 hoursAll（今日），>0 从 hoursByDay 里按日期取
    let pool = d.hoursAll || [];
    let day = d.days?.[0];
    if (dayOffset > 0){
      const dt = new Date();
      dt.setDate(dt.getDate() + dayOffset);
      const key = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
      pool = d.hoursByDay?.[key] || [];
      // 对应的日高低温也换成那一天，估算时才不会用错温度
      day = (d.days || []).find(x => String(x.date).slice(0, 10) === key) || d.days?.[dayOffset] || day;
    }
    const all = pool.filter(x => x && x.h != null);
    if (all.length){
      // 找时间上最接近的一条
      let best = all[0], gap = Infinity;
      for (const x of all){
        const g = Math.abs(x.h - target);
        if (g < gap){ gap = g; best = x; }
      }
      // 差距超过 1.5 小时就不算「这个时刻」的数据了，转用估算
      if (gap <= 1.5) return { ...best, est: false };
    }
    // 退化方案：按日高低温做一个正弦近似（最低出现在 5 点、最高出现在 14 点）
    if (!day || day.max == null || day.min == null) return null;
    const mid = (day.max + day.min) / 2, amp = (day.max - day.min) / 2;
    const t = mid + amp * Math.sin(((target - 9) / 24) * 2 * Math.PI);
    return { h: hh, t: Math.round(t * 10) / 10, code: day.code, desc: day.desc || '', precip: 0, chance: 0, est: true };
  },

  /** 生活化提示 */
  advice(d){
    if (!d) return '';
    const out = [];
    const t = d.temp, f = d.feels ?? t;
    const wet = /雨|雪|雷|毛毛/.test(d.desc);
    if (f <= 5) out.push('出门记得穿厚外套，围巾手套都用得上。');
    else if (f <= 12) out.push('有点凉，带件外套稳妥。');
    else if (f >= 33) out.push('体感偏热，多喝水、避开正午外出。');
    else if (f >= 28) out.push('天热，穿轻薄透气的衣物。');
    if (wet) out.push('有降水，伞带上，别淋着。');
    if (d.humidity >= 85 && t >= 26) out.push('湿度高、体感闷，室内注意通风。');
    if (d.humidity <= 32 && t >= 20) out.push('空气偏干，记得补水、润一下嗓子。');
    if ((d.uv || 0) >= 7) out.push('紫外线强，防晒别偷懒。');
    if ((d.windK || 0) >= 30) out.push('风不小，骑车小心些。');
    if ((d.vis || 10) <= 3) out.push('能见度低，开车放慢些。');
    const diff = d.max != null ? d.max - d.min : (d.days?.[0] ? d.days[0].max - d.days[0].min : 0);
    if (diff >= 12) out.push('昼夜温差大，早晚注意添衣。');
    if (!out.length) out.push('天气不错，适合出去走走。');
    return out.join(' ');
  },

  /** 温度→渐变色 */
  tempColor(t){
    const stops = [
      [-10, '#6b7fa8'], [0, '#5f8fb0'], [10, '#6ba3a8'], [18, '#7fae8a'],
      [24, '#c9a24a'], [30, '#d97f3f'], [36, '#c2532f']
    ];
    if (t <= stops[0][0]) return stops[0][1];
    for (let i = 0; i < stops.length - 1; i++){
      const [t0, c0] = stops[i], [t1, c1] = stops[i + 1];
      if (t <= t1){
        const k = (t - t0) / (t1 - t0);
        return lerpColor(c0, c1, k);
      }
    }
    return stops[stops.length - 1][1];
  }
};
function lerpColor(a, b, k){
  const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const [r1, g1, b1] = p(a), [r2, g2, b2] = p(b);
  const m = (x, y) => Math.round(x + (y - x) * clamp(k, 0, 1));
  return 'rgb(' + m(r1, r2) + ',' + m(g1, g2) + ',' + m(b1, b2) + ')';
}

/** 天气动态背景 —— 纯 Canvas，按天气绘制雨/雪/云/星 */
const WxCanvas = (() => {
  let raf = null, ctx = null, W = 0, H = 0, dpr = 1, parts = [], key = 'cloud', t0 = 0;
  function fit(cv){
    const r = cv.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    cv.width = Math.floor(W * dpr); cv.height = Math.floor(H * dpr);
    ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function seed(k){
    parts = [];
    const n = k === 'rain' || k === 'storm' ? 90 : k === 'snow' ? 60 : k === 'fog' ? 6 : 26;
    for (let i = 0; i < n; i++){
      parts.push({
        x: Math.random() * W, y: Math.random() * H,
        r: Math.random() * 1.9 + .55,
        v: Math.random() * .55 + .28,
        d: Math.random() * .5 + .18,
        a: Math.random() * .34 + .1,
        l: Math.random() * 18 + 8,
        ph: Math.random() * Math.PI * 2
      });
    }
  }
  function frame(now){
    if (!ctx) return;
    const el = (now - t0) / 1000;
    ctx.clearRect(0, 0, W, H);
    const dark = document.documentElement.dataset.theme === 'dark';
    const mul = dark ? 1.5 : 1;
    if (key === 'rain' || key === 'storm'){
      ctx.strokeStyle = dark ? 'rgba(138,180,202,.42)' : 'rgba(74,113,137,.30)';
      ctx.lineWidth = 1.15; ctx.lineCap = 'round';
      parts.forEach(p => {
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.l * .22, p.y + p.l);
        ctx.stroke();
        p.y += p.v * 8; p.x -= p.v * 1.7;
        if (p.y > H + 24){ p.y = -24; p.x = Math.random() * (W + 90); }
      });
    } else if (key === 'snow'){
      ctx.fillStyle = dark ? 'rgba(233,240,245,.55)' : 'rgba(125,151,171,.42)';
      parts.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x + Math.sin(el * .8 + p.ph) * 9, p.y, p.r, 0, 6.2832);
        ctx.fill();
        p.y += p.v * 1.5;
        if (p.y > H + 8){ p.y = -8; p.x = Math.random() * W; }
      });
    } else if (key === 'sun' || key === 'partly' || key === 'moon'){
      const cx = W * .82, cy = H * .18;
      const col = key === 'moon' ? '107,118,153' : '217,150,47';
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(W, H) * .72);
      g.addColorStop(0, 'rgba(' + col + ',' + (dark ? .26 : .21) + ')');
      g.addColorStop(.45, 'rgba(' + col + ',' + (dark ? .09 : .07) + ')');
      g.addColorStop(1, 'rgba(' + col + ',0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      // 缓慢漂浮的柔光点
      ctx.fillStyle = 'rgba(255,255,255,' + (dark ? .1 : .34) + ')';
      parts.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x + Math.sin(el * .25 + p.ph) * 14, p.y + Math.cos(el * .18 + p.ph) * 10, p.r * .9, 0, 6.2832);
        ctx.fill();
      });
    } else if (key === 'fog'){
      ctx.fillStyle = dark ? 'rgba(145,138,128,.11)' : 'rgba(160,152,138,.15)';
      for (let i = 0; i < 5; i++){
        const y = H * (i / 5) + Math.sin(el * .3 + i) * 7;
        ctx.beginPath();
        ctx.ellipse(W * .5 + Math.sin(el * .16 + i * 1.7) * W * .28, y, W * .55, H * .075, 0, 0, 6.2832);
        ctx.fill();
      }
    } else {
      // cloud / 默认
      ctx.fillStyle = dark ? 'rgba(150,158,168,.09)' : 'rgba(138,144,153,.13)';
      parts.forEach(p => {
        const x = p.x + Math.sin(el * .14 + p.ph) * 28;
        ctx.beginPath();
        ctx.ellipse(x, p.y, p.r * 26 * mul, p.r * 11, 0, 0, 6.2832);
        ctx.fill();
      });
    }
    raf = requestAnimationFrame(frame);
  }
  return {
    start(cv, k){
      this.stop();
      if (!cv) return;
      fit(cv); key = k; seed(k); t0 = performance.now();
      if (matchMedia('(prefers-reduced-motion:reduce)').matches){ frame(performance.now()); cancelAnimationFrame(raf); raf = null; return; }
      raf = requestAnimationFrame(frame);
    },
    stop(){ if (raf) cancelAnimationFrame(raf); raf = null; ctx = null; },
    resize(cv){ if (cv && ctx){ fit(cv); seed(key); } }
  };
})();
