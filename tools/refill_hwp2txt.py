"""HWP 5.x 파일에서 본문 글자만 뽑는다(표 칸은 한 줄씩). LibreOffice가 HWP 5.x를 못 읽어서 직접 만든 것.
실행: pip install olefile  →  python3 -I tools/refill_hwp2txt.py <파일.hwp>
"""
import struct, sys, zlib
import olefile


def text(path):
    ole = olefile.OleFileIO(path)
    compressed = ole.openstream('FileHeader').read()[36] & 1
    out = []
    secs = sorted([e for e in ole.listdir() if e[0] == 'BodyText'], key=lambda e: int(e[1][7:]))
    for e in secs:
        data = ole.openstream(e).read()
        if compressed:
            data = zlib.decompress(data, -15)
        i = 0
        while i < len(data):
            h = struct.unpack_from('<I', data, i)[0]; i += 4
            tag, size = h & 0x3ff, (h >> 20) & 0xfff
            if size == 0xfff:
                size = struct.unpack_from('<I', data, i)[0]; i += 4
            if tag == 67:  # HWPTAG_PARA_TEXT
                b = data[i:i + size]; s = []; j = 0
                while j < len(b):
                    c = struct.unpack_from('<H', b, j)[0]
                    if c < 32 and c not in (10, 13, 24, 25, 26, 27, 28, 29, 30, 31):
                        j += 16; continue  # 확장·인라인 제어 문자(8글자 크기)
                    if c in (10, 13):
                        s.append('\n')
                    elif c >= 32:
                        s.append(chr(c))
                    j += 2
                out.append(''.join(s).rstrip('\n'))
            i += size
    return '\n'.join(out)


if __name__ == '__main__':
    print(text(sys.argv[1]))
