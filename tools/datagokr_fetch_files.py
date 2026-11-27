"""공공데이터포털(data.go.kr) '파일데이터'를 키 없이 내려받아 data/raw/<주제>/ 에 넣는다.

- 데이터 상세 페이지(/data/<번호>/fileData.do)에서 파일 목록을 읽고,
  selectFileDataDownload.do 로 파일 ID를 받은 뒤 fileDownload.do 로 원본을 받는다.
- 받은 파일 옆에 <파일명>.source.txt 로 출처(데이터명·기관·페이지 주소·받은 날짜)를 남긴다.
실행: python3 -I tools/datagokr_fetch_files.py            (전체)
      python3 -I tools/datagokr_fetch_files.py 3057229    (번호 지정)
"""
import os, re, sys, json, datetime, urllib.request, urllib.parse

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'raw')
DATASETS = {  # 공공데이터포털 번호: 넣을 폴더
    '3057229': 'floating_population',   # 부산교통공사_시간대별 승하차인원 (역·일·시간대)
    '15128561': 'floating_population',  # 부산교통공사_월별 역별 권종별 승하차 (청소년·경로 등)
    '15126977': 'tourism',              # 영도구_유동인구 현황 (관광지 공공와이파이)
    '15152102': 'tourism',              # 부산관광공사_부산방문 내국인 관광객 페르소나 분석
    '15143635': 'vacancy',              # 한국부동산원_지역별 공실률_집합상가
}
GEOJE = {  # 경상남도 거제시 (실행: python3 -I tools/datagokr_fetch_files.py geoje)
    '15131369': 'geoje/population',     # 면동별 연령분포
    '15088932': 'geoje/population',     # 주민등록인구현황 (성별)
    '15131431': 'geoje/population',     # 거주구분별 인구수
    '15131360': 'geoje/population',     # 생산가능인구
    '15131432': 'geoje/population',     # 65세 이상 인구
    '15150229': 'geoje/population',     # 면동별 인구이동(전출입)
    '3079542': 'geoje/population',      # 외국인주민현황
    '15145598': 'geoje/population',     # 체류자격별 외국인
    '15149853': 'geoje/population',     # 외국인 국적별 등록현황
    '15116772': 'geoje/occupation',     # 사업체수 및 종사자수
    '15149822': 'geoje/occupation',     # 산업별 사업체수 및 종사자수
    '15113807': 'geoje/occupation',     # 양대조선소 종사자 현황
    '15163856': 'geoje/card_sales',     # 면동별 카드매출 현황
    '15118815': 'geoje/tourism',        # 관광객이용시설업 현황
    '15087256': 'geoje/tourism',        # 관광유람선업 현황
    '15144458': 'geoje/vacancy',        # 빈집 현황
    '15163866': 'geoje/weather',        # 기온데이터 (페르소나: 날씨·계절별 방문)
}
DATASETS.update(GEOJE)
BASE = 'https://www.data.go.kr'
UA = {'User-Agent': 'Mozilla/5.0'}


def get(url, data=None):
    req = urllib.request.Request(url, data=data, headers=UA)
    return urllib.request.urlopen(req, timeout=120)


def fetch(pk, folder):
    page_url = f'{BASE}/data/{pk}/fileData.do'
    html = get(page_url).read().decode('utf-8', 'replace')
    title = re.search(r'<title>([^<|]+)', html).group(1).strip()
    calls = sorted(set(re.findall(r"fn_fileDataDown\('(\d+)',\s*'([^']+)',\s*'([^']*)',\s*'(\d+)'", html)))
    if not calls:
        print(f'[{pk}] 다운로드 버튼을 못 찾음: {title}')
        return
    out_dir = os.path.join(ROOT, folder)
    os.makedirs(out_dir, exist_ok=True)
    for pdpk, detail_pk, atch, sn in calls:
        body = urllib.parse.urlencode({'publicDataPk': pdpk, 'publicDataDetailPk': detail_pk, 'atchFileId': atch,
                                       'fileDetailSn': sn, 'publicDataTyCode': 'PR0051'}).encode()
        info = json.load(get(f'{BASE}/tcs/dss/selectFileDataDownload.do', body))
        if not info.get('status'):
            print(f'[{pk}] 파일 정보 실패: {info.get("error")}')
            continue
        q = urllib.parse.urlencode({'atchFileId': info['atchFileId'], 'fileDetailSn': info['fileDetailSn']})
        res = get(f'{BASE}/cmm/cmm/fileDownload.do?{q}')
        cd = res.headers.get('Content-Disposition', '')
        m = re.search(r'filename="?([^";]+)', cd)
        name = m.group(1) if m else f'{pk}_{sn}.bin'
        try:  # 서버가 latin-1로 보낸 한글 파일명 되돌리기
            name = name.encode('latin-1').decode('utf-8')
        except (UnicodeEncodeError, UnicodeDecodeError):
            pass
        name = os.path.basename(name).replace('/', '_')
        path = os.path.join(out_dir, name)
        with open(path, 'wb') as f:
            f.write(res.read())
        with open(path + '.source.txt', 'w', encoding='utf-8') as f:
            f.write(f'데이터명: {title}\n제공기관: {info["dataSetFileDetailInfo"].get("insttNm")}\n'
                    f'출처: {page_url}\n받은 날짜: {datetime.date.today()}\n')
        print(f'[{pk}] {folder}/{name} ({os.path.getsize(path):,} bytes)')


args = sys.argv[1:]
if args == ['geoje']:
    args = list(GEOJE)
for pk in (args or [k for k in DATASETS if k not in GEOJE]):
    fetch(pk, DATASETS.get(pk, 'misc'))
