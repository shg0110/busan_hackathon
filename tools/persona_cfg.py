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
# 상권에 하루 나오는 비율: 근거가 없어 가정(params 에 값이 생기면 그 값을 쓴다)
DEFAULT_SHARE = {'worker': (0.11, 0.066), 'foreign': (0.086, 0.127)}
cfg, notes = {'groups': {}}, []
for g in ('worker', 'foreign', 'resident', 'tourist'):
    v = P.get(g) or {}
    if v.get('total') is None:
        continue
    if v.get('share_wd') is None and g in DEFAULT_SHARE:
        v['share_wd'], v['share_we'] = DEFAULT_SHARE[g]; v['share_src'] = '가정'
    wd = round(v['total'] * (v.get('share_wd') or 0)); we = round(v['total'] * (v.get('share_we') or 0))
    src = f"전체 {v['total']:,}명 — {v.get('total_src', '미확인')} × 상권에 나오는 비율 평일 {v.get('share_wd')}·주말 {v.get('share_we')}({v.get('share_src', '가정')})"
    cfg['groups'][g] = {'wd': wd, 'we': we, 'src': src, 'total': v['total'], 'share_wd': v.get('share_wd'), 'share_we': v.get('share_we')}
    notes.append(f"{g}: 전체 {v['total']:,}명({v.get('total_src')}) × 평일 {v.get('share_wd')} / 주말 {v.get('share_we')}({v.get('share_src', '가정')}) → {wd:,} / {we:,}명")


def hm(s):
    h, m = s.split(':'); return int(h) * 60 + int(m)


sh = P.get('shift') or {}
if sh.get('in') and sh.get('out'):
    a, b = sh['in'].split('-'); c, d = sh['out'].split('-')
    cfg['shift'] = {'in': [hm(a), hm(b)], 'out': [hm(c), hm(d)], 'src': sh.get('src', '미확인')}
pr = P.get('price') or {}
psrc = {}
# 식사: 옥포1·2동 김치찌개백반(각 1곳)의 평균. 카페: 옥포1동 커피. 주점: 술 2병 + 삼겹살 200g 을 둘이 나눔(계산값)
if pr.get('meal'):
    cfg.setdefault('cats', {})['meal'] = {'price': 9250}
    psrc['meal'] = '9,250원 = 거제시 개인서비스 가격(2026-11-26) 옥포1동 10,000·옥포2동 8,500 김치찌개백반 평균(동마다 1곳)'
if pr.get('cafe'):
    cfg.setdefault('cats', {})['cafe'] = {'price': pr['cafe']}
    psrc['cafe'] = f"{pr['cafe']:,}원 = {pr.get('cafe_src', '')}"
if pr.get('pub'):
    v = round((pr['pub'] * 2 + 20000 / 2) / 500) * 500
    cfg.setdefault('cats', {})['pub'] = {'price': v}
    psrc['pub'] = f"{v:,}원 = 소주·맥주 {pr['pub']:,}원 × 2병 + 삼겹살 200g 20,000원 ÷ 2명(계산값, 같은 거제시 자료)"
for c in ('intl', 'mart', 'life'):
    psrc[c] = '가정(가격 자료 없음)'
cfg['price_src'] = psrc
# 외국인 근로자 하루 예산: 월 임금 × 생활비 비율 ÷ 30일
fo = P.get('foreign') or {}
if fo.get('monthly_wage') and (fo.get('spend_ratio_e9') or {}).get('생활비'):
    d = round(fo['monthly_wage'] * fo['spend_ratio_e9']['생활비'] / 30 / 500) * 500
    cfg['foreignDaily'] = {'v': d, 'src': f"월 {fo['monthly_wage']:,}원 × 생활비 {fo['spend_ratio_e9']['생활비']:.1%} ÷ 30일 ≈ {d:,}원 (임금: 거제 2024 이주노동자 실태조사, 비율: 2025 이민자체류실태 E-9 전국)"}
cfg['shift_src'] = (P.get('shift') or {}).get('src', '미확인')
cal_path = os.path.join(ROOT, 'data', 'processed', f'{NAME}_calibration.json')
if os.path.exists(cal_path):
    c = json.load(open(cal_path, encoding='utf-8'))
if os.path.exists(cal_path) and c.get('apply'):
    cfg['scale'] = {'v': c['scale'], 'src': f"상권 안 하루 방문 {c['sim_visits_before']:,}건 → {c['target_visits']:,}건으로 맞춤. 목표 = {c['src']}({c['share_sim_categories']:.1%}). 한계: {c['limits']}"}
    notes.append(f"규모 배율 {c['scale']} ({c['sim_visits_before']} → {c['target_visits']}건)")
elif os.path.exists(cal_path):
    notes.append(f"규모 배율 계산값 {c['scale']}는 적용하지 않음: {c.get('why_not_applied', '')}")
cfg['notes'] = notes
dst = os.path.join(ROOT, 'web', 'data', f'{NAME}_persona.js')
with open(dst, 'w', encoding='utf-8') as f:
    f.write('/* 자동 생성: tools/persona_cfg.py ← data/processed/' + NAME + '_persona_params.json. 손으로 고치지 말 것 */\nwindow.PERSONA_CFG = ')
    json.dump(cfg, f, ensure_ascii=False, indent=1)
    f.write(';\n')
print(dst); print('\n'.join(notes))
