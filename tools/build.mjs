#!/usr/bin/env node
/* ============================================================
 * ===== 单文件构建 =====
 * ============================================================
 * 浏览器在 file:// 下不允许 module 加载和 fetch 本地文件，
 * 所以发布版把整张依赖图摊平内联成一个 <script type="module">。
 * 约定：源码只用 `import { ... } from './x.js'` 与
 * `export function|const|let|class`，违反就当场报错而不是猜。
 * ============================================================ */

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const ENTRY = join(SRC, 'app.js');
const OUT = join(ROOT, 'dist', 'index.html');

const IMPORT_RE = /^import\s*\{([^}]*)\}\s*from\s*['"](\.[^'"]+)['"];?\s*$/gm;
const EXPORT_RE = /^export\s+(async\s+function|function|const|let|class)\s+/gm;
const TOP_DECL_RE = /^(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z0-9_$]+)/gm;
const FORBIDDEN = [
  [/^\s*import\s+default/m, '默认导入'],
  [/^\s*import\s+['"]/m, '裸副作用导入'],
  [/^\s*import\s+\w+\s+from/m, '整体命名空间导入'],
  [/^\s*export\s+default/m, '默认导出'],
  [/^\s*export\s*\{/m, '集中式导出列表'],
  [/\bimport\s*\(/, '动态 import'],
];

function fail(msg) {
  console.error('构建失败：' + msg);
  process.exit(1);
}

function loadGraph() {
  const files = new Map();
  const queue = [ENTRY];

  while (queue.length) {
    const abs = queue.shift();
    if (files.has(abs)) continue;
    if (!existsSync(abs)) fail('找不到模块 ' + rel(abs));
    const code = readFileSync(abs, 'utf8');

    for (const [re, label] of FORBIDDEN) {
      if (re.test(code)) fail(rel(abs) + ' 用了' + label + '，本打包器只支持具名导入导出');
    }

    const deps = [];
    for (const m of code.matchAll(IMPORT_RE)) {
      const spec = m[2];
      if (!spec.endsWith('.js')) fail(rel(abs) + ' 的导入路径要带 .js：' + spec);
      deps.push(resolve(dirname(abs), spec));
    }
    files.set(abs, { code, deps });
    queue.push(...deps);
  }
  return files;
}

function topoSort(graph) {
  const order = [];
  const state = new Map();
  const stack = [];

  const visit = abs => {
    const s = state.get(abs);
    if (s === 'done') return;
    if (s === 'visiting') {
      fail('循环依赖：' + [...stack.slice(stack.indexOf(abs)), abs].map(rel).join(' → '));
    }
    state.set(abs, 'visiting');
    stack.push(abs);
    for (const d of graph.get(abs).deps) visit(d);
    stack.pop();
    state.set(abs, 'done');
    order.push(abs);
  };

  visit(ENTRY);
  return order;
}

function stripModule(code) {
  return code
    .replace(IMPORT_RE, '')
    .replace(EXPORT_RE, '$1 ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function collectNames(code, file, seen) {
  for (const m of code.matchAll(TOP_DECL_RE)) {
    const name = m[1];
    if (seen.has(name)) fail('顶层标识符重名：' + name + ' 同时出现在 ' + rel(seen.get(name)) + ' 和 ' + rel(file));
    seen.set(name, file);
  }
}

function readConfigs() {
  const dir = join(ROOT, 'config');
  if (!existsSync(dir)) fail('config 目录不存在');
  const out = {};
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith('.json') || f.endsWith('.schema.json')) continue;
    const full = join(dir, f);
    if (!statSync(full).isFile()) continue;
    try {
      out[f.replace(/\.json$/i, '')] = JSON.parse(readFileSync(full, 'utf8'));
    } catch (e) {
      fail('config/' + f + ' 不是合法 JSON：' + e.message);
    }
  }
  if (!Object.keys(out).length) fail('config 目录里没有可内联的数据集');
  return out;
}

/* JSON 内联进 <script>：尖括号必须转义，否则数据里的 </script> 会提前截断标签 */
function inlineJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028|\u2029/g, '');
}

const rel = p => relative(ROOT, p).replace(/\\/g, '/');

const graph = loadGraph();
const order = topoSort(graph);

const seen = new Map();
const body = [];
for (const abs of order) {
  const code = stripModule(graph.get(abs).code);
  collectNames(code, abs, seen);
  body.push('/* ===== ' + rel(abs) + ' ===== */\n\n' + code);
}

const bundle = body.join('\n\n');
if (/^\s*(import|export)\s/m.test(bundle)) fail('产物里仍残留 import/export，剥离逻辑没覆盖到');

const cssPath = join(SRC, 'styles.css');
if (!existsSync(cssPath)) fail('缺少 src/styles.css');
const css = readFileSync(cssPath, 'utf8').trim();

const configs = readConfigs();
const htmlPath = join(ROOT, 'index.html');
let html = readFileSync(htmlPath, 'utf8');

const linkTag = html.match(/<link rel="stylesheet"[^>]*href="\.\/src\/styles\.css"[^>]*\/>/);
if (!linkTag) fail('index.html 里找不到 styles.css 的 link 标签');
html = html.replace(linkTag[0], '<style>\n' + css + '\n</style>');

const scriptTag = html.match(/<script type="module"[^>]*src="\.\/src\/app\.js"[^>]*><\/script>/);
if (!scriptTag) fail('index.html 里找不到 app.js 的 script 标签');
html = html.replace(scriptTag[0],
  '<script>window.__INLINE_CONFIG__=' + inlineJson(configs) + ';</script>\n'
  + '<script type="module">\n' + bundle + '\n</script>');

html = html.replace('<em id="buildTag">dev</em>', '<em id="buildTag">build</em>');

if (!existsSync(dirname(OUT))) mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);

const kb = n => (n / 1024).toFixed(1) + ' KB';
console.info('模块 ' + order.length + ' 个 → ' + rel(OUT) + '（' + kb(html.length) + '）');
console.info('  源码包 ' + kb(bundle.length) + ' · 样式 ' + kb(css.length)
  + ' · 数据集 ' + Object.keys(configs).length + ' 个（' + kb(inlineJson(configs).length) + '）');
