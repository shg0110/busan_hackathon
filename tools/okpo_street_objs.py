"""OpenStreetMap(Overpass API)에서 옥포 지도 범위의 '거리에 선 시설' 점 자료를 받아 화면용 파일을 만든다.

받는 것(모두 실제로 OSM 에 찍힌 점): 방범 CCTV(man_made=surveillance), 신호 교차로(highway=traffic_signals),
소화전(emergency=fire_hydrant), 벤치(amenity=bench), 우체통(amenity=post_box),
버스 정류장(highway=bus_stop: 쉼터·벤치·쓰레기통·점자블록 있음/없음과 이름, 6m 안 겹친 점은 하나로).
화면(web/decor.js)은 이 자리에만 세운다. 자리가 차도 안으로 찍힌 것은 화면에서 가장 가까운 길가로 옮긴다(decor.js, 범례에 밝힘).

좌표: web/data/okpo_map.js 의 meta(lat0·lon0·kx·kz)와 같은 미터 좌표(x = 동쪽, z = 남쪽).
실행: python3 -I tools/okpo_street_objs.py   → data/processed/okpo_street_objs.json, web/data/okpo_street_objs.js
"""
import json, os, sys, time, urllib.parse, urllib.request
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from map_osm import MIRRORS, UA


def map_meta():
    s = open(os.path.join(ROOT, 'web', 'data', 'okpo_map.js'), encoding='utf-8').read()
    return json.loads(s[s.index('{'):s.rindex('}') + 1])['meta']


def fetch(q):
    last = None
    for attempt in range(3):
        for url in MIRRORS:
            try:
                req = urllib.request.Request(url, data=urllib.parse.urlencode({'data': q}).encode(), headers={'User-Agent': UA})
                with urllib.request.urlopen(req, timeout=120) as r:
                    return json.load(r)
            except Exception as e:   # 서버가 꽉 차면 다음 미러
                last = e
        time.sleep(10)
    raise SystemExit(f'Overpass 실패: {last}')


def main():
    m = map_meta()
    s, w, n, e = m['bbox']
    bb = f'({s},{w},{n},{e})'
    q = f'[out:json][timeout:90];(node["man_made"="surveillance"]{bb};node["highway"="traffic_signals"]{bb};' \
        f'node["emergency"="fire_hydrant"]{bb};node["amenity"="bench"]{bb};node["amenity"="post_box"]{bb};node["highway"="bus_stop"]{bb};);out body;'
    d = fetch(q)
    X = lambda lon: round((lon - m['lon0']) * m['kx'], 1)
    Z = lambda lat: round((m['lat0'] - lat) * m['kz'], 1)
    out = {'cctv': [], 'signals': [], 'hydrants': [], 'benches': [], 'postboxes': [], 'busstops': []}
    yn = lambda v: True if v == 'yes' else (False if v == 'no' else None)   # 없으면 None(모름)
    for el in d.get('elements', []):
        t, x, z = el.get('tags', {}), X(el['lon']), Z(el['lat'])
        if abs(x) > m['half'][0] or abs(z) > m['half'][1]:
            continue
        rec = {'x': x, 'z': z, 'id': el['id']}
        if t.get('man_made') == 'surveillance':
            rec.update(n=int(t.get('count') or 1), op=t.get('operator', ''), since=t.get('start_date', ''), checked=t.get('check_date', ''))
            out['cctv'].append(rec)
        elif t.get('highway') == 'traffic_signals':
            rec.update(kind=t.get('traffic_signals', ''))
            out['signals'].append(rec)
        elif t.get('emergency') == 'fire_hydrant':
            rec.update(type=t.get('fire_hydrant:type', ''), pos=t.get('fire_hydrant:position', ''))
            out['hydrants'].append(rec)
        elif t.get('amenity') == 'bench':
            out['benches'].append(rec)
        elif t.get('amenity') == 'post_box':
            out['postboxes'].append(rec)
        elif t.get('highway') == 'bus_stop':
            if any(abs(b['x'] - x) < 6 and abs(b['z'] - z) < 6 for b in out['busstops']):
                continue
            rec.update(name=t.get('name:ko') or t.get('name', ''), shelter=yn(t.get('shelter')), bench=yn(t.get('bench')), bin=yn(t.get('bin')), tactile=yn(t.get('tactile_paving')), ref=t.get('ref', ''))
            out['busstops'].append(rec)
    for k in out:
        out[k].sort(key=lambda r: r['id'])
    out['meta'] = {'src': 'OpenStreetMap 기여자(ODbL)', 'fetched': date.today().isoformat(),
                   'n': {k: len(v) for k, v in out.items() if k != 'meta'}}
    os.makedirs(os.path.join(ROOT, 'data', 'processed'), exist_ok=True)
    json.dump(out, open(os.path.join(ROOT, 'data', 'processed', 'okpo_street_objs.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    with open(os.path.join(ROOT, 'web', 'data', 'okpo_street_objs.js'), 'w', encoding='utf-8') as f:
        f.write('/* 자동 생성: tools/okpo_street_objs.py — OSM 거리 시설 점 자료(CCTV·신호 교차로·소화전·벤치·우체통·버스 정류장). 손으로 고치지 말 것 */\n')
        f.write('window.STREET_OBJS = ' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n')
    print(out['meta'])


if __name__ == '__main__':
    main()
