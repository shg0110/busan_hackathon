"""1년 시뮬 입력(web/data/okpo_year.js)을 만든다.

- 달력: 2026년 달마다 평일 수와 쉬는 날 수(토·일 + 관공서 공휴일·대체공휴일). 쉬는 날은 '주말' 하루로 돌린다.
- 달마다 사람 수 배율: data/processed/okpo/16_monthly_weight.csv
    · 주민·조선소 통근자·외국인 근로자 = 상권매출건수_가중치(경남빅데이터허브 옥포1동 상권 NH카드 결제 건수, 12달 평균 1)
    · 주말 방문객 = 기념공원입장객_가중치(옥포대첩기념공원 2025 월별 입장객, 12달 평균 1)
- 임대료: data/raw/reb/rent_floor_okpo.csv(R-ONE 층별임대료 2026년 3분기, tools/reb_fetch_rent.py). 옥포 값이 없는 층은 경남 값.
- 임대료 밖 비용: 농식품부·농경연 2025 외식업체 경영실태조사(2024년 실적)
    · 평균 매출 2억5,526만 원, 평균 영업비용 2억3,294만 원(영업이익률 8.7%) — 농식품부 보도자료 2026-03-29
    · 영업비용 중 식재료비 44.5%·인건비 33.9%·임차료 8.4% — 한국농어민신문 2026-04-21(서상현 기자) 인용
    → 임차료를 뺀 영업비용 = 매출 × (23,294/25,526) × (1 − 0.084)
실행: python3 -I tools/year_build.py
"""
import os, csv, json, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
YEAR = 2026
# 2026년 관공서 공휴일(토·일과 겹치지 않는 날만 세면 되지만 모두 적어 둠). 대체공휴일 포함
HOLIDAYS = {
    '2026-01-01': '신정',
    '2026-02-16': '설 연휴', '2026-02-17': '설날', '2026-02-18': '설 연휴',
    '2026-03-01': '삼일절', '2026-03-02': '삼일절 대체공휴일',
    '2026-05-05': '어린이날',
    '2026-05-24': '부처님오신날', '2026-05-25': '부처님오신날 대체공휴일',
    '2026-06-03': '전국동시지방선거',
    '2026-06-06': '현충일',
    '2026-08-15': '광복절', '2026-08-17': '광복절 대체공휴일',
    '2026-09-24': '추석 연휴', '2026-09-25': '추석', '2026-09-26': '추석 연휴', '2026-09-28': '추석 대체공휴일',
    '2026-10-03': '개천절', '2026-10-05': '개천절 대체공휴일',
    '2026-10-09': '한글날',
    '2026-12-25': '성탄절',
}


def rcsv(p):
    return list(csv.DictReader(open(p, encoding='utf-8-sig')))


wt = {int(r['월']): r for r in rcsv(os.path.join(ROOT, 'data', 'processed', 'okpo', '16_monthly_weight.csv'))}
months = []
d = datetime.date(YEAR, 1, 1)
cnt = {m: [0, 0] for m in range(1, 13)}
hol = {m: [] for m in range(1, 13)}
while d.year == YEAR:
    off = d.weekday() >= 5 or d.isoformat() in HOLIDAYS
    cnt[d.month][1 if off else 0] += 1
    if d.isoformat() in HOLIDAYS and d.weekday() < 5:
        hol[d.month].append(f'{d.day}일 {HOLIDAYS[d.isoformat()]}')
    d += datetime.timedelta(days=1)
for m in range(1, 13):
    months.append({'m': m, 'wd': cnt[m][0], 'we': cnt[m][1], 'f': round(float(wt[m]['상권매출건수_가중치']), 4),
                   'ft': round(float(wt[m]['기념공원입장객_가중치']), 4), 'hol': hol[m]})

rent = {}
src_q = ''
for r in rcsv(os.path.join(ROOT, 'data', 'raw', 'reb', 'rent_floor_okpo.csv')):
    if r['항목'] != '임대료':
        continue
    src_q = r['분기']
    key = (r['상가유형'], r['층'])
    if r['지역'] == '경남>거제옥포' or (r['지역'] == '경남' and key not in rent):
        rent[key] = (round(float(r['값']) * 1000), r['지역'])
fl = {'지하1층': -1, '1층': 1, '2층': 2, '3층': 3, '4층': 4, '5층': 5, '6층이상': 6}
rent_js = {k: {str(fl[f]): {'won': v[0], 'src': v[1]} for (kk, f), v in rent.items() if kk == k} for k in ('소규모', '중대형')}

SALES, OPEX, RENT_SHARE = 25526, 23294, 0.084
other = OPEX / SALES * (1 - RENT_SHARE)
out = {
    'year': YEAR,
    'months': months,
    'days': sum(x['wd'] + x['we'] for x in months),
    'src_cal': f'{YEAR}년 달력 · 토·일과 관공서 공휴일(대체공휴일·6월 3일 지방선거 포함)은 주말처럼 돌림',
    'src_f': '경남빅데이터허브 옥포1동 상권 월별 카드 결제 건수(12달 평균 = 1). 주말 방문객은 옥포대첩기념공원 2025 월별 입장객',
    'rent': rent_js,
    'src_rent': f'한국부동산원 R-ONE 임대동향 층별임대료 {src_q[:4]}년 {int(src_q[4:])}분기 · 거제옥포(옥포에 없는 층은 경남)',
    'small': '2층 이하이고 층 면적 합이 330㎡ 이하인 건물은 소규모 상가, 나머지는 중대형 상가 값',
    'other': round(other, 4),
    'src_other': '농식품부·농경연 2025 외식업체 경영실태조사(2024년 실적): 영업비용 = 매출의 91.3%(2억3,294만 ÷ 2억5,526만 원), 그중 임차료 8.4% → 임대료 밖 비용(재료·인건비 등) = 매출의 '
                 + f'{other * 100:.1f}%. 음식점업·주점업 평균이라 장보기·생활 서비스 가게에는 맞지 않을 수 있음',
}
p = os.path.join(ROOT, 'web', 'data', 'okpo_year.js')
open(p, 'w', encoding='utf-8').write('// tools/year_build.py 가 만든 파일. 고치지 말 것\nwindow.YEAR_DATA = ' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n')
print(p, out['days'], '일 · 평일', sum(x['wd'] for x in months), '· 쉬는 날', sum(x['we'] for x in months), '· 임대료 밖 비용', round(other, 4))
for x in months:
    print(x['m'], x['wd'], x['we'], x['f'], x['ft'], x['hol'])
print(rent_js)
