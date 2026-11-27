"""구현 구역 「옥포로·성안로 ~ 옥포국제시장 일대」(거제시 옥포1동·옥포2동) 기준으로
페르소나에 쓸 원자료를 골라 data/processed/okpo/ 에 UTF-8 CSV 로 정리한다.

- 원자료(data/raw/geoje/)는 손대지 않는다. 인코딩(UTF-8 / CP949)은 자동으로 맞춘다.
- 동 단위 자료가 없는 것(방문자수·기온·조선소)은 거제시 전체 값을 쓰고 파일 이름에 _geoje 를 붙인다.
실행: python3 -I tools/build_okpo_inputs.py
"""
import os, csv, collections

HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, '..', 'data', 'raw', 'geoje')
OUT = os.path.join(HERE, '..', 'data', 'processed', 'okpo')
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


def foreigners():
    rows = []
    for x in read('population/경상남도_거제시_체류자격별 외국인 현황_20261031.csv'):
        a, b = int(num(x['옥포1동'])), int(num(x['옥포2동']))
        if a + b:
            rows.append((x['구분'], a, b, a + b))
    rows.sort(key=lambda r: -r[3])
    write('03_foreign_by_visa.csv', ['체류자격', '옥포1동', '옥포2동', '합계'], rows)


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
    # 동남권 공실률(tools/reb_fetch_busan.py ... 부산,울산,경남)에서 거제옥포만 고른다
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
        if int(d[:4]) < 2016:  # 최근 10년만
            continue
        for i, k in enumerate(('평균기온', '최저기온', '최고기온')):
            if x[k].strip():
                acc[int(d[5:7])][i].append(num(x[k]))
    rows = [(m, *(round(sum(v) / len(v), 1) for v in acc[m])) for m in sorted(acc)]
    write('11_weather_monthly_geoje.csv', ['월', '평균기온', '평균최저', '평균최고'], rows)


def facilities():
    rows = [(x['업종'], x['상호명'], x['도로명주소'])
            for x in read('tourism/경상남도_거제시_관광객이용시설업현황_20260721.csv')
            if any(f'거제시 {d}' in x['지번주소'] + x['도로명주소'] for d in ('옥포동', '덕포동'))]  # '옥포대첩로'(장목면) 제외
    write('12_tourism_facilities_okpo.csv', ['업종', '상호명', '도로명주소'], rows)


def shipyard():
    r = read('occupation/경상남도_거제시_양대조선소 종사자 현황_20230518.csv')
    write('13_shipyard_workers_geoje.csv', list(r[0].keys()), [list(x.values()) for x in r])


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for step in (residents, foreigners, card_sales, vacancy, businesses, visitors, weather, facilities, shipyard):
        step()
