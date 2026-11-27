"""유동인구 규모를 잡는 참고 자료 두 가지를 받아, 거제에 필요한 부분만 작은 CSV로 남긴다.

1) 국가데이터처 나우캐스트 「통신 모바일 인구이동(유입)」 시군구 자료 (SKT 기반, 주차별 일평균 이동 건수)
   → data/raw/geoje/floating_population/nowcast_inflow_geoje_weekly.csv
     거제시: 관내(거제 주민이 다른 동에 30분 이상 머문 건수) · 관외(거제 밖 주민이 거제 안 동에 30분 이상 머문 건수)
   → data/raw/geoje/floating_population/nowcast_inflow_korea_sex_age_weekly.csv (성·연령은 전국 값만 있음)
2) 경상남도 「주요관광상권정보」 (공공데이터포털 15165270, 경남빅데이터허브, 2025년 일별)
   → data/raw/geoje/floating_population/gn_tour_sites_daily.csv
     관광지 26곳 × 날짜별 '일 누적 방문객수 · 평균 체류인원 · 피크타임 최대인원' (유입지·업종 행은 합치지 않고 날짜당 1행)
원본(5MB xlsx, 107MB csv)은 임시 폴더에만 받고 저장소에는 넣지 않는다.
실행: python3 -I tools/geoje_flow_refs.py ['나우캐스트 저장 파일명']
"""
import os, re, io, csv, json, sys, zipfile, tempfile, datetime, urllib.request, urllib.parse
import xml.etree.ElementTree as ET

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'data', 'raw', 'geoje', 'floating_population')
TMP = tempfile.mkdtemp(prefix='geoje_flow_')
UA = {'User-Agent': 'Mozilla/5.0'}
TODAY = datetime.date.today()
NOWCAST_PAGE = 'https://data.kostat.go.kr/nowcast/bigDataDwnOrgDt.do?menuId=6&subMenuId=1&searchDvsn=1'


def get(url, data=None, timeout=300):
    return urllib.request.urlopen(urllib.request.Request(url, data=data, headers=UA), timeout=timeout)


def save_csv(name, header, rows, source):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    with open(path, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)
    with open(path + '.source.txt', 'w', encoding='utf-8') as f:
        f.write(source + f'받은 날짜: {TODAY}\n')
    print(f'{os.path.relpath(path, ROOT)}: {len(rows):,}행')


# ── 1) 나우캐스트 모바일 인구이동(유입) ─────────────────────────────
# 파일 목록은 페이지가 스크립트로 불러와서 자동으로 찾지 못한다. 매주 새 파일이 올라오면
# 페이지에서 '유입) … .xlsx' 다운로드 링크의 첫 번째 인자(저장 파일명)를 복사해 첫 인자로 준다.
NOWCAST_FILE = '1795652626366_유입)통신 모바일 인구이동량 통계 시군구 관내외 자료(~261115까지).xlsx'


def nowcast():
    stored = sys.argv[1] if len(sys.argv) > 1 else NOWCAST_FILE
    original = stored.split('_', 1)[1]
    body = urllib.parse.urlencode({'atchFileNm': stored, 'orgnlFileNm': original}).encode()
    xlsx = os.path.join(TMP, 'inflow.xlsx')
    with open(xlsx, 'wb') as f:
        f.write(get('https://data.kostat.go.kr/nowcast/cmm/fileDownload.do', body).read())
    z = zipfile.ZipFile(xlsx)
    M = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
    ss = [''.join(t.text or '' for t in si.iter(M + 't')) for si in ET.fromstring(z.read('xl/sharedStrings.xml'))]

    def rows(sheet):
        for _, el in ET.iterparse(z.open(sheet)):
            if el.tag == M + 'row':
                r = []
                for c in el:
                    v = c.find(M + 'v')
                    x = v.text if v is not None else ''
                    if c.get('t') == 's' and x:
                        x = ss[int(x)]
                    r.append(x)
                yield r
                el.clear()

    src = (f'데이터명: 통신 모바일 인구이동(유입) 관내외 시군구 자료 ({original})\n'
           f'제공기관: 국가데이터처 빅데이터통계과 (KOBIGS 나우캐스트), 원자료 SK텔레콤\n'
           f'출처: {NOWCAST_PAGE}\n공공데이터포털: https://www.data.go.kr/data/15160177/fileData.do (이용허락범위 제한 없음)\n'
           '정의: 거주지(한 달간 00~06시 가장 오래 머문 기지국)가 아닌 행정동에 30분 이상 머문 경우를 1건으로 셈. '
           '값은 주차별 일평균 건수이며 사람 수가 아님(한 사람이 하루 여러 동을 가면 여러 건). SKT 가입자 비율로 전체 추정.\n')
    geo = [r[2:6] for r in rows('xl/worksheets/sheet4.xml') if len(r) > 5 and r[1] == '거제시']
    save_csv('nowcast_inflow_geoje_weekly.csv', ['주차', '관내_일평균건수', '관외_일평균건수', '합계_일평균건수'], geo, src)
    sa = [r[:6] for r in rows('xl/worksheets/sheet1.xml') if r and r[0] in ('성별', '연령별')]
    save_csv('nowcast_inflow_korea_sex_age_weekly.csv', ['구분', '값', '주차', '관내_일평균건수', '관외_일평균건수', '합계_일평균건수'],
             sa, src + '범위: 전국(시군구별 성·연령 값은 공개 파일에 없음)\n')


# ── 2) 경남 주요관광상권정보 ─────────────────────────────────────
def tour_sites():
    pk = '15165270'
    base = 'https://www.data.go.kr'
    html = get(f'{base}/data/{pk}/fileData.do').read().decode('utf-8', 'replace')
    call = re.search(r"fn_fileDataDown\('(\d+)',\s*'([^']+)',\s*'([^']*)',\s*'(\d+)'", html)
    body = urllib.parse.urlencode({'publicDataPk': call.group(1), 'publicDataDetailPk': call.group(2), 'atchFileId': call.group(3),
                                   'fileDetailSn': call.group(4), 'publicDataTyCode': 'PR0051'}).encode()
    info = json.load(get(f'{base}/tcs/dss/selectFileDataDownload.do', body))
    q = urllib.parse.urlencode({'atchFileId': info['atchFileId'], 'fileDetailSn': info['fileDetailSn']})
    path = os.path.join(TMP, 'tour.csv')
    with open(path, 'wb') as f:
        f.write(get(f'{base}/cmm/cmm/fileDownload.do?{q}').read())
    seen = {}
    with open(path, encoding='utf-8-sig', errors='replace') as f:
        for r in csv.DictReader(f):
            k = (r['관광지코드'], r['기준일자'])
            if k not in seen:  # 방문 수치는 유입지·업종 행마다 똑같이 반복되므로 날짜당 1행만
                seen[k] = [r['기준일자'], r['관광지코드'], r['관광지명'], r['시군구명'], r['행정동명'],
                           r['일 누적 방문객수'], r['평균 체류인원'], r['피크타임 최대인원']]
    src = (f'데이터명: 경상남도_주요관광상권정보 (2025년 일별)\n제공기관: 경상남도 정보통신담당관(경남빅데이터허브플랫폼)\n'
           f'출처: {base}/data/{pk}/fileData.do (이용허락범위 제한 없음)\n'
           '가공: 유입지·업종별로 반복되는 방문 수치를 관광지×날짜당 1행으로 줄임(원본 107MB는 저장소에 넣지 않음).\n')
    save_csv('gn_tour_sites_daily.csv', ['기준일자', '관광지코드', '관광지명', '시군구', '행정동',
                                         '일누적방문객수', '평균체류인원', '피크타임최대인원'], sorted(seen.values()), src)


if __name__ == '__main__':
    nowcast()
    tour_sites()
