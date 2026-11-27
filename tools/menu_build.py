"""세부 업종·대표 메뉴(data/processed/okpo_menu.json)에 가격 근거(okpo_menu_prices*.csv)를 덮어써 web/data/okpo_menu.js 로 쓴다.

- 가격 근거 우선순위: 옥포1·2동 평균(거제시 개인서비스 가격동향, '확인') > 그 밖의 '확인' > menu.json 의 값(대부분 '가정').
- 평균이 대표값이 아닌 메뉴(가게마다 종류가 달라 가격 폭이 큰 것)는 덮어쓰지 않는다: NO_OVERRIDE.
- 1인 지출 = Σ(가격 × 1인 수량 × 주문 비율). 업종마다 계산해 basket 으로 넣는다.
실행: python3 -I tools/menu_build.py okpo
"""
import collections, csv, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAME = sys.argv[1]
P = os.path.join(ROOT, 'data', 'processed')
M = json.load(open(os.path.join(P, f'{NAME}_menu.json'), encoding='utf-8'))
SUB_KO = {s['ko']: s['id'] for s in M['subs']}
SUB_KO.update({'목욕탕': 'sauna', '호프·요리주점': 'hof', '할랄·중앙아시아': 'halal', '경양식·피자·버거': 'western'})   # 가격표의 옛 업종 이름(버거를 떼기 전)
# 우리 메뉴 이름 → 가격표 (메뉴, 단위). 단위가 None 이면 단위는 보지 않는다. 없으면 같은 이름
MAP = {('baekban', '김치찌개백반'): ('김치찌개백반', None), ('hoe', '광어회'): ('실속 광어회', None), ('hoe', '매운탕'): ('매운탕', '1냄비'),
       ('hof', '안주'): ('대표 안주', None), ('noraebang', '노래방 1시간'): ('노래방 이용료', None), ('viet', '분짜·반미'): ('분짜 또는 반미', None),
       ('halal', '나시고랭·플로프'): ('나시고랭 또는 플로프', None)}
# 평균이 대표값이 아닌 것: 커피(프랜차이즈 4,700 vs 저가 1,800). 햄버거는 '버거' 업종으로 떼어 프랜차이즈 정가로 둔다
NO_OVERRIDE = {('cafe', '커피')}
DRINKS = {'소주', '병맥주', '생맥주'}

def level(r):
    """근거 수준: okpo(옥포 업소 값) < geoje(옥포 밖 거제·옆 동) < wide(전국 정가·경남 평균)"""
    ok = r['확인여부']
    if ok == '확인' and '옥포' in (r['지역'] + r['범위']):
        return 0, 'okpo', '옥포'
    if '거제' in ok or '옆 동' in ok or '거제' in r['지역']:
        return 1, 'geoje', '거제'
    return 2, 'wide', '전국' if '전국' in ok else '경남' if '경남' in ok else '참고'

rows = []
for fn in (f'{NAME}_menu_prices.csv', f'{NAME}_menu_prices_extra.csv'):
    fp = os.path.join(P, fn)
    if os.path.exists(fp):
        rows += list(csv.DictReader(open(fp, encoding='utf-8-sig')))
cand = {}
for r in rows:
    sid = SUB_KO.get(r['세부업종'])
    if not sid or not r['가격_원'] or not r['확인여부'].startswith('확인'):
        continue
    if '건당' in r['확인여부'] or '건당' in r['메뉴'] or '비교용' in r['확인여부']:   # 카드 결제 1건당·비교용 행은 메뉴 가격으로 쓰지 않음
        continue
    cand.setdefault((sid, r['메뉴']), []).append(r)

used = []
for s in M['subs']:
    for m in s['menus']:
        key = (s['id'], m['n'])
        cm, cu = MAP.get(key, (m['n'], None))
        rs = [r for r in cand.get((s['id'], cm), []) if cu is None or r['단위'] == cu]
        if not rs and cm in DRINKS:   # 술값은 업종이 달라도 같은 옥포 가게 값(예: 횟집 소주 ← 고깃집 줄의 소주)
            rs = [r for (sid2, n2), lst in cand.items() if n2 == cm for r in lst]
        if rs and key not in NO_OVERRIDE:
            r = min(rs, key=lambda r: level(r)[0])
            _, lvl, badge = level(r)
            m['price'] = int(float(r['가격_원']))
            m['src'] = f"{r['지역']} {r['기준시점']} — {r['범위'] or r['출처'][:80]}"
            m['lvl'], m['badge'] = lvl, badge
            used.append((s['id'], m['n'], m['price'], lvl))
        elif '카드' in m.get('src', ''):
            m['lvl'], m['badge'] = 'card', '카드'
        elif m.get('src', '가정').startswith('가정'):
            m['lvl'], m['badge'] = 'guess', '가정'
        elif m['src'].startswith('전국'):   # 프랜차이즈 전국 정가(예: 버거 단품)
            m['lvl'], m['badge'] = 'wide', '전국'
        else:   # menu.json 에 직접 적은 근거(예: 카페 아메리카노 옥포1동 4,700)
            m['lvl'], m['badge'] = 'okpo', '옥포'
        m['ok'] = m['lvl'] != 'guess'
    s['basket'] = round(sum(m['price'] * m['qty'] * m['share'] for m in s['menus']) / 100) * 100
    s['confirmed'] = sum(1 for m in s['menus'] if m['ok']), len(s['menus'])

dst = os.path.join(ROOT, 'web', 'data', f'{NAME}_menu.js')
with open(dst, 'w', encoding='utf-8') as f:
    f.write('/* 자동 생성: tools/menu_build.py ← data/processed/okpo_menu.json + okpo_menu_prices*.csv. 손으로 고치지 말 것 */\nwindow.MENU = ')
    json.dump(dict(subs=M['subs'], prefs=M['prefs']), f, ensure_ascii=False, separators=(',', ':'))
    f.write(';\n')
print(dst)
print('가격표로 바꾼 메뉴', len(used), collections.Counter(u[3] for u in used))
for s in M['subs']:
    print(f"  {s['ko']:<12} 1인 {s['basket']:>7,}원  근거 있는 메뉴 {s['confirmed'][0]}/{s['confirmed'][1]}")
# 가격표에 있는데 우리 메뉴에 안 쓰인 것(필요하면 menu.json 에 추가)
ours = {(s['id'], MAP.get((s['id'], m['n']), (m['n'], None))[0]) for s in M['subs'] for m in s['menus']}
miss = sorted(k for k in cand if k not in ours)
if miss:
    print('가격표에만 있는 메뉴:', miss)
