/* ============================================================
 * ===== 字体与文字度量 =====
 * ============================================================ */

export const FONTS = {
  sans: '"PingFang SC","HarmonyOS Sans SC","Microsoft YaHei","Noto Sans SC",system-ui,"Segoe UI",sans-serif',
  serif: '"Songti SC","Noto Serif SC","STSong","SimSun",serif',
  kai: '"Kaiti SC","STKaiti","KaiTi",serif',
  mono: 'ui-monospace,"Cascadia Mono","SF Mono","PingFang SC","Microsoft YaHei",monospace',
  hei: '"Source Han Sans SC","Noto Sans SC","Microsoft YaHei","PingFang SC",sans-serif',
};

export const FONT_SCALE_KEYS = [0.82, 1, 1.2];

/* 字号全部经过这里，保证 scale 一处生效 */
export function makeFont(settings) {
  return (weight, px) =>
    weight + ' ' + Math.round(px * settings.fontScale) + 'px ' + (FONTS[settings.font] || FONTS.sans);
}

/* 逐字断行：中文没有空格，按词断会整段溢出 */
export function wrapByMeasure(text, maxW, measure) {
  const lines = [];
  let cur = '';
  for (const ch of String(text)) {
    if (cur && measure(cur + ch) > maxW) {
      lines.push(cur);
      cur = ch;
    } else {
      cur += ch;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}
