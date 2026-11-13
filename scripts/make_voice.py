#!/usr/bin/env python3
"""Generate narration audio with OpenAI text-to-speech.

Reads web/data/narration/<site>.json and writes web/audio/<site>/<key>-<n>.mp3 plus index.json.
Your key is read from the OPENAI_API_KEY environment variable and is never written to disk.

    export OPENAI_API_KEY=sk-...        # fish: set -x OPENAI_API_KEY sk-...
    python3 scripts/make_voice.py --site tonle-sap

Re-running only regenerates lines whose text or voice settings changed (use --force to redo all).
"""
import argparse
import hashlib
import json
import os
import sys
import urllib.error
import urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'web')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--site', default='tonle-sap')
    ap.add_argument('--force', action='store_true')
    ap.add_argument('--voice', help='override voice (e.g. onyx, ash, ballad, echo)')
    a = ap.parse_args()
    key = os.environ.get('OPENAI_API_KEY')
    if not key:
        sys.exit('Set OPENAI_API_KEY in your environment first.')
    spec = json.load(open(os.path.join(ROOT, 'data', 'narration', f'{a.site}.json')))
    v = dict(spec['voice'])
    if a.voice: v['voice'] = a.voice
    out_dir = os.path.join(ROOT, 'audio', a.site); os.makedirs(out_dir, exist_ok=True)
    idx_path = os.path.join(out_dir, 'index.json')
    old = json.load(open(idx_path)) if os.path.exists(idx_path) else {'files': {}, 'hashes': {}}
    files, hashes = {}, {}
    for k, lines in spec['lines'].items():
        files[k] = []
        for i, text in enumerate(lines):
            name = f'{k}-{i}.mp3'
            h = hashlib.sha1(json.dumps([text, v], sort_keys=True).encode()).hexdigest()[:12]
            path = os.path.join(out_dir, name)
            if not a.force and old.get('hashes', {}).get(name) == h and os.path.exists(path):
                print(f'  keep {name}')
            else:
                body = json.dumps({'model': v['model'], 'voice': v['voice'], 'input': text,
                                   'instructions': v.get('instructions', ''), 'response_format': 'mp3'}).encode()
                req = urllib.request.Request('https://api.openai.com/v1/audio/speech', data=body, method='POST',
                                             headers={'Authorization': f'Bearer {key}', 'Content-Type': 'application/json'})
                try:
                    with urllib.request.urlopen(req, timeout=120) as r, open(path, 'wb') as f:
                        f.write(r.read())
                except urllib.error.HTTPError as e:
                    sys.exit(f'OpenAI error {e.code} on {name}: {e.read().decode()[:400]}')
                print(f'  made {name}  ({os.path.getsize(path) // 1024} KB)  "{text[:60]}…"')
            files[k].append(name); hashes[name] = h
    json.dump({'voice': v['voice'], 'model': v['model'], 'files': files, 'hashes': hashes}, open(idx_path, 'w'), indent=1)
    print(f'Done -> {out_dir}')


if __name__ == '__main__':
    main()
