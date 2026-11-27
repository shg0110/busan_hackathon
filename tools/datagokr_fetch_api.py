"""공공데이터포털(data.go.kr) Open API 데이터를 받아 data/raw/<주제>/<이름>.csv 로 저장한다.

- 인증키가 필요하다: 공공데이터포털에서 아래 데이터마다 '활용신청'을 한 뒤 .env 의 DATA_GO_KR_KEY 에 넣는다.
  (일반 인증키 Decoding 값을 넣는다. 활용신청 후 1~2시간 뒤부터 동작할 수 있음)
- 관광공사 지역방문자수는 날짜 범위를 받아 부산(코드 26)만 남긴다. 기본은 최근 365일.
실행: python3 -I tools/datagokr_fetch_api.py               (전체)
      python3 -I tools/datagokr_fetch_api.py pop_age       (이름 지정)
"""
import os, sys, csv, json, time, datetime, urllib.request, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', 'data', 'raw')


def load_key():
    key = os.environ.get('DATA_GO_KR_KEY', '')
    env = os.path.join(HERE, '..', '.env')
    if not key and os.path.exists(env):
        for line in open(env, encoding='utf-8'):
            if line.startswith('DATA_GO_KR_KEY='):
                key = line.split('=', 1)[1].strip()
    if not key:
        sys.exit('DATA_GO_KR_KEY 가 없음: .env 에 공공데이터포털 인증키(Decoding)를 넣어 주세요.')
    return key


B = 'https://apis.data.go.kr/6260000'
TODAY = datetime.date.today()
YEAR_AGO = TODAY - datetime.timedelta(days=365)
JOBS = {  # 이름: (폴더, URL, 추가 변수, 부산만 남길 열, 공공데이터포털 번호)
    'pop_age':     ('floating_population', f'{B}/DongPopAgeService/getDongPopAge', {}, None, '15164376'),
    'pop_gender':  ('floating_population', f'{B}/DongPopGenderService/getDongPopGender', {}, None, '15164442'),
    'pop_time':    ('floating_population', f'{B}/DongPopTimeService/getDongPopTime', {}, None, '15164444'),
    'card_biz':    ('card_sales', f'{B}/DongSalesBizService/getDongSalesBiz', {}, None, '15164434'),
    'card_time':   ('card_sales', f'{B}/DongSalesTimeService/getDongSalesTime', {}, None, '15164416'),
    'card_gender': ('card_sales', f'{B}/DongSalesGenderService/getDongSalesGender', {}, None, '15164384'),
    'paid_tour_visitors': ('tourism', f'{B}/PaidTourVisitorService/getPaidTourVisitor', {}, None, '15167856'),
    'visitors_sigungu': ('tourism', 'https://apis.data.go.kr/B551011/DataLabService/locgoRegnVisitrDDList',
                         {'MobileOS': 'ETC', 'MobileApp': 'busan_hackathon', '_type': 'json',
                          'startYmd': YEAR_AGO.strftime('%Y%m%d'), 'endYmd': TODAY.strftime('%Y%m%d')},
                         'signguCode', '15101972'),
    'visitors_sido': ('tourism', 'https://apis.data.go.kr/B551011/DataLabService/metcoRegnVisitrDDList',
                      {'MobileOS': 'ETC', 'MobileApp': 'busan_hackathon', '_type': 'json',
                       'startYmd': YEAR_AGO.strftime('%Y%m%d'), 'endYmd': TODAY.strftime('%Y%m%d')},
                      'areaCode', '15101972'),
    # 경남 거제시(시군구 코드 48310) 방문자수: 현지인/외지인/외국인 구분(touDivNm)
    'visitors_geoje': ('geoje/tourism', 'https://apis.data.go.kr/B551011/DataLabService/locgoRegnVisitrDDList',
                       {'MobileOS': 'ETC', 'MobileApp': 'busan_hackathon', '_type': 'json',
                        'startYmd': YEAR_AGO.strftime('%Y%m%d'), 'endYmd': TODAY.strftime('%Y%m%d')},
                       'signguCode', '15101972'),
}
REGION = {'visitors_geoje': '48310'}  # 이 접두어로 시작하는 행만 남김 (기본: 부산 26)
ROWS = 1000


def fetch(name, key):
    folder, url, extra, busan_col, pk = JOBS[name]
    rows = []
    for page in range(1, 100000):
        q = {'serviceKey': key, 'pageNo': page, 'numOfRows': ROWS, **extra}
        if 'B551011' not in url:  # 관광공사 API는 resultType 을 받지 않음(_type 사용)
            q['resultType'] = 'json'
        for attempt in range(5):  # 쪽이 많으면 가끔 끊김 → 잠깐 쉬고 다시
            try:
                raw = urllib.request.urlopen(f'{url}?{urllib.parse.urlencode(q)}', timeout=60).read().decode('utf-8', 'replace')
                break
            except OSError:
                if attempt == 4:
                    raise
                time.sleep(2 ** attempt)
        try:
            body = json.loads(raw)['response']['body']
        except (ValueError, KeyError):
            sys.exit(f'[{name}] 응답을 읽지 못함(키·활용신청 확인): {raw[:300]}')
        items = (body.get('items') or {})
        items = items.get('item', []) if isinstance(items, dict) else items
        items = [items] if isinstance(items, dict) else items
        rows += items
        total = int(body.get('totalCount') or 0)
        if not items or len(rows) >= total:
            break
        time.sleep(0.05)
    if busan_col:
        rows = [r for r in rows if str(r.get(busan_col, '')).startswith(REGION.get(name, '26'))]
    out_dir = os.path.join(ROOT, folder)
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f'{name}.csv')
    cols = list(dict.fromkeys(k for r in rows for k in r))
    with open(path, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
    with open(path + '.source.txt', 'w', encoding='utf-8') as f:
        f.write(f'출처: https://www.data.go.kr/data/{pk}/openapi.do\nAPI: {url}\n받은 날짜: {TODAY}\n')
    print(f'[{name}] {folder}/{name}.csv {len(rows):,}행')


key = load_key()
failed = []
for n in (sys.argv[1:] or JOBS):
    try:
        fetch(n, key)
    except (Exception, SystemExit) as e:  # 하나가 실패해도 나머지는 받는다
        body = e.read()[:200].decode('utf-8', 'replace') if hasattr(e, 'read') else ''
        msg = 'SERVICE_KEY_IS_NOT_REGISTERED(활용신청 안 됨 또는 승인 후 대기 중)' if 'NOT_REGISTERED' in body else str(e)[:200]
        print(f'[{n}] 실패: {msg}')
        failed.append(n)
if failed:
    sys.exit('실패: ' + ' '.join(failed))
