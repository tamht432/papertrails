#!/usr/bin/env node
// Headless cine render: exports the whole directed sequence as image frames straight from the CLI —
// no browser window, no picker, no downloads. The frames land in a folder ready for
// tools/cine-video.mjs. Requires a Chrome/Chromium on the machine (found automatically, or pass
// --exec); the WebGL scene is rendered with software SwiftShader when no GPU is available, so it
// works on CI boxes too — slower, but frame-exact exactly like the in-browser R export.
//
//   node tools/cine-render.mjs                        # 720p JPEG, default seed, http://localhost:5273
//   node tools/cine-render.mjs --height 1080 --png    # full-HD lossless
//   node tools/cine-render.mjs --seed 11 --fps 60     # another world, slow-motion capture
//   node tools/cine-render.mjs --url https://xikhar.github.io/papertrails/
//   npm run cine:render
//
// How it works: puppeteer-core drives a (headless) Chromium; the page loads ?cine=1 (boot, then
// window.__cineReady), the driver presses R for the export, and a small bridge in cine.js
// (window.__cineSink / __cineDone) streams every rendered frame to this process, which writes it to
// disk. The export loop itself is the deterministic fixed-dt one from docs/CINE.md.

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HELP = `
Headless cine render — export the directed shot sequence to frames from the CLI.

Usage:
  node tools/cine-render.mjs [options]

Options:
  --url URL      base URL of a running server      (default http://localhost:5273)
                 (must serve this repo: "npm run dev" first)
  --out DIR      output frames folder               (default ./cine-frames-<seed>-<timestamp>)
  --seed N       world seed                         (default: the server's default)
  --shot N       begin at shot N (1-based)          (default 1)
  --fps N        export frame rate                  (default 30)
  --height N     frame height in px                 (default 720)
  --png          lossless PNG frames instead of JPEG
  --exec PATH    path to a Chrome/Chromium executable (else auto-detected)
  --timeout S    give up after S seconds            (default 1800)
  --keep-open    leave the browser open after the export (for debugging)
  --h, --help    this text
`.trim();

// ---- args -----------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const opts = { url: 'http://localhost:5273', out: null, seed: null, shot: null, fps: null, height: null, png: false, exec: null, timeout: 1800, keepOpen: false };
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--h' || a === '--help') { console.log(HELP); process.exit(0); }
  else if (a === '--url') opts.url = argv[++i];
  else if (a === '--out') opts.out = argv[++i];
  else if (a === '--seed') opts.seed = parseInt(argv[++i], 10);
  else if (a === '--shot') opts.shot = parseInt(argv[++i], 10);
  else if (a === '--fps') opts.fps = parseInt(argv[++i], 10);
  else if (a === '--height') opts.height = parseInt(argv[++i], 10);
  else if (a === '--png') opts.png = true;
  else if (a === '--exec') opts.exec = argv[++i];
  else if (a === '--timeout') opts.timeout = parseInt(argv[++i], 10);
  else if (a === '--keep-open') opts.keepOpen = true;
  else if (a.startsWith('--')) { console.error('unknown option: ' + a + '\n' + HELP); process.exit(1); }
  else positional.push(a);
}

// ---- puppeteer-core: preinstalled, else a one-time --no-save install -------------------------------
function requirePuppeteer() {
  try { return createRequire(path.join(REPO, 'package.json'))('puppeteer-core'); } catch { return null; }
}
let puppeteer = requirePuppeteer();
if (!puppeteer) {
  console.log('installing puppeteer-core once (goes to node_modules, nothing saved to package.json)…');
  const r = spawnSync('npm', ['install', '--no-save', 'puppeteer-core'], { stdio: 'inherit', cwd: REPO, shell: true });
  puppeteer = r.status === 0 ? requirePuppeteer() : null;
  if (!puppeteer) { console.error('could not install puppeteer-core — install it manually: npm i -D puppeteer-core'); process.exit(1); }
}

// ---- find a Chrome/Chromium ------------------------------------------------------------------------
function execOnPath(names) {
  for (const n of names) {
    const q = spawnSync(process.platform === 'win32' ? 'where' : 'which', [n], { encoding: 'utf8', shell: true });
    const p = (q.stdout || '').split(/\r?\n/)[0];
    if (p && fs.existsSync(p)) return p;
  }
  return null;
}
function findChrome() {
  if (opts.exec) return fs.existsSync(opts.exec) ? opts.exec : null;
  if (process.env.PAPERTRAILS_CHROME && fs.existsSync(process.env.PAPERTRAILS_CHROME)) return process.env.PAPERTRAILS_CHROME;
  const onPath = execOnPath(['google-chrome-stable', 'google-chrome', 'chromium', 'chromium-browser', 'chrome-headless-shell', 'chrome', 'msedge']);
  if (onPath) return onPath;
  const candidates = process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
    : process.platform === 'win32'
      ? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe']
      : ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'];
  return candidates.find((c) => fs.existsSync(c)) || null;
}

// ---- output folder ----------------------------------------------------------------------------------
const outDir = path.resolve(opts.out || path.join(process.cwd(), 'cine-frames-' + (opts.seed ?? '') + '-' + Date.now()));
fs.mkdirSync(outDir, { recursive: true });

// ---- launch ------------------------------------------------------------------------------------------
const exePath = findChrome();
if (!exePath) {
  console.error('no Chrome/Chromium found.\n' +
    '  install Chrome, or fetch a headless build once and point at it:\n' +
    '    npx @puppeteer/browsers install chrome-headless-shell@stable --path ~/.cache/papertrails\n' +
    '    node tools/cine-render.mjs --exec ~/.cache/papertrails/chrome-headless-shell/*/chrome-headless-shell\n' +
    '  (or set PAPERTRAILS_CHROME=/path/to/chrome)');
  process.exit(1);
}
console.log('browser: ' + exePath);
console.log('frames -> ' + outDir);

const H = opts.height ?? 720;
const W = Math.round(H * 16 / 9 / 2) * 2;
const params = new URLSearchParams({ cine: '1' });
if (opts.fps) params.set('cinefps', String(opts.fps));
params.set('cineh', String(H));
if (opts.png) params.set('cinepng', '1');
if (opts.seed !== null && Number.isFinite(opts.seed)) params.set('seed', String(opts.seed));
if (opts.shot !== null && Number.isFinite(opts.shot)) params.set('cineshot', String(opts.shot));
const url = opts.url.replace(/\/$/, '') + '/?' + params.toString();
const fps = opts.fps ?? 30;

let browser;
try {
  browser = await puppeteer.launch({
    executablePath: exePath,
    headless: true,
    args: [
      '--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars', '--mute-audio',
      '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', // software WebGL: no GPU needed
      '--window-size=' + W + ',' + H,
    ],
    defaultViewport: { width: W, height: H, deviceScaleFactor: 1 },
  });
} catch (err) {
  console.error('could not launch the browser: ' + err.message);
  process.exit(1);
}

const page = await browser.newPage();
page.on('pageerror', (e) => console.error('[page] ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') console.error('[page] ' + m.text()); });

// the frame bridge: cine.js calls __cineSink(name, base64) per frame and __cineDone(info) at the end
let frames = 0;
let doneResolve;
const donePromise = new Promise((r) => { doneResolve = r; });
const t0 = Date.now();
await page.exposeFunction('__cineSink', (name, b64) => {
  fs.writeFileSync(path.join(outDir, name), Buffer.from(b64, 'base64'));
  frames++;
  if (frames % 150 === 0) console.log('  ' + frames + ' frames… ' + ((Date.now() - t0) / 1000).toFixed(0) + ' s');
  return true;
});
await page.exposeFunction('__cineDone', (info) => { doneResolve(info); return true; });

console.log('loading ' + url);
await page.goto(url, { waitUntil: 'load', timeout: opts.timeout * 1000 });
try {
  await page.waitForFunction('window.__cineReady === true', { timeout: opts.timeout * 1000, polling: 250 });
} catch {
  console.error('the cine overlay never became ready — is the URL serving this repo with ?cine=1?');
  await browser.close();
  process.exit(1);
}
await new Promise((r) => setTimeout(r, 2500)); // let the opening tiles finish rising so shot 1 has a page

console.log('exporting at ' + fps + ' fps, ' + W + 'x' + H + (opts.png ? ' PNG' : ' JPEG') + ' — headless, software GL (slow but frame-exact)…');
await page.keyboard.press('KeyR'); // the same export the R key starts; the sink catches the frames

const info = await Promise.race([
  donePromise,
  new Promise((r) => setTimeout(() => r(null), opts.timeout * 1000)),
]);
if (!info) console.error('export timed out after ' + opts.timeout + ' s — frames written so far are kept in ' + outDir);
else console.log(info.summary + (info.aborted ? ' (aborted)' : ''));

if (!opts.keepOpen) await browser.close();
const n = fs.readdirSync(outDir).filter((f) => /^frame_\d+\.(jpg|jpeg|png)$/i.test(f)).length;
console.log('✓ ' + n + ' frames in ' + outDir);
console.log('next: node tools/cine-video.mjs ' + (opts.png ? '--webm '.repeat(0) : '') + JSON.stringify(outDir) +
  (opts.png ? ' (PNG: consider --prores or --webm)' : ''));
