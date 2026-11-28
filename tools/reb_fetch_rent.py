"""한국부동산원 R-ONE 임대동향 '층별임대료 및 층별효용비율'(2026년 3분기~) 표에서 옥포·경남·전국 행만 CSV로 저장한다.

- 1년 손익의 임대료 근거(web/data/okpo_year.js, tools/year_build.py).
- 인증키 REB_API_KEY 는 .env 또는 환경변수(tools/reb_fetch_busan.py 와 같음).
실행: python3 -I tools/reb_fetch_rent.py data/raw/reb/rent_floor_okpo.csv
"""
import os, sys, json, csv, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))


def load_key():
    if os.environ.get('REB_API_KEY'):
        return os.environ['REB_API_KEY']
    env = os.path.join(os.path.dirname(HERE), '.env')
    if os.path.exists(env):
        for line in open(env, encoding='utf-8'):
            if line.startswith('REB_API_KEY='):
                return line.split('=', 1)[1].strip()
    return ''


KEY = load_key()
if not KEY:
    raise SystemExit('REB_API_KEY 가 없습니다.')
TABLES = {  # 통계표 ID: 상가 유형(2026년 3분기~)
    'T261943143757415': '중대형',
    'T265443143777773': '소규모',
}
KEEP = ('경남>거제옥포', '경남', '전국')
rows = []
for sid, kind in TABLES.items():
    for page in range(1, 100):
        url = ('https://www.reb.or.kr/r-one/openapi/SttsApiTblData.do?Type=json'
               f'&STATBL_ID={sid}&DTACYCLE_CD=QY&pIndex={page}&pSize=1000&KEY={KEY}')
        for i in range(5):
            try:
                data = json.load(urllib.request.urlopen(url, timeout=40))
                break
            except Exception:
                time.sleep(2 * (i + 1))
        else:
            raise SystemExit('R-ONE 응답 없음')
        got = [r for v in data.values() if isinstance(v, list) for x in v if isinstance(x, dict) for r in x.get('row', [])]
        if not got:
            break
        for r in got:
            if r['GRP_FULLNM'] in KEEP and r['DTA_VAL'] is not None:
                rows.append([r['GRP_FULLNM'], kind, r['CLS_NM'], r['ITM_NM'], r['UI_NM'], r['WRTTIME_IDTFR_ID'], round(float(r['DTA_VAL']), 4), sid])
        time.sleep(0.05)
os.makedirs(os.path.dirname(sys.argv[1]) or '.', exist_ok=True)
w = csv.writer(open(sys.argv[1], 'w', encoding='utf-8-sig', newline=''))
w.writerow(['지역', '상가유형', '층', '항목', '단위', '분기', '값', '통계표ID'])
w.writerows(sorted(rows))
print(len(rows), '행 저장')
