#!/usr/bin/env python3
"""Convert NISAR L2 GCOV GeoTIFF subsets into the TerraPulse web format.

Pure standard library (no numpy/GDAL) so it runs anywhere.

Input  : a folder of NISAR GCOV subsets downloaded from ASF (Vertex / Harmony), e.g.
         NISAR_L2_PR_GCOV_..._<YYYYMMDDTHHMMSS>_..._frequencyA_HHHH_subsetted.tif  (+ HVHV, mask)
         all dates must share one grid (same track/frame and same subset box).
Output : web/data/<name>/manifest.json, layers/<date>.png (RGBA: HH, HV, water flag, valid), dem.png

Usage  : python3 scripts/prepare_web_data.py --raw data/raw/tonle-sap --name tonle-sap \
                 [--dem data/raw/copernicus_dem.tif] [--max-size 900] [--no-normalize]
Then open http://localhost:8642/?data=tonle-sap
"""
import argparse
import glob
import json
import math
import os
import re
import struct
import sys
import zlib
from collections import defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geotiff_lite import GeoTiff  # noqa: E402

HH_RANGE = (-30.0, 5.0)
HV_RANGE = (-35.0, -5.0)
NAME_RE = re.compile(r'(NISAR_L2_\w+?_GCOV_\d+_\d+_[AD]_\d+_\d+_\w{4}_[A-Z]_(\d{8})T\d{6}_\d{8}T\d{6}_(P\d{5})_\w+?_\d{3})_.*?frequencyA_(HHHH|HVHV|mask)')


def log(*a):
    print(*a, flush=True)


def write_png(path, w, h, rgba):
    raw = bytearray()
    stride = w * 4
    for y in range(h):
        raw.append(0); raw += rgba[y * stride:(y + 1) * stride]

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress(bytes(raw), 6)) + chunk(b'IEND', b''))


def utm_inverse(x, y, zone, north=True):
    a, f, k0 = 6378137.0, 1 / 298.257223563, 0.9996
    e2 = f * (2 - f); ep2 = e2 / (1 - e2); e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))
    x -= 500000.0
    if not north: y -= 10000000.0
    mu = (y / k0) / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256))
    p1 = (mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * math.sin(4 * mu)
          + (151 * e1 ** 3 / 96) * math.sin(6 * mu))
    s, c, tn = math.sin(p1), math.cos(p1), math.tan(p1)
    N1 = a / math.sqrt(1 - e2 * s * s); T1 = tn * tn; C1 = ep2 * c * c
    R1 = a * (1 - e2) / (1 - e2 * s * s) ** 1.5; D = x / (N1 * k0)
    lat = p1 - (N1 * tn / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24
                                 + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720)
    lon = (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / c
    return (zone - 1) * 6 - 180 + 3 + math.degrees(lon), math.degrees(lat)


def otsu(values, lo, hi, bins=280):
    hist = [0] * bins
    for v in values:
        if lo <= v < hi: hist[int((v - lo) / (hi - lo) * bins)] += 1
    total = sum(hist); sum_all = sum(i * c for i, c in enumerate(hist))
    wb = sb = 0; best = (0, 0)
    for i, c in enumerate(hist):
        wb += c
        if wb == 0 or wb == total: continue
        sb += i * c
        mb, mf = sb / wb, (sum_all - sb) / (total - wb)
        between = wb * (total - wb) * (mb - mf) ** 2
        if between > best[0]: best = (between, i)
    return lo + (best[1] + 0.5) * (hi - lo) / bins


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--raw', required=True, help='folder with NISAR GCOV GeoTIFF subsets')
    ap.add_argument('--name', required=True, help='dataset name (web/data/<name>)')
    ap.add_argument('--dem', help='optional DEM GeoTIFF in EPSG:4326 (e.g. Copernicus GLO-30)')
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', 'web', 'data'))
    ap.add_argument('--max-size', type=int, default=900, help='max output width/height in pixels')
    ap.add_argument('--no-normalize', action='store_true', help='skip stable-target radiometric normalisation')
    ap.add_argument('--water-level', action='store_true', help='estimate water level from DEM at the shoreline (shows the 3D water plane)')
    args = ap.parse_args()

    # ---------- discover files ----------
    groups = defaultdict(dict)
    for p in sorted(glob.glob(os.path.join(args.raw, '*.tif'))):
        m = NAME_RE.search(os.path.basename(p))
        if not m or ' (' in os.path.basename(p):
            continue
        pid, day, ver, band = m.groups()
        groups[day].setdefault('id', pid); groups[day]['version'] = ver; groups[day][band] = p
    days = sorted(d for d, g in groups.items() if 'HHHH' in g and 'HVHV' in g)
    if not days:
        sys.exit(f'No NISAR GCOV HHHH/HVHV subsets found in {args.raw}')
    log(f'Found {len(days)} dates: {", ".join(days)}')

    # ---------- grid check ----------
    ref = GeoTiff(groups[days[0]]['HHHH'])
    W0, H0, (x0, y0), (dx0, dy0) = ref.width, ref.height, ref.origin, ref.pixscale[:2]
    for d in days:
        for b in ('HHHH', 'HVHV', 'mask'):
            if b not in groups[d]: continue
            g = GeoTiff(groups[d][b])
            if (g.width, g.height, g.origin) != (W0, H0, (x0, y0)):
                sys.exit(f'Grid mismatch: {groups[d][b]} is {g.width}x{g.height} at {g.origin}, expected {W0}x{H0} at {(x0, y0)}.\n'
                         'Download every date with the same subset box from the same track/frame.')
    zone_m = re.search(r'UTM zone (\d+)([NS])', ref.crs_text)
    if not zone_m:
        sys.exit(f'Expected a UTM grid, got CRS "{ref.crs_text}"')
    zone, north = int(zone_m.group(1)), zone_m.group(2) == 'N'

    f = max(1, math.ceil(max(W0, H0) / args.max_size))
    W, H = W0 // f, H0 // f
    log(f'Grid {W0}x{H0} @ {dx0} m  ->  {W}x{H} @ {dx0 * f} m (block-averaged power, factor {f})')

    # ---------- multilook (average linear power) ----------
    def multilook(arr, valid):
        out = [float('nan')] * (W * H)
        for J in range(H):
            for I in range(W):
                s = 0.0; c = 0
                for j in range(J * f, J * f + f):
                    base = j * W0
                    for i in range(I * f, I * f + f):
                        k = base + i
                        v = arr[k]
                        if valid[k] and v > 0 and v == v:
                            s += v; c += 1
                if c * 2 >= f * f:
                    out[J * W + I] = 10 * math.log10(s / c)
        return out

    try:  # fast path for large scenes: pip install numpy tifffile imagecodecs
        import numpy as np
        import tifffile
    except ImportError:
        np = None
        if W0 * H0 > 4_000_000:
            log('WARNING: large scene and numpy/tifffile not installed — this will be slow. '
                'Speed it up with: pip install numpy tifffile imagecodecs')
    if np is not None:
        log('Using numpy/tifffile fast path')

    def multilook_np(path, valid):
        a = tifffile.imread(path).astype(np.float64)[:H * f, :W * f]
        ok = valid & np.isfinite(a) & (a > 0)
        s = np.where(ok, a, 0).reshape(H, f, W, f).sum(axis=(1, 3))
        c = ok.reshape(H, f, W, f).sum(axis=(1, 3))
        with np.errstate(divide='ignore', invalid='ignore'):
            out = np.where(c * 2 >= f * f, 10 * np.log10(s / np.maximum(c, 1)), np.nan)
        return out.ravel().tolist()

    hh_db, hv_db = [], []
    for d in days:
        g = groups[d]
        if np is not None:
            valid = np.ones((H * f, W * f), bool)
            if 'mask' in g:
                m = tifffile.imread(g['mask'])[:H * f, :W * f]; valid = (m != 0) & (m != 255)
            hh_db.append(multilook_np(g['HHHH'], valid)); hv_db.append(multilook_np(g['HVHV'], valid))
        else:
            mask = GeoTiff(g['mask']).read() if 'mask' in g else None
            valid = [m not in (0, 255) for m in mask] if mask is not None else [True] * (W0 * H0)
            hh_db.append(multilook(GeoTiff(g['HHHH']).read(), valid))
            hv_db.append(multilook(GeoTiff(g['HVHV']).read(), valid))
        log(f'  {d}  {g["version"]}  loaded')
    n = W * H
    valid_all = [all(hh_db[t][k] == hh_db[t][k] and hv_db[t][k] == hv_db[t][k] for t in range(len(days))) for k in range(n)]

    # ---------- radiometric normalisation on stable bright targets ----------
    offsets = [0.0] * len(days)
    if not args.no_normalize:
        ref_px = [k for k in range(n) if valid_all[k] and all(hh_db[t][k] > -3 for t in range(len(days)))]
        if len(ref_px) > 200:
            meds = []
            for t in range(len(days)):
                v = sorted(hh_db[t][k] for k in ref_px); meds.append(v[len(v) // 2])
            target = sorted(meds)[len(meds) // 2]
            offsets = [target - m for m in meds]
            for t in range(len(days)):
                o = offsets[t]
                hh_db[t] = [v + o for v in hh_db[t]]; hv_db[t] = [v + o for v in hv_db[t]]
            log('Normalised on %d stable bright pixels; offsets (dB): %s' % (len(ref_px), ', '.join(f'{o:+.2f}' for o in offsets)))
        else:
            log('Too few stable bright pixels; skipping normalisation')

    # ---------- water flags ----------
    sample = [hh_db[t][k] for t in range(len(days)) for k in range(0, n, 3) if valid_all[k]]
    thr_hh = otsu(sample, -35, 5)
    thr_hh = min(thr_hh, -14.0)
    log(f'Open-water threshold (Otsu on HH, capped): {thr_hh:.1f} dB')
    hh_min = [min(hh_db[t][k] for t in range(len(days))) if valid_all[k] else 0 for k in range(n)]

    # ---------- DEM ----------
    dem_out = None
    if args.dem:
        dg = GeoTiff(args.dem); dv = dg.read()
        (lon0, lat0), (dlon, dlat) = dg.origin, dg.pixscale[:2]
        dem_out = [0.0] * n
        for J in range(H):
            for I in range(W):
                lon, lat = utm_inverse(x0 + (I + 0.5) * dx0 * f, y0 - (J + 0.5) * dy0 * f, zone, north)
                fx = (lon - lon0) / dlon - 0.5; fy = (lat0 - lat) / dlat - 0.5
                i = min(max(int(fx), 0), dg.width - 2); j = min(max(int(fy), 0), dg.height - 2)
                ax, ay = min(max(fx - i, 0), 1), min(max(fy - j, 0), 1)
                a, b = dv[j * dg.width + i], dv[j * dg.width + i + 1]
                c, e = dv[(j + 1) * dg.width + i], dv[(j + 1) * dg.width + i + 1]
                dem_out[J * W + I] = (a * (1 - ax) + b * ax) * (1 - ay) + (c * (1 - ax) + e * ax) * ay
        log(f'DEM resampled: {min(dem_out):.0f}–{max(dem_out):.0f} m')

    # ---------- write ----------
    out_dir = os.path.join(args.out, args.name)
    os.makedirs(os.path.join(out_dir, 'layers'), exist_ok=True)
    px_km2 = (dx0 * f) * (dy0 * f) / 1e6
    stats, layers, levels = [], [], []
    for t, d in enumerate(days):
        rgba = bytearray(n * 4)
        flags = bytearray(n)
        n_open = n_veg = 0
        for k in range(n):
            hh, hv = hh_db[t][k], hv_db[t][k]
            if not valid_all[k]:
                continue
            flag = 0
            if hh < thr_hh and hv < thr_hh - 6:
                flag = 255; n_open += 1
            elif hh > -6 and hh - hh_min[k] > 3 and hh - hv > 7:
                flag = 170; n_veg += 1
            flags[k] = flag
            o = k * 4
            rgba[o] = max(0, min(255, round((hh - HH_RANGE[0]) / (HH_RANGE[1] - HH_RANGE[0]) * 255)))
            rgba[o + 1] = max(0, min(255, round((hv - HV_RANGE[0]) / (HV_RANGE[1] - HV_RANGE[0]) * 255)))
            rgba[o + 2] = flag; rgba[o + 3] = 255
        iso = f'{d[:4]}-{d[4:6]}-{d[6:]}'
        name = f'layers/{iso}.png'
        write_png(os.path.join(out_dir, name), W, H, rgba)
        layers.append(name)
        stats.append({'date': iso, 'openKm2': round(n_open * px_km2, 3), 'floodedVegKm2': round(n_veg * px_km2, 3)})
        if args.water_level and dem_out:
            shore = []
            for J in range(1, H - 1):
                for I in range(1, W - 1):
                    k = J * W + I
                    if flags[k] == 255 and (flags[k - 1] != 255 or flags[k + 1] != 255 or flags[k - W] != 255 or flags[k + W] != 255):
                        shore.append(dem_out[k])
            shore.sort(); levels.append(round(shore[len(shore) // 2], 2) if shore else 0.0)
        log(f'  wrote {name}: open water {stats[-1]["openKm2"]:.1f} km², flooded vegetation {stats[-1]["floodedVegKm2"]:.1f} km²')

    manifest = {
        'site': args.name, 'source': 'nisar', 'width': W, 'height': H,
        'dates': [s['date'] for s in stats], 'layers': layers,
        'products': [{'date': s['date'], 'id': groups[d]['id'], 'version': groups[d]['version']} for s, d in zip(stats, days)],
        'utm': {'zone': zone, 'north': north}, 'epsg': ref.epsg,
        'transform': {'x0': x0, 'y0': y0, 'dx': dx0 * f, 'dy': dy0 * f},
        'encoding': {'hh': list(HH_RANGE), 'hv': list(HV_RANGE)},
        'normalization_offsets_db': [round(o, 3) for o in offsets],
        'water_threshold_hh_db': round(thr_hh, 2),
        'stats': stats,
        'notes': 'HH/HV are 10*log10 of block-averaged GCOV power. Water flags: Otsu threshold (open water) and '
                 'HH-increase double-bounce rule (flooded vegetation); unvalidated.',
    }
    if dem_out:
        lo = math.floor(min(dem_out)) - 1
        drgb = bytearray(n * 4)
        for k, e in enumerate(dem_out):
            v = max(0, min(0xFFFFFF, round((e - lo) * 100)))
            drgb[k * 4:k * 4 + 4] = bytes(((v >> 16) & 255, (v >> 8) & 255, v & 255, 255))
        write_png(os.path.join(out_dir, 'dem.png'), W, H, drgb)
        manifest['dem'] = {'file': 'dem.png', 'offset': lo, 'scale': 0.01}
    if levels:
        manifest['water_levels_m'] = levels
    with open(os.path.join(out_dir, 'manifest.json'), 'w') as fh:
        json.dump(manifest, fh, indent=1)
    log(f'Done -> {out_dir}  (open http://localhost:8642/?data={args.name})')


if __name__ == '__main__':
    main()
