/* ============================================================
 * ===== 配置：默认值 / 校验 / 归一化 =====
 * ============================================================
 * 校验器与页面文案是同一套人话，报错必须带路径，
 * 让改配置的人一眼知道改哪一行，而不是 console 里一个 undefined。
 * ============================================================ */

import { GRANULARITIES, parseStart, periodIndexOf, startHint } from './time.js';
import { PALETTES, normalizeHex } from './color.js';
import { FONTS } from './text.js';

export const POS_KEYS = ['outL', 'inL', 'inR', 'outR'];
export const VALUE_POS = ['auto', ...POS_KEYS];
export const ICON_POS = ['none', ...POS_KEYS];
export const BAR_SHAPES = ['none', 'small', 'large', 'pill'];
export const EXPORT_FORMATS = ['webm', 'mp4', 'png-seq'];
export const DATE_ANIMS = ['pop', 'fade', 'none'];

export const DEFAULT_STYLE = {
  font: 'sans',
  fontScale: 1,
  namePos: 'inL',
  rankPos: 'outL',
  valuePos: 'auto',
  iconPos: 'outL',
  barShape: 'small',
  palette: 'jewel',
  bg: '#121311',
  topN: 10,
  secondsPerPeriod: 1,
  loop: false,
  showGrid: true,
  showValue: true,
  sortDir: 'desc',
  dateAnim: 'pop',
};

export const DEFAULT_LAYOUT = {
  design: { width: 1920, height: 1080 },
  canvas: { width: 1920, height: 1080 },
  plot: { left: 230, right: 1470, top: 180, bottom: 935 },
  bar: { heightRatio: 0.72, maxHeight: 58 },
  margin: 54,
  padIn: 18,
  gapIn: 12,
  gapOut: 14,
};

export const DEFAULT_EXPORT = {
  width: 1920,
  height: 1080,
  fps: 60,
  bitrateMbps: 12,
  format: 'webm',
  transparent: false,
};

const clone = o => JSON.parse(JSON.stringify(o));

export function makeDefaultConfig() {
  return {
    $schema: './chart.schema.json',
    meta: { name: '未命名图表', note: '' },
    title: '月度排名条形动画',
    subtitle: '',
    unit: '',
    time: { granularity: 'month', start: '2024-01', decimals: 1 },
    series: [],
    events: [],
    style: clone(DEFAULT_STYLE),
    layout: clone(DEFAULT_LAYOUT),
    export: clone(DEFAULT_EXPORT),
  };
}

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function mergeInto(target, source) {
  if (!isPlainObject(source)) return;
  for (const [k, v] of Object.entries(source)) {
    if (isPlainObject(v) && isPlainObject(target[k])) mergeInto(target[k], v);
    else if (v !== undefined) target[k] = v;
  }
}

/* 深度合并用户配置到默认骨架，数组整体替换（配置里给 series 就是想要这一份） */
export function normalizeConfig(raw) {
  const base = makeDefaultConfig();
  const out = {
    ...base,
    style: { ...base.style },
    layout: clone(DEFAULT_LAYOUT),
    export: { ...base.export },
  };
  if (!isPlainObject(raw)) return out;

  if (typeof raw.$schema === 'string') out.$schema = raw.$schema;
  for (const key of ['title', 'subtitle', 'unit']) {
    if (typeof raw[key] === 'string') out[key] = raw[key];
  }
  if (isPlainObject(raw.meta)) {
    if (typeof raw.meta.name === 'string') out.meta.name = raw.meta.name;
    if (typeof raw.meta.note === 'string') out.meta.note = raw.meta.note;
  }
  mergeInto(out.time, raw.time);
  if (Array.isArray(raw.series)) out.series = raw.series;
  if (Array.isArray(raw.events)) out.events = raw.events;
  mergeInto(out.style, raw.style);
  mergeInto(out.layout, raw.layout);
  mergeInto(out.export, raw.export);
  if (isPlainObject(raw.brands)) applyBrands(out, raw.brands);
  return out;
}

/* 按品牌名挂观感：CSV 出数据、JSON 出颜色和 logo，靠名字对上。
   只替换匹配到的条目并生成新对象，不原地改用户给的那个数组 */
export function applyBrands(cfg, brands) {
  if (!isPlainObject(brands) || !Array.isArray(cfg.series)) return cfg;
  cfg.series = cfg.series.map(s => {
    const b = isPlainObject(brands[s && s.name]) ? brands[s.name] : null;
    if (!b) return s;
    const next = { ...s };
    if (typeof b.color === 'string' && b.color.trim()) next.color = b.color.trim();
    if (typeof b.icon === 'string' && b.icon.trim()) next.icon = b.icon.trim();
    return next;
  });
  return cfg;
}

const oneOf = list => list.join(' / ');

function pickEnum(err, path, value, allowed, label) {
  if (allowed.includes(value)) return true;
  err.push({ path, message: label + '只能是 ' + oneOf(allowed) + '，当前是 ' + JSON.stringify(value) });
  return false;
}

function pickNumber(err, path, value, { min, max, integer, label }) {
  const n = typeof value === 'number' ? value : NaN;
  if (!Number.isFinite(n)) {
    err.push({ path, message: label + '必须是数字，当前是 ' + JSON.stringify(value) });
    return null;
  }
  if (integer && !Number.isInteger(n)) {
    err.push({ path, message: label + '必须是整数，当前是 ' + n });
    return null;
  }
  if (min !== undefined && n < min) {
    err.push({ path, message: label + '不能小于 ' + min + '，当前是 ' + n });
    return null;
  }
  if (max !== undefined && n > max) {
    err.push({ path, message: label + '不能大于 ' + max + '，当前是 ' + n });
    return null;
  }
  return n;
}

/* 返回 {errors, warnings}；errors 非空即不应加载该配置 */
export function validateConfig(raw) {
  const errors = [];
  const warnings = [];
  const cfg = normalizeConfig(raw);

  if (!isPlainObject(raw)) {
    errors.push({ path: '(root)', message: '配置文件顶层必须是一个对象 { ... }' });
    return { errors, warnings, cfg };
  }

  const gran = cfg.time.granularity;
  if (!pickEnum(errors, 'time.granularity', gran, GRANULARITIES, '时间粒度')) {
    return { errors, warnings, cfg };
  }
  const anchor = parseStart(gran, cfg.time.start);
  if (!anchor) {
    errors.push({
      path: 'time.start',
      message: '起始时间格式应为 ' + startHint(gran) + '，当前是 ' + JSON.stringify(cfg.time.start),
    });
    return { errors, warnings, cfg };
  }
  pickNumber(errors, 'time.decimals', cfg.time.decimals, { min: 0, max: 4, integer: true, label: '小数位数' });

  if (!Array.isArray(raw.series) || raw.series.length === 0) {
    errors.push({ path: 'series', message: 'series 至少要有 1 个条目' });
    return { errors, warnings, cfg };
  }

  const names = new Set();
  let longest = 0;
  raw.series.forEach((s, i) => {
    const path = 'series[' + i + ']';
    if (!isPlainObject(s)) {
      errors.push({ path, message: '每个条目必须是对象' });
      return;
    }
    const label = typeof s.name === 'string' && s.name.trim() ? s.name.trim() : '(无名)';
    if (typeof s.name !== 'string' || !s.name.trim()) {
      errors.push({ path: path + '.name', message: 'name 不能为空' });
    }
    if (names.has(label)) warnings.push({ path: path + '.name', message: '名称「' + label + '」重复，图上会出现两条同名' });
    names.add(label);

    if (s.color !== undefined && s.color !== null) {
      if (!normalizeHex(s.color)) {
        errors.push({ path: path + '.color', message: 'color 需要 #RGB 或 #RRGGBB，当前是 ' + JSON.stringify(s.color) });
      }
    }
    if (s.icon !== undefined && s.icon !== null && typeof s.icon !== 'string') {
      errors.push({ path: path + '.icon', message: 'icon 需要 SVG 字符串或图片地址' });
    }

    if (!Array.isArray(s.values) || s.values.length < 2) {
      errors.push({ path: path + '.values', message: '「' + label + '」的 values 至少要有 2 个周期的数据' });
      return;
    }
    const bad = s.values.findIndex(v => v !== null && !Number.isFinite(Number(v)));
    if (bad >= 0) {
      errors.push({
        path: path + '.values[' + bad + ']',
        message: '「' + label + '」第 ' + (bad + 1) + ' 个值是 ' + JSON.stringify(s.values[bad]) + '，只能填数字或 null',
      });
      return;
    }
    const hole = s.values.findIndex((v, k) => v === null && k > 0 && s.values[k - 1] !== null
      && s.values.slice(k).some(x => x !== null));
    if (hole >= 0) {
      warnings.push({
        path: path + '.values[' + hole + ']',
        message: '「' + label + '」中途有 null 又再次出现数值，离场后会重新登场',
      });
    }
    longest = Math.max(longest, s.values.length);
  });

  const total = Math.max(0, longest - 1);
  raw.series.forEach((s, i) => {
    if (isPlainObject(s) && Array.isArray(s.values) && s.values.length !== longest) {
      warnings.push({
        path: 'series[' + i + '].values',
        message: '「' + s.name + '」长度 ' + s.values.length + '，与最长的 ' + longest
          + ' 不一致，多出来的周期按无数据处理（该品牌会退出榜单）',
      });
    }
  });

  if (Array.isArray(raw.events)) {
    raw.events.forEach((ev, i) => {
      const path = 'events[' + i + ']';
      if (!isPlainObject(ev)) {
        errors.push({ path, message: '事件必须是 { period, text }' });
        return;
      }
      const idx = periodIndexOf(anchor, gran, ev.period);
      if (idx === null || idx < 0 || idx > total) {
        errors.push({
          path: path + '.period',
          message: '事件周期 ' + JSON.stringify(ev.period) + ' 不在 '
            + cfg.time.start + ' 起的 ' + (total + 1) + ' 个周期内',
        });
      }
      if (typeof ev.text !== 'string' || !ev.text.trim()) {
        errors.push({ path: path + '.text', message: '事件描述不能为空' });
      }
    });
  }

  checkLook(cfg, raw, errors, warnings);

  /* brands 是「按名字挂观感」的覆盖表：名字对不上就等于没生效，得说清楚 */
  if (isPlainObject(raw.brands)) {
    const names = new Set((Array.isArray(raw.series) ? raw.series : []).map(s => s && s.name));
    for (const [nm, b] of Object.entries(raw.brands)) {
      const path = 'brands.' + nm;
      if (!isPlainObject(b)) {
        errors.push({ path, message: '每条品牌覆盖必须是 { color, icon } 对象' });
        continue;
      }
      if (b.color !== undefined && !normalizeHex(b.color)) {
        errors.push({ path: path + '.color', message: 'color 需要 #RGB 或 #RRGGBB，当前是 ' + JSON.stringify(b.color) });
      }
      if (b.icon !== undefined && typeof b.icon !== 'string') {
        errors.push({ path: path + '.icon', message: 'icon 需要内联 SVG 字符串或图片地址' });
      }
      if (Array.isArray(raw.series) && !names.has(nm)) {
        warnings.push({ path, message: '当前数据里没有叫「' + nm + '」的条目，这条覆盖没生效' });
      }
    }
  }

  const KNOWN = {
    root: ['$schema', 'meta', 'title', 'subtitle', 'unit', 'time', 'series', 'events', 'brands', 'style', 'layout', 'export'],
    time: ['granularity', 'start', 'decimals'],
    entry: ['name', 'values', 'color', 'icon', 'group'],
  };
  unknownFields(raw, KNOWN.root, 'root', cfg, warnings);
  unknownFields(raw.time, KNOWN.time, 'time', cfg, warnings);
  if (Array.isArray(raw.series)) {
    raw.series.forEach((s, i) => unknownFields(s, KNOWN.entry, 'series[' + i + ']', cfg, warnings));
  }

  return { errors, warnings, cfg };
}

/* 不认识的字段一律提醒，但 style.unit 是历史位置，单独给一条迁移话 */
function unknownFields(obj, list, at, cfg, warnings) {
  if (!isPlainObject(obj)) return;
  for (const k of Object.keys(obj)) {
    if (list.includes(k)) continue;
    if (at === 'style' && k === 'unit') {
      warnings.push({ path: 'style.unit', message: 'unit 已移到顶层，请写成 "unit": "' + cfg.unit + '"' });
      continue;
    }
    warnings.push({ path: at === 'root' ? k : at + '.' + k, message: '不认识的字段，已忽略' });
  }
}

/* 观感部分的校验：完整配置和样式模板共用这一段，免得两处规则漂开 */
function checkLook(cfg, raw, errors, warnings) {
  const LOOK = {
    style: Object.keys(DEFAULT_STYLE),
    layout: Object.keys(DEFAULT_LAYOUT),
    export: Object.keys(DEFAULT_EXPORT),
  };
  const st = cfg.style;
  if (!FONTS[st.font]) errors.push({ path: 'style.font', message: 'font 只能是 ' + oneOf(Object.keys(FONTS)) });
  pickNumber(errors, 'style.fontScale', st.fontScale, { min: 0.6, max: 1.6, label: '字号缩放' });
  pickEnum(errors, 'style.namePos', st.namePos, POS_KEYS, '名称位置');
  pickEnum(errors, 'style.rankPos', st.rankPos, POS_KEYS, '排名位置');
  pickEnum(errors, 'style.valuePos', st.valuePos, VALUE_POS, '数值位置');
  pickEnum(errors, 'style.iconPos', st.iconPos, ICON_POS, '图标位置');
  pickEnum(errors, 'style.barShape', st.barShape, BAR_SHAPES, '条形形状');
  pickEnum(errors, 'style.sortDir', st.sortDir, ['desc', 'asc'], '排序方向');
  pickEnum(errors, 'style.dateAnim', st.dateAnim, DATE_ANIMS, '日期切换动画');
  if (!PALETTES[st.palette]) errors.push({ path: 'style.palette', message: 'palette 只能是 ' + oneOf(Object.keys(PALETTES)) });
  if (!normalizeHex(st.bg)) errors.push({ path: 'style.bg', message: '背景色需要 #RRGGBB，当前是 ' + JSON.stringify(st.bg) });
  pickNumber(errors, 'style.topN', st.topN, { min: 3, max: 30, integer: true, label: '显示条数' });
  pickNumber(errors, 'style.secondsPerPeriod', st.secondsPerPeriod, { min: 0.15, max: 8, label: '每周期秒数' });
  if (isPlainObject(raw.style) && raw.style.duration !== undefined) {
    warnings.push({ path: 'style.duration', message: '总时长现在由「周期数 × 每周期秒数」自动推算，请改写 secondsPerPeriod' });
  }

  const lo = cfg.layout;
  pickNumber(errors, 'layout.canvas.width', lo.canvas.width, { min: 320, max: 3840, integer: true, label: '预览画布宽' });
  pickNumber(errors, 'layout.canvas.height', lo.canvas.height, { min: 240, max: 2160, integer: true, label: '预览画布高' });
  pickNumber(errors, 'layout.design.width', lo.design.width, { min: 320, max: 3840, integer: true, label: '布局基准宽' });
  pickNumber(errors, 'layout.design.height', lo.design.height, { min: 240, max: 2160, integer: true, label: '布局基准高' });
  const pl = lo.plot;
  if (!(pl.left < pl.right)) errors.push({ path: 'layout.plot', message: 'plot.left 必须小于 plot.right' });
  if (!(pl.top < pl.bottom)) errors.push({ path: 'layout.plot', message: 'plot.top 必须小于 plot.bottom' });
  if (!(pl.right <= lo.design.width)) {
    warnings.push({ path: 'layout.plot.right', message: 'plot.right 超出布局基准宽度 ' + lo.design.width + '，右侧内容会被裁掉' });
  }
  pickNumber(errors, 'layout.bar.heightRatio', lo.bar.heightRatio, { min: 0.2, max: 1, label: '条形高度占比' });
  pickNumber(errors, 'layout.bar.maxHeight', lo.bar.maxHeight, { min: 8, max: 400, label: '条形最大高度' });
  pickNumber(errors, 'layout.margin', lo.margin, { min: 0, max: 600, label: '安全边距' });

  const ex = cfg.export;
  pickEnum(errors, 'export.format', ex.format, EXPORT_FORMATS, '导出格式');
  pickNumber(errors, 'export.fps', ex.fps, { min: 10, max: 120, integer: true, label: '导出帧率' });
  pickNumber(errors, 'export.bitrateMbps', ex.bitrateMbps, { min: 1, max: 80, label: '导出码率' });

  unknownFields(raw.style, LOOK.style, 'style', cfg, warnings);
  unknownFields(raw.layout, LOOK.layout, 'layout', cfg, warnings);
  unknownFields(raw.export, LOOK.export, 'export', cfg, warnings);
}

/* 从原始 JSON 里只摘观感字段：模板没写的键保持 undefined，
   这样套用时不会用默认值把用户当前调好的东西顶掉 */
export function lookOf(raw) {
  const look = {};
  if (!isPlainObject(raw)) return look;
  if (isPlainObject(raw.style)) look.style = { ...raw.style };
  if (isPlainObject(raw.layout)) { look.layout = {}; mergeInto(look.layout, raw.layout); }
  if (isPlainObject(raw.export)) look.export = { ...raw.export };
  if (raw.unit !== undefined) look.unit = String(raw.unit);
  if (raw.title !== undefined) look.title = String(raw.title);
  if (raw.subtitle !== undefined) look.subtitle = String(raw.subtitle);
  if (isPlainObject(raw.time) && raw.time.decimals !== undefined) look.decimals = raw.time.decimals;
  /* 大事件和品牌覆盖都是「标注」而不是测量值，所以模板可以带；series 是数据，模板不许带 */
  if (Array.isArray(raw.events)) look.events = raw.events.map(e => (isPlainObject(e) ? { ...e } : e));
  if (isPlainObject(raw.brands)) {
    look.brands = Object.fromEntries(
      Object.entries(raw.brands).map(([k, v]) => [k, isPlainObject(v) ? { ...v } : v]));
  }
  return look;
}

/* 套用模板：series / events / 粒度 / 起点 一律不动。
   series 保持原引用，否则 chart.items 挂的还是旧数组，数据和图就分家了 */
export function applyStyleTemplate(cfg, look) {
  const layout = clone(cfg.layout);
  if (look.layout) mergeInto(layout, look.layout);
  const next = {
    ...cfg,
    style: { ...cfg.style, ...(look.style || {}) },
    layout,
    export: { ...cfg.export, ...(look.export || {}) },
    time: { ...cfg.time },
  };
  if (look.unit !== undefined) next.unit = look.unit;
  if (look.title !== undefined) next.title = look.title;
  if (look.subtitle !== undefined) next.subtitle = look.subtitle;
  if (look.decimals !== undefined) next.time.decimals = look.decimals;
  if (look.events !== undefined) next.events = look.events.map(e => (isPlainObject(e) ? { ...e } : e));
  if (look.brands) applyBrands(next, look.brands);
  return next;
}

/* 样式模板：只有观感字段，没有 series。单独一个入口是为了把话说清楚——
   用户拿模板当配置导入时不该看到「series 至少要有 1 个条目」 */
export function validateStyleTemplate(raw) {
  const errors = [];
  const warnings = [];
  if (!isPlainObject(raw)) {
    errors.push({ path: '(root)', message: '样式模板顶层必须是一个对象 { ... }' });
    return { errors, warnings, look: null };
  }
  /* series 带着数值，模板不许有；events 和 brands 只是标注，允许 */
  if (raw.series !== undefined) {
    errors.push({ path: 'series', message: 'series 属于数据，样式模板里不要写；要连数据一起导入请存成完整配置' });
  }
  if (isPlainObject(raw.time) && (raw.time.granularity !== undefined || raw.time.start !== undefined)) {
    errors.push({ path: 'time', message: '模板只带 time.decimals（小数位）；粒度和起点跟着数据走，写在表头或完整配置里' });
  }

  const look = lookOf(raw);
  const empty = !Object.keys(look).length;
  if (empty) {
    errors.push({ path: '(root)', message: '这个模板没带任何观感字段：至少写 style / layout / export / unit 里的一项' });
  }
  /* series 已经给过 error，别再补一条「不认识的字段」；brands 和 events 是模板允许的标注 */
  const KNOWN = ['$schema', 'meta', 'title', 'subtitle', 'unit', 'time', 'style', 'layout', 'export', 'series', 'events', 'brands'];
  unknownFields(raw, KNOWN, 'root', { unit: look.unit ?? '' }, warnings);
  unknownFields(raw.time, ['decimals'], 'time', { unit: '' }, warnings);

  const probe = applyStyleTemplate(makeDefaultConfig(), look);
  if (!empty) checkLook(probe, raw, errors, warnings);
  return { errors, warnings, look };
}
