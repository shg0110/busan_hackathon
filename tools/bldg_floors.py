"""건축물대장 층별개요(국토교통부 건축HUB getBrFlrOulnInfo)를 지역 안 건물 지번마다 받는다.

- 지번은 브이월드 건물(data/raw/vworld/<지역>.json)의 PNU(19자리)에서 나눈다:
  시군구 5 · 법정동 5 · 대지/산 1(1=대지→0, 2=산→1) · 본번 4 · 부번 4
- 받은 것은 data/raw/bldg/<지역>_floors.json 에 지번마다 저장하고, 다시 돌리면 받은 지번은 건너뛴다(이어 받기).
- 키: 저장소 루트 .env 의 DATA_GO_KR_KEY(공공데이터포털 '국토교통부_건축HUB_건축물대장정보 서비스'). 키는 출력하지 않는다.
- 용도가 비어 있는 건물(대장과 연결 안 됨)은 부르지 않는다.
실행: python3 -I tools/bldg_floors.py okpo
"""
import json, os, sys, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAME = sys.argv[1]
KEY = next((l.split('=', 1)[1].strip() for l in open(os.path.join(ROOT, '.env'), encoding='utf-8') if l.startswith('DATA_GO_KR_KEY=')), '')
if not KEY:
    raise SystemExit('.env 에 DATA_GO_KR_KEY 가 없습니다.')
OUT = os.path.join(ROOT, 'data', 'raw', 'bldg', f'{NAME}_floors.json')
os.makedirs(os.path.dirname(OUT), exist_ok=True)
done = json.load(open(OUT, encoding='utf-8')) if os.path.exists(OUT) else {}

vw = json.load(open(os.path.join(ROOT, 'data', 'raw', 'vworld', f'{NAME}.json'), encoding='utf-8'))['buildings']
pnus = sorted({b['pnu'] for b in vw if b['use'] and len(b['pnu']) == 19})
todo = [p for p in pnus if p not in done]
print('지번', len(pnus), '받을 것', len(todo), '이미 받음', len(done))

URL = 'https://apis.data.go.kr/1613000/BldRgstHubService/getBrFlrOulnInfo'


def fetch(p):
    rows, page = [], 1
    while True:
        q = dict(serviceKey=KEY, sigunguCd=p[:5], bjdongCd=p[5:10], platGbCd=str(int(p[10]) - 1),
                 bun=p[11:15], ji=p[15:19], numOfRows='100', pageNo=str(page), _type='json')
        for attempt in range(5):
            try:
                body = urllib.request.urlopen(URL + '?' + urllib.parse.urlencode(q), timeout=30).read().decode('utf-8', 'replace')
                j = json.loads(body)
                break
            except Exception as e:
                if attempt == 4:
                    raise SystemExit(f'{p} 받기 실패: {type(e).__name__}')
                time.sleep(2 * (attempt + 1))
        b = j['response']['body']
        items = b.get('items') or {}
        it = items.get('item', []) if isinstance(items, dict) else []
        it = it if isinstance(it, list) else [it]
        for x in it:
            rows.append(dict(dong=x.get('dongNm') or '', gb=x.get('flrGbCdNm') or '', no=x.get('flrNo'),
                             nm=x.get('flrNoNm') or '', use=x.get('mainPurpsCdNm') or '', etc=x.get('etcPurps') or '',
                             area=x.get('area'), main=x.get('mainAtchGbCdNm') or ''))
        if page * 100 >= int(b.get('totalCount') or 0):
            return rows
        page += 1


t0 = time.time()
for i, p in enumerate(todo, 1):
    done[p] = fetch(p)
    if i % 50 == 0 or i == len(todo):
        json.dump(done, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)
        print(f'{i}/{len(todo)} 저장 ({time.time() - t0:.0f}초)', flush=True)
    time.sleep(0.12)
json.dump(done, open(OUT, 'w', encoding='utf-8'), ensure_ascii=False)
n_rows = sum(len(v) for v in done.values())
print('완료: 지번', len(done), '층 기록', n_rows, '기록 없는 지번', sum(1 for v in done.values() if not v))
