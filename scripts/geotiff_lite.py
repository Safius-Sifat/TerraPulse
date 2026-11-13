"""Minimal pure-stdlib GeoTIFF reader (classic + BigTIFF, strips/tiles, LZW/Deflate,
predictors 1/2/3). Enough for NISAR GCOV subsets and Copernicus DEM tiles."""
import array
import struct
import zlib

_TYPES = {1: ('B', 1), 2: ('s', 1), 3: ('H', 2), 4: ('I', 4), 5: ('II', 8), 6: ('b', 1), 8: ('h', 2),
          9: ('i', 4), 11: ('f', 4), 12: ('d', 8), 16: ('Q', 8)}
_NAMES = {256: 'width', 257: 'height', 258: 'bps', 259: 'compression', 277: 'spp', 284: 'planar',
          317: 'predictor', 322: 'tilew', 323: 'tileh', 324: 'tileoff', 325: 'tilebytes', 273: 'stripoff',
          279: 'stripbytes', 278: 'rps', 339: 'sampleformat', 33550: 'pixscale', 33922: 'tiepoint',
          34735: 'geokeys', 34737: 'geoascii', 42112: 'gdal_meta', 42113: 'gdal_nodata'}


def _read_ifd(f, off, end, big):
    f.seek(off)
    n = struct.unpack(end + ('Q' if big else 'H'), f.read(8 if big else 2))[0]
    esz = 20 if big else 12
    raw = f.read(n * esz)
    tags = {}
    for i in range(n):
        e = raw[i * esz:(i + 1) * esz]
        if big:
            tag, typ, cnt = struct.unpack(end + 'HHQ', e[:12]); valraw = e[12:]
        else:
            tag, typ, cnt = struct.unpack(end + 'HHI', e[:8]); valraw = e[8:]
        fmt, sz = _TYPES.get(typ, ('B', 1))
        total = sz * cnt
        if total <= len(valraw):
            data = valraw[:total]
        else:
            p = struct.unpack(end + ('Q' if big else 'I'), valraw)[0]
            cur = f.tell(); f.seek(p); data = f.read(total); f.seek(cur)
        if typ == 2:
            val = data.rstrip(b'\0').decode('latin1')
        elif typ == 5:
            v = struct.unpack(end + 'I' * (2 * cnt), data); val = [v[i] / v[i + 1] for i in range(0, len(v), 2)]
        else:
            val = list(struct.unpack(end + fmt * cnt, data))
        tags[_NAMES.get(tag, tag)] = val
    return tags


def _lzw_decode(data):
    out = bytearray(); table = [bytes([i]) for i in range(256)] + [b'', b'']
    width = 9; prev = None; buf = 0; bits = 0; pos = 0; L = len(data)
    while True:
        while bits < width and pos < L:
            buf = (buf << 8) | data[pos]; pos += 1; bits += 8
        if bits < width:
            break
        bits -= width; code = (buf >> bits) & ((1 << width) - 1); buf &= (1 << bits) - 1
        if code == 256:
            del table[258:]; width = 9; prev = None; continue
        if code == 257:
            break
        if prev is None:
            entry = table[code]
        elif code < len(table):
            entry = table[code]; table.append(prev + entry[:1])
        else:
            entry = prev + prev[:1]; table.append(entry)
        out += entry; prev = entry
        n = len(table) + 1
        if n >= 512 and width == 9: width = 10
        elif n >= 1024 and width == 10: width = 11
        elif n >= 2048 and width == 11: width = 12
    return bytes(out)


class GeoTiff:
    def __init__(self, path):
        self.path = path
        f = self._f = open(path, 'rb')
        hdr = f.read(16)
        self.end = '<' if hdr[:2] == b'II' else '>'
        big = struct.unpack(self.end + 'H', hdr[2:4])[0] == 43
        off = struct.unpack(self.end + 'Q', hdr[8:16])[0] if big else struct.unpack(self.end + 'I', hdr[4:8])[0]
        self.tags = t = _read_ifd(f, off, self.end, big)
        self.width, self.height = t['width'][0], t['height'][0]
        self.pixscale = t.get('pixscale')
        self.tiepoint = t.get('tiepoint')
        self.crs_text = t.get('geoascii', '')
        geokeys = t.get('geokeys', [])
        self.epsg = None
        for i in range(4, len(geokeys), 4):
            if geokeys[i] in (3072, 2048) and geokeys[i + 1] == 0:
                self.epsg = geokeys[i + 3]
        nd = t.get('gdal_nodata')
        self.nodata = float(nd) if nd not in (None, '') else None

    @property
    def origin(self):
        """Top-left corner (x, y) of pixel (0, 0) in CRS units."""
        return self.tiepoint[3] - self.tiepoint[0] * self.pixscale[0], self.tiepoint[4] + self.tiepoint[1] * self.pixscale[1]

    def read(self):
        """Return a flat array.array of the first band (row-major)."""
        t, f, end = self.tags, self._f, self.end
        w, h = self.width, self.height
        bps = t['bps'][0]; sf = t.get('sampleformat', [1])[0]; comp = t.get('compression', [1])[0]
        pred = t.get('predictor', [1])[0]; spp = t.get('spp', [1])[0]
        if spp != 1 and t.get('planar', [1])[0] == 1:
            raise ValueError(f'{self.path}: interleaved multi-band files are not supported')
        code = {(32, 3): 'f', (64, 3): 'd', (8, 1): 'B', (16, 1): 'H', (32, 1): 'I', (16, 2): 'h', (32, 2): 'i'}[(bps, sf)]
        out = array.array(code, bytes(w * h * bps // 8))
        if 'tilew' in t:
            tw, th = t['tilew'][0], t['tileh'][0]; offs, cnts = t['tileoff'], t['tilebytes']
            tx = (w + tw - 1) // tw; ty = (h + th - 1) // th
            blocks = [((i % tx) * tw, (i // tx) * th, tw, th) for i in range(tx * ty)]
        else:
            rps = t.get('rps', [h])[0]; offs, cnts = t['stripoff'], t['stripbytes']
            nstrip = (h + rps - 1) // rps
            blocks = [(0, i * rps, w, min(rps, h - i * rps)) for i in range(nstrip)]
        bpp = bps // 8
        for (x0, y0, bw, bh), o, c in zip(blocks, offs, cnts):
            f.seek(o); d = f.read(c)
            if comp in (8, 32946): d = zlib.decompress(d)
            elif comp == 5: d = _lzw_decode(d)
            elif comp != 1: raise ValueError(f'compression {comp} unsupported')
            if pred == 3:
                nd = bytearray(d); rowlen = bw * bpp
                for r in range(bh):
                    s = r * rowlen
                    for i in range(1, rowlen): nd[s + i] = (nd[s + i] + nd[s + i - 1]) & 0xFF
                    row = bytes(nd[s:s + rowlen])
                    order = range(bpp - 1, -1, -1) if end == '<' else range(bpp)
                    nd[s:s + rowlen] = bytes(row[j * bw + i] for i in range(bw) for j in order)
                d = bytes(nd)
            blk = array.array(code); blk.frombytes(d[:bw * bh * bpp])
            if (end == '>') != (struct.pack('=H', 1) == b'\x00\x01'):
                blk.byteswap()
            if pred == 2:
                for r in range(bh):
                    for i in range(1, bw): blk[r * bw + i] += blk[r * bw + i - 1]
            for r in range(bh):
                y = y0 + r
                if y >= h: break
                n = min(bw, w - x0)
                out[y * w + x0:y * w + x0 + n] = blk[r * bw:r * bw + n]
        return out
