#!/usr/bin/env node
/* ============================================================
 * ===== 生成 README banner =====
 * ============================================================
 * 不手画：跑真实渲染器，把绘制指令翻译成 SVG。
 * UI 或数据改了，重跑一次 banner 就跟着变，不会出现图文对不上。
 * 用法：node tools/banner.mjs [数据集名，默认 auto-sales]
 * ============================================================ */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeConfig } from '../src/config.js';
import { buildChart, applyPalette } from '../src/series.js';
import { createScene } from '../src/render.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WHICH = process.argv[2] || 'auto-sales';
const CYCLE = 8;
const STEPS = 4;

/* ---------- 记录型 context：带仿射矩阵栈 ---------- */
const mul = (a, b) => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
];

let ops = [];
let font = '16px sans-serif';
let M = [1, 0, 0, 1, 0, 0];
const stack = [];

const ctx = {
  fillStyle: '#000', strokeStyle: '#000', lineWidth: 1,
  globalAlpha: 1, textAlign: 'left', textBaseline: 'alphabetic',
  get font() { return font },
  set font(v) { font = v },
  setTransform: (...n) => { M = n },
  clearRect: () => {},
  fillRect: (x, y, w, h) => ops.push({ t: 'rect', x, y, w, h, fill: ctx.fillStyle, alpha: ctx.globalAlpha }),
  beginPath: () => {}, closePath: () => {}, arcTo: () => {}, clip: () => {},
  moveTo: (x, y) => ops.push({ t: 'open', x, y }),
  lineTo: (x, y) => ops.push({ t: 'seg', x, y }),
  arc: (x, y, r) => ops.push({ t: 'circle', x, y, r, fill: ctx.fillStyle, alpha: ctx.globalAlpha }),
  roundRect: (x, y, w, h, r) => ops.push({ t: 'rrect', x, y, w, h, r, fill: ctx.fillStyle, alpha: ctx.globalAlpha }),
  fill: () => ops.push({ t: '_fill' }),
  stroke: () => ops.push({ t: '_stroke', stroke: ctx.strokeStyle, lw: ctx.lineWidth, alpha: ctx.globalAlpha }),
  save: () => stack.push([M, font, ctx.textAlign, ctx.textBaseline]),
  restore: () => { const s = stack.pop(); if (s) { M = s[0]; font = s[1]; ctx.textAlign = s[2]; ctx.textBaseline = s[3]; } },
  translate: (x, y) => { M = mul(M, [1, 0, 0, 1, x, y]); },
  scale: (x, y) => { M = mul(M, [x, 0, 0, y, 0, 0]); },
  drawImage: (img, x, y, w, h) => ops.push({ t: 'img', m: [...M], x, y, w, h, href: img.src, alpha: ctx.globalAlpha }),
  fillText: (s, x, y) => ops.push({ t: 'text', m: [...M], s: String(s), x, y, font, align: ctx.textAlign, fill: ctx.fillStyle, alpha: ctx.globalAlpha }),
  measureText: s => ({ width: measureApprox(s) }),
};

function measureApprox(text) {
  const size = parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] || '16');
  return Math.round(String(text).length * size * (/[\u4e00-\u9fa5]/.test(text) ? 1 : 0.55));
}

globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };
globalThis.Image = class {
  set src(v) { this._s = v; setTimeout(() => this.onload && this.onload(), 0); }
  get src() { return this._s }
};

/* ---------- 跑真实渲染器，取 STEPS 个时刻的绘制序列 ---------- */
const cfg = normalizeConfig(JSON.parse(readFileSync(join(ROOT, 'config', WHICH + '.json'), 'utf8')));
const canvas = { width: 1920, height: 1080, getContext: () => ctx };
const scene = createScene(canvas);
const chart = buildChart(cfg);
applyPalette(chart);
await new Promise(r => setTimeout(r, 10));

const times = Array.from({ length: STEPS }, (_, k) => {
  const f = k === STEPS - 1 ? 1 : [0.2, 0.47, 0.73][k];
  return Math.round(f * chart.total);
});

function record(t) {
  /* 推进到目标时刻后清空，只留目标帧 */
  for (let i = 0; i <= Math.ceil(t); i++) scene.draw(chart, Math.min(i, t), 1 / 60);
  ops = [];
  scene.draw(chart, t, 1 / 60);

  const out = [];
  let path = null;
  for (const o of ops) {
    if (o.t === 'open') { path = { t: 'path', d: `M${o.x} ${o.y}`, m: [...M] }; continue; }
    if (o.t === 'seg' && path) { path.d += ` L${o.x} ${o.y}`; continue; }
    if (o.t === '_stroke' && path) { out.push({ ...path, stroke: o.stroke, lw: o.lw, alpha: o.alpha }); path = null; continue; }
    if (o.t === '_fill' || o.t === '_stroke') { path = null; continue; }
    if (o.t === 'rect' || o.t === 'rrect' || o.t === 'text' || o.t === 'img' || o.t === 'circle') {
      o.m = [...M];
      out.push(o);
    }
  }
  return out;
}

const frames = times.map(record);
const itemColor = new Map(chart.items.map(it => [it.color, it]));

/* 把一帧拆成「条目」和「非条目」：条形的 roundRect 用条目色填充，据此识别。
   大事件画在所有条形之后，靠「上一个 roundRect」归属会把它错并进最后一条，
   所以再用绘图区下边界切一刀：y 超过 plot.bottom 的一律不是条形标签。 */
const plotBottom = cfg.layout.plot.bottom;

function split(fl) {
  const bars = new Map();
  const rest = [];
  let cur = null;
  for (const o of fl) {
    if (o.t === 'rrect' && itemColor.has(o.fill)) {
      cur = { color: o.fill, x: o.x, y: o.y, w: o.w, h: o.h, r: o.r, texts: [], img: null };
      bars.set(o.fill, cur);
      continue;
    }
    if (cur && (o.t === 'text' || o.t === 'img') && o.y <= plotBottom + 1) {
      if (o.t === 'img') cur.img = o;
      else cur.texts.push(o);
      continue;
    }
    cur = null;
    /* 正在滑出的条目，徽标 y 会超过 plot.bottom 而落到这里；脱离条形的图标没有意义 */
    if (o.t === 'img') continue;
    rest.push(o);
  }
  return { bars, rest };
}

const parts = frames.map(split);
/* 四个时刻都在场的条目才参与动画，否则位次插值会断 */
const live = chart.items.map(it => it.color).filter(c => parts.every(p => p.bars.has(c)));

/* ---------- 序列化 ---------- */
const r2 = n => Math.round(n * 100) / 100;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = v => (v.alpha !== undefined && v.alpha < 0.995 ? ` opacity="${r2(v.alpha)}"` : '');

function textAttrs(o) {
  const size = parseFloat(/(\d+(?:\.\d+)?)px/.exec(o.font)[1]);
  const weight = /^\d+\s/.test(o.font) ? o.font.match(/^\d+/)[0] : '400';
  const anchor = o.align === 'right' ? 'end' : o.align === 'center' ? 'middle' : 'start';
  return `x="${r2(o.x)}" y="${r2(o.y)}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" fill="${o.fill}"`;
}

function svgEl(o, pad) {
  const p = pad + '  ';
  if (o.t === 'rect' || o.t === 'rrect') {
    const rx = o.t === 'rrect' && o.r ? ` rx="${r2(o.r)}"` : '';
    return `${p}<rect x="${r2(o.x)}" y="${r2(o.y)}" width="${r2(o.w)}" height="${r2(o.h)}"${rx} fill="${o.fill}"${num(o)}/>`;
  }
  if (o.t === 'path') return `${p}<path d="${o.d}" fill="none" stroke="${o.stroke}" stroke-width="${o.lw}"${num(o)}/>`;
  if (o.t === 'circle') return `${p}<circle cx="${r2(o.x)}" cy="${r2(o.y)}" r="${r2(o.r)}" fill="${o.fill}"${num(o)}/>`;
  if (o.t === 'img') return `${p}<image href="${esc(o.href)}" x="${r2(o.x)}" y="${r2(o.y)}" width="${r2(o.w)}" height="${r2(o.h)}"${num(o)}/>`;
  if (o.t === 'text') return `${p}<text ${textAttrs(o)}${num(o)}>${esc(o.s)}</text>`;
  return '';
}

/* 非条目元素里，只有背景、标题、副标题、单位是四个时刻都不变的 */
function isStatic(o) {
  if (o.t !== 'text' && o.t !== 'rect') return false;
  if (o.t === 'rect') return o.w >= 1900 && o.h >= 1000;
  return /^(虚拟品牌月度销量排行|示例数据|单位：)/.test(o.s);
}

const L = [];
L.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1920 1080" width="1920" height="1080" role="img">');
L.push(`  <title>${esc(cfg.title)}</title>`);
L.push(`  <desc>${esc(cfg.title)}：${live.length} 个条目在第 ${times.join('、')} 个周期间连续改变长度与位次。由 tools/banner.mjs 调用真实渲染器生成。</desc>`);
L.push('  <style>');
L.push('    text { font-family: "PingFang SC","HarmonyOS Sans SC","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif }');
L.push(`    .b { animation: rise ${CYCLE}s cubic-bezier(.45,0,.2,1) infinite }`);
L.push(`    .g { animation: len ${CYCLE}s cubic-bezier(.45,0,.2,1) infinite; transform-box: fill-box; transform-origin: left center }`);
L.push(`    .vx { animation: slide ${CYCLE}s cubic-bezier(.45,0,.2,1) infinite; transform-box: fill-box }`);
L.push(`    .sw { animation: onair ${CYCLE}s linear infinite }`);
L.push('    @keyframes rise {');
for (let k = 0; k < STEPS; k++) L.push(`      ${r2(k * 100 / STEPS)}% { transform: translateY(var(--y${k})) }`);
L.push(`      100% { transform: translateY(var(--y0)) }`);
L.push('    }');
L.push('    @keyframes len {');
for (let k = 0; k < STEPS; k++) L.push(`      ${r2(k * 100 / STEPS)}% { transform: scaleX(var(--w${k})) }`);
L.push('      100% { transform: scaleX(var(--w0)) }');
L.push('    }');
L.push('    @keyframes slide {');
for (let k = 0; k < STEPS; k++) L.push(`      ${r2(k * 100 / STEPS)}% { transform: translateX(var(--x${k})) }`);
L.push('      100% { transform: translateX(var(--x0)) }');
L.push('    }');
L.push(`    @keyframes onair { 0%, ${r2(100 / STEPS - 1)}% { opacity: 1 } ${r2(100 / STEPS)}%, 100% { opacity: 0 } }`);
L.push('    @media (prefers-reduced-motion: reduce) { .b, .g, .vx, .sw { animation: none } }');
L.push('  </style>');

/* 静态层：背景、标题、副标题、单位 */
for (const o of parts[0].rest) {
  if (isStatic(o)) { const s = svgEl(o, '  '); if (s) L.push(s); }
}

/* 按时刻切换的层：网格刻度、日期、大事件 */
const swapBuckets = Array.from({ length: STEPS }, () => []);
for (let k = 0; k < STEPS; k++) {
  for (const o of parts[k].rest) if (!isStatic(o)) swapBuckets[k].push(o);
}
swapBuckets.forEach((bucket, k) => {
  if (!bucket.length) return;
  L.push(`  <g class="sw" style="animation-delay:${r2(-CYCLE + k * (CYCLE / STEPS))}s${k ? ';opacity:0' : ''}">`);
  for (const o of bucket) { const s = svgEl(o, '    '); if (s) L.push(s); }
  L.push('  </g>');
});

/* 条目层：位次用 translateY，长度用 scaleX，数值标签跟着条尾平移 */
for (const c of live) {
  const seq = parts.map(p => p.bars.get(c));
  const base = seq[0];
  const varsY = seq.map((s, k) => `--y${k}:${r2(s.y)}px`).join(';');
  const lines = [];

  if (base.img) {
    const g = base.img;
    lines.push(`    <image href="${esc(g.href)}" x="${r2(g.x)}" y="${r2(g.y - base.y)}" width="${r2(g.w)}" height="${r2(g.h)}"/>`);
  }
  for (const t of base.texts) {
    if (/[\d,]+\.\d/.test(t.s) && t.s.length > 2) continue;
    lines.push(`    <text ${textAttrs({ ...t, y: t.y - base.y })}>${esc(t.s)}</text>`);
  }
  lines.push(`    <g class="g" style="${seq.map((s, k) => `--w${k}:${r2(s.w / base.w)}`).join(';')};transform:scaleX(var(--w0))">`);
  lines.push(`      <rect x="${r2(base.x)}" y="${r2(-base.h / 2)}" width="${r2(base.w)}" height="${r2(base.h)}"${base.r ? ` rx="${r2(base.r)}"` : ''} fill="${c}"/>`);
  lines.push('    </g>');

  /* 数值标签：内容随时刻换，位置贴着条尾也随时刻换 */
  const valSeq = seq.map(s => s.texts.find(t => /[\d,]+\.\d/.test(t.s) && t.s.length > 2));
  if (valSeq.every(Boolean)) {
    const varsX = valSeq.map((v, k) => `--x${k}:${r2(v.x - valSeq[0].x)}px`).join(';');
    lines.push(`    <g class="vx" style="${varsX};transform:translateX(var(--x0))">`);
    valSeq.forEach((v, k) => {
      const anchor = k === 0 ? '' : `;opacity:0`;
      lines.push(`      <text class="sw" style="animation-delay:${r2(-CYCLE + k * (CYCLE / STEPS))}s${anchor}" ${textAttrs({ ...v, x: valSeq[0].x, y: v.y - base.y })}>${esc(v.s)}</text>`);
    });
    lines.push('    </g>');
  }

  L.push(`  <g class="b" style="${varsY};transform:translateY(var(--y0))">`);
  L.push(lines.join('\n'));
  L.push('  </g>');
}

L.push('</svg>');

const svg = L.join('\n') + '\n';
writeFileSync(join(ROOT, 'assets', 'banner.svg'), svg);
console.info(`assets/banner.svg ← ${WHICH}.json`);
console.info(`  时刻 i=${times.join(',')} | 动画条目 ${live.length}/${chart.items.length} | 切换层 ${swapBuckets.filter(b => b.length).length} 组 | ${svg.length} 字符`);
