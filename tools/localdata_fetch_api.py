"""공공데이터포털 오픈API로 지방행정 인허가(일반음식점·휴게음식점)를 시·군·구 단위로 받아 CSV로 저장한다.
LOCALDATA(file.localdata.go.kr)가 닫혀서 파일 대신 이 API를 쓴다(2026-11-27 확인).

API: 행정안전부_식품_일반음식점 조회서비스(data.go.kr 15154916) → apis.data.go.kr/1741000/general_restaurants/info
     행정안전부_식품_휴게음식점 조회서비스(data.go.kr 15154921) → apis.data.go.kr/1741000/rest_cafes/info
     한 번에 100건까지, 개방자치단체코드(cond[OPN_ATMY_GRP_CD::EQ])로 거른다. 좌표는 EPSG:5174.
키:  .env 의 DATA_GO_KR_KEY. --env로 경로를 주거나, 없으면 저장소 루트(worktree면 main 작업 폴더)의 .env를 찾는다.
출력: data/raw/localdata/<api>_<코드>.csv (tools/localdata_closed.py가 읽는 한국어 열 이름)
실행: python3 -I tools/localdata_fetch_api.py --code 5370000            # 거제시, 일반·휴게 둘 다
"""
import argparse, csv, json, os, subprocess, sys, time, urllib.parse, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APIS = {'general_restaurants': '일반음식점', 'rest_cafes': '휴게음식점'}
COLS = [  # (API 필드, 저장할 열 이름)
    ('OPN_ATMY_GRP_CD', '개방자치단체코드'), ('MNG_NO', '관리번호'), ('BPLC_NM', '사업장명'),
    ('SALS_STTS_CD', '영업상태코드'), ('SALS_STTS_NM', '영업상태명'), ('DTL_SALS_STTS_NM', '상세영업상태명'),
    ('LCPMT_YMD', '인허가일자'), ('CLSBIZ_YMD', '폐업일자'), ('BZSTAT_SE_NM', '업태구분명'), ('SNTTN_BZSTAT_NM', '위생업태명'),
    ('LCTN_AREA', '소재지면적'), ('FCLT_TOTAL_SCL', '시설총규모'), ('ROAD_NM_ADDR', '도로명주소'), ('LOTNO_ADDR', '지번주소'),
    ('CRD_INFO_X', '좌표정보(X)'), ('CRD_INFO_Y', '좌표정보(Y)'), ('DAT_UPDT_PNT', '데이터갱신시점'), ('LAST_MDFCN_PNT', '최종수정시점'),
]


def find_env(path):
    if path:
        return path
    cands = [os.path.join(ROOT, '.env')]
    try:  # worktree에서 돌리면 .env는 main 작업 폴더에만 있다
        common = subprocess.run(['git', '-C', ROOT, 'rev-parse', '--git-common-dir'], capture_output=True, text=True).stdout.strip()
        if common:
            cands.append(os.path.join(os.path.dirname(os.path.abspath(os.path.join(ROOT, common))), '.env'))
    except OSError:
        pass
    for c in cands:
        if os.path.exists(c):
            return c
    raise SystemExit('.env를 찾지 못했다. --env로 경로를 주거나 DATA_GO_KR_KEY 환경변수를 쓴다.')


def load_key(env_path):
    if os.environ.get('DATA_GO_KR_KEY'):
        return os.environ['DATA_GO_KR_KEY'].strip()
    for line in open(find_env(env_path), encoding='utf-8'):
        if line.startswith('DATA_GO_KR_KEY='):
            return line.split('=', 1)[1].strip().strip('"')
    raise SystemExit('.env에 DATA_GO_KR_KEY가 없다.')


def call(api, key, page, code, rows=100):
    q = {'serviceKey': key, 'pageNo': str(page), 'numOfRows': str(rows), 'returnType': 'json', 'cond[OPN_ATMY_GRP_CD::EQ]': code}
    url = f'https://apis.data.go.kr/1741000/{api}/info?' + urllib.parse.urlencode(q)
    last = None
    for i in range(5):
        try:
            d = json.loads(urllib.request.urlopen(url, timeout=90).read().decode('utf-8'))
            if 'response' not in d:  # 키·서비스 오류는 다른 모양으로 온다
                raise RuntimeError(json.dumps(d, ensure_ascii=False)[:300])
            return d['response']['body']
        except Exception as e:  # 서버가 가끔 끊긴다
            last = e; print(f'  {page}쪽 다시 시도 {i + 1}: {str(e).replace(key, "(키)")[:80]}', flush=True); time.sleep(2 * (i + 1))
    raise SystemExit(f'{api} {page}쪽 실패: {str(last).replace(key, "(키)")[:300]}')


def fetch(api, key, code, out_dir):
    body = call(api, key, 1, code)
    total = int(body.get('totalCount') or 0); pages = (total + 99) // 100
    items = list((body.get('items') or {}).get('item') or [])
    print(f'{APIS[api]} {code}: 전체 {total}건, {pages}쪽 받는 중', flush=True)
    t0 = time.time()
    for p in range(2, pages + 1):
        items += list((call(api, key, p, code).get('items') or {}).get('item') or [])
        if p % 10 == 0 or p == pages:
            print(f'  {p}/{pages}쪽 ({time.time() - t0:.0f}초)', flush=True)
        time.sleep(0.05)
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, f'{api}_{code}.csv')
    with open(path, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f); w.writerow(['개방서비스명'] + [k for _, k in COLS])
        for it in items:
            w.writerow([APIS[api]] + [('' if it.get(a) is None else str(it.get(a))) for a, _ in COLS])
    st = {}
    for it in items:
        st[it.get('SALS_STTS_NM')] = st.get(it.get('SALS_STTS_NM'), 0) + 1
    print(f'{APIS[api]} {code}: 전체 {total}건 중 {len(items)}건 저장 → {os.path.relpath(path, ROOT)} {st}')
    if len(items) != total:
        print('  주의: 받은 수가 전체 수와 다르다(받는 사이 자료가 바뀌었을 수 있음)')
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--code', required=True, help='개방자치단체코드(예: 거제시 5370000)')
    ap.add_argument('--api', nargs='+', default=list(APIS), choices=list(APIS))
    ap.add_argument('--env')
    ap.add_argument('--out-dir', default=os.path.join(ROOT, 'data/raw/localdata'))
    a = ap.parse_args()
    key = load_key(a.env)
    for api in a.api:
        fetch(api, key, a.code, a.out_dir)


if __name__ == '__main__':
    main()
