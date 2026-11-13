#!/usr/bin/env python3
"""Build the web terrain for a story site from Copernicus GLO-30 DEM tiles.

Copernicus GLO-30 is a *surface* model (includes tree canopy and buildings). For flood
modelling we approximate bare ground with a morphological opening (min filter, then max
filter) that removes objects narrower than the kernel, then smooth lightly. Both the
surface model and the terrain estimate are written so the UI can say which is shown.

Tiles (public, no login): https://copernicus-dem-30m.s3.amazonaws.com/
  Copernicus_DSM_COG_10_N13_00_E103_00_DEM/Copernicus_DSM_COG_10_N13_00_E103_00_DEM.tif

Usage: python3 scripts/make_terrain.py --tiles data/raw/tonle-sap-dem --bbox 103.70 13.12 104.14 13.56 \
           --size 768 --name tonle-sap
Requires: pip install numpy tifffile imagecodecs
"""
import argparse
import glob
import json
import os
import re
import struct
import zlib

import numpy as np
import tifffile


def write_png(path, rgba):
    h, w, _ = rgba.shape
    raw = b''.join(b'\x00' + rgba[y].tobytes() for y in range(h))

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
                + chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b''))


def encode(e, lo):
    v = np.clip(np.round((e - lo) * 100), 0, 0xFFFFFF).astype(np.uint32)
    return np.dstack([(v >> 16) & 255, (v >> 8) & 255, v & 255, np.full_like(v, 255)]).astype(np.uint8)


def filt(a, r, fn):
    p = np.pad(a, r, mode='edge'); out = a.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx * dx + dy * dy > r * r: continue
            out = fn(out, p[r + dy:r + dy + a.shape[0], r + dx:r + dx + a.shape[1]])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--tiles', required=True)
    ap.add_argument('--bbox', nargs=4, type=float, required=True, metavar=('W', 'S', 'E', 'N'))
    ap.add_argument('--size', type=int, default=768)
    ap.add_argument('--name', required=True)
    ap.add_argument('--open-radius', type=int, default=3, help='opening radius in output pixels (removes canopy/buildings)')
    ap.add_argument('--out', default=os.path.join(os.path.dirname(__file__), '..', 'web', 'data', 'terrain'))
    a = ap.parse_args()
    W, S, E, N = a.bbox
    n = a.size

    # sample grid: pixel centres, rows north -> south
    lons = W + (np.arange(n) + 0.5) / n * (E - W)
    lats = N - (np.arange(n) + 0.5) / n * (N - S)
    dsm = np.full((n, n), np.nan, np.float32)
    used = []
    for p in sorted(glob.glob(os.path.join(a.tiles, '*.tif'))):
        m = re.search(r'([NS])(\d+)_00_([EW])(\d+)_00', os.path.basename(p))
        if not m: continue
        lat0 = int(m.group(2)) * (1 if m.group(1) == 'N' else -1)
        lon0 = int(m.group(4)) * (1 if m.group(3) == 'E' else -1)
        t = tifffile.imread(p).astype(np.float32)
        th, tw = t.shape
        # tile covers [lon0, lon0+1] x [lat0, lat0+1]; row 0 = north edge
        cols = (lons - lon0) * tw - 0.5
        rows = (lat0 + 1 - lats) * th - 0.5
        ci = np.where((cols >= -0.5) & (cols <= tw - 0.5))[0]
        ri = np.where((rows >= -0.5) & (rows <= th - 0.5))[0]
        if not len(ci) or not len(ri): continue
        c, r = cols[ci], rows[ri]
        c0, r0 = np.clip(np.floor(c).astype(int), 0, tw - 2), np.clip(np.floor(r).astype(int), 0, th - 2)
        fx, fy = np.clip(c - c0, 0, 1)[None, :], np.clip(r - r0, 0, 1)[:, None]
        R0, C0 = np.meshgrid(r0, c0, indexing='ij')
        v = (t[R0, C0] * (1 - fx) + t[R0, C0 + 1] * fx) * (1 - fy) + (t[R0 + 1, C0] * (1 - fx) + t[R0 + 1, C0 + 1] * fx) * fy
        dsm[np.ix_(ri, ci)] = v
        used.append(os.path.basename(p))
    if np.isnan(dsm).any():
        raise SystemExit(f'DEM tiles do not cover the bbox ({np.isnan(dsm).mean():.1%} missing). Tiles used: {used}')

    rr = a.open_radius
    dtm = filt(filt(dsm, rr, np.minimum), rr, np.maximum)      # opening
    dtm = np.minimum(dtm, dsm)
    k = np.ones(5) / 5
    dtm = np.apply_along_axis(lambda x: np.convolve(np.pad(x, 2, mode='edge'), k, 'valid'), 1, dtm)
    dtm = np.apply_along_axis(lambda x: np.convolve(np.pad(x, 2, mode='edge'), k, 'valid'), 0, dtm)

    os.makedirs(a.out, exist_ok=True)
    lo = float(np.floor(min(dsm.min(), dtm.min())) - 1)
    write_png(os.path.join(a.out, f'{a.name}.png'), encode(dtm, lo))
    write_png(os.path.join(a.out, f'{a.name}-surface.png'), encode(dsm, lo))
    meta = {
        'name': a.name, 'width': n, 'height': n, 'bbox': [W, S, E, N], 'offset': lo, 'scale': 0.01,
        'files': {'terrain': f'{a.name}.png', 'surface': f'{a.name}-surface.png'},
        'source': 'Copernicus DEM GLO-30 (© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA)',
        'tiles': used,
        'method': f'bilinear resample to {n}x{n}; bare-ground estimate = morphological opening (radius {rr} px) + 5x5 mean',
        'pixel_m': [(E - W) * 111320 * np.cos(np.radians((N + S) / 2)) / n, (N - S) * 110574 / n],
        'stats': {'surface_min': float(dsm.min()), 'surface_max': float(dsm.max()),
                  'terrain_min': float(dtm.min()), 'terrain_p05': float(np.percentile(dtm, 5)),
                  'terrain_p50': float(np.percentile(dtm, 50)), 'terrain_max': float(dtm.max())},
    }
    with open(os.path.join(a.out, f'{a.name}.json'), 'w') as f:
        json.dump(meta, f, indent=1)
    print(json.dumps(meta['stats'], indent=1))
    # elevation histogram of the low ground (helps calibrate flood levels)
    h, edges = np.histogram(dtm, bins=np.arange(np.floor(dtm.min()), 30, 1))
    for c, e in zip(h, edges):
        print(f'{e:5.0f} m {c / dtm.size * 100:5.1f}% ' + '#' * int(c / dtm.size * 200))


if __name__ == '__main__':
    main()
