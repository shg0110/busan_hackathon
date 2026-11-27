"""건물 층마다 '가게 등록 없는 상가 층'을 판정해 web/data/<지역>_floors.js 로 쓴다.

입력
- web/data/<지역>_map.js       : 3D 건물(브이월드 PNU 포함, tools/map_build.py)
- data/raw/bldg/<지역>_floors.json : 건축물대장 층별개요(tools/bldg_floors.py)
- data/processed/<지역>_stores.csv : 상가정보 영업 중 가게(tools/sbiz_crop.py)

판정
1) 상가 층 = 층별 용도에 근린생활·판매·숙박·위락·업무가 들어 있는 지상층.
2) 가게를 지번(PNU)으로 건물에 붙인다. 한 지번에 건물이 여럿이면 가게 좌표에서 가장 가까운 건물.
3) 층정보가 있는 가게는 그 층, 층정보가 빈 가게는 아직 가게가 없는 가장 낮은 상가 층에 둔다(추정 표시).
4) 가게가 하나도 없는 상가 층 = '가게 등록 없음'. 실제 공실과 같지 않다: 상가정보에 안 잡히는 사무실·창고·주거 전용으로
   쓰는 경우가 섞인다. 그래서 R-ONE 공실률과 면적 비율을 나란히 보여 주고 차이를 적는다.
실행: python3 -I tools/okpo_floors.py okpo
"""
import csv, json, math, os, re, sys, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAME = sys.argv[1]
s = open(os.path.join(ROOT, 'web', 'data', f'{NAME}_map.js'), encoding='utf-8').read()
MAP = json.loads(s[s.index('{'):s.rindex('}') + 1])
FL = json.load(open(os.path.join(ROOT, 'data', 'raw', 'bldg', f'{NAME}_floors.json'), encoding='utf-8'))
M = MAP['meta']
KX, KZ, LAT0, LON0 = M['kx'], M['kz'], M['lat0'], M['lon0']
xz = lambda la, lo: ((lo - LON0) * KX, -(la - LAT0) * KZ)

# 상가 층: 근린생활·판매·숙박·위락(업무시설=오피스는 R-ONE 상가 공실률에도 안 들어가 뺀다)
COMMERCIAL = ('근린생활', '판매', '숙박', '위락')
# 상가가 아닌 공공·부대 용도(근린생활시설로 등록돼 있어도)
NONCOM = ('경찰', '파출소', '지구대', '국가기관', '청사', '화장실', '주차', '공공', '주민센터', '동사무소', '우체국', '소방', '보건소', '변전', '기계실', '계단')
# 상가정보(소진공)에 잘 안 잡혀 '가게 등록 없음'으로 판정하면 안 되는 쓰임 → 확인 불가
UNKNOWN = ('사무', '의원', '치과', '한의원', '병원', '학원', '교습', '금융', '은행', '교회', '종교', '기원', '독서실', '체력단련',
           '창고', '공장', '제조', '고시원', '다중생활', '기숙')
def is_com(use):
    return any(k in use for k in COMMERCIAL) and not any(k in use for k in NONCOM)

# 건물(지번별)
by_pnu = collections.defaultdict(list)
for i, b in enumerate(MAP['buildings']):
    if b.get('pnu'):
        by_pnu[b['pnu']].append(i)

def centroid(p):
    return (sum(q[0] for q in p) / len(p), sum(q[1] for q in p) / len(p))

# 가게 → 건물
stores = list(csv.DictReader(open(os.path.join(ROOT, 'data', 'processed', f'{NAME}_stores.csv'), encoding='utf-8-sig')))
CAT = {'음식': 'food', '소매': 'shop', '수리·개인': 'svc', '숙박': 'stay', '교육': 'edu', '예술·스포츠': 'leisure',
       '보건의료': 'med', '과학·기술': 'office', '부동산': 'office', '시설관리·임대': 'office'}
b_stores = collections.defaultdict(list)
unplaced = 0
for r in stores:
    cand = by_pnu.get(r['지번코드'], [])
    if not cand:
        unplaced += 1
        continue
    x, z = xz(float(r['위도']), float(r['경도']))
    bi = min(cand, key=lambda i: math.dist(centroid(MAP['buildings'][i]['p']), (x, z)))
    fl = r['층정보'].strip()
    m = re.fullmatch(r'(B)?(\d+)', fl)
    floor = (-int(m.group(2)) if m.group(1) else int(m.group(2))) if m else None
    b_stores[bi].append(dict(n=r['상호명'] + (' ' + r['지점명'] if r['지점명'] else ''), c=CAT.get(r['상권업종대분류명'], 'etc'),
                             cs=r['상권업종소분류명'], f=floor))

# 층별개요 → 건물
out, tot, tot_in = {}, collections.Counter(), collections.Counter()
for pnu, idxs in by_pnu.items():
    rows = FL.get(pnu)
    if not rows:
        continue
    for bi in idxs:
        b = MAP['buildings'][bi]
        dn = b.get('dn', '')
        # 한 지번에 동이 여럿이면 동 이름이 같은 줄만. 동 이름이 없으면 주건축물 줄.
        mine = [r for r in rows if r['dong'] == dn] if dn else []
        if not mine:
            dongs = {r['dong'] for r in rows}
            if len(dongs) > 1:
                # 한 지번에 동이 여럿(상가동+아파트동 등)인데 이 건물 동 이름을 모르면 층을 섞지 않으려고 판정하지 않는다
                continue
            mine = [r for r in rows if r['main'] in ('주건축물', '')] if len(idxs) > 1 else rows
        if not mine:
            continue
        floors = collections.OrderedDict()
        for r in sorted(mine, key=lambda r: (r['gb'] != '지상', int(r['no'] or 0))):
            if r['gb'] != '지상':
                continue
            n = int(r['no'] or 0)
            if n <= 0:
                continue
            f = floors.setdefault(n, dict(n=n, uses=[], area=0.0))
            u = r['etc'] or r['use']
            if u not in f['uses']:
                f['uses'].append(u)
            try:
                f['area'] += float(r['area'] or 0)
            except ValueError:
                pass
        if not floors:
            continue
        flist = list(floors.values())
        for f in flist:
            f['com'] = any(is_com(u) for u in f['uses']) or any(is_com(r['use']) for r in mine if int(r['no'] or 0) == f['n'] and r['gb'] == '지상')
            f['stores'] = []
            f['inferred'] = False
        st = b_stores.get(bi, [])
        for s_ in st:
            if s_['f'] and s_['f'] > 0 and s_['f'] in floors:
                floors[s_['f']]['stores'].append(s_)
        for s_ in st:   # 층정보 없는 가게: 가게 없는 가장 낮은 상가 층 → 없으면 1층
            if s_['f'] is None or s_['f'] not in floors:
                tgt = next((f for f in flist if f['com'] and not f['stores']), None) or next((f for f in flist if f['com']), None) or flist[0]
                tgt['stores'].append(s_); tgt['inferred'] = True
        # 한 업소가 여러 층을 쓰는 경우(모텔·학원·큰 식당): 영업 중인 층과 쓰임이 같은 층은 함께 쓰는 것으로 본다(추정)
        open_uses = {u for f in flist if f['stores'] for u in f['uses']}
        for f in flist:
            f['area'] = round(f['area'], 1)
            if f['com'] and not f['stores'] and any(u in open_uses for u in f['uses']) and \
                    any(not re.fullmatch(r'(제[12]종)?\s*근린생활시설', u) for u in f['uses']):
                f['state'] = 'open'; f['spread'] = True
            elif f['com']:
                f['state'] = 'open' if f['stores'] else ('unknown' if all(any(k in u for k in UNKNOWN) for u in f['uses']) else 'empty')
            else:
                f['state'] = 'home' if any('주택' in u or '주거' in u for u in f['uses']) else 'other'
            if f['com']:
                for T in ([tot, tot_in] if b.get('i') else [tot]):
                    T['com_floors'] += 1; T['com_area'] += f['area']
                    T[f['state'] + '_floors'] += 1; T[f['state'] + '_area'] += f['area']
        out[bi] = flist

def summary(T):
    known = T['open_area'] + T['empty_area']   # 확인 불가 층은 비율에서 뺀다
    return dict(com_floors=T['com_floors'], open_floors=T['open_floors'], empty_floors=T['empty_floors'], unknown_floors=T['unknown_floors'],
                com_area=round(T['com_area']), open_area=round(T['open_area']), empty_area=round(T['empty_area']), unknown_area=round(T['unknown_area']),
                empty_area_pct=round(100 * T['empty_area'] / known, 1) if known else None)
known = tot['open_area'] + tot['empty_area']
stats = dict(inside=summary(tot_in), whole=summary(tot),buildings=len(out), com_floors=tot['com_floors'], empty_floors=tot['empty_floors'], open_floors=tot['open_floors'],
             unknown_floors=tot['unknown_floors'], com_area=round(tot['com_area']), empty_area=round(tot['empty_area']),
             unknown_area=round(tot['unknown_area']),
             empty_area_pct=round(100 * tot['empty_area'] / known, 1) if known else None,
             stores=len(stores), stores_placed=len(stores) - unplaced, pnus_with_floors=sum(1 for v in FL.values() if v), pnus=len(FL))
dst = os.path.join(ROOT, 'web', 'data', f'{NAME}_floors.js')
with open(dst, 'w', encoding='utf-8') as f:
    f.write('/* 자동 생성: tools/okpo_floors.py — 건축물대장 층별개요 + 상가정보(2026-09) 대조. 손으로 고치지 말 것 */\nwindow.FLOORS = ')
    json.dump(dict(stats=stats, b={str(k): v for k, v in out.items()}), f, ensure_ascii=False, separators=(',', ':'))
    f.write(';\n')
print(dst, round(os.path.getsize(dst) / 1024), 'KB', stats)
