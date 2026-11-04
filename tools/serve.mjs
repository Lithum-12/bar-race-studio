#!/usr/bin/env node
/* ============================================================
 * ===== 本地服务 =====
 * ============================================================
 * 静态服务 + config 读写 + 文件监听热更新。
 * 只用 node 标准库，不装任何依赖。
 * ============================================================ */

import { createServer } from 'node:http';
import { createReadStream, promises as fsp, watch, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname, extname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CFG = join(ROOT, 'config');

const arg = name => {
  const i = process.argv.indexOf('--' + name);
  return i > -1 ? process.argv[i + 1] : null;
};
const PORT = Number(arg('port') || process.env.PORT || 5278);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/* 数据集名只允许这种形状，且解析后必须仍落在 config 里 */
const SAFE = /^[\w\u4e00-\u9fa5.-]+$/;

function configName(raw) {
  const stem = decodeURIComponent(raw).replace(/\.json$/i, '');
  if (!SAFE.test(stem) || stem === '.' || stem === '..' || stem.includes('..')) return null;
  const full = resolve(CFG, stem + '.json');
  if (dirname(full) !== resolve(CFG)) return null;
  return full;
}

function listConfigs() {
  if (!existsSync(CFG)) return [];
  return readdirSync(CFG)
    .filter(f => f.endsWith('.json') && !f.endsWith('.schema.json'))
    .filter(f => statSync(join(CFG, f)).isFile())
    .sort()
    .map(f => ({ name: f.replace(/\.json$/i, '') }));
}

const json = (res, code, value) => {
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
};

const text = (res, code, msg) => {
  res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end(msg);
};

function notFound(res) {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('404');
}

function serveStatic(pathname, res) {
  let relPath = decodeURIComponent(pathname);
  if (relPath === '/' || relPath === '') relPath = '/index.html';
  if (relPath.startsWith('/config/')) relPath = '/' + relPath;
  const full = resolve(ROOT, '.' + relPath);
  if (full !== ROOT && !full.startsWith(ROOT + sep)) return notFound(res);
  if (full.startsWith(join(ROOT, 'tools')) || full.startsWith(join(ROOT, 'legacy'))) return notFound(res);

  fsp.stat(full).then(st => {
    if (!st.isFile()) return notFound(res);
    res.writeHead(200, {
      'content-type': MIME[extname(full).toLowerCase()] || 'application/octet-stream',
      'content-length': st.size,
      'cache-control': 'no-store',
    });
    createReadStream(full).pipe(res);
  }).catch(() => notFound(res));
}

/* ---------- 热更新推送 ---------- */
const clients = new Set();

function broadcast(name) {
  const payload = 'event: change\ndata: ' + JSON.stringify({ name }) + '\n\n';
  for (const res of clients) res.write(payload);
}

function attachWatcher() {
  if (!existsSync(CFG)) {
    console.info('config 目录不存在，热更新未启动');
    return;
  }
  let timer = null;
  let pending = null;
  watch(CFG, { persistent: false }, (event, file) => {
    if (!file || !String(file).endsWith('.json')) return;
    pending = String(file).replace(/\.json$/i, '');
    clearTimeout(timer);
    timer = setTimeout(() => {
      console.info('热更新 → config/' + pending + '.json');
      broadcast(pending);
    }, 160);
  });
}

/* ---------- 请求 ---------- */
const server = createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');

  if (pathname === '/__hot') {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store',
      connection: 'keep-alive',
    });
    res.write('retry: 800\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (pathname === '/api/configs') {
    if (req.method !== 'GET') return text(res, 405, '只支持 GET');
    return json(res, 200, listConfigs());
  }

  if (pathname.startsWith('/api/configs/')) {
    const full = configName(pathname.slice('/api/configs/'.length));
    if (!full) return text(res, 400, '数据集名称不合法');

    if (req.method === 'GET') {
      let raw;
      try {
        raw = await fsp.readFile(full, 'utf8');
      } catch {
        return text(res, 404, '文件不存在');
      }
      try {
        return json(res, 200, JSON.parse(raw));
      } catch (e) {
        return text(res, 422, 'JSON 解析失败：' + e.message);
      }
    }

    if (req.method === 'PUT') {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks).toString('utf8');
      if (body.length > 4e6) return text(res, 413, '配置太大');
      try {
        JSON.parse(body);
      } catch (e) {
        return text(res, 422, '拒绝写入：不是合法 JSON（' + e.message + '）');
      }
      const tmp = full + '.tmp';
      await fsp.writeFile(tmp, body.endsWith('\n') ? body : body + '\n');
      await fsp.rename(tmp, full);
      console.info('写回 → ' + relative(ROOT, full).replace(/\\/g, '/'));
      return json(res, 200, { ok: true, path: relative(ROOT, full).replace(/\\/g, '/') });
    }

    return text(res, 405, '只支持 GET / PUT');
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return text(res, 405, '只支持 GET');
  serveStatic(pathname, res);
});

attachWatcher();
server.listen(PORT, () => {
  const n = listConfigs().length;
  console.info('条形动画工作台 → http://localhost:' + PORT + '/');
  console.info('数据集 ' + n + ' 个，改 config/*.json 存盘即热更新；Ctrl+C 退出');
});
server.on('error', e => {
  console.error(e.code === 'EADDRINUSE'
    ? '端口 ' + PORT + ' 已被占用，换一个：node tools/serve.mjs --port 5280'
    : e.message);
  process.exit(1);
});
