"""OpenStreetMap(Overpass API)에서 3D 바탕 지도 자료를 받는다(지역은 tools/map_regions.py).

받는 것: 건물, 도로·보행로, 지하철(역·출입구·선로), 공원·광장, 바다·물가(해안선 포함), 이름 있는 장소.
공용 Overpass 서버가 자주 꽉 차서(502), 미러 여러 곳을 돌아가며 기다렸다가 다시 시도한다.

실행:
  python3 -I tools/map_osm.py okpo                         # 범위 전체 → data/raw/osm/okpo.json
  python3 -I tools/map_osm.py --names "옥포|거제" 34.85,128.65,34.92,128.75   # 이름으로 장소 찾기(남,서,북,동 근처, 저장 안 함)
"""
import json, os, sys, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from map_regions import bbox as region_bbox


MIRRORS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
]
UA = 'map-research-script/1.0'


def overpass(query):
    wait = 5
    for attempt in range(4):
        for url in MIRRORS:
            try:
                req = urllib.request.Request(url, data=urllib.parse.urlencode({'data': query}).encode(),
                                             headers={'User-Agent': UA})
                body = urllib.request.urlopen(req, timeout=180).read()
                if body[:1] == b'{':
                    return json.loads(body)
                print(f'  {url} 응답이 JSON 아님: {body[:60]!r}', file=sys.stderr)
            except Exception as e:
                print(f'  {url} 실패: {e}', file=sys.stderr)
        print(f'  모든 미러 실패, {wait}초 뒤 다시', file=sys.stderr)
        time.sleep(wait); wait *= 2
    raise SystemExit('Overpass 서버에서 받지 못함')


def main():
    if len(sys.argv) > 3 and sys.argv[1] == '--names':
        s, w, n, e = map(float, sys.argv[3].split(','))
        q = (f'[out:json][timeout:90];nwr["name"~"{sys.argv[2]}"]({s},{w},{n},{e});'
             'out center tags;')
        seen = set()
        for el in overpass(q)['elements']:
            c = el.get('center', el); t = el['tags']
            kind = next((t[k] for k in ('railway', 'highway', 'amenity', 'leisure', 'shop', 'place', 'tourism', 'building') if k in t), '')
            key = (t.get('name'), kind)
            if key in seen:
                continue
            seen.add(key)
            print(el['type'], t.get('name'), kind, round(c['lat'], 5), round(c['lon'], 5))
        return
    name = sys.argv[1]
    s, w, n, e = BBOX = region_bbox(name)
    OUT = os.path.join(ROOT, 'data', 'raw', 'osm', f'{name}.json')
    b = f'({s},{w},{n},{e})'
    q = f"""[out:json][timeout:180];
(
  way["building"]{b}; relation["building"]{b};
  way["building:part"]{b};
  way["highway"]{b};
  way["railway"]{b}; node["railway"]{b}; node["public_transport"]{b};
  way["leisure"]{b}; relation["leisure"]{b};
  way["landuse"]{b}; relation["landuse"]{b};
  way["place"="square"]{b}; way["area:highway"]{b};
  way["natural"]{b}; relation["natural"]{b};
  way["man_made"]{b};
  way["amenity"]{b};
  node["amenity"]{b}; node["shop"]{b}; node["tourism"]{b};
);
out body geom;"""
    d = overpass(q)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    d['_bbox'] = BBOX
    d['_fetched'] = time.strftime('%Y-%m-%d %H:%M')
    json.dump(d, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)
    kinds = {}
    for el in d['elements']:
        t = el.get('tags', {})
        k = 'building' if 'building' in t or 'building:part' in t else next((x for x in ('highway', 'railway', 'natural', 'leisure', 'landuse', 'amenity', 'shop') if x in t), 'other')
        kinds[k] = kinds.get(k, 0) + 1
    print(OUT, len(d['elements']), '개', kinds)


if __name__ == '__main__':
    main()
