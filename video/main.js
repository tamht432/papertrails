import * as THREE from 'three';
import { CONFIG } from '../src/core/config.js';
import { state } from '../src/core/state.js';
import { createLights } from '../src/render/lights.js';
import { createMaterials } from '../src/render/materials.js';
import { createPost } from '../src/render/post.js';
import { createRenderer } from '../src/render/renderer.js';
import { gsap } from 'gsap';

const WIDTH = 1920;
const HEIGHT = 1080;
const FPS = 30;
const RENDER_SCALE = 0.5;
const P = CONFIG.palette;
const quality = 'low';
const canvas = document.getElementById('render-surface');
const stage = document.getElementById('stage');
const scene = new THREE.Scene();
const { renderer, setSize } = createRenderer({ canvas, quality });
function setRenderSize(width, height) {
  setSize(width, height);
  renderer.setPixelRatio(RENDER_SCALE);
}
setRenderSize(WIDTH, HEIGHT);

CONFIG.lights.paper.useAssetTextures = false;
const materials = createMaterials({ quality });
const lights = createLights({ scene, quality });
const camera = new THREE.PerspectiveCamera(33, WIDTH / HEIGHT, 0.1, 90);
const focus = new THREE.Vector3(-1.7, 1.25, 0.5);
const cameraOffset = new THREE.Vector3(0, 6.2, 18.5);
const traveller = { position: new THREE.Vector3(), group: null };
const post = createPost({ renderer, scene, camera, quality });
const paperCache = new Map();
const shadow = { castShadow: true, receiveShadow: true };

function paper(color, options = {}) {
  const key = [color, options.emissive || '', options.emissiveIntensity || 1].join('|');
  let material = paperCache.get(key);
  if (!material) {
    material = materials.paper({
      color,
      side: THREE.DoubleSide,
      emissive: options.emissive || null,
      emissiveIntensity: options.emissiveIntensity || 1,
      variant: 'video-cardstock',
    });
    paperCache.set(key, material);
  }
  return material;
}

function addPaperAttributes(geometry) {
  const count = geometry.getAttribute('position').count;
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  if (!geometry.getAttribute('color')) {
    const color = new Float32Array(count * 3);
    color.fill(1);
    geometry.setAttribute('color', new THREE.BufferAttribute(color, 3));
  }
  if (!geometry.getAttribute('uv1')) {
    const uv1 = new Float32Array(count * 2);
    uv1.fill(-1);
    geometry.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
  }
  return geometry;
}

function shapeFrom(points) {
  const shape = new THREE.Shape();
  shape.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i++) shape.lineTo(points[i][0], points[i][1]);
  shape.closePath();
  return shape;
}

function cutout(parent, points, color, options = {}) {
  const geometry = new THREE.ExtrudeGeometry(shapeFrom(points), {
    depth: options.depth ?? 0.055,
    bevelEnabled: false,
    curveSegments: 8,
  });
  const mesh = new THREE.Mesh(addPaperAttributes(geometry), paper(color, options));
  mesh.position.set(options.x || 0, options.y || 0, options.z || 0);
  mesh.castShadow = options.castShadow !== false;
  mesh.receiveShadow = options.receiveShadow !== false;
  parent.add(mesh);
  return mesh;
}

function groundPatch(parent, points, color, y = 0.035) {
  const shapePoints = points.map(([x, z]) => [x, -z]);
  const geometry = new THREE.ShapeGeometry(shapeFrom(shapePoints), 8);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(addPaperAttributes(geometry), paper(color));
  mesh.position.y = y;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function box(parent, width, height, depth, color, x, y, z, options = {}) {
  const geometry = addPaperAttributes(new THREE.BoxGeometry(width, height, depth));
  const mesh = new THREE.Mesh(geometry, paper(color, options));
  mesh.position.set(x, y, z);
  mesh.castShadow = options.castShadow !== false;
  mesh.receiveShadow = options.receiveShadow !== false;
  parent.add(mesh);
  return mesh;
}

function disk(parent, x, y, z, rx, ry, color, options = {}) {
  const shape = new THREE.Shape();
  shape.absellipse(0, 0, rx, ry, 0, Math.PI * 2, false, 0);
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: options.depth ?? 0.045,
    bevelEnabled: false,
    curveSegments: 16,
  });
  const mesh = new THREE.Mesh(addPaperAttributes(geometry), paper(color, options));
  mesh.position.set(x, y, z);
  mesh.rotation.z = options.rotation || 0;
  mesh.castShadow = options.castShadow !== false;
  mesh.receiveShadow = options.receiveShadow !== false;
  parent.add(mesh);
  return mesh;
}

function petal(parent, x, y, z, length, width, angle, color) {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.bezierCurveTo(-width, length * 0.34, -width * 0.78, length * 0.82, 0, length);
  shape.bezierCurveTo(width * 0.78, length * 0.82, width, length * 0.34, 0, 0);
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: 0.025, bevelEnabled: false, curveSegments: 7 });
  const mesh = new THREE.Mesh(addPaperAttributes(geometry), paper(color));
  mesh.position.set(x, y, z);
  mesh.rotation.z = angle;
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

function addPage() {
  const page = new THREE.Group();
  scene.add(page);
  box(page, 24.5, 0.09, 15.5, P.paper, 0, -0.09, 0, { castShadow: false });
  for (let i = 0; i < 4; i++) {
    box(page, 24.35 - i * 0.035, 0.045, 15.35 - i * 0.035, i % 2 ? P.paperShade : '#d8c29e', 0, -0.16 - i * 0.047, 0);
  }
  box(page, 27.5, 0.13, 18.5, P.umber, 0, -0.39, -0.2, { castShadow: false });
  return page;
}

function makeHill(parent, color, z, y, points) {
  return cutout(parent, points, color, { z, y, depth: 0.09 });
}

function makeTree(parent, x, z, height, colors = [P.pine, P.sage, P.olive]) {
  const tree = new THREE.Group();
  tree.position.set(x, 0, z);
  const h = height;
  cutout(tree, [[-0.09, 0], [0.09, 0], [0.08, h * 0.52], [-0.08, h * 0.52]], P.brown, { z: -0.05, depth: 0.09 });
  cutout(tree, [[-h * 0.31, h * 0.31], [-h * 0.18, h * 0.31], [0, h], [h * 0.18, h * 0.31], [h * 0.31, h * 0.31], [0, h * 0.75]], colors[0], { z: 0.02, depth: 0.08 });
  cutout(tree, [[-h * 0.25, h * 0.23], [-h * 0.1, h * 0.23], [0, h * 0.72], [h * 0.1, h * 0.23], [h * 0.25, h * 0.23], [0, h * 0.5]], colors[1], { z: 0.11, depth: 0.065 });
  cutout(tree, [[-h * 0.15, h * 0.18], [-h * 0.08, h * 0.18], [0, h * 0.48], [h * 0.08, h * 0.18], [h * 0.15, h * 0.18], [0, h * 0.31]], colors[2], { z: 0.19, depth: 0.05 });
  parent.add(tree);
  return tree;
}

function makeReed(parent, x, z, scale, hue = 0) {
  const reed = new THREE.Group();
  reed.position.set(x, 0, z);
  reed.scale.setScalar(scale);
  const stems = [P.sage, P.olive, '#9a955f'];
  const blooms = ['#efe0c2', '#e7d5bd', '#e9c9aa'];
  const stem = stems[hue % stems.length];
  const bloom = blooms[hue % blooms.length];
  cutout(reed, [[-0.035, 0], [0.03, 0], [0.055, 2.45], [0.012, 2.54], [-0.04, 2.42]], stem, { z: 0, depth: 0.035 });
  cutout(reed, [[0, 0.22], [-0.08, 0.67], [-0.56, 1.02], [-0.44, 0.63], [-0.06, 0.42]], stem, { z: 0.025, depth: 0.035 });
  cutout(reed, [[0.02, 0.55], [0.12, 0.99], [0.63, 1.31], [0.48, 0.86], [0.08, 0.69]], stem, { z: 0.035, depth: 0.035 });
  cutout(reed, [[0, 0.9], [-0.11, 1.3], [-0.5, 1.57], [-0.32, 1.17], [-0.03, 1.05]], hue % 2 ? P.olive : P.moss, { z: 0.05, depth: 0.03 });
  disk(reed, 0.025, 2.58, 0.06, 0.18, 0.36, bloom, { rotation: -0.18, depth: 0.025 });
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const px = 0.025 + Math.cos(angle) * 0.13;
    const py = 2.58 + Math.sin(angle) * 0.23;
    petal(reed, px, py, 0.095 + (i % 3) * 0.012, 0.27, 0.075, angle + Math.PI / 2, bloom);
  }
  disk(reed, 0.025, 2.58, 0.17, 0.055, 0.08, P.ochre, { depth: 0.03 });
  parent.add(reed);
  return reed;
}

function sample(i, k = 0) {
  const n = Math.sin(i * 127.1 + k * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function createForest() {
  const forest = new THREE.Group();
  makeHill(forest, '#b48a71', -6.5, 0, [[-12, 0], [-12, 4.1], [-8, 4.6], [-5, 3.8], [-1, 4.5], [2, 3.9], [6, 4.6], [9, 3.9], [12, 4.3], [12, 0]]);
  makeHill(forest, '#8e765d', -5.2, 0, [[-12, 0], [-12, 3.1], [-9, 3.5], [-6, 3.0], [-2, 3.8], [2, 3.1], [6, 3.7], [9, 3.0], [12, 3.4], [12, 0]]);
  disk(forest, 6.9, 4.4, -4.8, 0.68, 0.68, '#f3c477', { depth: 0.035, castShadow: false });
  for (let i = 0; i < 11; i++) {
    const x = -10 + i * 2.05;
    makeTree(forest, x, -4.4 + (i % 3) * 0.18, 2.2 + sample(i, 2) * 1.5, [P.pine, P.olive, P.sage]);
  }
  groundPatch(forest, [[-8, 2.7], [-6, 1.4], [-3, 0.6], [0, -0.1], [3, -0.7], [7, -1.4], [8, -0.4], [4, 0.2], [1, 1], [-2, 1.7], [-5, 3.1]], P.kraft, 0.018);
  for (let i = 0; i < 39; i++) {
    const x = -9.3 + sample(i, 1) * 18.6;
    const z = -3.1 + sample(i, 3) * 5.2;
    if (Math.abs(x + 2.5) < 1.2 && z > 0.1 && z < 2.2) continue;
    const scale = 0.62 + (z + 3.1) * 0.12 + sample(i, 5) * 0.26;
    makeReed(forest, x, z, scale, i % 3);
  }
  for (const [x, z, s] of [[-10.2, 3.2, 1.7], [-7.8, 3.7, 1.5], [7.6, 3.4, 1.8], [10, 3.1, 1.5]]) {
    makeReed(forest, x, z, s, 1);
  }
  return forest;
}

function createCrossing() {
  const crossing = new THREE.Group();
  makeHill(crossing, '#8e8d83', -6.4, 0, [[-12, 0], [-12, 4.2], [-9, 3.9], [-5, 4.8], [-1, 3.7], [4, 4.2], [8, 3.8], [12, 4.5], [12, 0]]);
  makeHill(crossing, '#737d79', -5.1, 0, [[-12, 0], [-12, 2.9], [-8, 3.4], [-4, 2.8], [0, 3.5], [5, 2.9], [9, 3.4], [12, 3.0], [12, 0]]);
  for (let i = 0; i < 8; i++) {
    const x = -9 + i * 2.55;
    makeTree(crossing, x, -4.2, 2.2 + sample(i, 11) * 1.2, ['#52665b', '#78816c', '#9d8b6a']);
  }
  groundPatch(crossing, [[-12, -0.65], [-8, -0.2], [-4, -0.45], [0, -0.1], [4, -0.45], [8, -0.1], [12, -0.5], [12, 1.25], [7, 1.0], [3, 1.3], [-2, 0.9], [-7, 1.3], [-12, 1.0]], P.teal, 0.028);
  for (let i = 0; i < 7; i++) {
    const x = -8.5 + i * 2.8;
    groundPatch(crossing, [[x, -0.21], [x + 0.8, -0.25], [x + 1.35, 0.73], [x + 0.55, 0.78]], '#b6b09b', 0.045);
  }
  for (let i = 0; i < 6; i++) {
    const z = -1.1 + i * 0.42;
    box(crossing, 1.58, 0.11, 0.34, i % 2 ? P.paperShade : P.paper, 0, 0.22, z, { depth: 0.08 });
  }
  box(crossing, 1.8, 0.15, 0.13, P.terracotta, -0.82, 0.25, 0.05);
  box(crossing, 1.8, 0.15, 0.13, P.rust, 0.82, 0.25, 0.05);
  cutout(crossing, [[-1.0, 0.1], [-0.82, 0.1], [-0.82, 0.74], [-1.0, 0.74]], P.brown, { z: 0.1, depth: 0.08 });
  cutout(crossing, [[0.82, 0.1], [1.0, 0.1], [1.0, 0.74], [0.82, 0.74]], P.brown, { z: 0.1, depth: 0.08 });
  for (let i = 0; i < 18; i++) {
    const x = -10.3 + sample(i, 20) * 20.6;
    const z = i % 2 ? -1.7 : 2.1 + sample(i, 21) * 1.1;
    makeReed(crossing, x, z, 0.48 + sample(i, 24) * 0.65, (i + 1) % 3);
  }
  return crossing;
}

function createHideaway() {
  const hideaway = new THREE.Group();
  makeHill(hideaway, '#776d66', -6.5, 0, [[-12, 0], [-12, 4.4], [-8, 4.0], [-4, 4.6], [0, 3.8], [4, 4.4], [8, 3.9], [12, 4.5], [12, 0]]);
  makeHill(hideaway, '#5e6057', -5.3, 0, [[-12, 0], [-12, 3.0], [-9, 3.4], [-5, 2.8], [-1, 3.5], [3, 2.9], [7, 3.4], [12, 3.0], [12, 0]]);
  for (let i = 0; i < 9; i++) {
    makeTree(hideaway, -10 + i * 2.5, -4.1, 2.0 + sample(i, 31) * 1.2, ['#3f5745', '#637456', '#857c5e']);
  }
  groundPatch(hideaway, [[-9, 2.2], [-7, 1.2], [-4, 0.5], [-1, -0.2], [2, -0.8], [5, -1.5], [7, -0.6], [4, 0.1], [1, 0.9], [-3, 1.5], [-6, 2.7]], P.kraft, 0.02);

  const home = new THREE.Group();
  home.position.set(2.2, 0, -2.35);
  cutout(home, [[-1.48, 0], [-1.42, 1.75], [0, 2.76], [1.42, 1.75], [1.5, 0]], P.paperShade, { z: -0.18, depth: 0.18 });
  cutout(home, [[-1.62, 1.65], [0, 3.0], [1.62, 1.65], [1.4, 1.54], [0, 2.65], [-1.4, 1.54]], P.terracotta, { z: 0.02, depth: 0.12 });
  cutout(home, [[-1.25, 0.08], [-1.22, 1.63], [0, 2.53], [1.24, 1.63], [1.25, 0.08]], '#d9c4a0', { z: 0.12, depth: 0.05 });
  cutout(home, [[-1.16, 0.05], [-1.14, 1.57], [0, 2.38], [1.16, 1.57], [1.17, 0.05]], P.paper, { z: 0.2, depth: 0.04 });
  cutout(home, [[-0.43, 0.05], [-0.43, 1.25], [0.35, 1.25], [0.42, 0.05]], P.brown, { z: 0.28, depth: 0.05 });
  box(home, 0.12, 1.18, 0.08, P.kraft, 0.18, 0.65, 0.35);
  disk(home, 0.29, 0.67, 0.41, 0.045, 0.045, P.ochre, { depth: 0.035 });
  cutout(home, [[-0.83, 1.1], [-0.83, 1.92], [-0.11, 1.92], [-0.11, 1.1]], P.umber, { z: 0.31, depth: 0.05 });
  cutout(home, [[-0.77, 1.16], [-0.77, 1.86], [-0.17, 1.86], [-0.17, 1.16]], P.lantern, { z: 0.39, depth: 0.04, emissive: P.lantern, emissiveIntensity: 0.75 });
  box(home, 0.08, 0.76, 0.05, P.paperShade, -0.47, 1.51, 0.46);
  box(home, 0.62, 0.08, 0.05, P.paperShade, -0.47, 1.51, 0.46);
  const recipient = new THREE.Group();
  cutout(recipient, [[-0.2, 0], [-0.22, 0.5], [-0.13, 0.68], [0.14, 0.68], [0.23, 0.48], [0.2, 0]], '#71816c', { z: 0.5, depth: 0.035 });
  disk(recipient, 0, 0.82, 0.51, 0.2, 0.23, '#c78e6b', { depth: 0.035 });
  cutout(recipient, [[-0.21, 0.87], [-0.18, 1.06], [0.04, 1.12], [0.22, 0.99], [0.17, 0.91], [0, 0.98]], '#4a3e45', { z: 0.54, depth: 0.025 });
  recipient.position.set(-0.47, 1.08, 0.5);
  home.add(recipient);
  hideaway.add(home);
  const glow = new THREE.PointLight(P.lantern, 0, 5.5, 1.65);
  glow.position.set(1.73, 1.7, -1.65);
  hideaway.add(glow);
  hideaway.userData.windowGlow = glow;
  for (let i = 0; i < 16; i++) {
    const x = -9.5 + sample(i, 40) * 19;
    const z = -1.8 + sample(i, 41) * 4.8;
    if (x > 0.5 && x < 4.1 && z < -0.5) continue;
    makeReed(hideaway, x, z, 0.45 + sample(i, 42) * 0.66, i % 3);
  }
  return hideaway;
}

function createCourier() {
  const courier = new THREE.Group();
  const backLeg = new THREE.Group();
  backLeg.position.set(-0.2, 0.98, 0.03);
  cutout(backLeg, [[-0.15, 0], [0.12, 0], [0.17, -0.52], [0.31, -0.83], [0.26, -0.92], [-0.11, -0.92], [-0.19, -0.78], [-0.05, -0.48]], '#41485a', { z: 0.02, depth: 0.05 });
  cutout(backLeg, [[0.09, -0.84], [0.3, -0.83], [0.47, -0.91], [0.42, -1.0], [0.06, -1.0], [-0.02, -0.94]], P.brown, { z: 0.09, depth: 0.06 });
  courier.add(backLeg);
  const frontLeg = new THREE.Group();
  frontLeg.position.set(0.19, 0.98, 0.23);
  cutout(frontLeg, [[-0.13, 0], [0.15, 0], [0.14, -0.53], [-0.08, -0.86], [-0.02, -0.96], [0.36, -0.96], [0.41, -0.86], [0.2, -0.5]], '#303953', { z: 0.03, depth: 0.055 });
  cutout(frontLeg, [[-0.1, -0.88], [0.08, -0.87], [0.02, -0.97], [-0.34, -0.99], [-0.39, -0.92]], '#313348', { z: 0.1, depth: 0.06 });
  courier.add(frontLeg);

  const backArm = new THREE.Group();
  backArm.position.set(-0.39, 2.48, 0.02);
  cutout(backArm, [[-0.04, 0.05], [0.23, 0.12], [0.16, -0.34], [0.44, -0.68], [0.38, -0.78], [0.22, -0.74], [-0.04, -0.46]], '#39435e', { z: 0, depth: 0.05 });
  disk(backArm, 0.34, -0.73, 0.08, 0.12, 0.1, '#c78e6b', { depth: 0.035 });
  courier.add(backArm);

  box(courier, 0.7, 0.91, 0.19, P.terracotta, -0.41, 1.99, -0.13);
  cutout(courier, [[-0.78, 2.18], [-0.65, 2.56], [-0.31, 2.72], [0.28, 2.7], [0.53, 2.42], [0.49, 1.02], [0.18, 0.88], [-0.5, 0.92], [-0.65, 1.3]], '#363e5a', { z: 0.12, depth: 0.12 });
  cutout(courier, [[-0.48, 2.5], [-0.24, 2.67], [0.18, 2.62], [0.43, 2.39], [0.25, 1.12], [-0.18, 1.03], [-0.36, 1.34]], '#454d68', { z: 0.25, depth: 0.045 });
  cutout(courier, [[-0.58, 1.58], [-0.36, 1.72], [0.38, 1.58], [0.43, 1.37], [-0.54, 1.4]], '#29334d', { z: 0.31, depth: 0.035 });
  cutout(courier, [[-0.41, 2.66], [-0.16, 2.76], [0.13, 2.66], [0.02, 2.44], [-0.18, 2.42]], P.paperShade, { z: 0.34, depth: 0.035 });
  cutout(courier, [[-0.22, 2.68], [-0.13, 2.67], [-0.13, 2.33], [-0.25, 2.38]], P.rust, { z: 0.39, depth: 0.025 });

  const frontArm = new THREE.Group();
  frontArm.position.set(0.37, 2.47, 0.38);
  cutout(frontArm, [[-0.05, 0.04], [0.2, 0.04], [0.38, -0.34], [0.55, -0.64], [0.49, -0.78], [0.3, -0.77], [0.06, -0.44]], '#38425d', { z: 0, depth: 0.06 });
  disk(frontArm, 0.43, -0.75, 0.08, 0.12, 0.1, '#c78e6b', { depth: 0.035 });
  courier.add(frontArm);

  disk(courier, -0.02, 3.08, 0.33, 0.34, 0.39, '#d7aa83', { depth: 0.07 });
  cutout(courier, [[-0.37, 3.12], [-0.34, 3.4], [-0.16, 3.56], [0.14, 3.55], [0.36, 3.35], [0.31, 3.22], [0.08, 3.32], [-0.15, 3.24]], '#302e42', { z: 0.44, depth: 0.065 });
  disk(courier, -0.18, 3.08, 0.47, 0.035, 0.04, '#47343b', { depth: 0.02 });
  disk(courier, 0.12, 3.08, 0.47, 0.035, 0.04, '#47343b', { depth: 0.02 });
  cutout(courier, [[-0.02, 3.06], [-0.1, 2.91], [0.02, 2.89]], '#ae765f', { z: 0.48, depth: 0.02 });
  cutout(courier, [[-0.12, 2.82], [0.04, 2.8], [0.15, 2.85], [0.04, 2.77], [-0.08, 2.78]], '#8b5a51', { z: 0.49, depth: 0.02 });
  disk(courier, -0.44, 2.83, 0.12, 0.095, 0.2, P.paperShade, { depth: 0.08 });
  cutout(courier, [[-0.52, 2.72], [-0.31, 2.8], [0.22, 2.34], [0.13, 2.23]], '#b79e81', { z: 0.22, depth: 0.035 });
  box(courier, 0.51, 0.19, 0.18, '#dfc29b', -0.57, 2.35, 0.12);
  box(courier, 0.08, 0.2, 0.035, P.rust, -0.55, 2.35, 0.23);

  courier.userData.frontLeg = frontLeg;
  courier.userData.backLeg = backLeg;
  courier.userData.frontArm = frontArm;
  return courier;
}

await materials.ready;
addPage();
const forest = createForest();
const crossing = createCrossing();
const hideaway = createHideaway();
scene.add(forest, crossing, hideaway);

const courier = createCourier();
courier.position.set(-2.8, 0.08, 1.5);
scene.add(courier);
traveller.position = courier.position;
traveller.group = courier;

const wipe = new THREE.Mesh(
  addPaperAttributes(new THREE.PlaneGeometry(34, 21)),
  paper(P.paper),
);
wipe.position.set(34, 0, -15);
wipe.renderOrder = 20;
camera.add(wipe);
scene.add(camera);

const timeline = gsap.timeline({ paused: true });
timeline.set(forest, { visible: true }, 0);
timeline.set(crossing, { visible: false }, 0);
timeline.set(hideaway, { visible: false }, 0);
timeline.set(wipe.position, { x: 34 }, 0);
timeline.fromTo(focus, { x: -1.9, y: 1.35, z: 0.8 }, { x: -1.2, y: 1.4, z: 0.2, duration: 5.5, ease: 'sine.inOut' }, 0);
timeline.to(courier.position, { x: -0.7, z: 0.65, duration: 5.5, ease: 'sine.inOut' }, 1.1);
timeline.to(courier.userData.frontLeg.rotation, { z: 0.12, duration: 0.22, repeat: 28, yoyo: true, ease: 'sine.inOut' }, 1.1);
timeline.to(courier.userData.backLeg.rotation, { z: -0.11, duration: 0.22, repeat: 28, yoyo: true, ease: 'sine.inOut' }, 1.1);
timeline.to(courier.userData.frontArm.rotation, { z: -0.1, duration: 0.25, repeat: 25, yoyo: true, ease: 'sine.inOut' }, 1.2);

timeline.to(wipe.position, { x: 0, duration: 0.42, ease: 'power2.inOut' }, 6.35);
timeline.set(forest, { visible: false }, 6.77);
timeline.set(crossing, { visible: true }, 6.77);
timeline.set(wipe.position, { x: 34 }, 6.77);
timeline.to(focus, { x: -0.45, y: 1.35, z: 0.25, duration: 5.8, ease: 'sine.inOut' }, 6.8);
timeline.to(courier.position, { x: 0.2, z: -1.15, duration: 5.6, ease: 'sine.inOut' }, 6.9);
timeline.to(wipe.position, { x: -34, duration: 0.42, ease: 'power2.inOut' }, 6.77);
timeline.to(wipe.position, { x: 0, duration: 0.42, ease: 'power2.inOut' }, 12.82);
timeline.set(crossing, { visible: false }, 13.24);
timeline.set(hideaway, { visible: true }, 13.24);
timeline.set(wipe.position, { x: 34 }, 13.24);
timeline.to(focus, { x: 0.75, y: 1.55, z: -1.3, duration: 4.7, ease: 'sine.inOut' }, 13.25);
timeline.to(courier.position, { x: 1.38, z: -1.82, duration: 3.8, ease: 'sine.inOut' }, 13.3);
timeline.to(wipe.position, { x: -34, duration: 0.42, ease: 'power2.inOut' }, 13.24);
timeline.to(courier.userData.frontArm.rotation, { z: -0.58, duration: 0.45, ease: 'power2.out' }, 16.55);
timeline.to(courier.userData.frontArm.rotation, { z: -0.1, duration: 0.55, ease: 'power2.inOut' }, 17.2);
timeline.to(hideaway.userData.windowGlow, { intensity: 1.7, duration: 0.8, ease: 'sine.inOut' }, 14.0);
timeline.fromTo(['#eyebrow', '#title', '#subtitle'], { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 1.05, ease: 'power3.out', stagger: 0.12 }, 0.4);
timeline.to(['#eyebrow', '#title', '#subtitle'], { opacity: 0, y: -14, duration: 0.55, ease: 'power2.in', stagger: 0.04 }, 3.85);
timeline.fromTo('#ending', { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: 0.9, ease: 'power3.out' }, 17.35);

function renderFrame() {
  state.time = timeline.time();
  state.frame = Math.floor(state.time * FPS);
  state.traveller.x = courier.position.x;
  state.traveller.y = courier.position.y + 1.8;
  state.traveller.z = courier.position.z;
  camera.position.copy(focus).add(cameraOffset);
  camera.lookAt(focus);
  camera.updateMatrixWorld();
  lights.update(0, traveller, camera);
  materials.update(0);
  post.setFocus(focus);
  post.render(0);
}

timeline.eventCallback('onUpdate', renderFrame);
window.__timelines = window.__timelines || {};
window.__timelines['paper-letter'] = timeline;
timeline.seek(0, false);
renderFrame();

window.addEventListener('resize', () => {
  const width = Math.max(1, stage.clientWidth);
  const height = Math.max(1, stage.clientHeight);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  setRenderSize(width, height);
  post.setSize(width, height);
  renderFrame();
});
