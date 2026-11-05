/* ============================================================
 * ===== 应用装配 =====
 * ============================================================
 * 配置文件是唯一真相：页面上的调整即时生效但不落盘，
 * 想留就「写回文件」（本地服务）或「下载配置」（其他场景）。
 * ============================================================ */

import {
  validateConfig, normalizeConfig, POS_KEYS, VALUE_POS, ICON_POS,
  BAR_SHAPES, EXPORT_FORMATS, DATE_ANIMS, DEFAULT_STYLE, DEFAULT_LAYOUT, DEFAULT_EXPORT,
} from './config.js';
import { buildChart, applyPalette, periodIndex } from './series.js';
import { createScene } from './render.js';
import { createClock } from './anim.js';
import { periodLabel, periodKey, periodTick, parseStart, startHint, GRANULARITIES, GRAN_LABEL } from './time.js';
import { FONTS, FONT_SCALE_KEYS } from './text.js';
import { PALETTES, BG_PRESETS, normalizeHex } from './color.js';
import { setOptions } from './select.js';
import { exportVideo, exportPngSequence, exportStill, download } from './recorder.js';

const $ = id => document.getElementById(id);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const num = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const POS_TEXT = { outL: '条外左侧', inL: '条内左侧', inR: '条内右侧', outR: '条外右侧' };
const SHAPE_TEXT = { none: '直角', small: '小圆角', large: '大圆角', pill: '胶囊' };
const FONT_TEXT = { sans: '黑体（默认）', serif: '宋体 · 衬线', kai: '楷体', mono: '等宽', hei: '思源黑体' };
const SCALE_TEXT = { 0.82: '小', 1: '标准', 1.2: '大' };
const FMT_TEXT = { webm: 'WebM 视频', mp4: 'MP4 视频', 'png-seq': 'PNG 序列帧' };
const DATE_ANIM_TEXT = { pop: '轻微弹跳', fade: '渐显', none: '无动画' };
/* 走带条上的粗档位；精确值在设置里填 */
const PACE_OPTS = [0.5, 0.7, 0.9, 1.2, 1.6, 2.2, 3];
const TOPN_OPTS = [5, 8, 10, 12, 15, 20, 25, 30];


/* ---------- 运行环境与数据源 ---------- */
function serverSource() {
  const url = name => './api/configs/' + encodeURIComponent(name);
  return {
    kind: 'server',
    list: async () => (await (await fetch('./api/configs')).json()),
    read: async name => {
      const r = await fetch(url(name));
      if (!r.ok) throw new Error('读取 ' + name + ' 失败（HTTP ' + r.status + '）');
      return r.json();
    },
    write: async (name, text) => {
      const r = await fetch(url(name), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: text,
      });
      if (!r.ok) throw new Error((await r.text()) || ('写入失败（HTTP ' + r.status + '）'));
    },
  };
}

function inlineSource() {
  const bag = window.__INLINE_CONFIG__;
  return {
    kind: 'inline',
    list: () => Promise.resolve(Object.keys(bag).map(name => ({ name }))),
    read: name => Promise.resolve(bag[name]),
    write: () => Promise.reject(new Error('单文件版无法写盘，请用「下载配置」')),
  };
}

function fileSource(reason) {
  return {
    kind: 'file',
    list: () => Promise.resolve([]),
    read: () => Promise.reject(reason),
    write: () => Promise.reject(reason),
  };
}

async function detectSource() {
  if (window.__INLINE_CONFIG__) return inlineSource();
  if (location.protocol.startsWith('http')) {
    try {
      const res = await fetch('./api/configs');
      if (res.ok) return serverSource();
    } catch (e) {
      /* 端口上可能是别的服务，回落到手导模式 */
    }
  }
  return fileSource(new Error('本地页面无法自动读取同目录文件'));
}

/* ---------- 应用状态 ---------- */
const app = {
  chart: null,
  clock: createClock(),
  scene: null,
  src: fileSource(new Error('尚未初始化')),
  dataset: null,
  dirNames: [],
  session: new Map(),
  busy: null,
  cancel: null,
  selfWrite: null,
};

function resetMotion() {
  for (const it of app.chart.items) it.init = false;
  app.chart.domainAnim = null;
  app.scene.snap();
}

function setBusy(kind, pct) {
  app.busy = kind;
  if (kind) {
    document.body.dataset.busy = kind;
    $('busyKind').textContent = kind;
    if (pct !== undefined) $('busyPct').textContent = Math.round(pct * 100) + '%';
  } else {
    delete document.body.dataset.busy;
  }
  $('work').classList.toggle('hidden', !kind);
}

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
}

function showIssues(errors, warnings) {
  const box = $('issues');
  box.textContent = '';
  const add = (list, cls) => {
    for (const x of list) {
      const row = el('div', 'issue ' + cls);
      row.appendChild(el('code', null, x.path));
      row.appendChild(el('span', null, x.message));
      box.appendChild(row);
    }
  };
  add(errors, 'error');
  add(warnings || [], 'warn');
}

/* ---------- 装载配置 ---------- */
function mountChart(cfg, keepTime) {
  const frac = keepTime && app.clock.total ? app.clock.t / app.clock.total : 0;
  app.chart = buildChart(cfg);
  applyPalette(app.chart);
  app.scene.size(cfg.layout.canvas.width, cfg.layout.canvas.height);
  app.clock.setTotal(app.chart.total);
  app.clock.t = frac * app.clock.total;
  app.clock.perPeriod = cfg.style.secondsPerPeriod;
  app.clock.loop = cfg.style.loop;
  resetMotion();
  buildTicks();
  syncTransport();
}

function loadRaw(raw, label, keepTime, extra) {
  const cfg = normalizeConfig(raw);
  const { errors, warnings } = validateConfig(raw);
  const shown = [...(extra || []), ...errors];
  showIssues(shown, warnings);
  if (errors.length) {
    /* 保持上一个能跑的数据集，下拉框也要跟着退回去 */
    if (app.dataset) $('datasetSel').value = app.dataset;
    toast(shown.length + ' 处配置错误，见页面下方');
    return false;
  }
  mountChart(cfg, keepTime);
  app.dataset = label;
  syncDrawer();
  if (extra && extra.length) toast(extra.length + ' 个文件没能导入，已载入 ' + label);
  else if (warnings.length) toast('已载入，另有 ' + warnings.length + ' 条提醒');
  return true;
}

async function loadDataset(name) {
  try {
    const raw = await app.src.read(name);
    loadRaw(raw, name, true);
  } catch (e) {
    toast(e.message);
  }
}

/* ---------- 时间轴刻度 ---------- */
function buildTicks() {
  const host = $('tlTicks');
  host.textContent = '';
  const chart = app.chart;
  const total = chart.total || 1;
  for (let i = 0; i <= total; i++) {
    const tk = periodTick(chart.anchor, chart.cfg.time.granularity, i);
    if (!tk) continue;
    const bar = el('i');
    if (tk.major) bar.className = 'major';
    bar.style.left = (i / total * 100) + '%';
    host.appendChild(bar);
    if (tk.text) {
      const s = el('span', null, tk.text);
      s.style.left = (i / total * 100) + '%';
      host.appendChild(s);
    }
  }
}

function fmtSeconds(s) {
  return s >= 60 ? Math.floor(s / 60) + ' 分 ' + Math.round(s % 60) + ' 秒'
    : Math.round(s * 10) / 10 + ' 秒';
}

/* 节奏有两个入口：走带条的粗档和设置里的精确值，动哪边都要把两边与预计时长一起同步 */
function syncPace() {
  const v = app.chart.cfg.style.secondsPerPeriod;
  setOptions($('paceSel'), PACE_OPTS.map(n => [n, n + ' 秒/周期']), v);
  const inp = $('paceInp');
  if (document.activeElement !== inp) inp.value = String(v);
  const total = fmtSeconds(app.clock.total * v);
  $('paceEstimate').textContent = '约 ' + total;
  $('paceTotal').textContent = total + '（' + app.clock.total + ' 个周期）';
}

function setPace(value) {
  const v = Math.max(0.15, Math.min(8, num(value, 1)));
  app.chart.cfg.style.secondsPerPeriod = v;
  app.clock.perPeriod = v;
  syncPace();
}

function syncTransport() {
  $('loopChk').checked = app.chart.cfg.style.loop;
  syncPace();
}

function updatePlayIcon() {
  $('icPlay').style.display = app.clock.playing ? 'none' : 'block';
  $('icPause').style.display = app.clock.playing ? 'block' : 'none';
}

function togglePlay() {
  const c = app.clock;
  if (app.busy) return;
  if (!c.playing && c.t >= c.total) {
    resetMotion();
    c.t = 0;
  }
  c.playing = !c.playing;
  updatePlayIcon();
}

/* ---------- 参数修改 ---------- */
function patchStyle(key, value) {
  const cfg = app.chart.cfg;
  cfg.style[key] = value;
  if (key === 'palette') applyPalette(app.chart);
  if (key === 'loop') app.clock.loop = value;
}

function patchTime(key, value) {
  const cfg = app.chart.cfg;
  const next = { ...cfg.time, [key]: value };
  if (!parseStart(next.granularity, next.start)) {
    toast('起始周期与粒度对不上，应写成 ' + startHint(next.granularity));
    syncDrawer();
    return;
  }
  cfg.time = next;
  mountChart(cfg, true);
}

function patchCanvas(w, h) {
  const cfg = app.chart.cfg;
  cfg.layout.canvas.width = w;
  cfg.layout.canvas.height = h;
  app.scene.size(w, h);
}

function patchDesign(w, h) {
  const cfg = app.chart.cfg;
  cfg.layout.design.width = w;
  cfg.layout.design.height = h;
}

function patchExport(key, value) {
  app.chart.cfg.export[key] = value;
}

/* ---------- 两侧抽屉：设置走右，导入走左 ---------- */
let panel = null;
function setPanel(next) {
  panel = next;
  document.body.toggleAttribute('data-right', next === 'right');
  document.body.toggleAttribute('data-left', next === 'left');
  $('drawer').setAttribute('aria-hidden', String(next !== 'right'));
  $('importDrawer').setAttribute('aria-hidden', String(next !== 'left'));
  if (next === 'right') syncDrawer();
  if (next === 'left') renderImportLists();
}

function renderEvents() {
  const host = $('eventList');
  host.textContent = '';
  const evs = app.chart.cfg.events;
  if (!evs.length) {
    host.appendChild(el('div', 'none', '还没有事件'));
    return;
  }
  const rows = evs.map((ev, i) => ({ ev, i, k: periodIndex(app.chart, ev.period) }))
    .sort((a, b) => a.k - b.k);
  for (const { ev, i } of rows) {
    const row = el('div', 'ev-row');
    row.appendChild(el('time', null, String(ev.period)));
    row.appendChild(el('p', null, String(ev.text)));
    const del = el('button', null, '删');
    del.title = '删除这条事件';
    del.addEventListener('click', () => {
      app.chart.cfg.events.splice(i, 1);
      renderEvents();
    });
    row.appendChild(del);
    host.appendChild(row);
  }
}

function addEvent() {
  const cfg = app.chart.cfg;
  const p = $('evPeriod').value.trim();
  const txt = $('evText').value.trim();
  if (!p || !txt) {
    toast('周期和描述都要填');
    return;
  }
  const k = periodIndex(app.chart, p);
  if (k === null || k < 0 || k > app.chart.total) {
    toast('周期要写成 ' + startHint(cfg.time.granularity) + '，且在 '
      + periodKey(app.chart.anchor, cfg.time.granularity, 0) + ' 至 '
      + periodKey(app.chart.anchor, cfg.time.granularity, app.chart.total) + ' 之间');
    return;
  }
  cfg.events.push({ period: p, text: txt });
  $('evText').value = '';
  renderEvents();
  toast('已加到 ' + p);
}

function syncDrawer() {
  const cfg = app.chart.cfg;
  const st = cfg.style;
  $('granSel').value = cfg.time.granularity;
  $('startInp').value = cfg.time.start;
  $('startInp').placeholder = startHint(cfg.time.granularity);
  $('decSel').value = cfg.time.decimals;
  $('unitInp').value = cfg.unit;
  $('titleInp').value = cfg.title;
  $('subInp').value = cfg.subtitle;
  $('evPeriod').placeholder = startHint(cfg.time.granularity);
  $('fontSel').value = st.font;
  $('fontScaleSel').value = String(st.fontScale);
  $('namePosSel').value = st.namePos;
  $('rankPosSel').value = st.rankPos;
  $('valuePosSel').value = st.valuePos;
  $('iconPosSel').value = st.iconPos;
  $('barShapeSel').value = st.barShape;
  $('sortDirSel').value = st.sortDir;
  $('dateAnimSel').value = st.dateAnim;
  $('paletteSel').value = st.palette;
  $('gridChk').checked = st.showGrid;
  $('valueChk').checked = st.showValue;
  setOptions($('topNSel'), TOPN_OPTS.map(n => [n, '前 ' + n]), st.topN);
  syncPace();
  $('designWSel').value = cfg.layout.design.width;
  $('designHSel').value = cfg.layout.design.height;
  $('canvasWSel').value = cfg.layout.canvas.width;
  $('canvasHSel').value = cfg.layout.canvas.height;
  $('fmtSel').value = cfg.export.format;
  $('fpsSel').value = String(cfg.export.fps);
  $('exWSel').value = cfg.export.width;
  $('exHSel').value = cfg.export.height;
  $('brSel').value = cfg.export.bitrateMbps;
  $('alphaSel').checked = cfg.export.transparent;
  syncBgSelect();
  renderEvents();
}

/* ---------- 画布背景 ---------- */
const BG_PICK = '__pick';

function bgPairs() {
  const bg = String(app.chart.cfg.style.bg);
  const list = BG_PRESETS.map(p => [p.color, p.label, { color: p.color, note: p.color }]);
  if (!BG_PRESETS.some(p => p.color.toLowerCase() === bg.toLowerCase())) {
    list.push([bg, '当前颜色', { color: bg, note: bg.toUpperCase() }]);
  }
  list.push([BG_PICK, '从系统色板里挑…', null]);
  return list;
}

function syncBgSelect() {
  setOptions($('bgSel'), bgPairs(), app.chart.cfg.style.bg);
  $('bgCustom').value = normalizeHex(app.chart.cfg.style.bg) || '#121311';
}

function chooseBg(value) {
  if (value === BG_PICK) {
    $('bgCustom').click();
    return;
  }
  patchStyle('bg', value);
  syncBgSelect();
}
/* ---------- 控件构建 ---------- */
function buildControls() {
  setOptions($('granSel'), GRANULARITIES.map(g => [g, GRAN_LABEL[g]]));
  setOptions($('fontSel'), Object.keys(FONTS).map(k => [k, FONT_TEXT[k] || k]));
  setOptions($('fontScaleSel'), FONT_SCALE_KEYS.map(k => [k, SCALE_TEXT[k] || k + '×']));
  setOptions($('namePosSel'), POS_KEYS.map(k => [k, POS_TEXT[k]]));
  setOptions($('rankPosSel'), POS_KEYS.map(k => [k, POS_TEXT[k]]));
  setOptions($('valuePosSel'), VALUE_POS.map(k => [k, k === 'auto' ? '自动（放不下外移）' : POS_TEXT[k]]));
  setOptions($('iconPosSel'), ICON_POS.map(k => [k, k === 'none' ? '不显示' : POS_TEXT[k]]));
  setOptions($('barShapeSel'), BAR_SHAPES.map(k => [k, SHAPE_TEXT[k]]));
  setOptions($('sortDirSel'), [['desc', '数值大在上'], ['asc', '数值小在上']]);
  setOptions($('dateAnimSel'), DATE_ANIMS.map(k => [k, DATE_ANIM_TEXT[k]]));
  /* 配色方案用连排色条表示，比单色点更接近色样张的读法 */
  setOptions($('paletteSel'),
    Object.keys(PALETTES).map(k => [k, PALETTES[k].label, { colors: PALETTES[k].colors.slice(0, 6) }]));
  setOptions($('fmtSel'), EXPORT_FORMATS.map(k => [k, FMT_TEXT[k]]));
  setOptions($('fpsSel'), [[24, '24'], [30, '30'], [50, '50'], [60, '60']]);
  setOptions($('topNSel'), TOPN_OPTS.map(n => [n, '前 ' + n]));

  const on = (id, fn) => $(id).addEventListener('change', e => fn(e.target));
  const text = (id, fn) => $(id).addEventListener('change', e => fn(e.target.value));

  on('granSel', t => patchTime('granularity', t.value));
  text('startInp', v => patchTime('start', v.trim()));
  on('decSel', t => patchTime('decimals', Math.max(0, Math.min(4, Math.round(num(t.value, 1))))));
  text('unitInp', v => { app.chart.cfg.unit = v; });
  text('titleInp', v => { app.chart.cfg.title = v; });
  text('subInp', v => { app.chart.cfg.subtitle = v; });

  on('fontSel', t => patchStyle('font', t.value));
  on('fontScaleSel', t => patchStyle('fontScale', num(t.value, 1)));
  on('namePosSel', t => patchStyle('namePos', t.value));
  on('rankPosSel', t => patchStyle('rankPos', t.value));
  on('valuePosSel', t => patchStyle('valuePos', t.value));
  on('iconPosSel', t => patchStyle('iconPos', t.value));
  on('barShapeSel', t => patchStyle('barShape', t.value));
  on('sortDirSel', t => patchStyle('sortDir', t.value));
  on('dateAnimSel', t => patchStyle('dateAnim', t.value));
  on('paletteSel', t => patchStyle('palette', t.value));
  on('gridChk', t => patchStyle('showGrid', t.checked));
  on('valueChk', t => patchStyle('showValue', t.checked));
  on('topNSel', t => patchStyle('topN', num(t.value, 10)));
  on('paceSel', t => setPace(t.value));
  on('paceInp', t => setPace(t.value));
  on('loopChk', t => patchStyle('loop', t.checked));

  on('designWSel', t => patchDesign(num(t.value, 1920), app.chart.cfg.layout.design.height));
  on('designHSel', t => patchDesign(app.chart.cfg.layout.design.width, num(t.value, 1080)));
  on('canvasWSel', t => patchCanvas(num(t.value, 1920), app.chart.cfg.layout.canvas.height));
  on('canvasHSel', t => patchCanvas(app.chart.cfg.layout.canvas.width, num(t.value, 1080)));

  on('fmtSel', t => patchExport('format', t.value));
  on('fpsSel', t => patchExport('fps', num(t.value, 60)));
  on('exWSel', t => patchExport('width', num(t.value, 1920)));
  on('exHSel', t => patchExport('height', num(t.value, 1080)));
  on('brSel', t => patchExport('bitrateMbps', num(t.value, 12)));
  on('alphaSel', t => patchExport('transparent', t.checked));
  on('bgSel', t => chooseBg(t.value));
  /* 取色器：input 实时改色；change 收尾，用户取消时把显示拉回真实背景 */
  $('bgCustom').addEventListener('input', e => {
    patchStyle('bg', e.target.value);
    syncBgSelect();
  });
  $('bgCustom').addEventListener('change', syncBgSelect);

  $('btnSettings').addEventListener('click', () => setPanel(panel === 'right' ? null : 'right'));
  $('btnDone').addEventListener('click', () => setPanel(null));
  $('scrim').addEventListener('click', () => setPanel(null));
  $('btnReset').addEventListener('click', () => {
    const cfg = app.chart.cfg;
    cfg.style = { ...DEFAULT_STYLE };
    cfg.layout = JSON.parse(JSON.stringify(DEFAULT_LAYOUT));
    cfg.export = { ...DEFAULT_EXPORT };
    mountChart(cfg, false);
    toast('显示参数已恢复默认');
  });

  $('evAdd').addEventListener('click', addEvent);
  $('evText').addEventListener('keydown', e => {
    if (e.key === 'Enter') addEvent();
  });
}

/* ---------- 数据集与导入 ---------- */
async function refreshDatasets() {
  const rows = await app.src.list();
  const names = rows.map(r => r.name);
  const all = [...names, ...app.session.keys()];
  setOptions($('datasetSel'), all.map(n => [n, n]), app.dataset);
  const canWrite = app.src.kind === 'server';
  $('btnSave').textContent = canWrite ? '写回文件' : '下载配置';
  $('btnSave').title = canWrite
    ? '把当前配置（含页面上的调整）写回 config 里的同名文件'
    : '把当前配置下载成 JSON 文件';
  app.dirNames = names;
  renderImportLists();
  return all;
}

function rowItem(name, meta, actions) {
  const row = el('div', 'row');
  row.appendChild(el('span', 'row-name', name));
  if (meta) row.appendChild(el('span', 'row-meta', meta));
  row.appendChild(el('span', 'spacer'));
  for (const [label, cls, fn] of actions) {
    const b = el('button', 'btn sm' + (cls ? ' ' + cls : ''), label);
    b.type = 'button';
    b.addEventListener('click', fn);
    row.appendChild(b);
  }
  return row;
}

/* 左侧抽屉的两张列表：会话导入的可以移除，config 目录的只读 */
function renderImportLists() {
  const sess = $('sessionList');
  const dir = $('dirList');
  sess.textContent = '';
  dir.textContent = '';

  const keys = [...app.session.keys()];
  if (!keys.length) sess.appendChild(el('p', 'rows-empty', '还没有导入过文件'));
  for (const k of keys) {
    sess.appendChild(rowItem(k, '本次会话', [
      [k === app.dataset ? '当前' : '载入', k === app.dataset ? 'key' : '', () => loadRaw(app.session.get(k), k, false)],
      ['移除', '', () => {
        app.session.delete(k);
        refreshDatasets();
      }],
    ]));
  }

  if (app.src.kind === 'file') {
    dir.appendChild(el('p', 'rows-empty', '本地页面读不到 config 目录，用上面的拖拽区'));
    return;
  }
  const names = app.dirNames || [];
  if (!names.length) dir.appendChild(el('p', 'rows-empty', 'config 目录里没有 JSON 文件'));
  for (const n of names) {
    dir.appendChild(rowItem(n, app.src.kind === 'server' ? '可写回' : '已内联进产物', [
      [n === app.dataset ? '当前' : '载入', n === app.dataset ? 'key' : '', () => loadDataset(n)],
    ]));
  }
}

function readAsText(file) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result));
    fr.onerror = () => rej(new Error(file.name + ' 读取失败'));
    fr.readAsText(file, 'utf-8');
  });
}

async function importFiles(files) {
  const bad = [];
  let first = null;
  for (const f of files) {
    const key = f.name.replace(/\.json$/i, '');
    let parsed;
    try {
      parsed = JSON.parse(await readAsText(f));
    } catch (e) {
      bad.push({ path: f.name, message: e instanceof SyntaxError ? '不是合法 JSON：' + e.message : e.message });
      continue;
    }
    app.session.set(key, parsed);
    if (!first) first = key;
  }
  if (!first) {
    if (bad.length) showIssues(bad, []);
    return;
  }
  await refreshDatasets();
  $('datasetSel').value = first;
  loadRaw(app.session.get(first), first, false, bad);
}

async function saveConfig() {
  const json = JSON.stringify(app.chart.cfg, null, 2) + '\n';
  const fromSession = app.dataset && app.session.has(app.dataset);
  if (app.src.kind === 'server' && app.dataset && !fromSession) {
    try {
      app.selfWrite = { name: app.dataset, at: Date.now() };
      await app.src.write(app.dataset, json);
      toast('已写回 config/' + app.dataset + '.json');
    } catch (e) {
      app.selfWrite = null;
      toast(e.message);
    }
    return;
  }
  download(new Blob([json], { type: 'application/json' }), (app.dataset || 'chart') + '.json');
}

/* ---------- 导出 ---------- */
function exportSpec() {
  const cfg = app.chart.cfg;
  return {
    width: cfg.export.width,
    height: cfg.export.height,
    fps: cfg.export.fps,
    bitrateMbps: cfg.export.bitrateMbps,
    format: cfg.export.format,
    transparent: cfg.export.transparent,
    duration: app.chart.total * cfg.style.secondsPerPeriod,
    basename: String(app.dataset || 'chart').replace(/[^\w-]+/g, '_'),
  };
}

function fileStem() {
  const cfg = app.chart.cfg;
  const end = periodKey(app.chart.anchor, cfg.time.granularity, app.chart.total);
  return (cfg.title + '_' + cfg.time.start + '_' + end).replace(/[\\/:*?"<>|\s]+/g, '_');
}

function showProgress(p, label) {
  $('workMeter').style.width = Math.round(p * 100) + '%';
  $('busyPct').textContent = Math.round(p * 100) + '%';
  $('workText').textContent = label + ' ' + Math.round(p * 100) + '%';
}

async function runExport() {
  if (app.busy) return;
  const spec = exportSpec();
  const label = FMT_TEXT[spec.format];
  const ac = new AbortController();
  app.cancel = ac;

  /* 离屏导出独占 chart 的动画状态，主循环这段时间不画预览 */
  app.clock.playing = false;
  updatePlayIcon();
  resetMotion();

  try {
    if (spec.format === 'png-seq') {
      setBusy('序列帧', 0);
      const r = await exportPngSequence(app.chart, spec, p => showProgress(p, label), ac.signal);
      if (r.kind === 'folder') toast('序列帧已写入所选文件夹');
      else {
        download(r.blob, fileStem() + '.zip');
        toast('已打包 ' + r.count + ' 帧');
      }
    } else {
      setBusy('录制', 0);
      const { blob, ext } = await exportVideo(app.chart, spec, p => showProgress(p, label), ac.signal);
      showClip(blob, ext);
    }
  } catch (e) {
    if (e && (e.name === 'AbortError' || e.name === 'NotAllowedError')) toast('已取消导出');
    else if (e) toast('导出失败：' + e.message);
  } finally {
    setBusy(null);
    app.cancel = null;
    $('workMeter').style.width = '0%';
    resetMotion();
  }
}

let lastClipURL = null;
function showClip(blob, ext) {
  if (lastClipURL) URL.revokeObjectURL(lastClipURL);
  lastClipURL = URL.createObjectURL(blob);
  const v = $('sheetVideo');
  v.src = lastClipURL;
  /* MediaRecorder 出的 webm 常缺时长，seek 一下让播放器把 duration 算出来 */
  v.onloadedmetadata = () => {
    if (v.duration === Infinity) {
      v.currentTime = 1e7;
      v.onseeked = () => {
        v.onseeked = null;
        v.currentTime = 0;
      };
    }
  };
  const spec = exportSpec();
  $('sheetDownload').href = lastClipURL;
  $('sheetDownload').download = fileStem() + '.' + ext;
  $('sheetTitle').textContent = '成片 · ' + ext.toUpperCase() + ' · ' + spec.width + '×' + spec.height;
  $('sheet').classList.remove('hidden');
}

async function saveStillFrame() {
  if (app.busy) return;
  const spec = exportSpec();
  setBusy('出图', 0);
  $('workText').textContent = '正在出图';
  app.clock.playing = false;
  updatePlayIcon();
  try {
    const blob = await exportStill(app.chart, spec, app.clock.t, spec.transparent ? 'transparent' : 'opaque');
    download(blob, fileStem() + '_帧' + Math.round(app.clock.t) + '.png');
  } catch (e) {
    toast('出图失败：' + e.message);
  } finally {
    setBusy(null);
    $('workText').textContent = '准备中';
  }
}

/* ---------- 交互 ---------- */
let scrubbing = false;
let wasPlaying = false;

function scrubTo(clientX) {
  const r = $('timeline').getBoundingClientRect();
  app.clock.seek((clientX - r.left) / r.width);
}

function wireTransport() {
  $('playBtn').addEventListener('click', togglePlay);
  $('restartBtn').addEventListener('click', () => {
    if (app.busy) return;
    resetMotion();
    app.clock.restart();
    updatePlayIcon();
  });

  const tl = $('timeline');
  tl.addEventListener('pointerdown', e => {
    if (app.busy) return;
    scrubbing = true;
    wasPlaying = app.clock.playing;
    app.clock.playing = false;
    updatePlayIcon();
    tl.setPointerCapture(e.pointerId);
    scrubTo(e.clientX);
  });
  tl.addEventListener('pointermove', e => {
    if (scrubbing) scrubTo(e.clientX);
  });
  tl.addEventListener('pointerup', () => {
    if (!scrubbing) return;
    scrubbing = false;
    app.clock.playing = wasPlaying;
    updatePlayIcon();
  });

  $('btnExport').addEventListener('click', runExport);
  $('btnStill').addEventListener('click', saveStillFrame);
  $('workCancel').addEventListener('click', () => app.cancel && app.cancel.abort());
  $('sheetClose').addEventListener('click', () => $('sheet').classList.add('hidden'));
  $('btnSave').addEventListener('click', saveConfig);
  $('btnSave2').addEventListener('click', saveConfig);
  $('btnImport').addEventListener('click', () => setPanel(panel === 'left' ? null : 'left'));
  $('btnImportClose').addEventListener('click', () => setPanel(null));
  $('btnPick').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', async e => {
    await importFiles([...e.target.files]);
    e.target.value = '';
  });

  const dz = $('dropzone');
  dz.addEventListener('click', () => $('fileInput').click());
  dz.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      $('fileInput').click();
    }
  });

  /* 画布和拖拽区都能接文件，用户往哪丢都该成功 */
  const targets = [$('stage'), dz];
  for (const node of targets) {
    node.addEventListener('dragover', e => {
      e.preventDefault();
      node.classList.add('is-drop');
    });
    node.addEventListener('dragleave', () => node.classList.remove('is-drop'));
    node.addEventListener('drop', async e => {
      e.preventDefault();
      node.classList.remove('is-drop');
      const json = [...e.dataTransfer.files].filter(f => /\.json$/i.test(f.name));
      if (json.length) await importFiles(json);
      else toast('只认 *.json 配置文件');
    });
  }

  window.addEventListener('keydown', e => {
    const active = document.activeElement || {};
    const tag = active.tagName;
    /* 焦点在自定义下拉里时，空格/方向键归组件管，别同时触发播放 */
    if (['INPUT', 'TEXTAREA'].includes(tag) || (active.closest && active.closest('.sel'))) return;
    if (tag === 'BUTTON' && e.code === 'Space') return;
    if (e.code === 'Space') {
      e.preventDefault();
      togglePlay();
    } else if (e.key === 'Home') {
      app.clock.t = 0;
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      app.clock.playing = false;
      updatePlayIcon();
      const step = e.key === 'ArrowRight' ? 1 : -1;
      app.clock.t = Math.max(0, Math.min(app.clock.total, Math.round(app.clock.t) + step));
    } else if (e.key === 'Escape') {
      if (!$('sheet').classList.contains('hidden')) $('sheet').classList.add('hidden');
      else if (panel) setPanel(null);
    }
  });
}

/* ---------- 主循环 ---------- */
let last = performance.now();
function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  if (!(dt > 0) || dt > 0.05) dt = 1 / 60;

  if (!app.busy) {
    /* 循环播放时靠重播动画归位，不能沿用上一轮的缓存位置 */
    if (app.clock.tick(dt)) resetMotion();
    app.scene.draw(app.chart, app.clock.t, dt);

    const p = app.clock.total ? app.clock.t / app.clock.total : 0;
    $('tlFill').style.width = (p * 100) + '%';
    $('tlHead').style.left = (p * 100) + '%';
    const idx = Math.max(0, Math.min(app.chart.total, Math.round(app.clock.t)));
    $('readout').textContent = periodLabel(app.chart.anchor, app.chart.cfg.time.granularity, idx)
      + ' · ' + (idx + 1) + '/' + (app.chart.total + 1);
    $('timeline').setAttribute('aria-valuenow', String(Math.round(p * 100)));
  }

  requestAnimationFrame(frame);
}

/* ---------- 启动 ---------- */
async function boot() {
  app.scene = createScene($('chart'));
  /* 先挂一个占位数据集：首个配置文件若有校验错误，主循环仍有东西可画 */
  mountChart(normalizeConfig({ series: [{ name: '载入中', values: [0, 1] }] }), false);
  buildControls();
  wireTransport();
  app.src = await detectSource();

  const all = await refreshDatasets();
  if (all.length) {
    $('datasetSel').value = all[0];
    await loadDataset(all[0]);
  } else {
    loadRaw({ series: [{ name: '甲', values: [3, 5] }, { name: '乙', values: [4, 2] }] }, null, false);
    showIssues([{
      path: 'config',
      message: app.src.kind === 'file'
        ? '本地页面读不到同目录文件，把 config 里的 JSON 拖到画布上，或点「导入配置」'
        : 'config 目录里没有可用的 JSON',
    }], []);
  }

  $('datasetSel').addEventListener('change', e => loadDataset(e.target.value));

  if (app.src.kind === 'server' && window.EventSource) {
    new EventSource('./__hot').addEventListener('change', async e => {
      const { name } = JSON.parse(e.data);
      /* 自己刚写回的那次不算外部改动，别再读一遍把提示顶掉 */
      if (app.selfWrite && app.selfWrite.name === name && Date.now() - app.selfWrite.at < 2500) return;
      await refreshDatasets();
      if (name === app.dataset) {
        const raw = await app.src.read(name);
        loadRaw(raw, name, true);
        toast('config/' + name + '.json 已重新读取');
      }
    });
  }

  app.clock.playing = true;
  updatePlayIcon();
  requestAnimationFrame(frame);
}

boot();
