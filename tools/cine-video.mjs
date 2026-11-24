#!/usr/bin/env node
// Converts an exported cine frame set (docs/CINE.md) into a finished video. Zero dependencies.
//
//   node tools/cine-video.mjs frames/                          # the Chrome folder-stream export
//   node tools/cine-video.mjs papertrails-cine-*.zip           # the zip export: extracted first
//   node tools/cine-video.mjs frames/ --fps 60 --height 1080   # explicit rate / scale / quality
//   npm run cine:video -- frames/                              # the same, through package.json
//
// The frame rate is read from the zip name (-<fps>fps-, written by cineexport at export time) when
// present, so a 60 fps slow-motion capture needs no extra flags. Frames must be named
// frame_<6 digits>.(jpg|jpeg|png), which is what the export writes.
//
// ffmpeg: the script uses the system ffmpeg when it exists, else a local ffmpeg-static in
// node_modules — and installs it automatically (--no-save, one-time ~30 MB) when neither is there.

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HELP = `
Convert exported cine frames into a video.

Usage:
  node tools/cine-video.mjs <frames-dir | frames.zip> [output.mp4] [options]

Options:
  --fps N        frame rate of the frame sequence   (default: from the zip name, else 30)
  --crf N        x264 / VP9 quality, 0-51 lower = better, bigger   (default 17)
  --preset P     x264 speed preset                  (default medium)
  --height N     scale the video to N px high, aspect kept (default: native frame size)
  --prores       ProRes 422 instead of H.264 (editing intermediate, large files)
  --webm         VP9 / WebM instead of H.264 / MP4
  --dry-run      print the exact ffmpeg command and exit (no video is written)
  --h, --help    this text
`.trim();

// ---- args ----------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const opts = { fps: null, crf: 17, preset: 'medium', height: null, prores: false, webm: false, dry: false };
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--h' || a === '--help') { console.log(HELP); process.exit(0); }
  else if (a === '--prores') opts.prores = true;
  else if (a === '--dry-run') opts.dry = true;
  else if (a === '--webm') opts.webm = true;
  else if (a === '--fps') opts.fps = parseInt(argv[++i], 10);
  else if (a === '--crf') opts.crf = parseInt(argv[++i], 10);
  else if (a === '--preset') opts.preset = argv[++i];
  else if (a === '--height') opts.height = parseInt(argv[++i], 10);
  else if (a.startsWith('--')) { console.error('unknown option: ' + a + '\n' + HELP); process.exit(1); }
  else positional.push(a);
}
const [inputArg, outArg] = positional;
if (!inputArg) { console.log(HELP); process.exit(1); }
const input = path.resolve(inputArg);
if (!fs.existsSync(input)) { console.error('no such file or directory: ' + input); process.exit(1); }

// ---- input: a frames directory, or a (store-only) zip written by cineexport -----------------------
let framesDir = null;
let zipName = '';
if (fs.statSync(input).isDirectory()) {
  framesDir = input;
} else if (/\.zip$/i.test(input)) {
  zipName = path.basename(input, '.zip');
  framesDir = input.slice(0, -4) + '.frames';
  if (!fs.existsSync(framesDir)) {
    console.log('extracting ' + path.basename(input) + ' -> ' + path.basename(framesDir) + '/');
    extractStoreZip(input, framesDir);
  } else console.log('reusing already-extracted ' + path.basename(framesDir) + '/');
} else {
  console.error('expected a frames directory or a .zip, got: ' + input); process.exit(1);
}

// ---- the frames ------------------------------------------------------------------------------------
const FRAME_RE = /^frame_(\d+)\.(jpe?g|png)$/i;
const files = fs.readdirSync(framesDir).filter((f) => FRAME_RE.test(f)).sort();
if (files.length === 0) { console.error('no frame_000001.jpg/png files in ' + framesDir); process.exit(1); }
const ext = files[0].replace(FRAME_RE, '$2').toLowerCase();
const firstIndex = parseInt(files[0].replace(FRAME_RE, '$1'), 10);

// fps: flag > zip name (-<n>fps-) > 30
let fps = opts.fps;
if (!fps) { const m = /-(\d+)fps-/i.exec(zipName); fps = m ? parseInt(m[1], 10) : 30; }

// output name: flag > zip name -> <zip>.mp4 > folder name -> <parent>/<folder>.mp4
let out = outArg;
if (!out) {
  if (zipName) out = path.join(path.dirname(input), zipName + '.mp4');
  else out = path.join(path.dirname(framesDir), path.basename(framesDir) + '.mp4');
}

// ---- ffmpeg: system -> local ffmpeg-static -> automatic install ------------------------------------
function staticFfmpeg() {
  try {
    const p = createRequire(path.join(REPO, 'package.json'))('ffmpeg-static');
    return p && fs.existsSync(p) ? p : null;
  } catch { return null; }
}
function findFfmpeg() {
  const probe = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8', shell: true });
  if (!probe.error && probe.status === 0) return 'ffmpeg';
  return staticFfmpeg();
}
// --dry-run skips resolution entirely: it prints the command that WOULD run.
let ffmpeg = opts.dry ? 'ffmpeg' : findFfmpeg();
if (!ffmpeg && !opts.dry) {
  console.log('no system ffmpeg — installing ffmpeg-static once (~30 MB, goes to node_modules, nothing saved to package.json)…');
  const r = spawnSync('npm', ['install', '--no-save', 'ffmpeg-static'], { stdio: 'inherit', cwd: REPO, shell: true });
  ffmpeg = r.status === 0 ? staticFfmpeg() : null;
  if (!ffmpeg) {
    console.error('could not get ffmpeg. Install it manually:\n' +
      '  macOS:   brew install ffmpeg\n  linux:   sudo apt install ffmpeg\n  windows: winget install Gyan.FFmpeg');
    process.exit(1);
  }
}

// ---- encode -----------------------------------------------------------------------------------------
const filters = [];
if (opts.height) filters.push('scale=-2:' + opts.height);
const codec = opts.prores
  ? ['-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le']
  : opts.webm
    ? ['-c:v', 'libvpx-vp9', '-crf', String(opts.crf), '-b:v', '0', '-row-mt', '1', '-pix_fmt', 'yuv420p']
    : ['-c:v', 'libx264', '-preset', opts.preset, '-crf', String(opts.crf), '-pix_fmt', 'yuv420p'];
const args = [
  '-y',
  '-framerate', String(fps),
  '-start_number', String(firstIndex),
  '-i', path.join(framesDir, 'frame_%06d.' + ext),
  ...(filters.length ? ['-vf', filters.join(',')] : []),
  ...codec,
  ...(opts.webm ? [] : ['-movflags', '+faststart']),
  out,
];
const seconds = files.length / fps;
console.log(`${files.length} frames (${ext}) @ ${fps} fps -> ${seconds.toFixed(1)} s`);
if (opts.dry) { console.log('dry run: ' + ffmpeg + ' ' + args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')); process.exit(0); }
console.log([path.basename(ffmpeg), ...args.slice(0, 5)].join(' ') + ' … ' + path.basename(out));
const run = spawnSync(ffmpeg, args, { stdio: ['ignore', 'ignore', 'inherit'], shell: process.platform === 'win32' });
if (run.error || run.status !== 0) { console.error('ffmpeg failed (exit ' + (run.status ?? run.error?.code) + ')'); process.exit(1); }
const mb = (fs.statSync(out).size / 1048576).toFixed(1);
console.log('✓ ' + out + ' — ' + seconds.toFixed(1) + ' s, ' + mb + ' MB');
console.log(opts.prores || opts.webm ? '' : 'tip: master a soft look with --crf 14, or capture ?cinefps=60 for slow motion.');
if (!opts.prores && !opts.webm && !zipName) console.log('tip: zip exports carry their fps in the name, so "node tools/cine-video.mjs <file>.zip" needs no --fps.');

// ---- a reader for the store-only zip that cineexport.js writes (no dependencies) -------------------
function extractStoreZip(zipPath, destDir) {
  const buf = fs.readFileSync(zipPath);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65558); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file: ' + zipPath);
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  fs.mkdirSync(destDir, { recursive: true });
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt central directory in ' + zipPath);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const lOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (method !== 0) throw new Error('unexpected compressed entry (export writes store-only): ' + name);
    const lName = buf.readUInt16LE(lOffset + 26);
    const lExtra = buf.readUInt16LE(lOffset + 28);
    const start = lOffset + 30 + lName + lExtra;
    fs.writeFileSync(path.join(destDir, name), buf.subarray(start, start + csize));
    p += 46 + nameLen + extraLen + commentLen;
  }
  if (count === 0) console.warn('warning: the zip holds no files');
  return count;
}
