"""웹 화면에서 가상 시민을 눌렀을 때 보여 줄 페르소나 속성 번들(web/data/okpo_persona_profiles.js).

입력: data/processed/personas/personas.jsonl (tools/build_personas.py 출력)
출력: web/data/okpo_persona_profiles.js — window.PERSONA_PROFILES

- 순서는 web/data/okpo_personas.js 의 p 배열과 같다(둘 다 build_personas.py 의 clean_people 순서).
  시뮬(sim.js)의 사람은 번들 번호(pi)를 갖고, 이 파일의 같은 번호 줄을 읽는다.
- 글자 값은 사전(dict)에 한 번만 두고 줄에는 번호만 넣어 크기를 줄인다(약 1.4MB). 화면은 사람을 처음 누를 때만 이 파일을 불러온다.
- 맞는지 확인: 번들과 도착 시각·예산·최대 대기가 한 줄이라도 다르면 멈춘다(페르소나를 다시 만든 뒤 번들만 바뀐 경우).

실행: python3 tools/persona_profiles_web.py  (build_personas.py 끝에서도 부른다)
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'data', 'processed', 'personas', 'personas.jsonl')
BUNDLE = os.path.join(ROOT, 'web', 'data', 'okpo_personas.js')
OUT = os.path.join(ROOT, 'web', 'data', 'okpo_persona_profiles.js')

# (화면 키, jsonl 키). 글자 값은 사전 번호로, 숫자·참거짓은 그대로
TEXT = [
    ('seg', 'segment_ko'), ('sex', 'sex'), ('home', 'home_area'), ('nat', 'nationality'), ('visa', 'visa'),
    ('occ', 'occupation_synthetic'), ('ind', 'work_industry'), ('lodge', 'lodging_type_synthetic'),
    ('school', 'school_level'), ('kor', 'korean_ability_synthetic'), ('purpose', 'visit_purpose_synthetic'),
    ('trans', 'transport_synthetic'), ('psens', 'price_sensitivity_synthetic'),
]
NUM = [('age', 'age'), ('grade', 'school_grade'), ('party', 'party_size_synthetic')]
BOOL = [('child', 'with_child_synthetic'), ('workin', 'workplace_in_okpo1_synthetic')]
CRIT = ['가격', '맛', '접근성', '대기', '분위기', '언어·익숙함']


def read_bundle():
    with open(BUNDLE, encoding='utf-8') as f:
        txt = f.read()
    return json.loads(txt[txt.index('{'):txt.rstrip().rstrip(';').rindex('}') + 1])


def main():
    with open(SRC, encoding='utf-8') as f:
        people = [json.loads(line) for line in f if line.strip()]
    bundle = read_bundle()
    if len(bundle['p']) != len(people):
        sys.exit(f'번들 {len(bundle["p"])}명 ≠ personas.jsonl {len(people)}명 — build_personas.py 를 다시 돌릴 것')
    for i, (r, p) in enumerate(zip(bundle['p'], people)):
        if (r[2], r[3], r[6], r[7]) != (p['weekday_arrival_min'], p['weekend_arrival_min'], p['visit_budget_krw_synthetic'], p['max_wait_minutes_synthetic']):
            sys.exit(f'{i}번째 사람이 번들과 다름({p["persona_id"]}) — build_personas.py 를 다시 돌릴 것')

    dicts = {k: [] for k, _ in TEXT}
    index = {k: {} for k, _ in TEXT}
    cols = [k for k, _ in TEXT] + [k for k, _ in NUM] + [k for k, _ in BOOL] + ['crit']
    rows = []
    for p in people:
        row = []
        for k, src in TEXT:
            v = p.get(src)
            if v is None or v == '':
                row.append(-1)
                continue
            if v not in index[k]:
                index[k][v] = len(dicts[k])
                dicts[k].append(v)
            row.append(index[k][v])
        for _, src in NUM:
            v = p.get(src)
            row.append(-1 if v is None or v == '' else int(v))
        for _, src in BOOL:
            row.append(1 if p.get(src) else 0)
        cw = p.get('decision_criteria_weights_synthetic') or {}
        row.append([int(round((cw.get(c) or 0) * 100)) for c in CRIT])   # 고르는 기준 비중(%)
        rows.append(row)

    ids = [p['persona_id'] for p in people]
    pref = ids[0][:-5] if ids else 'OP-P'
    seq = all(x == f'{pref}{i + 1:05d}' for i, x in enumerate(ids))
    payload = {
        'version': bundle['version'], 'n': len(people), 'cols': cols, 'dict': dicts, 'crit': CRIT,
        'id': {'prefix': pref, 'width': 5} if seq else ids,   # 번호가 1부터 차례면 규칙만
        'r': rows,
    }
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write('/* 자동 생성: tools/persona_profiles_web.py ← data/processed/personas/personas.jsonl. 순서 = okpo_personas.js 의 p */\n'
                'window.PERSONA_PROFILES = ')
        json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))
        f.write(';\n')
    print(f'{OUT}: {len(people):,}명, {os.path.getsize(OUT) / 1e6:.2f}MB')


if __name__ == '__main__':
    main()
