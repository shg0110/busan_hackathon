"""경남빅데이터허브(경상남도)와 소상공인365 화면이 쓰는 데이터 요청을 직접 불러, 옥포 유동·생활인구와 시간대 값을 작은 CSV로 남긴다.

허브 화면(주요상권 > 거제시 > 옥포1동)은 '해당 지역에 대한 데이터 값이 부족합니다'로 보일 때가 있지만,
같은 화면이 부르는 요청에 옥포1동 코드(48310550)를 넣으면 값이 온다. 2023년부터 원자료가 SKT(유동·생활인구)·NH카드(매출)다.
2022년 이전은 KT·KB카드라 정의가 달라 받지 않는다.

결과 (data/raw/geoje/floating_population/)
  gnhub_hourly.csv                    시간대(0~23시) 값: 상권 유동인구(월별), 동 생활인구·유동인구(연도별), 카드 매출액·건수(연도별)
  gnhub_dong_yearly.csv               거제 18개 면동 × 연도: 주민등록, 생활인구, 유동인구, 시외 유입·유출
  gnhub_okpo_inflow_origin.csv        옥포1·2동에 머문 사람의 거주지(경남 시군·다른 시도) × 성·연령
  gnhub_okpo_sexage.csv               옥포1·2동 생활인구·유동인구, 옥포1동 상권 유동인구의 성·연령
  gnhub_okpo_commercial_monthly.csv   옥포1동·고현동 상권 월별 유동인구, 카드 매출액·건수, 서비스·소매·외식 매출
  gnhub_okpo_commercial_breakdown.csv 옥포1동·고현동 상권 카드 매출의 유입지(시도)·성·연령 구성
  sbiz365_okpo_dong.json              소상공인365 동 단위 값(유동인구, 연령, 업종 월평균 매출, 점포 수)
실행: python3 -I tools/gnhub_okpo_flow.py
"""
import os, csv, json, time, datetime, urllib.request, urllib.parse, http.cookiejar

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'data', 'raw', 'geoje', 'floating_population')
HUB = 'http://bigdata.gyeongnam.go.kr:8088'
SBIZ = 'https://bigdata.sbiz.or.kr'
TODAY = datetime.date.today()
YEARS = list(range(2023, TODAY.year + 1))
GEOJE = '48310'
OKPO = {'48310550': '옥포1동', '48310560': '옥포2동'}
MARKETS = {'48310550': '옥포1동', '48310580': '고현동'}   # 허브 '주요상권'의 거제 상권은 이 둘뿐
UA = 'Mozilla/5.0'

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
opened = set()


def hub(page, **form):
    """허브 화면 요청. 화면을 한 번 열어 세션을 만든 뒤 XHR 머리글로 보내야 JSON 이 온다(안 그러면 화면 HTML 이 온다)."""
    url = f'{HUB}/{page}'
    if page not in opened:
        opener.open(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=60).read()
        opened.add(page)
    body = urllib.parse.urlencode({'task': 'select', **form}).encode()
    req = urllib.request.Request(url, data=body, headers={
        'User-Agent': UA, 'X-Requested-With': 'XMLHttpRequest', 'Referer': url,
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'})
    for i in range(3):
        try:
            d = json.loads(opener.open(req, timeout=120).read().decode('utf-8'))
            time.sleep(0.1)
            return d.get('data', [])
        except (OSError, ValueError):
            if i == 2:
                raise
            time.sleep(2 * (i + 1))


def sbiz(path, **q):
    url = f'{SBIZ}{path}?{urllib.parse.urlencode(q)}'
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept': 'application/json', 'Referer': SBIZ + '/'})
    return json.loads(urllib.request.urlopen(req, timeout=60).read().decode('utf-8'))


def save(name, header, rows, source):
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, name)
    with open(path, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)
    with open(path + '.source.txt', 'w', encoding='utf-8') as f:
        f.write(source + f'받은 날짜: {TODAY}\n')
    print(f'{os.path.relpath(path, ROOT)}: {len(rows):,}행')


SRC_HUB = ('제공기관: 경상남도 정보통신담당관 경남빅데이터허브플랫폼 「경남경기현황」(경남연구원 경남빅데이터센터)\n'
           '원자료: 2023년~ SKT 유동·생활인구, NH카드 매출(가맹점 위치·결제, 카드사 시장 점유율 역수로 보정한 추정값)\n'
           '받는 법: 화면이 부르는 요청을 직접 보냄(POST, 세션 쿠키 + X-Requested-With). tools/gnhub_okpo_flow.py\n')


# ── 1) 시간대 값 ─────────────────────────────────────────────────
def hourly():
    rows = []
    # 상권 유동인구: 월별 24시간. 값 = 그 시간대 인원을 한 달 날짜만큼 더한 값(Σ시간 ÷ 24 = 그 달 월 유동인구)
    for cd, nm in MARKETS.items():
        for y in YEARS:
            for m in range(1, 13):
                for r in hub('commercial.do', mode='selectModalTimePopCnt', HD_CD=cd, YEAR=y, MONTH=f'{m:02d}'):
                    rows.append(['상권 유동인구(월 합)', cd, f'{nm} 상권', f'{y}{m:02d}', int(r['TIMEZN_CD']), r['CUR_CNT']])
    # 동 생활인구(그 시각 평균 체류 인원)·유동인구(월 합의 연평균): 연도별 24시간
    for cd, nm in {**OKPO, GEOJE: '거제시'}.items():
        for y in YEARS:
            for n, label in ((10, '동 생활인구(시각 평균 인원)'), (7, '동 유동인구(월 합의 연평균)')):
                for r in hub('population.do', mode=f'main-dashboard-population-data-{n}', sSear=cd, sSear2=y, sSear5=0, category='y'):
                    rows.append([label, cd, nm, str(y), int(r['TIMEZN_CD']), r['TOTAL']])
    # 카드 매출: 연도별 24시간 (행정동 10자리 코드)
    for cd, nm in OKPO.items():
        for y in YEARS:
            for r in hub('consume.do', task='selectTimeSggYear', sear=y, sear2='', sear3=GEOJE, sear4=cd + '00'):
                rows.append(['카드 매출액(원)', cd, nm, str(y), int(r['TIME']), r['AMT']])
                rows.append(['카드 매출건수', cd, nm, str(y), int(r['TIME']), r['CNT']])
    save('gnhub_hourly.csv', ['지표', '지역코드', '지역', '기간', '시', '값'], rows, SRC_HUB +
         '데이터명: 시간대별 유동인구(주요상권 상세), 시간대별 생활·유동인구(유동/생활인구), 시간대별 매출액(소비동향)\n'
         '출처 화면: http://bigdata.gyeongnam.go.kr:8088/commercial.do · population.do · consume.do\n'
         '정의(허브 설명): 생활인구 = 특정 시점·특정 지역에 존재하는 모든 인구(기지국 집계). 유동인구 = 해당 지역을 이동 중이거나 일시적으로 체류하는 인구.\n'
         '단위\n'
         ' - 상권 유동인구(월 합): 그 시간대 인원을 한 달 날짜만큼 더한 값. 24개 시간 합 ÷ 24 = 그 달 월 유동인구(commercial_monthly 의 유동인구)와 정확히 같다. ÷ 그 달 일수 = 그 시간대 평균 인원.\n'
         ' - 동 생활인구(시각 평균 인원): 그 시각에 동 안에 있는 평균 인원(연도 안 월 평균).\n'
         ' - 동 유동인구(월 합의 연평균): 상권 유동인구와 같은 단위의 연평균.\n'
         ' - 카드 매출액·건수: 연간 합(그해 받은 달까지).\n'
         '주의: 상권 유동인구 2023-08 은 월 합이 1,866 으로 다른 달(약 8.5만)의 2% 수준이다. 원자료 빠짐으로 보이니 쓰지 않는다.\n')


# ── 2) 면동 연도별 ────────────────────────────────────────────────
def dong_yearly():
    life, move = {}, {}
    for y in YEARS:
        for r in hub('population.do', mode='populationFirstTab', sSear=GEOJE, sSear2=y, sSear5=2, category='y'):
            life[(r['ADMDONG_CD'], str(y))] = (r['ADMDONG_NM'], r['AVG_CNT'])
        for r in hub('population.do', mode='populationSecondTab', sSear=GEOJE, sSear2=y, sSear5=2, category='y'):
            move[(r['ADMI_CD'], str(y))] = r['AVG_CNT']
    law, flow = {}, {}
    for cd in sorted({k[0] for k in life} | {GEOJE}):
        for r in hub('population.do', mode='main-dashboard-population-data-8', sSear=cd, sSear5=0, category='y'):
            law[(cd, r['DATE'])] = r['LAW_POP']
            if cd == GEOJE:
                life[(cd, r['DATE'])] = ('거제시', r['LIFE_POP'])
        for r in hub('population.do', mode='main-dashboard-population-data-2', sSear=cd, sSear5=0, category='y'):
            flow[(cd, r['DATE'])] = (r['INFLOW'], r['OUTFLOW'])
        if cd == GEOJE:
            for r in hub('population.do', mode='main-dashboard-population-data-5', sSear=cd, sSear5=0, category='y'):
                move[(cd, r['DATE'])] = r['TOTAL']
    rows = []
    for (cd, y), (nm, lv) in sorted(life.items()):
        if int(y) not in YEARS:
            continue
        i, o = flow.get((cd, y), ('', ''))
        rows.append([cd, nm, y, law.get((cd, y), ''), lv, move.get((cd, y), ''), i, o])
    save('gnhub_dong_yearly.csv', ['면동코드', '면동', '연도', '주민등록_월평균', '생활인구_시각평균', '유동인구_월합평균',
                                    '시외유입_시각평균', '시외유출_시각평균'], rows, SRC_HUB +
         '데이터명: 유동/생활인구 > 지역별 생활인구 현황·지역별 유동인구 현황(행정동), 주민등록/생활인구, 유입/유출\n'
         '출처 화면: http://bigdata.gyeongnam.go.kr:8088/population.do\n'
         '열\n'
         ' - 주민등록_월평균: 주민등록 인구(국가데이터처)의 월 평균.\n'
         ' - 생활인구_시각평균: 그 동에 있는 평균 인원(24시간·월 평균). 한 사람이 한 시각에는 한 동에만 잡히므로 동끼리 더해도 겹치지 않는다.\n'
         ' - 유동인구_월합평균: 시간대 인원의 월 합 ÷ 24 의 월 평균. ÷ 30.4 = 하루 평균 인원.\n'
         ' - 시외유입_시각평균: 그 동에 있는 사람 중 거주지(야간 상주지)가 거제 밖인 사람의 평균 인원. 시외유출은 그 동에 사는 사람이 거제 밖에 있는 평균 인원.\n'
         '2026 은 받은 달(1~9월)까지의 평균이다.\n')


# ── 3) 옥포 시외 유입지 × 성·연령 ─────────────────────────────────
def inflow_origin():
    rows = []
    sa = [f'{s}{a}' for s in 'MF' for a in (10, 20, 30, 40, 50, 60, 70)]
    for cd, nm in OKPO.items():
        for y in YEARS:
            for r in hub('population.do', mode='main-dashboard-population-data-3', sSear=cd, sSear2=y, sSear5=0, category='y'):
                if r.get('INOUT') != 'IN':
                    continue
                vals = [r.get(k, '') for k in sa]
                rows.append([cd, nm, str(y), r['RESI_CD'], r.get('RESI_NM', ''), round(sum(float(v or 0) for v in vals), 3)] + vals)
    save('gnhub_okpo_inflow_origin.csv', ['존재지코드', '존재지', '연도', '거주지코드', '거주지', '합계_시각평균'] +
         [f'{"남" if k[0] == "M" else "여"}{k[1:]}대' + ('이상' if k[1:] == '70' else '') for k in sa], rows, SRC_HUB +
         '데이터명: 유동/생활인구 > 유입인구(존재지별 거주지에 따른 생활인구) 성·연령\n'
         '출처 화면: http://bigdata.gyeongnam.go.kr:8088/population.do\n'
         '정의: 존재지(옥포1·2동)에 있는 사람 중 거주지(야간 상주지)가 경남 다른 시군(5자리)·다른 시도(2자리)인 사람의 평균 인원(그 시각 평균, 연도 안 월 평균).\n'
         '거제 안의 다른 동에서 온 사람은 이 표에 없다. 10세 미만 열은 원자료에 없다.\n'
         '거주지코드 12 는 원자료에 이름이 없어 거주지 칸을 비워 두었다(2026년 옥포2동에만 있음).\n')


# ── 4) 성·연령 ────────────────────────────────────────────────────
def sexage():
    rows = []
    for cd, nm in OKPO.items():
        for y in YEARS:
            for r in hub('population.do', mode='main-dashboard-population-data-9', sSear=cd, sSear2=y, sSear5=0, category='y'):
                for k, v in r.items():
                    if k.startswith('AVG_'):
                        rows.append(['동 생활인구(시각 평균 인원)', cd, nm, str(y), '남' if k[4] == 'M' else '여', k[5:], v])
        for r in hub('population.do', mode='main-dashboard-population-data-6', sSear=cd, sSear5=0, category='y'):
            if int(r.get('DATE', 0)) in YEARS:
                for k, v in r.items():
                    if k.startswith('AVG_'):
                        rows.append(['동 유동인구(월 합 평균)', cd, nm, r['DATE'], '남' if k[4] == 'M' else '여', k[5:], v])
    for y in YEARS:
        for r in hub('commercial.do', mode='selectModalSexAgePopCnt', HD_CD='48310550', YEAR=y, MONTH=''):
            rows.append(['상권 유동인구(월 합 평균)', '48310550', '옥포1동 상권', str(y), r['SEX_CD'][0], r['AGE_CD'], r['CUR_CNT']])
    save('gnhub_okpo_sexage.csv', ['지표', '지역코드', '지역', '연도', '성별', '연령', '값'], rows, SRC_HUB +
         '데이터명: 성연령별 생활인구·유동인구(유동/생활인구), 성연령별 유동인구(주요상권 상세)\n'
         '출처 화면: http://bigdata.gyeongnam.go.kr:8088/population.do · commercial.do\n'
         '연령 코드: 00·10세미만 = 0~9세, 70 = 70세 이상. 생활인구 표에는 10세 미만 열이 없다.\n')


# ── 5) 상권 월별·매출 구성 ─────────────────────────────────────────
def commercial():
    rows, brk = [], []
    for cd, nm in MARKETS.items():
        for y in YEARS:
            pop = {r['YMD']: r['CNT'] for r in hub('commercial.do', mode='selectPopCnt', POP_YEAR=y, HD_CD=cd)}
            amt = {r['YMD']: (r['AMT'], r['CNT']) for r in hub('commercial.do', mode='selectConsumeAmt', CONSUME_YEAR=y, HD_CD=cd)}
            sec = {r['YMD']: (r['SERVICE_JOB'], r['SOMAE'], r['OUTEAT'])
                   for r in hub('commercial.do', mode='selectModalSectorsConsumeAmt', HD_CD=cd, YEAR=y)}
            for ym in sorted(set(pop) | set(amt)):
                rows.append([cd, f'{nm} 상권', ym, pop.get(ym, ''), *amt.get(ym, ('', '')), *sec.get(ym, ('', '', ''))])
            for r in hub('commercial.do', mode='selectModalInflowConsumeAmt', HD_CD=cd, YEAR=y, MONTH=''):
                brk.append(['유입지(시도)별 매출액', cd, f'{nm} 상권', str(y), r['C_DO_NM'], '', r['CUR_AMT']])
            for r in hub('commercial.do', mode='selectModalSexAgeConsumeAmt', HD_CD=cd, YEAR=y, MONTH=''):
                brk.append(['성·연령별 매출액', cd, f'{nm} 상권', str(y), r['SEX_CD'], r['AGE_CD'], r['CUR_AMT']])
    save('gnhub_okpo_commercial_monthly.csv', ['상권코드', '상권', '연월', '유동인구_월합', '매출액_원', '매출건수',
                                               '서비스업_매출액', '소매_매출액', '외식_매출액'], rows, SRC_HUB +
         '데이터명: 주요상권 > 주요 상권 유동인구 현황·소비매출 현황, 생활밀접업종별 소비매출\n'
         '출처 화면: http://bigdata.gyeongnam.go.kr:8088/commercial.do (거제 상권은 옥포1동·고현동 두 곳)\n'
         '유동인구_월합 = 시간대 인원의 한 달 합 ÷ 24. ÷ 그 달 일수 = 하루 평균 인원(그 시각에 있는 사람 수의 평균).\n'
         '주의: 2023-08 유동인구는 원자료 빠짐으로 보인다(1,866). population.do 의 옥포1동 유동인구와 약 6% 다르다(상권 범위 차이로 보임, 미확인).\n')
    save('gnhub_okpo_commercial_breakdown.csv', ['구분', '상권코드', '상권', '연도', '항목', '항목2', '매출액_원'], brk, SRC_HUB +
         '데이터명: 주요상권 상세 > 유입지별 소비매출, 성연령별 소비매출\n'
         '출처 화면: http://bigdata.gyeongnam.go.kr:8088/commercial.do\n'
         '유입지별 매출에는 경남이 없다(경남 밖 시도에서 온 결제만). 성·연령 항목2 는 연령대.\n')


# ── 6) 소상공인365 ────────────────────────────────────────────────
def sbiz365():
    out = {'_source': '소상공인시장진흥공단 소상공인365 (https://bigdata.sbiz.or.kr) 동네 상권현황 화면이 부르는 공개 요청(로그인 없음). '
                      '/sbiz/api/bizonSttus/<이름>/search.json?dongCd=<행정동 8자리>',
           '_received': str(TODAY),
           '_note': 'DynPplCmpr 의 cnt 는 그 달 동 유동인구(1번째 행 = 동, 2번째 행 = 시군구). VstAgeRnk 는 같은 값의 연령 구성(age 앞 글자 M 은 성별이 아니라 코드 머리). '
                    'VstCst 는 방문 고객(카드) 연령, getMmavgList 는 업종별 월평균 매출(만 원으로 보임, 미확인)·점포 수, cfrStcnt 는 상가업소 수. '
                    '시간대·요일 값은 로그인해야 받는 상권분석 보고서에만 있다.',
           'allCrtrYm': sbiz('/sbiz/api/allCrtrYm/search.json').get('data')}
    for cd, nm in OKPO.items():
        out[nm] = {ep: sbiz(f'/sbiz/api/bizonSttus/{ep}/search.json', dongCd=cd).get('data')
                   for ep in ('DynPplCmpr', 'VstAgeRnk', 'VstCst', 'getMmavgList', 'cfrStcnt')}
    path = os.path.join(OUT, 'sbiz365_okpo_dong.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print(f'{os.path.relpath(path, ROOT)}: 옥포1·2동')


if __name__ == '__main__':
    hourly()
    dong_yearly()
    inflow_origin()
    sexage()
    commercial()
    sbiz365()
