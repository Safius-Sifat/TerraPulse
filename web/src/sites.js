// Story content per site. Chapters reference interaction types implemented in story.js.

const tonleSap = {
  id: 'tonle-sap',
  name: 'Tonle Sap · Angkor, Cambodia',
  // The DEM remains unchanged; this controls display-only logarithmic relief.
  exaggeration: 0.52,
  globeTarget: { lat: 13.3, lon: 103.9 },
  narration: 'tonle-sap',
  title: 'The Lake That Breathes',
  subtitle: 'Every monsoon, Cambodia’s great lake swells to several times its size — hidden under clouds the whole time. Follow it with NISAR, a radar that sees straight through them.',
  overview: { uv: [0.5, 0.56], dist: 70, elev: 0.8, az: 0 },
  pois: [
    { id: 'aw', name: 'Angkor Wat', note: '12th-century temple · 190 m moat', lon: 103.867, lat: 13.4125 },
    { id: 'at', name: 'Angkor Thom', note: '3 km walled city', lon: 103.859, lat: 13.4413 },
    { id: 'wb', name: 'West Baray', note: '~1,000-year-old reservoir, 8 km long', lon: 103.79, lat: 13.4425 },
    { id: 'eb', name: 'East Baray', note: 'ancient reservoir, now dry fields', lon: 103.912, lat: 13.445 },
    { id: 'sr', name: 'Siem Reap', lon: 103.856, lat: 13.365 },
    { id: 'rw', name: 'Old airport runway', note: 'smooth tarmac → radar-dark', lon: 103.813, lat: 13.41 },
    { id: 'pk', name: 'Phnom Krom', note: 'hill at the lake’s edge', lon: 103.8122, lat: 13.2857 },
    { id: 'ck', name: 'Chong Kneas', note: 'floating village', lon: 103.82, lat: 13.24 },
    { id: 'kp', name: 'Kampong Phluk', note: 'stilt village in flooded forest', lon: 103.97, lat: 13.215 },
    { id: 'ku', name: 'Phnom Kulen', note: 'sacred plateau, source of the Siem Reap river', lon: 104.08, lat: 13.53 },
    { id: 'ts', name: 'Tonle Sap Lake', lon: 103.80, lat: 13.15 },
  ],
  chapters: [
    { type: 'title' },
    {
      type: 'pulse', kicker: 'Chapter 1', title: 'Blind from above',
      body: [
        'June to October is monsoon season. For optical satellites, Cambodia is mostly cloud.',
        'NISAR brings its own light: L-band microwaves, 24 cm long, that pass through cloud and work day or night.',
      ],
      task: 'Press and hold on the clouds to fire radar pulses.',
      done: 'You’re now seeing radar backscatter: how much of each pulse bounces back. Calm water mirrors it away (dark). Stone and buildings throw it straight back (bright).',
      shot: { uv: [0.5, 0.5], dist: 60, elev: 1.25, az: 0 },
      threshold: 0.33,
      doneTitle: 'You saw through the clouds',
      takeaway: 'Radar brings its own light. Dark means calm water reflecting the pulse away; bright means stone and buildings bouncing it straight back.',
    },
    {
      type: 'find', kicker: 'Chapter 2', title: 'Find the temple',
      body: [
        'Somewhere below lies Angkor Wat, the largest religious monument on Earth.',
        'In radar its 190-metre moat is a sharp dark rectangle: water reflects the pulse away from the satellite.',
      ],
      task: 'Click where you think Angkor Wat is.',
      target: { lon: 103.867, lat: 13.4125, radiusKm: 1.25 },
      hint: 'Look north of the bright town of Siem Reap, just east of the enormous dark rectangle.',
      done: 'Found it — 900-year-old sandstone, still echoing radar back to orbit. That giant dark rectangle to the west is the West Baray, an 8 km reservoir dug about a thousand years ago.',
      shot: { uv: [0.5, 0.45], dist: 44, elev: 1.0, az: 0 },
      foundShot: { lon: 103.84, lat: 13.43, dist: 13, elev: 0.75, az: 0.25 },
      labels: ['aw', 'at', 'wb', 'eb', 'sr', 'rw'],
      doneTitle: 'You found Angkor Wat',
      takeaway: 'Water-filled moats and reservoirs show up as sharp dark shapes, which is exactly how radar maps floods.',
    },
    {
      type: 'breath', kicker: 'Chapter 3', title: 'The lake breathes',
      body: [
        'Now watch a whole season. Each frame is one NISAR pass, 12 days apart.',
        'When the Mekong floods, it pushes so much water up the Tonle Sap River that the river runs backwards and fills the lake.',
      ],
      task: 'Drag the timeline — or press play — until the lake peaks.',
      legend: [['#40d8ff', 'New open water since the first pass'], ['#a6ff8c', 'Water hidden under vegetation']],
      done: 'Peak flood. Everything glowing was dry ground in early June. The profile shows why: a few metres of rise floods kilometres of nearly flat floodplain.',
      shot: { uv: [0.52, 0.68], dist: 40, elev: 0.6, az: -0.35 },
      section: [[103.857, 13.385], [103.83, 13.17]],
      doneTitle: 'The lake reached its peak',
      takeaway: ({ totals, peakIndex }) => `Water in this view grew from ${Math.round(totals[0])} to ${Math.round(totals[peakIndex])} km². The land is so flat that a few metres of rise floods kilometres.`,
      labels: ['ts', 'ck', 'kp', 'sr'],
    },
    {
      type: 'canopy', kicker: 'Chapter 4', title: 'Water under the trees',
      body: [
        'A camera sees a green forest canopy. But much of the forest ringing the lake is standing in metres of water.',
        'L-band waves slip between the leaves, skim off the water and bounce off the trunks straight back to NISAR. This “double bounce” makes flooded forest blaze bright.',
      ],
      task: 'Move the radar lens over the forest near the lake to find the hidden water.',
      done: 'Hidden water found. This drowned forest is the lake’s fish nursery: fish spawn among the flooded trees.',
      shot: { lon: 103.968, lat: 13.212, dist: 10, elev: 0.8, az: 0.2 },
      labels: ['kp', 'ck'],
      doneTitle: 'You found hidden water',
      takeaway: 'Long L-band waves reach the water under the canopy and bounce back off the trunks. Optical satellites can’t see this.',
    },
    {
      type: 'explore', kicker: 'Chapter 5', title: 'Why it matters',
      body: [
        'This flood pulse feeds one of the world’s most productive inland fisheries, and farmers plant rice as the water retreats.',
        'Upstream dams and drought are changing the rhythm. NISAR revisits every 12 days, through any weather, so the pulse can be measured season after season.',
      ],
      task: 'Explore freely: switch layers, scrub time, click anywhere to read that spot’s radar history.',
      shot: { uv: [0.5, 0.5], dist: 58, elev: 0.85, az: 0.5 },
      labels: 'all',
      section: [[104.10, 13.52], [103.90, 13.16]],
    },
  ],
};

export const SITES = {
  'tonle-sap': tonleSap,
  generic: (name) => ({
    id: name, name, title: 'Radar Time Machine',
    subtitle: `NISAR L-band observations of ${name}. Scrub through time, switch polarizations and click anywhere to read its radar history.`,
    overview: { uv: [0.5, 0.5], dist: 70, elev: 0.95, az: 0 },
    pois: [],
    chapters: [
      { type: 'title' },
      { type: 'explore', kicker: 'Explore', title: 'Read the radar', body: ['Dark = smooth surfaces such as calm water. Bright = buildings, rough or wet vegetation.'], task: 'Scrub time, switch layers, click to probe.', shot: { uv: [0.5, 0.5], dist: 62, elev: 0.9, az: 0.3 }, labels: 'all' },
    ],
  }),
};
