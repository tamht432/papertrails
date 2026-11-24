// WebGL renderer setup.
// The scene is rendered by post.js into an HDR multisampled target; tone mapping, grading and the sRGB
// encode happen in the final composite pass, so the renderer itself does no tone mapping and no canvas MSAA.
import * as THREE from 'three';
import { qualitySettings } from '../core/config.js';

export function createRenderer({ canvas, quality = 'high', preserveDrawingBuffer = false }) {
  let q = qualitySettings(quality);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = q.shadows;
  // Basic = raw depth in a sampler2D. materials.js runs its own PCSS on it (blocker search +
  // receiver-plane depth bias + wide PCF); the stock filter is never used by paper materials.
  renderer.shadowMap.type = THREE.BasicShadowMap;

  return {
    renderer,
    /** CSS-pixel size of the canvas; pixel ratio is clamped by the quality level.
     *  An explicit `ratio` (cine export: 1) overrides the clamp for an exact output size. */
    setSize(width, height, ratio) {
      renderer.setPixelRatio(ratio ?? Math.min(window.devicePixelRatio || 1, q.maxDpr));
      renderer.setSize(width, height, false);
    },
    setQuality(level) {
      q = qualitySettings(level);
      renderer.shadowMap.enabled = q.shadows;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.maxDpr));
    },
    dispose() { renderer.dispose(); },
  };
}
