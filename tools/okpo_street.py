"""거리 집중 화면 자료: 거리마다 길가 1층 칸(건물)을 순서대로 web/data/<지역>_street.js 로 쓴다.

거리 정하는 법(원칙: 주소로 확인)
- 상가정보 가게의 도로명주소 도로 이름이 그 거리인 가게를 모은다(지번으로 건물에 붙어 있음).
- 중심선: 그 가게들 바로 옆(20m 안)을 지나는 OSM 도로 조각을 이어 만든다. 옥포대첩로 핵심 구간은 OSM 에서
  이름 없는 도로로 그려져 있어 도로 이름으로는 못 잡는다(2026-11-27 확인).
- 구간: 근거 있는 두 지점(anchors) 사이만 자른다. 없으면 R-ONE 상권 경계 안.
- 길가 칸: 중심선 14m 안 건물 + 그 거리 주소 가게가 든 건물. 왼쪽/오른쪽은 건물번호 홀짝(가게 있는 건물), 없으면 기하.
- 1층 상태는 tools/okpo_floors.py 판정.
실행: ~/.venvs/busan-geo/bin/python -I tools/okpo_street.py okpo
"""
import csv, json, math, os, re, sys, collections
from shapely.geometry import LineString, Polygon, Point
from shapely.ops import unary_union, linemerge

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAME = sys.argv[1]
L = lambda f: (lambda s: json.loads(s[s.index('{'):s.rindex('}') + 1]))(open(f, encoding='utf-8').read())
M = L(os.path.join(ROOT, 'web', 'data', f'{NAME}_map.js'))
F = L(os.path.join(ROOT, 'web', 'data', f'{NAME}_floors.js'))
m = M['meta']
xz = lambda la, lo: ((lo - m['lon0']) * m['kx'], -(la - m['lat0']) * m['kz'])
bnd = Polygon(M['boundary']) if M.get('boundary') else None

STREETS = [
    dict(id='light', addr='옥포대첩로', ko='빛의 거리 (옥포대첩로)',
         anchors=[('KB국민은행', 34.893931, 128.691373), ('수협', 34.894317, 128.694019)], margin=45,
         note='거제시 「빛의 거리」 공식 구간 "옥포(국민은행~수협 일원)" — 거제저널 2024-11-22, 오마이뉴스 2025-12-09'),
    dict(id='okporo', addr='옥포로', ko='옥포로', anchors=None,
         note='상가정보 주소 기준 옥포에서 가게가 가장 많은 길(R-ONE 상권 안 구간)'),
    dict(id='seongan', addr='옥포성안로', ko='옥포성안로', anchors=None,
         note='거제시 2026년 예산 「옥포성안로 특화거리 전선 지중화사업」 15억 원(구간 미확인, R-ONE 상권 안 구간)'),
]

stores = list(csv.DictReader(open(os.path.join(ROOT, 'data', 'processed', f'{NAME}_stores.csv'), encoding='utf-8-sig')))
by_pnu = collections.defaultdict(list)
for i, b in enumerate(M['buildings']):
    if b.get('pnu'):
        by_pnu[b['pnu']].append(i)
roads = [(r, LineString(r['p'])) for r in M['roads'] if not r['ped'] and len(r['p']) > 1]


def bldg_of(r):
    cand = by_pnu.get(r['지번코드'], [])
    if not cand:
        return None
    x, z = xz(float(r['위도']), float(r['경도']))
    return min(cand, key=lambda i: Point(x, z).distance(Polygon(M['buildings'][i]['p'])))


out = []
for st in STREETS:
    pts = []   # (번호, x, z, 건물)
    for r in stores:
        mm = re.search(r'거제시 (\S+) (\d+)', r['도로명주소'])
        if not mm or mm.group(1) != st['addr']:
            continue
        x, z = xz(float(r['위도']), float(r['경도']))
        pts.append((int(mm.group(2)), x, z, bldg_of(r)))
    if st['anchors']:
        a0, a1 = [Point(xz(la, lo)) for _, la, lo in st['anchors']]
        ax = LineString([a0, a1]); Lx = ax.length
        keep = lambda p: -st['margin'] <= ax.project(Point(p)) <= Lx + st['margin'] and ax.distance(Point(p)) < 80
        # project 는 0~Lx 로 잘리므로 끝 바깥은 거리로 다시 확인
        def along(p):
            v = (a1.x - a0.x, a1.y - a0.y); t = ((p[0] - a0.x) * v[0] + (p[1] - a0.y) * v[1]) / (Lx * Lx)
            return t * Lx
        keep = lambda p: -st['margin'] <= along(p) <= Lx + st['margin'] and ax.distance(Point(p)) < 80
        pts = [p for p in pts if keep((p[1], p[2]))]
    elif bnd is not None:
        pts = [p for p in pts if bnd.contains(Point(p[1], p[2]))]
    if len(pts) < 4:
        print(st['ko'], '가게가 너무 적음', len(pts)); continue
    # 중심선: 가게 위치로 만든다. 길 방향 축(주성분) → 20m 칸마다 가게 가운데 → 3칸 이동 평균.
    # 양쪽에 가게가 있으면 그 가운데가 길 가운데다(OSM 도로가 잘게 나뉘거나 이름이 없어도 됨).
    xs = [p[1] for p in pts]; zs = [p[2] for p in pts]; mx, mz = sum(xs) / len(xs), sum(zs) / len(zs)
    sxx = sum((x - mx) ** 2 for x in xs); szz = sum((z - mz) ** 2 for z in zs); sxz = sum((x - mx) * (z - mz) for x, z in zip(xs, zs))
    ang = 0.5 * math.atan2(2 * sxz, sxx - szz); ux, uz = math.cos(ang), math.sin(ang)
    tt = lambda x, z: (x - mx) * ux + (z - mz) * uz
    if st['anchors']:
        ta, tb = sorted([tt(a0.x, a0.y), tt(a1.x, a1.y)]); tmin, tmax = ta - st['margin'], tb + st['margin']
    else:
        tv = sorted(tt(x, z) for x, z in zip(xs, zs)); tmin, tmax = tv[0], tv[-1]
    BIN = 20; nb = max(2, int(math.ceil((tmax - tmin) / BIN)))
    cent = []
    for k in range(nb):
        lo, hi = tmin + k * BIN, tmin + (k + 1) * BIN
        q = [(x, z) for x, z in zip(xs, zs) if lo <= tt(x, z) < hi]
        if q:
            cent.append((sum(a for a, _ in q) / len(q), sum(b for _, b in q) / len(q)))
    sm = []
    for k in range(len(cent)):
        w = cent[max(0, k - 1):k + 2]
        sm.append((sum(a for a, _ in w) / len(w), sum(b for _, b in w) / len(w)))
    # 끝을 구간 끝(tmin, tmax)까지 늘린다
    def at_t(p, t):
        d = t - tt(*p); return (p[0] + ux * d, p[1] + uz * d)
    sm = [at_t(sm[0], tmin)] + sm + [at_t(sm[-1], tmax)]
    line = LineString(sm)
    if not st['anchors'] and bnd is not None:
        g2 = line.intersection(bnd)
        line = max(list(g2.geoms), key=lambda x: x.length) if hasattr(g2, 'geoms') else g2
    c = list(line.coords)
    if c[0][0] > c[-1][0]:   # 서쪽에서 시작(왼→오)
        c = c[::-1]
    line = LineString(c)
    # 번호 홀짝: 건물마다 그 거리 주소 번호
    side_by_b = {}
    for n, x, z, b in pts:
        if b is not None:
            side_by_b.setdefault(b, collections.Counter())[n % 2] += 1
    slots = []
    for i, b in enumerate(M['buildings']):
        poly = Polygon(b['p'])
        near = poly.distance(line)
        if (near > 14 and i not in side_by_b) or poly.area < 12 or near > 30:
            continue
        cen = poly.representative_point()
        s = line.project(cen)
        if s <= 0.5 or s >= line.length - 0.5:
            continue
        p0 = line.interpolate(max(0, s - 2)); p1 = line.interpolate(min(line.length, s + 2))
        cross = (p1.x - p0.x) * (cen.y - p0.y) - (p1.y - p0.y) * (cen.x - p0.x)
        side = 'L' if cross < 0 else 'R'
        proj = [line.project(Point(q)) for q in poly.exterior.coords]
        fl = F['b'].get(str(i))
        f1 = next((f for f in fl if f['n'] == 1), None) if fl else None
        state = f1['state'] if f1 else ('nodata' if not fl else 'other')
        shops = [x['n'] + (' · ' + x['cs'] if x.get('cs') else '') for x in (f1['stores'] if f1 else [])][:4]
        allf = [[f['n'], f['state'], round(f['area'] or 0), ', '.join(f['uses'])[:40], [x['n'] for x in f['stores']][:3]] for f in (fl or [])]
        slots.append(dict(b=i, s=round(s, 1), s0=round(max(0, min(proj)), 1), s1=round(min(line.length, max(proj)), 1), fl=allf,
                          side=side, odd=(side_by_b[i].most_common(1)[0][0] == 1) if i in side_by_b else None,
                          st=state, use=', '.join(f1['uses']) if f1 else (b.get('ko') or ''), area=f1['area'] if f1 else None,
                          shops=shops, lv=b['lv']))
    # 홀짝으로 옆 확인: 같은 쪽 건물은 홀짝이 같아야 한다
    agree = sum(1 for x in slots if x['odd'] is not None and ((x['side'] == 'L') == x['odd']))
    known = sum(1 for x in slots if x['odd'] is not None)
    slots.sort(key=lambda x: (x['side'], x['s']))
    cnt = {k: sum(1 for x in slots if x['st'] == k) for k in ('open', 'empty', 'unknown', 'home', 'other', 'nodata')}
    # 건물 전체(모든 상가 층) 기준 — 사용자 기준 "1층만 보지 말고 건물 전체"
    W_ = collections.Counter()
    for x in slots:
        for n, stt, ar, _u, _s in x['fl']:
            if stt in ('open', 'empty', 'unknown'):
                W_['floors'] += 1; W_[stt] += 1; W_[stt + '_area'] += ar
    kn_area = W_['open_area'] + W_['empty_area']
    whole = dict(floors=W_['floors'], open=W_['open'], empty=W_['empty'], unknown=W_['unknown'],
                 empty_area_pct=round(100 * W_['empty_area'] / kn_area, 1) if kn_area else None,
                 empty_area=W_['empty_area'], open_area=W_['open_area'])
    out.append(dict(id=st['id'], ko=st['ko'], note=st['note'], len=round(line.length), stores=len(pts),
                    p=[[round(x, 1), round(z, 1)] for x, z in line.coords], slots=slots, count=cnt, whole=whole,
                    sideCheck=dict(agree=agree, known=known)))
    print(f"{st['ko']}: {round(line.length)}m, 주소 가게 {len(pts)}, 길가 건물 {len(slots)}, 1층 {cnt}, 건물 전체 {whole}, 홀짝-좌우 일치 {max(agree, known - agree)}/{known}")

dst = os.path.join(ROOT, 'web', 'data', f'{NAME}_street.js')
with open(dst, 'w', encoding='utf-8') as f:
    f.write('/* 자동 생성: tools/okpo_street.py — 손으로 고치지 말 것 */\nwindow.STREETS = ')
    json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    f.write(';\n')
print(dst)
