/* ============================================================
 * ===== 配色：数据色板 + 画布主题 =====
 * ============================================================ */

export const PALETTES = {
  jewel: {
    label: '宝石色',
    colors: ['#3B6FE0', '#0E9F8C', '#D9542F', '#7A5AF8', '#D6406E', '#2FA35C',
      '#C08A1E', '#5C7A99', '#3FA7D6', '#A2653A', '#B23A48', '#64748B',
      '#8B7AC4', '#4E8D6E'],
  },
  ocean: {
    label: '深海蓝紫',
    colors: ['#2B5FAD', '#3E8ED0', '#6C63D2', '#8A4FBF', '#279A93', '#3F6C9E',
      '#5B8DB8', '#7A6FC4', '#2E7DA6', '#4C77B2', '#6E5FB8', '#52708F',
      '#8B7AC4', '#3D8A80'],
  },
  vivid: {
    label: '明亮活力',
    colors: ['#E0533F', '#E8940F', '#2A9D8F', '#D9A404', '#9B5DE5', '#0090C9',
      '#E24C8B', '#0FA37F', '#C4326E', '#5B7CFA', '#B5651D', '#4C9F70',
      '#C24914', '#3E7CB1'],
  },
  morandi: {
    label: '莫兰迪低饱和',
    colors: ['#A8958E', '#9AA5A0', '#B3A6C9', '#C2A878', '#8FA3AD', '#C4A3A3',
      '#A3B18A', '#B0A4A0', '#8E9AAF', '#BCA37F', '#93A8AC', '#A79E8E',
      '#AFB9C2', '#9C8F9F'],
  },
  print: {
    label: '印刷墨阶',
    colors: ['#2B2A26', '#4A473F', '#6B675C', '#8C8778', '#A9A392', '#C3BCA6',
      '#8A3B2A', '#B4553A', '#D08A5F', '#3F5D50', '#5E8273', '#87A294',
      '#4A5A78', '#7C8AA6'],
  },
  field: {
    label: '田野色系',
    colors: ['#7A9E4E', '#C9773A', '#3D7C8C', '#A8455E', '#D4B23E', '#5B7F6A',
      '#9A6242', '#46688A', '#B08A4E', '#6E9370', '#8C5C7A', '#3F7A63',
      '#C06A4F', '#7D8FA4'],
  },
};

export function normalizeHex(input) {
  const s = String(input).trim();
  const short = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/.exec(s);
  if (short) return '#' + [1, 2, 3].map(k => short[k] + short[k]).join('');
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s;
  return null;
}

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/* sRGB 感知亮度，0~255，用于判断背景整体明暗 */
export function brightness(hex) {
  const c = hexToRgb(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

function channel(v) {
  const x = v / 255;
  return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex) {
  const c = hexToRgb(hex);
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/* 条内文字：取与条形对比更高的一侧，而不是拍一个固定阈值 */
export function textOn(barHex) {
  const ink = '#1C1B19';
  const paper = '#FFFFFF';
  return contrastRatio(barHex, ink) >= contrastRatio(barHex, paper) ? ink : paper;
}

export function themeFrom(bgHex) {
  return brightness(bgHex) > 140 ? {
    text: '#1C1B19', muted: '#6B675F', faint: '#8A857B',
    grid: 'rgba(28,27,25,.14)', grid0: 'rgba(28,27,25,.38)',
    nameOut: '#2A2823', valOut: '#1C1B19',
    cardBg: 'rgba(255,255,255,.94)', cardBorder: 'rgba(28,27,25,.16)',
    cardText: '#1C1B19', cardSub: '#6B675F',
  } : {
    text: '#F2EFE7', muted: '#A9A498', faint: '#7E7A70',
    grid: 'rgba(242,239,231,.13)', grid0: 'rgba(242,239,231,.34)',
    nameOut: '#E7E3D9', valOut: '#F7F4EC',
    cardBg: 'rgba(20,19,17,.9)', cardBorder: 'rgba(242,239,231,.2)',
    cardText: '#F7F4EC', cardSub: '#A9A498',
  };
}

export const BG_PRESETS = [
  { color: '#121311', label: '墨黑' },
  { color: '#0A0A09', label: '纯黑' },
  { color: '#0E1512', label: '松墨绿' },
  { color: '#F4F1EA', label: '纸白' },
  { color: '#FFFFFF', label: '亮白' },
  { color: '#EDE6D6', label: '米黄' },
];
