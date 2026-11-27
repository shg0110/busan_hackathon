"""시뮬레이션 자료(가게·집·입구)를 web/data/<지역>_sim.js 로 쓴다.

- 가게: 상가정보(2026-09) 영업 중 가게. 시뮬레이션 업종은 아래 CAT 규칙으로 나눈다. 위치는 상가정보 좌표.
- 집: 사람이 사는 층의 바닥 넓이를 무게로 쓴다(공동주택·단독주택 건물, 건축물대장에서 '주택' 층). 원룸·다가구 많은 단독주택 쪽과
  아파트 쪽을 나눠 둔다(외국인 근로자 집 고르기에 씀 — 가정, docs/okpo-sim-assumptions.md).
- 입구: 조선소 쪽(범위 남·동쪽 끝에서 밖으로 나가는 큰길 끝 — 실제 문 위치 아님, 가정), 버스 정류장(OSM).
실행: python3 -I tools/okpo_sim_data.py okpo
"""
import csv, json, math, os, re, sys, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAME = sys.argv[1]
load = lambda p: (lambda s: json.loads(s[s.index('{'):s.rindex('}') + 1]))(open(p, encoding='utf-8').read())
MAP = load(os.path.join(ROOT, 'web', 'data', f'{NAME}_map.js'))
FLO = load(os.path.join(ROOT, 'web', 'data', f'{NAME}_floors.js'))
M = MAP['meta']
xz = lambda la, lo: (round((lo - M['lon0']) * M['kx'], 1), round(-(la - M['lat0']) * M['kz'], 1))
HX, HZ = M['half']

# ── 시뮬레이션 업종 ───────────────────────────────────────
# meal 식사, pub 주점, cafe 카페·빵, intl 다국적 식당, mart 장보기, life 생활 서비스(미용·세탁·휴대폰 등)
def sim_cat(big, mid, small, name):
    if big == '음식':
        if mid == '주점':
            return 'pub'
        if mid in ('동남아시아', '기타 외국식') or re.search(r'베트남|태국|인도|네팔|우즈벡|몽골|필리핀|스리랑카|할랄|케밥|쌀국수', small + name):
            return 'intl'
        if mid == '비알코올 ' or mid.strip() == '비알코올' or '빵' in small or '도넛' in small or '떡' in small:
            return 'cafe'
        return 'meal'
    if big == '소매':
        if mid in ('종합 소매', '식료품 소매'):
            return 'mart'
        if '핸드폰' in small or '통신' in mid:
            return 'life'
        return None   # 옷·가구 등은 이번 시뮬레이션 목적지에서 뺀다(하루 동선 대상 아님)
    if big == '수리·개인' and mid in ('이용·미용', '세탁', '욕탕·신체관리'):
        return 'life'
    return None


# R-ONE 상권 경계 안인지(규모 맞추기에 씀)
BND = MAP.get('boundary') or []
def inside(pt):
    x, z = pt; c = False
    for i in range(len(BND)):
        x1, z1 = BND[i]; x2, z2 = BND[i - 1]
        if (z1 > z) != (z2 > z) and x < (x2 - x1) * (z - z1) / (z2 - z1 + 1e-12) + x1:
            c = not c
    return c
stores = list(csv.DictReader(open(os.path.join(ROOT, 'data', 'processed', f'{NAME}_stores.csv'), encoding='utf-8-sig')))
# 세부 업종: data/processed/<지역>_menu.json 의 match(상가정보 소분류)로 정한다. 맞는 세부 업종이 없으면 큰 업종 규칙(sim_cat)만
MENU = json.load(open(os.path.join(ROOT, 'data', 'processed', f'{NAME}_menu.json'), encoding='utf-8'))
SUB_OF = {m: (s['id'], s['cat']) for s in MENU['subs'] for m in s['match']}
# 가게 → 건물·층: tools/okpo_floors.py 결과에서 이름으로 찾는다(같은 판정 규칙을 두 번 쓰지 않게)
shop_floor = {}
for bi, fl in FLO['b'].items():
    for f in fl:
        for s in f['stores']:
            shop_floor.setdefault(s['n'], []).append((int(bi), f['n']))
# 폐업: 인허가 폐업 기록(data/processed/<지역>_closed_candidates.csv)과 상호·도로명 주소(길 이름 + 건물 번호)가 둘 다 같으면
# 상가정보에 남아 있어도 뺀다. 이름만 같고 주소가 다르면(다른 자리의 같은 이름 가게) 그대로 둔다.
# 한계: 명의 변경으로 폐업 후 같은 이름으로 다시 인허가받은 가게도 빠질 수 있다(지금 영업 인허가 자료와 대조 못 함)
road = lambda a: re.split(r'\s*[,(]', a or '')[0].strip()
nkey = lambda n: re.sub(r'\s|옥포점$', '', n or '')
CLOSED_FP = os.path.join(ROOT, 'data', 'processed', f'{NAME}_closed_candidates.csv')
CLOSED = {(nkey(r['사업장명']), road(r['도로명주소'])) for r in csv.DictReader(open(CLOSED_FP, encoding='utf-8-sig'))} if os.path.exists(CLOSED_FP) else set()
closed_out = []
shops = []
for r in stores:
    if (nkey(r['상호명']), road(r['도로명주소'])) in CLOSED:
        closed_out.append(r['상호명']); continue
    sub, c = SUB_OF.get(r['상권업종소분류명'], (None, None))
    if sub == 'burger' and re.search(r'피자|파파존스', r['상호명']):   # 상가정보가 '버거'로 적은 피자집(파파존스)
        sub, c = SUB_OF['피자']
    if not c:
        c = sim_cat(r['상권업종대분류명'], r['상권업종중분류명'], r['상권업종소분류명'], r['상호명'])
        sub = {'meal': 'baekban', 'pub': 'hof', 'cafe': 'cafe', 'intl': 'viet', 'mart': 'grocery', 'life': 'hair'}.get(c)
    if not c:
        continue
    x, z = xz(float(r['위도']), float(r['경도']))
    if abs(x) > HX or abs(z) > HZ:
        continue
    nm = r['상호명'] + (' ' + r['지점명'] if r['지점명'] else '')
    loc = shop_floor.get(nm, [])
    bi, fl = (loc[0] if loc else (-1, None))
    shops.append(dict(n=nm, c=c, sub=sub, cs=r['상권업종소분류명'], x=x, z=z, b=bi, f=fl, i=int(inside((x, z)))))

# ── 집 ───────────────────────────────────────────────────
homes = []
for i, b in enumerate(MAP['buildings']):
    fl = FLO['b'].get(str(i))
    res_area = 0.0
    if fl:
        res_area = sum(f['area'] for f in fl if f['state'] == 'home')
    elif b['k'] in ('apartments', 'house') and b.get('real'):
        res_area = b['a'] * b['lv'] * 0.8
    if res_area < 30:
        continue
    cx = sum(p[0] for p in b['p']) / len(b['p']); cz = sum(p[1] for p in b['p']) / len(b['p'])
    kind = 'apt' if (b['k'] == 'apartments' or (b.get('use') == '공동주택' and b['lv'] >= 5)) else 'house'
    homes.append(dict(x=round(cx, 1), z=round(cz, 1), w=round(res_area), k=kind, b=i))

# ── 입구 ─────────────────────────────────────────────────
# 조선소 쪽 입구: OSM 차단기(lift_gate) 가운데 옥포 상권에 가장 가까운 것(조선소 서쪽 경계).
# 정문은 아주동(거제대로 3370)이라 범위 밖. 문별 출퇴근 인원·통근버스 지점은 미확인(docs/okpo-persona-sources.md).
GATE_LL = [(34.887890, 128.690999, '조선소 서쪽 차단기(OSM, 문별 인원 미확인)')]
gates = []
for la, lo, n in GATE_LL:
    x, z = xz(la, lo)
    gates.append(dict(x=x, z=z, n=n))
osm = json.load(open(os.path.join(ROOT, 'data', 'raw', 'osm', f'{NAME}.json'), encoding='utf-8'))
stops = []
for e in osm['elements']:
    t = e.get('tags', {})
    if e['type'] == 'node' and t.get('highway') == 'bus_stop':
        x, z = xz(e['lat'], e['lon'])
        if abs(x) < HX and abs(z) < HZ and not any(math.dist((x, z), (s['x'], s['z'])) < 40 for s in stops):
            stops.append(dict(x=x, z=z, n=t.get('name', '')))

in_all = sum(1 for r in stores if inside(xz(float(r['위도']), float(r['경도']))))
in_sim = sum(1 for s_ in shops if s_['i'])
out = dict(shops=shops, homes=homes, gates=gates, stops=stops, inside=dict(stores_all=in_all, stores_sim=in_sim),
           counts=dict(shops=len(shops), by_cat=collections.Counter(s['c'] for s in shops), by_sub=collections.Counter(s['sub'] for s in shops), homes=len(homes),
                       home_area=round(sum(h['w'] for h in homes)), gates=len(gates), stops=len(stops), closed_dropped=closed_out))
dst = os.path.join(ROOT, 'web', 'data', f'{NAME}_sim.js')
with open(dst, 'w', encoding='utf-8') as f:
    f.write('/* 자동 생성: tools/okpo_sim_data.py — 손으로 고치지 말 것 */\nwindow.SIM_DATA = ')
    json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
    f.write(';\n')
print(dst, round(os.path.getsize(dst) / 1024), 'KB', out['counts'])
print('조선소 쪽 입구', gates)
print('폐업으로 뺀 가게', closed_out)
