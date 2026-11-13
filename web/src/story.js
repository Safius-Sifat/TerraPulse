// Chapter state machine + unobtrusive HUD: narration with captions, a small task chip,
// on-demand popovers (probe, stats, cross-section) and a compact layer dock.
import { Narrator } from './narrator.js';
import { classify } from './scene/scatter.js';

const $ = (s) => document.querySelector(s);
const MODES = [
  { id: 0, key: '1', label: 'VIS', tip: 'Visual map view [1]' },
  { id: 1, key: '2', label: 'HH', tip: 'HH radar: surfaces & double bounce [2]' },
  { id: 2, key: '3', label: 'HV', tip: 'HV radar: vegetation volume [3]' },
  { id: 3, key: '4', label: 'MIX', tip: 'Colour mix: R=HH, G=HV, B=HH−HV [4]' },
  { id: 4, key: '5', label: 'Δ', tip: 'Change since the first pass [5]' },
  { id: 5, key: '6', label: 'ELEV', tip: 'Elevation (Copernicus GLO-30) [6]' },
];
const fmtDate = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const fmtShort = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const lerp = (a, b, k) => a + (b - a) * k;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// JS twins of the shader palettes, for colour bars
const mixc = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
function radarPal(x) {
  x = Math.min(1, Math.max(0, x));
  const c0 = [.015, .025, .06], c1 = [.04, .20, .28], c2 = [.50, .78, .78], c3 = [1, .97, .88];
  return x < .35 ? mixc(c0, c1, x / .35) : x < .72 ? mixc(c1, c2, (x - .35) / .37) : mixc(c2, c3, (x - .72) / .28);
}
function hypso(e) {
  const x = Math.min(1, Math.max(0, Math.log2(1 + Math.max(e, 0) / 1.5) / Math.log2(1 + 450 / 1.5)));
  const c = [[.06, .22, .30], [.16, .42, .32], [.55, .62, .30], [.72, .55, .32], [.55, .40, .30], [.95, .93, .90]], s = [0, .15, .38, .55, .8, 1];
  for (let i = 0; i < 5; i++) if (x <= s[i + 1]) return mixc(c[i], c[i + 1], (x - s[i]) / (s[i + 1] - s[i]));
  return c[5];
}
function composite(hh, hv) {
  const c = [(hh + 20) / 20, (hv + 25) / 15, ((hh - hv) - 4) / 10].map((v) => Math.pow(Math.min(1, Math.max(0, v)), 1.25));
  const l = c[0] * .3 + c[1] * .5 + c[2] * .2;
  return c.map((v) => l + (v - l) * .78);
}
const rgb = (c) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;
const COLORBARS = {
  1: { title: 'HH backscatter (dB)', min: -25, max: 3, ticks: [-25, -20, -15, -10, -5, 0], color: (v) => radarPal(Math.pow((v + 25) / 28, 1.45)), note: 'dark = smooth (water, tarmac) · bright = buildings, double bounce' },
  2: { title: 'HV backscatter (dB)', min: -32, max: -7, ticks: [-30, -25, -20, -15, -10], color: (v) => radarPal(Math.pow((v + 32) / 25, 1.45)), note: 'bright = volume scattering in vegetation' },
  4: { title: 'HH change since first pass (dB)', min: -9, max: 9, ticks: [-9, -6, -3, 0, 3, 6, 9], color: (v) => (v < 0 ? mixc([.2, .21, .25], [.12, .48, 1], -v / 9) : mixc([.2, .21, .25], [1, .55, .12], v / 9)), note: 'blue = darker (new open water) · orange = brighter (flooded vegetation, crops)' },
  5: { title: 'Elevation (m, log scale)', min: 0, max: 450, log: true, ticks: [2, 5, 10, 25, 50, 100, 250], color: hypso, note: 'DEM elevations · vertical relief exaggerated logarithmically' },
};

export function startStory(app) {
  const { ds, site, U, controls, sound } = app;
  const st = app.state;
  const N = ds.N, sim = ds.source === 'simulated';
  const goal = { revealAll: 0, cloudFade: 0, waterGlow: 0, lensOn: 0, targetGlow: 0, contours: 0 };
  const t0 = Date.parse(ds.dates[0]), tN = Date.parse(ds.dates[N - 1]);
  const frac = ds.dates.map((d) => (N > 1 ? (Date.parse(d) - t0) / (tN - t0) : 0));
  const totals = ds.stats.map((s) => s.openKm2 + s.floodedVegKm2);
  const peakIndex = totals.indexOf(Math.max(...totals));
  const narrator = new Narrator($('#caption'), sound);
  narrator.load(site.narration || site.id);
  let ci = -1, ch = null, playing = false, playStop = null, done = false, probe = null;
  const terrainSrc = ds.terrainMeta ? (ds.terrainMeta.source || '').split(' (')[0] : null;
  const prov = (ti) => {
    const p = ds.products[ti] || {}, m = /GCOV_(\d+)_(\d+)_([AD])_(\d+)_\d+_\w{4}_[A-Z]_(\d{8})T(\d{2})(\d{2})(\d{2})/.exec(p.id || '');
    return m ? { id: p.id, version: p.version, track: m[2], frame: m[4], dir: m[3] === 'A' ? 'ascending' : 'descending', time: `${m[5].slice(0, 4)}-${m[5].slice(4, 6)}-${m[5].slice(6)} ${m[6]}:${m[7]}:${m[8]} UTC` } : { id: p.id };
  };
  const show = (sel, on) => $(sel).classList.toggle('show', on);
  const voiceKey = (c) => c.voice || c.type;

  // ---------- static HUD ----------
  document.title = `${site.title} · TerraPulse`;
  $('#title h1').textContent = site.title;
  $('#title .sub').textContent = site.subtitle;
  $('#title .where').textContent = site.name;
  const badge = $('#badge');
  badge.classList.toggle('sim', sim);
  badge.innerHTML = sim ? `<i></i>Simulated radar${ds.terrainReal ? ' · real terrain' : ''}` : `<i></i>${ds.label}`;
  $('#info .body').innerHTML = `
    <p><b>${sim ? 'The radar values are simulated.' : 'Real NISAR data.'}</b> ${sim
      ? 'They mimic NISAR L2 GCOV (L-band, HH + HV, 12-day repeat) over Tonle Sap and will be replaced by real products, using the same file format, once they are downloaded.'
      : 'NISAR Level-2 Geocoded Polarimetric Covariance (GCOV) products, frequency A, HH and HV power, multilooked for the web.'}</p>
    <p>Water flags: ${sim ? 'simulated truth.' : 'automatic threshold (open water) and HH-increase rule (flooded vegetation). Unvalidated.'}
    Terrain height is exaggerated on a log scale so a ~10 m floodplain is visible next to hills. The satellite and scattering diagrams are illustrations, not to scale.</p>
    ${ds.terrainMeta ? `<p><b>Terrain:</b> ${ds.terrainMeta.source}${ds.terrainMeta.method ? `. ${ds.terrainMeta.method}` : ''}${sim ? '. The simulated flood fills this real terrain up to the simulated lake level.' : ''}</p>` : ''}
    ${ds.opticalMeta ? `<p><b>Visual basemap:</b> <a href="https://cloudless.eox.at/" target="_blank" rel="noopener">EOxCloudless</a> by EOX IT Services GmbH, contains modified Copernicus Sentinel data 2016, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>. This is a static annual mosaic, not imagery from the selected radar date. Simulated water and effects are drawn over it.</p>` : ''}
    ${app.buildings ? '<p><b>Buildings:</b> footprints © OpenStreetMap contributors (ODbL); heights mostly estimated, drawn 6× taller. Angkor Wat and the Bayon are simplified reconstructions from published dimensions, not surveys.</p>' : ''}
    <p>Globe imagery: NASA Blue Marble (via three.js examples). Narration: AI-generated voice (OpenAI text-to-speech).</p>
    <table>${ds.products.map((p) => `<tr><td>${p.date}</td><td>${p.id}</td><td>${p.version || ''}</td></tr>`).join('')}</table>`;
  const openInfo = () => $('#info').classList.toggle('open');
  badge.onclick = openInfo; $('#aboutData').onclick = () => { openInfo(); $('#chapterMenu').classList.remove('open'); };
  $('#info .close').onclick = () => $('#info').classList.remove('open');
  const voiceBtn = $('#voiceBtn'), ccBtn = $('#ccBtn');
  voiceBtn.onclick = () => { narrator.setVoice(!narrator.voiceOn); voiceBtn.classList.toggle('on', narrator.voiceOn); voiceBtn.textContent = narrator.voiceOn ? '🔊' : '🔈'; };
  ccBtn.onclick = () => { narrator.setCC(!narrator.ccOn); ccBtn.classList.toggle('on', narrator.ccOn); };

  // chapter menu
  const menu = $('#chapterMenu'), menuList = menu.querySelector('ol');
  site.chapters.forEach((c, i) => {
    if (c.type === 'title') return;
    const li = document.createElement('li'); li.innerHTML = `<button><span class="k">${String(i).padStart(2, '0')}</span><span class="t">${c.title}</span></button>`;
    li.querySelector('button').onclick = () => { menu.classList.remove('open'); go(i); };
    menuList.appendChild(li);
  });
  $('#chapterPill').onclick = () => menu.classList.toggle('open');
  $('#replay').onclick = () => { menu.classList.remove('open'); narrator.speak(voiceKey(site.chapters[ci])); };

  // ---------- dock ----------
  const dock = $('#dock');
  const modeBtns = MODES.filter((m) => m.id !== 5 || ds.dem).map((m) => {
    const b = document.createElement('button'); b.textContent = m.label; b.dataset.tip = m.tip; b.dataset.mode = m.id;
    b.onclick = () => setMode(m.id); dock.appendChild(b); return b;
  });
  dock.appendChild(document.createElement('hr'));
  const toggle = (label, tip, fn) => { const b = document.createElement('button'); b.textContent = label; b.dataset.tip = tip; b.className = 'toggle'; b.onclick = () => fn(b); dock.appendChild(b); return b; };
  const lensBtn = toggle('◎', 'Radar lens follows the pointer [L]', (b) => { goal.lensOn = goal.lensOn ? 0 : 1; b.classList.toggle('on', !!goal.lensOn); });
  const glowBtn = toggle('✦', 'Highlight water that was dry at the first pass [G]', (b) => { goal.waterGlow = goal.waterGlow ? 0 : 1; b.classList.toggle('on', !!goal.waterGlow); });
  const contourBtn = ds.dem ? toggle('≋', 'Elevation contours [C]', (b) => { goal.contours = goal.contours ? 0 : 1; b.classList.toggle('on', !!goal.contours); }) : null;
  const secBtn = ds.dem ? toggle('✂', 'Draw a cross-section: drag across the land [S]', (b) => { drawingSection = !drawingSection; b.classList.toggle('on', drawingSection); canvas.style.cursor = drawingSection ? 'crosshair' : ''; }) : null;
  const stackBtn = toggle('⧉', 'Pull time apart: stack every pass [T]', (b) => setStack(!app.stack.open, b));
  // places: fly into a close-up where real OpenStreetMap buildings stand on the terrain
  const placesEl = document.createElement('div'); placesEl.id = 'places'; $('#hud').appendChild(placesEl);
  const placesBtn = app.buildings ? toggle('⌂', 'Places: fly in to real buildings [P]', (b) => { const o = !placesEl.classList.contains('show'); show('#places', o); b.classList.toggle('on', o); }) : null;
  if (app.buildings) {
    placesEl.innerHTML = app.buildings.places.map((p) => `<button data-id="${p.id}"><b>${p.name}</b><span>${p.count.toLocaleString('en')} mapped buildings</span></button>`).join('')
      + `<div class="note">Footprints © OpenStreetMap contributors. Heights are mostly estimated and drawn ${app.buildings.exaggeration}× taller. A building's base turns to water when the radar shows water under it on the selected pass.</div>`;
    placesEl.querySelectorAll('button').forEach((b) => (b.onclick = () => {
      setMode(0); app.flyTo(app.buildings.placeView(b.dataset.id), 2.8); show('#places', false); placesBtn.classList.remove('on');
    }));
  }
  if (site.id === 'tonle-sap' && ds.terrainReal) {
    const geoBtn = document.createElement('button');
    geoBtn.textContent = 'GEO';
    geoBtn.dataset.tip = 'Explore the real terrain and sampled elevations';
    geoBtn.onclick = () => {
      if (app.stack.open) setStack(false);
      setMode(5);
      goal.lensOn = goal.waterGlow = 0;
      lensBtn.classList.remove('on'); glowBtn.classList.remove('on');
      goal.contours = 1; contourBtn?.classList.add('on');
      app.setLabels(['ku', 'pk', 'aw', 'ts'], { elevations: true });
      app.flyTo({ uv: [.53, .50], dist: 62, elev: .52, az: -.28 }, 2.5);
    };
    dock.appendChild(geoBtn);
  }
  let drawingSection = false;
  function setStack(on, b = stackBtn) {
    app.stack.setOpen(on); b.classList.toggle('on', on);
    if (on) app.flyTo({ uv: [0.5, 0.5], dist: 88, elev: 0.28, az: 0.75, lift: 9 }, 2.4);
    else if (ch?.shot) app.flyTo(ch.shot, 2);
  }

  // ---------- colour bar ----------
  const cbar = $('#colorbar'), cbc = cbar.querySelector('canvas'), cbx = cbc.getContext('2d');
  function updateColorbar(m) {
    const spec = COLORBARS[m];
    cbar.classList.toggle('show', (!!spec || m === 3) && $('#hud').classList.contains('show'));
    if (m === 3) {
      cbar.querySelector('.t').textContent = 'Colour mix · R = HH, G = HV, B = HH − HV';
      cbc.style.display = 'none';
      const sw = [['Open water', -23, -31], ['Forest', -7.5, -12.5], ['Flooded forest', -0.5, -11], ['Buildings', 1, -9], ['Fields', -11.5, -19.5]];
      cbar.querySelector('.ticks').innerHTML = sw.map(([n, hh, hv]) => `<span class="sw"><i style="background:${rgb(composite(hh, hv))}"></i>${n}</span>`).join('');
      cbar.querySelector('.note').textContent = 'Swatches use typical L-band values for each surface';
      return;
    }
    if (!spec) return;
    cbc.style.display = '';
    cbar.querySelector('.t').textContent = spec.title;
    const w = cbc.width = 240, h = cbc.height = 10;
    const pos = (v) => spec.log ? Math.log2(1 + v / 1.5) / Math.log2(1 + spec.max / 1.5) : (v - spec.min) / (spec.max - spec.min);
    for (let x = 0; x < w; x++) {
      const f = x / (w - 1);
      const v = spec.log ? 1.5 * (Math.pow(2, f * Math.log2(1 + spec.max / 1.5)) - 1) : spec.min + f * (spec.max - spec.min);
      cbx.fillStyle = rgb(spec.color(v)); cbx.fillRect(x, 0, 1, h);
    }
    cbar.querySelector('.ticks').innerHTML = spec.ticks.map((t) => `<span style="left:${pos(t) * 100}%">${t}</span>`).join('');
    cbar.querySelector('.note').textContent = spec.note;
  }
  function setMode(m) {
    // The animated water plane represents simulated levels, not DEM elevation.
    app.water.visible = !!ds.waterLevels && m !== 5;
    U.uMode.value = m;
    modeBtns.forEach((b) => b.classList.toggle('on', +b.dataset.mode === m));
    updateColorbar(m);
  }

  // ---------- timeline ----------
  const track = $('#timeline .track'), thumb = $('#timeline .thumb'), fill = $('#timeline .fill');
  ds.dates.forEach((d, i) => {
    const tk = document.createElement('div'); tk.className = 'tick'; tk.style.left = `${frac[i] * 100}%`;
    if (i === 0 || i === N - 1 || i % 3 === 0) tk.dataset.label = fmtShort(d);
    track.appendChild(tk);
  });
  const tToX = (t) => { const a = Math.floor(t), b = Math.min(a + 1, N - 1); return lerp(frac[a], frac[b], t - a); };
  const xToT = (x) => {
    for (let i = 0; i < N - 1; i++) if (x <= frac[i + 1]) return i + (x - frac[i]) / Math.max(1e-6, frac[i + 1] - frac[i]);
    return N - 1;
  };
  let dragging = false, lastTick = -1;
  const scrub = (e) => {
    const r = track.getBoundingClientRect();
    let t = xToT(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
    const near = Math.round(t); if (Math.abs(t - near) < 0.12) t = near;
    app.satellite.cancel(); st.t = t; playing = false; $('#play').classList.remove('on');
  };
  track.addEventListener('pointerdown', (e) => { dragging = true; track.setPointerCapture(e.pointerId); scrub(e); });
  track.addEventListener('pointermove', (e) => dragging && scrub(e));
  track.addEventListener('pointerup', () => (dragging = false));
  $('#play').onclick = () => togglePlay();
  function togglePlay(stopAt = null) {
    playing = !playing; playStop = stopAt;
    if (playing) { if (st.t >= N - 1.001 && stopAt === null) st.t = 0; st.t = Math.round(st.t); }
    $('#play').classList.toggle('on', playing);
  }
  $('#statChip').onclick = () => { const o = !$('#statPop').classList.contains('show'); show('#statPop', o); $('#statChip').classList.toggle('open', o); if (o) drawChart(); };

  // ---------- stats chart ----------
  const chart = $('#chart'), cg = chart.getContext('2d');
  function drawChart() {
    const dpr = devicePixelRatio, w = chart.clientWidth, h = chart.clientHeight; if (!w) return;
    if (chart.width !== w * dpr) { chart.width = w * dpr; chart.height = h * dpr; }
    cg.setTransform(dpr, 0, 0, dpr, 0, 0); cg.clearRect(0, 0, w, h);
    const max = Math.max(...totals) * 1.1, px = (i) => 6 + frac[i] * (w - 12), py = (v) => h - 14 - (v / max) * (h - 22);
    const area = (vals, color) => {
      cg.beginPath(); cg.moveTo(px(0), py(0)); vals.forEach((v, i) => cg.lineTo(px(i), py(v))); cg.lineTo(px(N - 1), py(0)); cg.closePath();
      cg.fillStyle = color; cg.fill();
    };
    area(totals, 'rgba(166,255,140,.35)');
    area(ds.stats.map((s) => s.openKm2), 'rgba(64,216,255,.55)');
    cg.strokeStyle = '#40d8ff'; cg.lineWidth = 1.5; cg.beginPath();
    totals.forEach((v, i) => (i ? cg.lineTo(px(i), py(v)) : cg.moveTo(px(i), py(v)))); cg.stroke();
    cg.fillStyle = '#cfe9f2'; totals.forEach((v, i) => { cg.beginPath(); cg.arc(px(i), py(v), 2, 0, 7); cg.fill(); });
    const x = 6 + tToX(st.t) * (w - 12);
    cg.strokeStyle = '#ffd36b'; cg.beginPath(); cg.moveTo(x, 4); cg.lineTo(x, h - 12); cg.stroke();
    cg.fillStyle = 'rgba(207,233,242,.6)'; cg.font = '10px "JetBrains Mono", monospace';
    cg.fillText(fmtShort(ds.dates[0]), 4, h - 2); const l = fmtShort(ds.dates[N - 1]); cg.fillText(l, w - cg.measureText(l).width - 4, h - 2);
  }

  // ---------- probe popover ----------
  const pop = $('#pop'), pchart = $('#probeChart'), pg = pchart.getContext('2d');
  function describe(s) {
    if (s.flag === 255) return ['Open water', 'Smooth water reflects the pulse away: dark in both HH and HV.'];
    if (s.flag === 170) return ['Flooded vegetation', 'Water + trunks form a double bounce: very bright HH.'];
    if (s.hh > -3) return ['Very bright target', 'Buildings, stone or slopes facing the radar.'];
    if (s.hh < -16) return ['Smooth / dark surface', 'Calm water, tarmac or flooded paddy.'];
    if (s.hv > -15) return ['Woody vegetation', 'Branches scatter in all directions: strong HV.'];
    return ['Fields & low vegetation', 'Moderate return; changes with crop growth and soil moisture.'];
  }
  function setProbe(u, v) {
    const series = ds.dates.map((_, i) => app.sample(u, v, i));
    if (series.some((s) => !s)) return;
    probe = { u, v, series, ll: ds.toLonLat(u, v), world: app.uvToWorld(u, v) };
    U.uProbe.value.set(u, v); U.uProbeOn.value = 1;
    show('#pop', true); $('#whyBtn').classList.remove('on'); app.scatter.hide();
    drawProbe();
  }
  function clearProbe() { probe = null; U.uProbeOn.value = 0; show('#pop', false); app.scatter.hide(); }
  pop.querySelector('.x').onclick = clearProbe;
  $('#whyBtn').onclick = () => {
    if (!probe) return;
    const on = !$('#whyBtn').classList.contains('on');
    $('#whyBtn').classList.toggle('on', on);
    if (on) {
      app.scatter.show(probe.world, classify(probe.series[Math.round(st.t)]), app.now);
      app.flyTo({ uv: [probe.u, probe.v], dist: 11, elev: 0.38, az: 0.05 }, 2); // side-on view of the rays
    } else app.scatter.hide();
  };
  $('#zoomBtn').onclick = () => probe && app.flyTo({ uv: [probe.u, probe.v], dist: 9, elev: 0.42, az: 0.15 }, 2);
  function drawProbe() {
    if (!probe) return;
    const ti = Math.round(st.t), s = probe.series[ti];
    const [name, why] = describe(s);
    pop.querySelector('.what').textContent = name;
    pop.querySelector('.why').textContent = why;
    const e = ds.dem ? app.demAt(probe.u, probe.v) : null, L = ds.waterLevels ? app.levelAt(ti) : null;
    pop.querySelector('.vals').innerHTML = `${fmtDate(ds.dates[ti])}<br>HH <b>${s.hh.toFixed(1)} dB</b> · HV <b>${s.hv.toFixed(1)} dB</b>`
      + (e !== null ? `<br>Ground <b>${e.toFixed(1)} m</b>${L !== null && s.flag ? ` · depth <b>${Math.max(0, L - e).toFixed(1)} m</b>` : ''}` : '')
      + `<br><span>${probe.ll[1].toFixed(4)}°N ${probe.ll[0].toFixed(4)}°E</span>`;
    const pv = prov(ti);
    pop.querySelector('.prov div').innerHTML = `${pv.track ? `Track ${pv.track} · frame ${pv.frame} · ${pv.dir} · ${pv.time} · ${pv.version}<br>` : ''}${pv.id}${terrainSrc ? `<br>Ground: ${terrainSrc}` : ''}`;
    const dpr = devicePixelRatio, w = pchart.clientWidth, h = pchart.clientHeight; if (!w) return;
    if (pchart.width !== w * dpr) { pchart.width = w * dpr; pchart.height = h * dpr; }
    pg.setTransform(dpr, 0, 0, dpr, 0, 0); pg.clearRect(0, 0, w, h);
    const px = (i) => 6 + frac[i] * (w - 12), py = (db) => 4 + (1 - (db + 30) / 35) * (h - 18);
    pg.strokeStyle = 'rgba(255,255,255,.08)'; [-25, -15, -5, 5].forEach((d) => { pg.beginPath(); pg.moveTo(0, py(d)); pg.lineTo(w, py(d)); pg.stroke(); });
    const line = (k, color) => { pg.strokeStyle = color; pg.lineWidth = 2; pg.beginPath(); probe.series.forEach((s, i) => (i ? pg.lineTo(px(i), py(s[k])) : pg.moveTo(px(i), py(s[k])))); pg.stroke(); };
    line('hh', '#ffb454'); line('hv', '#7fd7ff');
    probe.series.forEach((s, i) => { pg.fillStyle = s.flag === 255 ? '#40d8ff' : s.flag === 170 ? '#a6ff8c' : 'rgba(255,255,255,.18)'; pg.fillRect(px(i) - 3, h - 8, 6, 5); });
    pg.strokeStyle = '#ffd36b'; const x = 6 + tToX(st.t) * (w - 12); pg.beginPath(); pg.moveTo(x, 0); pg.lineTo(x, h - 10); pg.stroke();
  }
  function placePop() {
    if (!probe) return;
    const p = probe.world.clone().project(app.camera);
    if (p.z > 1) { pop.style.opacity = 0; return; }
    pop.style.opacity = '';
    let x = (p.x * 0.5 + 0.5) * innerWidth + 22, y = (-p.y * 0.5 + 0.5) * innerHeight - 40;
    const cb = cbar.classList.contains('show') ? cbar.getBoundingClientRect().bottom + 10 : 60;
    if (app.scatter.kind) { x = innerWidth - pop.offsetWidth - 16; y = cb; } // keep clear of the ray diagram
    const w = pop.offsetWidth, h = pop.offsetHeight;
    if (x + w > innerWidth - 12) x = x - w - 44;
    y = Math.max(cb, Math.min(innerHeight - h - 110, y));
    pop.style.transform = `translate(${Math.max(12, x)}px, ${y}px)`;
  }

  // ---------- cross-section sheet ----------
  let section = null, secDrag = null;
  const sc = $('#sectionChart'), sg = sc.getContext('2d');
  function setSection(a, b) {
    section = { a, b }; U.uSecA.value.set(a[0], a[1]); U.uSecB.value.set(b[0], b[1]); U.uSecOn.value = 1;
    show('#sheet', true); drawSection();
  }
  function clearSection() { section = null; U.uSecOn.value = 0; show('#sheet', false); }
  $('#sheet .x').onclick = clearSection;
  function drawSection() {
    if (!section) return;
    const { a, b } = section, NS = 240, W = ds.W, Hh = ds.H, plane = W * Hh * 4;
    const lenKm = Math.hypot((b[0] - a[0]) * app.kmX, (b[1] - a[1]) * app.kmY);
    $('#sheet .len').textContent = `· ${lenKm.toFixed(1)} km`;
    const ti = Math.round(st.t), pts = [];
    for (let i = 0; i < NS; i++) {
      const f = i / (NS - 1), u = a[0] + (b[0] - a[0]) * f, v = a[1] + (b[1] - a[1]) * f;
      const k = (Math.round(v * (Hh - 1)) * W + Math.round(u * (W - 1))) * 4 + 2;
      pts.push({ e: app.demAt(u, v), flags: ds.dates.map((_, t) => ds.layers[t * plane + k]) });
    }
    const levels = ds.waterLevels;
    let lo = Math.min(...pts.map((p) => p.e)), hi = Math.max(...pts.map((p) => p.e), levels ? Math.max(...levels) : -1e9);
    const pad = Math.max(1, (hi - lo) * 0.12); lo -= pad * 0.5; hi += pad;
    const dpr = devicePixelRatio, w = sc.clientWidth, h = sc.clientHeight; if (!w) return;
    if (sc.width !== w * dpr) { sc.width = w * dpr; sc.height = h * dpr; }
    sg.setTransform(dpr, 0, 0, dpr, 0, 0); sg.clearRect(0, 0, w, h);
    const L0 = 30, px = (i) => L0 + i / (NS - 1) * (w - L0 - 4), py = (e) => 4 + (1 - (e - lo) / (hi - lo)) * (h - 18);
    sg.font = '9.5px "JetBrains Mono", monospace'; sg.fillStyle = 'rgba(207,233,242,.55)'; sg.strokeStyle = 'rgba(255,255,255,.07)';
    const step = [1, 2, 5, 10, 20, 50, 100, 200].find((s) => (hi - lo) / s <= 5) || 200;
    for (let g = Math.ceil(lo / step) * step; g <= hi; g += step) { sg.beginPath(); sg.moveTo(L0, py(g)); sg.lineTo(w, py(g)); sg.stroke(); sg.fillText(`${g}m`, 0, py(g) + 3); }
    if (levels) {
      sg.strokeStyle = 'rgba(64,216,255,.28)'; sg.lineWidth = 1;
      ds.dates.forEach((_, t) => {
        if (t === ti) return;
        sg.beginPath(); let on = false;
        pts.forEach((p, i) => { const wet = p.flags[t] > 0 && levels[t] > p.e - 0.5; if (wet && !on) { sg.moveTo(px(i), py(levels[t])); on = true; } else if (wet) sg.lineTo(px(i), py(levels[t])); else on = false; });
        sg.stroke();
      });
    }
    const Lc = levels ? app.levelAt(st.t) : null;
    sg.fillStyle = 'rgba(64,216,255,.55)';
    pts.forEach((p, i) => {
      if (!p.flags[ti]) return;
      const top = Lc !== null ? Math.max(Lc, p.e) : p.e + (hi - lo) * 0.04;
      const x0 = px(Math.max(0, i - 0.5)), x1 = px(Math.min(NS - 1, i + 0.5));
      sg.fillRect(x0, py(top), x1 - x0 + 0.5, py(p.e) - py(top));
    });
    sg.beginPath(); sg.moveTo(px(0), h - 14);
    pts.forEach((p, i) => sg.lineTo(px(i), py(p.e))); sg.lineTo(px(NS - 1), h - 14); sg.closePath();
    const gr = sg.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#9b7a55'); gr.addColorStop(1, '#2a1e15');
    sg.fillStyle = gr; sg.fill();
    sg.strokeStyle = '#e6c99a'; sg.lineWidth = 1.2; sg.beginPath(); pts.forEach((p, i) => (i ? sg.lineTo(px(i), py(p.e)) : sg.moveTo(px(i), py(p.e)))); sg.stroke();
    if (Lc !== null) { sg.strokeStyle = '#40d8ff'; sg.setLineDash([3, 3]); sg.beginPath(); sg.moveTo(L0, py(Lc)); sg.lineTo(w, py(Lc)); sg.stroke(); sg.setLineDash([]); }
    sg.fillStyle = 'rgba(207,233,242,.55)'; sg.fillText('A', L0, h - 2); sg.fillText(`B · ${lenKm.toFixed(1)} km`, w - 70, h - 2);
    $('#sheet .src').textContent = `Ground: ${terrainSrc || 'DEM'} · water: ${sim ? 'simulated' : 'NISAR'} flags${levels ? ' at ' + (sim ? 'simulated' : 'radar-derived') + ' lake level' : ''}`;
  }

  // ---------- hover readout ----------
  const hoverEl = $('#hover');
  let hoverOn = false, overCanvas = false;
  function updateHover() {
    if (!hoverOn || playing || !overCanvas || !holdPos || holding || document.body.classList.contains('orbiting')) { hoverEl.classList.remove('show'); return; }
    const uv = app.pick(...holdPos); if (!uv) { hoverEl.classList.remove('show'); return; }
    const ti = Math.round(st.t), s = app.sample(uv[0], uv[1], ti); if (!s) return;
    const [lon, lat] = ds.toLonLat(uv[0], uv[1]);
    const e = ds.dem ? app.demAt(uv[0], uv[1]) : null, L = ds.waterLevels ? app.levelAt(st.t) : null;
    const status = s.flag === 255 ? 'Open water' : s.flag === 170 ? 'Flooded vegetation' : 'Dry';
    hoverEl.innerHTML = `<b class="${s.flag ? 'wet' : ''}">${status}</b>`
      + (e !== null ? `<div>Ground ${e.toFixed(1)} m${L !== null && s.flag ? ` · depth ${Math.max(0, L - e).toFixed(1)} m` : ''}</div>` : '')
      + `<div>HH ${s.hh.toFixed(1)} · HV ${s.hv.toFixed(1)} dB</div><div class="ll">${lat.toFixed(4)}°N ${lon.toFixed(4)}°E · click for more</div>`;
    hoverEl.style.transform = `translate(${holdPos[0] + 18}px, ${holdPos[1] + 18}px)`;
    hoverEl.classList.add('show');
  }

  // ---------- pointer routing ----------
  const canvas = $('#scene');
  let down = null, holding = false, holdPos = null, lastPulse = 0;
  canvas.addEventListener('pointerenter', () => (overCanvas = true));
  canvas.addEventListener('pointerleave', () => (overCanvas = false));
  canvas.addEventListener('pointerdown', (e) => {
    menu.classList.remove('open');
    down = { x: e.clientX, y: e.clientY, t: performance.now() }; holding = true; holdPos = [e.clientX, e.clientY];
    if (drawingSection) { const uv = app.pick(e.clientX, e.clientY); if (uv) { secDrag = uv; controls.enabled = false; setSection(uv, uv); } return; }
    ch?.onDown?.(e);
  });
  canvas.addEventListener('pointermove', (e) => {
    holdPos = [e.clientX, e.clientY]; overCanvas = true;
    if (secDrag) { const uv = app.pick(e.clientX, e.clientY); if (uv) setSection(secDrag, uv); return; }
    ch?.onMove?.(e);
  });
  addEventListener('pointerup', (e) => {
    holding = false;
    if (secDrag) {
      const b = section?.b; secDrag = null; controls.enabled = true; drawingSection = false; secBtn?.classList.remove('on'); canvas.style.cursor = '';
      if (!b || Math.hypot((b[0] - section.a[0]) * app.kmX, (b[1] - section.a[1]) * app.kmY) < 0.5) clearSection();
      down = null; return;
    }
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6 && performance.now() - down.t < 600 && e.target === canvas) ch?.onClick?.(e);
    down = null;
  });
  function followLens() { if (!holdPos) return; const uv = app.pick(...holdPos); if (uv) U.uLens.value.set(uv[0], uv[1]); }

  // ---------- chapter mechanics ----------
  const task = $('#task'), fb = task.querySelector('.fb');
  function setTask(c) {
    task.querySelector('.txt').textContent = c.task || '';
    task.classList.remove('done');
    $('#colorbar .legendx').innerHTML = (c.legend || []).map(([col, t]) => `<span><i style="background:${col}"></i>${t}</span>`).join('');
    fb.textContent = ''; fb.className = 'fb';
    const last = ci === site.chapters.length - 1;
    $('#next').textContent = last ? 'Restart ↺' : 'Continue →';
    $('#next').classList.toggle('ready', last); $('#skip').style.display = last ? 'none' : '';
    show('#task', false); taskSince = performance.now();   // the title card + narration state the task; the chip appears only when it has news
    $('#chapterPill .n').textContent = `${ci} / ${site.chapters.length - 1}`;
    $('#chapterPill .name').textContent = c.title;
    menu.querySelector('.read').innerHTML = (c.body || []).map((p) => `<p>${p}</p>`).join('');
    [...menuList.children].forEach((li, k) => li.classList.toggle('on', k === ci - 1));
  }
  let taskSince = 0;
  const feedback = (txt, cls = '') => { fb.textContent = txt; fb.className = `fb ${cls}`; if (txt && site.chapters[ci]?.task) show('#task', true); };
  // finishing a task: the bottom chip itself turns into the "what's next" — no pop-ups, no auto-advance
  function complete(text) {
    if (done) return; done = true;
    const c = site.chapters[ci], next = site.chapters[ci + 1];
    task.classList.add('done'); show('#task', true);
    task.querySelector('.txt').textContent = c.doneTitle || text || 'Done';
    feedback(typeof c.takeaway === 'function' ? c.takeaway({ totals, peakIndex, ds }) : (c.takeaway || ''), 'good');
    $('#next').textContent = next ? `Next: ${next.title} →` : 'Continue →';
    $('#next').classList.add('ready'); $('#skip').style.display = 'none';
    sound.chime();
    c.onDone?.();
    const k = `${voiceKey(c)}-done`;
    if (narrator.has(k)) narrator.speak(k);
  }

  // ---- chapter title card: big, centred, says what to do; fades into the small task chip ----
  const chapterCard = $('#chapterCard');
  let cardTimer = null;
  function showChapterCard(c) {
    chapterCard.querySelector('.k').textContent = `Chapter ${ci} of ${site.chapters.length - 1}`;
    chapterCard.querySelector('h2').textContent = c.title;
    chapterCard.querySelector('.task').textContent = c.task || '';
    chapterCard.querySelector('.task').style.display = c.task ? '' : 'none';
    chapterCard.classList.add('show');
    clearTimeout(cardTimer); cardTimer = setTimeout(() => chapterCard.classList.remove('show'), 4800);
  }
  addEventListener('pointerdown', () => { if (chapterCard.classList.contains('show')) { clearTimeout(cardTimer); setTimeout(() => chapterCard.classList.remove('show'), 250); } });

  // intro: globe → dive → handoff
  let introRunning = false;
  async function runIntro() {
    if (introRunning) return; introRunning = true;
    sound.start(); show('#title', false); show('#skipIntro', true);
    const speech = narrator.speak('intro');
    await Promise.all([app.globe.play(narrator.has('intro') ? 19 : 13), speech]);
    if (!introRunning) return;
    await handoff();
  }
  async function handoff() {
    introRunning = false; show('#skipIntro', false);
    $('#fade').classList.add('on'); await sleep(750);
    app.setGlobe(false); go(1, { instant: true });
    await sleep(150); $('#fade').classList.remove('on');
  }
  $('#skipIntro').onclick = () => { narrator.stop(); app.globe.skip(); if (introRunning) handoff(); };

  const handlers = {
    title() {
      show('#title', true); show('#hud', false); app.setGlobe(true);
      Object.assign(goal, { revealAll: 0, cloudFade: 0, waterGlow: 0, lensOn: 0, targetGlow: 0 });
      U.uRevealAll.value = 0; U.uCloudFade.value = 0; app.resetReveal(); setMode(1); st.t = 0;
      controls.enabled = false;
      return {};
    },
    pulse(c, opt) {
      controls.enabled = false; app.flyTo(c.shot, opt.instant ? 0 : 2.4); setMode(1); st.t = Math.min(peakIndex, N - 1) * 0.5;
      Object.assign(goal, { revealAll: 0, cloudFade: 0, waterGlow: 0, lensOn: 0 });
      U.uRevealAll.value = 0; U.uCloudFade.value = 0; app.resetReveal();
      canvas.style.cursor = 'crosshair';
      const satTimer = setTimeout(() => app.satellite.flyover({ dur: 7, scan: false }), 1200);
      let acc = 0;
      return {
        update(dt, now) {
          if (holding && holdPos && now - lastPulse > 0.26) { const uv = app.pick(...holdPos); if (uv) { app.pulse(uv[0], uv[1]); lastPulse = now; } }
          acc += dt;
          if (acc > 0.3 && !done) {
            acc = 0; const f = app.revealFraction();
            if (f > 0.005) feedback(`radar coverage ${Math.min(100, Math.round(f / c.threshold * 100))}%`);
            if (f >= c.threshold) complete('Seen through the clouds');
          }
        },
        leave() { clearTimeout(satTimer); goal.revealAll = 1; goal.cloudFade = 1; canvas.style.cursor = ''; },
      };
    },
    find(c, opt) {
      controls.enabled = true; app.flyTo(c.shot, opt.instant ? 0 : 2.4); setMode(1); st.t = 0;
      Object.assign(goal, { revealAll: 1, cloudFade: 1, waterGlow: 0, lensOn: 0, targetGlow: 0 });
      const [tu, tv] = ds.toUV(c.target.lon, c.target.lat); U.uTarget.value.set(tu, tv);
      let misses = 0, prev = null;
      return {
        onClick(e) {
          if (done) return;
          const uv = app.pick(e.clientX, e.clientY); if (!uv) return;
          const d = Math.hypot((uv[0] - tu) * ds.kmX, (uv[1] - tv) * ds.kmY);
          app.pulse(uv[0], uv[1], false);
          if (d <= c.target.radiusKm) { goal.targetGlow = 1; app.setLabels(c.labels); app.flyTo(c.foundShot, 2.8); complete('Found Angkor Wat'); return; }
          misses++;
          const heat = d < 3 ? 'Burning hot!' : d < 7 ? 'Warmer…' : d < 14 ? 'Cool.' : 'Cold.';
          const trend = prev === null ? '' : d < prev ? ' closer' : ' further';
          prev = d;
          feedback(`${heat}${trend} · ${d.toFixed(1)} km${misses >= 3 ? ' · hint: ' + c.hint : ''}`, d < 3 ? 'hot' : '');
          if (misses >= 6) goal.targetGlow = 0.6;
        },
        leave() { goal.targetGlow = 0; },
      };
    },
    breath(c, opt) {
      controls.enabled = true; app.flyTo(c.shot, opt.instant ? 0 : 2.6); setMode(1); st.t = 0;
      Object.assign(goal, { revealAll: 1, cloudFade: 1, waterGlow: 1, lensOn: 0 });
      show('#timeline', true); app.setLabels(c.labels); hoverOn = true; updateColorbar(1);
      if (c.section && ds.dem) c.onDone = () => setSection(ds.toUV(...c.section[0]), ds.toUV(...c.section[1]));
      const timer = setTimeout(() => { if (!playing) togglePlay(peakIndex); }, 4200);
      return {
        update() { if (!done && st.t >= peakIndex - 0.02) complete(`Peak: ${Math.round(totals[peakIndex])} km² of water`); },
        leave() { clearTimeout(timer); },
      };
    },
    canopy(c, opt) {
      controls.enabled = true; app.flyTo(c.shot, opt.instant ? 0 : 2.6); setMode(0); st.t = peakIndex; playing = false;
      Object.assign(goal, { revealAll: 1, cloudFade: 1, waterGlow: 0, lensOn: 1 });
      U.uLensR.value = 1.8; app.waterBase = 0.06; app.setLabels(c.labels); hoverOn = true;
      let found = 0;
      return {
        update(dt) {
          followLens();
          if (done) return;
          const s = app.sample(U.uLens.value.x, U.uLens.value.y, Math.round(st.t));
          if (s && s.flag === 170) { found += dt; feedback(`double bounce detected ${Math.min(100, Math.round(found / 1.2 * 100))}%`, 'hot'); }
          if (found > 1.2) {
            complete('Hidden water found');
            app.scatter.show(app.uvToWorld(U.uLens.value.x, U.uLens.value.y), 'double', app.now);
          }
        },
        leave() { U.uLensR.value = 2.2; app.waterBase = 0.32; app.scatter.hide(); },
      };
    },
    explore(c, opt) {
      controls.enabled = true; app.flyTo(c.shot, opt.instant ? 0 : 2.8); setMode(3); playing = false;
      Object.assign(goal, { revealAll: 1, cloudFade: 1, waterGlow: 0, lensOn: 0 });
      glowBtn.classList.remove('on'); lensBtn.classList.remove('on');
      show('#timeline', true); show('#dock', true);
      app.setLabels(c.labels || 'all'); hoverOn = true;
      done = true; $('#next').classList.add('ready');
      return {
        onClick(e) { const uv = app.pick(e.clientX, e.clientY); if (uv) { setProbe(uv[0], uv[1]); sound.tick(1200); } },
        update() { if (goal.lensOn) followLens(); },
      };
    },
  };

  function go(i, opt = {}) {
    ch?.leave?.();
    chapterCard.classList.remove('show');
    narrator.stop(); app.satellite.cancel();
    ci = (i + site.chapters.length) % site.chapters.length;
    const c = site.chapters[ci];
    done = false; playing = false; $('#play').classList.remove('on');
    ['#timeline', '#dock', '#statPop', '#colorbar', '#places'].forEach((s) => show(s, false));
    $('#statChip').classList.remove('open');
    clearProbe(); clearSection(); app.setLabels([]);
    if (app.stack.open) { app.stack.setOpen(false); stackBtn.classList.remove('on'); }
    hoverOn = false; goal.contours = 0; contourBtn?.classList.remove('on');
    drawingSection = false; secBtn?.classList.remove('on'); canvas.style.cursor = '';
    document.body.classList.toggle('at-title', c.type === 'title');
    document.body.classList.toggle('in-explore', c.type === 'explore');
    if (c.type !== 'title') { show('#title', false); show('#hud', true); setTask(c); setTimeout(() => { if (site.chapters[ci] === c) showChapterCard(c); }, opt.instant ? 900 : 500); }
    ch = handlers[c.type](c, opt) || {};
    ch.shot = c.shot;
    updateColorbar(U.uMode.value);
    if (c.type !== 'title' && narrator.has(voiceKey(c))) setTimeout(() => { if (site.chapters[ci] === c) narrator.speak(voiceKey(c)); }, opt.instant ? 600 : 300);
  }

  $('#begin').onclick = () => { sound.start(); runIntro(); };
  $('#next').onclick = () => go(ci + 1);
  $('#skip').onclick = () => go(ci + 1);

  addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    const tl = $('#timeline').classList.contains('show');
    if (e.code === 'Space' && tl) { e.preventDefault(); togglePlay(); }
    if (e.code === 'ArrowRight' && tl) { app.satellite.cancel(); st.t = Math.min(N - 1, Math.floor(st.t + 1e-3) + 1); playing = false; }
    if (e.code === 'ArrowLeft' && tl) { app.satellite.cancel(); st.t = Math.max(0, Math.ceil(st.t - 1e-3) - 1); playing = false; }
    if (e.code === 'Enter' && $('#next').classList.contains('ready')) go(ci + 1);
    if (e.code === 'Escape') { clearProbe(); menu.classList.remove('open'); $('#info').classList.remove('open'); }
    if (e.key === 'v') voiceBtn.click(); if (e.key === 'k') ccBtn.click();
    if (e.key === 'r' && ci > 0) narrator.speak(voiceKey(site.chapters[ci]));
    if ($('#dock').classList.contains('show')) {
      const m = MODES.find((m) => m.key === e.key); if (m && (m.id !== 5 || ds.dem)) setMode(m.id);
      if (e.key === 'p') placesBtn?.click(); if (e.key === 'l') lensBtn.click(); if (e.key === 'g') glowBtn.click(); if (e.key === 't') stackBtn.click();
      if (e.key === 'c') contourBtn?.click(); if (e.key === 's') secBtn?.click();
    }
  });

  // ---------- per-frame ----------
  let lastT = -1;
  const capEl = $('#caption'), bottomEl = $('#bottom');
  app.onFrame((dt, now) => {
    const k = 1 - Math.exp(-dt * 2.2);
    U.uRevealAll.value = lerp(U.uRevealAll.value, goal.revealAll, k);
    U.uCloudFade.value = lerp(U.uCloudFade.value, goal.cloudFade, k);
    U.uWaterGlow.value = lerp(U.uWaterGlow.value, goal.waterGlow, k * 1.5);
    U.uLensOn.value = lerp(U.uLensOn.value, goal.lensOn, k * 2);
    U.uTargetGlow.value = lerp(U.uTargetGlow.value, goal.targetGlow, k * 2);
    U.uContours.value = lerp(U.uContours.value, goal.contours, k * 2);
    // playback = a sequence of satellite acquisitions (no cross-fading between passes)
    if (playing && !app.satellite.busy) {
      const from = Math.round(st.t), stop = playStop ?? N - 1;
      if (from >= stop) { playing = false; $('#play').classList.remove('on'); }
      else {
        st.t = from;
        app.satellite.flyover({ from, to: from + 1, dur: 1.9, scan: true, onUpdate: (f) => (st.t = from + f), onDone: () => (st.t = from + 1) });
      }
    }
    ch?.update?.(dt, now);
    // quiet reminder if nothing has happened for a while
    if (!done && site.chapters[ci]?.task && !$('#task').classList.contains('show') && performance.now() - taskSince > 15000) show('#task', true);
    updateHover(); placePop();
    // stack panels above the bottom bar, and captions above any open panel, so nothing collides
    const hudOn = $('#hud').classList.contains('show'), stackTop = bottomEl.offsetHeight + 26;
    $('#sheet').style.bottom = $('#statPop').style.bottom = `${stackTop}px`;
    const sheetOpen = $('#sheet').classList.contains('show') || $('#statPop').classList.contains('show');
    const panelH = sheetOpen ? Math.max($('#sheet').offsetHeight, $('#statPop').offsetHeight) + 12 : 0;
    capEl.style.bottom = `${hudOn ? stackTop + 2 + panelH : 70}px`;
    if (st.t !== lastT) {
      lastT = st.t;
      const x = tToX(st.t) * 100; thumb.style.left = `${x}%`; fill.style.width = `${x}%`;
      const near = Math.round(st.t), obs = Math.abs(st.t - near) < 0.03;
      if (obs && near !== lastTick) { lastTick = near; sound.tick(700 + near * 25); if (probe) drawProbe(); }
      if (!obs) lastTick = -1;
      const scanning = U.uScanV.value >= 0;
      $('#timeline .date').innerHTML = obs || scanning
        ? `<b>${fmtDate(ds.dates[scanning ? Math.min(N - 1, Math.ceil(st.t - 0.001)) : near])}</b><span>${scanning ? 'NISAR acquiring…' : `pass ${near + 1} / ${N}`}</span>`
        : `<b>~${fmtShort(new Date(t0 + tToX(st.t) * (tN - t0)).toISOString().slice(0, 10))}</b><span>between passes · blended</span>`;
      const a = app.areaAt(st.t), tot = a.open + a.veg, dlt = tot - totals[0];
      $('#statChip').innerHTML = `<b>${Math.round(tot).toLocaleString('en')} km²</b><span>water · ${dlt >= 0 ? '▲' : '▼'}${Math.round(Math.abs(dlt))} since ${fmtShort(ds.dates[0])}</span>`;
      $('#statPop .num').textContent = Math.round(tot).toLocaleString('en');
      $('#statPop .delta').textContent = `${dlt >= 0 ? '+' : '−'}${Math.round(Math.abs(dlt)).toLocaleString('en')} km² since ${fmtShort(ds.dates[0])}`;
      $('#statPop .split').innerHTML = `<i style="background:#40d8ff"></i>open ${Math.round(a.open)} <i style="background:#a6ff8c"></i>under vegetation ${Math.round(a.veg)}`;
      if (ds.waterLevels) {
        const L = app.levelAt(st.t), L0 = ds.waterLevels[0];
        $('#statPop .level').innerHTML = `Lake level <b>${L.toFixed(1)} m</b> <span>(${sim ? 'simulated' : 'radar shoreline × DEM'}) · ${L >= L0 ? '+' : '−'}${Math.abs(L - L0).toFixed(1)} m since ${fmtShort(ds.dates[0])}</span>`;
      }
      if ($('#statPop').classList.contains('show')) drawChart();
      if (section && (obs || scanning)) drawSection();
    }
  });

  const start = parseInt(new URLSearchParams(location.search).get('chapter') || '0', 10);
  if (start > 0) app.setGlobe(false);
  go(Math.min(start, site.chapters.length - 1), { instant: start > 0 });
  if (start > 1) { U.uRevealAll.value = goal.revealAll = 1; U.uCloudFade.value = goal.cloudFade = 1; }
}
