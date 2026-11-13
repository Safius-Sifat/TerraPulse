// Opening sequence: Earth, NISAR on a near-polar orbit painting its swath, then a dive to the site.
import * as THREE from 'three';

const R = 10, ALT = R * (1 + 747 / 6371);

export function latLonToVec(lat, lon, r = 1) {
  const phi = (lon + 180) * Math.PI / 180, th = (90 - lat) * Math.PI / 180;
  return new THREE.Vector3(-r * Math.cos(phi) * Math.sin(th), r * Math.cos(th), r * Math.sin(phi) * Math.sin(th));
}

const earthVert = /* glsl */ `
varying vec2 vUv; varying vec3 vP;
void main(){ vUv = uv; vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`;
const earthFrag = /* glsl */ `
uniform sampler2D uDay, uSpec, uNight; uniform vec3 uSun, uOrbitN, uSatDir, uTarget; uniform float uTime, uSwath, uMark;
varying vec2 vUv; varying vec3 vP;
void main(){
  vec3 n = normalize(vP), V = normalize(cameraPosition - vP);
  float l = dot(n, uSun), dayMix = smoothstep(-.12, .22, l);
  vec3 day = texture2D(uDay, vUv).rgb, night = texture2D(uNight, vUv).rgb;
  vec3 col = mix(night * vec3(1., .78, .5) * 1.6, day * (.22 + 1.0 * max(l, 0.)), dayMix);
  float spec = texture2D(uSpec, vUv).r;
  col += spec * pow(max(dot(n, normalize(uSun + V)), 0.), 70.) * .7 * dayMix;
  float rim = pow(1. - max(dot(n, V), 0.), 3.);
  col += vec3(.3, .6, 1.) * rim * .7 * (.25 + .75 * dayMix);
  // NISAR swath trail: cross-track distance from the orbit plane, along-track angle behind the satellite
  float xt = asin(clamp(dot(n, uOrbitN), -1., 1.));
  vec3 pp = normalize(n - uOrbitN * dot(n, uOrbitN));
  float ang = atan(dot(cross(uSatDir, pp), uOrbitN), dot(uSatDir, pp));
  float band = 1. - smoothstep(uSwath * .7, uSwath, abs(xt));
  float trail = ang < 0. ? exp(ang * 1.6) : exp(-ang * 60.);
  float scan = .55 + .45 * smoothstep(.6, 1., fract(-ang * 30. + uTime * 2.));
  col += vec3(.3, .9, 1.) * band * trail * scan * .55;
  col += vec3(.5, .95, 1.) * (1. - smoothstep(0., uSwath * .25, abs(abs(xt) - uSwath * .85))) * trail * .5;
  // target marker
  float d = acos(clamp(dot(n, uTarget), -1., 1.));
  float ring = exp(-pow((d - .012 - .03 * fract(uTime * .6)) / .0025, 2.)) * (1. - fract(uTime * .6));
  col += vec3(1., .82, .4) * (ring * 1.6 + exp(-pow(d / .004, 2.)) * 1.2) * uMark;
  gl_FragColor = vec4(col, 1.);
}`;
const atmoVert = /* glsl */ `varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`;
const atmoFrag = /* glsl */ `varying vec3 vN; void main(){ float i = pow(clamp(.74 - dot(vN, vec3(0,0,1.)), 0., 1.), 2.6); gl_FragColor = vec4(vec3(.32,.62,1.) * i * 1.6, i); }`;

export function createGlobe({ target }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.01, 2000);
  const T = latLonToVec(target.lat, target.lon).normalize();
  const loader = new THREE.TextureLoader();
  const tex = (f) => { const t = loader.load(`assets/${f}`); t.anisotropy = 8; return t; };

  // orbit plane through the target with 98° inclination (sun-synchronous), ascending over the site
  const Y = new THREE.Vector3(0, 1, 0);
  const e1 = Y.clone().addScaledVector(T, -Y.dot(T)).normalize(), e2 = new THREE.Vector3().crossVectors(T, e1);
  const cosA = Math.cos(98 * Math.PI / 180) / e1.dot(Y), A = Math.acos(Math.max(-1, Math.min(1, cosA)));
  let N = e1.clone().multiplyScalar(Math.cos(A)).addScaledVector(e2, Math.sin(A));
  let W = new THREE.Vector3().crossVectors(N, T);
  if (W.y < 0) { N = e1.clone().multiplyScalar(Math.cos(A)).addScaledVector(e2, -Math.sin(A)); W = new THREE.Vector3().crossVectors(N, T); }
  const orbitPos = (th, r = ALT) => T.clone().multiplyScalar(Math.cos(th) * r).addScaledVector(W, Math.sin(th) * r);

  const sun = T.clone().multiplyScalar(0.8).add(new THREE.Vector3(0.25, 0.45, 0.2)).normalize();
  const U = {
    uDay: { value: tex('earth_atmos_2048.jpg') }, uSpec: { value: tex('earth_specular_2048.jpg') }, uNight: { value: tex('earth_lights_2048.png') },
    uSun: { value: sun }, uOrbitN: { value: N }, uSatDir: { value: T.clone() }, uTarget: { value: T }, uTime: { value: 0 },
    uSwath: { value: 0.03 }, uMark: { value: 0 },
  };
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(R, 160, 80), new THREE.ShaderMaterial({ uniforms: U, vertexShader: earthVert, fragmentShader: earthFrag })));
  scene.add(new THREE.Mesh(new THREE.SphereGeometry(R * 1.035, 96, 48), new THREE.ShaderMaterial({ vertexShader: atmoVert, fragmentShader: atmoFrag, side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));

  // stars
  {
    const g = new THREE.BufferGeometry(), n = 3000, p = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const v = new THREE.Vector3().randomDirection().multiplyScalar(600 + Math.random() * 300); p.set([v.x, v.y, v.z], i * 3); }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xaabbdd, size: 1.4, sizeAttenuation: false, transparent: true, opacity: 0.7 })));
  }
  // orbit ring
  const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 256 }, (_, i) => orbitPos(i / 256 * Math.PI * 2))),
    new THREE.LineBasicMaterial({ color: 0x40d8ff, transparent: true, opacity: 0.22 }));
  scene.add(ring);
  // satellite: small glowing craft + nadir beam
  const sat = new THREE.Group();
  const foil = new THREE.MeshStandardMaterial({ color: 0xe8e2d0, metalness: 0.5, roughness: 0.4 });
  sat.add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.18), foil));
  const wing = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.01, 0.16), new THREE.MeshStandardMaterial({ color: 0x18305a, emissive: 0x10264a, metalness: 0.6, roughness: 0.3 }));
  wing.position.x = -0.32; sat.add(wing);
  const dish = new THREE.Mesh(new THREE.CircleGeometry(0.22, 32), new THREE.MeshStandardMaterial({ color: 0xd8b25c, metalness: 0.9, roughness: 0.35, side: THREE.DoubleSide }));
  dish.position.set(0.3, -0.1, 0); dish.rotation.x = Math.PI / 2; sat.add(dish);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending }));
  glow.scale.setScalar(0.35); sat.add(glow);
  scene.add(sat);
  const beamGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const beam = new THREE.Line(beamGeo, new THREE.LineBasicMaterial({ color: 0x40d8ff, transparent: true, opacity: 0.5 }));
  scene.add(beam);
  scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x101020, 1.2));
  const dl = new THREE.DirectionalLight(0xffffff, 2); dl.position.copy(sun).multiplyScalar(50); scene.add(dl);

  let th = -2.2, mode = 'idle', t = 0, resolvePlay = null;
  const camDir = T.clone().applyAxisAngle(Y, 0.35).add(new THREE.Vector3(0, 0.3, 0)).normalize();
  const look = new THREE.Vector3();
  const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  let startDir = camDir.clone(), startDist = 40;
  const idleLook = new THREE.Vector3(), startLook = new THREE.Vector3();

  function placeSat() {
    const p = orbitPos(th); sat.position.copy(p);
    sat.lookAt(orbitPos(th + 0.01)); U.uSatDir.value.copy(p).normalize();
    beamGeo.setFromPoints([p, p.clone().normalize().multiplyScalar(R * 1.002)]);
  }

  return {
    scene, camera, active: true,
    resize(w, h) { camera.aspect = w / h; camera.updateProjectionMatrix(); },
    play(duration = 16) {
      mode = 'play'; t = 0; startDir = camera.position.clone().normalize(); startDist = camera.position.length(); startLook.copy(idleLook);
      th = -1.25; this.duration = duration;
      return new Promise((r) => (resolvePlay = r));
    },
    skip() { if (resolvePlay) { const r = resolvePlay; resolvePlay = null; mode = 'done'; r(); } },
    update(dt, now) {
      U.uTime.value = now; t += dt;
      if (mode === 'idle') {
        th += dt * 0.05; if (th > 1.2) th = -2.2;
        const d = camDir.clone().applyAxisAngle(Y, Math.sin(now * 0.05) * 0.25);
        // keep Earth on the right of the title text
        const right = new THREE.Vector3().crossVectors(d, Y).normalize();
        idleLook.copy(right).multiplyScalar(camera.aspect > 1 ? 9 : 0);
        camera.position.copy(d.multiplyScalar(40)); camera.lookAt(idleLook);
      } else if (mode === 'play') {
        const D = this.duration, dive0 = D * 0.58;
        th = -1.25 + Math.min(1, t / (D * 0.92)) * 1.35;
        U.uMark.value = Math.min(1, Math.max(0, (t - D * 0.45) / 1.5));
        let dir, dist;
        if (t < dive0) {
          const k = ease(t / dive0);
          dir = startDir.clone().lerp(T.clone().add(new THREE.Vector3(0, 0.25, 0)).normalize(), k).normalize();
          dist = startDist + (24 - startDist) * k; look.copy(startLook).multiplyScalar(1 - k);
        } else {
          const k = ease(Math.min(1, (t - dive0) / (D - dive0)));
          dir = T.clone().add(new THREE.Vector3(0, 0.25 * (1 - k) + 0.04, 0)).normalize();
          dist = 24 + (R * 1.11 - 24) * k;
          look.copy(T).multiplyScalar(R * k);
          U.uMark.value *= Math.max(0, 1 - k * 1.6); // marker would bloom out the screen at low altitude
        }
        camera.position.copy(dir.multiplyScalar(dist)); camera.lookAt(look);
        if (t >= D && resolvePlay) { const r = resolvePlay; resolvePlay = null; mode = 'done'; r(); }
      }
      placeSat();
    },
  };
}
