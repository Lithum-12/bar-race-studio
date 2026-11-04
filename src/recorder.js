/* ============================================================
 * ===== 导出 =====
 * ============================================================
 * 用一个离屏画布按导出规格重新渲染，预览窗口不受分辨率影响。
 * 逐帧驱动 captureStream(0) + track.requestFrame()：每帧一定被
 * 采到，不会因主线程卡顿丢帧；同时按墙钟节奏推进，保证视频时长
 * 与设定一致。
 * ============================================================ */

import { createScene } from './render.js';
import { buildZip } from './zip.js';

export function supportedMime(prefer) {
  if (!window.MediaRecorder) return null;
  const cands = prefer === 'mp4'
    ? ['video/mp4;codecs=avc1', 'video/mp4']
    : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
  for (const m of cands) {
    try {
      if (MediaRecorder.isTypeSupported(m)) return m;
    } catch (e) {
      /* isTypeSupported 在个别旧内核会抛，跳过即可 */
    }
  }
  return null;
}

function canExport() {
  return !!(window.MediaRecorder && HTMLCanvasElement.prototype.captureStream);
}

const sleep = ms => new Promise(r => setTimeout(r, Math.max(0, ms)));

function makeExportCanvas(width, height) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c;
}

/* 逐帧推进：frameCount = duration * fps，dt 固定使平滑动画可复现 */
async function runFrames(canvas, chart, spec, onProgress, paintFrame, signal) {
  const scene = createScene(canvas);
  const frameCount = Math.max(2, Math.round(spec.duration * spec.fps));
  const dt = 1 / spec.fps;
  const startedAt = performance.now();

  for (let f = 0; f <= frameCount; f++) {
    if (signal && signal.aborted) throw new DOMException('已取消', 'AbortError');
    const t = (f / frameCount) * chart.total;
    scene.draw(chart, t, dt, { transparent: spec.transparent });
    if (paintFrame) await paintFrame(f, canvas);

    const due = startedAt + (f / frameCount) * spec.duration * 1000;
    const wait = due - performance.now();
    if (wait > 0) await sleep(wait);
    if (onProgress && f % 5 === 0) onProgress(f / frameCount);
  }
  return frameCount;
}

export async function exportVideo(chart, spec, onProgress, signal) {
  if (!canExport()) throw new Error('当前浏览器不支持录制，请用桌面版 Chrome 或 Edge');
  const mime = supportedMime(spec.format);
  if (!mime) throw new Error('未找到可用的视频编码，试试把导出格式换成 webm');

  const canvas = makeExportCanvas(spec.width, spec.height);
  const stream = canvas.captureStream(0);
  const track = stream.getVideoTracks()[0];
  const chunks = [];
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: spec.bitrateMbps * 1e6 });
  rec.ondataavailable = e => {
    if (e.data && e.data.size) chunks.push(e.data);
  };
  const done = new Promise(resolve => {
    rec.onstop = resolve;
  });

  rec.start(400);
  try {
    await runFrames(canvas, chart, spec, onProgress, async () => {
      track.requestFrame();
      await sleep(0);
    }, signal);
    /* 结尾多留半秒，让最后一帧在成片里站得住 */
    await sleep(500);
    track.requestFrame();
  } finally {
    if (rec.state !== 'inactive') rec.stop();
    track.stop();
  }
  await done;

  const blob = new Blob(chunks, { type: mime.split(';')[0] });
  return { blob, ext: mime.indexOf('mp4') >= 0 ? 'mp4' : 'webm' };
}

/* PNG 序列：能拿到目录句柄就逐个流式落盘，否则攒成 zip */
export async function exportPngSequence(chart, spec, onProgress, signal) {
  const canvas = makeExportCanvas(spec.width, spec.height);
  const prefix = spec.basename + '_';
  const dir = typeof window.showDirectoryPicker === 'function' ? await pickDirectory() : null;
  const frames = Math.max(2, Math.round(spec.duration * spec.fps));

  if (!dir) {
    /* zip 要整包留在内存里，按总像素预算限帧：约 1.2 Gpixel 的 PNG 源 */
    const budget = 1.2e9;
    const max = Math.max(60, Math.min(4000, Math.floor(budget / (spec.width * spec.height))));
    if (frames > max) {
      throw new Error('没拿到文件夹，只能打包成 zip；当前 ' + spec.width + '×' + spec.height
        + ' × ' + frames + ' 帧超出内存预算，最多 ' + max + ' 帧。'
        + '请降低帧率或时长，或由真人点击「导出」以便选择文件夹');
    }
  }

  const parts = [];
  await runFrames(canvas, chart, spec, onProgress, async (f, c) => {
    const blob = await new Promise(res => c.toBlob(res, 'image/png'));
    const name = prefix + String(f).padStart(5, '0') + '.png';
    if (dir) {
      const fh = await dir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
    } else {
      parts.push({ name, blob });
    }
  }, signal);

  if (dir) return { kind: 'folder' };
  const blob = await buildZip(parts);
  return { kind: 'zip', blob, count: parts.length };
}

export async function pickDirectory() {
  try {
    return await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch (e) {
    if (e && e.name === 'AbortError') throw e;
    return null;
  }
}

export async function exportStill(chart, spec, t, which) {
  const canvas = makeExportCanvas(spec.width, spec.height);
  const scene = createScene(canvas);
  scene.draw(chart, t, 1 / spec.fps, { transparent: which === 'transparent' });
  return new Promise(res => canvas.toBlob(res, 'image/png'));
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
