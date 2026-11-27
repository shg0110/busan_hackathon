"""소상공인시장진흥공단 상가(상권)정보 시·도 파일에서 지역 범위 가게만 잘라 data/processed/<지역>_stores.csv 로 저장.

- 원본(시·도 파일, 경남 94MB)은 data/raw/sbiz/ 에 두고 커밋하지 않는다(.gitignore). 잘라낸 파일만 커밋한다.
- '지번코드'(19자리)는 브이월드 건물 PNU 와 같은 형식이라 가게를 건물에 지번으로 붙일 수 있다.
- 이 자료는 '지금 영업 중'으로 등록된 가게만 담는다(폐업 가게는 없음). 기준일은 파일 이름(2026-09-30)을 따른다.
실행: python3 -I tools/sbiz_crop.py okpo "data/raw/sbiz/소상공인시장진흥공단_상가(상권)정보_경남_202609.csv"
"""
import csv, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from map_regions import bbox as region_bbox

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAME, SRC = sys.argv[1], sys.argv[2]
S, W, N, E = region_bbox(NAME)
OUT = os.path.join(ROOT, 'data', 'processed', f'{NAME}_stores.csv')
COLS = ['상가업소번호', '상호명', '지점명', '상권업종대분류명', '상권업종중분류명', '상권업종소분류명', '표준산업분류명',
        '시군구명', '행정동명', '법정동명', '지번코드', '지번주소', '도로명주소', '건물관리번호', '건물명', '동정보', '층정보', '호정보', '위도', '경도']
n_all = 0
rows = []
with open(SRC, encoding='utf-8-sig', newline='') as f:
    for r in csv.DictReader(f):
        n_all += 1
        try:
            la, lo = float(r['위도']), float(r['경도'])
        except (TypeError, ValueError):
            continue
        if S <= la <= N and W <= lo <= E:
            rows.append({k: r.get(k, '') for k in COLS})
with open(OUT, 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.DictWriter(f, fieldnames=COLS)
    w.writeheader(); w.writerows(rows)
from collections import Counter
print('원본', n_all, '범위 안', len(rows), '→', OUT)
print('대분류', Counter(r['상권업종대분류명'] for r in rows).most_common())
print('층정보', Counter(r['층정보'] or '(빈칸)' for r in rows).most_common(10))
