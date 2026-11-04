/* ============================================================
 * ===== 数值刻度 =====
 * ============================================================ */

const LADDER = [1, 1.05, 1.1, 1.2, 1.25, 1.3, 1.4, 1.5, 1.6, 1.8, 2, 2.2, 2.5, 3, 4, 5, 6, 8, 10];

export function niceCeil(x) {
  if (x <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(x)));
  for (const m of LADDER) if (m * exp >= x) return m * exp;
  return 10 * exp;
}

/* 全正值时与旧实现一致（lo=0）；出现负值才向左扩张 */
export function niceDomain(vmin, vmax, pad = 1.06) {
  const hi = vmax > 0 ? niceCeil(vmax * pad) : 0;
  const lo = vmin < 0 ? -niceCeil(-vmin * pad) : 0;
  if (hi === 0 && lo === 0) return { lo: 0, hi: 1 };
  return { lo, hi };
}

export function tickStep(lo, hi, target = 5) {
  return niceCeil((hi - lo) / target);
}

export function tickValues(lo, hi, target = 5) {
  const step = tickStep(lo, hi, target);
  const out = [];
  for (let v = 0, k = 0; ; k++) {
    v = k * step;
    if (v > hi + 1e-9) break;
    out.push(v);
    if (k > 64) break;
  }
  for (let v = -step, k = 1; ; k++) {
    v = -k * step;
    if (v < lo - 1e-9) break;
    out.unshift(v);
    if (k > 64) break;
  }
  return { values: out, step };
}

export function fmtValue(n, decimals) {
  return n.toLocaleString('zh-CN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function fmtTick(n) {
  if (!Number.isFinite(n)) return '—';
  return Number.isInteger(n) ? n.toLocaleString('zh-CN') : String(+n.toFixed(2));
}
