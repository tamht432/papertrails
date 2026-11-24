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

**R** stops the animation loop and re-drives it with a **fixed dt** (`CONFIG.cine.fps`), so the
recording is deterministic and never drops or duplicates a frame, whatever the machine does. Every
rendered frame is captured off the canvas:

- **Chrome / Edge**: a folder picker opens (File System Access). Frames are written straight to disk
  as `frame_000001.jpg …` — uncapped, so lossless PNG is practical.
- **Other browsers / sandboxed iframes**: frames are zipped in memory and downloaded once as
  `papertrails-cine-seed<seed>-<n>f-<h>p.zip`. The in-memory path is capped (`CONFIG.cine.maxFrames`).

Frames are JPEG by default (`q 0.94`); `?cinepng=1` switches to lossless PNG.

### Frames → video (ffmpeg)

```
unzip papertrails-cine-seed11-1770f-720p.zip -d frames/
ffmpeg -framerate 30 -i frames/frame_%06d.jpg -c:v libx264 -crf 17 -pix_fmt yuv420p papertrails.mp4
```

For a soft, filmic master add `-vf "format=yuv420p"` (already above) and consider `-crf 14` for
archival, or `-c:v prores_ks -profile:v 3` for an editing intermediate. For slow motion, render with
`?cinefps=60` and play back at 30 (`-framerate 60` in, `-r 30` out).

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
