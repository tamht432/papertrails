# Cine mode — Papertrails as a film set

`?cine=1` turns the engine into a small deterministic film set: the follow-camera rig (springs, drift,
tilt-shift DOF, sight assist) is kept whole, but a director writes its pose from a looping shot list,
scripts the traveller's walk, and cuts the day/night look on shot boundaries.

## Running it

```
npm run dev
# open http://localhost:5273/?cine=1
```

The sequence loops forever (~86 s, 7 shots):

| # | Shot | What happens |
|---|------|--------------|
| 1 | THE BOOK OPENS | Crane back from a close-up to the wide diorama while the page rises around him. Day. |
| 2 | JOURNEY | He walks north along the page; a low tracking side shot. Day. |
| 3 | THE DARK LANTERN | He walks to the nearest lamp/landmark tile; night falls mid-shot; when a lamp catches, the lens eases in for the sparks. |
| 4–6 | BIOME TOUR | One cut per entry of `CONFIG.cine.tourBiomes` (desert → snow → blossom): the traveller *teleports* to the nearest subject tile of that biome and the book rebuilds the new scenery around him while the camera holds — the pop-up book turning its own pages. Day. |
| 7 | NIGHT WATCH | A close low orbit at night, lantern pool and fireflies. |

Keys (the atlas page keeps Tab / E / Escape):

- **C** — cut to the next shot
- **X** or **Esc** — exit cine mode back to free play
- **R** — export the whole sequence as an image-frame archive
- **Shift+R** — export only the current shot
- **Esc during export** — cancel

## Exporting frames

### From the CLI, no browser window (`tools/cine-render.mjs`)

```
npm run cine:render                                    # headless export -> ./cine-frames-*/
                                                       # (starts its own dev server when none is running)
npm run cine:render -- --seed 11 --height 1080 --png   # options pass through
npm run cine:render -- --shot 4 --to 6                 # only the biome tour (shots 4-6)
node tools/cine-video.mjs cine-frames-11-*/            # then: frames -> video
```

The driver (puppeteer-core + your installed Chrome/Chromium, found automatically or `--exec`) loads
`?cine=1`, presses R for you, and a small bridge in cine.js streams every rendered frame to the
process, which writes it to disk. It renders with software WebGL (SwiftShader), so it also runs on
GPU-less CI machines — slow, but the same deterministic fixed-dt export as in the browser. If no
browser is found, fetch a headless build once:

```
npx @puppeteer/browsers install chrome-headless-shell@stable --path ~/.cache/papertrails
npm run cine:render        # the cached shell is found automatically — no --exec needed
```

### In the browser (R)

**R** stops the animation loop and re-drives it with a **fixed dt** (`CONFIG.cine.fps`), so the
recording is deterministic and never drops or duplicates a frame, whatever the machine does. Every
rendered frame is captured off the canvas:

- **Chrome / Edge**: a folder picker opens (File System Access). Frames are written straight to disk
  as `frame_000001.jpg …` — uncapped, so lossless PNG is practical.
- **Other browsers / sandboxed iframes**: frames are zipped in memory and downloaded once as
  `papertrails-cine-seed<seed>-<n>f-<h>p.zip`. The in-memory path is capped (`CONFIG.cine.maxFrames`).

Frames are JPEG by default (`q 0.94`); `?cinepng=1` switches to lossless PNG. The zip name carries
the export rate (`…-30fps-1770f-720p.zip`), so the conversion script below needs no extra flags.

### Frames → video (the script)

`tools/cine-video.mjs` converts a frame set into a finished video — zero dependencies. It reads the
fps from the zip name, extracts the zip itself, and uses the system ffmpeg, falling back to a local
`ffmpeg-static` which it installs automatically when no system ffmpeg exists.

```
node tools/cine-video.mjs papertrails-cine-seed11-30fps-1770f-720p.zip   # zip: extracted automatically
node tools/cine-video.mjs frames/                                        # the Chrome folder-stream export
npm run cine:video -- frames/ --fps 60 --height 1080 --crf 14            # explicit rate / scale / quality
node tools/cine-video.mjs frames/ --prores       # ProRes 422 intermediate for an editor
node tools/cine-video.mjs frames/ --webm         # VP9 / WebM
```

Slow motion: capture at a higher rate (`?cinefps=60`) and convert as usual — the script reads the 60
from the zip name, so the output plays at half speed with full temporal smoothness (or pass `--fps`
explicitly for a folder export).

Manual ffmpeg, should you prefer it:

```
unzip papertrails-cine-seed11-30fps-1770f-720p.zip -d frames/
ffmpeg -framerate 30 -i frames/frame_%06d.jpg -c:v libx264 -crf 17 -pix_fmt yuv420p papertrails.mp4
```

## URL parameters

| Param | Default | Meaning |
|-------|---------|---------|
| `cine=1` | off | enable cine mode |
| `cineshot=N` | 1 | begin the loop at shot N (1-based) |
| `cinefps=N` | 30 | fixed frame rate of the export |
| `cineh=N` | 720 | frame height of the export (width follows the window aspect); `1080` for production |
| `cinepng=1` | off | lossless PNG frames instead of JPEG |
| `cinemax=N` | 2600 | frame cap of the in-memory zip export |
| `seed=N` | `CONFIG.DEFAULT_SEED` | the world (and the shots' subjects) — per-seed saves apply |

## Tuning

- Shot lengths, the night cue, the scan radii and the biome-tour list: `src/core/config/cine.js`.
- The shots themselves (poses, walk scripts, the lantern catch ease): `SHOTS` in `src/camera/cine.js`;
  the biome-tour camera arcs are the `TOUR` presets there. A shot is
  `{ id, name, dur, night, reach, prepare?, pose(t, P), walkDir? / path? }`; `pose(t, P)`
  writes the follow-camera pose for shot time t (keys mirror `CONFIG.camera`: `distance`, `pitchDeg`,
  `yawDeg`, `fov`, `screenUp`, `lookAhead`, `smoothTime`, …). `prepare()` runs once at the cut —
  this is where the tour shots teleport the traveller.
- Capture + zip: `src/camera/cineexport.js`.

## Notes

- Everything is a function of `state.time`, which advances by exactly `1/fps` per exported frame —
  same seed, same frames, always. Grain, water, weather and the fold springs included.
- Audio is muted during the export (the simulation no longer follows wall-clock time) and restored
  after. Add sound in the edit; `src/audio/paper.js` and `src/audio/music.js` are the synth sources.
- The world is scanned for the lantern shot's subject (`CONFIG.cine.lampTiles`, then
  `subjectTiles`) — if the seed has nothing in range, the traveller stays put and the night falls on
  him alone. Pick another `?seed=` for a different stage set.
