/* ============================================================
 * ===== 标签摆放引擎 =====
 * ============================================================
 * 纯函数：给定四个元素（排名 / 图标 / 名称 / 数值）各自的宽度与
 * 目标位置，算出最终绘制坐标。不碰 canvas，方便单独推理和测试。
 *
 * 位置语义按几何左右理解：条形矩形 [rectX, rectX+rectW] 的
 * 内侧左/右与外侧左/右。负值条形矩形整体在零轴左侧，
 * 因此「内部左侧」始终出现在视觉左侧，不会随正负翻转。
 *
 * 条内阅读顺序 [排名 图标 名称 数值]；
 * 条外自条形向外 [数值 图标 名称 排名]。
 * ============================================================ */

export const IN_ORDER = ['rank', 'icon', 'name', 'value'];
export const OUT_ORDER = ['value', 'icon', 'name', 'rank'];

const MIN_KEEP = 26;

export function planLabels(input) {
  const { rectX, rectW, canvasW, iconSize, hasIcon, widths, style, geo, nameText, measureName } = input;
  const { padIn, gapIn, gapOut, margin } = geo;
  const showValue = input.showValue !== false;

  const els = {
    rank: { key: 'rank', w: widths.rank, pos: style.rankPos },
    icon: { key: 'icon', w: iconSize, pos: hasIcon ? style.iconPos : null },
    name: { key: 'name', w: widths.name, pos: style.namePos, text: nameText },
    value: { key: 'value', w: showValue ? widths.value : 0, pos: showValue ? style.valuePos : null },
  };

  /* 数值 auto：条内右侧塞得下就进条内，否则走条外右侧 */
  if (els.value.pos === 'auto') {
    let occupied = padIn * 2;
    for (const k of IN_ORDER) {
      const e = els[k];
      if (e === els.value || !e.pos) continue;
      if (e.pos === 'inL' || e.pos === 'inR') occupied += e.w + gapIn;
    }
    els.value.pos = rectW - occupied - els.value.w >= 10 ? 'inR' : 'outR';
  }

  const blockWidth = pos => {
    let w = 0;
    for (const k of IN_ORDER) {
      const e = els[k];
      if (e.pos === pos) w += e.w + (w ? gapIn : 0);
    }
    return w;
  };

  const moveBlock = (from, to) => {
    for (const k of IN_ORDER) if (els[k].pos === from) els[k].pos = to;
  };

  let inL = blockWidth('inL');
  let inR = blockWidth('inR');
  /* 条内放不下：右侧整块先退到条外；左侧块仍放不下也退出去 */
  if (inL + inR + padIn * 2 > rectW + 2 && inR > 0) {
    moveBlock('inR', 'outR');
    inR = 0;
  }
  if (inL + padIn * 2 > rectW + 2 && inL > 0) {
    moveBlock('inL', 'outR');
    inL = 0;
  }

  const out = [];

  if (inL > 0) {
    let x = rectX + padIn;
    for (const k of IN_ORDER) {
      const e = els[k];
      if (e.pos !== 'inL') continue;
      out.push({ key: k, x, align: 'left', inside: true, text: e.text, w: e.w });
      x += e.w + gapIn;
    }
  }
  if (inR > 0) {
    let x = rectX + rectW - padIn - inR;
    for (const k of IN_ORDER) {
      const e = els[k];
      if (e.pos !== 'inR') continue;
      out.push({ key: k, x, align: 'left', inside: true, text: e.text, w: e.w });
      x += e.w + gapIn;
    }
  }

  /* 条外链的分配优先级：名称 > 数值 > 图标 > 排名。
     空间不够时先挤掉排名和图标，再截断名称，而不是按阅读顺序尾部丢弃。 */
  const SURVIVE = { name: 4, value: 3, icon: 2, rank: 1 };
  const chain = (pos, dir, startX, limit) => {
    let keep = OUT_ORDER.map(k => els[k]).filter(e => e && e.pos === pos);
    if (!keep.length) return;

    const total = () => keep.reduce((s, e) => s + e.w, 0) + gapOut * Math.max(0, keep.length - 1);
    while (keep.length > 1 && Math.abs(total()) > Math.abs(limit - startX)) {
      let worst = 0;
      for (let i = 1; i < keep.length; i++) {
        if (SURVIVE[keep[i].key] < SURVIVE[keep[worst].key]) worst = i;
      }
      keep.splice(worst, 1);
    }

    const nameEl = keep.find(e => e.key === 'name');
    if (nameEl) {
      const others = total() - nameEl.w - (keep.length > 1 ? gapOut : 0);
      const budget = Math.abs(limit - startX) - others - (keep.length > 1 ? gapOut : 0);
      const full = measureName(nameEl.text);
      if (full > budget) {
        if (budget < MIN_KEEP) {
          keep = keep.filter(e => e !== nameEl);
        } else {
          nameEl.text = shrink(nameEl.text, budget, measureName);
          nameEl.w = measureName(nameEl.text);
        }
      }
    }
    if (!keep.length) return;

    let x = startX;
    for (const e of keep) {
      if (dir > 0 ? x + e.w > limit : x - e.w < limit) break;
      out.push({ key: e.key, x, align: dir > 0 ? 'left' : 'right', inside: false, text: e.text, w: e.w });
      x += dir * (e.w + gapOut);
    }
  };

  chain('outR', 1, rectX + rectW + gapOut, canvasW - margin);
  chain('outL', -1, rectX - gapOut, margin);

  return out;
}

function shrink(text, avail, measure) {
  if (measure(text) <= avail) return text;
  let cut = text;
  while (cut.length > 1 && measure(cut + '…') > avail) cut = cut.slice(0, -1);
  return cut + '…';
}

/* 条形基准 x：名称/图标若都在条外左侧，整体右移腾出列宽 */
export function resolveBarOrigin(input) {
  const { baseX, maxNameW, iconSize, anyIcon, style } = input;
  return baseX
    + (style.namePos === 'outL' ? maxNameW + 30 : 0)
    + (style.iconPos === 'outL' && anyIcon ? iconSize + 26 : 0);
}
