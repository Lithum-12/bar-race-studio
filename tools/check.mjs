/* ============================================================
 * ===== 无头渲染校验 =====
 * ============================================================
 * 给 2D context 打桩记录每次绘制，直接断言几何与文字，
 * 不需要浏览器也能验证渲染层。
 * ============================================================ */
let calls = [];
let font = '16px sans-serif';
const stack = [];

function measure(text) {
  const size = parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] || '16');
  const cjk = /[\u4e00-\u9fa5]/.test(text);
  return Math.round(String(text).length * size * (cjk ? 1 : 0.55));
}

const ctx = {
  fillStyle: '#000', strokeStyle: '#000', lineWidth: 1,
  globalAlpha: 1, textAlign: 'left', textBaseline: 'alphabetic',
  get font() { return font },
  set font(v) { font = v },
  setTransform: () => {}, clearRect: () => {},
  fillRect: (...a) => calls.push(['fillRect', ctx.fillStyle, ...a]),
  beginPath: () => {}, closePath: () => {},
  moveTo: () => {}, lineTo: () => {}, arcTo: () => {}, arc: () => {},
  roundRect: (...a) => calls.push(['roundRect', ...a]),
  fill: () => calls.push(['fill', ctx.fillStyle]),
  stroke: () => calls.push(['stroke', ctx.strokeStyle]),
  save: () => { stack.push({ font, align: ctx.textAlign, base: ctx.textBaseline }); },
  restore: () => { const s = stack.pop(); if (s) { font = s.font; ctx.textAlign = s.align; ctx.textBaseline = s.base; } },
  translate: () => {}, scale: (...a) => calls.push(['scale', ...a]),
  clip: () => {},
  drawImage: (img, x, y, w) => calls.push(['drawImage', Math.round(x), Math.round(y), w]),
  fillText: (t, x, y) => calls.push(['fillText', String(t), Math.round(x), Math.round(y), font, ctx.textAlign, ctx.fillStyle, ctx.globalAlpha]),
  measureText: t => ({ width: measure(t) }),
};

globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
/* 图标解码是异步的：onload 排到下一个宏任务，测试里 await 一次即可就绪 */
globalThis.Image = class {
  set src(v) { this._s = v; setTimeout(() => this.onload && this.onload(), 0); }
  get src() { return this._s }
};

const { createScene } = await import('../src/render.js');
const { buildChart, applyPalette } = await import('../src/series.js');
const { normalizeConfig, validateConfig } = await import('../src/config.js');
const { readFileSync } = await import('node:fs');

const canvas = { width: 1920, height: 1080, getContext: () => ctx };
const scene = createScene(canvas);

async function load(name) {
  const raw = JSON.parse(readFileSync(new URL('../config/' + name + '.json', import.meta.url), 'utf8'));
  const { errors, warnings } = validateConfig(raw);
  if (errors.length) throw new Error(name + ' 校验失败: ' + JSON.stringify(errors));
  const chart = buildChart(normalizeConfig(raw));
  applyPalette(chart);
  await new Promise(r => setTimeout(r, 5));
  return { chart, warnings };
}

/* 先把动画推到目标时刻，再清空白记录：只保留目标帧的绘制 */
function frameAt(chart, t) {
  for (let i = 0; i <= Math.ceil(t); i++) scene.draw(chart, Math.min(i, t), 1 / 60);
  calls = [];
  scene.draw(chart, t, 1 / 60);
  const colors = new Set(chart.items.map(it => it.color));
  const bars = [];
  for (let i = 0; i < calls.length - 1; i++) {
    const c = calls[i];
    /* 同一根条形会画两次 roundRect：fill 一次、裁剪条内文字再一次。只认 fill 那个 */
    if (c[0] === 'roundRect' && calls[i + 1][0] === 'fill' && colors.has(calls[i + 1][1])) {
      bars.push({ x: c[1], y: c[2], w: c[3], h: c[4] });
    }
  }
  return {
    text: calls.filter(c => c[0] === 'fillText').map(c => c[1]),
    bars,
    icons: calls.filter(c => c[0] === 'drawImage'),
    all: calls,
  };
}

let n = 0, bad = 0;
const ok = (label, cond, extra) => {
  n++;
  if (!cond) {
    bad++;
    console.error('FAIL ' + label + (extra !== undefined ? '  ' + JSON.stringify(extra) : ''));
  }
};

/* ---------- 1. 月份数据集 ---------- */
const a = await load('auto-sales');
ok('auto-sales 零提醒', a.warnings.length === 0, a.warnings);
ok('周期总数 34', a.chart.total === 34, a.chart.total);

const A = frameAt(a.chart, 20);
ok('标题渲染', A.text.includes('虚拟品牌月度销量排行'), A.text.slice(0, 2));
ok('暗背景标题用亮色字', A.all.find(x => x[0] === 'fillText' && x[1] === '虚拟品牌月度销量排行')?.[6] === '#F2EFE7');
ok('大字日期 2025年9月', A.text.includes('2025年9月'), A.text.filter(x => /年\d+月/.test(x)));
ok('单位标注', A.text.some(x => x === '单位：万辆'));
ok('条形数值带单位', A.text.some(x => /^\d[\d,]*\.\d 万辆$/.test(x)), A.text.filter(x => x.includes('万辆')).slice(0, 3));
/* topN 根在场 + 至多一根正在淡出的退出条形 */
ok('条形数 = topN（含淡出余 1）', A.bars.length >= 10 && A.bars.length <= 11, A.bars.length);
ok('条形起点一致且已为图标让位', A.bars.every(b => Math.round(b.x) === 290), A.bars.slice(0, 2).map(b => Math.round(b.x)));
ok('y 自上而下单调', A.bars.every((b, i) => i === 0 || b.y > A.bars[i - 1].y));
ok('第 1 名条形最长', A.bars[0].w >= A.bars[9].w, [Math.round(A.bars[0].w), Math.round(A.bars[9].w)]);
ok('自动徽标逐个绘制', A.icons.length >= 10 && A.icons.length <= 12, A.icons.length);

/* 入场：磐石 index 12 起有值，index 11 时插值已进场 */
ok('磐石 index10 未在场', !frameAt(a.chart, 10).text.some(x => x.startsWith('磐石')));
ok('磐石 index11 已进场', frameAt(a.chart, 11).text.some(x => x.startsWith('磐石')));
/* 退出：灵犀 index 30 起为 null，index 29 是「正在退出」的那个月 */
ok('灵犀 index28 在场', frameAt(a.chart, 28).text.some(x => x.startsWith('灵犀')));
ok('灵犀退出后消失', !frameAt(a.chart, 34).text.some(x => x.startsWith('灵犀')));

/* 大事件：2025-01 → idx 12，右下角右对齐文字堆，不再有卡片 */
const EV = frameAt(a.chart, 12);
ok('事件月画出文本', EV.text.some(x => x.includes('新品牌「磐石」入场')), EV.text.slice(-4));
ok('事件带周期标题', EV.text.some(x => /大事件$/.test(x)));
ok('事件不再画卡片（无圆点 arc）', !EV.all.some(c => c[0] === 'arc'));
const evCap = EV.all.find(c => c[0] === 'fillText' && /大事件$/.test(c[1]));
const evLine = EV.all.find(c => c[0] === 'fillText' && c[1].includes('新品牌'));
ok('事件标题右对齐', evCap?.[5] === 'right', evCap?.[5]);
ok('事件正文右对齐', evLine?.[5] === 'right', evLine?.[5]);
const px = f => parseFloat(/(\d+(?:\.\d+)?)px/.exec(f)[1]);
ok('事件正文比标题字号大', px(evLine[4]) > px(evCap[4]), [px(evCap[4]), px(evLine[4])]);
ok('事件画在日期同一右边缘', Math.abs(evLine[2] - (1920 - 54 - 10)) < 12, evLine[2]);
ok('非事件月不画事件', !frameAt(a.chart, 20).text.some(x => x.includes('大事件')));
ok('事件淡出后消失', !frameAt(a.chart, 18).text.some(x => x.includes('大事件')));

/* ---------- 1b. 日期切换动画三档 ---------- */
const dateBase = {
  title: '日期', unit: '台',
  series: [{ name: '甲', values: [1, 2, 3, 4] }, { name: '乙', values: [3, 1, 2, 4] }],
};
function dateCalls(style, t1, t2) {
  const chart = buildChart(normalizeConfig({ ...dateBase, style }));
  scene.snap();
  scene.draw(chart, t1, 1 / 60);
  calls = [];
  scene.draw(chart, t2, 1 / 60);
  return calls;
}
const dcPop = dateCalls({ dateAnim: 'pop' }, 1.4, 1.6);
ok('pop：切换帧有放大缩放', dcPop.some(c => c[0] === 'scale' && c[1] > 1), dcPop.filter(c => c[0] === 'scale'));
ok('pop：日期文字全不透明', dcPop.find(c => c[0] === 'fillText' && /年\d+月$/.test(c[1]))?.[7] === 1);
const dcFade = dateCalls({ dateAnim: 'fade' }, 1.4, 1.6);
ok('fade：切换帧日期半透明', dcFade.find(c => c[0] === 'fillText' && /年\d+月$/.test(c[1]))?.[7] < 0.5,
  dcFade.find(c => c[0] === 'fillText' && /年\d+月$/.test(c[1]))?.[7]);
ok('fade：不缩放', !dcFade.some(c => c[0] === 'scale'));
const dcNone = dateCalls({ dateAnim: 'none' }, 1.4, 1.6);
ok('none：既不缩放也不透明度过渡', !dcNone.some(c => c[0] === 'scale')
  && dcNone.find(c => c[0] === 'fillText' && /年\d+月$/.test(c[1]))?.[7] === 1);
ok('none：日期文字仍然画出', dcNone.some(c => c[0] === 'fillText' && /年\d+月$/.test(c[1])));

/* ---------- 2. 负值 + 季度 ---------- */
const b = await load('net-change');
ok('net-change 只报中途断档', b.warnings.length === 1
  && b.warnings[0].path === 'series[4].values[1]', b.warnings);
ok('季度标签 2025年Q3', frameAt(b.chart, 6).text.includes('2025年Q3'));
const B = frameAt(b.chart, 6);
/* 零轴位置按当前动画中的轴域算，别写死数字 */
const dom = b.chart.domain;
const unitW = (1470 - 230) / (dom.hi - dom.lo);
const zero = 230 - dom.lo * unitW;
ok('轴域跨零', dom.lo < 0 && dom.hi > 0, [Math.round(dom.lo), Math.round(dom.hi)]);
ok('零轴左侧有条形', B.bars.some(r => r.x < zero - 5), { zero: Math.round(zero) });
ok('正值条形从零轴向右生长', B.bars.some(r => Math.abs(r.x - zero) < 2 && r.w > 5),
  B.bars.slice(0, 4).map(r => [Math.round(r.x), Math.round(r.w)]));
ok('负值文本带负号', B.text.some(x => /^-\d/.test(x)), B.text.filter(x => x.startsWith('-')).slice(0, 2));
ok('负值条形右边缘贴零轴', B.bars.filter(r => r.x < zero - 5).every(r => Math.abs(r.x + r.w - zero) < 2),
  B.bars.filter(r => r.x < zero - 5).slice(0, 2).map(r => [Math.round(r.x), Math.round(r.w)]));
ok('iconPos=none 时不画图标', B.icons.length === 0, B.icons.length);

/* ---------- 3. 年粒度 + 自定义 SVG ---------- */
const c = await load('city-population');
ok('city 零提醒', c.warnings.length === 0, c.warnings);
const C = frameAt(c.chart, 5);
ok('年粒度标签 2020年', C.text.includes('2020年'), C.text.filter(x => /年$/.test(x)));
ok('年数据集条形数（含淡出）', C.bars.length >= 10 && C.bars.length <= 11, C.bars.length);
ok('自定义 SVG 与徽标混合绘制', C.icons.length > 0, C.icons.length);
ok('亮背景按配置色填充', C.all.some(x => x[0] === 'fillRect' && x[1] === '#F4F1EA'),
  C.all.filter(x => x[0] === 'fillRect').slice(0, 2));
ok('亮背景标题用深色墨', C.all.find(x => x[0] === 'fillText' && x[1] === '十个城市常住人口变化')?.[6] === '#1C1B19',
  C.all.find(x => x[0] === 'fillText' && x[1] === '十个城市常住人口变化')?.[6]);

/* ---------- 4. 边界 ---------- */
const edge = buildChart(normalizeConfig({
  title: '边界', unit: '台',
  series: [{ name: '独苗', values: [5, 5] }, { name: '全程缺席', values: [null, null] }],
}));
await new Promise(r => setTimeout(r, 5));
const E = frameAt(edge, 1);
ok('单条目不崩', E.text.includes('独苗'), E.text.slice(0, 4));
ok('全 null 条目不显示', !E.text.includes('全程缺席'));
ok('零轴不重合（除零保护）', E.bars.length === 1 && Number.isFinite(E.bars[0].w), E.bars);

const narrow = buildChart(normalizeConfig({
  title: '窄', unit: '台',
  series: [{ name: '很长的品牌名称测试', values: [900, 1200] }, { name: '乙', values: [800, 1100] }],
  layout: { canvas: { width: 640, height: 360 }, design: { width: 640, height: 360 }, plot: { left: 60, right: 560, top: 90, bottom: 320 } },
}));
await new Promise(r => setTimeout(r, 5));
canvas.width = 640; canvas.height = 360;
const N = frameAt(narrow, 1);
canvas.width = 1920; canvas.height = 1080;
ok('窄画布仍画出名称', N.text.some(x => x.includes('很长')), N.text);
ok('窄画布数值仍在', N.text.some(x => x.includes('台')), N.text.filter(x => x.includes('台')));

/* ---------- 5. 节奏模型 ---------- */
{
  const { createClock } = await import('../src/anim.js');
  const clk = createClock();
  clk.total = 10;
  clk.perPeriod = 2;
  clk.playing = true;
  clk.tick(1);
  ok('每周期 2 秒：过 1 秒走 0.5 个周期', Math.abs(clk.t - 0.5) < 1e-9, clk.t);
  ok('预计总时长 = 周期数 × 每周期秒数', clk.seconds === 20, clk.seconds);
  clk.perPeriod = 0.5;
  clk.tick(1);
  ok('改节奏后立刻生效', Math.abs(clk.t - 2.5) < 1e-9, clk.t);

  const legacy = validateConfig({ title: 'x', series: [{ name: '甲', values: [1, 2] }], style: { duration: 30 } });
  ok('旧 duration 不报错但给迁移提醒', legacy.errors.length === 0
    && legacy.warnings.some(w => w.path === 'style.duration'), legacy.warnings);
  ok('secondsPerPeriod 生效',
    normalizeConfig({ series: [{ name: '甲', values: [1, 2] }], style: { secondsPerPeriod: 1.2 } }).style.secondsPerPeriod === 1.2);
  ok('默认节奏 1 秒/周期',
    normalizeConfig({ series: [{ name: '甲', values: [1, 2] }] }).style.secondsPerPeriod === 1);
  const tooFast = validateConfig({ title: 'x', series: [{ name: '甲', values: [1, 2] }], style: { secondsPerPeriod: 0.01 } });
  ok('每周期秒数过小被拒', tooFast.errors.some(e => e.path === 'style.secondsPerPeriod'), tooFast.errors);
}

/* ---------- 6. 表格导入：CSV/TSV/剪贴板 ---------- */
{
  const { tableToConfig, sniffDelimiter, parseNumber, sniffGranularity } = await import('../src/table.js');

  ok('制表符分隔识别为 TSV', sniffDelimiter('名称\t2024\t2025\n甲\t1\t2') === '\t');
  ok('分号分隔识别', sniffDelimiter('名称;2024;2025\n甲;1;2') === ';');

  const wide = tableToConfig('名称,2024,2025,2026\n云帆,12,15,18\n星辰,20,14,9', '销量');
  ok('宽表解析出两条 series', wide.cfg && wide.cfg.series.length === 2, wide);
  ok('宽表粒度=年、起点=2024', wide.cfg && wide.cfg.time.granularity === 'year' && wide.cfg.time.start === '2024', wide.cfg && wide.cfg.time);
  ok('宽表数值按列序展开', wide.cfg && wide.cfg.series[0].values.join(',') === '12,15,18', wide.cfg && wide.cfg.series[0]);
  ok('宽表标题取文件名', wide.cfg && wide.cfg.title === '销量');
  ok('宽表产出能过既有校验', (() => {
    const v = validateConfig(wide.cfg);
    return v.errors.length === 0;
  })(), validateConfig(wide.cfg).errors);

  const tsv = tableToConfig('名称\t2024\t2025\r\n甲\t1,712\t1,803\r\n乙\t\t900', '粘贴的表格');
  ok('剪贴板千分位被吃掉', tsv.cfg && tsv.cfg.series[0].values[0] === 1712, tsv.cfg && tsv.cfg.series[0]);
  ok('空格子当作没有数据（入场/退场语义）',
    tsv.cfg && tsv.cfg.series[1].values[0] === null && tsv.cfg.series[1].values[1] === 900, tsv.cfg && tsv.cfg.series[1]);

  const long = tableToConfig('名称,周期,数值\n甲,2025-02,7\n乙,2025-01,5\n甲,2025-01,4\n乙,2025-03,9', '长表');
  ok('长表按周期排序展开', long.cfg && long.cfg.time.start === '2025-01' && long.cfg.time.granularity === 'month', long.cfg && long.cfg.time);
  ok('长表缺的周期补成 null 而不是 0',
    long.cfg && long.cfg.series[0].values.join(',') === '4,7,', long.cfg && long.cfg.series[0]);
  ok('长表第二条对齐到同一周期轴',
    long.cfg && long.cfg.series[1].values.join(',') === '5,,9', long.cfg && long.cfg.series[1]);

  const q = tableToConfig('城市,2024Q1,2024Q2\n甲,1,2', '季度表');
  ok('季度表头识别为 quarter', q.cfg && q.cfg.time.granularity === 'quarter' && q.cfg.time.start === '2024-Q1', q.cfg && q.cfg.time);
  const d = tableToConfig('城市,2024/1/5,2024/1/6\n甲,1,2', '日表');
  ok('斜杠日期识别为 day', d.cfg && d.cfg.time.granularity === 'day' && d.cfg.time.start === '2024-1-5', d.cfg && d.cfg.time);
  const cn = sniffGranularity(['2024年', '2025年', '2026年']);
  ok('中文年月写法归一到 year', cn === 'year', cn);

  ok('小数位从表里推断', tableToConfig('名称,2024,2025\n甲,1.25,2.5', 'x').cfg.time.decimals === 2,
    tableToConfig('名称,2024,2025\n甲,1.25,2.5', 'x').cfg.time);

  const unitish = tableToConfig('名称,2024,2025\n甲,1,712万', '带单位');
  ok('带「万」的格子报错而不是猜量级',
    !unitish.cfg || unitish.problems.some(p => /万|单位/.test(p.message)), unitish.problems);
  ok('纯数字判定：负值和小数都算数', parseNumber('-40.5').value === -40.5 && parseNumber('—').value === null);

  const junk = tableToConfig('名称,备注,负责人\n甲,ok,张三', '不是数据表');
  ok('表头不是周期时给可操作的提示', !junk.cfg && junk.problems[0].message.includes('宽表'), junk.problems);

  const dup = tableToConfig('名称,2024,2025\n甲,1,2\n甲,3,4', '重名');
  ok('重名条目报出来', dup.problems.some(p => p.message.includes('两次')), dup.problems);

  const oneLine = tableToConfig('名称,2024\n甲,1', '单年表');
  ok('只有一个周期也能载入（不报错）', !!oneLine.cfg && oneLine.cfg.series[0].values.length === 1, oneLine);
  ok('只有一行内容算失败', (() => {
    const r = tableToConfig('名称,2024,2025', '空表');
    return !r.cfg && r.problems[0].message.includes('行');
  })());

  const bom = tableToConfig('﻿名称,2024,2025\r\n甲,1,2\r\n', 'BOM 表');
  ok('BOM + CRLF + 尾随空行不影响解析', bom.cfg && bom.cfg.series[0].name === '甲' && bom.cfg.series[0].values.join() === '1,2', bom);

  const quoted = tableToConfig('名称,2024,2025\n"云帆,华东",1,2', '引号');
  ok('引号内的逗号不当成分隔符', quoted.cfg && quoted.cfg.series[0].name === '云帆,华东', quoted.cfg && quoted.cfg.series[0]);

  /* 闭环：表格解析出来的配置要真能走到画布，不只是过校验 */
  {
    const ch = buildChart(normalizeConfig(tsv.cfg));
    applyPalette(ch);
    await new Promise(r => setTimeout(r, 5));
    calls = [];
    scene.draw(ch, 1, 1 / 60, {});
    const texts = calls.filter(c => c[0] === 'fillText').map(c => String(c[1]));
    const bars = calls.filter(c => c[0] === 'roundRect').length;
    ok('表格产出的配置真能画到画布上',
      texts.includes('甲') && texts.includes('乙') && bars >= 2, { texts: texts.slice(0, 10), bars });
    ok('表里的空格子中转成「晚入场」而不是 0',
      ch.items.some(it => it.name === '乙' && it.values[0] === null && it.values[1] === 900),
      ch.items.map(it => it.name + ':' + it.values.join('/')));
  }
}

/* ---------- 7. 样式模板：JSON 只套观感，不动数据 ---------- */
{
  const { validateStyleTemplate, applyStyleTemplate, lookOf } = await import('../src/config.js');
  const { readFileSync } = await import('node:fs');
  const tplRaw = JSON.parse(readFileSync(new URL('../examples/全球手机销量统计图.样式.json', import.meta.url), 'utf8'));
  const tpl = validateStyleTemplate(tplRaw);
  ok('随表的样式模板本身没有错误', tpl.errors.length === 0, tpl.errors);
  ok('模板带出 unit / title / decimals',
    tpl.look.unit === '千台' && tpl.look.title === '全球手机销量统计图' && tpl.look.decimals === 0, tpl.look);

  /* 模板配的是手机那张表，就用手机表的数据来验（配错数据集另有断言） */
  const phoneCsv = readFileSync(new URL('../examples/全球手机销量统计图.csv', import.meta.url), 'utf8');
  const { tableToConfig } = await import('../src/table.js');
  const phone = normalizeConfig(tableToConfig(phoneCsv, '手机').cfg);
  const merged = applyStyleTemplate(phone, tpl.look);
  ok('套用后样式生效', merged.style.topN === 12 && merged.style.secondsPerPeriod === 0.35
    && merged.style.dateAnim === 'fade' && merged.layout.plot.left === 252, merged.style);
  ok('套用不动原配置：phone.series 那组对象没被加颜色',
    phone.series.every(s => s.color === undefined && s.icon === undefined), phone.series[0]);
  ok('套用后数值数组仍是同一批（没复制没改写）',
    merged.series.every((s, i) => s.values === phone.series[i].values), 'values 换了引用');
  ok('套用后 events 换成模板的 8 条', merged.events.length === 8 && merged.events !== phone.events, merged.events.length);
  ok('套用后数值一根没动',
    merged.series[0].values === phone.series[0].values && merged.series.length === phone.series.length);
  ok('配对正确的模板套上去后仍是合法完整配置',
    validateConfig(merged).errors.length === 0, validateConfig(merged).errors.slice(0, 3));
  ok('套用不动时间轴：粒度与起点跟着数据',
    merged.time.granularity === phone.time.granularity && merged.time.start === phone.time.start, merged.time);
  ok('品牌覆盖真的落到 series 上',
    merged.series.filter(s => s.icon).length === 12 && merged.series.find(s => s.name === '三星').color === '#1B3B8B',
    merged.series.filter(s => s.icon).length);
  /* 拿手机时间线的模板去套 2024 年只 35 期的表，必须被整体校验拦下 */
  const base = normalizeConfig(JSON.parse(readFileSync(new URL('../config/auto-sales.json', import.meta.url), 'utf8')));
  const mismatch = validateConfig(applyStyleTemplate(base, tpl.look));
  ok('模板和数据时间线不匹配时报错而不是静默画歪',
    mismatch.errors.length >= 1 && mismatch.errors.every(e => e.path.startsWith('events')),
    mismatch.errors.slice(0, 2));

  /* 模板没写的键不该用默认值顶掉现状 */
  const partial = validateStyleTemplate({ style: { bg: '#FFFFFF' } });
  const m2 = applyStyleTemplate(base, partial.look);
  ok('只写 bg 的模板不会重置 topN 和节奏',
    m2.style.bg === '#FFFFFF' && m2.style.topN === base.style.topN
    && m2.style.secondsPerPeriod === base.style.secondsPerPeriod, m2.style);
  ok('部分 layout 深合并，其余键保留',
    (() => {
      const only = applyStyleTemplate(base, lookOf({ layout: { plot: { left: 300 } } }));
      return only.layout.plot.left === 300 && only.layout.plot.right === base.layout.plot.right;
    })(), applyStyleTemplate(base, lookOf({ layout: { plot: { left: 300 } } })).layout.plot);

  const withData = validateStyleTemplate({ style: { topN: 8 }, series: [{ name: '甲', values: [1, 2] }] });
  ok('模板里写 series 会被拒并说清原因',
    withData.errors.some(e => e.path === 'series' && e.message.includes('数据')), withData.errors);
  ok('同一个键不会既报 error 又报「不认识的字段」',
    !withData.warnings.some(w => w.path === 'series'), withData.warnings);
  const withTime = validateStyleTemplate({ time: { granularity: 'year' }, unit: '台' });
  ok('模板里写粒度/起点会被拒（只有 decimals 可带）',
    withTime.errors.some(e => e.path === 'time' && e.message.includes('decimals')), withTime.errors);
  ok('空模板被拒', validateStyleTemplate({}).errors.length === 1);
  ok('模板复用同一套观感校验：topN 越界照样报错',
    validateStyleTemplate({ style: { topN: 99 } }).errors.some(e => e.path === 'style.topN'),
    validateStyleTemplate({ style: { topN: 99 } }).errors);
  ok('模板里的未知字段给提醒不给错误',
    validateStyleTemplate({ style: { topN: 8 }, hue: 3 }).warnings.some(w => w.path === 'hue'),
    validateStyleTemplate({ style: { topN: 8 }, hue: 3 }));

  /* 品牌覆盖：CSV 出数据、JSON 出颜色和 logo，靠名字对上 */
  const LOGO = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="8"/></svg>';
  const withBrands = normalizeConfig({
    time: { granularity: 'year', start: '2020' },
    series: [{ name: '甲', values: [1, 2, 3] }, { name: '乙', values: [4, 5, 6] }],
    brands: { 甲: { color: '#111111', icon: LOGO } },
  });
  ok('brands 按名字挂上 color 和 icon',
    withBrands.series[0].color === '#111111' && withBrands.series[0].icon === LOGO, withBrands.series[0]);
  ok('没点名的品牌原样不动', withBrands.series[1].color === undefined && withBrands.series[1].icon === undefined,
    withBrands.series[1]);
  ok('brands 不原地改用户给的数组',
    (() => {
      const raw = { series: [{ name: '甲', values: [1, 2] }] };
      normalizeConfig({ time: { granularity: 'year', start: '2020' }, series: raw.series, brands: { 甲: { color: '#222222' } } });
      return raw.series[0].color === undefined;
    })());
  const badName = validateConfig({
    time: { granularity: 'year', start: '2020' },
    series: [{ name: '甲', values: [1, 2, 3] }],
    brands: { 没这个牌子: { color: '#111111' } },
  });
  ok('品牌名对不上给提醒（不是静默失效）',
    badName.errors.length === 0 && badName.warnings.some(w => w.path === 'brands.没这个牌子'), badName.warnings);
  const badColor = validateConfig({
    time: { granularity: 'year', start: '2020' },
    series: [{ name: '甲', values: [1, 2, 3] }],
    brands: { 甲: { color: '黑色' } },
  });
  ok('brands 里的非法颜色照样报错', badColor.errors.some(e => e.path === 'brands.甲.color'), badColor.errors);

  /* 模板带标注：events 和 brands 允许，series 仍然拒 */
  const anno = validateStyleTemplate({
    style: { topN: 6 },
    events: [{ period: '2024-03', text: '放量' }],
    brands: { 甲: { color: '#111111' } },
  });
  ok('模板可以带 events 和 brands', anno.errors.length === 0
    && anno.look.events.length === 1 && anno.look.brands.甲.color === '#111111', anno.errors);
  const cur = normalizeConfig({
    time: { granularity: 'month', start: '2024-01' },
    series: [{ name: '甲', values: [1, 2, 3] }, { name: '乙', values: [3, 2, 1] }],
    events: [{ period: '2024-01', text: '旧标注' }],
  });
  const applied = applyStyleTemplate(cur, anno.look);
  ok('套用后 events 换成模板的、数值一根没动',
    applied.events.length === 1 && applied.events[0].text === '放量'
    && applied.series[0].values === cur.series[0].values && applied.series[1].values === cur.series[1].values,
    applied.events);
  ok('套用后品牌色挂上了', applied.series[0].color === '#111111' && applied.series[1].color === undefined,
    applied.series.map(s => s.color));
  ok('只有 brands 的模板不算空模板', validateStyleTemplate({ brands: { 甲: { color: '#111111' } } }).errors.length === 0);

  /* 上一轮那个 bug：指定了 color 就不该丢自动圆牌徽标 */
  {
    const ch = buildChart(normalizeConfig({
      time: { granularity: 'year', start: '2020' },
      series: [{ name: '钉了色', values: [1, 2], color: '#C2185B' }, { name: '自动的', values: [2, 1] }],
    }));
    applyPalette(ch);
    await new Promise(r => setTimeout(r, 5));
    const pinned = ch.items.find(it => it.name === '钉了色');
    const auto = ch.items.find(it => it.name === '自动的');
    ok('指定 color 的品牌仍有自动徽标',
      !!ch.icons.get(pinned.idx) && ch.icons.get(pinned.idx).src.startsWith('data:image/svg'), ch.icons.get(pinned.idx));
    ok('自动徽标用的是这个品牌自己的颜色',
      ch.icons.get(pinned.idx).src.includes(encodeURIComponent('#C2185B')), decodeURIComponent(ch.icons.get(pinned.idx).src));
    ok('没指定颜色的仍走配色方案',
      auto.color === '#3B6FE0' || /^#[0-9a-f]{6}$/i.test(auto.color), auto.color);
  }
}

console.info('\n断言 ' + n + ' 条，失败 ' + bad);
process.exit(bad ? 1 : 0);
