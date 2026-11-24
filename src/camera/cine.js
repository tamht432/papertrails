// Cine mode (owner: cine agent). ?cine=1 turns the engine into a small film set.
//
// The follow-camera rig is kept whole (springs, drift, tilt-shift DOF, sight assist); the director
// writes its pose every frame from a looping shot list, scripts the traveller's walk, and cuts the
// day/night look on shot boundaries. A cut = write the pose, then follow.snap(): instant reframe.
//
//   Shot 1  THE BOOK OPENS    crane back from a close-up to the wide diorama while the page rises
//   Shot 2  JOURNEY           he walks north along the page; a low tracking side shot
//   Shot 3  THE DARK LANTERN  he walks to the nearest lamp tile of the world; night falls mid-shot;
//                             when a lamp catches (bus 'game:lantern') the lens eases in for the sparks
//   Shot 4+ BIOME TOUR        one cut per entry of CONFIG.cine.tourBiomes: the traveller TELEPORTS
//                             to the nearest subject tile of that biome and the book rebuilds the new
//                             scenery around him while the camera holds (pop-up book logic: a cut
//                             between spreads = the page folds itself anew)
//   Last    NIGHT WATCH       a close low orbit at night, lantern pool and fireflies
//
// Keys (bubble phase; the atlas page keeps Tab / E / Escape): C next shot · X exit · R export the
// whole sequence as frames, Shift+R the current shot only · Esc cancels an export / exits cine.
//
// Export (cineexport.js): the loop is stopped and re-driven with a FIXED dt (CONFIG.cine.fps), so
// the recording is deterministic and never drops a frame whatever the machine does; every rendered
// frame is captured off the canvas (JPEG by default, PNG with ?cinepng=1) and either streamed into
// a picked folder (Chrome) or zipped in memory and downloaded once. docs/CINE.md has the ffmpeg step.
//
// The traveller's walk is a scripted input object (same shape controls.getInput returns) fed through
// main.js, and while the atlas page is open the whole timeline holds (game.modal() gate, as in main).
import { CONFIG, TILE_SIZE } from '../core/config.js';
import { state } from '../core/state.js';
import { bus } from '../core/events.js';
import { biomeAt } from '../core/biomes.js';
import { captureFrame, createZipStream, openStream, saveBlob } from './cineexport.js';

const ease = (t) => t * t * (3 - 2 * t);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;

export function createCine({ canvas, follow, controls, traveller, world, daynight, game, audio, music, loop, hooks }) {
  const C = CONFIG.cine;
  const camera = follow.camera;
  const walk = { x: 0, z: 0 }; // the scripted walk input main.js feeds the traveller instead of controls.getInput
  let begun = false;
  let active = true;
  let shotIndex = 0;
  let shotT = 0;
  let busyExport = false;
  let modalSeenT = -10;        // last time the atlas page was open (so Esc closes it without exiting cine)
  let exportState = null;      // { done, total, hint, cancel } while recording
  let flashTimer = 0;

  // ---- biome-tour presets (one per entry of CONFIG.cine.tourBiomes; built into SHOTS below) --------
  // wx / wz: where he walks through the new scenery (he lands facing it); d/p/y/fov/su: the camera
  // arc (start -> end distance / pitch / yaw, focal length, screenUp). Tuned per biome's textures:
  // wide and low for dune silhouettes, tighter for the cabins, low for the blossom canopy.
  const TOUR = {
    desert: { biome: 'desert', name: 'DESERT CROSSING', wx: 0.94, wz: -0.34, d0: 8.2, d1: 9.4, p0: 27, p1: 30, y0: -16, y1: 10, fov: 29, su: 0.4 },
    snow: { biome: 'snow', name: 'SNOW SETTLEMENT', wx: -0.71, wz: -0.71, d0: 7.4, d1: 8.6, p0: 29, p1: 26, y0: 14, y1: -12, fov: 30, su: 0.42 },
    blossom: { biome: 'blossom', name: 'BLOSSOM GARDEN', wx: 0.34, wz: -0.94, d0: 6.8, d1: 8.2, p0: 24, p1: 28, y0: 10, y1: 26, fov: 31, su: 0.38 },
  };

  // ---- the shot list. pose(t, P) writes the follow-camera pose for shot time t (P is the live pose
  // object follow.js places the lens from, so every rig feature keeps working). --------------------
  const SHOTS = [
    {
      id: 'book', name: 'THE BOOK OPENS', dur: C.durBook, night: 0, reach: 0.6,
      pose(t, P) {
        const k = ease(clamp01(t / this.dur));
        P.distance = lerp(5.2, 14.2, k);
        P.pitchDeg = lerp(33, 50, k);
        P.yawDeg = lerp(-13, 7, k);
        P.fov = lerp(30, 27, k);
        P.screenUp = lerp(0.22, 0.8, k);
        P.lookAhead = 0.6;
        P.smoothTime = 1.1;
      },
    },
    {
      id: 'journey', name: 'JOURNEY', dur: C.durJourney, night: 0, reach: 0.9,
      walkDir: { x: 0, z: -1 }, // north, up the page, until the shot ends
      pose(t, P) {
        const k = ease(clamp01(t / this.dur));
        P.distance = lerp(7.2, 8.8, k);
        P.pitchDeg = lerp(26, 29, k);
        P.yawDeg = lerp(-24, -8, k);
        P.fov = 30;
        P.screenUp = 0.45;
        P.lookAhead = 1.4;
        P.smoothTime = 1.0;
      },
    },
    {
      id: 'lantern', name: 'THE DARK LANTERN', dur: C.durLantern, night: 0, nightAt: C.lanternNightAt, reach: 0.4,
      catchT: -1, path: null, pathI: 0, pathDone: false, stuckT: 0,
      prepare() {
        this.catchT = -1; this.path = null; this.pathI = 0; this.pathDone = false; this.stuckT = 0;
        const p = traveller.position;
        const tx = Math.round(p.x / TILE_SIZE); const tz = Math.round(p.z / TILE_SIZE);
        const lamp = findTile(tx, tz, C.lampTiles, C.scanRadius);
        const spot = lamp || findTile(tx, tz, C.subjectTiles, C.scanRadius);
        if (!spot) return; // no landmark in range: he stays put and the night falls on him alone
        const cx = spot.cx * TILE_SIZE; const cz = spot.cz * TILE_SIZE;
        let dx = cx - p.x; let dz = cz - p.z;
        const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
        const pts = [];
        if (d > 2.4) pts.push({ x: cx - dx * 1.6, z: cz - dz * 1.6 }); // line him up with the tile first
        pts.push({ x: cx, z: cz });                                    // through the middle: any lamp in reach catches
        pts.push({ x: cx + dx * 2.0, z: cz + dz * 2.0 });              // he comes to rest just past it, in the pool
        this.path = pts;
      },
      pose(t, P) {
        const k = ease(clamp01(t / this.dur));
        let d0 = lerp(9.8, 8.6, k); let p0 = lerp(34, 31, k); let y0 = lerp(-10, 4, k);
        let f0 = 29; let su0 = lerp(0.5, 0.42, k); let la0 = 1.0;
        if (this.catchT >= 0) { // the lamp caught: ease in for the sparks and the flicker
          const c = ease(clamp01((t - this.catchT) / 2.6));
          d0 = lerp(d0, 5.4, c); p0 = lerp(p0, 25, c); f0 = lerp(f0, 33, c);
          su0 = lerp(su0, 0.3, c); la0 = lerp(la0, 0.4, c);
        }
        P.distance = d0; P.pitchDeg = p0; P.yawDeg = y0; P.fov = f0; P.screenUp = su0; P.lookAhead = la0;
        P.smoothTime = 1.2;
      },
    },
    // ---- biome tour: a cut = teleport to a fresh scenery, the book rebuilds it around him -----------
    ...C.tourBiomes.map((b) => TOUR[b]).filter(Boolean).map((cam) => ({
      id: 'tour-' + cam.biome, name: cam.name, dur: C.durTour, night: 0, reach: 0.6,
      walkDir: { x: cam.wx, z: cam.wz },
      prepare() {
        const p = traveller.position;
        const tx = Math.round(p.x / TILE_SIZE); const tz = Math.round(p.z / TILE_SIZE);
        const spot = findInBiome(tx, tz, cam.biome, C.tourRadius);
        if (spot) {
          const [x, z] = findWalkableNear(spot.cx * TILE_SIZE, spot.cz * TILE_SIZE);
          traveller.teleport(x, z, cam.wx, cam.wz); // he lands facing where he is about to walk
        }
      },
      pose(t, P) {
        const k = ease(clamp01(t / this.dur));
        P.distance = lerp(cam.d0, cam.d1, k);
        P.pitchDeg = lerp(cam.p0, cam.p1, k);
        P.yawDeg = lerp(cam.y0, cam.y1, k);
        P.fov = cam.fov;
        P.screenUp = cam.su;
        P.lookAhead = 1.2;
        P.smoothTime = 1.1;
      },
    })),
    {
      id: 'night', name: 'NIGHT WATCH', dur: C.durNight, night: 1, reach: 0,
      pose(t, P) {
        const k = ease(clamp01(t / this.dur));
        P.distance = lerp(5.8, 4.9, k);
        P.pitchDeg = lerp(21, 24, k);
        P.yawDeg = lerp(-20, 26, k);
        P.fov = 34;
        P.screenUp = 0.3;
        P.lookAhead = 0.4;
        P.smoothTime = 1.4;
      },
    },
  ];

  /** Nearest cell (within `radius`, Chebyshev) whose WFC tile model is one of `models`. */
  function findTile(tx, tz, models, radius) {
    let best = null; let bestD = Infinity;
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const d = dx * dx + dz * dz;
        if (d >= bestD) continue;
        const cell = world.tileAt(tx + dx, tz + dz);
        if (!cell) continue;
        if (models.indexOf(cell.model) >= 0) { bestD = d; best = { cx: tx + dx, cz: tz + dz, model: cell.model }; }
      }
    }
    return best;
  }

  /** Nearest cell (within `radius`) of one biome — a subject tile of the biome if one is in range,
   *  else any cell of it. Biome checks are pure lookups; only biome-matching cells pay a tileAt. */
  function findInBiome(tx, tz, biome, radius) {
    let any = null; let anyD = Infinity;
    let subj = null; let subjD = Infinity;
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const d = dx * dx + dz * dz;
        if (d >= anyD && d >= subjD) continue;
        if (biomeAt(state.seed, tx + dx, tz + dz) !== biome) continue;
        if (d < anyD) { anyD = d; any = { cx: tx + dx, cz: tz + dz }; }
        if (d < subjD) {
          const cell = world.tileAt(tx + dx, tz + dz);
          if (cell && C.subjectTiles.indexOf(cell.model) >= 0) { subjD = d; subj = { cx: tx + dx, cz: tz + dz }; }
        }
      }
    }
    return subj || any;
  }

  /** A standable spot at / near world (x, z) (the same spiral main.js uses at boot). */
  function findWalkableNear(x, z) {
    if (world.isWalkable(x, z)) return [x, z];
    for (let r = 0.25; r <= TILE_SIZE * 3; r += 0.25) {
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const nx = x + Math.cos(a) * r;
        const nz = z + Math.sin(a) * r;
        if (world.isWalkable(nx, nz)) return [nx, nz];
      }
    }
    return [x, z];
  }

  // ---- overlay (index.html #cine): one shot line, a thin progress rule, one hint line -------------
  const ui = {
    root: document.getElementById('cine'),
    shot: document.getElementById('cine-shot'),
    bar: document.getElementById('cine-bar-fill'),
    hint: document.getElementById('cine-hint'),
  };
  let lastShotText = '';
  let lastHintText = '';
  function setText(el, s, cacheKey) {
    if (cacheKey === 'shot') { if (s !== lastShotText) { el.textContent = s; lastShotText = s; } }
    else if (s !== lastHintText) { el.textContent = s; lastHintText = s; }
  }
  function updateOverlay() {
    if (!ui.root) return;
    if (exportState) {
      setText(ui.shot, 'EXPORT · ' + String(exportState.done).padStart(4, '0') + ' / ' + String(exportState.total).padStart(4, '0'), 'shot');
      setText(ui.hint, exportState.hint, 'hint');
      ui.bar.style.transform = 'scaleX(' + (exportState.total ? clamp01(exportState.done / exportState.total) : 0) + ')';
      return;
    }
    const shot = SHOTS[shotIndex];
    setText(ui.shot, 'SHOT ' + (shotIndex + 1) + '/' + SHOTS.length + ' · ' + shot.name, 'shot');
    setText(ui.hint, 'C next shot · R export frames · X exit', 'hint');
    ui.bar.style.transform = 'scaleX(' + clamp01(shotT / shot.dur) + ')';
  }
  function flash(msg) {
    if (!ui.root) return;
    ui.hint.textContent = msg; lastHintText = msg;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { lastHintText = ''; updateOverlay(); }, 8000);
  }

  // ---- direction ----------------------------------------------------------------------------------
  function writePose(t) {
    const shot = SHOTS[shotIndex];
    const P = follow.pose; // the live pose object; follow.update(dt) places the lens from it right after
    P.zone = false; P.screenRight = 0; P.targetHeight = 0; // the director owns the framing
    shot.pose(Math.min(t, shot.dur), P);
  }

  function startShot(i) {
    const n = SHOTS.length;
    shotIndex = ((i % n) + n) % n;
    const shot = SHOTS[shotIndex];
    shotT = 0;
    if (shot.prepare) shot.prepare();
    daynight.set(shot.night === 1 ? 1 : 0, true); // a cut, not a crossfade
    state.viewReach = shot.reach || 0;
    writePose(0);
    follow.snap(traveller);
    updateOverlay();
  }

  /** The scripted walk input for this tick (same shape controls.getInput returns; length 0..1). */
  function scriptWalk(dt, shot) {
    walk.x = 0; walk.z = 0;
    if (shot.walkDir) { walk.x = shot.walkDir.x; walk.z = shot.walkDir.z; return; }
    const path = shot.path;
    if (!path || shot.pathDone) return;
    const p = traveller.position;
    for (;;) {
      const t = path[shot.pathI];
      if (!t) { shot.pathDone = true; return; }
      const dx = t.x - p.x; const dz = t.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.5) { shot.pathI++; shot.stuckT = 0; continue; } // waypoint reached
      if (traveller.speed < 0.1) shot.stuckT += dt; else shot.stuckT = 0;
      if (shot.stuckT > 1.8) { shot.pathI++; shot.stuckT = 0; continue; } // wedged: give this waypoint up
      walk.x = dx / d; walk.z = dz / d;
      return;
    }
  }

  /** One tick, from main's update(), BEFORE follow.update places the lens. Also runs on every
   *  fixed-dt step of a frame export — only the shot-boundary advance is the exporter's job there. */
  function frame(dt) {
    if (!begun || !active) return;
    if (game.modal()) { modalSeenT = state.time; walk.x = 0; walk.z = 0; return; } // hold everything while the atlas page is open
    const shot = SHOTS[shotIndex];
    const prev = shotT;
    shotT += dt;
    if (shot.nightAt !== undefined && prev < shot.nightAt && shotT >= shot.nightAt) daynight.set(1); // night falls mid-shot
    scriptWalk(dt, shot);
    writePose(shotT);
    updateOverlay();
    if (!busyExport && shotT >= shot.dur) startShot(shotIndex + 1);
  }

  // a lit lamp during the lantern shot: remember when, the pose eases in from there
  const offLantern = bus.on('game:lantern', () => {
    const shot = SHOTS[shotIndex];
    if (begun && active && shot.id === 'lantern' && shot.catchT < 0) shot.catchT = shotT;
  });

  // ---- begin / exit ---------------------------------------------------------------------------------
  function blockPointer(e) { if (!game.modal()) e.stopPropagation(); } // the atlas page stays usable when open

  function begin() {
    if (begun) return;
    begun = true;
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) window.addEventListener(type, blockPointer, true);
    startShot(C.startShot | 0);
    if (ui.root) ui.root.classList.add('on');
  }

  function exit() {
    if (!active || busyExport) return;
    active = false;
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) window.removeEventListener(type, blockPointer, true);
    follow.setPose(null); // back to the plain gameplay framing
    state.viewReach = 0;
    follow.snap(traveller);
    controls.clearTarget();
    if (ui.root) ui.root.classList.remove('on');
  }

  // ---- export ---------------------------------------------------------------------------------------
  function nextFrame() { return new Promise((r) => requestAnimationFrame(() => r())); }

  async function runExport(allShots) {
    if (busyExport) return;
    busyExport = true;
    const fps = C.fps;
    const first = allShots ? 0 : shotIndex;
    const counts = [];
    let total = 0;
    for (let i = first; i < SHOTS.length; i++) { const n = Math.round(SHOTS[i].dur * fps); counts.push(n); total += n; }
    if (total > C.maxFrames) total = C.maxFrames;
    // audio off during the offline run: the simulation no longer follows wall-clock time
    const wasMuted = audio.muted;
    const wasMusic = music.on;
    audio.setMuted(true);
    if (wasMusic) music.toggle();
    loop.stop();
    const h = C.exportHeight;
    const w = Math.max(2, Math.round(h * camera.aspect / 2) * 2);
    hooks.exportSize(w, h);
    const type = C.png ? 'image/png' : 'image/jpeg';
    const ext = C.png ? 'png' : 'jpg';
    exportState = { done: 0, total, hint: 'starting…', cancel: false };
    // Chrome: stream the frames into a picked folder (uncapped, PNG-friendly); else zip in memory
    let stream = await openStream();
    if (stream && stream.cancelled) stream = null;
    const cap = stream ? Infinity : C.maxFrames;
    if (!stream && total > C.maxFrames) { total = C.maxFrames; exportState.total = total; }
    const zip = stream ? null : createZipStream();
    const dt = 1 / fps;
    let aborted = false;
    let frames = 0;
    try {
      for (let s = 0; s < counts.length && !aborted; s++) {
        startShot(first + s);
        for (let f = 0; f < counts[s] && !aborted; f++) {
          if (frames >= cap || exportState.cancel) { aborted = true; break; }
          loop.step(dt); // one fixed-dt tick + render; cine.frame inside drives pose / walk / overlay
          const bytes = await captureFrame(canvas, type, C.jpegQuality);
          if (!bytes) { aborted = true; break; }
          frames++;
          const name = 'frame_' + String(frames).padStart(6, '0') + '.' + ext;
          if (stream) await stream.write(name, bytes);
          else zip.add(name, bytes);
          exportState.done = frames;
          exportState.hint = stream ? 'writing frames to folder · Esc cancels' : 'frames in memory · zip at the end · Esc cancels';
          updateOverlay();
        }
      }
    } catch (err) { console.error('[cine] export failed', err); aborted = true; }
    let summary = 'export cancelled';
    if (!aborted) {
      if (stream) { await stream.close(); summary = frames + ' frames written to folder'; }
      else {
        exportState.hint = 'building zip…';
        await nextFrame(); // let the overlay paint before the long zip + download
        const blob = zip.finish();
        const mb = (blob.size / 1048576).toFixed(0);
        saveBlob(blob, 'papertrails-cine-seed' + (state.seed | 0) + '-' + fps + 'fps-' + frames + 'f-' + h + 'p.zip');
        summary = frames + ' frames · ' + mb + ' MB · zip saved';
      }
    } else if (stream) { await stream.close().catch(() => {}); }
    // restore live playback where the recording began (busyExport first: resize() gates on it)
    exportState = null;
    busyExport = false;
    hooks.restore();
    audio.setMuted(wasMuted);
    if (wasMusic !== music.on) music.toggle();
    loop.start();
    startShot(first);
    flash(summary);
  }

  // ---- keys (bubble phase: the atlas page's capture handler keeps Tab / E / Escape) ------------------
  function onKeyDown(e) {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (busyExport) { if (e.code === 'Escape' && exportState) exportState.cancel = true; return; }
    if (!active || !begun || game.modal()) return; // no cuts / exports while the atlas page holds the timeline
    if (e.code === 'KeyC' || e.code === 'BracketRight') { startShot(shotIndex + 1); return; }
    if (e.code === 'KeyX') { exit(); return; }
    if (e.code === 'KeyR') { runExport(!e.shiftKey); return; }
    if (e.code === 'Escape' && state.time - modalSeenT > 0.35) exit();
  }
  window.addEventListener('keydown', onKeyDown);

  return {
    get active() { return active; },
    /** True while a frame export is running (main skips resize, loop is driven by the exporter). */
    get busy() { return busyExport; },
    begin,
    frame,
    /** The scripted walk input for the traveller (main passes it instead of controls.getInput). */
    walkInput() { return walk; },
    exit,
    dispose() { offLantern(); window.removeEventListener('keydown', onKeyDown); },
  };
}
