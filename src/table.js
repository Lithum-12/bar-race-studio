/* ============================================================
 * ===== 表格 → 配置 =====
 * ============================================================
 * 做这种图的人手里是 Excel/WPS，不是 JSON。这里把 CSV/TSV
 * （以及直接从表格复制的剪贴板文本）翻成配置对象，之后走的还是
 * normalizeConfig + validateConfig 那条路：解析器不生产第二套真相。
 *
 * 两种表形自动判别：
 *   宽表  名称,2024-01,2024-02,...      手工排行表
 *   长表  名称,周期,数值                 透视表 / 数据库导出
 * 空格子 = 该周期没有数据，和手写 null 同义（条目会入场或退场）。
 * ============================================================ */

import { GRANULARITIES, parseStart, periodIndexOf } from './time.js';

/* 表格里常见的写法先归一到 PATTERN 认得的形状，再交给 parseStart 判定 */
function canonPeriod(cell) {
  const s = String(cell).trim().replace(/\s+/g, '');
  if (!s) return '';
  const cn = s.replace(/年/g, '-').replace(/月/g, '-').replace(/日/g, '').replace(/季度/g, 'Q');
  const flat = cn.replace(/^(\d{4})Q([1-4])$/i, '$1-Q$2');
  return flat.replace(/[/._]/g, '-').replace(/-$/, '');
}

/* 逐个粒度试：全部表头都能解析才算这个粒度 */
export function sniffGranularity(tokens) {
  const cells = tokens.map(canonPeriod);
  if (!cells.length || cells.some(c => !c)) return null;
  for (const gran of ['day', 'month', 'quarter', 'year']) {
    if (cells.every(c => parseStart(gran, c))) return gran;
  }
  return null;
}

/* 数字格子：千分位、全角逗号、货币符号、空格都算噪声；
   空 = null（没数据）；带万/亿/% 的一律报错，让它们去改表而不是我替他们猜量级 */
export function parseNumber(cell) {
  const raw = String(cell).trim();
  if (raw === '' || /^[-–—]$/u.test(raw) || /^(n\/?a|null|无|空)$/i.test(raw)) return { value: null };
  if (/[万一%‰]|￥|¥|\$|€|£/u.test(raw)) {
    return { value: null, bad: raw, unitish: true };
  }
  const cleaned = raw.replace(/[，,]/g, '').replace(/¥|￥|\$|€|£/g, '').replace(/\s/g, '');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(cleaned)) return { value: null, bad: raw };
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return { value: null, bad: raw };
  return { value: n, digits: digitsOf(cleaned) };
}

function digitsOf(s) {
  const m = /\.(\d+)/.exec(s);
  return m ? m[1].length : 0;
}

/* RFC4180 的引号规则：引号内的分隔符和换行属于格子本身 */
export function splitRows(text, delim) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === delim) { row.push(cell); cell = ''; continue; }
    if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    if (c === '\r') {
      if (src[i + 1] !== '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      continue;
    }
    cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(v => String(v).trim() !== ''));
}

export function sniffDelimiter(text) {
  const line = text.replace(/^\uFEFF/, '').split(/\r?\n/).find(l => l.trim() !== '') || '';
  const score = d => (line.split(d).length - 1);
  const best = [['\t', score('\t')], [',', score(',')], [';', score(';')], ['|', score('|')]]
    .sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ',';
}

/* ---------- 主入口 ---------- */
export function tableToConfig(text, name) {
  const problems = [];
  const src = String(text || '');
  if (!src.trim()) return { cfg: null, problems: [{ path: name, message: '没有读到内容' }] };

  const delim = sniffDelimiter(src);
  const rows = splitRows(src, delim);
  if (rows.length < 2) {
    return { cfg: null, problems: [{ path: name, message: '只读到 ' + rows.length + ' 行，至少要一行表头加一行数据' }] };
  }

  const head = rows[0].map(c => String(c).trim());
  const body = rows.slice(1);
  const shape = detectShape(head, body);

  if (!shape) {
    return { cfg: null, problems: [{
      path: name,
      message: '认不出表形。宽表要「名称, 2024-01, 2024-02, …」，长表要「名称, 周期, 数值」三列；'
        + '周期写 2024 / 2024-Q1 / 2024-01 / 2024-01-05 这几种都认。',
    }] };
  }

  const { gran, series } = shape;
  const start = shape.start;
  const digits = shape.digits;

  const seen = new Set();
  for (const s of series) {
    if (!s.name) { problems.push({ path: 'series', message: '有一行名称是空的，已跳过' }); continue; }
    if (seen.has(s.name)) {
      problems.push({ path: 'series[' + s.name + ']', message: '名称「' + s.name + '」在表里出现两次，第二条会被图上当成同名两条' });
    }
    seen.add(s.name);
  }
  const kept = series.filter(s => s.name);
  if (kept.length < 2) {
    problems.push({ path: 'series', message: '只有 ' + kept.length + ' 条数据，条形对比至少两条才看得出排名变化' });
  }
  if (shape.bad.length) {
    const sample = shape.bad.slice(0, 3).map(b => '「' + b.cell + '」在第 ' + b.row + ' 行').join('、');
    problems.push({
      path: 'values',
      message: (shape.bad.length) + ' 个格子不是纯数字：' + sample
        + (shape.bad.some(b => b.unitish) ? '。带 万/亿/% 或货币符号的请先在表格里去掉，量级和单位写进「单位」字段' : ''),
    });
  }

  const cfg = {
    title: name,
    subtitle: '',
    unit: '',
    time: { granularity: gran, start, decimals: digits },
    series: kept.map(s => ({ name: s.name, values: s.values })),
    events: [],
  };
  return { cfg, problems };
}

/* 判别表形并展开成 series；返回 null 表示不像任何一种 */
function detectShape(head, body) {
  /* 只有一列周期也接：单期快照表先建起来，再往右加列是常见用法 */
  const wideGran = head.length > 1 ? sniffGranularity(head.slice(1)) : null;
  if (wideGran) {
    const keys = head.slice(1).map(canonPeriod);
    const anchor = parseStart(wideGran, keys[0]);
    const series = [];
    const bad = [];
    let digits = 0;
    body.forEach((r, ri) => {
      const cells = r.slice(1);
      /* 表头几列就取几列；多出来的列说明数字里有未加引号的千分位逗号 */
      if (cells.length > keys.length) {
        bad.push({ cell: r.slice(1).join(','), row: ri + 2 });
        return;
      }
      const values = keys.map((k, ci) => {
        const p = parseNumber(cells[ci] === undefined ? '' : cells[ci]);
        if (p.bad) bad.push({ cell: p.bad, row: ri + 2, unitish: p.unitish });
        if (p.digits) digits = Math.max(digits, p.digits);
        return p.value;
      });
      series.push({ name: String(r[0] || '').trim(), values });
    });
    const ok = series.filter(s => s.values.some(v => v != null));
    if (!ok.length) return null;
    return { gran: wideGran, start: keys[0], series: ok, digits: Math.min(4, digits), bad };
  }

  /* 长表：三列，且中间一列整列都是周期 */
  const width = Math.max(head.length, ...body.map(r => r.length));
  if (width === 3) {
    const col = body.map(r => r[1]);
    const gran = sniffGranularity(col);
    if (gran) {
      const keys = col.map(canonPeriod);
      const order = [...new Set(keys)].sort((a, b) => periodIndexOf(parseStart(gran, keys[0]), gran, a) - periodIndexOf(parseStart(gran, keys[0]), gran, b));
      const byName = new Map();
      const bad = [];
      let digits = 0;
      body.forEach((r, ri) => {
        const nm = String(r[0] || '').trim();
        if (!nm) { bad.push({ cell: '(空)', row: ri + 2 }); return; }
        if (!byName.has(nm)) byName.set(nm, new Map());
        const p = parseNumber(r[2]);
        if (p.bad) bad.push({ cell: p.bad, row: ri + 2, unitish: p.unitish });
        if (p.digits) digits = Math.max(digits, p.digits);
        byName.get(nm).set(keys[ri], p.value);
      });
      const series = [...byName].map(([nm, m]) => ({ name: nm, values: order.map(k => (m.has(k) ? m.get(k) : null)) }));
      if (!series.length) return null;
      return { gran, start: order[0], series, digits: Math.min(4, digits), bad };
    }
  }
  return null;
}
