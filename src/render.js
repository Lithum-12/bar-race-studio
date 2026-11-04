/* ============================================================
 * ===== 画布渲染 =====
 * ============================================================
 * 布局数字写在 design 坐标系（默认 1920×1080）里，实际画布尺寸
 * 不同时等比缩放并居中：导出 4K 不必重算一遍 plot / margin。
 * ============================================================ */

import { textOn, themeFrom } from './color.js';
import { makeFont, wrapByMeasure } from './text.js';
import { fmtValue, fmtTick, tickValues } from './scale.js';
import { periodLabel } from './time.js';
import { planLabels, resolveBarOrigin } from './layout.js';
import { isVisible, rankItems, refreshValues, valueBounds, stepDomain, periodIndex } from './series.js';

function rrPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  const rad = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

const easeOut = x => 1 - (1 - x) * (1 - x);

const radiusFor = (shape, barH) =>
  shape === 'none' ? 0
    : shape === 'large' ? Math.min(22, barH / 2)
    : shape === 'pill' ? barH / 2
    : Math.min(10, barH / 2);

/* 落在 [0, total] 内的事件周期才参与显示 */
function currentEvent(chart, t) {
  let best = -1;
  for (const ev of chart.cfg.events) {
    const idx = periodIndex(chart, ev.period);
    if (idx < 0 || idx > chart.total) continue;
    /* 提前半个周期淡入：停在最后一个周期时末尾事件仍然看得见 */
    if (t >= idx - 0.5 && t < idx + 3 && idx > best) best = idx;
  }
  if (best < 0) return null;
  const texts = chart.cfg.events
    .filter(ev => periodIndex(chart, ev.period) === best)
    .map(ev => String(ev.text));
  return { idx: best, text: texts.join('；') };
}

export function createScene(canvasEl) {
  const ctx = canvasEl.getContext('2d');
  const view = { dateKey: -1, datePop: 0 };

  return {
    canvas: canvasEl,
    ctx,

    size(w, h) {
      canvasEl.width = w;
      canvasEl.height = h;
    },

    snap() {
      view.dateKey = -1;
      view.datePop = 0;
    },

    draw(chart, t, dt, opts) {
      const o = opts || {};
      const cfg = chart.cfg;
      const st = cfg.style;
      const geo = cfg.layout;
      const gran = cfg.time.granularity;
      const F = makeFont(st);
      const sc = st.fontScale;

      const W = canvasEl.width;
      const H = canvasEl.height;
      const k = Math.min(W / geo.design.width, H / geo.design.height);
      const VW = W / k;
      const VH = H / k;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (!o.transparent) {
        ctx.fillStyle = st.bg;
        ctx.fillRect(0, 0, W, H);
      }
      ctx.setTransform(k, 0, 0, k, ((VW - geo.design.width) / 2) * k, ((VH - geo.design.height) / 2) * k);

      const T = themeFrom(st.bg);
      const L = geo.plot;

      refreshValues(chart, t);
      rankItems(chart);
      const bound = valueBounds(chart);
      const domain = stepDomain(chart, bound.vmin, bound.vmax, dt);

      const slotH = (L.bottom - L.top) / st.topN;
      const barH = Math.min(geo.bar.maxHeight, slotH * geo.bar.heightRatio);
      const iconS = Math.round(Math.min(36 * sc, barH * 0.62));
      const ease = 1 - Math.exp(-7 * dt);

      for (const it of chart.items) {
        const vis = isVisible(chart, it);
        const targetY = L.top + (vis ? it.rank : st.topN) * slotH + slotH / 2;
        const targetA = vis ? 1 : 0;
        if (!it.init) {
          it.animY = targetY;
          it.alpha = targetA;
          it.init = true;
        }
        it.animY += (targetY - it.animY) * ease;
        it.alpha += (targetA - it.alpha) * ease;
      }

      ctx.font = F('600', 23);
      let maxNameW = 0;
      for (const it of chart.items) maxNameW = Math.max(maxNameW, ctx.measureText(it.name).width);

      const barX = resolveBarOrigin({
        baseX: L.left, maxNameW, iconSize: iconS, anyIcon: st.iconPos !== 'none', style: st,
      });
      const plotW = L.right - barX;
      const unitW = plotW / (domain.hi - domain.lo);
      const zeroX = barX - domain.lo * unitW;

      /* ---------- 页眉 ---------- */
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      ctx.fillStyle = T.text;
      ctx.font = F('700', 40);
      ctx.fillText(cfg.title, geo.margin + 10, 88 * sc);
      if (cfg.subtitle) {
        ctx.fillStyle = T.muted;
        ctx.font = F('400', 20);
        ctx.fillText(cfg.subtitle, geo.margin + 10, 126 * sc);
      }

      const dIdx = Math.max(0, Math.min(chart.total, Math.round(t)));
      if (dIdx !== view.dateKey) {
        view.dateKey = dIdx;
        view.datePop = 1;
      }
      if (view.datePop > 0) view.datePop = Math.max(0, view.datePop - dt * 4);
      const dateTxt = periodLabel(chart.anchor, gran, dIdx);
      const dateX = VW - geo.margin - 10;
      const dateY = 112 * sc;
      ctx.save();
      ctx.textAlign = 'right';
      ctx.textBaseline = 'alphabetic';
      ctx.font = F('800', 66);
      ctx.fillStyle = T.text;
      if (st.dateAnim === 'pop') {
        ctx.translate(dateX, dateY);
        const zoom = 1 + 0.05 * easeOut(view.datePop);
        ctx.scale(zoom, zoom);
        ctx.fillText(dateTxt, 0, 0);
      } else if (st.dateAnim === 'fade') {
        ctx.globalAlpha = easeOut(1 - view.datePop);
        ctx.fillText(dateTxt, dateX, dateY);
      } else {
        ctx.fillText(dateTxt, dateX, dateY);
      }
      ctx.restore();

      /* ---------- 网格 ---------- */
      if (st.showGrid) {
        const { values } = tickValues(domain.lo, domain.hi, 5);
        ctx.font = F('500', 16);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (const v of values) {
          const gx = barX + v * unitW;
          ctx.strokeStyle = v === 0 ? T.grid0 : T.grid;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(gx, L.top - 16);
          ctx.lineTo(gx, L.bottom + 12);
          ctx.stroke();
          ctx.fillStyle = T.faint;
          ctx.fillText(fmtTick(v), gx, L.bottom + 20);
        }
        ctx.textBaseline = 'alphabetic';
      }
      ctx.textAlign = 'left';
      ctx.fillStyle = T.faint;
      ctx.font = F('400', 17);
      ctx.fillText('单位：' + cfg.unit, barX + 2, L.top - 24);

      /* ---------- 条形 ---------- */
      const RAD = radiusFor(st.barShape, barH);
      const ordered = [...chart.items].sort((a, b) => a.animY - b.animY);

      for (const it of ordered) {
        if (it.alpha <= 0.02 || it.v == null) continue;
        const y = it.animY;
        const by = y - barH / 2;
        const tipX = zeroX + it.v * unitW;
        const rectX = Math.min(zeroX, tipX);
        const rectW = Math.max(3, Math.abs(tipX - zeroX));

        ctx.globalAlpha = it.alpha;
        const valueText = fmtValue(it.v, cfg.time.decimals) + (cfg.unit ? ' ' + cfg.unit : '');
        const rankText = String(it.rank + 1);
        const onBar = textOn(it.color);
        const iconImg = st.iconPos === 'none' ? null : chart.icons.get(it.idx);

        ctx.font = F('600', 23);
        const nameW = ctx.measureText(it.name).width;
        ctx.font = F('700', 23);
        const valW = ctx.measureText(valueText).width;
        ctx.font = F('700', 26);
        const rankW = ctx.measureText(rankText).width;

        const plan = planLabels({
          rectX,
          rectW,
          canvasW: VW,
          iconSize: iconS,
          hasIcon: !!iconImg,
          showValue: st.showValue,
          widths: { rank: rankW, name: nameW, value: valW },
          style: st,
          geo: { padIn: geo.padIn, gapIn: geo.gapIn, gapOut: geo.gapOut, margin: geo.margin },
          nameText: it.name,
          measureName: txt => {
            ctx.font = F('600', 23);
            return ctx.measureText(txt).width;
          },
        });

        ctx.fillStyle = it.color;
        rrPath(ctx, rectX, by, rectW, barH, RAD);
        ctx.fill();

        const paint = p => {
          if (p.key === 'icon') {
            ctx.drawImage(iconImg, p.align === 'right' ? p.x - iconS : p.x, y - iconS / 2, iconS, iconS);
            return;
          }
          ctx.textBaseline = 'middle';
          ctx.textAlign = p.align;
          if (p.key === 'rank') {
            ctx.fillStyle = p.inside ? onBar : it.color;
            ctx.font = F('700', 26);
            ctx.fillText(rankText, p.x, y + 1);
          } else if (p.key === 'name') {
            ctx.fillStyle = p.inside ? onBar : T.nameOut;
            ctx.font = F('600', 23);
            ctx.fillText(p.text, p.x, y + 1);
          } else {
            ctx.fillStyle = p.inside ? onBar : T.valOut;
            ctx.font = F('700', 23);
            ctx.fillText(valueText, p.x, y + 1);
          }
        };

        if (plan.some(p => p.inside)) {
          ctx.save();
          rrPath(ctx, rectX, by, rectW, barH, RAD);
          ctx.clip();
          for (const p of plan) if (p.inside) paint(p);
          ctx.restore();
        }
        for (const p of plan) if (!p.inside) paint(p);
        ctx.globalAlpha = 1;
      }

      /* ---------- 大事件 ---------- */
      const ev = currentEvent(chart, t);
      if (ev) drawEventText(ctx, chart, ev, t, T, sc, F, VW, VH, geo);
    },
  };
}

/* 与日期同源的右对齐文字堆：发丝线 + 小号周期标题 + 大号事件文本。
   宽度限制在绘图区右侧的留白带里，这样无论多少行都不会压到条形。 */
function drawEventText(ctx, chart, ev, t, T, sc, F, VW, VH, geo) {
  const p = t - ev.idx;
  const ain = easeOut(Math.min(1, Math.max(0, (p + 0.5) / 0.5)));
  const aout = easeOut(Math.min(1, (3 - p) / 0.45));
  const alpha = Math.min(ain, aout);
  if (alpha <= 0.01) return;

  const tFont = F('700', 34);
  const cFont = F('500', 18);
  const widthOf = txt => {
    ctx.font = tFont;
    return ctx.measureText(txt).width;
  };
  const right = VW - geo.margin - 10;
  const maxW = Math.max(220, right - geo.plot.right);

  let lines = wrapByMeasure(ev.text, maxW, widthOf);
  if (lines.length > 4) {
    lines = lines.slice(0, 4);
    lines[3] = lines[3].slice(0, -1) + '…';
  }
  const caption = periodLabel(chart.anchor, chart.cfg.time.granularity, ev.idx) + ' · 大事件';

  ctx.font = cFont;
  let blockW = ctx.measureText(caption).width;
  for (const ln of lines) blockW = Math.max(blockW, widthOf(ln));

  const lineH = 40 * sc;
  const lastBase = VH - 30;
  const firstBase = lastBase - (lines.length - 1) * lineH;
  const capBase = firstBase - 32 * sc;
  const ruleY = capBase - 16 * sc;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';

  ctx.strokeStyle = T.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(right - blockW, ruleY);
  ctx.lineTo(right, ruleY);
  ctx.stroke();

  ctx.fillStyle = T.muted;
  ctx.font = cFont;
  ctx.fillText(caption, right, capBase);

  ctx.fillStyle = T.text;
  ctx.font = tFont;
  let y = firstBase;
  for (const ln of lines) {
    ctx.fillText(ln, right, y);
    y += lineH;
  }
  ctx.restore();
}
