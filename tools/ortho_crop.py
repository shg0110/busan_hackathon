"""국토지리정보원 정사영상(GeoTIFF, 한국 TM 좌표)을 옥포 지도 범위로 잘라 바닥 사진(web/data/okpo_ortho.jpg)을 만든다.

범위(세션 31 지형 면과 같음): 지도 미터 x -935.9 ~ 936.1, z -939.9 ~ 944.1. 그림 위쪽이 북쪽(z 작은 쪽), 왼쪽이 서쪽.
지도 미터 ↔ 위경도: lat = lat0 − z/kz, lon = lon0 + x/kx (web/data/okpo_map.js meta).
위경도 → TM 은 GRS80 횡메르카토르(Snyder 식)로 직접 계산한다(GDAL·pyproj 없이). 지원 좌표계:
  5179 UTM-K, 5185 서부(125°), 5186 중부(127°), 5187 동부(129°), 5188 동해(131°)
좌표계는 GeoTIFF 의 ProjectedCSTypeGeoKey(3072)에서 읽고, 없으면 --epsg 로 준다. 위치는 GeoTIFF 태그(ModelTiepoint·ModelPixelScale)
또는 같은 이름의 월드 파일(.tfw)에서 읽는다. 여러 장(도엽)을 주면 차례로 겹쳐 그린다(검은 빈칸은 건너뜀).

실행(가상환경 ~/.venvs/busan-geo, PIL·numpy):
  ~/.venvs/busan-geo/bin/python -I tools/ortho_crop.py <정사영상.tif> [더 ...] [--epsg 5186] [--size 4096] [--q 80] [--year 2024]
결과: web/data/okpo_ortho.jpg(사진), web/data/okpo_ortho.js(window.ORTHO = { img, src, year })
"""
import json, math, os, sys
import numpy as np
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
X0, X1, Z0, Z1 = -935.9, 936.1, -939.9, 944.1

# GRS80
A, F = 6378137.0, 1 / 298.257222101
E2 = F * (2 - F)
TM = {  # epsg: (위도 원점, 경도 원점, 축척, 동쪽 더함, 북쪽 더함)
    5179: (38.0, 127.5, 0.9996, 1000000.0, 2000000.0),
    5185: (38.0, 125.0, 1.0, 200000.0, 600000.0),
    5186: (38.0, 127.0, 1.0, 200000.0, 600000.0),
    5187: (38.0, 129.0, 1.0, 200000.0, 600000.0),
    5188: (38.0, 131.0, 1.0, 200000.0, 600000.0),
}


def _m(phi):   # 적도에서 위도 phi 까지 자오선 호 길이(Snyder 3-21)
    e4, e6 = E2 * E2, E2 ** 3
    return A * ((1 - E2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * phi - (3 * E2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * math.sin(2 * phi)
                + (15 * e4 / 256 + 45 * e6 / 1024) * math.sin(4 * phi) - (35 * e6 / 3072) * math.sin(6 * phi))


def to_tm(lat, lon, epsg):
    lat0, lon0, k0, fe, fn = TM[epsg]
    phi, lam = math.radians(lat), math.radians(lon - lon0)
    ep2 = E2 / (1 - E2)
    N = A / math.sqrt(1 - E2 * math.sin(phi) ** 2)
    T, C, Aa = math.tan(phi) ** 2, ep2 * math.cos(phi) ** 2, math.cos(phi) * lam
    x = k0 * N * (Aa + (1 - T + C) * Aa ** 3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * Aa ** 5 / 120)
    y = k0 * (_m(phi) - _m(math.radians(lat0)) + N * math.tan(phi) * (Aa * Aa / 2 + (5 - T + 9 * C + 4 * C * C) * Aa ** 4 / 24
                                                                     + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * Aa ** 6 / 720))
    return fe + x, fn + y


def georef(path, im, epsg_arg):
    """(epsg, 화소 → TM 변환 함수의 역: TM → 화소) 를 돌려준다."""
    tags = getattr(im, 'tag_v2', {})
    epsg = epsg_arg
    keys = tags.get(34735)
    if keys and not epsg:
        k = list(keys)
        for i in range(4, len(k), 4):
            if k[i] == 3072:
                epsg = k[i + 3]
    if not epsg:
        raise SystemExit(f'{path}: 좌표계를 모릅니다. --epsg 5186 처럼 주세요')
    if epsg not in TM:
        raise SystemExit(f'{path}: EPSG:{epsg} 는 아직 지원하지 않습니다(5179·5185~5188)')
    tfw = os.path.splitext(path)[0] + '.tfw'
    if os.path.exists(tfw):
        a, d, b, e, c, f = [float(v) for v in open(tfw).read().split()[:6]]   # 화소 가운데 기준
        c, f = c - a / 2 - b / 2, f - d / 2 - e / 2
    elif 33922 in tags and 33550 in tags:
        tp, sc = list(tags[33922]), list(tags[33550])
        a, e, b, d = sc[0], -sc[1], 0.0, 0.0
        c, f = tp[3] - tp[0] * a, tp[4] - tp[1] * e
    else:
        raise SystemExit(f'{path}: 위치 정보(GeoTIFF 태그나 .tfw)가 없습니다')
    det = a * e - b * d
    inv = lambda X, Y: ((e * (X - c) - b * (Y - f)) / det, (-d * (X - c) + a * (Y - f)) / det)
    return epsg, inv


def main():
    args = sys.argv[1:]
    opt = lambda k, dv: (lambda i: type(dv)(args[i + 1]) if i >= 0 else dv)(args.index(k) if k in args else -1)
    epsg_arg, size, q, year = opt('--epsg', 0), opt('--size', 4096), opt('--q', 80), opt('--year', '')
    files = [a for i, a in enumerate(args) if not a.startswith('--') and (i == 0 or not args[i - 1].startswith('--'))]
    if not files:
        raise SystemExit(__doc__)
    meta = json.loads((s := open(os.path.join(ROOT, 'web', 'data', 'okpo_map.js'), encoding='utf-8').read())[s.index('{'):s.rindex('}') + 1])['meta']
    ll = lambda x, z: (meta['lat0'] - z / meta['kz'], meta['lon0'] + x / meta['kx'])
    out = Image.new('RGB', (size, size), (0, 0, 0)); filled = np.zeros((size, size), bool)
    for path in files:
        im = Image.open(path); im.load()
        epsg, inv = georef(path, im, epsg_arg)
        if im.mode != 'RGB':
            im = im.convert('RGB')
        # 출력 네 모서리(북서·남서·남동·북동) → 원본 화소 자리. 2km 안이라 사각형 변환이면 0.1m 안으로 맞는다
        quad = []
        for (x, z) in [(X0, Z0), (X0, Z1), (X1, Z1), (X1, Z0)]:
            quad += list(inv(*to_tm(*ll(x, z), epsg)))
        part = im.transform((size, size), Image.QUAD, quad, resample=Image.BICUBIC)
        arr = np.asarray(part); m = (arr.sum(axis=2) > 12) & ~filled
        o = np.asarray(out).copy(); o[m] = arr[m]; out = Image.fromarray(o); filled |= m
        print(f'{os.path.basename(path)}: EPSG:{epsg}, {im.size[0]}×{im.size[1]}, 채운 칸 {m.mean() * 100:.1f}% (누적 {filled.mean() * 100:.1f}%)')
    dst = os.path.join(ROOT, 'web', 'data', 'okpo_ortho.jpg')
    out.save(dst, quality=q, optimize=True, progressive=True)
    print(f'→ {dst} {os.path.getsize(dst) / 1e6:.1f}MB, 빈칸 {(1 - filled.mean()) * 100:.1f}%')
    # 화면이 읽는 사진 정보(ground.js 가 window.ORTHO 가 있을 때만 사진 바닥을 켤 수 있게 함)
    info = {'img': 'data/okpo_ortho.jpg', 'src': '국토지리정보원 정사영상', 'year': year, 'files': [os.path.basename(f) for f in files]}
    with open(os.path.join(ROOT, 'web', 'data', 'okpo_ortho.js'), 'w', encoding='utf-8') as fo:
        fo.write('/* 자동 생성: tools/ortho_crop.py — 바닥 사진(정사영상) 정보. 손으로 고치지 말 것 */\n')
        fo.write('window.ORTHO = ' + json.dumps(info, ensure_ascii=False) + ';\n')


if __name__ == '__main__':
    main()
