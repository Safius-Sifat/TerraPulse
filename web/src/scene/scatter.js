// "Why is this pixel bright?" — an animated 3D diagram of the radar scattering mechanism
// at a clicked point. The satellite looks from the west (−x) and above, as in the flyover.
import * as THREE from 'three';

const V = (x, y) => new THREE.Vector3(x, y, 0);
const SENSOR = V(-0.6, 0.8).normalize(); // direction back toward the satellite

export const MECHANISMS = {
  specular: { title: 'Mirror reflection', text: 'Calm water bounces the pulse away like a mirror. Almost nothing comes back, so the pixel is dark.' },
  double: { title: 'Double bounce', text: 'Water → trunk → straight back to the satellite. A very strong HH echo. Long L-band waves get through the canopy to do this; short wavelengths mostly don’t.' },
  volume: { title: 'Volume scattering', text: 'Leaves and branches scatter the pulse in every direction and twist its polarisation, so forests are bright in HV.' },
  corner: { title: 'Corner reflection', text: 'Ground and walls form a corner that fires the pulse straight back. Buildings and stone are very bright.' },
  rough: { title: 'Rough-surface scattering', text: 'Furrows, stems and clods send some energy back: a medium grey that changes with crop growth and soil moisture.' },
};

export function classify(s) {
  if (s.flag === 255) return 'specular';
  if (s.flag === 170) return 'double';
  if (s.hh > -3) return 'corner';
  if (s.hv > -15) return 'volume';
  return 'rough';
}

function paths(kind) {
  const A = SENSOR.clone().multiplyScalar(2.6);
  const out = [];
  const back = (p, strength = 1) => out.push({ pts: [p, p.clone().addScaledVector(SENSOR, 2.6)], color: 0x40d8ff, strength, ret: true });
  switch (kind) {
    case 'specular': out.push({ pts: [A, V(0, 0), V(2, 2.6)], color: 0x7fd7ff, strength: 0.8 }); break;
    case 'double': {
      const p1 = V(-0.1, 0), p2 = V(0.45, 0.72);
      out.push({ pts: [A.clone().add(p1), p1, p2], color: 0x7fd7ff, strength: 1 }); back(p2, 1.4); break;
    }
    case 'corner': {
      const p1 = V(-0.15, 0), p2 = V(0.2, 0.46);
      out.push({ pts: [A.clone().add(p1), p1, p2], color: 0x7fd7ff, strength: 1 }); back(p2, 1.3); break;
    }
    case 'volume': {
      const c = V(0, 0.95);
      out.push({ pts: [A.clone().add(c), c], color: 0x7fd7ff, strength: 1 });
      for (let i = 0; i < 7; i++) {
        const a = i / 7 * Math.PI * 2 + 0.3, d = V(Math.cos(a), Math.sin(a) * 0.9);
        out.push({ pts: [c, c.clone().addScaledVector(d, 1.2)], color: 0xa6ff8c, strength: 0.45 });
      }
      back(c, 0.7); break;
    }
    default: {
      const p = V(0, 0);
      out.push({ pts: [A, p], color: 0x7fd7ff, strength: 1 });
      [0.35, 0.8, 1.3, 1.9].forEach((a) => out.push({ pts: [p, V(Math.cos(a), Math.sin(a))], color: 0x9fb3bd, strength: 0.35 }));
      back(p, 0.45);
    }
  }
  return out;
}

export function createScatter({ scene }) {
  const group = new THREE.Group(); group.visible = false; scene.add(group);
  const tag = document.createElement('div'); tag.className = 'scattag';
  document.getElementById('labels').after(tag);
  let particles = [], start = 0, kind = null;
  const pmat = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false });
  const ball = new THREE.SphereGeometry(0.055, 10, 8);

  function props(k) {
    const g = new THREE.Group();
    const water = new THREE.Mesh(new THREE.CircleGeometry(1.2, 40), new THREE.MeshBasicMaterial({ color: 0x2a6f86, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false }));
    water.rotation.x = -Math.PI / 2;
    const ground = new THREE.Mesh(new THREE.CircleGeometry(1.2, 40), new THREE.MeshBasicMaterial({ color: 0x6b5a40, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }));
    ground.rotation.x = -Math.PI / 2;
    const trunk = (x, h) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, h, 8), new THREE.MeshBasicMaterial({ color: 0x8a6a4a })); m.position.set(x, h / 2, 0); return m; };
    const crown = (x, y, r) => new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), new THREE.MeshBasicMaterial({ color: 0x5fbf6a, wireframe: true, transparent: true, opacity: 0.5 })).translateX(x).translateY(y);
    if (k === 'specular') g.add(water);
    if (k === 'double') { g.add(water, trunk(0.5, 1.5), crown(0.5, 1.75, 0.45), trunk(-0.7, 1.3), crown(-0.7, 1.5, 0.38)); }
    if (k === 'volume') { g.add(ground, trunk(0, 0.7), crown(0, 0.95, 0.6)); }
    if (k === 'corner') { const b = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.9, 0.8), new THREE.MeshBasicMaterial({ color: 0xcfc6b0, transparent: true, opacity: 0.55 })); b.position.set(0.5, 0.45, 0); g.add(ground, b); }
    if (k === 'rough') { g.add(ground); for (let i = -4; i <= 4; i++) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 1.4), new THREE.MeshBasicMaterial({ color: 0x8a7a50 })); r.position.set(i * 0.25, 0.06, 0); g.add(r); } }
    return g;
  }

  return {
    get kind() { return kind; },
    show(worldPos, k, now) {
      group.clear(); particles = []; kind = k; start = now;
      group.position.copy(worldPos); group.visible = true;
      group.add(props(k));
      for (const p of paths(k)) {
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(p.pts), new THREE.LineBasicMaterial({ color: p.color, transparent: true, opacity: 0.35 * Math.min(1, p.strength + 0.3) }));
        group.add(line);
        const curve = new THREE.CurvePath(); for (let i = 0; i < p.pts.length - 1; i++) curve.add(new THREE.LineCurve3(p.pts[i], p.pts[i + 1]));
        for (let i = 0; i < 4; i++) {
          const m = new THREE.Mesh(ball, pmat(p.color, Math.min(1, p.strength))); m.scale.setScalar(0.7 + p.strength * 0.5);
          group.add(m); particles.push({ m, curve, phase: i / 4, ret: p.ret, len: curve.getLength() });
        }
      }
      const M = MECHANISMS[k];
      tag.innerHTML = `<b>${M.title}</b><span>${M.text}</span>`;
    },
    hide() { group.visible = false; kind = null; tag.style.opacity = 0; },
    update(now, camera) {
      if (!group.visible) { tag.style.opacity = 0; return; }
      const s = Math.min(5, Math.max(0.4, camera.position.distanceTo(group.position) * 0.05));
      group.scale.setScalar(s * Math.min(1, (now - start) * 2.5));
      for (const p of particles) {
        // incoming first, then echoes leave after the pulse arrives
        const f = ((now - start) * 0.55 / Math.max(0.6, p.len * 0.4) + p.phase) % 1;
        p.m.position.copy(p.curve.getPointAt(f));
        p.m.material.opacity = Math.sin(f * Math.PI) * (p.ret ? 1 : 0.85);
      }
      const top = group.position.clone().add(new THREE.Vector3(0, 3.9 * s, 0)).project(camera);
      tag.style.opacity = top.z < 1 ? 1 : 0;
      tag.style.transform = `translate(${(top.x * 0.5 + 0.5) * innerWidth}px, ${(-top.y * 0.5 + 0.5) * innerHeight}px)`;
    },
  };
}
