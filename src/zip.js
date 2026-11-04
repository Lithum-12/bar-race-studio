/* ============================================================
 * ===== ZIP（store，不压缩）=====
 * ============================================================
 * PNG 已经压过一道，再上 deflate 只是白烧 CPU。
 * 手写 store 模式约 60 行，换来「不依赖目录句柄也能出序列帧」。
 * ============================================================ */

const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d) {
  const year = Math.max(1980, d.getFullYear());
  const date = ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  return { time, date };
}

const enc = new TextEncoder();

function u16(n) {
  return [n & 0xff, (n >> 8) & 0xff];
}

function u32(n) {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
}

/* entries: [{ name, blob }] -> 单个 zip Blob */
export async function buildZip(entries) {
  const now = dosDateTime(new Date());
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const { name, blob } of entries) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const sum = crc32(bytes);
    const nb = enc.encode(name);

    const head = new Uint8Array([
      ...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0),
      ...u16(now.time), ...u16(now.date),
      ...u32(sum), ...u32(bytes.length), ...u32(bytes.length),
      ...u16(nb.length), ...u16(0),
    ]);
    locals.push(head, nb, bytes);

    centrals.push(new Uint8Array([
      ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0),
      ...u16(now.time), ...u16(now.date),
      ...u32(sum), ...u32(bytes.length), ...u32(bytes.length),
      ...u16(nb.length), ...u16(0), ...u16(0),
      ...u16(0), ...u16(0), ...u32(0), ...u32(offset),
    ]));
    centrals.push(nb);

    offset += head.length + nb.length + bytes.length;
  }

  const cdSize = centrals.reduce((s, p) => s + p.length, 0);
  const eocd = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(entries.length), ...u16(entries.length),
    ...u32(cdSize), ...u32(offset), ...u16(0),
  ]);

  return new Blob([...locals, ...centrals, eocd], { type: 'application/zip' });
}
