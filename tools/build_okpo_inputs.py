"""구현 구역 「옥포로·성안로 ~ 옥포국제시장 일대」(거제시 옥포1동·옥포2동) 기준으로
페르소나에 쓸 원자료를 골라 data/processed/okpo/ 에 UTF-8 CSV·JSON 으로 정리한다.

- 원자료(data/raw/geoje/, data/raw/tourism/)는 손대지 않는다. 인코딩(UTF-8 / CP949)은 자동으로 맞춘다.
- 동 단위 자료가 없는 것(방문자수·기온·조선소·고용조사)은 거제시 또는 경남 값을 쓰고 파일 이름에 범위를 붙인다.
실행: python3 -I tools/build_okpo_inputs.py
"""
import os, csv, json, re, struct, zipfile, collections

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
RAW = os.path.join(ROOT, 'data', 'raw', 'geoje')
OUT = os.path.join(ROOT, 'data', 'processed', 'okpo')
DONGS = ('옥포1동', '옥포2동')


def read(rel):
    b = open(os.path.join(RAW, rel), 'rb').read()
    for enc in ('utf-8-sig', 'cp949'):
        try:
            text = b.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    return list(csv.DictReader(text.splitlines()))


def num(s):
    s = (s or '').strip().replace(',', '')
    return float(s) if s else 0.0


def write(name, header, rows):
    path = os.path.join(OUT, name)
    with open(path, 'w', encoding='utf-8-sig', newline='') as f:  # BOM: 엑셀에서도 안 깨지게
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)
    print(f'{name}: {len(rows):,}행')


def per(a, b):
    return round(a / b) if b else ''


def residents():
    rows = [(x['주소지'], x['연령대'], x['성별'], int(num(x['값'])))
            for x in read('population/경상남도 거제시_면동별연령분포_20261031.csv')
            if x['주소지'] in DONGS and x['항목'] == '인구수']
    write('01_residents_age_gender.csv', ['동', '연령대', '성별', '인구수'], rows)

    t = collections.defaultdict(dict)
    for x in read('population/경상남도 거제시_주민등록인구현황_20261031.csv'):
        if x['읍면동명'] in DONGS and x['항목'] in ('세대수', '남자 인구수', '여자 인구수'):
            t[x['읍면동명']][x['항목']] = int(num(x['값']))
    write('02_households.csv', ['동', '세대수', '남자', '여자', '내국인합계'],
          [(d, v['세대수'], v['남자 인구수'], v['여자 인구수'], v['남자 인구수'] + v['여자 인구수'])
           for d, v in t.items()])

    # 1세 단위 정밀 연령(15~64세 생산가능인구 + 65세 이상 1세 단위 + 0~14세는 10세 구간 균등 배분)
    one = collections.defaultdict(float)
    for x in read('population/경상남도 거제시_생산가능인구_20261031.csv'):
        if x['주소지'] in DONGS and x['항목'] == '인구수':
            a = int(re.search(r'\d+', x['연령']).group())
            one[(x['주소지'], x['성별'], a)] += num(x['값'])
    for x in read('population/경상남도 거제시_65세이상인구_20261031.csv'):
        if x['주소지'] in DONGS and x['항목'] == '인구수':
            a = min(int(re.search(r'\d+', x['연령']).group()), 100)
            one[(x['주소지'], x['성별'], a)] += num(x['값'])
    for d, band, s, n in rows:
        lo = int(band.split('세')[0])
        if lo == 0:
            for a in range(10):
                one[(d, s, a)] += n / 10.0
        elif lo == 10:
            known = sum(one[(d, s, a)] for a in range(15, 20))
            rem = max(n - known, 0.0)
            for a in range(10, 15):
                one[(d, s, a)] += rem / 5.0
    s_rows = [(d, s, a, round(one[(d, s, a)], 2))
              for d in DONGS for s in ('남', '여') for a in range(101) if one[(d, s, a)] > 0]
    write('18_residents_single_age.csv', ['동', '성별', '연령', '인구수'], s_rows)


def foreigners():
    rows = []
    for x in read('population/경상남도_거제시_체류자격별 외국인 현황_20261031.csv'):
        a, b = int(num(x['옥포1동'])), int(num(x['옥포2동']))
        if a + b:
            rows.append((x['구분'], a, b, a + b))
    rows.sort(key=lambda r: -r[3])
    write('03_foreign_by_visa.csv', ['체류자격', '옥포1동', '옥포2동', '합계'], rows)

    # 거제 18개 읍면동 전체(타동에서 옥포로 오는 외국인의 사는 곳·체류자격 배분용; 장평동 6,673명·아주동 3,241명 등)
    skip = {'시도명', '시군구명', '구분', '총계', '데이터기준일자'}
    long_rows = []
    for x in read('population/경상남도_거제시_체류자격별 외국인 현황_20261031.csv'):
        for d, v in x.items():
            if d not in skip and int(num(v)) > 0:
                long_rows.append((d, x['구분'], int(num(v))))
    long_rows.sort(key=lambda r: (r[0], -r[2]))
    write('21_foreign_by_dong_visa.csv', ['동', '체류자격', '인원'], long_rows)


def immigrant_spending():
    """2025 이민자체류실태: 외국인 총소득 대비 지출 비중(생활비·송금 등) — 외국인 예산·결제 배수의 근거"""
    rows = [(x['대상'], x['조사시점'], x['항목'], num(x['값']), x['단위'])
            for x in read('population/이민자체류실태_소득대비지출_2025.csv')]
    write('22_foreign_spending_survey.csv', ['대상', '조사시점', '항목', '값', '단위'], rows)


def card_sales():
    by_ind, by_age, by_org, detail = (collections.defaultdict(lambda: [0.0, 0.0]) for _ in range(4))
    for x in read('card_sales/경상남도_거제시_면동별 카드매출 현황_20250228.csv'):
        if x['행정동'] not in DONGS:
            continue
        amt, cnt = num(x['추정 이용 금액']), num(x['추정 이용 건수'])
        local = '현지(경남)' if x['유입광역시도'] == '경남' else '외지'
        for d, k in ((by_ind, (x['업종대분류'], x['업종중분류'])),
                     (by_age, (x['연령대'], x['성별'])),
                     (by_org, (x['유입광역시도'],)),
                     (detail, (x['행정동'], x['업종대분류'], x['업종중분류'], x['연령대'], x['성별'], local))):
            d[k][0] += amt
            d[k][1] += cnt

    def rows(d):
        return [(*k, int(a), int(c), per(a, c)) for k, (a, c) in sorted(d.items(), key=lambda kv: -kv[1][0])]

    tail = ['추정이용금액', '추정이용건수', '건당금액']
    write('04_card_by_industry.csv', ['업종대분류', '업종중분류'] + tail, rows(by_ind))
    write('05_card_by_age_gender.csv', ['연령대', '성별'] + tail, rows(by_age))
    write('06_card_by_origin.csv', ['유입광역시도'] + tail, rows(by_org))
    write('07_card_detail.csv', ['동', '업종대분류', '업종중분류', '연령대', '성별', '유입구분'] + tail, rows(detail))


def vacancy():
    rows = sorted((x['상가유형'], x['분기'], x['공실률_%'])
                  for x in read('../reb/vacancy_dongnam.csv') if x['상권'] == '경남>거제옥포')
    write('08_vacancy_okpo.csv', ['상가유형', '분기(YYYYQQ)', '공실률_%'], rows)


def businesses():
    rows = []
    for x in read('occupation/경상남도_거제시_산업별 사업체수 및 종사자수_20241231.csv'):
        if x['통계명'] not in DONGS:
            continue
        for k, v in x.items():
            if k.endswith('사업체수') and v.strip():
                ind = k[:-len('사업체수')].strip()
                rows.append((x['통계명'], x['년도'], ind, int(num(v)), int(num(x.get(ind + ' 종사자수')))))
    write('09_businesses_by_industry.csv', ['동', '년도', '산업', '사업체수', '종사자수'], rows)


def visitors():
    acc = collections.defaultdict(list)
    for x in read('tourism/visitors_geoje.csv'):
        acc[(x['daywkDivCd'], x['daywkDivNm'], x['touDivNm'])].append(num(x['touNum']))
    rows = [(n, t, round(sum(v) / len(v)), len(v)) for (c, n, t), v in sorted(acc.items())]
    write('10_visitors_weekday_geoje.csv', ['요일', '방문자구분', '하루평균방문자수', '일수'], rows)


def weather():
    acc = collections.defaultdict(lambda: [[], [], []])
    for x in read('weather/경상남도_거제시_기온데이터_20260907.csv'):
        d = x['날짜'].strip()
        if len(d) < 7 or not x['평균기온'].strip():
            continue
        if int(d[:4]) < 2016:
            continue
        for i, k in enumerate(('평균기온', '최저기온', '최고기온')):
            if x[k].strip():
                acc[int(d[5:7])][i].append(num(x[k]))
    rows = [(m, *(round(sum(v) / len(v), 1) for v in acc[m])) for m in sorted(acc)]
    write('11_weather_monthly_geoje.csv', ['월', '평균기온', '평균최저', '평균최고'], rows)


def facilities():
    rows = [(x['업종'], x['상호명'], x['도로명주소'])
            for x in read('tourism/경상남도_거제시_관광객이용시설업현황_20260721.csv')
            if any(f'거제시 {d}' in x['지번주소'] + x['도로명주소'] for d in ('옥포동', '덕포동'))]
    write('12_tourism_facilities_okpo.csv', ['업종', '상호명', '도로명주소'], rows)


def shipyard():
    r = read('occupation/경상남도_거제시_양대조선소 종사자 현황_20230518.csv')
    write('13_shipyard_workers_geoje.csv', list(r[0].keys()), [list(x.values()) for x in r])


def floating_and_targets():
    """경남빅데이터허브·소상공인365·나우캐스트 유동인구를 페르소나 보정·검증용 표(14~17)와 okpo_flow.json 으로 정리."""
    hr = read('floating_population/gnhub_hourly.csv')
    # 1) 상권 유동인구 44개월 시간 비율(202308 원자료 결측 제외)
    by_ym = collections.defaultdict(dict)
    for x in hr:
        if x['지표'] == '상권 유동인구(월 합)' and x['지역'] == '옥포1동 상권' and x['기간'] != '202308':
            by_ym[x['기간']][int(x['시'])] = num(x['값'])
    comm_share = [0.0] * 24
    for ym, d in by_ym.items():
        s = sum(d.values()) or 1.0
        for h in range(24):
            comm_share[h] += d.get(h, 0.0) / s / len(by_ym)

    def series_24(ind, region, year):
        d = {int(x['시']): num(x['값']) for x in hr if x['지표'] == ind and x['지역'] == region and x['기간'] == str(year)}
        return [d.get(h, 0.0) for h in range(24)]

    dong_flow_26 = series_24('동 유동인구(월 합의 연평균)', '옥포1동', 2026)
    df_sum = sum(dong_flow_26) or 1.0
    dong_flow_share = [v / df_sum for v in dong_flow_26]
    life_25 = series_24('동 생활인구(시각 평균 인원)', '옥포1동', 2025)
    life_26 = series_24('동 생활인구(시각 평균 인원)', '옥포1동', 2026)
    life2_26 = series_24('동 생활인구(시각 평균 인원)', '옥포2동', 2026)
    card_cnt_26 = series_24('카드 매출건수', '옥포1동', 2026)
    card_amt_26 = series_24('카드 매출액(원)', '옥포1동', 2026)
    cc_sum = sum(card_cnt_26) or 1.0
    ca_sum = sum(card_amt_26) or 1.0

    rows14 = []
    for h in range(24):
        ticket = round(card_amt_26[h] / card_cnt_26[h]) if card_cnt_26[h] else 0
        rows14.append((
            h,
            round(comm_share[h], 6),
            round(dong_flow_share[h], 6),
            round(life_25[h], 2),
            round(life_26[h], 2),
            round(life2_26[h], 2),
            round(card_cnt_26[h] / cc_sum, 6),
            round(card_amt_26[h] / ca_sum, 6),
            ticket,
        ))
    write('14_flow_hourly.csv',
          ['시', '상권유동_44개월평균비율', '동유동_2026비율', '옥포1동_생활인구_2025', '옥포1동_생활인구_2026',
           '옥포2동_생활인구_2026', '카드건수_2026비율', '카드금액_2026비율', '카드건당금액_2026'],
          rows14)

    # 2) 옥포1동 거제 밖 유입 거주지 × 성·연령 (2025, 2026)
    inf = [x for x in read('floating_population/gnhub_okpo_inflow_origin.csv') if x['존재지'] == '옥포1동']
    sa_cols = ['남10대', '남20대', '남30대', '남40대', '남50대', '남60대', '남70대이상',
               '여10대', '여20대', '여30대', '여40대', '여50대', '여60대', '여70대이상']
    by_code = collections.defaultdict(dict)
    for x in inf:
        by_code[x['거주지코드']][x['연도']] = x
    rows15 = []
    for cd, yd in by_code.items():
        x26 = yd.get('2026') or yd.get('2025') or next(iter(yd.values()))
        x25 = yd.get('2025')
        nm = (x26['거주지'] or (x25['거주지'] if x25 else '')).strip()
        if not nm:
            nm = '미상'
            zone = '미상'
        elif cd.startswith('48'):
            zone = '경남시군'
        else:
            zone = '타시도'
        t25 = round(num(x25['합계_시각평균']), 3) if x25 else 0.0
        t26 = round(num(x26['합계_시각평균']), 3) if '2026' in yd else 0.0
        vals = [round(num(x26[c]), 4) for c in sa_cols]
        rows15.append((cd, nm, zone, t25, t26, *vals))
    rows15.sort(key=lambda r: -r[4])
    write('15_inflow_origin.csv', ['거주지코드', '거주지', '권역구분', '시각평균_2025', '시각평균_2026', *sa_cols], rows15)

    # 3) 월별 계절 가중치 (최근 12개월 202510~202609 상권 유동·매출, 나우캐스트 2025~2026 관외, 옥포대첩기념공원 2025)
    cm = [x for x in read('floating_population/gnhub_okpo_commercial_monthly.csv') if x['상권'] == '옥포1동 상권']
    cm_by_m = {}
    for x in cm:
        ym = x['연월']
        if '202510' <= ym <= '202609':
            cm_by_m[int(ym[4:])] = (num(x['유동인구_월합']), num(x['매출건수']), num(x['매출액_원']))
    nc = read('floating_population/nowcast_inflow_geoje_weekly.csv')
    nc_m = collections.defaultdict(list)
    for x in nc:
        w = x['주차']
        if w[:4] in ('2025', '2026'):
            m = int(w[5:7])
            nc_m[m].append(num(x['관외_일평균건수']))
    params = json.load(open(os.path.join(ROOT, 'data', 'processed', 'okpo_persona_params.json'), encoding='utf-8'))
    park_m = params['tourist']['okpo_park_monthly_2025']
    avg_fl = sum(v[0] for v in cm_by_m.values()) / 12
    avg_cnt = sum(v[1] for v in cm_by_m.values()) / 12
    avg_amt = sum(v[2] for v in cm_by_m.values()) / 12
    nc_avg = {m: sum(nc_m[m]) / len(nc_m[m]) for m in range(1, 13)}
    avg_nc = sum(nc_avg.values()) / 12
    avg_pk = sum(park_m) / 12
    rows16 = []
    for m in range(1, 13):
        fl, ct, am = cm_by_m[m]
        rows16.append((
            m,
            round(fl / avg_fl, 4),
            round(ct / avg_cnt, 4),
            round(am / avg_amt, 4),
            round(nc_avg[m] / avg_nc, 4),
            round(park_m[m - 1] / avg_pk, 4),
        ))
    write('16_monthly_weight.csv',
          ['월', '상권유동_가중치', '상권매출건수_가중치', '상권매출액_가중치', '나우캐스트관외_가중치', '기념공원입장객_가중치'],
          rows16)

    # 4) okpo_flow.json 정밀 갱신(시간대 비율 + 월별 실측 건수·매출액 반영)
    cm26 = [x for x in cm if '202601' <= x['연월'] <= '202609']
    flow_json = {
        '_note': '옥포1동 상권 유동·매출 실측치(경남빅데이터허브 SKT·NH카드, tools/gnhub_okpo_flow.py → tools/build_okpo_inputs.py). 주중·주말 분리는 원자료에 없어 월 평균 시간 비율을 함께 쓴다.',
        'flow_hour_share': [round(v, 6) for v in comm_share],
        'flow_hour_wd': [round(v, 6) for v in comm_share],
        'flow_hour_we': [round(v, 6) for v in comm_share],
        'flow_peak_to_mean': round(max(comm_share) / (sum(comm_share) / 24), 4),
        'flow_src': '경남빅데이터허브 주요상권 옥포1동 상권(48310550) 시간대별 유동인구 2023-01~2026-09(2023-08 결측 제외 44개월 평균 비율, SKT)',
        'living_pop_hour_2026': [round(v, 1) for v in life_26],
        'card_tx_hour_share_2026': [round(v / cc_sum, 6) for v in card_cnt_26],
        'sales_month': {
            'months': [f"{x['연월'][:4]}-{x['연월'][4:]}" for x in cm26],
            'flow_month_sum': [round(num(x['유동인구_월합'])) for x in cm26],
            'amount_krw': [round(num(x['매출액_원'])) for x in cm26],
            'amount_eok': [round(num(x['매출액_원']) / 1e8, 2) for x in cm26],
            'count': [int(num(x['매출건수'])) for x in cm26],
            'count_approx': [int(num(x['매출건수'])) for x in cm26],
            'avg_ticket_won': [round(num(x['매출액_원']) / num(x['매출건수'])) for x in cm26],
            'src': '경남빅데이터허브 주요상권 옥포1동 상권 월별 유동인구·소비매출(NH카드 점유율 보정 추정, gnhub_okpo_commercial_monthly.csv 정확값)',
        },
        'period': '2026-01~2026-09',
    }
    with open(os.path.join(ROOT, 'data', 'processed', 'okpo_flow.json'), 'w', encoding='utf-8') as f:
        json.dump(flow_json, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print('okpo_flow.json 갱신 완료')

    # 5) 17_flow_targets.json: 보정 목표(C1~C11) 및 독립 검증 기준값(V1~V8) 통합
    dy = {x['연도']: x for x in read('floating_population/gnhub_dong_yearly.csv') if x['면동'] == '옥포1동'}
    res_stat = collections.defaultdict(int)
    for x in read('population/경상남도 거제시_거주구분별인구수_20261031.csv'):
        if x['주소지'] == '옥포1동':
            res_stat[(x['거주상태'], '남' if x['성별'] == '남성' else '여')] += int(num(x['값']))
    sa = [x for x in read('floating_population/gnhub_okpo_sexage.csv') if x['연도'] == '2026']
    def sa_dict(ind, reg):
        sub = [x for x in sa if x['지표'] == ind and x['지역'] == reg]
        tot = sum(num(x['값']) for x in sub) or 1.0
        out = {}
        for x in sub:
            ag = re.sub(r'[^0-9]', '', x['연령'])
            if ag == '00' or '미만' in x['연령']:
                b = '0대'
            elif ag == '70':
                b = '70대이상'
            else:
                b = f'{ag}대'
            out[f"{b}|{x['성별']}"] = round(num(x['값']) / tot, 6)
        return out

    cb = [x for x in read('floating_population/gnhub_okpo_commercial_breakdown.csv')
          if x['상권'] == '옥포1동 상권' and x['연도'] == '2026']
    nh_sa_sub = [x for x in cb if x['구분'] == '성·연령별 매출액']
    nh_sa_tot = sum(num(x['매출액_원']) for x in nh_sa_sub) or 1.0
    nh_sa = {}
    for x in nh_sa_sub:
        sx = '남' if x['항목'] == '남성' else '여'
        b = '10대' if '10대' in x['항목2'] else x['항목2']
        nh_sa[f'{b}|{sx}'] = round(num(x['매출액_원']) / nh_sa_tot, 6)
    nh_org_sub = [x for x in cb if x['구분'] == '유입지(시도)별 매출액']
    nh_org = {x['항목']: round(num(x['매출액_원'])) for x in sorted(nh_org_sub, key=lambda r: -num(r['매출액_원']))}

    sbiz = json.load(open(os.path.join(RAW, 'floating_population', 'sbiz365_okpo_dong.json'), encoding='utf-8'))['옥포1동']
    sbiz_age = {x['age'].replace('M', '') + ('대이상' if x['age'] == 'M60' else '대'): x['pipcnt'] for x in sbiz['VstAgeRnk']}

    # 국적 × 5세 연령 (거제시 외국인주민현황 2026-10-31)
    for_age = collections.defaultdict(lambda: collections.Counter())
    for x in read('population/경상남도 거제시_외국인주민현황_20261031.csv'):
        v = int(num(x['값']))
        if v > 0:
            for_age[x['국적'].strip()][x['연령대'].strip()] += v

    targets = {
        'okpo1_resident_202610': {
            'registered_total': 7158,
            'actual_resident_male': res_stat[('거주자', '남')],
            'actual_resident_female': res_stat[('거주자', '여')],
            'actual_resident_total': res_stat[('거주자', '남')] + res_stat[('거주자', '여')],
            'unknown_residence': res_stat[('거주불명', '남')] + res_stat[('거주불명', '여')],
            'overseas_korean': res_stat[('재외국민', '남')] + res_stat[('재외국민', '여')],
            'src': '경상남도 거제시_거주구분별인구수_20261031.csv',
        },
        'okpo1_living_pop_2026': {
            'mean_simultaneous': round(num(dy['2026']['생활인구_시각평균']), 2),
            'outflow_outside_geoje': round(num(dy['2026']['시외유출_시각평균']), 2),
            'inflow_outside_geoje': round(num(dy['2026']['시외유입_시각평균']), 2),
            'hourly': [round(v, 2) for v in life_26],
            'sex_age_share': sa_dict('동 생활인구(시각 평균 인원)', '옥포1동'),
            'includes_registered_foreigners': True,
            'includes_age_10plus_only': True,
            'src': 'gnhub_dong_yearly.csv · gnhub_hourly.csv · gnhub_okpo_sexage.csv (2026년 1~9월, SKT)',
        },
        'okpo1_daily_unique_benchmarks': {
            'geoje_report_202610': 29067,
            'sbiz365_202608': sbiz['DynPplCmpr'][0]['cnt'],
            'sbiz365_age_counts': sbiz_age,
            'src': '면동별_주민등록_생활인구_202610.csv · sbiz365_okpo_dong.json',
        },
        'okpo1_street_flow_benchmarks': {
            'commercial_hourly_share_44m': [round(v, 6) for v in comm_share],
            'commercial_peak_to_mean': round(max(comm_share) / (sum(comm_share) / 24), 4),
            'dong_hourly_share_2026': [round(v, 6) for v in dong_flow_share],
            'commercial_sex_age_share_2026': sa_dict('상권 유동인구(월 합 평균)', '옥포1동 상권'),
            'src': 'gnhub_hourly.csv · gnhub_okpo_sexage.csv',
        },
        'okpo1_card_benchmarks': {
            'nh_2026_jan_sep_tx': round(cc_sum),
            'nh_2026_days': 273,
            'nh_daily_tx': round(cc_sum / 273, 2),
            'nh_avg_ticket_krw': round(ca_sum / cc_sum),
            'nh_hourly_tx_share': [round(v / cc_sum, 6) for v in card_cnt_26],
            'nh_sex_age_amount_share_2026': nh_sa,
            'nh_outside_sido_amount_2026': nh_org,
            'bok_2024_cash_tx_share': 0.159,
            'src': 'gnhub_hourly.csv · gnhub_okpo_commercial_breakdown.csv · 한국은행 2024 지급수단 이용행태 조사',
        },
        'foreign_age_by_nationality_geoje': {k: dict(v) for k, v in for_age.items() if sum(v.values()) >= 20},
    }
    with open(os.path.join(OUT, '17_flow_targets.json'), 'w', encoding='utf-8') as f:
        json.dump(targets, f, ensure_ascii=False, indent=1)
        f.write('\n')
    print('17_flow_targets.json 생성 완료')


def national_travel_survey():
    """2025 국민여행조사 원자료(SAV)에서 (1) 목적지 거제시(38090) 여행 응답과 (2) 경남 거주자 연령·성별 종사상 지위를 추출."""
    zp = os.path.join(ROOT, 'data', 'raw', 'tourism', 'national_travel_survey', '2025_국민여행조사_원자료_국내여행.zip')
    if not os.path.exists(zp):
        print('국민여행조사 원자료 zip 없음 — 기존 19·20 CSV 유지')
        return
    with zipfile.ZipFile(zp) as z:
        sav_name = [n for n in z.namelist() if n.upper().endswith('.SAV')][0]
        with z.open(sav_name) as f:
            hdr = f.read(176)
            _, nominal_case_size, _, _, ncases, bias = struct.unpack('<iiiiid', hdr[64:92])
            vars_meta, long_names = [], {}
            while True:
                rt = struct.unpack('<i', f.read(4))[0]
                if rt == 2:
                    vtype, has_lbl, n_miss, _, _ = struct.unpack('<iiiii', f.read(20))
                    sname = f.read(8).decode('cp949', 'replace').strip()
                    if has_lbl == 1:
                        ln = struct.unpack('<i', f.read(4))[0]
                        f.read((ln + 3) // 4 * 4)
                    if n_miss != 0:
                        f.read(abs(n_miss) * 8)
                    vars_meta.append((sname, vtype))
                elif rt == 3:
                    for _ in range(struct.unpack('<i', f.read(4))[0]):
                        f.read(8)
                        l = f.read(1)[0]
                        f.read(((l + 1 + 7) // 8) * 8 - 1)
                    f.read(4)
                    f.read(4 * struct.unpack('<i', f.read(4))[0])
                elif rt == 6:
                    for _ in range(struct.unpack('<i', f.read(4))[0]):
                        f.read(80)
                elif rt == 7:
                    sub, sz, cnt = struct.unpack('<iii', f.read(12))
                    raw = f.read(sz * cnt)
                    if sub == 13:
                        for item in raw.decode('cp949', 'replace').split('\t'):
                            if '=' in item:
                                k, v = item.split('=', 1)
                                long_names[k.strip()] = v.strip()
                elif rt == 999:
                    f.read(4)
                    break
            data = f.read()

    idx = {long_names.get(sn, sn): i for i, (sn, vt) in enumerate(vars_meta) if vt >= 0}
    spot_idxs = [idx[f'D_TRA1_{k}_SPOT'] for k in range(1, 18) if f'D_TRA1_{k}_SPOT' in idx]
    keep_names = ['D_TRA1_CASE', 'D_TRA1_SMONTH', 'D_TRA1_S_Day', 'D_TRA1_ONE_COST',
                  'A6', 'A6A', 'D_TRA1_B7A_1', 'D_TRA1_B7B_1',
                  'A8D', 'A8D_1', 'A8D_2', 'A8D_3', 'A8E', 'A8G',
                  'BSEX', 'BAGE', 'BARA', 'DQ2', 'DQ5', 'DQ5AB', 'DQ5AC', 'DQ5AD', 'DQ5B', 'WT_DOM']
    keep_idxs = [idx[k] for k in keep_names]
    need = set(spot_idxs + keep_idxs)

    SIDO = {1: '서울', 2: '부산', 3: '대구', 4: '인천', 5: '광주', 6: '대전', 7: '울산', 8: '세종',
            9: '경기', 10: '강원', 11: '충북', 12: '충남', 13: '전북', 14: '전남', 15: '경북', 16: '경남', 17: '제주'}
    AGE_MAP = {1: '10대', 2: '20대', 3: '30대', 4: '40대', 5: '50대', 6: '60대', 7: '70대이상'}
    TRANS_MAP = {1: '자가용', 2: '철도', 3: '항공기', 4: '선박', 5: '지하철', 6: '버스', 7: '관광버스',
                 8: '렌트카', 9: '자전거', 10: '택시', 11: '도보', 12: '기타'}

    pos = 0
    n_data = len(data)
    unpack_d = struct.unpack_from
    vals = {}
    slot = 0
    cases_read = 0
    trips = []
    emp = collections.defaultdict(lambda: collections.Counter())
    wk_hours = collections.defaultdict(lambda: [0.0, 0.0])
    wk5 = collections.defaultdict(lambda: [0.0, 0.0])

    i_bara, i_sex, i_age, i_wt = idx['BARA'], idx['BSEX'], idx['BAGE'], idx['WT_DOM']
    i_dq5, i_ab, i_ac, i_ad, i_b = idx['DQ5'], idx['DQ5AB'], idx['DQ5AC'], idx['DQ5AD'], idx['DQ5B']

    while pos + 8 <= n_data and cases_read < ncases:
        b0, b1, b2, b3, b4, b5, b6, b7 = data[pos:pos + 8]
        pos += 8
        for c in (b0, b1, b2, b3, b4, b5, b6, b7):
            if c == 0:
                continue
            if c == 252:
                pos = n_data
                break
            if c == 253:
                if slot in need:
                    v = unpack_d('<d', data, pos)[0]
                    vals[slot] = None if v < -1e300 else v
                pos += 8
            elif c < 252:
                if slot in need:
                    vals[slot] = c - bias
            else:
                if slot in need:
                    vals[slot] = None
            slot += 1
            if slot == nominal_case_size:
                cases_read += 1
                wt = vals.get(i_wt) or 1.0
                if vals.get(i_bara) == 16.0:
                    sx = '남' if vals.get(i_sex) == 1.0 else '여'
                    ab_age = AGE_MAP.get(int(vals.get(i_age) or 0), '기타')
                    if vals.get(i_dq5) == 1.0:
                        ab = vals.get(i_ab)
                        st = '임금근로' if ab == 1.0 else '자영업'
                        ac = vals.get(i_ac)
                        if ac and ac > 0:
                            wk_hours[st][0] += wt * ac
                            wk_hours[st][1] += wt
                        ad = vals.get(i_ad)
                        if ad in (1.0, 2.0):
                            wk5[st][0] += wt * (1.0 if ad == 1.0 else 0.0)
                            wk5[st][1] += wt
                    else:
                        b = vals.get(i_b)
                        st = '전업주부' if b == 1.0 else '학생' if b == 2.0 else '무직·은퇴'
                    emp[(ab_age, sx)][st] += wt

                n_geoje_spots = sum(1 for si in spot_idxs if vals.get(si) == 38090.0)
                if n_geoje_spots > 0:
                    n_all_spots = sum(1 for si in spot_idxs if (vals.get(si) or 0) > 0)
                    pty = max(int(vals.get(idx['A6']) or 1), 1)
                    u15 = int(vals.get(idx['A6A']) or 0)
                    nights = int(vals.get(idx['D_TRA1_S_Day']) or 0)
                    days = max(nights + 1, 1)
                    # 지출(A8*)은 일행 총액이므로 인원수(pty)와 여행일수(days)로 나누어 1인 1일 지출액도 함께 기록
                    share_geoje = n_geoje_spots / max(n_all_spots, 1)
                    fb_tot = (vals.get(idx['A8D']) or 0.0) + (vals.get(idx['A8E']) or 0.0) + (vals.get(idx['A8G']) or 0.0)
                    daily_street_1p = round(fb_tot * share_geoje / pty / days)
                    one_cost = round(vals.get(idx['D_TRA1_ONE_COST']) or 0.0)
                    tr_code = int(vals.get(idx['D_TRA1_B7B_1']) or vals.get(idx['D_TRA1_B7A_1']) or 1)
                    trips.append((
                        int(vals.get(idx['D_TRA1_CASE']) or 1),
                        int(vals.get(idx['D_TRA1_SMONTH']) or 1),
                        nights,
                        '남' if vals.get(i_sex) == 1.0 else '여',
                        AGE_MAP.get(int(vals.get(i_age) or 2), '30대'),
                        SIDO.get(int(vals.get(i_bara) or 16), '기타'),
                        pty,
                        u15,
                        TRANS_MAP.get(tr_code, '자가용'),
                        one_cost,
                        round((vals.get(idx['A8D_1']) or 0.0) / pty / days),
                        round((vals.get(idx['A8D_2']) or 0.0) / pty / days),
                        round((vals.get(idx['A8D_3']) or 0.0) / pty / days),
                        round((vals.get(idx['A8E']) or 0.0) / pty / days),
                        round((vals.get(idx['A8G']) or 0.0) / pty / days),
                        daily_street_1p,
                        round(share_geoje, 3),
                        round(wt, 2),
                    ))
                vals.clear()
                slot = 0

    write('19_travel_survey_geoje.csv',
          ['여행유형코드', '월', '숙박일수', '성별', '연령대', '거주시도', '동반인원', '만15세미만동반수', '주요교통수단',
           '1인총경비_원', '1인1일_일반음식점_원', '1인1일_주점_원', '1인1일_카페제과_원', '1인1일_식음료매장_원',
           '1인1일_활동비_원', '1인1일_거제상권지출_원', '거제방문비중', '가중치'],
          trips)

    emp_rows = []
    for (ab_age, sx), cnt in sorted(emp.items()):
        tot = sum(cnt.values()) or 1.0
        emp_rows.append((
            ab_age, sx, round(tot),
            round(cnt['임금근로'] / tot, 4),
            round(cnt['자영업'] / tot, 4),
            round(cnt['전업주부'] / tot, 4),
            round(cnt['학생'] / tot, 4),
            round(cnt['무직·은퇴'] / tot, 4),
            round(wk5['임금근로'][0] / (wk5['임금근로'][1] or 1), 4),
            round(wk5['자영업'][0] / (wk5['자영업'][1] or 1), 4),
            round(wk_hours['임금근로'][0] / (wk_hours['임금근로'][1] or 1), 1),
            round(wk_hours['자영업'][0] / (wk_hours['자영업'][1] or 1), 1),
        ))
    write('20_employment_gyeongnam.csv',
          ['연령대', '성별', '가중표본합', '임금근로_비율', '자영업_비율', '전업주부_비율', '학생_비율', '무직은퇴_비율',
           '임금근로_주5일비율', '자영업_주5일비율', '임금근로_주당시간', '자영업_주당시간'],
          emp_rows)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for step in (residents, foreigners, immigrant_spending, card_sales, vacancy, businesses, visitors,
                 weather, facilities, shipyard, floating_and_targets, national_travel_survey):
        step()
