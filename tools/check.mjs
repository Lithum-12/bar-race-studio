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

console.info('\n断言 ' + n + ' 条，失败 ' + bad);
process.exit(bad ? 1 : 0);
