# Papertrails

[Play Papertrails](https://xikhar.github.io/papertrails/)

<img src="screenshots/hero.png" alt="Papertrails — a traveller exploring the paper world" width="100%">

<img src="screenshots/village.png" alt="Papertrails — the paper village by day" width="100%">

<img src="screenshots/village-night.png" alt="Papertrails — the village illuminated at night" width="100%">

## Automatic video

The `video/` project is a separate HyperFrames composition. It renders an original 20-second 3D paper-cut story
with a new character, new diorama sets and the game's cardstock material, lighting and post-processing. It does
not load the game's character or tile models, nor its generated world.

Requires Node.js 22+ and FFmpeg. Preview with `npm run video:preview`, or render a 1080p MP4 (the 3D scene is
rendered at half resolution and upscaled) with
`npm run video:render`. Check the source composition with `npm run video:lint`. The render is written to
`video/renders/an-through-the-reed-forest.mp4` (generated renders are git-ignored).
