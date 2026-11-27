"""한국부동산원 R-ONE Open API에서 상권별 공실률 표를 받아 부산 행만 CSV로 저장한다.

- 인증키(REB_API_KEY)가 꼭 필요하다. 키 없이 부르면 R-ONE이 견본 모드로 '첫 5건'만 주고 pIndex·pSize를 무시한다
  (R-ONE 개발가이드 문구, 2026-11-27 확인). 키는 .env 에 넣거나 환경변수로 준다.
- 통계표 ID는 대구 드래프톤 때 확인한 것: 2026년 3분기부터 쓰는 표 5개 + 그 앞 분기(2024년 3분기~2026년 2분기) 중대형·일반·소규모·1층 표 4개.
실행: python3 -I tools/reb_fetch_busan.py data/raw/reb/vacancy_busan.csv
"""
import os, sys, json, csv, time, urllib.request

def load_key():
    if os.environ.get('REB_API_KEY'):
        return os.environ['REB_API_KEY']
    env = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), '.env')
    if os.path.exists(env):
        for line in open(env, encoding='utf-8'):
            if line.startswith('REB_API_KEY='):
                return line.split('=', 1)[1].strip()
    return ''


KEY = load_key()
if not KEY:
    raise SystemExit('REB_API_KEY 가 없습니다. .env 에 REB_API_KEY=키 를 넣어 주세요(키 없으면 견본 5건만 옴).')
SIZE = 1000
TABLES = {  # 통계표 ID: 상가 유형
    'T267693143622612': '중대형',   # 2026년 3분기~
    'T262053143683833': '소규모',
    'T267763143643502': '집합',
    'T261533143711078': '일반',
    'T263283143729355': '일반_1층',
    'T249633134845544': '중대형',   # 2024년 3분기~2026년 2분기 (추세용)
    'T262303140824764': '일반',     # 2024년 3분기~2026년 2분기 (추세용)
    'T241833134686576': '소규모',   # 2024년 3분기~2026년 2분기 (추세용)
    'T268603140832693': '일반_1층', # 2024년 3분기~2026년 2분기 (추세용)
}
rows = {}


def get(url):
    # R-ONE 서버가 가끔 응답을 안 줘서 5번까지 다시 시도한다.
    for i in range(5):
        try:
            return json.load(urllib.request.urlopen(url, timeout=30))
        except Exception:
            time.sleep(2 * (i + 1))
    raise SystemExit('R-ONE 응답 없음: ' + url)


for sid, kind in TABLES.items():
    for page in range(1, 2000):
        url = ('https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do?Type=json'
               f'&STATBL_ID={sid}&DTACYCLE_CD=QY&pIndex={page}&pSize={SIZE}&KEY={KEY}')
        data = get(url)
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
