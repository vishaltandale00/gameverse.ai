"""Convert 240x160 RGBA raw frames to PNG using only the stdlib."""
import struct
import sys
import zlib
from pathlib import Path


def png(rgba):
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    rows = b''.join(b'\0' + rgba[y * 960:(y + 1) * 960] for y in range(160))
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 240, 160, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b''))


def main():
    for path in sys.argv[1:]:
        src = Path(path)
        out = src.with_suffix('.png')
        raw = src.read_bytes()
        if len(raw) != 240 * 160 * 4:
            raise SystemExit('%s: unexpected size %d' % (src, len(raw)))
        out.write_bytes(png(raw))
        print(out)


if __name__ == '__main__':
    main()
