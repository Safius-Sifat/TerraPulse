import { generateSynthetic, ENCODING } from './synthetic.js';

// UTM forward projection (WGS84) — lon/lat -> easting/northing
function utmForward(lon, lat, zone, north = true) {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996;
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2);
  const phi = lat * Math.PI / 180, lam = lon * Math.PI / 180;
  const lam0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const T = Math.tan(phi) ** 2, C = ep2 * Math.cos(phi) ** 2, A = Math.cos(phi) * (lam - lam0);
  const M = a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * phi
    - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * phi)
    + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * phi)
    - (35 * e2 ** 3 / 3072) * Math.sin(6 * phi));
  const x = k0 * N * (A + (1 - T + C) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5 / 120) + 500000;
  let y = k0 * (M + N * Math.tan(phi) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6 / 720));
  if (!north) y += 10000000;
  return [x, y];
}
function utmInverse(x, y, zone, north = true) {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996;
  const e2 = f * (2 - f), ep2 = e2 / (1 - e2), e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  x -= 500000; if (!north) y -= 10000000;
  const M = y / k0, mu = M / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256));
  const p1 = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu) + (151 * e1 ** 3 / 96) * Math.sin(6 * mu);
  const N1 = a / Math.sqrt(1 - e2 * Math.sin(p1) ** 2), T1 = Math.tan(p1) ** 2, C1 = ep2 * Math.cos(p1) ** 2;
  const R1 = a * (1 - e2) / (1 - e2 * Math.sin(p1) ** 2) ** 1.5, D = x / (N1 * k0);
  const lat = p1 - (N1 * Math.tan(p1) / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24 + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720);
  const lon = (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / Math.cos(p1);
  return [((zone - 1) * 6 - 180 + 3) + lon * 180 / Math.PI, lat * 180 / Math.PI];
}

// Data images (elevation, radar layers) are decoded straight from the PNG bytes, never through a
// canvas: privacy-protecting browsers (Safari, Brave, Firefox) add random noise to canvas reads on
// real websites, and in a 24-bit packed elevation a ±1 change in red is a ±655 m spike.
async function decodePNG(buf) {
  const b = new Uint8Array(buf), dv = new DataView(buf);
  if (b[0] !== 0x89 || b[1] !== 0x50) return null;               // not a PNG (e.g. a JPEG photo)
  let p = 8, W = 0, H = 0, type = 0, depth = 0, interlace = 0; const idat = [];
  while (p < b.length) {
    const len = dv.getUint32(p), tag = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
    if (tag === 'IHDR') { W = dv.getUint32(p + 8); H = dv.getUint32(p + 12); depth = b[p + 16]; type = b[p + 17]; interlace = b[p + 20]; }
    else if (tag === 'IDAT') idat.push(b.subarray(p + 8, p + 8 + len));
    else if (tag === 'IEND') break;
    p += 12 + len;
  }
  const ch = { 6: 4, 2: 3, 0: 1, 4: 2 }[type];
  if (depth !== 8 || !ch || interlace) return null;               // unusual format: let the caller fall back
  const raw = new Uint8Array(await new Response(new Blob(idat).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
  const stride = W * ch, out = new Uint8Array(W * H * 4); let prev = new Uint8Array(stride), cur = new Uint8Array(stride);
  for (let y = 0, q = 0; y < H; y++) {
    const f = raw[q++];
    for (let x = 0; x < stride; x++, q++) {
      const a = x >= ch ? cur[x - ch] : 0, up = prev[x], c = x >= ch ? prev[x - ch] : 0; let v = raw[q];
      if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) { const pp = a + up - c, pa = Math.abs(pp - a), pb = Math.abs(pp - up), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
      cur[x] = v;
    }
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4, i = x * ch;
      if (ch >= 3) { out[o] = cur[i]; out[o + 1] = cur[i + 1]; out[o + 2] = cur[i + 2]; out[o + 3] = ch === 4 ? cur[i + 3] : 255; }
      else { out[o] = out[o + 1] = out[o + 2] = cur[i]; out[o + 3] = ch === 2 ? cur[i + 1] : 255; }
    }
    [prev, cur] = [cur, prev];
  }
  return out;
}

async function pixelsOf(url) {
  const buf = await (await fetch(url)).arrayBuffer();
  try { const px = await decodePNG(buf); if (px) return px; } catch (e) { console.warn('PNG decode failed, using canvas', url, e); }
  // photos (JPEG) go through the browser decoder; any canvas noise there is invisible
  const bmp = await createImageBitmap(new Blob([buf]), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  return g.getImageData(0, 0, bmp.width, bmp.height).data;
}

async function loadReal(base, onProgress) {
  const m = await (await fetch(`${base}/manifest.json`)).json();
  const W = m.width, H = m.height, N = m.dates.length, n = W * H;
  const layers = new Uint8Array(n * 4 * N);
  for (let i = 0; i < N; i++) {
    onProgress(i / (N + 1), `Loading NISAR pass ${m.dates[i]}`);
    layers.set(await pixelsOf(`${base}/${m.layers[i]}`), i * n * 4);
  }
  let dem = null;
  if (m.dem) {
    const d = await pixelsOf(`${base}/${m.dem.file}`);
    dem = new Float32Array(n);
    for (let k = 0; k < n; k++) dem[k] = ((d[k * 4] << 16) | (d[k * 4 + 1] << 8) | d[k * 4 + 2]) * m.dem.scale + m.dem.offset;
    // display smoothing: surface DEMs include trees/buildings, which look like spikes at slab scale
    const tmp = new Float32Array(n), R = 3;
    for (let pass = 0; pass < 2; pass++) {
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        let s = 0, c = 0;
        for (let di = -R; di <= R; di++) { const x = i + di; if (x >= 0 && x < W) { s += dem[j * W + x]; c++; } }
        tmp[j * W + i] = s / c;
      }
      for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
        let s = 0, c = 0;
        for (let dj = -R; dj <= R; dj++) { const y = j + dj; if (y >= 0 && y < H) { s += tmp[y * W + i]; c++; } }
        dem[j * W + i] = s / c;
      }
    }
  }
  let optical = m.optical ? new Uint8Array(await pixelsOf(`${base}/${m.optical}`)) : null;
  if (!optical) {
    // stylised base colours from the first observation (not a photo)
    optical = new Uint8Array(n * 4);
    for (let k = 0; k < n; k++) {
      const r = layers[k * 4], g = layers[k * 4 + 1], w = layers[k * 4 + 2];
      const v = g / 255;
      optical[k * 4] = w === 255 ? 60 : 40 + 120 * v + 0.15 * r;
      optical[k * 4 + 1] = w === 255 ? 82 : 60 + 110 * v;
      optical[k * 4 + 2] = w === 255 ? 88 : 36 + 60 * v;
      optical[k * 4 + 3] = 255;
    }
  }
  const { zone, north } = m.utm, { x0, y0, dx, dy } = m.transform;
  onProgress(1, 'Ready');
  return {
    source: 'nisar', label: `NISAR L2 GCOV · ${m.site}`,
    W, H, N, dates: m.dates, layers, optical, dem, waterLevels: m.water_levels_m || null,
    stats: m.stats, kmX: W * dx / 1000, kmY: H * Math.abs(dy) / 1000, pxAreaKm2: dx * Math.abs(dy) / 1e6,
    encoding: m.encoding || ENCODING, products: m.products, manifest: m,
    terrainReal: !!dem, terrainMeta: m.dem ? { source: m.dem.source || 'DEM resampled by prepare_web_data.py (surface model, display-smoothed)' } : null,
    toUV: (lon, lat) => { const [x, y] = utmForward(lon, lat, zone, north); return [(x - x0) / (dx * W), (y0 - y) / (Math.abs(dy) * H)]; },
    toLonLat: (u, v) => utmInverse(x0 + u * dx * W, y0 - v * Math.abs(dy) * H, zone, north),
  };
}

export async function loadDataset(dataName, onProgress = () => {}) {
  if (dataName) {
    try {
      const r = await fetch(`data/${dataName}/manifest.json`, { method: 'HEAD' });
      if (r.ok) return await loadReal(`data/${dataName}`, onProgress);
      console.warn(`No real data at data/${dataName}; using simulation`);
    } catch (e) { console.warn('Real data load failed, using simulation', e); }
  }
  // simulated radar, on real terrain when available
  let terrain = null, meta = null;
  try {
    const r = await fetch('data/terrain/tonle-sap.json');
    if (r.ok) {
      meta = await r.json();
      if (meta.width === SIM_SIZE && meta.height === SIM_SIZE) {
        onProgress(0.02, 'Loading Copernicus terrain');
        const d = await pixelsOf(`data/terrain/${meta.files.terrain}`);
        terrain = new Float32Array(meta.width * meta.height);
        for (let k = 0; k < terrain.length; k++) terrain[k] = ((d[k * 4] << 16) | (d[k * 4 + 1] << 8) | d[k * 4 + 2]) * meta.scale + meta.offset;
      }
    }
  } catch (e) { console.warn('Terrain load failed; using synthetic terrain', e); }
  const data = await generateSynthetic(onProgress, terrain, terrain ? meta : null);
  // This georeferenced mosaic has the same bounds and pixel dimensions as the
  // Tonle Sap terrain. Keep the synthetic fallback if the image is unavailable.
  if (terrain && meta.bbox && JSON.stringify(meta.bbox) === JSON.stringify([103.7, 13.12, 104.14, 13.56])) {
    try {
      const pixels = await pixelsOf('data/terrain/tonle-sap-sentinel2.png');
      if (pixels.length === data.W * data.H * 4) {
        data.optical = new Uint8Array(pixels);
        data.opticalMeta = { year: 2016 };
      }
    } catch (e) { console.warn('Satellite mosaic unavailable; using simulated colours', e); }
  }
  return data;
}
const SIM_SIZE = 768;
