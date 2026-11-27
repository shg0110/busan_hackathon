"""바닥층(web/ground.js) 전용 자료: OSM 에서 지도 자료(okpo_map.js)에 없는 것을 뽑아 web/data/<지역>_ground.js 로 쓴다.
지금 뽑는 것
  - 초등학교·유치원 경계(amenity=school 중 이름에 '초등학교', amenity=kindergarten). 어린이보호구역 노면 표시에 썼으나
    11-27 "실제 자료가 아닌 거는 없애자"로 그 표시를 지워 지금은 화면에서 쓰지 않는다(지정 범위 실자료를 받으면 다시 씀).
  - 토지 이용(녹지·물·주차장은 okpo_map.js 에 있으므로 뺌): 주거·상업·시장·공업·조선소·공사장·농지·묘지·학교 부지·주유소.
    지도 범위(meta.half)로 잘라서 넣는다. 빈 땅을 구분하는 바닥색에만 쓴다.
좌표: web/data/<지역>_map.js 의 meta(lat0·lon0·kx·kz)로 [x, z] m 로 바꾼다(tools/map_build.py xz 와 같은 식).
실행: python3 -I tools/map_ground.py okpo
"""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAME = sys.argv[1] if len(sys.argv) > 1 else 'okpo'


LANDUSE = {'residential', 'commercial', 'retail', 'industrial', 'construction', 'farmland', 'cemetery'}
AMENITY = {'school', 'marketplace', 'fuel', 'university', 'college'}


def clip(p, hx, hz):
    """다각형을 [-hx, hx] × [-hz, hz] 로 자른다(Sutherland–Hodgman)."""
    for ax, lim, sgn in ((0, hx, 1), (0, hx, -1), (1, hz, 1), (1, hz, -1)):
        if not p:
            break
        ins = lambda q: sgn * q[ax] <= lim
        def cut(a, b):
            t = (sgn * lim - a[ax]) / ((b[ax] - a[ax]) or 1e-9)
            return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
        out = []
        for i in range(len(p)):
            a, b = p[i - 1], p[i]
            if ins(b):
                if not ins(a):
                    out.append(cut(a, b))
                out.append(b)
            elif ins(a):
                out.append(cut(a, b))
        p = out
    return [[round(q[0], 1), round(q[1], 1)] for q in p]


def landuse_kind(tg):
    if tg.get('industrial') == 'shipyard':
        return 'shipyard'
    if tg.get('landuse') in LANDUSE:
        return tg['landuse']
    if tg.get('amenity') in AMENITY:
        return tg['amenity']
    return None


def main():
    t = open(os.path.join(ROOT, 'web', 'data', f'{NAME}_map.js'), encoding='utf-8').read()
    meta = json.loads(t[t.index('{'):t.rindex('}') + 1])['meta']
    xz = lambda lat, lon: [round((lon - meta['lon0']) * meta['kx'], 1), round(-(lat - meta['lat0']) * meta['kz'], 1)]
    el = json.load(open(os.path.join(ROOT, 'data', 'raw', 'osm', f'{NAME}.json'), encoding='utf-8'))['elements']
    schools = []
    for e in el:
        tg = e.get('tags', {}); a = tg.get('amenity'); n = tg.get('name', '')
        if not ((a == 'school' and '초등학교' in n) or a == 'kindergarten'):
            continue
        if e['type'] == 'way' and e.get('geometry'):
            schools.append({'n': n, 'k': a, 'p': [xz(g['lat'], g['lon']) for g in e['geometry']]})
        elif e['type'] == 'node':
            schools.append({'n': n, 'k': a, 'pt': xz(e['lat'], e['lon'])})
    hx, hz = meta['half']
    landuse = []
    for e in el:
        tg = e.get('tags', {}); k = landuse_kind(tg)
        if not k or e['type'] != 'way' or not e.get('geometry'):
            continue
        p = clip([xz(g['lat'], g['lon']) for g in e['geometry']], hx, hz)
        if p and p[0] == p[-1]:
            p = p[:-1]
        if len(p) > 2:
            landuse.append({'k': k, 'n': tg.get('name', ''), 'p': p})
    out = {'schools': schools, 'landuse': landuse,
           'src': 'OpenStreetMap amenity=school(이름에 초등학교)·kindergarten, 토지 이용(landuse·industrial=shipyard·amenity), data/raw/osm/' + NAME + '.json'}
    dst = os.path.join(ROOT, 'web', 'data', f'{NAME}_ground.js')
    with open(dst, 'w', encoding='utf-8') as f:
        f.write('/* 자동 생성: tools/map_ground.py. 손으로 고치지 말 것 */\nwindow.GROUND_DATA = ')
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';\n')
    print(os.path.relpath(dst, ROOT), [(s['n'], s['k'], 'p' in s) for s in schools])
    print('토지 이용', {k: sum(1 for l in landuse if l['k'] == k) for k in sorted({l['k'] for l in landuse})})


if __name__ == '__main__':
    main()
