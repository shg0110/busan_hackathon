"""가상 손님 수·시간·가격 설정을 web/data/<지역>_persona.js(window.PERSONA_CFG) 로 쓴다.

입력: data/processed/<지역>_persona_params.json
  각 부류: {"total": 확인된 전체 수, "total_src": 출처, "share_wd": 평일 상권에 나오는 비율, "share_we": 주말 비율, "share_src": 출처 또는 "가정"}
  → 화면의 하루 사람 수 = total × share. 전체 수는 근거, 비율은 대부분 가정이라 둘을 나눠 적는다.
  shift: {"in": "06:30-07:40", "out": "17:00-18:30", "src": ...}, price: {업종: 원, "src": ...}
값이 null 이면 sim.js 의 기본(가정) 값을 그대로 쓴다.
실행: python3 -I tools/persona_cfg.py okpo
"""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAME = sys.argv[1]
P = json.load(open(os.path.join(ROOT, 'data', 'processed', f'{NAME}_persona_params.json'), encoding='utf-8'))
cfg, notes = {'groups': {}}, []
for g in ('worker', 'foreign', 'resident', 'tourist'):
    v = P.get(g) or {}
    if v.get('total') is None:
        continue
    wd = round(v['total'] * (v.get('share_wd') or 0)); we = round(v['total'] * (v.get('share_we') or 0))
    src = f"{v.get('total_src', '미확인')} × 비율 {v.get('share_src', '가정')}"
    cfg['groups'][g] = {'wd': wd, 'we': we, 'src': src, 'total': v['total'], 'share_wd': v.get('share_wd'), 'share_we': v.get('share_we')}
    notes.append(f"{g}: 전체 {v['total']:,}명({v.get('total_src')}) × 평일 {v.get('share_wd')} / 주말 {v.get('share_we')}({v.get('share_src', '가정')}) → {wd:,} / {we:,}명")


def hm(s):
    h, m = s.split(':'); return int(h) * 60 + int(m)


sh = P.get('shift') or {}
if sh.get('in') and sh.get('out'):
    a, b = sh['in'].split('-'); c, d = sh['out'].split('-')
    cfg['shift'] = {'in': [hm(a), hm(b)], 'out': [hm(c), hm(d)], 'src': sh.get('src', '미확인')}
pr = P.get('price') or {}
for c in ('meal', 'pub', 'cafe', 'intl', 'mart', 'life'):
    if pr.get(c):
        cfg.setdefault('cats', {})[c] = {'price': pr[c]}
if pr.get('src'):
    cfg['price_src'] = pr['src']
cfg['notes'] = notes
dst = os.path.join(ROOT, 'web', 'data', f'{NAME}_persona.js')
with open(dst, 'w', encoding='utf-8') as f:
    f.write('/* 자동 생성: tools/persona_cfg.py ← data/processed/' + NAME + '_persona_params.json. 손으로 고치지 말 것 */\nwindow.PERSONA_CFG = ')
    json.dump(cfg, f, ensure_ascii=False, indent=1)
    f.write(';\n')
print(dst); print('\n'.join(notes))
