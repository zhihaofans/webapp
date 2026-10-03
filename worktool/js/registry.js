/* ============================================================
   registry.js — 工具注册表
   侧拉栏的分组、每个工具的名称/图标/描述都定义在这里（单一数据源）。
   tools/*.js 只负责把「渲染实现」注册进来，实现与元数据分离。

   新增一个工具 = 在 GROUPS 里加一行 + 在 TOOLS 里补一条 + 在
   js/tools/ 下加一个文件，侧拉栏、概览页、路由会自动出现，无需改其它地方。
   ============================================================ */
(function (T) {
  'use strict';

  T.GROUPS = [
    { id: 'image', name: '图像处理', desc: '压缩、转格式、裁剪' },
    { id: 'dev', name: '开发工具', desc: '链接、镜像、资源' },
    { id: 'text', name: '文本处理', desc: '统计、清洗、对比' },
    { id: 'calc', name: '计算换算', desc: '单位、日期、比例' },
    { id: 'life', name: '日常助手', desc: '记账、打卡、提醒' }
  ];

  /* status: ready = 已实现；soon = 已在路线图、尚未实现 */
  T.TOOLS = {
    'image2webp': {
      id: 'image2webp', group: 'image', name: '图片转 WebP', icon: 'image',
      status: 'ready',
      sub: '批量转换 · 本地处理不上传',
      desc: '把 PNG / JPG / GIF 等图片转成体积更小的 WebP，可调质量与最长边，支持批量与拖拽。',
      tags: ['批量', '不上传', '可调质量']
    },
    'image-compress': {
      id: 'image-compress', group: 'image', name: '图片压缩', icon: 'compress',
      status: 'soon',
      sub: '在保持观感的前提下减小体积',
      desc: '按目标体积或百分比压缩图片，输出前可并排对比原图，避免压糊。',
      plan: ['按目标 KB 反推质量', '压缩前后并排对比', '元数据一键剥离']
    },
    'image-crop': {
      id: 'image-crop', group: 'image', name: '裁剪与旋转', icon: 'crop',
      status: 'soon',
      sub: '常用比例一键裁切',
      desc: '按 1:1 / 4:3 / 16:9 等常用比例裁切，支持自由旋转与水平镜像。',
      plan: ['常用比例预设', '自由旋转与镜像', '批量套用同一裁剪框']
    },

    'github2jsdelivr': {
      id: 'github2jsdelivr', group: 'dev', name: 'GitHub 转 jsDelivr', icon: 'link',
      status: 'ready',
      sub: '批量生成 CDN 镜像链接',
      desc: '把 GitHub 的 blob / raw / tree 链接批量转成 jsDelivr CDN 地址，可校验版本、补全短 hash，一键复制。',
      tags: ['批量', '支持校验版本', '一键复制']
    },

    'text-count': {
      id: 'text-count', group: 'text', name: '文本统计', icon: 'count',
      status: 'soon',
      sub: '字数、行数、字符分布',
      desc: '粘贴一段文字，即时给出字数、行数、段落数与字符分布，按输入实时计算。',
      plan: ['中英文分别计数', '标点与空格分布', '字数上限进度提示']
    },
    'text-case': {
      id: 'text-case', group: 'text', name: '大小写与编码', icon: 'text',
      status: 'soon',
      sub: '命名风格互转',
      desc: '驼峰 / 下划线 / 短横线等命名风格互转，以及 URL 编码与转义还原。',
      plan: ['命名风格互转', 'URL 编解码', 'JSON 转义与反转义']
    },
    'text-diff': {
      id: 'text-diff', group: 'text', name: '文本对比', icon: 'copy',
      status: 'soon',
      sub: '两段文字找差异',
      desc: '把两段文本贴进来，逐行标出新增、删除与改动。',
      plan: ['逐行差异高亮', '忽略空白与大小写', '差异结果可复制']
    },

    'calc-unit': {
      id: 'calc-unit', group: 'calc', name: '单位换算', icon: 'convert',
      status: 'soon',
      sub: '长度、重量、面积、温度',
      desc: '常用单位之间即时换算，输入即出结果，无需点击计算。',
      plan: ['长度 / 重量 / 面积 / 体积', '温度与速度', '自定义换算系数']
    },
    'calc-date': {
      id: 'calc-date', group: 'calc', name: '日期天数计算', icon: 'clock',
      status: 'soon',
      sub: '相隔天数与倒推日期',
      desc: '算两个日期相隔多少天，或从某天往前 / 往后推 N 天。',
      plan: ['日期间隔（含工作日）', '日期加减天数', '常用纪念日倒计时']
    },
    'calc-ratio': {
      id: 'calc-ratio', group: 'calc', name: '比例与百分比', icon: 'calculator',
      status: 'soon',
      sub: '折扣、涨幅、分摊',
      desc: '百分比增减、折扣换算、多人分摊与等比缩放。',
      plan: ['涨跌幅与占比', '折扣与到手价', '按比例分摊金额']
    },

    'life-ledger': {
      id: 'life-ledger', group: 'life', name: '日常记账', icon: 'wallet',
      status: 'soon',
      sub: '收支与月度小结',
      desc: '随手记一笔收支，按月汇总分类占比。支出用红、收入用绿。',
      plan: ['分类收支与备注', '月度分布图', '导出 CSV']
    },
    'life-habit': {
      id: 'life-habit', group: 'life', name: '习惯打卡', icon: 'check',
      status: 'soon',
      sub: '连续天数与完成率',
      desc: '多个习惯一排格子的打卡矩阵，看连续天数和近 7 天完成率。',
      plan: ['多习惯打卡矩阵', '连续天数统计', '近 7 天完成率']
    },
    'life-timer': {
      id: 'life-timer', group: 'life', name: '提醒与倒计时', icon: 'hourglass',
      status: 'soon',
      sub: '纪念日与截止日',
      desc: '给重要日子做倒计时，打开页面就能看到还剩多少天。',
      plan: ['纪念日倒计时', '截止日提醒', '首页置顶展示']
    }
  };

  /* 工具实现注册表：id → { render(host, tool), onLeave() } */
  var impls = {};

  T.register = function (id, impl) {
    /* '_' 开头的是内部视图（如概览），不属于工具箱清单，不提示 */
    if (id.charAt(0) !== '_' && !T.TOOLS[id]) {
      console.warn('[注册] 未在 TOOLS 中登记的工具：' + id);
    }
    impls[id] = impl || {};
    return T.TOOLS[id] || null;
  };

  T.getImpl = function (id) { return impls[id] || null; };

  T.findTool = function (id) { return T.TOOLS[id] || null; };

  /* 按分组展开：[{ group, tools: [...] }] —— 侧拉栏与概览页共用同一份结果 */
  T.toolTree = function () {
    return T.GROUPS.map(function (g) {
      return {
        group: g,
        tools: Object.keys(T.TOOLS)
          .map(function (k) { return T.TOOLS[k]; })
          .filter(function (t) { return t.group === g.id; })
      };
    }).filter(function (x) { return x.tools.length; });
  };

  T.readyCount = function () {
    return Object.keys(T.TOOLS).filter(function (k) { return T.TOOLS[k].status === 'ready'; }).length;
  };
  T.totalCount = function () { return Object.keys(T.TOOLS).length; };

  /* 路由：'#/image2webp' → 'image2webp' */
  T.routeOf = function (id) { return '#/' + id; };

})(window.Toolbox);
