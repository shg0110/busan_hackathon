"""인허가 폐업 후보(A·B 등급)를 화면용 web/data/<지역>_vacancy.js 로 쓴다.

입력: data/processed/<지역>_closed_candidates.csv(좌표·업태·면적), <지역>_closed_candidates_floorcheck.csv(건물·층 판정)
- A = 같은 주소에 지금 영업 가게 없음, B = 불확실(옆 세션 tools/localdata_closed.py 기준). C(다시 채워짐)는 화면에 안 올린다.
- strong = A 이면서 우리 층 판정도 '가게 없는 층'. 둘 다 상가정보를 써서 완전히 독립된 검증은 아니다.
- 건물 윤곽 밖에 찍힌 곳(좌표 오차 6~40m)은 가장 가까운 건물에 붙인다.
실행: ~/.venvs/busan-geo/bin/python -I tools/web_vacancy.py okpo
"""
import csv, json, os, sys
from shapely.geometry import Point, Polygon

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAME = sys.argv[1]
L = lambda f: (lambda s: json.loads(s[s.index('{'):s.rindex('}') + 1]))(open(f, encoding='utf-8').read())
M = L(os.path.join(ROOT, 'web', 'data', f'{NAME}_map.js'))
m = M['meta']
xz = lambda la, lo: ((lo - m['lon0']) * m['kx'], -(la - m['lat0']) * m['kz'])
P = os.path.join(ROOT, 'data', 'processed')
raw = {(r['사업장명'], r['폐업일자']): r for r in csv.DictReader(open(os.path.join(P, f'{NAME}_closed_candidates.csv'), encoding='utf-8-sig'))}
chk = list(csv.DictReader(open(os.path.join(P, f'{NAME}_closed_candidates_floorcheck.csv'), encoding='utf-8-sig')))
polys = [Polygon(b['p']) for b in M['buildings']]
out = []
for c in chk:
    g = c['빈점포등급'][:1]
    if g not in ('A', 'B'):
        continue
    r = raw.get((c['사업장명'], c['폐업일자']))
    if not r or not r['위도']:
        continue
    x, z = xz(float(r['위도']), float(r['경도']))
    bi = int(c['건물번호']) if c['건물번호'] else min(range(len(polys)), key=lambda i: polys[i].distance(Point(x, z)))
    out.append(dict(g=g, strong=(g == 'A' and c['층판정'] == 'empty'), n=r['사업장명'], kind=r['업태'] or r['구분'], closed=r['폐업일자'],
                    opened=r['인허가일자'], addr=r['도로명주소'].replace('경상남도 거제시 ', ''), floor=r['층'], area=r['면적_m2'],
                    x=round(x, 1), z=round(z, 1), b=bi, judge=c['층판정'], state=r['현재상태_추정']))
dst = os.path.join(ROOT, 'web', 'data', f'{NAME}_vacancy.js')
with open(dst, 'w', encoding='utf-8') as f:
    f.write('/* 자동 생성: tools/web_vacancy.py — 행정안전부 인허가(일반·휴게음식점) 2024년 이후 폐업 중 A·B 등급. 추정 위치. 손으로 고치지 말 것 */\nwindow.VACANCY = ')
    json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    f.write(';\n')
print(dst, len(out), 'A', sum(o['g'] == 'A' for o in out), 'B', sum(o['g'] == 'B' for o in out), 'strong', sum(o['strong'] for o in out))
for o in out:
    if o['strong']:
        print('  강한 후보:', o['n'], o['addr'], o['closed'])
