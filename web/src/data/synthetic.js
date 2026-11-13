// Procedurally simulated NISAR-like L-band GCOV time series for Tonle Sap / Angkor.
// Clearly labelled as SIMULATED in the UI. Same encoding as real data produced by
// scripts/prepare_web_data.py, so the experience swaps to real data unchanged.
//
// Encoding per date (RGBA8):
//   R = HH dB mapped from [-30, 5]
//   G = HV dB mapped from [-35, -5]
//   B = water flag: 255 open water, 170 flooded vegetation, 0 dry
//   A = 255 valid, 0 invalid

export const ENCODING = { hh: [-30, 5], hv: [-35, -5] };

const W = 768, H = 768;
const LON0 = 103.70, LON1 = 104.14, LAT0 = 13.56, LAT1 = 13.12;
const KM_X = (LON1 - LON0) * 108.4; // ~47.7 km
const KM_Y = (LAT0 - LAT1) * 110.6; // ~48.7 km

// ---------- noise ----------
function hash2(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}
function fbm(x, y, s, oct = 4) {
  let sum = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { sum += amp * vnoise(x * f, y * f, s + i * 17); f *= 2.03; amp *= 0.5; }
  return sum;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- geography helpers (km, X east, Y south from NW corner) ----------
const kx = (lon) => (lon - LON0) * 108.4;
const ky = (lat) => (LAT0 - lat) * 110.6;
const P = (lon, lat) => [kx(lon), ky(lat)];

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  const cx = ax + t * dx - px, cy = ay + t * dy - py;
  return Math.sqrt(cx * cx + cy * cy);
}
function polyDist(px, py, pts) {
  let d = 1e9;
  for (let i = 0; i < pts.length - 1; i++) d = Math.min(d, segDist(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
  return d;
}
const inRect = (x, y, cx, cy, hw, hh) => Math.abs(x - cx) < hw && Math.abs(y - cy) < hh;
const ring = (x, y, cx, cy, hw, hh, w) => inRect(x, y, cx, cy, hw, hh) && !inRect(x, y, cx, cy, hw - w, hh - w);
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Classes
const FOREST = 1, SHRUB = 2, RICE = 3, GRASS = 4, URBAN = 5, TEMPLE = 6, PERMWATER = 7,
  ROAD = 8, RUNWAY = 9, VILLAGE = 10, EMBANK = 11, MUD = 12;

const NR6 = [P(103.70, 13.345), P(103.78, 13.352), P(103.83, 13.360), P(103.86, 13.362), P(103.92, 13.36), P(104.0, 13.34), P(104.14, 13.31)];
const ANGKOR_RD = [P(103.856, 13.37), P(103.86, 13.40), P(103.866, 13.405)];
const KNEAS_RD = [P(103.85, 13.35), P(103.825, 13.30), P(103.82, 13.255)];
const RIVER = [P(104.03, 13.52), P(103.97, 13.49), P(103.92, 13.46), P(103.885, 13.43), P(103.865, 13.40), P(103.858, 13.37), P(103.855, 13.33), P(103.85, 13.29), P(103.845, 13.25)];

const AW = P(103.867, 13.4125), AT = P(103.859, 13.4413), BAKHENG = P(103.856, 13.424);
const WB = P(103.790, 13.4425), EB = P(103.912, 13.445), SS = P(103.931, 13.43);
const TOWN = P(103.856, 13.365), KROM = P(103.815, 13.296);
const KNEAS = P(103.82, 13.24), PHLUK = P(103.97, 13.215);
const KULEN = P(104.16, 13.63);
const RWY_C = P(103.813, 13.41), RWY_D = [0.766, -0.643];

export const SIM_DATES = (() => {
  const out = []; const d = new Date(Date.UTC(2026, 5, 4));
  for (let i = 0; i < 14; i++) { out.push(new Date(d.getTime() + i * 12 * 864e5).toISOString().slice(0, 10)); }
  return out;
})();

function doy(iso) { const d = new Date(iso + 'T00:00:00Z'); return Math.round((d - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5); }

// Lake level (m) — monsoon flood pulse, peaks early October.
export function simLevel(iso) {
  const t = doy(iso), peak = 281;
  if (t <= peak) { const s = Math.max(0, Math.min(1, (t - 150) / (peak - 150))); return 1.5 + 8.0 * Math.pow(s, 1.6); }
  return 9.5 - 8.0 * Math.min(1, (t - peak) / 60) * 0.35;
}

export const SIM_BBOX = [LON0, LAT1, LON1, LAT0]; // W S E N

// terrain: optional Float32Array (W*H, metres) of real elevation on this grid
export async function generateSynthetic(onProgress = () => {}, terrain = null, terrainMeta = null) {
  const N = SIM_DATES.length, n = W * H;
  const cls = new Uint8Array(n), elev = new Float32Array(n), tex = new Float32Array(n), phase = new Float32Array(n);
  const optical = new Uint8Array(n * 4);
  const pxkm = KM_X / W, pykm = KM_Y / H;

  // ---------- static landscape ----------
  for (let j = 0; j < H; j++) {
    if (j % 64 === 0) { onProgress(0.3 * j / H, 'Shaping the floodplain'); await new Promise((r) => setTimeout(r, 0)); }
    for (let i = 0; i < W; i++) {
      const k = j * W + i;
      const X = (i + 0.5) * pxkm, Y = (j + 0.5) * pykm;
      const lon = LON0 + X / 108.4, lat = LAT0 - Y / 110.6;
      const n1 = fbm(X * 0.55, Y * 0.55, 11), n2 = fbm(X * 1.6, Y * 1.6, 29);
      tex[k] = n2;
      const rk = Math.hypot(X - KULEN[0], Y - KULEN[1]);
      const rKrom = Math.hypot(X - KROM[0], Y - KROM[1]), rBak = Math.hypot(X - BAKHENG[0], Y - BAKHENG[1]);
      let d, e, plateau;
      if (terrain) {
        // real Copernicus terrain: zone by height above the dry-season lake surface (1.5 m)
        e = terrain[k];
        const hd = e - 1.5;
        d = hd < 0.15 ? -1 : (-0.55 + Math.sqrt(0.3025 + 0.04 * hd)) / 0.02; // inverse of the synthetic profile
        plateau = smooth(60, 120, e);
      } else {
        const latS = 13.245 - 0.25 * (lon - 103.70);
        d = (lat - latS) * 110.6 + 3.2 * fbm(X * 0.09, Y * 0.09, 3) + 1.4 * fbm(X * 0.35, Y * 0.35, 4);
        e = d < 0 ? Math.max(-3, 1.4 + d * 0.35) : 1.5 + 0.55 * d + 0.01 * d * d + 1.6 * (fbm(X * 0.3, Y * 0.3, 5) + 0.5) - 1.2 * Math.max(0, 0.25 - Math.abs(fbm(X * 0.22, Y * 0.5, 6))) * 4;
        plateau = smooth(17.5, 14.0, rk);
        e += plateau * (380 + 70 * fbm(X * 0.25, Y * 0.25, 41)) + smooth(24, 15, rk) * 25 * (fbm(X * 0.5, Y * 0.5, 43) + 0.6);
        e += 140 * Math.max(0, 1 - rKrom / 0.65) ** 1.5;
        e += 60 * Math.max(0, 1 - rBak / 0.28) ** 1.2;
      }
      elev[k] = e;

      // land cover by zone
      let c;
      if (d < 0.6) c = d < -0.2 ? GRASS : MUD;
      else if (d < 7.5) c = (n1 > -0.12 + (d < 1.8 ? 0.25 : 0)) ? FOREST : SHRUB;
      else if (d < 12) c = n1 > 0.25 ? SHRUB : (hash2(Math.floor(X / 0.35), Math.floor(Y / 0.25), 7) > 0.4 ? RICE : GRASS);
      else c = n1 > 0.32 ? FOREST : (hash2(Math.floor(X / 0.3), Math.floor(Y / 0.22), 9) > 0.15 ? RICE : GRASS);
      if (plateau > 0.3 || (!terrain && smooth(22, 16, rk) > 0.5 && n1 > -0.2) || (terrain && e > 30 && n1 > -0.25)) c = FOREST;
      { // Angkor park forest, with an irregular edge
        const pd = Math.max(Math.abs(X - 17) / 11, Math.abs(Y - 14.2) / 5) + 0.12 * fbm(X * 0.35, Y * 0.35, 51);
        if (pd < 1 && d > 12) c = n1 > -0.38 + 0.5 * smooth(0.75, 1, pd) ? FOREST : (hash2(Math.floor(X / 0.3), Math.floor(Y / 0.22), 9) > 0.3 ? RICE : GRASS);
      }
      if (polyDist(X, Y, RIVER) < 0.22 && n2 > -0.4) c = FOREST;

      // settlements and roads
      const tr = Math.hypot((X - TOWN[0]) / 2.3, (Y - TOWN[1]) / 3.2);
      if (1 - tr * tr + 0.45 * n2 > 0.2) c = URBAN;
      const dRoad = Math.min(polyDist(X, Y, NR6), polyDist(X, Y, ANGKOR_RD), polyDist(X, Y, KNEAS_RD));
      if (dRoad < 0.45 && d > 9 && fbm(X * 0.9, Y * 0.9, 61) > 0.05 && hash2(Math.floor(X / 0.12), Math.floor(Y / 0.12), 3) > 0.35) c = URBAN;
      if (dRoad < 0.05) c = ROAD;
      if (Math.hypot(X - KNEAS[0], Y - KNEAS[1]) < 0.8 && hash2(Math.floor(X / 0.09), Math.floor(Y / 0.09), 13) > 0.62) c = VILLAGE;
      if (Math.hypot(X - PHLUK[0], Y - PHLUK[1]) < 0.65 && hash2(Math.floor(X / 0.09), Math.floor(Y / 0.09), 15) > 0.55) c = VILLAGE;
      const rx = X - RWY_C[0], ry = Y - RWY_C[1];
      const along = rx * RWY_D[0] + ry * RWY_D[1], across = -rx * RWY_D[1] + ry * RWY_D[0];
      if (Math.abs(along) < 1.28 && Math.abs(across) < 0.07) c = RUNWAY;

      // Angkor monuments and ancient reservoirs
      if (inRect(X, Y, WB[0], WB[1], 4.12, 1.05)) c = PERMWATER;
      if (ring(X, Y, WB[0], WB[1], 4.22, 1.15, 0.12)) c = EMBANK;
      if (inRect(X, Y, WB[0], WB[1], 0.1, 0.1)) c = TEMPLE;
      if (inRect(X, Y, EB[0], EB[1], 3.75, 0.9)) c = RICE;
      if (ring(X, Y, EB[0], EB[1], 3.85, 1.0, 0.14)) c = EMBANK;
      if (inRect(X, Y, SS[0], SS[1], 0.35, 0.175)) c = PERMWATER;
      if (inRect(X, Y, AT[0], AT[1], 1.5, 1.5)) {
        if (!inRect(X, Y, AT[0], AT[1], 1.38, 1.38)) c = PERMWATER;
        else if (!inRect(X, Y, AT[0], AT[1], 1.32, 1.32)) c = TEMPLE;
        else if (inRect(X, Y, AT[0], AT[1], 0.09, 0.09)) c = TEMPLE;
        else if (Math.abs(X - AT[0]) < 0.03 || Math.abs(Y - AT[1]) < 0.03) c = ROAD;
      }
      if (rBak < 0.09) c = TEMPLE;
      if (inRect(X, Y, AW[0], AW[1], 0.75, 0.65)) {
        if (!inRect(X, Y, AW[0], AW[1], 0.56, 0.46)) c = PERMWATER;            // 190 m moat
        else if (!inRect(X, Y, AW[0], AW[1], 0.5, 0.4)) c = TEMPLE;           // outer gallery wall
        else if (inRect(X, Y, AW[0], AW[1], 0.17, 0.15)) c = TEMPLE;          // central temple
        else c = GRASS;
        if (Math.abs(Y - AW[1]) < 0.05 && X < AW[0] - 0.17) c = TEMPLE;      // western causeway
      }
      cls[k] = c;
      phase[k] = (hash2(Math.floor(X / 0.35), Math.floor(Y / 0.25), 21) - 0.5) * 40;

      // pseudo-optical (dry-season true colour)
      const o = k * 4, t = n2 * 12;
      let rgb;
      switch (c) {
        case FOREST: rgb = plateau > 0.3 ? [26, 50, 30] : [34 + t, 62 + t, 36]; break;
        case SHRUB: rgb = [80 + t, 94 + t, 54]; break;
        case RICE: rgb = [118 + t * 1.5, 140 + t, 72]; break;
        case GRASS: rgb = [150 + t, 142 + t, 96]; break;
        case URBAN: rgb = [158 + t * 2, 146 + t * 2, 132 + t]; break;
        case TEMPLE: rgb = [182, 170, 148]; break;
        case ROAD: rgb = [176, 166, 146]; break;
        case RUNWAY: rgb = [92, 92, 96]; break;
        case EMBANK: rgb = [52, 78, 46]; break;
        case VILLAGE: rgb = [146, 118, 92]; break;
        case MUD: rgb = [128, 112, 84]; break;
        case PERMWATER: rgb = [58, 84, 74]; break;
        default: rgb = [120, 120, 100];
      }
      optical[o] = rgb[0]; optical[o + 1] = rgb[1]; optical[o + 2] = rgb[2]; optical[o + 3] = 255;
    }
  }

  // ---------- radar time series ----------
  const layers = new Uint8Array(n * 4 * N);
  const levels = SIM_DATES.map(simLevel);
  const stats = [];
  const pxArea = pxkm * pykm;
  const [hh0, hh1] = ENCODING.hh, [hv0, hv1] = ENCODING.hv;
  for (let ti = 0; ti < N; ti++) {
    onProgress(0.3 + 0.7 * ti / N, `Simulating NISAR pass ${ti + 1} of ${N}`);
    await new Promise((r) => setTimeout(r, 0));
    const iso = SIM_DATES[ti], L = levels[ti], day = doy(iso);
    const rnd = mulberry32(1000 + ti);
    let open = 0, veg = 0;
    const base = ti * n * 4;
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const k = j * W + i, c = cls[k], e = elev[k], nz = tex[k];
        let hh, hv, flag = 0;
        const flooded = c !== PERMWATER && e < L;
        const depth = L - e;
        const wind = fbm(i * 0.02 + ti * 3.1, j * 0.02, 77, 2);
        const water = () => { hh = -23 + 3 * wind; hv = -31 + 1.5 * wind; flag = 255; };
        if (c === PERMWATER) water();
        else if (flooded) {
          if (c === FOREST || c === EMBANK) { hh = -0.5 + 1.2 * nz; hv = -11 + nz; flag = 170; }
          else if (c === SHRUB && depth < 2.5) { hh = -3 + nz; hv = -15 + nz; flag = 170; }
          else if (c === VILLAGE || c === URBAN || c === TEMPLE) { hh = 5; hv = -8; flag = 170; }
          else water();
        } else {
          switch (c) {
            case FOREST: hh = -7.5 + 1.2 * nz; hv = -12.5 + nz; break;
            case SHRUB: hh = -10 + nz; hv = -17 + nz; break;
            case RICE: {
              const p = day + phase[k];
              if (p < 190) { hh = -13; hv = -22; }
              else if (p < 225) { hh = -19; hv = -27; }
              else if (p < 300) { const s = (p - 225) / 75; hh = -14 + 8 * s; hv = -22 + 8 * s; }
              else { hh = -12; hv = -21; }
              break;
            }
            case GRASS: hh = -11.5 + nz; hv = -19.5 + nz; break;
            case MUD: hh = -15 + nz; hv = -24; break;
            case URBAN: hh = 0.5 + 3 * nz; hv = -9.5 + 2 * nz; break;
            case TEMPLE: hh = 4; hv = -6; break;
            case ROAD: hh = -4; hv = -15; break;
            case RUNWAY: hh = -22; hv = -30; break;
            case EMBANK: hh = -3; hv = -10; break;
            case VILLAGE: hh = 0; hv = -10; break;
            default: hh = -10; hv = -18;
          }
          // terrain: slopes facing the (west-looking) radar brighten, away-facing darken
          if (i > 0 && i < W - 1) {
            const g = (elev[k + 1] - elev[k - 1]) / (2 * pxkm * 1000);
            const s = Math.max(-6, Math.min(6, g * 30));
            hh += s; hv += s;
          }
        }
        // speckle after multilooking (~1.3 dB)
        const sp = (rnd() + rnd() + rnd() - 1.5) * 2.2;
        hh += sp; hv += sp * 0.9 + (rnd() - 0.5) * 0.8;
        if (flag === 255) open++; else if (flag === 170) veg++;
        const o = base + k * 4;
        layers[o] = Math.max(0, Math.min(255, Math.round((hh - hh0) / (hh1 - hh0) * 255)));
        layers[o + 1] = Math.max(0, Math.min(255, Math.round((hv - hv0) / (hv1 - hv0) * 255)));
        layers[o + 2] = flag;
        layers[o + 3] = 255;
      }
    }
    stats.push({ date: iso, openKm2: open * pxArea, floodedVegKm2: veg * pxArea });
  }
  onProgress(1, 'Ready');

  return {
    source: 'simulated',
    label: 'Simulated NISAR-like L-band data',
    terrainMeta, terrainReal: !!terrain,
    W, H, N, dates: SIM_DATES, layers, optical, dem: elev, waterLevels: levels, stats,
    kmX: KM_X, kmY: KM_Y, pxAreaKm2: pxArea, encoding: ENCODING,
    products: SIM_DATES.map((d) => ({ date: d, id: `SIMULATED_L2_GCOV_${d.replaceAll('-', '')}`, version: 'sim' })),
    toUV: (lon, lat) => [(lon - LON0) / (LON1 - LON0), (LAT0 - lat) / (LAT0 - LAT1)],
    toLonLat: (u, v) => [LON0 + u * (LON1 - LON0), LAT0 - v * (LAT0 - LAT1)],
  };
}
