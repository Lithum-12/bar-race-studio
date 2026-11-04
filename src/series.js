/* ============================================================
 * ===== 数据模型：条目 / 插值 / 排名 =====
 * ============================================================ */

import { parseStart, periodIndexOf } from './time.js';
import { PALETTES } from './color.js';
import { GLYPHS, emblemSVG, createIconStore } from './icon.js';
import { niceDomain } from './scale.js';

export function buildChart(cfg) {
  const anchor = parseStart(cfg.time.granularity, cfg.time.start);
  const icons = createIconStore();

  const items = cfg.series.map((d, i) => {
    const pinned = d.color || null;
    return {
      idx: i,
      name: String(d.name),
      group: d.group == null ? null : String(d.group),
      pinnedColor: pinned,
      color: pinned,
      iconRaw: d.icon || null,
      autoEmblem: !d.icon,
      values: d.values.map(v => (v == null ? null : Number(v))),
      rank: 0,
      v: null,
      animY: 0,
      alpha: 0,
      init: false,
      exiting: false,
    };
  });

  const chart = {
    cfg,
    anchor,
    icons,
    items,
    total: 0,
    domain: { lo: 0, hi: 1 },
    domainAnim: null,
  };

  padSeries(chart);
  applyPalette(chart);
  return chart;
}

/* 各条目长度对齐：短的按最后一个值续，与旧实现一致，差值由校验器提前报成 warning */
export function padSeries(chart) {
  const maxLen = chart.items.reduce((m, it) => Math.max(m, it.values.length), 0);
  chart.total = Math.max(1, maxLen - 1);
  for (const it of chart.items) {
    while (it.values.length < maxLen) {
      it.values.push(it.values.length ? it.values[it.values.length - 1] : 0);
    }
  }
}

export function applyPalette(chart) {
  const palette = PALETTES[chart.cfg.style.palette] || PALETTES.jewel;
  chart.items.forEach((it, i) => {
    if (it.pinnedColor) {
      chart.icons.request(i, it.iconRaw);
      return;
    }
    it.color = palette.colors[i % palette.colors.length];
    if (it.autoEmblem) {
      chart.icons.request(i, emblemSVG(it.color, GLYPHS[i % GLYPHS.length]));
    } else {
      chart.icons.request(i, it.iconRaw);
    }
  });
}

const clampIdx = (chart, i) => Math.max(0, Math.min(chart.total, i));

/* 线性插值；null 两端都缺返回 null，单端缺时按在场的那一端取值 */
export function sampleAt(chart, t, it) {
  const i = clampIdx(chart, Math.floor(t));
  const j = Math.min(chart.total, i + 1);
  const f = Math.max(0, Math.min(1, t - i));
  const a = it.values[i];
  const b = it.values[j];
  it.exiting = a != null && b == null;
  if (a == null && b == null) return null;
  if (a == null) return b;
  if (b == null) return a;
  return a + (b - a) * f;
}

export function refreshValues(chart, t) {
  for (const it of chart.items) it.v = sampleAt(chart, t, it);
}

export function rankItems(chart) {
  const asc = chart.cfg.style.sortDir === 'asc';
  const present = chart.items.filter(it => it.v != null);
  present.sort((a, b) => (asc ? a.v - b.v : b.v - a.v));
  present.forEach((it, ri) => { it.rank = ri; });
  const tail = chart.cfg.style.topN + 5;
  for (const it of chart.items) if (it.v == null) it.rank = tail;
}

export function isVisible(chart, it) {
  return it.v != null && !it.exiting && it.rank < chart.cfg.style.topN;
}

export function valueBounds(chart) {
  let vmin = Infinity;
  let vmax = -Infinity;
  for (const it of chart.items) {
    if (it.v == null) continue;
    if (it.v < vmin) vmin = it.v;
    if (it.v > vmax) vmax = it.v;
  }
  if (!Number.isFinite(vmin)) return { vmin: 0, vmax: 1 };
  return { vmin, vmax };
}

/* 轴域平滑伸缩：扩张快、收缩慢，避免刻度来回跳 */
export function stepDomain(chart, vmin, vmax, dt) {
  const target = niceDomain(vmin, vmax);
  if (!chart.domainAnim) {
    chart.domainAnim = target;
  } else {
    const growing = target.hi > chart.domainAnim.hi || target.lo < chart.domainAnim.lo;
    const k = growing ? 8 : 2.2;
    const a = 1 - Math.exp(-k * dt);
    chart.domainAnim = {
      lo: chart.domainAnim.lo + (target.lo - chart.domainAnim.lo) * a,
      hi: chart.domainAnim.hi + (target.hi - chart.domainAnim.hi) * a,
    };
  }
  chart.domain = chart.domainAnim;
  return chart.domain;
}

/* 事件周期 → 序号，每帧都要算，缓存掉 */
export function periodIndex(chart, key) {
  if (!chart.indexCache) chart.indexCache = new Map();
  const ck = String(key);
  if (chart.indexCache.has(ck)) return chart.indexCache.get(ck);
  const idx = periodIndexOf(chart.anchor, chart.cfg.time.granularity, key);
  chart.indexCache.set(ck, idx == null ? -1 : idx);
  return chart.indexCache.get(ck);
}
