# TerraPulse: The Lake That Breathes

An immersive, story-driven web experience built on NASA–ISRO **NISAR** L-band radar. Visitors:

1. **Blind from above.** Fire radar pulses to burn through monsoon clouds.
2. **Find the temple.** Spot Angkor Wat's 190 m moat in the radar (a warmer/colder game).
3. **The lake breathes.** Scrub a season of 12-day passes as Tonle Sap floods the plain. The floating slab's edge shows the water column rising.
4. **Water under the trees.** Sweep a radar lens over green canopy to reveal flooded forest (the L-band "double bounce").
5. **Why it matters, plus free exploration.** Switch layers (HH, HV, colour mix, change), click any spot for its radar history.

Until real Tonle Sap data is converted, the app runs on **clearly labelled simulated NISAR-like radar on real Copernicus GLO-30 terrain**. The simulated flood fills the real floodplain up to a simulated lake level. It uses exactly the same file format as real data.

Data-grounding features:
- **Colour bars with units:** dB for HH/HV/change, metres for elevation.
- **Map furniture:** scale bar, north arrow, lat/lon ticks on the slab edges.
- **Hover readout:** status, ground height, lake level, water depth, HH/HV, coordinates.
- **Probe provenance:** product ID, track/frame, pass direction, UTC time, processing version, terrain source.
- **Contours** (2 m / 10 m on the floodplain, 50 m on hills). The shoreline is drawn as the contour at the current lake level.
- **Cross-section tool** (`S`, then drag): ground profile, current water body, and water surfaces from every other pass.

## Run

No build step and no npm. three.js loads from a CDN.

```bash
python3 scripts/serve.py
```

(a static server with caching disabled, so edits always reload)

Open http://localhost:8642. Useful URL parameters:

| Parameter | Effect |
|---|---|
| `?data=<name>` | load converted real data from `web/data/<name>/` (falls back to the simulation) |
| `?chapter=<n>` | jump to a chapter (0 = title) |
| `?site=<id>` | force a story (`tonle-sap`); any other dataset gets a generic explore mode |

Already converted: `?data=sylhet` shows real NISAR GCOV (5 dates, Aug–Nov 2026).

## Get the real Tonle Sap data

1. **NISAR GCOV.** In [ASF Vertex](https://search.asf.alaska.edu/) choose dataset **NISAR**, product **L2 GCOV**.
   - Draw the area of interest: **W 103.70, S 13.12, E 104.14, N 13.56** (Angkor, Siem Reap, the lake's north shore and Phnom Kulen).
   - Pick one **path/frame** and one **orbit direction**, and take **every date** from the earliest available through November 2026. Ideally that's before June for low water through October for the peak, so 10+ dates.
   - Download the subsetted GeoTIFFs for `frequencyA` **HHHH**, **HVHV** and **mask** for every date (the same way the Sylhet files in `data/raw/` were made). Every date must use the same subset box.
   - Put them in `data/raw/tonle-sap/`.
2. **DEM (optional, recommended).** Download Copernicus GLO-30 for the same box from [OpenTopography](https://portal.opentopography.org/) as a GeoTIFF and save it as `data/raw/tonle-sap/dem.tif`. This gives the 3D terrain and the water-level estimate.
3. **Convert:**
   ```bash
   pip install numpy tifffile imagecodecs
   ```
   ```bash
   python3 scripts/prepare_web_data.py --raw data/raw/tonle-sap --name tonle-sap --dem data/raw/tonle-sap/dem.tif --water-level
   ```
   numpy is optional, but without it a 47 km scene takes a very long time. The script:
   - checks that all dates share one grid;
   - block-averages power to ≤ 900 px;
   - normalises dates against stable bright targets (this fixes processing-version jumps such as P05023 → P05036 in the Sylhet data);
   - flags open water (Otsu threshold) and flooded vegetation (HH double-bounce rule);
   - writes PNG layers and `manifest.json`.
4. Reload http://localhost:8642. The story now runs on real data automatically, because `?data=` defaults to `tonle-sap`.

## Terrain

The terrain is built once from public Copernicus GLO-30 tiles (no login):

```bash
python3 scripts/make_terrain.py --tiles data/raw/tonle-sap-dem --bbox 103.70 13.12 104.14 13.56 --size 768 --name tonle-sap
```

GLO-30 is a surface model, so trees and buildings are removed with a morphological opening to estimate bare ground. The surface model is kept too, as `web/data/terrain/tonle-sap-surface.png`.

## Layout

```
web/index.html, styles.css    page + HUD
web/src/main.js               three.js scene: floating slab, skirts, water, clouds, picking, camera
web/src/scene/shaders.js      terrain modes, radar pulses, lens, clouds, water column
web/src/story.js              chapter state machine, timeline, charts, probe
web/src/sites.js              story text, places, camera shots
web/src/data/synthetic.js     simulated NISAR-like time series (same encoding as real data)
web/src/data/loader.js        real-data loader (UTM georeferencing)
scripts/prepare_web_data.py   GeoTIFF -> web converter (stdlib; numpy fast path)
scripts/make_terrain.py       Copernicus GLO-30 tiles -> web terrain (numpy, tifffile)
scripts/serve.py              no-cache dev server
```

## Honesty notes

- The badge (top right) states whether the data is simulated or real, and lists the product IDs.
- Frames between passes are visual blends and are labelled "between passes".
- Terrain height uses a log-scale exaggeration so a ~10 m floodplain is visible next to 400 m hills.
- Water flags from real data come from simple rules and are not yet validated.
