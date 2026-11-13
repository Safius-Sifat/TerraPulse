// "Pull time apart": every NISAR pass lifts off the slab as its own floating plane, stacked by date,
// with a vertical drill core through the probed point.
import * as THREE from 'three';

const vert = /* glsl */ `varying vec2 vUv; void main(){ vUv = vec2(uv.x, 1.-uv.y); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`;
const frag = /* glsl */ `
precision highp float; precision highp sampler2DArray;
uniform sampler2DArray uRadar; uniform float uLayer, uAlpha, uCur, uTime; uniform vec2 uHH, uKm, uProbe; uniform float uProbeOn;
varying vec2 vUv;
vec3 pal(float x){ x=clamp(x,0.,1.); vec3 c0=vec3(.015,.025,.06), c1=vec3(.04,.20,.28), c2=vec3(.50,.78,.78), c3=vec3(1.,.97,.88);
  return x<.35?mix(c0,c1,x/.35):x<.72?mix(c1,c2,(x-.35)/.37):mix(c2,c3,(x-.72)/.28); }
void main(){
  vec4 R = texture(uRadar, vec3(vUv, uLayer));
  float hh = mix(uHH.x, uHH.y, R.r);
  vec3 c = pal(pow(clamp((hh+25.)/28.,0.,1.),1.45));
  float open = smoothstep(.85,.97,R.b), veg = smoothstep(.52,.62,R.b)*(1.-open);
  c = mix(c, vec3(.15,.75,1.), open*.55); c = mix(c, vec3(.55,1.,.6), veg*.35);
  vec2 e = min(vUv, 1.-vUv) * uKm; float edge = 1. - smoothstep(0., .25, min(e.x, e.y));
  c += vec3(.4,.9,1.) * edge * (.35 + .9*uCur);
  if(uProbeOn > 0.){ float d = length((vUv-uProbe)*uKm); c += vec3(1.,.85,.4) * (1.-smoothstep(.35,.5,d)) * .8; }
  gl_FragColor = vec4(c, uAlpha * (R.a < .5 ? 0. : (.82 + .18*uCur)));
}`;

export function createStack({ scene, U, ds, KX, KY, top, scale = 1 }) {
  const group = new THREE.Group(); scene.add(group);
  const planes = [], tags = [];
  const tagBox = document.createElement('div'); tagBox.id = 'stacktags'; document.getElementById('labels').after(tagBox);
  for (let i = 0; i < ds.N; i++) {
    const u = { uRadar: U.uRadar, uLayer: { value: i }, uAlpha: { value: 0 }, uCur: { value: 0 }, uTime: U.uTime, uHH: U.uHH, uKm: U.uKm, uProbe: U.uProbe, uProbeOn: U.uProbeOn };
    const m = new THREE.Mesh(new THREE.PlaneGeometry(KX, KY), new THREE.ShaderMaterial({ uniforms: u, vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.renderOrder = 20 + i; m.visible = false; group.add(m); planes.push({ m, u });
    const t = document.createElement('div'); t.className = 'stacktag';
    t.textContent = new Date(ds.dates[i] + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    tagBox.appendChild(t); tags.push(t);
  }
  // drill core through the probe point
  const coreMat = new THREE.LineBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0 });
  const coreGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 1, 0)]);
  const core = new THREE.Line(coreGeo, coreMat); core.frustumCulled = false; group.add(core);

  let open = 0, target = 0;
  const gap = 1.25 * scale, base = top + 1.2 * scale, v = new THREE.Vector3();
  return {
    get open() { return target > 0.5; },
    get height() { return base + gap * (ds.N - 1); },
    setOpen(on) { target = on ? 1 : 0; },
    update(dt, camera, t) {
      open += (target - open) * (1 - Math.exp(-dt * 3));
      const cur = Math.round(t);
      planes.forEach(({ m, u }, i) => {
        const k = Math.min(1, Math.max(0, open * 1.3 - (i / ds.N) * 0.3));
        m.visible = k > 0.01;
        m.position.y = top + (base - top + gap * i) * k;
        u.uAlpha.value = k; u.uCur.value += ((i === cur ? 1 : 0) - u.uCur.value) * Math.min(1, dt * 8);
        v.set(-KX / 2, m.position.y, KY / 2).project(camera);
        tags[i].style.opacity = k > 0.6 && v.z < 1 ? (i === cur ? 1 : 0.65) : 0;
        tags[i].classList.toggle('cur', i === cur);
        tags[i].style.transform = `translate(${(v.x * 0.5 + 0.5) * innerWidth}px, ${(-v.y * 0.5 + 0.5) * innerHeight}px)`;
      });
      if (U.uProbeOn.value > 0 && open > 0.05) {
        const x = (U.uProbe.value.x - 0.5) * KX, z = (U.uProbe.value.y - 0.5) * KY;
        coreGeo.setFromPoints([new THREE.Vector3(x, top, z), new THREE.Vector3(x, top + (base - top + gap * (ds.N - 1)) * open + 0.5, z)]);
        coreMat.opacity = open;
      } else coreMat.opacity = 0;
    },
  };
}
