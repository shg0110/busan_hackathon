"""바닥층(web/ground.js) 전용 자료: OSM 에서 지도 자료(okpo_map.js)에 없는 것을 뽑아 web/data/<지역>_ground.js 로 쓴다.
지금 뽑는 것
  - 초등학교·유치원 경계(amenity=school 중 이름에 '초등학교', amenity=kindergarten): 어린이보호구역 노면 표시 자리를 고르는 데 쓴다.
좌표: web/data/<지역>_map.js 의 meta(lat0·lon0·kx·kz)로 [x, z] m 로 바꾼다(tools/map_build.py xz 와 같은 식).
실행: python3 -I tools/map_ground.py okpo
"""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAME = sys.argv[1] if len(sys.argv) > 1 else 'okpo'


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
    out = {'schools': schools, 'src': 'OpenStreetMap amenity=school(이름에 초등학교)·kindergarten, data/raw/osm/' + NAME + '.json'}
    dst = os.path.join(ROOT, 'web', 'data', f'{NAME}_ground.js')
    with open(dst, 'w', encoding='utf-8') as f:
        f.write('/* 자동 생성: tools/map_ground.py. 손으로 고치지 말 것 */\nwindow.GROUND_DATA = ')
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';\n')
    print(os.path.relpath(dst, ROOT), [(s['n'], s['k'], 'p' in s) for s in schools])


if __name__ == '__main__':
    main()
