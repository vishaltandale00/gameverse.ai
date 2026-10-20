#!/usr/bin/env python3
"""anchormap: derive graft-readiness anchors for a GBA ROM by scripted
memory-diff probing.

It drives tools/re/anchormap/build/anchormap (a tiny libmgba worker) through a
small set of input segments, snapshots IWRAM/EWRAM/OAM around each step, then
does all the analysis here with the Python stdlib. Nothing in this file teaches
the worker anything game-specific.

Anchors produced per game:
  input_shadow   bytes in IWRAM/EWRAM that track REG_KEYINPUT
  oam_mirror     RAM window whose 8-byte OAM entries follow live OAM
  entity_array   base+stride+field offsets of position-like structs
  main_loop      ROM entry point (static) and live IRQ vector (0x03007FFC)
  free_space     zero/FF runs in the ROM image and never-touched EWRAM

Usage:
  python3 anchorhunt.py collect --rom GAME.gba --out DIR [--base-state S.ss]
  python3 anchorhunt.py analyze --out DIR [--rom GAME.gba]
  python3 anchorhunt.py run     --rom GAME.gba --out DIR [--base-state S.ss]
"""
from __future__ import annotations

import argparse
import json
import struct
import subprocess
import sys
import time
from pathlib import Path

KEYS = {'A': 1, 'B': 2, 'SELECT': 4, 'START': 8, 'RIGHT': 16, 'LEFT': 32,
        'UP': 64, 'DOWN': 128, 'R': 256, 'L': 512}
IWRAM = (0x03000000, 0x8000)
EWRAM = (0x02000000, 0x40000)
OAM = (0x07000000, 0x400)
IRQ_VECTOR = 0x03007FFC

# Edit this list to explore a different game; nothing here is game-specific
# except the very short key holds used to excite a single input bit.
SEGMENTS = [
    {'name': 'idle',        'phases': [(0, 12)],                 'stride': 1},
    {'name': 'key_right',   'phases': [(KEYS['RIGHT'], 6)],      'stride': 1},
    {'name': 'key_left',    'phases': [(KEYS['LEFT'], 6)],       'stride': 1},
    {'name': 'key_up',      'phases': [(KEYS['UP'], 6)],         'stride': 1},
    {'name': 'key_down',    'phases': [(KEYS['DOWN'], 6)],       'stride': 1},
    {'name': 'key_a',       'phases': [(KEYS['A'], 6)],          'stride': 1},
    {'name': 'key_b',       'phases': [(KEYS['B'], 6)],          'stride': 1},
    {'name': 'move_right',  'phases': [(KEYS['RIGHT'], 80)],     'stride': 4},
    {'name': 'move_left',   'phases': [(KEYS['LEFT'], 80)],      'stride': 4},
    {'name': 'action_jump', 'phases': [(KEYS['A'], 40)],         'stride': 2},
]
# Sampled-animation segments only; needs a savestate that reaches gameplay.
BOOT_SEGMENT = {'name': 'boot', 'phases': [(KEYS['START'], 4), (0, 26)] * 20, 'stride': 30}


def run_worker(binary, rom, out):
    proc = subprocess.Popen([str(binary), str(rom), str(out)],
                            stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, bufsize=0)

    class W:
        def __init__(self):
            self.p = proc
            self._read()

        def _read(self):
            line = self.p.stdout.readline()
            if not line.startswith(b'OK'):
                raise RuntimeError('native failed: %r' % line)
            return line[3:].decode().strip()

        def cmd(self, text):
            self.p.stdin.write((text + '\n').encode())
            self.p.stdin.flush()
            return self._read()

        def step(self, keys, frames):
            return int(self.cmd('step %d %d' % (keys, frames)).split()[0])

        def snap(self, addr, length, name):
            self.cmd('snap %d %d %s' % (addr, length, name))

        def shot(self, name):
            self.cmd('shot %s' % name)

        def read32(self, addr):
            return int(self.cmd('read32 0x%x' % addr), 16)

        def read(self, addr, length):
            return bytes.fromhex(self.cmd('read %d %d' % (addr, length)))

        def load(self, path):
            self.cmd('load %s' % path)

        def reset(self):
            self.cmd('reset')

        def blocks(self):
            out = {}
            for entry in self.cmd('blocks').split(';'):
                name, start, size, flags = entry.rsplit(',', 3)
                out[name] = {'start': int(start, 16), 'size': int(size, 16), 'flags': int(flags, 16)}
            return out

        def close(self):
            try:
                self.cmd('close')
            except Exception:
                self.p.kill()

    return W()


def collect(args):
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    snapdir = out / 'snaps'
    snapdir.mkdir(exist_ok=True)
    sh = out / 'shots'
    sh.mkdir(exist_ok=True)
    w = run_worker(args.binary, args.rom, out)
    t0 = time.monotonic()
    meta = {'schema': 'gameverse.anchormap.collection/1', 'rom': str(Path(args.rom).resolve()),
            'blocks': w.blocks(), 'segments': [], 'frames_run': 0}

    def take(seg_name, idx, frame, keys, iwram=True, ewram=False, oam=True, shot=False):
        tag = '%s_%03d' % (seg_name, idx)
        rec = {'segment': seg_name, 'idx': idx, 'frame': frame, 'keys': keys}
        if iwram:
            w.snap(0x03000000, 0x8000, 'snaps/%s_iw' % tag)
            rec['iwram'] = 'snaps/%s_iw.bin' % tag
        if ewram:
            w.snap(0x02000000, 0x40000, 'snaps/%s_ew' % tag)
            rec['ewram'] = 'snaps/%s_ew.bin' % tag
        if oam:
            w.snap(0x07000000, 0x400, 'snaps/%s_oam' % tag)
            rec['oam'] = 'snaps/%s_oam.bin' % tag
        if shot:
            w.shot('shots/%s' % tag)
            rec['shot'] = 'shots/%s.rgba' % tag
        return rec

    # Boot segment (from reset) always runs first, without a base state.
    for seg in [BOOT_SEGMENT] + SEGMENTS:
        base = None
        if seg is not BOOT_SEGMENT:
            base = args.base_state
            if not base:
                continue  # in-game segments need a savestate
            w.load(base)
        recs = []
        frame = 0
        idx = 0
        ewram_every = 60 if seg['name'] == 'boot' else 8
        for keys, frames in seg['phases']:
            for i in range(frames):
                w.step(keys, 1)
                frame += 1
                take_ew = frame % ewram_every == 0
                sample = (frame % seg['stride'] == 0) or (i == frames - 1)
                if sample:
                    shot = (i == frames - 1) or (frame % 20 == 0 and seg['name'].startswith('move'))\
                        or seg['name'] == 'boot'
                    recs.append(take(seg['name'], idx, frame, keys, ewram=take_ew, shot=shot))
                    idx += 1
        meta['segments'].append({'name': seg['name'], 'phases': seg['phases'],
                                 'stride': seg['stride'], 'samples': recs})
        meta['frames_run'] += frame
    meta['irq_vector'] = w.read32(IRQ_VECTOR)
    if 0x03000000 <= meta['irq_vector'] < 0x03008000:
        meta['irq_stub_hex'] = w.read(meta['irq_vector'], 16).hex()
    meta['collect_seconds'] = round(time.monotonic() - t0, 3)
    w.close()
    (out / 'collection.json').write_text(json.dumps(meta, indent=2))
    return meta


# ----- analysis helpers ------------------------------------------------------

def load_bytes(out, rel):
    return (out / rel).read_bytes()


def u16(buf, addr):
    return buf[addr] | (buf[addr + 1] << 8)


def bytes_series(seg, out, kind):
    """Yield (frame, keys, bytes) for samples that carry this memory kind."""
    for s in seg['samples']:
        if kind in s:
            yield s['frame'], s['keys'], load_bytes(out, s[kind])


def find_key_shadow(out, meta):
    """Addresses whose value XOR idle-baseline equals a single held key mask.

    The idle segment supplies a stable baseline (keys==0). For each single-key
    segment we look for a 16-bit word whose XOR against the baseline equals the
    key mask in any sample. A real input shadow -- whether it stores the raw
    active-low register, its complement, or a pressed-bit mask -- satisfies this
    for *every* key, which random moving bytes do not.
    """
    segs = {s['name']: s for s in meta['segments']}
    idle = segs.get('idle')
    if not idle:
        return []
    base_iw = load_bytes(out, idle['samples'][-1]['iwram'])
    scores = {}
    for seg in [s for s in meta['segments'] if s['name'].startswith('key_')]:
        mask = seg['phases'][0][0]
        last_frame = seg['phases'][0][1]
        for frame, _keys, iw in bytes_series(seg, out, 'iwram'):
            for a in range(0, len(base_iw) - 1, 2):
                d = (u16(iw, a) ^ u16(base_iw, a)) & 0xFFFF
                if d == mask:
                    e = scores.setdefault(a, {'addr': 0x03000000 + a, 'keys': set(), 'held': set()})
                    e['keys'].add(seg['name'])
                    if frame == last_frame:
                        e['held'].add(seg['name'])
    ranked = [{'space': 'IWRAM', 'address': '0x%08x' % e['addr'],
               'distinct_keys': len(e['keys']), 'keys': sorted(e['keys']),
               'held_at_segment_end': len(e['held'])}
              for e in scores.values() if len(e['keys']) >= 3]
    ranked.sort(key=lambda r: (-r['distinct_keys'], -r['held_at_segment_end']))
    return ranked[:16]


def match_oam(mem, oam):
    """Count 8-byte OAM entries that equal the live OAM entry at the same slot."""
    best = (0, -1)
    if len(mem) < len(oam):
        return best
    entries = [oam[i:i + 8] for i in range(0, len(oam), 8)]
    for base in range(0, len(mem) - len(oam) + 1, 2):
        cnt = 0
        for k, ent in enumerate(entries):
            if mem[base + 8 * k:base + 8 * k + 8] == ent:
                cnt += 1
        if cnt > best[0]:
            best = (cnt, base)
    return best


def find_oam_mirror(out, meta):
    segs = [s for s in meta['segments'] if s['name'].startswith('move')]
    hits = {}
    for seg in segs:
        samples = [s for s in seg['samples'] if 'oam' in s and 'iwram' in s]
        for s in samples[-3:]:
            oam = load_bytes(out, s['oam'])
            iw = load_bytes(out, s['iwram'])
            cnt, base = match_oam(iw, oam)
            hits.setdefault(0x03000000 + base, []).append(cnt)
    ranked = []
    for addr, counts in sorted(hits.items(), key=lambda kv: -max(kv[1])):
        ranked.append({'space': 'IWRAM', 'address': '0x%08x' % addr,
                       'oam_entries_matched': max(counts), 'of_entries': 128})
    return ranked[:6]


def movers_in(series):
    """16-bit addresses whose value changed monotonically over >=3 deltas."""
    addrs = {}
    first = series[0][2]
    for a in range(0, len(first) - 1, 2):
        vals = [u16(buf, a) for _, _, buf in series]
        deltas = [vals[i + 1] - vals[i] for i in range(len(vals) - 1)]
        nz = [d for d in deltas if d != 0]
        if len(nz) >= 3 and (all(d > 0 for d in nz) or all(d < 0 for d in nz)):
            addrs[a] = (sum(1 for d in deltas if d != 0), deltas)
    return addrs


def signature_groups(addrs_deltas, min_group=2):
    """Group moving fields whose per-sample delta signature is identical.

    Fields at the same struct offset in different array entries move in
    lockstep (same velocity sequence), so identical signatures + a constant
    address spacing identify an array even when only one field per entry moves.
    """
    by_sig = {}
    for a, (_n, deltas) in addrs_deltas.items():
        by_sig.setdefault(tuple(deltas), []).append(a)
    groups = []
    for sig, members in by_sig.items():
        if len(members) < min_group:
            continue
        members = sorted(members)
        diffs = [members[i + 1] - members[i] for i in range(len(members) - 1)]
        # Keep only the members forming a regular arithmetic progression.
        if diffs:
            from collections import Counter
            stride, _ = Counter(diffs).most_common(1)[0]
            if stride <= 0:
                continue
            chain = [members[0]]
            for m in members[1:]:
                if m - chain[-1] == stride:
                    chain.append(m)
            if len(chain) >= min_group:
                groups.append({'stride': stride, 'first_field': 0x03000000 + chain[0],
                               'entries': len(chain), 'max_addr': '0x%08x' % (0x03000000 + chain[-1]),
                               'sign': 'positive' if sig[0] > 0 else 'negative'})
    groups.sort(key=lambda g: -g['entries'])
    return groups


def _sign(n):
    return (n > 0) - (n < 0)


def _cluster(addrs, tol=2):
    """Merge addresses within `tol` bytes (adjacent 16-bit windows of one field)."""
    out = []
    for a in sorted(addrs):
        if out and a - out[-1] <= tol:
            continue
        out.append(a)
    return out


def _series(out, seg, kind='iwram'):
    return list(bytes_series(seg, out, kind))


def _stats(series):
    """Per 16-bit address: (nonzero-delta count, net displacement, deltas)."""
    out = {}
    first = series[0][2]
    for a in range(0, len(first) - 1, 2):
        vals = [u16(b, a) for _, _, b in series]
        deltas = [vals[i + 1] - vals[i] for i in range(len(vals) - 1)]
        nz = [d for d in deltas if d != 0]
        out[a] = {'nz': len(nz), 'net': vals[-1] - vals[0], 'deltas': deltas,
                  'path': sum(abs(d) for d in deltas),
                  'sign_consistent': bool(nz) and (all(d > 0 for d in nz) or all(d < 0 for d in nz)),
                  'max_step': max(abs(d) for d in deltas) if deltas else 0}
    return out


def find_position_fields(out, meta):
    """Ordered position-like fields revealed by opposite-direction movement.

    A field is accepted when, under held RIGHT and held LEFT from the same
    state, it moves monotonically in *opposite* net directions, its per-sample
    steps stay small (a position, not a timer/pointer), and it is quiet while
    idle. This rejects frame counters, animation timers and RNG.
    """
    segs = {s['name']: s for s in meta['segments']}
    if not all(n in segs for n in ('idle', 'move_right', 'move_left')):
        return []
    sr, sl, si = (_stats(_series(out, segs[n])) for n in ('move_right', 'move_left', 'idle'))
    fields = []
    for a, r in sr.items():
        l = sl.get(a)
        if not l or a >= 0x7F00:                      # skip the IWRAM/BIOS stack area
            continue
        if r['nz'] < 3 or l['nz'] < 3 or _sign(r['net']) == _sign(l['net']):
            continue
        if abs(r['net']) < 8 or abs(l['net']) < 8 or r['max_step'] > 0x400 or l['max_step'] > 0x400:
            continue
        if abs(r['net']) < 0.5 * r['path'] or abs(l['net']) < 0.5 * l['path']:
            continue                                  # net must dominate the path
        if si.get(a, {}).get('max_step', 0) > 4:      # must be quiet while idle
            continue
        fields.append({'address': 0x03000000 + a, 'net_right': r['net'], 'net_left': l['net'],
                       'step_right': [d for d in r['deltas'] if d][:6]})
    fields.sort(key=lambda f: f['address'])
    deduped = []
    for f in fields:
        if deduped and f['address'] - deduped[-1]['address'] <= 2:
            continue
        deduped.append(f)
    # Coherent clusters: fields whose right-move delta sequence is identical.
    clusters = {}
    for f in deduped:
        clusters.setdefault(tuple(f['step_right']), []).append(f['address'])
    coherent = [{'addresses': ['0x%08x' % a for a in sorted(v)], 'size': len(v)}
                for v in clusters.values() if len(v) >= 2]
    return {'fields': [dict(f, address='0x%08x' % f['address']) for f in deduped],
            'coherent_clusters': sorted(coherent, key=lambda c: -c['size'])}


def find_entity_arrays(out, meta):
    """Backwards-compatible entry point: report position fields plus a stride hint."""
    return find_position_fields(out, meta)


def decode_entry_point(rom_bytes):
    w = struct.unpack_from('<I', rom_bytes, 0)[0]
    info = {'raw': '0x%08x' % w}
    if (w >> 24) == 0xEA:  # ARM B
        imm = w & 0xFFFFFF
        if imm & 0x800000:
            imm -= 1 << 24
        info['entry_point'] = '0x%08x' % (0x08000000 + 8 + imm * 4)
    return info


def scan_free_runs(buf, addr_base, value, min_len, cap=40):
    runs = []
    i = 0
    n = len(buf)
    while i < n:
        if buf[i] == value:
            j = i
            while j < n and buf[j] == value:
                j += 1
            if j - i >= min_len:
                runs.append({'start': '0x%08x' % (addr_base + i), 'length': j - i})
            i = j
        else:
            i += 1
    runs.sort(key=lambda r: -r['length'])
    return runs[:cap], sum(r['length'] for r in runs)


def scan_rom_free(rom_bytes):
    out = {}
    for name, val in (('zeros', 0x00), ('ones', 0xFF)):
        runs, total = scan_free_runs(rom_bytes, 0x08000000, val, 1024)
        out[name] = {'total_bytes_in_top_runs': total, 'runs': runs}
    return out


def scan_ewram_untouched(out, meta):
    """EWRAM bytes that never changed across every collected sample."""
    changed = None
    for seg in meta['segments']:
        prev = None
        for s in seg['samples']:
            if 'ewram' not in s:
                continue
            buf = load_bytes(out, s['ewram'])
            if changed is None:
                changed = bytearray(len(buf))
            if prev is not None:
                for i in range(len(buf)):
                    if buf[i] != prev[i]:
                        changed[i] = 1
            prev = buf
    if changed is None:
        return None
    untouched = bytes(1 if c == 0 else 0 for c in changed)
    runs, total = scan_free_runs(untouched, 0x02000000, 1, 512)
    return {'untouched_bytes_top_runs': total, 'runs': runs}


def analyze(args):
    out = Path(args.out).resolve()
    meta = json.loads((out / 'collection.json').read_text())
    rom_path = Path(args.rom).resolve() if args.rom else Path(meta['rom'])
    rom_bytes = rom_path.read_bytes()
    t0 = time.monotonic()
    report = {
        'schema': 'gameverse.anchormap.profile/1',
        'rom_sha256': __import__('hashlib').sha256(rom_bytes).hexdigest(),
        'rom_bytes': len(rom_bytes),
        'main_loop': {
            'rom_entry': decode_entry_point(rom_bytes),
            'irq_vector_0x03007ffc': '0x%08x' % meta.get('irq_vector', 0),
            'irq_stub_hex': meta.get('irq_stub_hex'),
        },
        'input_shadow_candidates': find_key_shadow(out, meta),
        'oam_mirror_candidates': find_oam_mirror(out, meta),
        'position_fields': find_position_fields(out, meta),
        'free_space': {
            'rom': scan_rom_free(rom_bytes),
            'ewram_untouched': scan_ewram_untouched(out, meta),
        },
        'frames_run': meta['frames_run'],
        'analyze_seconds': round(time.monotonic() - t0, 3),
    }
    (out / 'profile.json').write_text(json.dumps(report, indent=2))
    return report


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('command', choices=['collect', 'analyze', 'run'])
    ap.add_argument('--rom', type=Path)
    ap.add_argument('--out', type=Path, required=True)
    ap.add_argument('--base-state', type=Path)
    ap.add_argument('--binary', type=Path,
                    default=Path(__file__).parent / 'build' / 'anchormap')
    args = ap.parse_args()
    cmd = args.command
    if cmd in ('collect', 'run'):
        meta = collect(args)
        print('collected %d frames in %ss' % (meta['frames_run'], meta['collect_seconds']))
    if cmd == 'collect':
        return
    report = analyze(args)
    json.dump({k: report[k] for k in ('input_shadow_candidates', 'oam_mirror_candidates',
                                      'position_fields')}, sys.stdout, indent=2)


if __name__ == '__main__':
    main()
