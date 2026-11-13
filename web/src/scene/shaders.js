// GLSL for the floating landscape. three.js compiles ShaderMaterials as GLSL ES 3.0 on WebGL2,
// so texture() and sampler2DArray are available; gl_FragColor is aliased by three.

const NOISE = /* glsl */ `
float h21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),u.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*vnoise(p); p=p*2.03+vec2(1.7,9.2); a*=.5; } return s; }
float cloudDensity(vec2 uv, float t){
  vec2 q = uv*3.2 + vec2(t*0.012, t*0.004);
  float w = fbm(q + fbm(q*0.7 + t*0.01));
  return smoothstep(0.26, 0.58, w);
}
`;

export const terrainVert = /* glsl */ `
attribute float aElev;
varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying float vElev;
void main(){ vUv = uv; vN = normal; vW = position; vElev = aElev;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

export const terrainFrag = /* glsl */ `
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uRadar; uniform sampler2D uOptical; uniform sampler2D uReveal;
uniform float uT, uN, uMode, uRevealAll, uCloudFade, uTime, uWaterGlow;
uniform vec2 uKm;
uniform vec2 uLens; uniform float uLensR, uLensMode, uLensOn;
uniform vec4 uPulses[6];
uniform vec2 uProbe; uniform float uProbeOn;
uniform vec2 uTarget; uniform float uTargetGlow;
uniform vec2 uHH, uHV;
uniform float uContours, uWaterLevel, uHasDem, uSecOn;
uniform float uScanV, uScanA, uScanB;
uniform vec2 uSecA, uSecB;
varying vec2 vUv; varying vec3 vN; varying vec3 vW; varying float vElev;
${NOISE}
float isoLine(float e, float iv, float w){ float x = e/iv; float f = abs(fract(x - .5) - .5) / max(fwidth(x), 1e-4); return 1. - smoothstep(0., w, f); }
vec3 hypso(float e){
  float x = clamp(log2(1. + max(e,0.)/1.5) / log2(1. + 450./1.5), 0., 1.);
  vec3 c0=vec3(.06,.22,.30), c1=vec3(.16,.42,.32), c2=vec3(.55,.62,.30), c3=vec3(.72,.55,.32), c4=vec3(.55,.40,.30), c5=vec3(.95,.93,.90);
  if(x<.15) return mix(c0,c1,x/.15);
  if(x<.38) return mix(c1,c2,(x-.15)/.23);
  if(x<.55) return mix(c2,c3,(x-.38)/.17);
  if(x<.8) return mix(c3,c4,(x-.55)/.25);
  return mix(c4,c5,(x-.8)/.2);
}

vec4 radarAt(vec2 uv){
  if(uScanV >= 0.) return texture(uRadar, vec3(uv, uv.y > uScanV ? uScanB : uScanA)); // satellite acquiring a pass
  float t = clamp(uT, 0., uN-1.); float a = floor(t); float b = min(a+1., uN-1.);
  return mix(texture(uRadar, vec3(uv, a)), texture(uRadar, vec3(uv, b)), t-a);
}
vec3 radarPal(float x){
  x = clamp(x, 0., 1.);
  vec3 c0=vec3(.015,.025,.06), c1=vec3(.04,.20,.28), c2=vec3(.50,.78,.78), c3=vec3(1.,.97,.88);
  if(x<.35) return mix(c0,c1,x/.35);
  if(x<.72) return mix(c1,c2,(x-.35)/.37);
  return mix(c2,c3,(x-.72)/.28);
}
vec3 modeColor(float mode, float hh, float hv, float hh0, vec3 opt){
  if(mode < .5) return opt;
  if(mode < 1.5) return radarPal(pow(clamp((hh+25.)/28.,0.,1.), 1.45));
  if(mode < 2.5) return radarPal(pow(clamp((hv+32.)/25.,0.,1.), 1.45));
  if(mode > 4.5) return hypso(vElev);
  if(mode < 3.5){
    vec3 c = vec3((hh+20.)/20., (hv+25.)/15., ((hh-hv)-4.)/10.);
    c = pow(clamp(c,0.,1.), vec3(1.25));
    return mix(vec3(dot(c, vec3(.3,.5,.2))), c, .78);
  }
  float d = hh - hh0;
  vec3 neutral = vec3(.13,.14,.17) + .12*clamp((hh+25.)/27.,0.,1.);
  return d < 0. ? mix(neutral, vec3(.12,.48,1.), clamp(-d/9.,0.,1.)) : mix(neutral, vec3(1.,.55,.12), clamp(d/9.,0.,1.));
}

void main(){
  vec2 uv = vUv;
  vec4 R = radarAt(uv);
  float hh = mix(uHH.x, uHH.y, R.r), hv = mix(uHV.x, uHV.y, R.g), flag = R.b;
  vec4 R0 = texture(uRadar, vec3(uv, 0.));
  float hh0 = mix(uHH.x, uHH.y, R0.r), flag0 = R0.b;
  float open = smoothstep(.85,.97,flag);
  float veg = smoothstep(.52,.62,flag) * (1.-open);
  float open0 = smoothstep(.85,.97,flag0), veg0 = smoothstep(.52,.62,flag0)*(1.-open0);

  vec3 n = normalize(vN);
  float lam = max(dot(n, normalize(vec3(-.5,.85,.35))), 0.);
  vec3 opt = texture(uOptical, uv).rgb;
  float rip = vnoise(uv*uKm*3. + vec2(uTime*.25, uTime*.1));
  vec3 lake = mix(vec3(.36,.30,.20), vec3(.46,.40,.28), rip);
  opt = mix(opt, lake, open) * (.5 + .62*lam);

  float rv = max(texture(uReveal, uv).r, uRevealAll);
  vec3 rad = modeColor(uMode, hh, hv, hh0, opt);
  if(uMode > .5) rad *= (.86 + .2*lam);
  vec3 col = mix(opt, rad, rv);

  // "new water since first observation" glow
  if(uWaterGlow > 0.){
    float newOpen = open * (1.-open0), newVeg = veg * (1.-veg0) * (1.-open0);
    float shimmer = .85 + .15*sin(uTime*1.5 + (uv.x+uv.y)*60.);
    col = mix(col, vec3(.2,.82,1.)*shimmer, newOpen*uWaterGlow*.7);
    float hatch = step(.55, fract((uv.x - uv.y)*uKm.x*1.2));
    col = mix(col, vec3(.5,.95,.62), newVeg*uWaterGlow*(.22+.22*hatch));
    col = mix(col, col*vec3(.55,.75,1.1), open0*uWaterGlow*.35);
  }

  // radar lens
  if(uLensOn > 0.){
    float d = length((uv-uLens)*uKm);
    float inside = 1. - smoothstep(uLensR-.06, uLensR, d);
    vec3 lc = modeColor(uLensMode, hh, hv, hh0, opt);
    if(uLensMode > .5 && uLensMode < 1.5) lc = mix(lc, vec3(1.,.82,.35), veg*.55);
    col = mix(col, lc, inside*uLensOn);
    col += vec3(.45,.9,1.) * exp(-pow((d-uLensR)/.05, 2.)) * uLensOn * .9;
  }

  // contours: 2 m minor / 10 m major on the floodplain, 50 m on hills
  if(uContours > 0. && uHasDem > .5){
    float lowland = 1. - smoothstep(30., 60., vElev);
    float minor = isoLine(vElev, 2., 1.) * lowland;
    float major = isoLine(vElev, 10., 1.3) * lowland + isoLine(vElev, 50., 1.3) * (1.-lowland);
    col = mix(col, vec3(1.,.92,.7), (minor*.28 + major*.6) * uContours);
  }
  // shoreline = the contour at the current water level
  if(uWaterLevel > -50. && uHasDem > .5){
    float s = abs(vElev - uWaterLevel) / max(fwidth(vElev), 1e-4);
    col += vec3(.3,.9,1.) * (1. - smoothstep(0., 1.6, s)) * .55 * max(uContours, uWaterGlow);
  }
  // cross-section line
  if(uSecOn > 0.){
    vec2 a = uSecA*uKm, b = uSecB*uKm, p = uv*uKm, ab = b-a;
    float h = clamp(dot(p-a, ab)/max(dot(ab,ab),1e-6), 0., 1.);
    float d = length(p - a - ab*h);
    col = mix(col, vec3(1.,.83,.42), (1.-smoothstep(.05,.12,d))*uSecOn);
    col += vec3(1.,.8,.4) * exp(-pow(d/.35,2.)) * .25 * uSecOn;
    float da = length(p-a), db = length(p-b);
    col = mix(col, vec3(1.), (1.-smoothstep(.18,.24,min(da,db)))*uSecOn);
  }

  // acquisition scan line (beam footprint)
  if(uScanV >= 0.){
    float d = (uv.y - uScanV) * uKm.y;
    col += vec3(.35,.92,1.) * (exp(-pow(d/.18,2.))*1.4 + step(0.,d)*exp(-d/2.5)*.18);
  }

  // radar pulses
  for(int i=0;i<6;i++){
    vec4 p = uPulses[i]; float age = uTime - p.z;
    if(p.w > 0. && age > 0. && age < 2.6){
      float d = length((uv-p.xy)*uKm), r = age*8.;
      float fade = 1. - age/2.6;
      col += vec3(.35,.95,1.) * (exp(-pow((d-r)/.28,2.))*1.3 + exp(-pow((d-r*.72)/.15,2.))*.35) * fade;
    }
  }
  if(uProbeOn > 0.){ float d = length((uv-uProbe)*uKm); col += vec3(1.,.85,.4)*exp(-pow((d-.55-.1*sin(uTime*4.))/.07,2.)); }
  if(uTargetGlow > 0.){ float d = length((uv-uTarget)*uKm); col += vec3(1.,.8,.35)*exp(-pow((d-1.3)/.12,2.))*uTargetGlow*(.6+.4*sin(uTime*3.)); }

  // cloud shadows over unrevealed ground
  float cs = cloudDensity(uv, uTime) * (1.-rv) * (1.-uCloudFade);
  col *= 1. - cs*.5;
  if(R.a < .5) col = vec3(.04,.045,.06);
  gl_FragColor = vec4(col, 1.);
}
`;

export const cloudVert = /* glsl */ `
varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }
`;
export const cloudFrag = /* glsl */ `
precision highp float;
uniform sampler2D uReveal; uniform float uRevealAll, uCloudFade, uTime, uScale;
varying vec2 vUv;
${NOISE}
void main(){
  vec2 duv = vec2((vUv.x-.5)*uScale+.5, .5-(vUv.y-.5)*uScale);
  float inMap = step(0.,duv.x)*step(duv.x,1.)*step(0.,duv.y)*step(duv.y,1.);
  float rv = max(inMap * texture(uReveal, clamp(duv,0.,1.)).r, uRevealAll);
  float d = cloudDensity(duv, uTime);
  float base = .55 + .45*cloudDensity(duv*1.9+3., uTime*.7);
  float edge = smoothstep(0., .12, min(min(vUv.x,1.-vUv.x), min(vUv.y,1.-vUv.y)));
  float a = clamp(d*1.1 + .25*base, 0., 1.) * (1.-smoothstep(.15,.85,rv)) * (1.-uCloudFade) * edge;
  vec3 c = mix(vec3(.42,.47,.56), vec3(.94,.95,.97), d) * (.8+.2*base);
  gl_FragColor = vec4(c, a*.94);
}
`;

export const waterVert = cloudVert;
export const waterFrag = /* glsl */ `
precision highp float;
uniform float uTime, uOpacity; uniform vec2 uKm;
varying vec2 vUv;
${NOISE}
void main(){
  vec2 p = vUv*uKm;
  float w = fbm(p*.9 + vec2(uTime*.12, uTime*.05)) ;
  float spark = pow(vnoise(p*6. + uTime*.6), 12.) * 1.6;
  vec3 c = mix(vec3(.18,.34,.40), vec3(.36,.58,.62), w) + spark*vec3(.8,.95,1.);
  gl_FragColor = vec4(c, uOpacity*(.75+.25*w));
}
`;

export const skirtVert = /* glsl */ `
attribute float aTop; attribute float aSide;
varying float vY; varying float vTop; varying float vSide; varying float vAlong;
attribute float aAlong;
void main(){ vY = position.y; vTop = aTop; vSide = aSide; vAlong = aAlong;
  gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }
`;
export const skirtFrag = /* glsl */ `
precision highp float;
uniform float uWaterY, uHasWater, uBase, uTime;
varying float vY; varying float vTop; varying float vSide; varying float vAlong;
void main(){
  if(vY > vTop + .002){
    if(uHasWater > .5 && vY < uWaterY){
      float k = (uWaterY - vY);
      vec3 c = mix(vec3(.30,.55,.62), vec3(.07,.20,.28), clamp(k*3.,0.,1.));
      c += vec3(.5,.8,.9)*exp(-pow((uWaterY-vY)/.012,2.));
      gl_FragColor = vec4(c, .82); return;
    }
    discard;
  }
  float depth = (vTop - vY) / (vTop - uBase + 1e-4);
  vec3 c = mix(vec3(.24,.19,.14), vec3(.035,.03,.03), pow(depth,.6));
  float strata = smoothstep(.9,1.,fract(vY*7.)) * .08 * (1.-depth);
  c += strata;
  c *= .7 + .3*vSide;
  c += vec3(.55,.85,1.)*exp(-pow((vTop - vY)/.01,2.))*.25;
  gl_FragColor = vec4(c, 1.);
}
`;
