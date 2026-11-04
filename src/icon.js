/* ============================================================
 * ===== 品牌图标 =====
 * ============================================================ */

/* 未指定 icon 时按序号取一个白色图形叠在品牌色圆牌上 */
export const GLYPHS = [
  '<path d="M24 6C31 13 34 22 33 30H24Z"/><path d="M13 34H35L30 41H18Z"/>',
  '<path d="M8 30C13 20 22 15 40 14 36 20 34 26 33 31 24 35 14 35 8 30Z"/><path d="M12 38H32" stroke="#121311" stroke-width="3" fill="none" stroke-linecap="round"/>',
  '<path d="M24 5L27.5 20.5L43 24L27.5 27.5L24 43L20.5 27.5L5 24L20.5 20.5Z"/>',
  '<path d="M24 7L39 15V33L24 41L9 33V15Z"/><path d="M24 7V41M9 15L39 33M9 33L39 15" stroke="rgba(18,19,17,.35)" stroke-width="2.5" fill="none"/>',
  '<path d="M9 25C15 17 27 16 34 21L41 16L39 25L41 33L34 28C27 33 15 33 9 25Z"/><circle cx="16.5" cy="23" r="1.8" fill="#121311"/>',
  '<path d="M9 17H27A4.5 4.5 0 1 0 22.5 9M7 25H33A4.5 4.5 0 1 1 28.5 33M11 33H19" stroke="#121311" stroke-width="3.5" fill="none" stroke-linecap="round"/>',
  '<circle cx="24" cy="24" r="7"/><path d="M24 6V12M24 36V42M6 24H12M36 24H42M11 11L15.5 15.5M32.5 32.5L37 37M37 11L32.5 15.5M15.5 32.5L11 37" stroke="#121311" stroke-width="3.5" fill="none" stroke-linecap="round"/>',
  '<path d="M10 31A14 14 0 0 1 38 31Z"/><path d="M7 36.5H41" stroke="#121311" stroke-width="3.5" fill="none" stroke-linecap="round"/>',
  '<path d="M24 5C30 13 35 19 35 26A11 11 0 0 1 13 26C13 19 18 13 24 5Z"/><path d="M24 18C27 22 29 24 29 28A5 5 0 0 1 19 28C19 24 21 22 24 18Z" fill="#121311" opacity=".35"/>',
  '<path d="M24 10A14 14 0 1 1 10 24A10.5 10.5 0 1 0 24 13.5A7 7 0 1 1 17 20.5" stroke="#121311" stroke-width="3.5" fill="none" stroke-linecap="round"/>',
  '<path d="M8 20C12 16 16 16 20 20S28 24 32 20 38 16 40 18M8 29C12 25 16 25 20 29S28 33 32 29 38 25 40 27" stroke="#121311" stroke-width="3.5" fill="none" stroke-linecap="round"/>',
  '<path d="M24 6L38 19L24 42L10 19Z"/><path d="M10 19H38M24 6L18 19L24 42L30 19Z" stroke="rgba(18,19,17,.4)" stroke-width="2" fill="none"/>',
];

export function emblemSVG(color, glyph) {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">'
    + '<circle cx="24" cy="24" r="21.5" fill="' + color + '" stroke="#F7F4EC" stroke-width="3"/>'
    + '<g fill="#F7F4EC">' + glyph + '</g></svg>';
}

/* 内联 SVG 走 data URL；其余（png/svg 路径、http 地址）当普通资源引用 */
export function iconSrc(raw) {
  const s = String(raw).trim();
  if (/^<svg/i.test(s) || /^<image/i.test(s)) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
  }
  return s;
}

/* 图标是异步解码的：loaded 之前渲染跳过该图标，解码完成后下一帧自然出现 */
export function createIconStore() {
  const cache = new Map();

  return {
    request(key, raw) {
      if (!raw) {
        cache.delete(key);
        return;
      }
      const entry = cache.get(key);
      if (entry && entry.raw === raw) return;
      const img = new Image();
      const record = { raw, img, loaded: false };
      cache.set(key, record);
      img.onload = () => { record.loaded = true; };
      img.onerror = () => { record.loaded = false; record.failed = true; };
      img.src = iconSrc(raw);
    },

    get(key) {
      const e = cache.get(key);
      return e && e.loaded ? e.img : null;
    },
  };
}
