"""OSM(+ Overture) 원자료를 3D 화면용 자료 web/data/<지역>_map.js 로 바꾼다.

좌표: 범위 중심이 원점, x = 동쪽(m), z = 남쪽(m), y = 위. three.js 에서 그대로 쓴다.
- 건물: OSM 건물 + (있으면) Overture 에만 있는 건물. 층수는 OSM building:levels 가 있으면 '확인', 없으면 '추정'.
- 바다: OSM 해안선은 진행 방향 오른쪽이 물이다. 범위 사각형을 해안선으로 나눈 면 가운데 오른쪽 점이 들어간 면을 바다로 본다.
- 녹지·공원, 도로(종류별 폭), 이름 있는 장소.

실행: ~/.venvs/busan-geo/bin/python -I tools/map_build.py okpo      (shapely 2.0.6)
"""
import hashlib, json, math, os, sys, time
from shapely.geometry import LineString, Point, Polygon, box, mapping
from shapely.ops import polygonize, unary_union, linemerge
from shapely.strtree import STRtree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from map_regions import bbox as region_bbox

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAME = sys.argv[1]
S, W, N, E = region_bbox(NAME)
LAT0, LON0 = (S + N) / 2, (W + E) / 2
KX = math.cos(math.radians(LAT0)) * 111320.0
KZ = 110574.0


def xz(lat, lon):
    return (round((lon - LON0) * KX, 1), round(-(lat - LAT0) * KZ, 1))


def hsh(*a):
    return int(hashlib.md5('|'.join(map(str, a)).encode()).hexdigest()[:8], 16)


osm = json.load(open(os.path.join(ROOT, 'data', 'raw', 'osm', f'{NAME}.json'), encoding='utf-8'))
EL = osm['elements']


def ring_of(geom):
    return [(p['lat'], p['lon']) for p in geom if p]


def rel_outers(el):
    """multipolygon 관계의 바깥 고리들(조각난 길은 이어 붙인다)."""
    lines = [LineString([(p['lon'], p['lat']) for p in m['geometry']])
             for m in el.get('members', []) if m.get('role') == 'outer' and m.get('geometry') and len(m['geometry']) > 1]
    if not lines:
        return []
    return [[(c[1], c[0]) for c in poly.exterior.coords] for poly in polygonize(unary_union(lines))]


def polys_of(el):
    if el['type'] == 'way' and el.get('geometry') and len(el['geometry']) >= 4:
        r = ring_of(el['geometry'])
        if r[0] == r[-1]:
            return [r]
    if el['type'] == 'relation':
        return rel_outers(el)
    return []


def clean_ring(r):
    pts = [xz(la, lo) for la, lo in r]
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    out = []
    for p in pts:
        if not out or (abs(p[0] - out[-1][0]) + abs(p[1] - out[-1][1])) > 0.05:
            out.append(p)
    return out if len(out) >= 3 else None


def ko_name(t):
    """화면에 쓸 한국어 이름: name:ko 가 먼저, 없으면 한글이 든 name. 한글이 없으면 빈 문자열."""
    for k in ('name:ko', 'name'):
        v = t.get(k, '')
        if any('가' <= ch <= '힣' for ch in v):
            return v
    return ''


def area(pts):
    return abs(sum(pts[i][0] * pts[i - 1][1] - pts[i - 1][0] * pts[i][1] for i in range(len(pts)))) / 2


# ── 건물 ──────────────────────────────────────────────
KIND_KO = {'yes': '건물', 'house': '주택', 'apartments': '아파트', 'retail': '상가', 'commercial': '상업',
           'church': '교회', 'hotel': '호텔', 'school': '학교', 'public': '공공', 'roof': '지붕',
           'kindergarten': '유치원', 'office': '사무', 'residential': '주거', 'industrial': '공장',
           'warehouse': '창고', 'hospital': '병원', 'detached': '단독주택', 'garage': '차고'}
FLOOR_H = {'apartments': 2.9, 'house': 3.0, 'detached': 3.0, 'residential': 3.0}


def est_levels(kind, a, key):
    r = hsh(key) % 100 / 100.0
    if kind in ('house', 'detached', 'garage'):
        return 1 + int(r * 2)
    if kind == 'apartments':
        return 12 + int(r * 8)
    if a < 30:
        return 1   # 창고·부속 건물 크기
    if a < 80:
        return 2
    if a < 300:
        return 3 + int(r * 2)
    if a < 1200:
        return 4 + int(r * 3)
    return 5 + int(r * 4)


buildings, bshapes = [], []


def add_building(key, ring, tags, src, extra=None):
    pts = clean_ring(ring)
    if not pts:
        return
    a = area(pts)
    if a < 6:
        return
    kind = tags.get('building') or tags.get('building:part') or 'yes'
    lv, real = tags.get('building:levels'), False
    try:
        lv = max(1, int(round(float(str(lv).split(';')[0])))); real = True
    except (TypeError, ValueError):
        lv = est_levels(kind, a, key)
    if kind == 'roof':
        h, base = 1.0, 4.5
    else:
        h, base = round(lv * FLOOR_H.get(kind, 3.4) + 0.6, 1), 0.0
    buildings.append(dict(id=key, p=[list(p) for p in pts], h=h, b=base, lv=lv, real=real, k=kind,
                          ko=KIND_KO.get(kind, '건물'), n=ko_name(tags), a=round(a), src=src,
                          c=hsh(key, 'c') % 6, **(extra or {})))
    bshapes.append(Polygon(pts))


# 국토부 GIS건물통합정보(브이월드)가 있으면 건물 모양·지번·용도는 그것이 기준이다.
# 층수가 없으면 많이 겹치는 OSM 건물의 층수를 쓰고, 그것도 없으면 추정. OSM 에만 있는 건물은 그대로 더한다.
USE_KIND = {'단독주택': 'house', '공동주택': 'apartments', '제1종근린생활시설': 'retail', '제2종근린생활시설': 'retail',
            '판매시설': 'retail', '숙박시설': 'hotel', '위락시설': 'retail', '업무시설': 'office', '교육연구시설': 'school',
            '종교시설': 'church', '공장': 'industrial', '창고시설': 'warehouse', '노유자시설': 'public', '의료시설': 'hospital',
            '문화및집회시설': 'public', '운동시설': 'public', '자동차관련시설': 'garage', '제1종근린생활시설(소매점)': 'retail'}
osm_polys = []
for el in EL:
    t = el.get('tags', {})
    if 'building' not in t and 'building:part' not in t:
        continue
    for r in polys_of(el):
        pts = clean_ring(r)
        if pts and area(pts) >= 6:
            osm_polys.append((el, r, t, Polygon(pts)))
vw_path = os.path.join(ROOT, 'data', 'raw', 'vworld', f'{NAME}.json')
vw_n = 0
if os.path.exists(vw_path):
    VW = json.load(open(vw_path, encoding='utf-8'))
    osm_tree = STRtree([o[3] for o in osm_polys])
    for k, v in enumerate(VW['buildings']):
        pts = clean_ring([tuple(q) for q in v['ring']])
        if not pts or area(pts) < 6:
            continue
        poly = Polygon(pts)
        if not poly.is_valid:
            poly = poly.buffer(0)
        tags = {'building': USE_KIND.get(v['use'], 'yes')}
        lv_src = ''
        if v['lv'] > 0:
            tags['building:levels'] = v['lv']; lv_src = 'vworld'
        else:   # 겹치는 OSM 건물의 층수(겹친 넓이가 이 건물의 절반 넘을 때만)
            best = max(((poly.intersection(osm_polys[i][3]).area, i) for i in osm_tree.query(poly)), default=(0, -1))
            if best[0] > 0.5 * poly.area and 'building:levels' in osm_polys[best[1]][2]:
                tags['building:levels'] = osm_polys[best[1]][2]['building:levels']; lv_src = 'osm'
        nm = v['name'] or ''
        if nm:
            tags['name'] = nm
        add_building(f'vw{k}', [tuple(q) for q in v['ring']], tags, 'vworld',
                     extra=dict(pnu=v['pnu'], use=v['use'], appr=v['appr'], dn=v['dn'], farea=v['farea'], lvsrc=lv_src,
                                jibun=v['dong'].replace('경상남도 ', '') + ' ' + v['jibun']))
        if v['use']:
            buildings[-1]['ko'] = v['use']
        vw_n += 1
    vw_tree = STRtree(bshapes)
    for el, r, t, poly in osm_polys:
        hit = sum(poly.intersection(bshapes[i]).area for i in vw_tree.query(poly))
        if hit > 0.3 * poly.area:
            continue
        add_building(f"osm{el['type'][0]}{el['id']}", r, t, 'osm')
else:
    for el, r, t, poly in osm_polys:
        add_building(f"osm{el['type'][0]}{el['id']}", r, t, 'osm')
osm_n = len(buildings) - vw_n

ov_path = os.path.join(ROOT, 'data', 'raw', 'overture', f'{NAME}.json')
ov_added = 0
if os.path.exists(ov_path):
    tree = STRtree(bshapes)
    for o in json.load(open(ov_path, encoding='utf-8')):
        if any(s.get('dataset') == 'OpenStreetMap' for s in (o.get('src') or [])):
            continue
        g = o['g']
        rings = [g['coordinates'][0]] if g['type'] == 'Polygon' else [p[0] for p in g['coordinates']] if g['type'] == 'MultiPolygon' else []
        for ring in rings:
            pts = clean_ring([(la, lo) for lo, la in ring])
            if not pts:
                continue
            poly = Polygon(pts)
            if not poly.is_valid or poly.area < 6:
                continue
            hit = sum(poly.intersection(bshapes[i]).area for i in tree.query(poly))
            if hit > 0.2 * poly.area:
                continue  # OSM 건물과 겹치면 OSM 쪽을 쓴다
            tags = {'building': 'yes'}
            if o.get('lv'):
                tags['building:levels'] = o['lv']
            add_building('ov' + o['id'][:12], [(la, lo) for lo, la in ring], tags, 'ml')
            ov_added += 1

# ── 바다 ──────────────────────────────────────────────
frame = box(W, S, E, N)
coast = [LineString([(p['lon'], p['lat']) for p in el['geometry']])
         for el in EL if el.get('tags', {}).get('natural') == 'coastline' and el['type'] == 'way' and len(el.get('geometry') or []) > 1]
water_polys = []
if coast:
    merged = linemerge(unary_union(coast))
    lines = list(merged.geoms) if hasattr(merged, 'geoms') else [merged]
    faces = list(polygonize(unary_union([frame.boundary] + [ln.intersection(frame) for ln in lines])))
    probes = []
    for ln in lines:
        cs = list(ln.coords)
        for i in range(0, len(cs) - 1, max(1, (len(cs) - 1) // 20)):
            (x1, y1), (x2, y2) = cs[i], cs[i + 1]
            dx, dy = x2 - x1, y2 - y1
            L = math.hypot(dx, dy)
            if L == 0:
                continue
            mx, my = (x1 + x2) / 2, (y1 + y2) / 2
            probes.append(Point(mx + dy / L * 2e-5, my - dx / L * 2e-5))  # 진행 방향 오른쪽 약 2m
    for f in faces:
        inside = sum(f.contains(p) for p in probes)
        if inside and inside >= 0.5 * sum(f.buffer(5e-5).contains(p) for p in probes):
            water_polys.append(f)
for el in EL:
    t = el.get('tags', {})
    if t.get('natural') == 'water' or t.get('landuse') in ('basin', 'reservoir'):
        for r in polys_of(el):
            water_polys.append(Polygon([(lo, la) for la, lo in r]).intersection(frame))
water = []
for wp in water_polys:
    for g in (wp.geoms if hasattr(wp, 'geoms') else [wp]):
        if g.geom_type == 'Polygon' and g.area > 0:
            pts = clean_ring([(la, lo) for lo, la in g.exterior.coords])
            if pts:
                water.append(dict(p=[list(p) for p in pts]))

# ── 녹지 ──────────────────────────────────────────────
greens = []
for el in EL:
    t = el.get('tags', {})
    kind = (t.get('leisure') if t.get('leisure') in ('park', 'garden', 'playground', 'pitch') else
            t.get('landuse') if t.get('landuse') in ('grass', 'forest', 'recreation_ground', 'meadow') else
            t.get('natural') if t.get('natural') in ('wood', 'scrub', 'grassland') else None)
    if not kind:
        continue
    for r in polys_of(el):
        clip = Polygon([(lo, la) for la, lo in r]).intersection(frame)
        for g in (clip.geoms if hasattr(clip, 'geoms') else [clip]):
            if g.geom_type == 'Polygon' and g.area > 0:
                pts = clean_ring([(la, lo) for lo, la in g.exterior.coords])
                if pts:
                    greens.append(dict(p=[list(p) for p in pts], k=kind, n=ko_name(t)))

# ── 도로 ──────────────────────────────────────────────
WIDTH = {'trunk': 22, 'primary': 20, 'secondary': 16, 'tertiary': 12, 'trunk_link': 8, 'primary_link': 8,
         'secondary_link': 7, 'tertiary_link': 7, 'unclassified': 7, 'residential': 6, 'living_street': 5,
         'service': 4, 'pedestrian': 6, 'footway': 2.5, 'path': 2, 'steps': 2.5, 'cycleway': 2.5, 'track': 3}
roads = []
for el in EL:
    t = el.get('tags', {})
    hw = t.get('highway')
    if el['type'] != 'way' or hw not in WIDTH or t.get('area') == 'yes':
        continue
    if t.get('tunnel') in ('yes', 'building_passage') or str(t.get('layer', '0')).startswith('-'):
        continue
    pts = [xz(p['lat'], p['lon']) for p in el.get('geometry') or [] if p]
    if len(pts) < 2:
        continue
    w = WIDTH[hw]
    try:
        w = max(w, float(t['lanes']) * 3.2) if 'lanes' in t and hw in ('trunk', 'primary', 'secondary', 'tertiary') else w
    except ValueError:
        pass
    ow = 1 if t.get('oneway') in ('yes', '1', 'true') else 0
    try:
        ln = int(str(t.get('lanes', '')).split(';')[0])
    except ValueError:
        ln = 0
    roads.append(dict(p=[list(p) for p in pts], w=round(w, 1), k=hw, n=ko_name(t), ow=ow, ln=ln,
                      ped=hw in ('pedestrian', 'footway', 'path', 'steps', 'living_street'),
                      br=t.get('bridge') == 'yes'))

# 주차장 면(amenity=parking, 지상) — 꾸밈(decor.js)이 바닥·칸을 그린다
parking = []
for el in EL:
    t = el.get('tags', {})
    if t.get('amenity') == 'parking' and t.get('parking', 'surface') in ('surface', '') and t.get('building') is None:
        for r in polys_of(el):
            pts = clean_ring(r)
            if pts and area(pts) > 30:
                parking.append(dict(p=[list(p) for p in pts], n=ko_name(t)))

# 도로 이름표: 이름별로 가장 긴 구간 하나
def plen(p):
    return sum(math.dist(p[i], p[i + 1]) for i in range(len(p) - 1))


best = {}
for r in roads:
    if r['n'] and not r['ped'] and plen(r['p']) > 60:
        if r['n'] not in best or plen(r['p']) > plen(best[r['n']]['p']):
            best[r['n']] = r
road_labels = []
for n, r in best.items():
    p = r['p']; L = plen(p); acc = 0
    for i in range(len(p) - 1):
        seg = math.dist(p[i], p[i + 1])
        if acc + seg >= L / 2:
            f = (L / 2 - acc) / seg if seg else 0
            x = p[i][0] + (p[i + 1][0] - p[i][0]) * f; z = p[i][1] + (p[i + 1][1] - p[i][1]) * f
            ang = math.atan2(p[i + 1][1] - p[i][1], p[i + 1][0] - p[i][0])
            road_labels.append(dict(n=n, x=round(x, 1), z=round(z, 1), a=round(ang, 3), k=r['k']))
            break
        acc += seg

# ── 이름 있는 장소(지명 표시용) ──────────────────────────
places = []
for el in EL:
    t = el.get('tags', {})
    nm = ko_name(t)
    if not nm:
        continue
    kind = (t.get('amenity') if t.get('amenity') in ('marketplace', 'townhall', 'police', 'library', 'post_office', 'hospital', 'bus_station', 'ferry_terminal') else
            t.get('shop') if t.get('shop') in ('department_store', 'mall', 'supermarket') else
            t.get('tourism') if t.get('tourism') in ('hotel', 'attraction', 'museum') else
            t.get('leisure') if t.get('leisure') == 'park' else
            t.get('harbour') and 'harbour' or (t.get('landuse') == 'industrial' and 'industrial') or None)
    if not kind:
        continue
    c = el.get('center') or (el if 'lat' in el else None)
    if not c and el.get('geometry'):
        g = [p for p in el['geometry'] if p]
        c = dict(lat=sum(p['lat'] for p in g) / len(g), lon=sum(p['lon'] for p in g) / len(g))
    if not c:
        continue
    x, z = xz(c['lat'], c['lon'])
    # 같은 이름이 두 번 들어간 경우 하나만 남긴다(면 쪽 우선). 옥포1동 주민센터는 점(368903004)과 면(397569060)이
    # 320m 떨어져 있는데 어느 쪽이 지금 위치인지 확인하지 못했다 → 건물로 그린 면 쪽을 쓴다(2026-11-27).
    dup = next((q for q in places if q['n'] == nm), None)
    if dup:
        if el['type'] != 'node':
            dup.update(x=x, z=z)
        continue
    places.append(dict(n=nm, k=kind, x=x, z=z))

# ── R-ONE 상권 경계(있으면): 지도에 선으로 그리고, 건물마다 경계 안(i)인지 표시 ──
bnd_path = os.path.join(ROOT, 'data', 'processed', f'{NAME}_rone_boundary.geojson')
boundary = None
if os.path.exists(bnd_path):
    g = json.load(open(bnd_path, encoding='utf-8'))
    geom = (g['features'][0] if 'features' in g else g)['geometry']
    ring = geom['coordinates'][0] if geom['type'] == 'Polygon' else geom['coordinates'][0][0]
    boundary = [list(xz(la, lo)) for lo, la in ring]
    bpoly = Polygon(boundary)
    for b in buildings:
        c = Polygon(b['p']).representative_point()
        b['i'] = bool(bpoly.contains(c))
hx, hz = xz(S, E)
out = dict(
    meta=dict(region=NAME, bbox=[S, W, N, E], lat0=LAT0, lon0=LON0, kx=round(KX, 3), kz=KZ,
              half=[abs(hx), abs(hz)], built=time.strftime('%Y-%m-%d %H:%M'), osm_fetched=osm.get('_fetched', ''),
              counts=dict(buildings=len(buildings), vworld=vw_n, osm=osm_n, overture=ov_added,
                          real_levels=sum(b['real'] for b in buildings), roads=len(roads), water=len(water),
                          greens=len(greens), places=len(places))),
    buildings=buildings, roads=roads, water=water, greens=greens, road_labels=road_labels, places=places, parking=parking,
    boundary=boundary, boundary_src='한국부동산원 R-ONE 상권구획도(그림 추적, 오차 약 ±14m)' if boundary else None,
)
os.makedirs(os.path.join(ROOT, 'web', 'data'), exist_ok=True)
dst = os.path.join(ROOT, 'web', 'data', f'{NAME}_map.js')
with open(dst, 'w', encoding='utf-8') as f:
    f.write('/* 자동 생성: tools/map_build.py — 손으로 고치지 말 것. 출처: 국토교통부 GIS건물통합정보, OpenStreetMap 기여자(ODbL)'
            + (', Overture Maps' if ov_added else '') + ' */\n')
    f.write('window.MAP_DATA = ')
    json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    f.write(';\n')
print(dst, round(os.path.getsize(dst) / 1024), 'KB', out['meta']['counts'])
