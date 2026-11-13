import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { createSatellite } from './scene/satellite.js';
import { createScatter } from './scene/scatter.js';
import { createStack } from './scene/stack.js';
import { createGlobe } from './scene/globe.js';
import { createBuildings } from './scene/buildings.js';
import { loadDataset } from './data/loader.js';
import { SITES } from './sites.js';
import * as S from './scene/shaders.js';
import { Sound } from './sound.js';
import { startStory } from './story.js';

const params = new URLSearchParams(location.search);
const dataName = params.get('data') || 'tonle-sap';

// ---------- renderer / camera ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0x04060a, 1);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 600);
camera.position.set(0, 70, 70);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.07;
controls.maxPolarAngle = 1.36; controls.minDistance = 0.8; controls.maxDistance = 130;
controls.screenSpacePanning = false;

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();

// starfield
{
  const g = new THREE.BufferGeometry(), N = 1800, p = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = 220 + Math.random() * 120, s = Math.sqrt(1 - u * u);
    p.set([r * s * Math.cos(th), r * u, r * s * Math.sin(th)], i * 3);
  }
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0x8fa6c2, size: 0.9, transparent: true, opacity: 0.55, depthWrite: false })));
}

// ---------- load data ----------
const loaderEl = document.getElementById('loader');
const loadBar = loaderEl.querySelector('.bar i'), loadMsg = loaderEl.querySelector('.msg');
const ds = await loadDataset(dataName, (p, msg) => { loadBar.style.width = `${Math.round(p * 100)}%`; loadMsg.textContent = msg; });
const site = SITES[params.get('site') || (ds.source === 'simulated' ? 'tonle-sap' : dataName)] || SITES.generic(dataName);

const KX = ds.kmX, KY = ds.kmY, SCALE = Math.max(KX, KY) / 48;
const EX = site.exaggeration ?? 0.32 * SCALE, BASE = -1.7 * SCALE;
const hDisp = (e) => EX * Math.log2(1 + Math.max(e, 0) / 1.5);
function demAt(u, v) {
  if (!ds.dem) return 0;
  const x = Math.min(Math.max(u * (ds.W - 1), 0), ds.W - 1.001), y = Math.min(Math.max(v * (ds.H - 1), 0), ds.H - 1.001);
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, W = ds.W, d = ds.dem;
  const a = d[j * W + i], b = d[j * W + i + 1], c = d[(j + 1) * W + i], e = d[(j + 1) * W + i + 1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy;
}
const levelAt = (t) => {
  if (!ds.waterLevels) return 0;
  const a = Math.floor(t), b = Math.min(a + 1, ds.N - 1), f = t - a;
  return ds.waterLevels[a] * (1 - f) + ds.waterLevels[b] * f;
};
const maxWaterY = ds.waterLevels ? hDisp(Math.max(...ds.waterLevels)) : 0;

// ---------- textures ----------
const radarTex = new THREE.DataArrayTexture(ds.layers, ds.W, ds.H, ds.N);
radarTex.minFilter = radarTex.magFilter = THREE.LinearFilter; radarTex.needsUpdate = true;
const optTex = new THREE.DataTexture(ds.optical, ds.W, ds.H);
optTex.minFilter = optTex.magFilter = THREE.LinearFilter; optTex.needsUpdate = true;
const revealCanvas = document.createElement('canvas'); revealCanvas.width = revealCanvas.height = 256;
const rctx = revealCanvas.getContext('2d', { willReadFrequently: true });
rctx.fillStyle = '#000'; rctx.fillRect(0, 0, 256, 256);
const revealTex = new THREE.CanvasTexture(revealCanvas); revealTex.flipY = false;

const U = {
  uRadar: { value: radarTex }, uOptical: { value: optTex }, uReveal: { value: revealTex },
  uT: { value: 0 }, uN: { value: ds.N }, uMode: { value: 1 }, uRevealAll: { value: 0 }, uCloudFade: { value: 0 },
  uTime: { value: 0 }, uWaterGlow: { value: 0 }, uKm: { value: new THREE.Vector2(KX, KY) },
  uLens: { value: new THREE.Vector2(0.5, 0.5) }, uLensR: { value: 2.2 }, uLensMode: { value: 1 }, uLensOn: { value: 0 },
  uPulses: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, -99, 0)) },
  uProbe: { value: new THREE.Vector2() }, uProbeOn: { value: 0 },
  uTarget: { value: new THREE.Vector2() }, uTargetGlow: { value: 0 },
  uContours: { value: 0 }, uWaterLevel: { value: -99 }, uHasDem: { value: ds.dem ? 1 : 0 },
  uScanV: { value: -1 }, uScanA: { value: 0 }, uScanB: { value: 0 },
  uSecA: { value: new THREE.Vector2() }, uSecB: { value: new THREE.Vector2() }, uSecOn: { value: 0 },
  uHH: { value: new THREE.Vector2(...ds.encoding.hh) }, uHV: { value: new THREE.Vector2(...ds.encoding.hv) },
};

// ---------- terrain slab ----------
const SEG = 383;
const terrainGeo = (() => {
  const g = new THREE.BufferGeometry(), V = (SEG + 1) ** 2;
  const pos = new Float32Array(V * 3), uv = new Float32Array(V * 2), el = new Float32Array(V), idx = [];
  for (let j = 0; j <= SEG; j++) for (let i = 0; i <= SEG; i++) {
    const k = j * (SEG + 1) + i, u = i / SEG, v = j / SEG;
    const e = demAt(u, v); el[k] = e;
    pos.set([(u - 0.5) * KX, hDisp(e), (v - 0.5) * KY], k * 3); uv.set([u, v], k * 2);
  }
  for (let j = 0; j < SEG; j++) for (let i = 0; i < SEG; i++) {
    const a = j * (SEG + 1) + i, b = a + SEG + 1, c = a + 1, d = b + 1;
    idx.push(a, b, c, c, b, d);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aElev', new THREE.BufferAttribute(el, 1));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
})();
const terrain = new THREE.Mesh(terrainGeo, new THREE.ShaderMaterial({ uniforms: U, vertexShader: S.terrainVert, fragmentShader: S.terrainFrag }));
scene.add(terrain);

// skirts: soil cross-section + water column
const skirtU = { uWaterY: { value: 0 }, uHasWater: { value: ds.waterLevels ? 1 : 0 }, uBase: { value: BASE }, uTime: U.uTime };
{
  const pos = [], top = [], side = [], along = [], idx = [];
  const edges = [
    (s) => [s, 0, 0.75], (s) => [1, s, 1.0], (s) => [1 - s, 1, 0.55], (s) => [0, 1 - s, 0.85],
  ];
  for (const edge of edges) {
    const start = pos.length / 3;
    for (let k = 0; k <= SEG; k++) {
      const [u, v, sh] = edge(k / SEG), h = hDisp(demAt(u, v)), x = (u - 0.5) * KX, z = (v - 0.5) * KY;
      const ymax = Math.max(h, maxWaterY) + 0.01;
      pos.push(x, BASE, z, x, ymax, z); top.push(h, h); side.push(sh, sh); along.push(k / SEG, k / SEG);
      if (k < SEG) { const a = start + k * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aTop', new THREE.Float32BufferAttribute(top, 1));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
  g.setAttribute('aAlong', new THREE.Float32BufferAttribute(along, 1));
  g.setIndex(idx);
  scene.add(new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: skirtU, vertexShader: S.skirtVert, fragmentShader: S.skirtFrag, side: THREE.DoubleSide, transparent: true })));
  const bottom = new THREE.Mesh(new THREE.PlaneGeometry(KX, KY), new THREE.MeshBasicMaterial({ color: 0x050405 }));
  bottom.rotation.x = Math.PI / 2; bottom.position.y = BASE; scene.add(bottom);
  // soft glow halo under the slab
  const halo = new THREE.Mesh(new THREE.CircleGeometry(Math.max(KX, KY) * 1.1, 64), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    vertexShader: S.cloudVert,
    fragmentShader: `varying vec2 vUv; void main(){ float d = length(vUv-.5)*2.; gl_FragColor = vec4(.15,.45,.6, .22*pow(max(1.-d,0.),2.5)); }`,
  }));
  halo.rotation.x = -Math.PI / 2; halo.position.y = BASE - 0.6; scene.add(halo);
}

// water surface
const waterU = { uTime: U.uTime, uOpacity: { value: 0.32 }, uKm: U.uKm };
const water = new THREE.Mesh(new THREE.PlaneGeometry(KX, KY), new THREE.ShaderMaterial({
  uniforms: waterU, vertexShader: S.waterVert, fragmentShader: S.waterFrag, transparent: true, depthWrite: false,
}));
water.rotation.x = -Math.PI / 2; water.visible = !!ds.waterLevels; scene.add(water);

// clouds
const CLOUD_SCALE = 1.3;
const cloudU = { uReveal: U.uReveal, uRevealAll: U.uRevealAll, uCloudFade: U.uCloudFade, uTime: U.uTime, uScale: { value: CLOUD_SCALE } };
const clouds = new THREE.Mesh(new THREE.PlaneGeometry(KX * CLOUD_SCALE, KY * CLOUD_SCALE), new THREE.ShaderMaterial({
  uniforms: cloudU, vertexShader: S.cloudVert, fragmentShader: S.cloudFrag, transparent: true, depthWrite: false,
}));
clouds.rotation.x = -Math.PI / 2;
{ let m = 0; if (ds.dem) for (let k = 0; k < ds.dem.length; k += 7) m = Math.max(m, ds.dem[k]); clouds.position.y = Math.max(4.0 * SCALE, hDisp(m) + 1.4 * SCALE); }
clouds.renderOrder = 10; scene.add(clouds);

// lights (only the satellite uses lit materials; terrain shaders do their own shading)
scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x20160c, 1.1));
const sun = new THREE.DirectionalLight(0xfff1dc, 2.2); sun.position.set(-30, 40, 20); scene.add(sun);

// ---------- set pieces ----------
let topY = 0; if (ds.dem) { for (let k = 0; k < ds.dem.length; k += 5) topY = Math.max(topY, ds.dem[k]); topY = hDisp(topY); }
const satellite = createSatellite({ scene, U, KX, KY, scale: SCALE });
const scatter = createScatter({ scene });
const stack = createStack({ scene, U, ds, KX, KY, top: Math.max(topY, hDisp(ds.waterLevels ? Math.max(...ds.waterLevels) : 0)) + 0.3 * SCALE, scale: SCALE });

loadMsg.textContent = 'Raising OpenStreetMap buildings';
const buildings = await createBuildings({ scene, U, ds, demAt, hDisp, KX, KY, scale: SCALE, siteId: site.id });
const osmAttr = document.createElement('div'); osmAttr.id = 'osmAttr';
osmAttr.innerHTML = buildings ? `Buildings: footprints ${buildings.attribution} · heights mostly estimated · drawn ${buildings.exaggeration}× taller` : '';
document.body.appendChild(osmAttr);

// bloom: lets pulses, beams, double-bounce glints and water glow actually glow
const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
const [cLon, cLat] = site.globeTarget ? [site.globeTarget.lon, site.globeTarget.lat] : ds.toLonLat(0.5, 0.5);
const globe = createGlobe({ target: { lat: cLat, lon: cLon } });
addEventListener('resize', () => globe.resize(innerWidth, innerHeight)); globe.resize(innerWidth, innerHeight);
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), 0.55, 0.6, 0.78);
composer.addPass(bloom);
function resizeComposer() { composer.setPixelRatio(Math.min(devicePixelRatio, 2)); composer.setSize(innerWidth, innerHeight); }
addEventListener('resize', resizeComposer); resizeComposer();

// ---------- app API used by the story ----------
const clock = new THREE.Clock();
const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
let tween = null, pulseSlot = 0;
const livePulses = [];
const listeners = [];
const labelsEl = document.getElementById('labels');
let labels = [];

const app = {
  ds, site, controls, camera, U, sound: new Sound(), water, waterU, satellite, scatter, stack, bloom, globe, buildings, scale: SCALE, waterBase: 0.32,
  get now() { return clock.elapsedTime; },
  state: { t: 0 },
  hDisp, demAt, levelAt, kmX: KX, kmY: KY,
  uvToWorld(u, v) { return new THREE.Vector3((u - 0.5) * KX, hDisp(demAt(u, v)), (v - 0.5) * KY); },
  pick(clientX, clientY) {
    ndc.set((clientX / innerWidth) * 2 - 1, -(clientY / innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    // heightfield intersection: iterate ray/plane at the local terrain height (fast, no mesh raycast)
    const o = raycaster.ray.origin, d = raycaster.ray.direction;
    if (d.y > -1e-4) return null;
    let h = 0, u = 0, v = 0;
    for (let i = 0; i < 8; i++) {
      const t = (h - o.y) / d.y;
      u = (o.x + d.x * t) / KX + 0.5; v = (o.z + d.z * t) / KY + 0.5;
      if (u < -0.05 || u > 1.05 || v < -0.05 || v > 1.05) return null;
      h = hDisp(demAt(Math.min(1, Math.max(0, u)), Math.min(1, Math.max(0, v))));
    }
    return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? [u, v] : null;
  },
  flyTo({ lon, lat, uv, dist = 30, elev = 0.75, az = 0, lift = 0 }, dur = 2.6) {
    const [u, v] = uv || ds.toUV(lon, lat);
    dist *= Math.max(1, 1.55 / camera.aspect) * SCALE;
    const target = app.uvToWorld(u, v); target.y += lift * SCALE;
    const pos = target.clone().add(new THREE.Vector3(Math.sin(az) * Math.cos(elev), Math.sin(elev), Math.cos(az) * Math.cos(elev)).multiplyScalar(dist));
    if (dur <= 0) { camera.position.copy(pos); controls.target.copy(target); tween = null; return; }
    tween = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: target, s: clock.elapsedTime, d: dur };
  },
  setGlobe(on) { globe.active = on; renderPass.scene = on ? globe.scene : scene; renderPass.camera = on ? globe.camera : camera; document.body.classList.toggle('in-globe', on); },
  pulse(u, v, reveal = true) {
    const p = U.uPulses.value[pulseSlot++ % 6]; p.set(u, v, clock.elapsedTime, 1);
    if (reveal) livePulses.push({ u, v, s: clock.elapsedTime });
    app.sound.ping();
  },
  resetReveal() { rctx.fillStyle = '#000'; rctx.fillRect(0, 0, 256, 256); revealTex.needsUpdate = true; },
  revealFraction() {
    const d = rctx.getImageData(0, 0, 256, 256).data; let c = 0;
    for (let i = 0; i < d.length; i += 16) if (d[i] > 110) c++;
    return c / (d.length / 16);
  },
  sample(u, v, ti) {
    const W = ds.W, H = ds.H, i0 = Math.round(u * (W - 1)), j0 = Math.round(v * (H - 1));
    let hh = 0, hv = 0, c = 0; const base = ti * W * H * 4, [a0, a1] = ds.encoding.hh, [b0, b1] = ds.encoding.hv;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const i = Math.min(W - 1, Math.max(0, i0 + di)), j = Math.min(H - 1, Math.max(0, j0 + dj)), o = base + (j * W + i) * 4;
      if (ds.layers[o + 3] < 128) continue;
      // average in linear power, report dB
      hh += 10 ** ((a0 + (a1 - a0) * ds.layers[o] / 255) / 10); hv += 10 ** ((b0 + (b1 - b0) * ds.layers[o + 1] / 255) / 10); c++;
    }
    const o = base + (j0 * W + i0) * 4;
    return c ? { hh: 10 * Math.log10(hh / c), hv: 10 * Math.log10(hv / c), flag: ds.layers[o + 2] } : null;
  },
  areaAt(t) {
    const a = Math.floor(t), b = Math.min(a + 1, ds.N - 1), f = t - a, s = ds.stats;
    return { open: s[a].openKm2 * (1 - f) + s[b].openKm2 * f, veg: s[a].floodedVegKm2 * (1 - f) + s[b].floodedVegKm2 * f };
  },
  setLabels(names, { elevations = false } = {}) {
    labelsEl.innerHTML = '';
    labels = (site.pois || []).filter((p) => names === 'all' || names.includes(p.id)).map((p) => {
      const el = document.createElement('div'); el.className = elevations ? 'label elevation-label' : 'label';
      const [u, v] = ds.toUV(p.lon, p.lat);
      const elevation = elevations && p.id === 'ts' ? 'DEM water surface · not lake depth' :
        elevations && ds.dem && u >= 0 && u <= 1 && v >= 0 && v <= 1
          ? `~${Math.round(demAt(u, v))} m · smoothed DEM at marker` : '';
      const note = elevations ? elevation : p.note;
      el.innerHTML = `<b>${p.name}</b>${note ? `<span>${note}</span>` : ''}`;
      labelsEl.appendChild(el);
      return { el, pos: app.uvToWorld(u, v).add(new THREE.Vector3(0, 0.15, 0)) };
    });
  },
  onFrame(fn) { listeners.push(fn); },
};
window.app = app;
app.setGlobe(true);
controls.addEventListener('start', () => document.body.classList.add('orbiting'));
controls.addEventListener('end', () => document.body.classList.remove('orbiting'));

// ---------- map furniture: scale bar, north arrow, lat/lon edge ticks ----------
const furn = document.createElement('div'); furn.id = 'mapkit';
furn.innerHTML = `<div id="north"><svg viewBox="0 0 24 24"><path d="M12 2l5 14-5-3-5 3z"/></svg><b>N</b></div>
  <div id="scalebar"><i></i><span></span></div>`;
document.getElementById('hud').appendChild(furn);
const northEl = furn.querySelector('#north'), scaleEl = furn.querySelector('#scalebar'), scaleBar = scaleEl.querySelector('i'), scaleTxt = scaleEl.querySelector('span');
const ticksEl = document.createElement('div'); ticksEl.id = 'ticks'; document.body.appendChild(ticksEl);
const edgeTicks = [];
{
  const [lonA, latS] = ds.toLonLat(0, 1), [lonB] = ds.toLonLat(1, 1), [, latN] = ds.toLonLat(0, 0);
  const span = Math.max(lonB - lonA, latN - latS), step = span > 0.3 ? 0.1 : span > 0.12 ? 0.05 : 0.02;
  const fmt = (x) => x.toFixed(step < 0.05 ? 2 : step < 0.1 ? 2 : 1);
  for (let lon = Math.ceil(lonA / step) * step; lon < lonB - step * 0.2; lon += step) {
    const [u] = ds.toUV(lon, ds.toLonLat(0.5, 1)[1]);
    if (u < 0.02 || u > 0.98) continue;
    edgeTicks.push({ text: `${fmt(lon)}°E`, pos: new THREE.Vector3((u - 0.5) * KX, BASE * 0.25, KY / 2 + 0.02), cls: 'lon' });
  }
  for (let lat = Math.ceil(latS / step) * step; lat < latN - step * 0.2; lat += step) {
    const [, v] = ds.toUV(ds.toLonLat(0, 0.5)[0], lat);
    if (v < 0.02 || v > 0.98) continue;
    edgeTicks.push({ text: `${fmt(lat)}°N`, pos: new THREE.Vector3(-KX / 2 - 0.02, BASE * 0.25, (v - 0.5) * KY), cls: 'lat' });
  }
  for (const t of edgeTicks) { t.el = document.createElement('div'); t.el.className = `etick ${t.cls}`; t.el.textContent = t.text; ticksEl.appendChild(t.el); }
}
const _p0 = new THREE.Vector3(), _p1 = new THREE.Vector3(), _r = new THREE.Vector3();
function updateFurniture() {
  const tgt = controls.target;
  _r.setFromMatrixColumn(camera.matrixWorld, 0); _r.y = 0; _r.normalize();
  _p0.copy(tgt).project(camera); _p1.copy(tgt).addScaledVector(_r, 1).project(camera);
  const pxPerKm = Math.hypot((_p1.x - _p0.x) * innerWidth / 2, (_p1.y - _p0.y) * innerHeight / 2);
  const nice = [0.5, 1, 2, 5, 10, 20, 50].find((k) => k * pxPerKm >= 70) || 50;
  scaleBar.style.width = `${Math.round(nice * pxPerKm)}px`; scaleTxt.textContent = `${nice} km`;
  _p1.copy(tgt).add(new THREE.Vector3(0, 0, -1)).project(camera);
  const ang = Math.atan2((_p1.x - _p0.x) * innerWidth, (_p1.y - _p0.y) * innerHeight);
  northEl.style.transform = `rotate(${ang}rad)`;
  for (const t of edgeTicks) {
    _p0.copy(t.pos).project(camera);
    const vis = _p0.z < 1 && Math.abs(_p0.x) < 1.05 && Math.abs(_p0.y) < 1.05;
    t.el.style.opacity = vis ? 1 : 0;
    t.el.style.transform = `translate(${(_p0.x * 0.5 + 0.5) * innerWidth}px, ${(-_p0.y * 0.5 + 0.5) * innerHeight}px)`;
  }
}

// ---------- loop ----------
const tmp = new THREE.Vector3();
const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05), now = clock.elapsedTime;
  U.uTime.value = now;
  U.uT.value = app.state.t;
  if (tween) {
    const k = Math.min(1, (now - tween.s) / tween.d), e = ease(k);
    camera.position.lerpVectors(tween.p0, tween.p1, e); controls.target.lerpVectors(tween.t0, tween.t1, e);
    if (k >= 1) tween = null;
  }
  // paint reveal from expanding pulses
  for (let i = livePulses.length - 1; i >= 0; i--) {
    const p = livePulses[i], age = now - p.s;
    if (age > 1.4) { livePulses.splice(i, 1); continue; }
    const r = Math.max(2, (age * 8 / KX) * 256);
    const g = rctx.createRadialGradient(p.u * 256, p.v * 256, 0, p.u * 256, p.v * 256, r);
    g.addColorStop(0, 'rgba(255,255,255,0.22)'); g.addColorStop(0.8, 'rgba(255,255,255,0.16)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    rctx.globalCompositeOperation = 'lighter'; rctx.fillStyle = g;
    rctx.beginPath(); rctx.arc(p.u * 256, p.v * 256, r, 0, Math.PI * 2); rctx.fill();
    rctx.globalCompositeOperation = 'source-over';
    revealTex.needsUpdate = true;
  }
  if (ds.waterLevels) {
    const y = hDisp(levelAt(app.state.t)) + 0.004;
    water.position.y = y; skirtU.uWaterY.value = y; U.uWaterLevel.value = levelAt(app.state.t);
  }
  if (globe.active) globe.update(dt, now);
  for (const fn of listeners) fn(dt, now);
  satellite.update(dt, camera); scatter.update(now, camera); stack.update(dt, camera, app.state.t);
  if (buildings && !globe.active) {
    buildings.update(camera, controls.target, levelAt(app.state.t));
    osmAttr.style.opacity = buildings.fade > 0.05 ? 1 : 0;
  }
  // the exaggerated 3D water plane would bury true-scale houses: thin it out in close-ups
  waterU.uOpacity.value = app.waterBase * (1 - (buildings?.fade || 0) * 0.85);
  controls.update();
  for (const l of labels) {
    tmp.copy(l.pos).project(camera);
    const vis = tmp.z < 1 && Math.abs(tmp.x) < 1.1 && Math.abs(tmp.y) < 1.1;
    l.el.style.opacity = vis ? 1 : 0;
    l.el.style.transform = `translate(${(tmp.x * 0.5 + 0.5) * innerWidth}px, ${(-tmp.y * 0.5 + 0.5) * innerHeight}px)`;
  }
  updateFurniture();
  composer.render();
}
function frame() { tick(); requestAnimationFrame(frame); }
app.tick = (n = 1) => { for (let i = 0; i < n; i++) tick(); }; // debug: render while the tab is hidden

loaderEl.classList.add('done');
startStory(app);
frame();
