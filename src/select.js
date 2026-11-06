/* ============================================================
 * ===== 自定义下拉 =====
 * ============================================================
 * 原生 select 的弹出层画不出色样，也无法统一三态，所以自己做。
 * 对外保持和 select 一样的用法：host.value 读写、change 事件冒泡，
 * 这样 app.js 里原来的 on(id, t => t.value) 一行都不用改。
 * ============================================================ */

const CARET = '<svg class="sel-caret" viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">'
  + '<path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

const registry = new WeakMap();

/* 颜色要插进 style 属性，而画布背景的色值来自用户配置，
   所以在这里按十六进制白名单过一遍，不合格就不画色块。 */
const HEX = /^#[0-9a-fA-F]{3,8}$/;
const safe = c => (typeof c === 'string' && HEX.test(c) ? c : null);

function sample(meta) {
  if (!meta) return '';
  if (meta.colors) {
    const cols = meta.colors.map(safe).filter(Boolean);
    if (!cols.length) return '';
    return '<span class="sel-strip">'
      + cols.map(c => '<i style="background:' + c + '"></i>').join('') + '</span>';
  }
  const c = safe(meta.color);
  return c ? '<span class="sel-chip" style="background:' + c + '"></span>' : '';
}

function mount(host) {
  const st = {
    host, pairs: [], value: '', active: 0, open: false,
    onChange: null,
  };
  host.classList.add('sel');
  host.innerHTML =
    '<button type="button" class="sel-btn" role="combobox" aria-expanded="false" aria-haspopup="listbox">'
    + '<span class="sel-face"></span>' + CARET + '</button>'
    + '<div class="sel-list" role="listbox" tabindex="-1" hidden></div>';

  st.btn = host.querySelector('.sel-btn');
  st.face = host.querySelector('.sel-face');
  st.list = host.querySelector('.sel-list');

  Object.defineProperty(host, 'value', {
    configurable: true,
    get() { return st.value },
    set(v) { st.value = String(v); paintFace(st); markSelected(st); },
  });

  st.btn.addEventListener('click', () => toggle(st, !st.open));
  st.btn.addEventListener('keydown', e => onKey(st, e));
  st.list.addEventListener('pointerdown', e => {
    const row = e.target.closest('[role="option"]');
    if (row) pick(st, Number(row.dataset.i));
  });
  document.addEventListener('pointerdown', e => {
    if (st.open && !host.contains(e.target)) toggle(st, false);
  });

  registry.set(host, st);
  return st;
}

function toggle(st, open) {
  if (st.open === open) return;
  st.open = open;
  st.host.classList.toggle('is-open', open);
  st.list.hidden = !open;
  st.btn.setAttribute('aria-expanded', String(open));
  if (!open) { st.btn.focus(); return; }
  st.active = Math.max(0, st.pairs.findIndex(p => String(p[0]) === st.value));
  paintActive(st);
  place(st);
  const row = st.list.children[st.active];
  if (row) row.scrollIntoView({ block: 'nearest' });
}

/* 下方放不下就朝上开：向下展开会把文档顶高，首页底部那条下拉一开整页都往下跳。
   可用空间要按最近的滚动容器算——抽屉里的 .body 是 overflow:auto，
   列表超出它会被裁掉（画布背景那排色板就是这么跑出窗口的），跟 innerHeight 比不够。 */
function scrollport(el) {
  for (let n = el.parentElement; n; n = n.parentElement) {
    const o = getComputedStyle(n).overflowY;
    if (o === 'auto' || o === 'scroll' || o === 'hidden') {
      const r = n.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom };
    }
  }
  return { top: 0, bottom: innerHeight };
}

function place(st) {
  const box = scrollport(st.list);
  const r = st.btn.getBoundingClientRect();
  const below = box.bottom - r.bottom;
  const above = r.top - box.top;
  const up = st.list.offsetHeight > below && above > below;
  st.host.classList.toggle('is-up', up);
  /* 一侧装不下完整列表就收到那一侧放得下的高度，多出来的行用列表自己的滚动 */
  st.list.style.maxHeight = Math.max(90, Math.min(232, (up ? above : below) - 8)) + 'px';
}

function pick(st, i) {
  const p = st.pairs[i];
  if (!p) return;
  st.value = String(p[0]);
  paintFace(st);
  markSelected(st);
  toggle(st, false);
  st.host.dispatchEvent(new CustomEvent('change', { bubbles: true }));
}

function onKey(st, e) {
  const n = st.pairs.length;
  if (!n) return;
  const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape', 'Tab'];
  if (!keys.includes(e.key)) return;
  e.preventDefault();
  if (!st.open) {
    if (e.key === 'Escape') return;
    toggle(st, true);
    if (e.key === 'ArrowUp') { st.active = n - 1; paintActive(st); }
    return;
  }
  if (e.key === 'Escape' || e.key === 'Tab') { toggle(st, false); return; }
  if (e.key === 'Enter' || e.key === ' ') { pick(st, st.active); return; }
  const step = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
  st.active = e.key === 'Home' ? 0
    : e.key === 'End' ? n - 1
    : (st.active + step + n) % n;
  paintActive(st);
  st.list.children[st.active]?.scrollIntoView({ block: 'nearest' });
}

function paintActive(st) {
  [...st.list.children].forEach((row, i) => {
    row.classList.toggle('is-active', i === st.active);
    row.setAttribute('aria-selected', String(String(st.pairs[i][0]) === st.value));
  });
  st.btn.setAttribute('aria-activedescendant', st.list.children[st.active]?.id || '');
}

function markSelected(st) {
  [...st.list.children].forEach((row, i) =>
    row.setAttribute('aria-selected', String(String(st.pairs[i][0]) === st.value)));
}

function paintFace(st) {
  const hit = st.pairs.find(p => String(p[0]) === st.value);
  const label = hit ? hit[1] : st.value;
  const meta = hit && hit[2];
  const slot = !meta && st.pairs.some(p => p[2]) ? '<span class="sel-chip is-empty"></span>' : '';
  st.face.innerHTML = (meta ? sample(meta) : slot)
    + '<span class="sel-text">' + esc(label) + '</span>';
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* 值不在候选里就补一条再排序，省掉调用方每次手写这段 */
export function setOptions(host, pairs, value) {
  const st = registry.get(host) || mount(host);
  let list = pairs.map(p => [String(p[0]), p[1], p[2]]);
  const want = value === undefined || value === null ? st.value : String(value);
  if (want && !list.some(p => p[0] === want)) {
    list = [...list, [want, want, null]].sort((a, b) => Number(a[0]) - Number(b[0]) || (a[0] < b[0] ? -1 : 1));
  }
  st.pairs = list;
  st.value = want || (list[0] ? list[0][0] : '');
  /* 只要有一个候选带色样，其余行也要占同样的槽位，否则文字左边缘对不齐 */
  const slot = list.some(p => p[2]) ? '<span class="sel-chip is-empty"></span>' : '';
  st.list.innerHTML = list.map((p, i) =>
    '<div role="option" class="sel-row" id="' + host.id + '-o' + i + '" data-i="' + i + '">'
    + (p[2] ? sample(p[2]) : slot) + '<span class="sel-text">' + esc(p[1]) + '</span>'
    + (p[2] && p[2].note ? '<span class="sel-note">' + esc(p[2].note) + '</span>' : '')
    + '</div>').join('');
  paintFace(st);
  markSelected(st);
  return st;
}
