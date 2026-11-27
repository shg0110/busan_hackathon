"""부산 상권 종합 순위표를 만든다: R-ONE 공실률(2026년 3분기) + 부산시 다시채움 빈 점포 수.

입력: data/raw/reb/vacancy_busan.csv (tools/reb_fetch_busan.py), data/processed/refill_stores.csv
출력: data/processed/busan_ranking.csv, 표준출력에 마크다운 표(docs/busan-ranking.md 에 붙여 씀)
실행: python3 -I tools/build_ranking.py
"""
import csv, collections, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LATEST, BASE = '202603', '202403'

# 다시채움 상권 → R-ONE 상권. '같음'은 이름·위치가 같은 곳, '인접'은 근처 상권이라 범위가 같은지 모름.
REFILL_TO_RONE = {
    '부산대 자율상권': ('부산대학앞', '같음'),
    '덕천젊음의거리 일대': ('덕천역', '같음'),
    '하단 자율상권': ('하단역', '같음'),
    '동래시장': ('동래역', '인접'),
    '영도 봉래시장': ('남항동', '인접'),
    '유엔남구대학로 자율상권': ('경성대/부경대', '인접'),
    '서동미로시장': (None, '해당 상권 없음'),
}

vac = collections.defaultdict(dict)
for r in csv.DictReader(open(os.path.join(ROOT, 'data/raw/reb/vacancy_busan.csv'), encoding='utf-8-sig')):
    vac[r['상권']][(r['상가유형'], r['분기'])] = float(r['공실률_%'])

refill = collections.defaultdict(lambda: {'1차': 0, '2차': 0, '이름': set(), '맞춤': ''})
for r in csv.DictReader(open(os.path.join(ROOT, 'data/processed/refill_stores.csv'), encoding='utf-8-sig')):
    rone, how = REFILL_TO_RONE[r['상권']]
    key = rone or r['상권']
    refill[key][r['차수']] += 1
    refill[key]['이름'].add(r['상권'])
    refill[key]['맞춤'] = how

rows = []
for s, d in vac.items():
    if s == '부산' or (('일반', LATEST) not in d):
        continue  # 부산 전체는 비교 기준 줄로 따로, 집합 상가만 있는 신도시 상권은 제외
    f = refill.get(s)
    rows.append({
        '상권': s,
        '일반': d.get(('일반', LATEST)), '중대형': d.get(('중대형', LATEST)),
        '소규모': d.get(('소규모', LATEST)), '1층': d.get(('일반_1층', LATEST)),
        '일반_2년전': d.get(('일반', BASE)),
        '다시채움_1차': f['1차'] if f else 0, '다시채움_2차': f['2차'] if f else 0,
        '다시채움_상권': '·'.join(sorted(f['이름'])) if f else '',
        '맞춤': f['맞춤'] if f else '',
    })
rows.sort(key=lambda x: -x['일반'])

with open(os.path.join(ROOT, 'data/processed/busan_ranking.csv'), 'w', encoding='utf-8-sig', newline='') as fp:
    w = csv.DictWriter(fp, fieldnames=list(rows[0].keys()))
    w.writeheader(); w.writerows(rows)

fmt = lambda v: '-' if v is None else f'{v:.1f}'
def delta(a, b):
    return '-' if a is None or b is None else f'{b - a:+.1f}'
# 판단은 건물 전체(일반 상가) 공실률로 한다(사용자 지시 11-27: 1층만 보지 말 것). 1층 값은 CSV에만 남긴다.
print('| 순위 | 상권(R-ONE) | 일반 상가(건물 전체) | 중대형 | 소규모 | 일반 상가 2년 변화 | 시 빈 점포 1차/2차 | 다시채움 상권(맞춤) |')
print('|---:|---|---:|---:|---:|---:|---:|---|')
for i, x in enumerate(rows, 1):
    rf = f"{x['다시채움_1차']} / {x['다시채움_2차']}" if x['다시채움_상권'] else ''
    nm = f"{x['다시채움_상권']}({x['맞춤']})" if x['다시채움_상권'] else ''
    print(f"| {i} | {x['상권']} | **{fmt(x['일반'])}** | {fmt(x['중대형'])} | {fmt(x['소규모'])} "
          f"| {delta(x['일반_2년전'], x['일반'])} | {rf} | {nm} |")
b = vac['부산']
print(f"| | *부산 전체* | *{fmt(b.get(('일반', LATEST)))}* | *{fmt(b.get(('중대형', LATEST)))}* | *{fmt(b.get(('소규모', LATEST)))}* "
      f"| *{delta(b.get(('일반', BASE)), b.get(('일반', LATEST)))}* | | |")
sd = refill.get('서동미로시장')
if sd:
    print(f"\n표에 없는 다시채움 상권: 서동미로시장(금정구) 1차 {sd['1차']} / 2차 {sd['2차']} — R-ONE에 해당 상권 없음")
