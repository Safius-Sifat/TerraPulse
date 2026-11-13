// NISAR satellite (stylised, not to scale) that flies along-track and "acquires" a pass:
// its side-looking beam sweeps the slab and the new observation is painted in behind it.
import * as THREE from 'three';

const beamVert = /* glsl */ `
attribute float aT; varying float vT;
void main(){ vT = aT; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`;
const beamFrag = /* glsl */ `
uniform float uTime, uOn; varying float vT;
void main(){
  float pulses = smoothstep(.55, 1., fract(vT*14. - uTime*4.));
  float a = (.10 + .35*pulses) * smoothstep(0., .25, vT) * uOn;
  gl_FragColor = vec4(vec3(.35,.9,1.)*(.6+.8*pulses), a);
}`;

export function createSatellite({ scene, U, KX, KY, scale = 1 }) {
  const S = 1.7 * scale;
  const sat = new THREE.Group();
  const gold = new THREE.MeshStandardMaterial({ color: 0xc9a050, metalness: 0.85, roughness: 0.32 });
  const foil = new THREE.MeshStandardMaterial({ color: 0xe8e2d0, metalness: 0.5, roughness: 0.45 });
  const cell = new THREE.MeshStandardMaterial({ color: 0x14254a, metalness: 0.6, roughness: 0.3, emissive: 0x0b1d3d, emissiveIntensity: 0.6 });
  const bus = new THREE.Mesh(new THREE.BoxGeometry(0.7 * S, 0.7 * S, 1.1 * S), foil); sat.add(bus);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(2.8 * S, 0.03 * S, 0.95 * S), cell);
  wing.position.set(-1.9 * S, 0.25 * S, 0); sat.add(wing);
  const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.03 * S, 0.03 * S, 0.6 * S), gold);
  strut.rotation.z = Math.PI / 2; strut.position.set(-0.6 * S, 0.25 * S, 0); sat.add(strut);
  // boom to the big mesh reflector on the looking side
  const boomEnd = new THREE.Vector3(2.6 * S, -0.7 * S, 0);
  const boom = new THREE.Mesh(new THREE.CylinderGeometry(0.035 * S, 0.035 * S, boomEnd.length()), gold);
  boom.position.copy(boomEnd).multiplyScalar(0.5);
  boom.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), boomEnd.clone().normalize()); sat.add(boom);
  const reflector = new THREE.Group(); reflector.position.copy(boomEnd); sat.add(reflector);
  const dishGeo = new THREE.SphereGeometry(2.6 * S, 40, 8, 0, Math.PI * 2, 0, 0.55);
  const dish = new THREE.Mesh(dishGeo, new THREE.MeshStandardMaterial({ color: 0xd8b25c, metalness: 0.9, roughness: 0.4, side: THREE.DoubleSide, transparent: true, opacity: 0.55 }));
  const mesh = new THREE.Mesh(dishGeo, new THREE.MeshBasicMaterial({ color: 0xffe2a0, wireframe: true, transparent: true, opacity: 0.35 }));
  // cap opens along -Y of the sphere; shift so the rim sits at the boom end
  dish.position.y = mesh.position.y = -2.6 * S; reflector.add(dish, mesh); // pole at the boom end, concave side facing -Y
  scene.add(sat);

  // beam: fan from the reflector to a thin strip across the slab
  const beamGeo = new THREE.BufferGeometry();
  const pos = new Float32Array(5 * 3);
  beamGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  beamGeo.setAttribute('aT', new THREE.BufferAttribute(new Float32Array([0, 1, 1, 1, 1]), 1));
  beamGeo.setIndex([0, 1, 2, 0, 3, 4, 0, 1, 3, 0, 2, 4]);
  const beamU = { uTime: U.uTime, uOn: { value: 0 } };
  const beam = new THREE.Mesh(beamGeo, new THREE.ShaderMaterial({ uniforms: beamU, vertexShader: beamVert, fragmentShader: beamFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  beam.frustumCulled = false; scene.add(beam);

  const ALT = 15 * scale, X = -KX / 2 - 5 * scale, GROUND = 0.4 * scale, HALF = 0.5 * scale;
  const tag = document.createElement('div'); tag.className = 'sattag'; tag.innerHTML = '<b>NISAR</b><span>747 km up · 12 m radar reflector · not to scale</span>';
  document.getElementById('labels').after(tag);

  let fly = null;
  sat.visible = false;
  const tmp = new THREE.Vector3(), apex = new THREE.Vector3();

  function place(z) {
    sat.position.set(X, ALT, z); sat.updateMatrixWorld(true);
    // point the reflector at the middle of the swath
    reflector.getWorldPosition(apex);
    tmp.set(0, GROUND, z).sub(apex).normalize();
    reflector.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), tmp.applyQuaternion(sat.quaternion.clone().invert()));
    sat.updateMatrixWorld(true); reflector.getWorldPosition(apex);
    const w = -KX / 2, e = KX / 2;
    pos.set([apex.x, apex.y, apex.z, w, GROUND, z - HALF, e, GROUND, z - HALF, w, GROUND, z + HALF, e, GROUND, z + HALF]);
    beamGeo.attributes.position.needsUpdate = true;
  }

  return {
    object: sat,
    get busy() { return !!fly; },
    // from/to: layer indices; dur: seconds; scan: paint the new layer behind the beam
    flyover({ from = 0, to = 0, dur = 2, scan = true, onUpdate, onDone } = {}) {
      fly = { from, to, dur, scan, onUpdate, onDone, t: 0 };
      sat.visible = true;
    },
    cancel() { if (fly) { fly = null; U.uScanV.value = -1; beamU.uOn.value = 0; sat.visible = false; tag.style.opacity = 0; } },
    update(dt, camera) {
      if (!fly) { tag.style.opacity = 0; return; }
      fly.t += dt;
      const k = Math.min(1, fly.t / fly.dur), margin = 10 * scale;
      const z = KY / 2 + margin - k * (KY + 2 * margin);
      place(z);
      sat.rotation.z = Math.sin(fly.t * 0.7) * 0.03;
      const over = z < KY / 2 + HALF && z > -KY / 2 - HALF;
      beamU.uOn.value = over ? 1 : Math.max(0, beamU.uOn.value - dt * 4);
      if (fly.scan) {
        const v = Math.min(1, Math.max(0, z / KY + 0.5));
        U.uScanV.value = v; U.uScanA.value = fly.from; U.uScanB.value = fly.to;
        fly.onUpdate?.(1 - v);
      }
      tmp.copy(sat.position).project(camera);
      tag.style.opacity = tmp.z < 1 ? 1 : 0;
      tag.style.transform = `translate(${(tmp.x * 0.5 + 0.5) * innerWidth}px, ${(-tmp.y * 0.5 + 0.5) * innerHeight}px)`;
      if (k >= 1) {
        const done = fly.onDone; fly = null;
        U.uScanV.value = -1; beamU.uOn.value = 0; sat.visible = false; tag.style.opacity = 0;
        done?.();
      }
    },
  };
}
