// OWNER: cine agent. Cine mode (?cine=1): the director shot list and the frame exporter.
// Shots live in src/camera/cine.js; how to use the mode and turn the frames into a video: docs/CINE.md.
export const cine = {
  /** Shot lengths, seconds. The sequence loops; C skips to the next shot. */
  durBook: 14,
  durJourney: 16,
  durLantern: 17,
  durNight: 12,
  /** Seconds into the lantern shot when night falls. */
  lanternNightAt: 4.5,
  /** Cells (Chebyshev) scanned around the traveller for the shot's subject tile. */
  scanRadius: 10,
  /** Tile models that can hold a lamp (the shot walks to them and lights one), then any subject tile. */
  lampTiles: ['lantern_post', 'market_square', 'church', 'manor', 'snow_hamlet'],
  subjectTiles: ['village', 'village_b', 'village_green', 'market_square', 'church', 'manor', 'windmill',
    'barn_farm', 'snow_cabin', 'snow_hamlet', 'desert_market', 'desert_camp', 'blossom_gazebo', 'watchtower'],
  // ---- exporter (R = whole sequence, Shift+R = the current shot) --------------------------------
  /** Fixed simulation/render rate of the recording, frames per second. ?cinefps=N */
  fps: 30,
  /** Frame height of the export (width follows the window aspect). ?cineh=1080 for production. */
  exportHeight: 720,
  /** JPEG quality of the frames; ?cinepng=1 switches to lossless PNG (much larger / slower). */
  jpegQuality: 0.94,
  png: false,
  /** Cap of the in-memory zip export, frames (?cinemax=N). Chrome can also stream to a picked
   *  folder, which is not capped and makes lossless PNG practical. */
  maxFrames: 2600,
  /** ?cineshot=N begins the loop at shot N (1-based in the URL, stored 0-based here). */
  startShot: 0,
};
