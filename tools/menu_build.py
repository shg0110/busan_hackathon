"""세부 업종·대표 메뉴(data/processed/okpo_menu.json)에 가격 근거(okpo_menu_prices*.csv)를 덮어써 web/data/okpo_menu.js 로 쓴다.

- 가격 근거 우선순위: 옥포1·2동 평균(거제시 개인서비스 가격동향, '확인') > 그 밖의 '확인' > menu.json 의 값(대부분 '가정').
- 평균이 대표값이 아닌 메뉴(가게마다 종류가 달라 가격 폭이 큰 것)는 덮어쓰지 않는다: NO_OVERRIDE.
- 1인 지출 = Σ(가격 × 1인 수량 × 주문 비율). 업종마다 계산해 basket 으로 넣는다.
실행: python3 -I tools/menu_build.py okpo
"""
import csv, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAME = sys.argv[1]
P = os.path.join(ROOT, 'data', 'processed')
M = json.load(open(os.path.join(P, f'{NAME}_menu.json'), encoding='utf-8'))
SUB_KO = {s['ko']: s['id'] for s in M['subs']}
SUB_KO.update({'목욕탕': 'sauna', '호프·요리주점': 'hof'})
# (세부업종 id, 우리 메뉴 이름) ← (가격표 메뉴 이름) 이 다를 때만
ALIAS = {('sauna', '목욕료'): '목욕료', ('hair', '파마'): '파마', ('hof', '병맥주'): '병맥주', ('chicken', '병맥주'): '병맥주'}
# 평균이 대표값이 아닌 것: 커피(프랜차이즈 4,700 vs 저가 1,800), 햄버거(단품 3,800 vs 레스토랑 18,000)
NO_OVERRIDE = {('cafe', '커피'), ('western', '햄버거')}

rows = []
for fn in (f'{NAME}_menu_prices.csv', f'{NAME}_menu_prices_extra.csv'):
    fp = os.path.join(P, fn)
    if os.path.exists(fp):
        rows += list(csv.DictReader(open(fp, encoding='utf-8-sig')))
best = {}
for r in rows:
    sid = SUB_KO.get(r['세부업종'])
    if not sid or not r['가격_원'] or not r['확인여부'].startswith('확인'):
        continue
    key = (sid, r['메뉴'])
    rank = 0 if '옥포' in r['지역'] and r['확인여부'] == '확인' else 1 if r['확인여부'] == '확인' else 2
    if key not in best or rank < best[key][0]:
        best[key] = (rank, r)

used = []
for s in M['subs']:
    for m in s['menus']:
        names = [m['n'], m['n'].replace('백반', '') + '백반', ALIAS.get((s['id'], m['n']), '')]
        hit = next((best[(s['id'], n)] for n in names if n and (s['id'], n) in best and (s['id'], n) not in NO_OVERRIDE), None)
        if hit:
            rank, r = hit
            m['price'] = int(float(r['가격_원']))
            m['src'] = f"{r['지역']} {r['기준시점']} — {r['범위']}" if rank == 0 else f"{r['지역']} {r['기준시점']}"
            m['ok'] = True
            used.append((s['id'], m['n'], m['price']))
        else:
            m['ok'] = m.get('src', '가정') != '가정' and not m['src'].startswith('가정')
    s['basket'] = round(sum(m['price'] * m['qty'] * m['share'] for m in s['menus']) / 100) * 100
    s['confirmed'] = sum(1 for m in s['menus'] if m['ok']), len(s['menus'])

dst = os.path.join(ROOT, 'web', 'data', f'{NAME}_menu.js')
with open(dst, 'w', encoding='utf-8') as f:
    f.write('/* 자동 생성: tools/menu_build.py ← data/processed/okpo_menu.json + okpo_menu_prices*.csv. 손으로 고치지 말 것 */\nwindow.MENU = ')
    json.dump(dict(subs=M['subs'], prefs=M['prefs']), f, ensure_ascii=False, separators=(',', ':'))
    f.write(';\n')
print(dst)
print('가격표로 바꾼 메뉴', len(used))
for s in M['subs']:
    print(f"  {s['ko']:<12} 1인 {s['basket']:>7,}원  근거 있는 메뉴 {s['confirmed'][0]}/{s['confirmed'][1]}")
# 메뉴 구조에 메뉴 추가가 필요한 것(가격표엔 있는데 우리 메뉴엔 없음)
ours = {(s['id'], m['n']) for s in M['subs'] for m in s['menus']}
miss = sorted({k for k in best if k not in ours and best[k][0] == 0})
if miss:
    print('가격표에만 있는 메뉴(필요하면 menu.json 에 추가):', miss)
