/* ============================================================
 * ===== 时间轴：粒度换算 =====
 * ============================================================
 * 内部一律用「周期序号 i」（0..TOTAL）表示时间，
 * 粒度只影响 i ↔ 日期 ↔ 标签 的换算，动画与数据层不感知粒度。
 * ============================================================ */

export const GRANULARITIES = ['year', 'quarter', 'month', 'day'];

export const GRAN_LABEL = {
  year: '年',
  quarter: '季度',
  month: '月',
  day: '日',
};

/* 每种粒度的起始字符串样式，同时用于校验 */
const PATTERN = {
  year: /^(\d{4})$/,
  quarter: /^(\d{4})-Q([1-4])$/,
  month: /^(\d{4})-(\d{1,2})$/,
  day: /^(\d{4})-(\d{1,2})-(\d{1,2})$/,
};

export function startHint(gran) {
  return { year: 'YYYY', quarter: 'YYYY-Qn', month: 'YYYY-MM', day: 'YYYY-MM-DD' }[gran];
}

export function parseStart(gran, raw) {
  const m = PATTERN[gran].exec(String(raw).trim());
  if (!m) return null;
  const y = +m[1];
  let d;
  if (gran === 'year') d = new Date(y, 0, 1);
  else if (gran === 'quarter') d = new Date(y, (+m[2] - 1) * 3, 1);
  else if (gran === 'month') d = new Date(y, +m[2] - 1, 1);
  else d = new Date(y, +m[2] - 1, +m[3]);

  /* Date 会把 13 月、2 月 30 日这类输入顺延到下一个周期，回读对不上就说明是非法周期 */
  if (d.getFullYear() !== y) return null;
  if (gran === 'month' && d.getMonth() + 1 !== +m[2]) return null;
  if (gran === 'day' && (d.getMonth() + 1 !== +m[2] || d.getDate() !== +m[3])) return null;
  return d;
}

function shift(anchor, gran, i) {
  if (gran === 'year') return new Date(anchor.getFullYear() + i, anchor.getMonth(), 1);
  if (gran === 'quarter') return new Date(anchor.getFullYear(), anchor.getMonth() + i * 3, 1);
  if (gran === 'month') return new Date(anchor.getFullYear(), anchor.getMonth() + i, 1);
  return new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + i);
}

const pad2 = n => String(n).padStart(2, '0');

export function periodKey(anchor, gran, i) {
  const d = shift(anchor, gran, i);
  const y = d.getFullYear();
  if (gran === 'year') return String(y);
  if (gran === 'quarter') return y + '-Q' + (Math.floor(d.getMonth() / 3) + 1);
  if (gran === 'month') return y + '-' + pad2(d.getMonth() + 1);
  return y + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

export function periodLabel(anchor, gran, i) {
  const d = shift(anchor, gran, i);
  const y = d.getFullYear();
  if (gran === 'year') return y + '年';
  if (gran === 'quarter') return y + '年Q' + (Math.floor(d.getMonth() / 3) + 1);
  if (gran === 'month') return y + '年' + (d.getMonth() + 1) + '月';
  return y + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
}

/* 周期序号：key 非法或早于起点返回 null，交给上层报错而不是静默兜底 */
export function periodIndexOf(anchor, gran, key) {
  const d = parseStart(gran, key);
  if (!d) return null;
  const a = anchor;
  if (gran === 'day') {
    const ms = d - a;
    return Math.round(ms / 86400000);
  }
  const dm = (d.getFullYear() - a.getFullYear()) * 12 + (d.getMonth() - a.getMonth());
  if (gran === 'year') return Math.floor(dm / 12);
  if (gran === 'quarter') return dm % 3 === 0 ? dm / 3 : null;
  return dm;
}

/* 时间轴刻度：major 带年份文字，minor 只画一道短线 */
export function periodTick(anchor, gran, i) {
  const d = shift(anchor, gran, i);
  const isJan = d.getMonth() === 0;
  if (gran === 'year') {
    return d.getFullYear() % 5 === 0
      ? { major: true, text: String(d.getFullYear()) }
      : { major: false, text: '' };
  }
  if (gran === 'day') {
    if (d.getDate() === 1 && isJan) return { major: true, text: String(d.getFullYear()) };
    return d.getDate() === 1 ? { major: false, text: '' } : null;
  }
  return isJan ? { major: true, text: String(d.getFullYear()) } : null;
}
