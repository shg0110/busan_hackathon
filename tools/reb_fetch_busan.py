"""한국부동산원 R-ONE Open API에서 상권별 공실률 표를 받아 부산 행만 CSV로 저장한다.

- 키(REB_API_KEY)가 있으면 한 번에 1,000행, 없으면 서버가 5행씩만 줘서 쪽을 넘기며 받는다(키 없이도 전부 받아짐, 느릴 뿐).
- 통계표 ID는 대구 드래프톤 때 확인한 것: 2026년 3분기부터 쓰는 표 5개 + 2024년 3분기~ 중대형 표 1개.
실행: python3 -I tools/reb_fetch_busan.py data/raw/reb/vacancy_busan.csv
"""
import os, sys, json, csv, time, urllib.request

KEY = os.environ.get('REB_API_KEY', '')
SIZE = 1000 if KEY else 5
TABLES = {  # 통계표 ID: 상가 유형
    'T267693143622612': '중대형',   # 2026년 3분기~
    'T262053143683833': '소규모',
    'T267763143643502': '집합',
    'T261533143711078': '일반',
    'T263283143729355': '일반_1층',
    'T249633134845544': '중대형',   # 2024년 3분기~ (추세용)
}
rows = {}
for sid, kind in TABLES.items():
    for page in range(1, 2000):
        url = ('https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do?Type=json'
               f'&STATBL_ID={sid}&DTACYCLE_CD=QY&pIndex={page}&pSize={SIZE}' + (f'&KEY={KEY}' if KEY else ''))
        data = json.load(urllib.request.urlopen(url, timeout=30))
        got = [r for v in data.values() if isinstance(v, list) for x in v if isinstance(x, dict) for r in x.get('row', [])]
        if not got:
            break
        for r in got:
            if r['CLS_FULLNM'].startswith('부산') and r['DTA_VAL'] is not None:
                rows[(r['CLS_FULLNM'].replace('부산>', ''), kind, r['WRTTIME_IDTFR_ID'])] = (round(float(r['DTA_VAL']), 2), sid)
        time.sleep(0.05)
os.makedirs(os.path.dirname(sys.argv[1]) or '.', exist_ok=True)
w = csv.writer(open(sys.argv[1], 'w', encoding='utf-8-sig', newline=''))
w.writerow(['상권', '상가유형', '분기', '공실률_%', '통계표ID'])
for k in sorted(rows):
    w.writerow([*k, *rows[k]])
print(len(rows), '행 저장')
