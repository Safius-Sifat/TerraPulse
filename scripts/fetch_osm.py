#!/usr/bin/env python3
"""Fetch OpenStreetMap building footprints for close-up places and write a compact web file.

Data © OpenStreetMap contributors, ODbL 1.0 — the app shows this attribution.

    python3 scripts/fetch_osm.py --site tonle-sap

Output: web/data/osm/<site>.json
  coords are quantised to the slab grid: u,v in [0, 65535] (u west→east, v north→south)
  h = height in metres (tagged, from building:levels, a known-monument table, or a type default)
  hs = height source: 't' tagged, 'l' levels, 'k' known monument (approx.), 'd' default estimate
"""
import argparse
import json
import os
import time
import urllib.parse
import urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'web')
UA = 'TerraPulse-hackathon-dev/0.1 (open-source NISAR visualisation)'

SITES = {
    'tonle-sap': {
        'bbox': [103.70, 13.12, 104.14, 13.56],  # W S E N of the slab
        'places': [
            {'id': 'siemreap', 'name': 'Siem Reap town', 'bbox': [103.835, 13.335, 103.880, 13.385]},
            {'id': 'angkor', 'name': 'Angkor Wat & Angkor Thom', 'bbox': [103.835, 13.395, 103.895, 13.470]},
            {'id': 'phluk', 'name': 'Kampong Phluk stilt village', 'bbox': [103.950, 13.195, 103.995, 13.235]},
            {'id': 'kneas', 'name': 'Chong Kneas & Phnom Krom', 'bbox': [103.795, 13.220, 103.840, 13.305]},
        ],
    }
}

# Approximate heights of well-known monuments (metres above their base). Marked 'k' = approximate.
KNOWN = {
    'angkor wat': 65, 'bayon': 43, 'baphuon': 34, 'ta keo': 22, 'phimeanakas': 12, 'phnom bakheng': 13,
    'thommanon': 10, 'chau say tevoda': 10, 'ta prohm': 12, 'banteay kdei': 10, 'preah khan': 12,
}
DEFAULTS = {'temple': 12, 'church': 12, 'monastery': 10, 'pagoda': 14, 'apartments': 12, 'hotel': 12, 'commercial': 8, 'retail': 7,
            'school': 7, 'hospital': 9, 'warehouse': 7, 'industrial': 7, 'roof': 3.5, 'shed': 3, 'hut': 3, 'ruins': 6, 'house': 6,
            'residential': 6, 'detached': 6, 'yes': 6}


def overpass(query):
    url = 'https://overpass-api.de/api/interpreter?data=' + urllib.parse.quote(query)
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=240) as r:
                return json.load(r)
        except Exception as e:  # rate limits / timeouts: back off and retry
            print(f'  overpass retry {attempt + 1}: {e}'); time.sleep(10 * (attempt + 1))
    raise SystemExit('Overpass failed repeatedly')


def height(tags):
    for k in ('height', 'building:height'):
        if k in tags:
            try: return float(tags[k].replace('m', '').strip()), 't'
            except ValueError: pass
    if 'building:levels' in tags:
        try: return max(1.0, float(tags['building:levels'])) * 3.2 + 1, 'l'
        except ValueError: pass
    name = (tags.get('name:en') or tags.get('name') or '').lower()
    monument = tags.get('historic') or tags.get('building') in ('temple', 'ruins') or tags.get('amenity') == 'place_of_worship'
    if monument and not any(w in name for w in ('hotel', 'resort', 'villa', 'guest', 'restaurant')):
        for k, h in KNOWN.items():
            if k in name: return h, 'k'
    b = tags.get('building', 'yes')
    if tags.get('amenity') == 'place_of_worship' and b == 'yes': b = 'temple'
    return DEFAULTS.get(b, 6), 'd'


def kind(tags):
    b = tags.get('building', 'yes')
    if b in ('temple', 'church', 'monastery', 'pagoda') or tags.get('amenity') == 'place_of_worship' or tags.get('historic'):
        return 'sacred'
    if b in ('roof', 'shed', 'hut'): return 'light'
    if b in ('commercial', 'retail', 'hotel', 'apartments', 'school', 'hospital', 'warehouse', 'industrial'): return 'large'
    return 'home'


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--site', default='tonle-sap'); a = ap.parse_args()
    cfg = SITES[a.site]; W, S, E, N = cfg['bbox']
    q = lambda lon, lat: [round((lon - W) / (E - W) * 65535), round((N - lat) / (N - S) * 65535)]
    out = {'site': a.site, 'bbox': cfg['bbox'], 'attribution': '© OpenStreetMap contributors (ODbL)', 'places': [], 'buildings': []}
    seen = set()
    for p in cfg['places']:
        w, s, e, n = p['bbox']
        print(f'{p["name"]} …')
        d = overpass(f'[out:json][timeout:200];(way["building"]({s},{w},{n},{e});way["historic"]["building"]({s},{w},{n},{e}););out tags geom;')
        cnt = 0; heights = {'t': 0, 'l': 0, 'k': 0, 'd': 0}
        for el in d.get('elements', []):
            if el['id'] in seen or 'geometry' not in el or len(el['geometry']) < 4: continue
            seen.add(el['id'])
            t = el.get('tags', {})
            h, hs = height(t); heights[hs] += 1
            pts = [c for g in el['geometry'][:-1] for c in q(g['lon'], g['lat'])]
            b = {'p': pts, 'h': round(h, 1), 'hs': hs, 'k': kind(t)}
            nm = t.get('name:en') or t.get('name')
            if nm and (b['k'] == 'sacred' or hs == 'k'): b['n'] = nm
            out['buildings'].append(b); cnt += 1
        p2 = dict(p); p2['count'] = cnt; out['places'].append(p2)
        print(f'  {cnt} buildings · heights: {heights["t"]} tagged, {heights["l"]} from levels, {heights["k"]} known monuments, {heights["d"]} estimated')
        time.sleep(3)
    os.makedirs(os.path.join(ROOT, 'data', 'osm'), exist_ok=True)
    path = os.path.join(ROOT, 'data', 'osm', f'{a.site}.json')
    json.dump(out, open(path, 'w'), separators=(',', ':'))
    print(f'Done -> {path} ({os.path.getsize(path) // 1024} KB, {len(out["buildings"])} buildings)')


if __name__ == '__main__':
    main()
