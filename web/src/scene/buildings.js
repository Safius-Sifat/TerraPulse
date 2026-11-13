// Real OpenStreetMap building footprints, extruded on the terrain, plus simplified reconstructions of
// Angkor Wat and the Bayon (neither is mapped as a building in OSM). Each building samples the radar water flag
// under it on the current pass: flooded buildings fill with water to the flood depth.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const vert = /* glsl */ `
attribute vec4 aInfo;   // ground u, v, height above ground (m), kind
attribute float aElev;  // ground elevation (m)
varying vec4 vInfo; varying float vElev; varying vec3 vW;
void main(){ vInfo = aInfo; vElev = aElev; vW = (modelMatrix * vec4(position,1.)).xyz;
  gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.); }`;
const frag = /* glsl */ `
precision highp float; precision highp sampler2DArray;
uniform sampler2DArray uRadar; uniform float uT, uN, uFade, uLevel, uHasLevel, uTime, uScanV, uScanA, uScanB;
varying vec4 vInfo; varying float vElev; varying vec3 vW;
void main(){
  vec2 g = vInfo.xy; float z = vInfo.z, kind = vInfo.w;
  float t = clamp(uT, 0., uN-1.), a = floor(t), b = min(a+1., uN-1.);
  float flag = uScanV >= 0. ? texture(uRadar, vec3(g, g.y > uScanV ? uScanB : uScanA)).b
                            : mix(texture(uRadar, vec3(g, a)).b, texture(uRadar, vec3(g, b)).b, t-a);
  float wet = smoothstep(.45, .6, flag);
  vec3 n = normalize(cross(dFdx(vW), dFdy(vW)));
  if(n.y < -.01) n = -n;
  vec3 col = kind < .5 ? vec3(.70,.62,.54) : kind < 1.5 ? vec3(.62,.66,.70) : kind < 2.5 ? vec3(.86,.62,.30) : kind < 3.5 ? vec3(.50,.45,.40) : vec3(.74,.62,.46);
  float lam = max(dot(n, normalize(vec3(-.5,.85,.35))), 0.);
  col *= .38 + .52*lam; // stays under the bloom threshold, so dense towns don't glow white
  // water inside / around flooded buildings, up to the flood depth at this spot
  float depth = uHasLevel > .5 ? max(uLevel - vElev, 0.) : 1.2;
  float under = wet * (1. - step(depth, z));
  col = mix(col, vec3(.16,.52,.68) + .08*sin(uTime*2. + vW.x*40.), under * .85);
  col += vec3(.4,.95,1.) * wet * exp(-pow((z - depth)/.35, 2.)) * .9;     // glowing waterline
  if(n.y > .9) col = mix(col, vec3(.35,.85,1.), wet * .35);               // flooded roofs read from above
  gl_FragColor = vec4(col, uFade);
}`;

export async function createBuildings({ scene, U, ds, demAt, hDisp, KX, KY, scale = 1, siteId }) {
  const url = `data/osm/${siteId}.json`;
  let data;
  try { const r = await fetch(url); if (!r.ok) return null; data = await r.json(); } catch { return null; }
  const EXG = 6;                                   // vertical exaggeration for buildings (labelled in the UI)
  const mPerUnit = 1000 * scale;                    // world units are km (scaled with the slab)
  const BX = EXG / mPerUnit;
  const [W, S, E, N] = data.bbox;
  // OSM grid → this dataset's uv (identical for the simulated grid; via lon/lat for real data)
  const toUV = (qu, qv) => ds.toUV(W + qu / 65535 * (E - W), N - qv / 65535 * (N - S));
  const KIND = { home: 0, large: 1, sacred: 2, light: 3 };

  const pos = [], info = [], elev = [], idx = [];
  const groups = [];
  for (const b of data.buildings) {
    const n = b.p.length / 2; if (n < 3) continue;
    const ring = [];
    let cu = 0, cv = 0;
    for (let i = 0; i < n; i++) { const [u, v] = toUV(b.p[i * 2], b.p[i * 2 + 1]); ring.push([u, v]); cu += u; cv += v; }
    cu /= n; cv /= n;
    if (cu < 0 || cu > 1 || cv < 0 || cv > 1) continue;
    const e = demAt(cu, cv), y0 = hDisp(e) + 0.001 * scale, h = Math.min(b.h, 80), y1 = y0 + h * BX, kind = KIND[b.k] ?? 0;
    const base = pos.length / 3;
    for (const [u, v] of ring) { pos.push((u - 0.5) * KX, y0, (v - 0.5) * KY); info.push(cu, cv, 0, kind); elev.push(e); }
    for (const [u, v] of ring) { pos.push((u - 0.5) * KX, y1, (v - 0.5) * KY); info.push(cu, cv, h, kind); elev.push(e); }
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; idx.push(base + i, base + j, base + n + j, base + i, base + n + j, base + n + i); }
    const tris = THREE.ShapeUtils.triangulateShape(ring.map(([u, v]) => new THREE.Vector2(u * KX, v * KY)), []);
    for (const [a, c, d] of tris) idx.push(base + n + a, base + n + c, base + n + d);
    if (b.n) groups.push({ name: b.n, u: cu, v: cv });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 4));
  g.setAttribute('aElev', new THREE.Float32BufferAttribute(elev, 1));
  g.setIndex(idx);

  const BU = {
    uRadar: U.uRadar, uT: U.uT, uN: U.uN, uTime: U.uTime, uScanV: U.uScanV, uScanA: U.uScanA, uScanB: U.uScanB,
    uFade: { value: 0 }, uLevel: { value: 0 }, uHasLevel: { value: ds.waterLevels ? 1 : 0 },
  };
  const mat = new THREE.ShaderMaterial({ uniforms: BU, vertexShader: vert, fragmentShader: frag, side: THREE.DoubleSide, transparent: true });
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; scene.add(mesh);

  // ---- simplified reconstructions (published dimensions; approximate) ----
  const recon = [];
  function monument(lon, lat, parts, out = recon) {
    const [u, v] = ds.toUV(lon, lat); const e = demAt(u, v), y0 = hDisp(e) + 0.001 * scale;
    const cx = (u - 0.5) * KX, cz = (v - 0.5) * KY;
    for (const p of parts) {
      const geo = p.geo.toNonIndexed();
      geo.deleteAttribute('normal'); geo.deleteAttribute('uv');
      const P = geo.attributes.position, cnt = P.count, inf = new Float32Array(cnt * 4), el = new Float32Array(cnt).fill(e);
      for (let i = 0; i < cnt; i++) {
        const xm = P.getX(i) + p.x, ym = P.getY(i) + p.y, zm = P.getZ(i) + p.z;            // metres
        P.setXYZ(i, cx + xm / mPerUnit, y0 + ym * BX, cz + zm / mPerUnit);
        inf.set([u + xm / mPerUnit / KX, v + zm / mPerUnit / KY, ym, 4], i * 4);
      }
      geo.setAttribute('aInfo', new THREE.BufferAttribute(inf, 4)); geo.setAttribute('aElev', new THREE.BufferAttribute(el, 1));
      out.push(geo);
    }
  }
  const box = (w, h, d, x, y, z) => ({ geo: new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), x, y, z });
  const ringWalls = (w, d, t, h, y) => [box(w, h, t, 0, y, -d / 2), box(w, h, t, 0, y, d / 2), box(t, h, d, -w / 2, y, 0), box(t, h, d, w / 2, y, 0)];
  const lotus = (H) => new THREE.LatheGeometry([[0, 0], [7, 0], [7, .16], [6, .27], [6.5, .35], [5, .49], [5.2, .57], [3.8, .68], [3.9, .73], [2.6, .81], [1.2, .92], [0, 1]]
    .map(([r, f]) => new THREE.Vector2(r * H / 37, f * H)), 8);
  const tower = (H, x, y, z) => ({ geo: lotus(H), x, y, z });
  // Angkor Wat: enclosure wall 1025×800 m, western causeway and gate, three stepped galleries,
  // quincunx of lotus-bud towers (central ~65 m).
  const awParts = [];
  monument(103.8670, 13.4125, [
    ...ringWalls(1025, 800, 5, 4.5, 0),
    box(350, 1.5, 10, -337, 0, 0), box(70, 9, 22, -512, 0, 0),
    box(215, 3.5, 187, 0, 0, 0), ...ringWalls(215, 187, 10, 5.5, 3.5),
    box(115, 12, 100, 0, 0, 0), ...ringWalls(115, 100, 8, 4, 12),
    box(60, 25, 60, 0, 0, 0), ...ringWalls(60, 60, 6, 4, 25),
    tower(40, 0, 25, 0), tower(30, -24, 25, -24), tower(30, 24, 25, -24), tower(30, -24, 25, 24), tower(30, 24, 25, 24),
  ], awParts);
  const awMesh = new THREE.Mesh(mergeGeometries(awParts), mat); awMesh.frustumCulled = false; scene.add(awMesh);
  // Bayon: two terraces, central face tower (~43 m), rings of smaller towers
  monument(103.8590, 13.4412, [
    box(160, 4, 140, 0, 0, 0), ...ringWalls(160, 140, 6, 4, 4), box(80, 14, 70, 0, 0, 0),
    tower(29, 0, 14, 0),
    ...[...Array(8)].map((_, i) => { const a = i / 8 * Math.PI * 2; return tower(16, Math.cos(a) * 30, 14, Math.sin(a) * 26); }),
    ...[...Array(16)].map((_, i) => { const a = i / 16 * Math.PI * 2; return tower(13, Math.cos(a) * 66, 4, Math.sin(a) * 56); }),
  ]);
  const reconMesh = new THREE.Mesh(mergeGeometries(recon), mat); reconMesh.frustumCulled = false; scene.add(reconMesh);

  return {
    count: data.buildings.length, places: data.places, attribution: data.attribution, exaggeration: EXG,
    placeView(id) {
      const p = data.places.find((q) => q.id === id); if (!p) return null;
      const [w, s, e, n] = p.bbox, [u0, v0] = ds.toUV(w, n), [u1, v1] = ds.toUV(e, s);
      const size = Math.max((u1 - u0) * KX, (v1 - v0) * KY);
      return { uv: [(u0 + u1) / 2, (v0 + v1) / 2], dist: size * 1.25 / scale, elev: 0.62, az: 0.35 };
    },
    get fade() { return BU.uFade.value; },
    update(camera, target, level) {
      const d = camera.position.distanceTo(target) / scale;
      const f = 1 - THREE.MathUtils.smoothstep(d, 14, 22);
      BU.uFade.value = f; BU.uLevel.value = level;
      mesh.visible = reconMesh.visible = f > 0.01;
      awMesh.visible = f > 0.01;
    },
  };
}
