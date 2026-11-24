# Papertrails

[Play Papertrails](https://xikhar.github.io/papertrails/)

<img src="screenshots/hero.png" alt="Papertrails — a traveller exploring the paper world" width="100%">

<img src="screenshots/village.png" alt="Papertrails — the paper village by day" width="100%">

<img src="screenshots/village-night.png" alt="Papertrails — the village illuminated at night" width="100%">

## Cine mode

`?cine=1` turns the game into a small film set: a looping sequence of directed shots (opening crane,
walking journey, dusk lantern lighting, a biome tour that teleports to fresh scenery each cut, night
close-up), and **R** exports the whole run as a deterministic image-frame sequence.
`node tools/cine-video.mjs <frames.zip | frames-dir>` converts the export into a finished video
(installing ffmpeg itself when needed). See [docs/CINE.md](docs/CINE.md).
