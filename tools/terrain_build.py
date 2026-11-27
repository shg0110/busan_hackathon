"""지형: 공개 지형 타일(AWS Open Data 'Terrain Tiles', Terrarium 형식 z15)로 지도 범위 높이 격자를 만든다.

원자료: https://registry.opendata.aws/terrain-tiles/  (SRTM 등 공개 고도 자료를 합친 타일, 높이 = R*256 + G + B/256 - 32768 m)
타일 주소: https://s3.amazonaws.com/elevation-tiles-prod/terrarium/15/{x}/{y}.png → data/raw/terrain/15_{x}_{y}.png 에 둔다(없으면 받음)
처리
  - web/data/<지역>_map.js meta 의 bbox 를 덮는 z15 타일을 읽어, 지도 미터 좌표 CELL m 격자마다 쌍선형으로 높이를 뽑는다
  - 바다(okpo_map.js water 다각형 안)는 0 으로 고정. 땅은 3×3 평균으로 한 번 부드럽게(타일 계단 줄이기), 0 아래로는 내리지 않는다
  - 단, 땅에 맞닿은 바다 격자점은 음수(직선이 실제 해안선에서 0 을 지나게, 최저 -15m). 그래서 해안선 위치가 맞고 바닷가는 가파른 둑이 된다
결과: web/data/<지역>_terrain.js  window.TERRAIN = { src, cell, x0, z0, nx, nz, scale, h: base64(Int16, 작은 끝, 단위 scale m) }
실행: python3 -I tools/terrain_build.py okpo
"""
import base64, json, math, os, struct, sys, urllib.request, zlib, array

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAME = sys.argv[1] if len(sys.argv) > 1 else 'okpo'
Z, CELL, SCALE = 15, 6.0, 0.1


def read_png(path):
    """8비트 RGB/RGBA 비인터레이스 PNG 만 읽는 최소 디코더(지형 타일용, 외부 꾸러미 없이)."""
    b = open(path, 'rb').read(); assert b[:8] == b'\x89PNG\r\n\x1a\n', path
    i, idat = 8, b''
    while i < len(b):
        n, t = struct.unpack('>I4s', b[i:i + 8]); d = b[i + 8:i + 8 + n]; i += 12 + n
        if t == b'IHDR':
            w, h, depth, ctype, _, _, inter = struct.unpack('>IIBBBBB', d); assert depth == 8 and inter == 0 and ctype in (2, 6)
            ch = 3 if ctype == 2 else 4
        elif t == b'IDAT':
            idat += d
        elif t == b'IEND':
            break
    raw = zlib.decompress(idat); stride = w * ch; prev = bytearray(stride); rows = []
    for y in range(h):
        f = raw[y * (stride + 1)]; line = bytearray(raw[y * (stride + 1) + 1:(y + 1) * (stride + 1)])
        for x in range(stride):
            a = line[x - ch] if x >= ch else 0; up = prev[x]; c = prev[x - ch] if x >= ch else 0
            if f == 1: line[x] = (line[x] + a) & 255
            elif f == 2: line[x] = (line[x] + up) & 255
            elif f == 3: line[x] = (line[x] + (a + up) // 2) & 255
            elif f == 4:
                p = a + up - c; pa, pb, pc = abs(p - a), abs(p - up), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else up if pb <= pc else c)) & 255
        rows.append([line[k * ch] * 256 + line[k * ch + 1] + line[k * ch + 2] / 256 - 32768 for k in range(w)]); prev = line
    return rows


def inpoly(x, z, p):
    c = False
    for i in range(len(p)):
        a, b = p[i], p[i - 1]
        if (a[1] > z) != (b[1] > z) and x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]:
            c = not c
    return c


def main():
    t = open(os.path.join(ROOT, 'web', 'data', f'{NAME}_map.js'), encoding='utf-8').read()
    M = json.loads(t[t.index('{'):t.rindex('}') + 1]); meta = M['meta']; hx, hz = meta['half']; la0, lo0, la1, lo1 = meta['bbox']
    n = 2 ** Z
    tx = lambda lon: (lon + 180) / 360 * n
    ty = lambda lat: (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    raw_dir = os.path.join(ROOT, 'data', 'raw', 'terrain'); os.makedirs(raw_dir, exist_ok=True)
    tiles = {}
    # 쌍선형에 쓰는 화소(가장자리 ±1 화소)를 덮는 타일만
    for X in range(int(tx(lo0) * 256 - 1) // 256, int(tx(lo1) * 256 + 1) // 256 + 1):
        for Y in range(int(ty(la1) * 256 - 1) // 256, int(ty(la0) * 256 + 1) // 256 + 1):
            f = os.path.join(raw_dir, f'{Z}_{X}_{Y}.png')
            if not os.path.exists(f):
                urllib.request.urlretrieve(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{X}/{Y}.png', f)
            tiles[(X, Y)] = read_png(f)

    def H(lat, lon):
        fx, fy = tx(lon) * 256 - 0.5, ty(lat) * 256 - 0.5   # 화소 가운데 기준
        x0, y0 = math.floor(fx), math.floor(fy); dx, dy = fx - x0, fy - y0
        g = lambda px, py: tiles[(px // 256, py // 256)][py % 256][px % 256]
        return g(x0, y0) * (1 - dx) * (1 - dy) + g(x0 + 1, y0) * dx * (1 - dy) + g(x0, y0 + 1) * (1 - dx) * dy + g(x0 + 1, y0 + 1) * dx * dy

    nx, nz = int(math.ceil(2 * hx / CELL)) + 1, int(math.ceil(2 * hz / CELL)) + 1
    x0, z0 = -hx, -hz
    grid, sea = [[0.0] * nx for _ in range(nz)], [[False] * nx for _ in range(nz)]
    water = [w['p'] for w in M['water']]
    for j in range(nz):
        z = z0 + j * CELL; lat = meta['lat0'] - z / meta['kz']
        for i in range(nx):
            x = x0 + i * CELL; lon = meta['lon0'] + x / meta['kx']
            sea[j][i] = any(inpoly(x, z, p) for p in water)
            grid[j][i] = 0.0 if sea[j][i] else max(0.0, H(lat, lon))
    sm = [row[:] for row in grid]   # 땅만 3×3 평균(바다 칸은 평균에 0 으로 들어가 해안이 바다 쪽으로 자연스럽게 내려감)
    for j in range(nz):
        for i in range(nx):
            if sea[j][i]:
                continue
            vs = [grid[jj][ii] for jj in range(max(0, j - 1), min(nz, j + 2)) for ii in range(max(0, i - 1), min(nx, i + 2))]
            sm[j][i] = max(0.0, sum(vs) / len(vs))
    # 해안: 땅에 맞닿은 바다 격자점은 0 대신 음수로 둔다. 그 점과 옆 땅 점을 잇는 직선이 실제 해안선(물 다각형 변, 지도 테두리 변 제외)에서
    # 0 을 지나도록(h_sea = -h_land × 바다 점→해안 거리 / 땅 점→해안 거리, 최저 -15m). 그렇지 않으면 6m 격자의 완만한 경사로가 물 다각형 안쪽까지
    # 땅을 물 위로 올려, 항구 바닷가가 모래 언덕처럼 보이고 해안선이 최대 6m 바다 쪽으로 밀렸다(11-27)
    on_frame = lambda a, b: (abs(abs(a[0]) - hx) < 2 and abs(abs(b[0]) - hx) < 2) or (abs(abs(a[1]) - hz) < 2 and abs(abs(b[1]) - hz) < 2)
    coast = [(p[k - 1], p[k]) for p in water for k in range(len(p)) if not on_frame(p[k - 1], p[k])]
    def cdist(x, z):
        best = 1e9
        for a, b in coast:
            dx, dz = b[0] - a[0], b[1] - a[1]; l2 = dx * dx + dz * dz
            t = max(0.0, min(1.0, ((x - a[0]) * dx + (z - a[1]) * dz) / l2)) if l2 else 0.0
            d = math.hypot(x - a[0] - t * dx, z - a[1] - t * dz)
            if d < best: best = d
        return best
    n_coast, low = 0, 0.0
    for j in range(nz):
        for i in range(nx):
            if not sea[j][i]:
                continue
            nb = [(jj, ii) for jj in range(max(0, j - 1), min(nz, j + 2)) for ii in range(max(0, i - 1), min(nx, i + 2)) if not sea[jj][ii] and sm[jj][ii] > 0.05]
            if not nb:
                continue
            ds = cdist(x0 + i * CELL, z0 + j * CELL); h = 0.0
            for jj, ii in nb:
                dl = max(0.5, cdist(x0 + ii * CELL, z0 + jj * CELL))
                h = min(h, -sm[jj][ii] * ds / dl)
            sm[j][i] = max(-15.0, h); n_coast += 1; low = min(low, sm[j][i])
    print('해안 바다 점', n_coast, '가장 낮게', round(low, 1), 'm')
    a = array.array('h', [max(-32768, min(32767, round(v / SCALE))) for row in sm for v in row])
    if sys.byteorder != 'little':
        a.byteswap()
    out = {'src': 'AWS Open Data Terrain Tiles(Terrarium z15, SRTM 등 공개 고도 자료), 바다는 0', 'cell': CELL, 'x0': x0, 'z0': z0,
           'nx': nx, 'nz': nz, 'scale': SCALE, 'h': base64.b64encode(a.tobytes()).decode()}
    dst = os.path.join(ROOT, 'web', 'data', f'{NAME}_terrain.js')
    with open(dst, 'w', encoding='utf-8') as f:
        f.write('/* 자동 생성: tools/terrain_build.py. 손으로 고치지 말 것 */\nwindow.TERRAIN = '); json.dump(out, f, separators=(',', ':')); f.write(';\n')
    land = [v for j, row in enumerate(sm) for i, v in enumerate(row) if not sea[j][i]]   # 해안 바다 점의 음수는 땅 통계에 넣지 않음
    print(os.path.relpath(dst, ROOT), f'{nx}×{nz} 칸({CELL}m)', '파일', os.path.getsize(dst) // 1024, 'KB', '땅 높이 최소', round(min(land), 1), '최대', round(max(land), 1), '바다 칸', sum(map(sum, sea)))


if __name__ == '__main__':
    main()
