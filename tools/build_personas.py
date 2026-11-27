"""옥포 가상 시민 실규모(하루 다녀간 약 2.4만 명, 1:1) 생성기 (v0.6.0 — 유동인구·일자리·국민여행조사 다중 보정).

방법:
  1) 후보 풀(50,000명)을 옥포1동 실측 인구·외국인(체류자격 → 성별 → 국적)·일자리(4,538개)·시외유입 거주지×성연령·
     국민여행조사(거제 378건)·경남 고용구조에서 생성. 도착 시각은 근무 시간·자주 가는 업종 영업시간 안에서만 고른다
  2) 후보마다 24시간 동 체류 벡터 p_i(h) 와 상권 거리 체류 벡터 s_i(h) 를 구성
  3) 다중 주변합 반복 비례 맞춤(raking)으로 C1~C6·C11(생활인구 24시간 곡선 8,894명의 평균과 모양, 성연령, 시외유입 3,417명,
     동내 일자리 4,538개, 상권 시간 비율) 동시 보정
  4) 보정으로 도출된 하루 순유동 인원 N = round(Σw) 전원을 1:1 가중치(1 페르소나 = 실제 1명)로 체계 추출(PPS) 후 미세 보정
  5) 카드 결제(하루 5,624건·시간대 비율·업종 비중·외지 비중)를 별도 보정하고, 보정에 쓰지 않은 독립 자료(V1~V10)로 검증
  6) 3D 웹 시뮬레이션(web/sim.js)이 전원 1:1로 직접 구동할 수 있도록 경량 번들(web/data/okpo_personas.js)도 함께 출력.
     시뮬에서 실제로 나오는 결제·시간대·외국인 지출은 tools/sim_persona_check.js 로 따로 확인한다

실행: python3 -I tools/build_personas.py
출력:
  - data/processed/personas/{personas.csv,.json,.jsonl, generation_rules.json, demographic_allocation.json, validation.json, 읽어보기.html}
  - web/data/okpo_personas.js
"""
import csv, html, json, math, os, random, re
from collections import Counter, defaultdict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P_IN = os.path.join(ROOT, 'data', 'processed', 'okpo')
P_RAW = os.path.join(ROOT, 'data', 'raw', 'geoje')
OUT = os.path.join(ROOT, 'data', 'processed', 'personas')
WEB_DATA_OUT = os.path.join(ROOT, 'web', 'data', 'okpo_personas.js')
M_POOL = 90000
OKPO2_SCOPE_WEIGHT = 0.50   # 지도 위 옥포2동 상권·주거 인접권 반영 비율 (옥포1동 1.0 + 옥포2동 0.50 → 약 4.5만 명 1:1)
TOURIST_DAILY_TARGET = 1500.0  # 옥포 권역(옥포항·수변공원·기념공원·덕포) 평일 일평균 관광객 목표(주말 ~2,300명, 수변공원 평상시 외지인 실측 1,105~2,176명 범위)
SEED = 20261127
VERSION = '0.6.1'
GEN_DATE = '2026-11-27'

# ── 데이터 없는 곳에만 남긴 최소 가정값 + 현장 상인 인터뷰(2026-11) 구조 보정값 ──
ASSUMED = {
    'child_escort_age': [30, 49],              # 0~9세는 단독 이동하지 않고 30~49세 주민이 동반
    'okpo1_resident_in_dong_job_share': 0.22,  # 옥포1동 취업 주민 중 동 안 사업체(4,538개)에 다니는 초기 비율(나머지는 아주동 조선소·고현 등 동 밖)
    'foreign_active_daily_share': 0.94,        # 옥포1동 등록외국인(10세+) 중 당일 거제 체류 비율
    'shipyard_weekday_arrival_mode': {         # 현장 인터뷰 반영: 한화오션 사내식당 식사로 평일 점심 상권 외출은 극소수(2%), 퇴근 후(70%) 집중
        'morning': 0.16, 'lunch': 0.02, 'after': 0.70, 'shift': 0.12,
    },
    'design_tech_street_out_prob': 0.25,       # 기술센터에 설계 업체 17곳 + 사내식당(웰리브)이 함께 있음(okpo_stores.csv). 현장 인터뷰 반영: 외부 설계동 한화오션 사내 이전·구내식당 이용으로 전문·과학·기술직 평일 상권 외출 대폭 축소(일반 0.68 → 0.25)
    'design_tech_lunch_boost': 0.18,           # 설계·기술직 12시 점심 외출 가중치 축소(일반 1.60 → 0.18)
    'foreign_pub_pref_scale': 0.20,            # 현장 인터뷰 반영: 저녁 외국인 유입 증가 대비 회식·고단가 주점 소비는 내국인의 1/5 수준으로 축소
    'foreign_mart_pref_scale': 1.45,           # 외국인 근로자 식자재·편의점 장보기 후 숙소 조리·모임 선호 반영
    'foreign_intl_meal_split': 0.34,           # 외국인 외식 중 다국적·고향 음식점 선호 비중
    'subcontract_pub_pref_scale': 0.72,        # 현장 인터뷰 반영: 조선소 협력사 내·외국인 혼성 근무 및 경기 체감으로 단체 회식 축소
    'expat_budget_scale': 1.30,                # 선주 감독관·외국 기술자(D-9-3 등) 1회 예산 배수. 소비 자료 없음 — 해외 본사 급여·체류비를 받는 고소득층(시나리오 조절용)
    'expat_family_budget_scale': 1.15,
    'expat_pub_pref_scale': 1.60,              # 옛 '옥포 이태원' 펍·바의 주 고객(머니투데이 2017-04-03 「불꺼진 '옥포 이태원', 선주의 빈자리」)
    'expat_weekday_arrival_mode': {'morning': 0.05, 'lunch': 0.12, 'after': 0.83, 'shift': 0.0},
    'sex_male_by_visa_class': {                # 체류자격 부류별 남성 비율 중 실측으로 못 바꾼 두 부류(가정). 나머지는 법무부 체류자격별 성별(23)
        'worker': 0.97,                        # 조선소 E-7·E-9. 전국 E-7 88.5%·E-9 90.1%는 농업·식품 등이 섞여 낮다. 옥포1동 실측 남성 679명에서 다른 부류(전국 비율)를 빼면 0.976
        'e6': 0.15,                            # 옥포 E-6은 전부 호텔유흥(E-6-2). 전국 E-6(39.0%)은 예술·운동선수가 섞여 맞지 않음
    },
    'lunch_out_from_outside_job': 0.25,        # 동 밖 직장인이 평일 점심에 옥포1동 상권으로 오는 정도(근처 직장일 때만, 12시 칸만)
    'foreign_paid_tx_factor': 0.85,            # 외국인 결제 빈도 배수(내국인 = 1.0). 옥포1·2동 통합 범위에서 R1·S4가 2025 이민자체류실태 범위(0.35~0.68) 안에 들도록 맞춤
    'foreign_budget_scale': {                  # 외국인 1회 예산 배수(내국인 = 1.0)
        'E-9·E-8·H-2': 0.50,                   # 고용허가제: 소득의 56.5%를 송금(전체 외국인 25.5%), 76.7%가 무상 거처 — 2025 이민자 체류실태(22_foreign_spending_survey.csv)
        '조선소(E-7 등)': 0.64,
        '그 외': 0.75,
    },
    'school_start_min': 530,                   # 1교시 08:50 (NEIS는 교시 수만 제공)
    'lesson_min': {'초': 40, '중': 45, '고': 50},
    'break_min': 10,
    'lunch_min': 50,
    'student_budget': {'초': [3000, 9000], '중': [4000, 11000], '고': [5000, 15000]},
    'street_extra_min': 15,                    # 상권 이동·걷기 부가 시간(분)
    'dwell_min_by_cat': {                      # 업종별 체류 시간 범위(분)
        'meal': [35, 75], 'pub': [80, 150], 'cafe': [25, 65],
        'intl': [35, 80], 'mart': [15, 35], 'life': [25, 70],
    },
    'pref_noise_concentration': 10.0,          # 개인별 업종 선호 디리클레 집중도
    'criteria_base_krei': {                    # 농촌경제연구원 식품소비행태조사 외식 선택 기준 순위 기반 기본 가중치(개인차 부여)
        '맛': 0.34, '가격': 0.25, '접근성': 0.19, '대기': 0.12, '분위기': 0.10,
    },
}

# 각 가정값의 근거 종류: 'interview' = 옥포 상인회 인터뷰(2026-11-27, 정량 근거 없음 → 시나리오 조절 대상),
# 'interview+data' = 인터뷰 + 저장소 데이터로 정황 확인, 'survey' = 공식 조사 수치에서 유도, 'assumption' = 데이터 없는 곳의 최소 가정
ASSUMED_SOURCES = {
    'shipyard_weekday_arrival_mode': 'interview', 'foreign_pub_pref_scale': 'interview',
    'subcontract_pub_pref_scale': 'interview', 'foreign_paid_tx_factor': 'interview',
    'foreign_mart_pref_scale': 'assumption', 'foreign_intl_meal_split': 'assumption',
    'foreign_budget_scale': 'survey', 'foreign_active_daily_share': 'assumption',
    'design_tech_street_out_prob': 'interview+data', 'design_tech_lunch_boost': 'interview+data',
    'expat_pub_pref_scale': 'press+data', 'expat_budget_scale': 'assumption', 'expat_family_budget_scale': 'assumption',
    'criteria_base_krei': 'survey',
}
ASSUMED_SOURCES = {k: ASSUMED_SOURCES.get(k, 'assumption') for k in ASSUMED}

CATS = ['meal', 'pub', 'cafe', 'intl', 'mart', 'life']
CAT_KO = {'meal': '식사', 'pub': '주점·호프', 'cafe': '카페·빵', 'intl': '다국적 식당', 'mart': '장보기', 'life': '생활 서비스·쇼핑'}
CARD_CAT = {
    '일반음식점': 'meal', '유흥주점': 'pub', '음료/디저트': 'cafe',
    '식료품': 'mart', '중소형종합유통': 'mart', '대형종합유통': 'mart', '기타유통업체': 'mart',
    '의류': 'life', '미용': 'life', '화장품': 'life', '잡화': 'life', '약국': 'life', '사우나/마사지': 'life',
    '안경/콘텍트렌즈': 'life', '서점/출판/문구점': 'life', '오락시설': 'life', '취미': 'life', '스포츠/레저': 'life', '관람': 'life',
}
STUDENT_CATS = {'meal', 'cafe', 'life', 'mart'}

SEGMENTS = ['resident', 'foreign_resident', 'okpo1_worker', 'stayer', 'commuter', 'geoje_visitor', 'tourist']
SEG_KO = {
    'resident': '옥포1동 주민',
    'foreign_resident': '옥포 거주 외국인',
    'okpo1_worker': '옥포1동 상권·사업체 근무자',
    'stayer': '시외 체류·숙소형 유입',
    'commuter': '시외 주간 유입(통근·출장)',
    'geoje_visitor': '거제 타동 방문객',
    'tourist': '관광객',
}
SIM_GROUP = {
    'resident': 'resident',
    'foreign_resident': 'foreign',
    'okpo1_worker': 'worker',
    'stayer': 'worker',
    'commuter': 'worker',
    'geoje_visitor': 'resident',
    'tourist': 'tourist',
}
WEEKDAYS = ['월', '화', '수', '목', '금']


def rcsv(path, enc='utf-8-sig'):
    with open(path, encoding=enc, newline='') as f:
        return list(csv.DictReader(f))


def pick(rng, weights):
    ks = [k for k, v in weights.items() if v > 0]
    ws = [weights[k] for k in ks]
    return rng.choices(ks, ws)[0]


def dirichlet(rng, mean, conc):
    g = {k: rng.gammavariate(max(v * conc, 1e-3), 1.0) for k, v in mean.items()}
    s = sum(g.values()) or 1.0
    return {k: round(v / s, 4) for k, v in g.items()}


def band_of(age):
    return '70대이상' if age >= 70 else f'{max(age // 10 * 10, 10)}대'


def ro(word):
    c = ord(word[-1]) - 0xAC00
    return word + ('으로' if 0 <= c < 11172 and c % 28 not in (0, 8) else '로')


def hhmm(m):
    m = int(round(m)) % 1440
    return f'{m // 60:02d}:{m % 60:02d}'


def overlap_hour(s0, s1, h):
    """구간 [s0, s1] (분, 0~2880 허용)이 시각 h (0~23)와 겹치는 시간 비율(0~1)."""
    if s1 <= s0:
        return 0.0
    m0, m1 = h * 60.0, (h + 1) * 60.0
    ov = max(0.0, min(m1, s1) - max(m0, s0)) + max(0.0, min(m1 + 1440.0, s1) - max(m0 + 1440.0, s0))
    return min(1.0, ov / 60.0)


# ── 1. 입력 데이터 읽기 ─────────────────────────────────────────────────────
single_age_rows = rcsv(os.path.join(P_IN, '18_residents_single_age.csv'))
visa_rows = rcsv(os.path.join(P_IN, '03_foreign_by_visa.csv'))
card_detail = rcsv(os.path.join(P_IN, '07_card_detail.csv'))
biz_rows = rcsv(os.path.join(P_IN, '09_businesses_by_industry.csv'))
weekday_vis = rcsv(os.path.join(P_IN, '10_visitors_weekday_geoje.csv'))
flow_hourly = rcsv(os.path.join(P_IN, '14_flow_hourly.csv'))
inflow_rows = rcsv(os.path.join(P_IN, '15_inflow_origin.csv'))
monthly_rows = rcsv(os.path.join(P_IN, '16_monthly_weight.csv'))
targets_json = json.load(open(os.path.join(P_IN, '17_flow_targets.json'), encoding='utf-8'))
travel_rows = rcsv(os.path.join(P_IN, '19_travel_survey_geoje.csv'))
emp_rows = rcsv(os.path.join(P_IN, '20_employment_gyeongnam.csv'))
params = json.load(open(os.path.join(ROOT, 'data', 'processed', 'okpo_persona_params.json'), encoding='utf-8'))
stores_raw = rcsv(os.path.join(ROOT, 'data', 'processed', 'okpo_stores.csv'))
periods = rcsv(os.path.join(P_RAW, 'school', 'periods_by_weekday.csv'))
events = rcsv(os.path.join(P_RAW, 'school', 'schedule_events.csv'))
schools = rcsv(os.path.join(P_RAW, 'school', 'schools.csv'))
living_dong_rows = rcsv(os.path.join(P_RAW, 'floating_population', '면동별_주민등록_생활인구_202610.csv'))

# 실측 상권 점포 중 다국적 식당 비율(일반음식점 + 다국적 중 intl 점포 비중 = 9 / 488 = 0.0184)
n_meal_stores = sum(1 for r in stores_raw if r['상권업종대분류명'] == '음식' and r['상권업종중분류명'] != '주점' and r['상권업종중분류명'].strip() != '비알코올')
n_intl_stores = sum(1 for r in stores_raw if r['상권업종대분류명'] == '음식' and (
    r['상권업종중분류명'] in ('동남아시아', '기타 외국식') or
    re.search(r'베트남|태국|인도|네팔|우즈벡|몽골|필리핀|스리랑카|할랄|케밥|쌀국수', r['상권업종소분류명'] + r['상호명'])))
INTL_STORE_RATIO = n_intl_stores / max(n_meal_stores, 1)  # ~0.0184

# 업종별 영업시간(세부 업종 대표 영업시간의 합집합, okpo_menu.json — 3D 시뮬레이션과 같은 값).
# 도착 시각을 고를 때 '이 사람이 주로 가는 업종이 문 연 시간'만 쓴다(예전엔 낮에 술집, 이른 아침에 식당으로 와서 시뮬에서 헛걸음)
MENU_SUBS = json.load(open(os.path.join(ROOT, 'data', 'processed', 'okpo_menu.json'), encoding='utf-8'))['subs']
CAT_OPEN = {c: (min(x['open'] for x in MENU_SUBS if x['cat'] == c), max(x['close'] for x in MENU_SUBS if x['cat'] == c)) for c in CATS}


def cat_open_hour(c, h):
    o, cl = CAT_OPEN[c]
    return any(o <= m < cl - 10 for m in (h * 60 + 30, h * 60 + 30 + 1440))


CAT_HOUR_MASK = {c: [1.0 if cat_open_hour(c, h) else 0.0 for h in range(24)] for c in CATS}


def read_js_json(path):
    t = open(path, encoding='utf-8').read()
    return json.loads(t[t.index('{'):t.rindex('}') + 1])


# 업종별 가게 1인 지출(시뮬과 같은 단위): 세부 업종 대표 메뉴 바구니(web/data/okpo_menu.js) × 옥포 가게 수 × sim.js 가격대 무게(tier).
# 유흥주점(11만 원)처럼 고가 세부업종은 sim.js 에서 가격 탄력성(tier)으로 방문 비중이 낮으므로, 단순 점포수 평균 대신 tier 가중 평균을 써서
# C9 보정이 주점 방문 횟수를 과도하게 줄이지 않도록 맞춘다
_menu_js = read_js_json(os.path.join(ROOT, 'web', 'data', 'okpo_menu.js'))
_sim_js = read_js_json(os.path.join(ROOT, 'web', 'data', 'okpo_sim.js'))
_sub_n = _sim_js['counts']['by_sub']
_CAT_REF = {'meal': 9500, 'pub': 22000, 'cafe': 4800, 'intl': 10000, 'mart': 11000, 'life': 18000}
CAT_PRICE = {}
for c in CATS:
    subs = [x for x in _menu_js['subs'] if x['cat'] == c]
    ws = [(_sub_n.get(x['id'], 0) * min(1.6, max(0.25, (_CAT_REF[c] / max(x['basket'], 1000)) ** 0.5))
           * (0.35 if x['id'] == 'yuheung' else 1.0)) for x in subs]
    n = sum(ws)
    CAT_PRICE[c] = (sum(x['basket'] * w for x, w in zip(subs, ws)) / n) if n else sum(x['basket'] for x in subs) / len(subs)

# 옥포1동 기술센터(대우조선 복합업무지원단지, 옥포동 1991-9, 18층): 설계·엔지니어링 업체와 사내식당(웰리브)이 한 건물에 있음
# → 설계·기술직 점심을 건물 안 구내식당에서 해결한다는 상인회 인터뷰(2026-11-27)의 근거
TECH_CENTER_PNU = '4831010600119910009'
tech_center_stores = [r for r in stores_raw if r['지번코드'] == TECH_CENTER_PNU]
TECH_CENTER = {
    'engineering_firms': sum(1 for r in tech_center_stores if r['상권업종대분류명'] == '과학·기술'),
    'cafeteria': sum(1 for r in tech_center_stores if '웰리브' in r['상호명']),
    'okpo1_sci_tech_firms': sum(1 for r in stores_raw if r['행정동명'] == '옥포1동' and r['상권업종대분류명'] == '과학·기술'),
}

# 2025 이민자체류실태: 외국인 총소득 대비 지출 비중(국내에서 쓰는 몫 = 생활비 + 기타, E-9는 송금 56.5%)
spend_survey = {(r['대상'], r['조사시점'], r['항목']): float(r['값'])
                for r in rcsv(os.path.join(P_IN, '22_foreign_spending_survey.csv'))}
FOREIGN_LOCAL_SPEND_SHARE = (spend_survey[('외국인 전체', '2025-05', '생활비')]
                             + spend_survey[('외국인 전체', '2025-05', '기타')]) / 100.0           # 0.472
E9_REMIT_SHARE = spend_survey[('비전문취업(E-9)', '2025-05', '국내외 송금')] / 100.0              # 0.565
KR_CONSUME_PROPENSITY = spend_survey[('내국인 가구(비교)', '2025-01~03', '평균소비성향')] / 100.0  # 0.698
# R1 참고 범위(외국인 1인당 하루 상권 지출 ÷ 내국인):
#  · 외국인 전체: 국내 지출 몫 47.2% ÷ 내국인 소비성향 69.8% ≈ 0.68(소득이 같을 때 상한). 기숙사·사내 편의시설·옥포 밖 소비를 빼면 더 낮아 0.35~0.70
#  · E-9 등: 송금 56.5%로 국내에 남는 몫이 최대 43.5%, 기사 "번 돈의 약 1/3만 국내에서 씀" → 0.33 ÷ 0.698 ≈ 0.48 상한, 사내 소비를 빼 0.25~0.50
R1_RANGE_ALL = (0.35, round(FOREIGN_LOCAL_SPEND_SHARE / KR_CONSUME_PROPENSITY, 2))
R1_RANGE_E9 = (0.25, 0.50)

# 시간대 벡터 (0~23시): 옥포1동 + OKPO2_SCOPE_WEIGHT × 옥포2동(2026년 1~9월 동 생활인구)
_okpo2_hourly = [0.0] * 24
for _r in rcsv(os.path.join(P_RAW, 'floating_population', 'gnhub_hourly.csv')):
    if _r['기간'] == '2026' and _r['지역'] == '옥포2동' and '생활인구' in _r['지표']:
        _okpo2_hourly[int(_r['시'])] = float(_r['값'] or 0)
T1_HOURLY = [float(r['옥포1동_생활인구_2026']) + OKPO2_SCOPE_WEIGHT * _okpo2_hourly[h] for h, r in enumerate(flow_hourly)]
T1_MEAN = sum(T1_HOURLY) / 24.0  # 약 17,962명 (옥포1동 8,894 + 옥포2동 18,138 × 0.50)
COMM_HOUR_SHARE = [float(r['상권유동_44개월평균비율']) for r in flow_hourly]
DONG_FLOW_SHARE_26 = [float(r['동유동_2026비율']) for r in flow_hourly]
CARD_HOUR_SHARE = [float(r['카드건수_2026비율']) for r in flow_hourly]
CARD_HOUR_TICKET = [float(r['카드건당금액_2026']) for r in flow_hourly]
CARD_MEAN_TICKET = targets_json['okpo1_card_benchmarks']['nh_avg_ticket_krw']
CARD_DAILY_TARGET = targets_json['okpo1_card_benchmarks']['nh_daily_tx']  # 5623.52
BOK_CASH_SHARE = targets_json['okpo1_card_benchmarks']['bok_2024_cash_tx_share']  # 0.159
# 지도 범위(옥포1동 + 옥포2동) 오프라인 총 일매출 목표 (앱 배달·포장 제외, 현장 방문 결제 기준):
#  1) 허브 2026년 1~9월(273일) 동별 카드 매출액 × 지도 상가 포함률(okpo_stores ÷ sbiz365) = 약 2.90억 원/일
#  2) 허브(NH 보정) → 거제시 전체 카드(공공데이터 07_card_detail, 개인+기업 시뮬업종) 보정: 2025년 1~2월 동일 기간 비율(≈ 1.248배)
#  3) 오프라인 비카드 결제(현금·지역화폐 등) 보정: ÷ (1 − 0.159) ≈ 1.189배 (앱 배달·포장은 포함하지 않음)
_sbiz365 = json.load(open(os.path.join(P_RAW, 'floating_population', 'sbiz365_okpo_dong.json'), encoding='utf-8'))
_gnhub_amt_26 = Counter()
for _r in rcsv(os.path.join(P_RAW, 'floating_population', 'gnhub_hourly.csv')):
    if _r['기간'] == '2026' and _r['지표'] == '카드 매출액(원)' and _r['지역'] in ('옥포1동', '옥포2동'):
        _gnhub_amt_26[_r['지역']] += float(_r['값'] or 0)
_map_store_by_dong = Counter(r['행정동명'] for r in stores_raw)
MAP_DONG_COVERAGE = {
    d: min(1.0, _map_store_by_dong[d] / max(_sbiz365[d]['cfrStcnt']['stcnt'], 1))
    for d in ('옥포1동', '옥포2동')
}
_hub_map_card_daily = sum(
    (_gnhub_amt_26[d] / targets_json['okpo1_card_benchmarks']['nh_2026_days']) * MAP_DONG_COVERAGE[d]
    for d in ('옥포1동', '옥포2동')
)
_hub_25_12 = sum(
    float(_r['매출액_원'] or 0)
    for _r in rcsv(os.path.join(P_RAW, 'floating_population', 'gnhub_okpo_commercial_monthly.csv'))
    if '옥포1동' in _r['상권'] and _r['연월'] in ('202501', '202502')
)
_portal_25_12_sim = sum(
    float(_r['추정이용금액'] or 0)
    for _r in card_detail
    if _r['동'] == '옥포1동' and _r['업종중분류'] in CARD_CAT
)
HUB_TO_ALL_CARD = _portal_25_12_sim / max(_hub_25_12, 1.0)  # ≈ 1.248 (법인·누락 가맹점 보정)
OFFLINE_TOTAL_MULT = HUB_TO_ALL_CARD / (1.0 - BOK_CASH_SHARE)  # ≈ 1.484 (오프라인 현장 결제 총량, 앱 배달·포장 제외)
MAP_DAILY_SALES_TARGET_KRW = _hub_map_card_daily * OFFLINE_TOTAL_MULT  # 약 4억 2,990만 원/일

# 옥포1동 실거주자(거주불명·재외국민 제외) 1세 단위 인구
res_info = targets_json['okpo1_resident_202610']
actual_scale = {
    '남': res_info['actual_resident_male'] / 3832.0,
    '여': res_info['actual_resident_female'] / 3326.0,
}
age_w_okpo1 = {'남': {}, '여': {}}
age_w_okpo2 = {'남': {}, '여': {}}
for r in single_age_rows:
    a = int(r['연령'])
    v = float(r['인구수'])
    if r['동'] == '옥포1동':
        age_w_okpo1[r['성별']][a] = v * actual_scale[r['성별']]
    else:
        age_w_okpo2[r['성별']][a] = v

OKPO1_ACTUAL_10P = sum(v for s in ('남', '여') for a, v in age_w_okpo1[s].items() if a >= 10)  # ~6,765명
OKPO2_ACTUAL_10P = sum(v for s in ('남', '여') for a, v in age_w_okpo2[s].items() if a >= 10)
age_w_scope = {s: {a: age_w_okpo1[s].get(a, 0.0) + OKPO2_SCOPE_WEIGHT * age_w_okpo2[s].get(a, 0.0)
                   for a in set(age_w_okpo1[s]) | set(age_w_okpo2[s])} for s in ('남', '여')}
_dong_yearly_26 = {r['면동']: r for r in rcsv(os.path.join(P_RAW, 'floating_population', 'gnhub_dong_yearly.csv')) if r['연도'] == '2026'}
OUTFLOW_OUTSIDE_GEOJE_1 = targets_json['okpo1_living_pop_2026']['outflow_outside_geoje']  # 1,747.94명
OUTFLOW_OUTSIDE_GEOJE_2 = float(_dong_yearly_26['옥포2동']['시외유출_시각평균'])
OUTFLOW_OUTSIDE_GEOJE = OUTFLOW_OUTSIDE_GEOJE_1 + OKPO2_SCOPE_WEIGHT * OUTFLOW_OUTSIDE_GEOJE_2
INFLOW_OUTSIDE_GEOJE_1 = targets_json['okpo1_living_pop_2026']['inflow_outside_geoje']    # 3,416.74명
INFLOW_OUTSIDE_GEOJE_2 = float(_dong_yearly_26['옥포2동']['시외유입_시각평균'])
INFLOW_OUTSIDE_GEOJE = INFLOW_OUTSIDE_GEOJE_1 + OKPO2_SCOPE_WEIGHT * INFLOW_OUTSIDE_GEOJE_2  # ~5,156명

# 0~9세 아이 동반 비율 (옥포1동 실측)
children_0_9 = sum(age_w_okpo1[s].get(a, 0.0) for s in ('남', '여') for a in range(10))
parents_30_49 = sum(age_w_okpo1[s].get(a, 0.0) for s in ('남', '여')
                    for a in range(ASSUMED['child_escort_age'][0], ASSUMED['child_escort_age'][1] + 1))
CHILD_RATE = children_0_9 / max(parents_30_49, 1.0)
SINGLE_HH_SHARE = params['resident']['by_dong']['옥포1동']['single_household_share']  # 0.49

# 경남 연령×성별 고용구조 (2025 국민여행조사 경남 표본)
EMP_GN = {}
WK5_SHARE = {'임금근로': 0.842, '자영업': 0.1533}
WK_HOURS = {'임금근로': 40.6, '자영업': 41.4}
for r in emp_rows:
    EMP_GN[(r['연령대'], r['성별'])] = {
        '임금근로': float(r['임금근로_비율']),
        '자영업': float(r['자영업_비율']),
        '전업주부': float(r['전업주부_비율']),
        '학생': float(r['학생_비율']),
        '무직·은퇴': float(r['무직은퇴_비율']),
    }
    WK5_SHARE['임금근로'] = float(r['임금근로_주5일비율'])
    WK5_SHARE['자영업'] = float(r['자영업_주5일비율'])
    WK_HOURS['임금근로'] = float(r['임금근로_주당시간'])
    WK_HOURS['자영업'] = float(r['자영업_주당시간'])

# 옥포1·2동 지도 범위 사업체 일자리 (옥포1동 4,538 + 옥포2동 4,188 × OKPO2_SCOPE_WEIGHT ≈ 6,632개, 16개 산업)
JOBS_OKPO1 = Counter()
for r in biz_rows:
    v = int(r['종사자수'])
    if v > 0:
        w_d = 1.0 if r['동'] == '옥포1동' else (OKPO2_SCOPE_WEIGHT if r['동'] == '옥포2동' else 0.0)
        if w_d > 0:
            JOBS_OKPO1[r['산업']] += v * w_d
JOBS_OKPO1 = {k: int(round(v)) for k, v in JOBS_OKPO1.items() if v > 0}
TOTAL_JOBS_OKPO1 = sum(JOBS_OKPO1.values())  # ~6,632

# 외국인 비자(옥포1동 1,049명, 옥포2동 1,052명) 및 국적별 5세 연령(거제 실측)
visa_okpo1 = Counter({r['체류자격']: int(r['옥포1동']) for r in visa_rows if int(r['옥포1동']) > 0})
visa_okpo2 = Counter({r['체류자격']: int(r['옥포2동']) for r in visa_rows if int(r['옥포2동']) > 0})
visa_all = Counter({r['체류자격']: int(r['합계']) for r in visa_rows if int(r['합계']) > 0})
fd1 = params['foreign']['by_dong']['옥포1동']
fd2 = params['foreign']['by_dong']['옥포2동']

for_age_raw = targets_json['foreign_age_by_nationality_geoje']
NAT_KEY_MAP = {'타이': '타이', '베트남': '베트남', '필리핀': '필리핀', '프랑스': '프랑스', '네팔': '네팔',
               '인도네시아': '인도네시아', '우즈베키스탄': '우즈베키스탄', '미얀마': '미얀마', '러시아': '러시아(연방)',
               '중국': '중국', '한국계중국인': '한국계중국인', '인도': '인도'}
AGE5_BOUNDS = {
    '10-14세': (10, 14), '15-19세': (15, 19), '20-24세': (20, 24), '25-29세': (25, 29),
    '30-34세': (30, 34), '35-39세': (35, 39), '40-44세': (40, 44), '45-49세': (45, 49),
    '50-54세': (50, 54), '55-59세': (55, 59), '60-64세': (60, 64), '65-69세': (65, 69),
    '70-74세': (70, 74), '75-79세': (75, 79), '80세이상': (80, 84),
}
foreign_age_global = Counter()
for d in for_age_raw.values():
    for k, v in d.items():
        if k in AGE5_BOUNDS:
            foreign_age_global[k] += v

# 거제 국적 분포(외국인주민현황 2026-10-31, 20명 이상 국적 전부). 예전엔 상위 5~6개국 밖을 모두 '기타'로 뭉쳐 외국인의 47%가 '기타'였다
GEOJE_NAT = Counter({n: sum(v for k, v in d.items() if k in AGE5_BOUNDS) for n, d in for_age_raw.items()})
NAT_ALIAS = {'러시아': '러시아(연방)'}


def nat_allowed(n, allowed):
    if allowed is None:
        return True
    if allowed == 'non_expat':
        return n not in NAT_SETS['expat'] or n in ('인도', '러시아(연방)', '말레이시아', '튀르키예')
    return n in allowed


NAT_JOINT = {}


def nat_joint(dong, visa_counts):
    """동의 국적 × 체류자격 표. 씨앗 = 거제 국적 분포 × '그 체류자격에 나올 수 있는 국적'. 체류자격별 인원(열)과
    동 상위 5개국 인원·나머지 합(행)에 함께 맞춘다(반복 비례 맞춤). 예전엔 국적을 체류자격과 따로 뽑아 E-9 프랑스인 등이 나왔다."""
    if dong in NAT_JOINT:
        return NAT_JOINT[dong]
    bd = params['foreign']['by_dong'].get(dong)
    top = {NAT_ALIAS.get(k, k): v for k, v in bd['top'].items()} if bd else {}
    nats = sorted(set(GEOJE_NAT) | set(top))   # 정렬: 집합 순서는 실행마다 달라져(문자열 해시) 같은 seed 에서도 결과가 바뀐다
    cols = {}
    for lab, c in visa_counts.items():
        _o, code, cls = visa_job(lab)
        allowed = nat_set_for(cls, code)
        col = {n: float(GEOJE_NAT.get(n, 1)) for n in nats if nat_allowed(n, allowed)} or {n: float(GEOJE_NAT.get(n, 1)) for n in nats}
        if code in cols:
            cols[code][0] += c
        else:
            cols[code] = [float(c), col]
    rest_tgt = (bd['total'] - sum(top.values())) if bd else None
    for _ in range(80):
        for c, col in cols.values():
            sm = sum(col.values()) or 1.0
            for n in col:
                col[n] *= c / sm
        if top:
            rows = Counter()
            for _c, col in cols.values():
                for n, v in col.items():
                    rows[n] += v
            rest_cur = sum(v for n, v in rows.items() if n not in top) or 1.0
            for _c, col in cols.values():
                for n in col:
                    col[n] *= (top[n] / max(rows[n], 1e-9)) if n in top else (rest_tgt / rest_cur)
    NAT_JOINT[dong] = {code: col for code, (_c, col) in cols.items()}
    return NAT_JOINT[dong]


def pick_nationality(rng, dong, cls, code):
    counts = visa_okpo1 if dong == '옥포1동' else visa_by_dong.get(dong)
    if counts:
        col = nat_joint(dong, counts).get(code)
        if col:
            return pick(rng, col)
    w = {n: v for n, v in GEOJE_NAT.items() if nat_allowed(n, nat_set_for(cls, code))}
    return pick(rng, w or GEOJE_NAT)


def pick_visa_given_sex(rng, visa_counts, sex):
    """체류자격 인원 × 그 부류의 성비로, 이미 정해진 성별에 맞는 체류자격을 뽑는다."""
    ws = {}
    for v, c in visa_counts.items():
        pm = SEX_MALE_BY_CLASS[visa_job(v)[2]]
        ws[v] = c * (pm if sex == '남' else 1.0 - pm)
    return pick(rng, ws)

# 시외 유입 (거주지 × 성 × 연령, 2026년 1~9월 옥포1동 시각평균 3,416.74명)
SA_COLS = [('남', '10대', '남10대'), ('남', '20대', '남20대'), ('남', '30대', '남30대'), ('남', '40대', '남40대'),
           ('남', '50대', '남50대'), ('남', '60대', '남60대'), ('남', '70대이상', '남70대이상'),
           ('여', '10대', '여10대'), ('여', '20대', '여20대'), ('여', '30대', '여30대'), ('여', '40대', '여40대'),
           ('여', '50대', '여50대'), ('여', '60대', '여60대'), ('여', '70대이상', '여70대이상')]
inflow_cells_prov = Counter()  # 타시도 (숙소형 중심 + 일부 당일 업무)
inflow_cells_gn = Counter()    # 경남 시군 (통근형 중심 + 일부 숙소형)
for r in inflow_rows:
    if float(r['시각평균_2026']) <= 0:
        continue
    org_nm = r['거주지']
    zone = r['권역구분']
    for sx, bd, col in SA_COLS:
        v = float(r[col])
        if v > 0:
            if zone == '경남시군':
                inflow_cells_gn[(org_nm, bd, sx)] += v
            elif zone == '타시도':
                inflow_cells_prov[(org_nm, bd, sx)] += v
            else:
                inflow_cells_prov[('기타 시도', bd, sx)] += v * 0.68
                inflow_cells_gn[('경남 기타', bd, sx)] += v * 0.32
GN_NAMES = {k[0] for k in inflow_cells_gn}   # 경남 시군(‘경남 기타’ 포함)

# 거제 다른 동 방문객 출발지 가중치 (옥포1동과의 인접성 × 동 규모 반영)
NEAR_FACTOR = {'옥포2동': 4.0, '아주동': 3.5, '장승포동': 2.2, '능포동': 1.8, '연초면': 1.6,
               '장목면': 1.3, '수양동': 1.2, '상문동': 1.1, '고현동': 1.1, '장평동': 1.0}
other_dong_weights = {}
for r in living_dong_rows:
    d = r['면동']
    if d not in ('전체', '옥포1동'):
        other_dong_weights[d] = int(r['당월_주민등록']) * NEAR_FACTOR.get(d, 0.5)

# 타동 거주 외국인의 사는 곳·체류자격: 거제 읍면동별 등록외국인(21_foreign_by_dong_visa, 장평동 6,673·아주동 3,241·옥포2동 1,052명 …) × 옥포까지 거리
foreign_dong_rows = rcsv(os.path.join(P_IN, '21_foreign_by_dong_visa.csv'))
visa_by_dong = defaultdict(Counter)
for r in foreign_dong_rows:
    if r['동'] != '옥포1동':
        visa_by_dong[r['동']][r['체류자격']] += int(r['인원'])
foreign_home_weights = {d: sum(c.values()) * NEAR_FACTOR.get(d, 0.5) for d, c in visa_by_dong.items()}

# 카드매출 (옥포1·2동 개인 상세 `07`, 옥포1동 단독 비중도 별도 집계)
card = defaultdict(lambda: defaultdict(lambda: [0.0, 0.0]))
card_okpo1_cat = Counter()
card_okpo1_outside_tx = [0.0, 0.0]  # [외지건수, 전체건수]
for r in card_detail:
    if r['연령대'] == '기업':
        continue
    c = CARD_CAT.get(r['업종중분류'])
    if not c:
        continue
    amt, cnt = float(r['추정이용금액']), float(r['추정이용건수'])
    o = 'local' if r['유입구분'].startswith('현지') else 'outside'
    w_dong = 1.0 if r['동'] == '옥포1동' else 0.25  # 상권은 옥포1동 중심
    for key in ((r['연령대'], r['성별'], o), (r['연령대'], r['성별'], 'all')):
        card[key][c][0] += amt * w_dong
        card[key][c][1] += cnt * w_dong
    if r['동'] == '옥포1동':
        card_okpo1_cat[c] += amt
        card_okpo1_outside_tx[1] += cnt
        if o == 'outside':
            card_okpo1_outside_tx[0] += cnt

OKPO1_OUTSIDE_TX_SHARE = card_okpo1_outside_tx[0] / max(card_okpo1_outside_tx[1], 1.0)  # 0.1059
OKPO1_CARD_PERSONAL_DAILY_REF = sum(float(r['추정이용건수']) for r in card_detail if r['동'] == '옥포1동' and r['연령대'] != '기업') / 59.0  # 2025년 1~2월 59일 기준

comm_sa_raw = targets_json['okpo1_street_flow_benchmarks']['commercial_sex_age_share_2026']
comm_sa_10p_tot = sum(v for k, v in comm_sa_raw.items() if not k.startswith('0대'))
COMM_SA_10P = {k: v / comm_sa_10p_tot for k, v in comm_sa_raw.items() if not k.startswith('0대')}

# 요일별 방문자 주말/평일 비 (관광데이터랩 `10`)
vis_by_type = defaultdict(lambda: {'wd': [], 'we': []})
for r in weekday_vis:
    tp = 'local' if '현지인' in r['방문자구분'] else 'outside' if '외지인' in r['방문자구분'] else 'foreign'
    key = 'we' if r['요일'] in ('토요일', '일요일') else 'wd'
    vis_by_type[tp][key].append(float(r['하루평균방문자수']))
WE_RATIO = {tp: (sum(d['we']) / len(d['we'])) / (sum(d['wd']) / len(d['wd'])) for tp, d in vis_by_type.items()}
# local=0.9125, outside=1.5393, foreign=1.0091

# 월별 계절 가중치 (`16`)
MONTHLY_COMM = [float(r['상권유동_가중치']) for r in monthly_rows]
MONTHLY_PARK = [float(r['기념공원입장객_가중치']) for r in monthly_rows]
PARK_DAILY_MEAN = sum(params['tourist']['okpo_park_monthly_2025']) / 365.0  # 312.5명/일

# 학교 NEIS 하교 시각 및 옥포1동 안 학교 비율
def end_min(level, last):
    L = ASSUMED['lesson_min'][level]
    return ASSUMED['school_start_min'] + last * L + (last - 1) * ASSUMED['break_min'] + (ASSUMED['lunch_min'] if last > 4 else 0)

school_end = defaultdict(lambda: defaultdict(list))
for r in periods:
    school_end[(r['급'], int(r['학년']))][r['요일']].append(end_min(r['급'], int(r['마지막교시'])))

def student_end(level, grade):
    d = school_end.get((level, grade)) or school_end.get((level, 1))
    return {k: int(round(sum(d[k]) / len(d[k]) / 5) * 5) for k in WEEKDAYS if d.get(k)}

SCHOOL_IN_OKPO1 = {
    lv: sum('옥포1동' in r['위치메모'] for r in schools if r['급'] == lv) / max(sum(1 for r in schools if r['급'] == lv), 1)
    for lv in ('초', '중', '고')
}


# ── 2. 보조 샘플링 함수 ──────────────────────────────────────────────────────
def card_pref(band, sex, origin):
    b = band if band in ('20대', '30대', '40대', '50대', '60대', '70대이상') else ('20대' if band == '10대' else '70대이상')
    d = card[(b, sex, origin)] or card[(b, sex, 'all')]
    tot = sum(v[0] for v in d.values()) or 1.0
    share = {c: d[c][0] / tot if c in d else 0.0 for c in CATS}
    per_tx = {c: (d[c][0] / d[c][1]) if c in d and d[c][1] else None for c in CATS}
    return share, per_tx


def sample_foreign_age(rng, nationality, min_age=15):
    dist = for_age_raw.get(nationality) or for_age_raw.get(NAT_KEY_MAP.get(nationality)) or foreign_age_global
    weights = {}
    for k, v in dist.items():
        if k in AGE5_BOUNDS and v > 0:
            lo, hi = AGE5_BOUNDS[k]
            if hi >= min_age:
                weights[(max(lo, min_age), hi)] = v
    if not weights:
        return rng.randint(22, 42)
    lo, hi = pick(rng, weights)
    return rng.randint(lo, hi)


EXPAT_OCC = '선주 감독관·외국 기술자'
EXPAT_FAM_OCC = '감독관·기술자 가족'
F3_EXPAT = {'F-3-7', 'F-3-8', 'F-3-9'}   # 주재(D-7)·기업투자(D-8)·무역경영(D-9)의 배우자·미성년자녀


def visa_code_of(v):
    # 가족 체류자격은 이름에 주 체류자격이 먼저 나온다: '무역경영(D-9)의 배우자·미성년자녀(F-3-9)' → 마지막 괄호가 본인 체류자격
    return v[v.rfind('(') + 1:v.rfind(')')] if '(' in v else v


def visa_job(v):
    """체류자격 → (직업, 코드, 부류). 부류는 성비·국적·예산 조건에 쓴다."""
    code = visa_code_of(v)
    if code.startswith(('D-9', 'E-7-1', 'E-7-S', 'D-7', 'D-8', 'E-4', 'E-5')):
        # 선박설비(D-9-3) = 선주사 감독관(옥포1동 157명). 전문인력·주재·투자도 같은 고소득 외국 기술자층
        return EXPAT_OCC, code, 'expat'
    if code in F3_EXPAT:
        return EXPAT_FAM_OCC, code, 'expat_family'
    if code.startswith(('E-7', 'E-9', 'E-8', 'E-10')):
        return '외국인 조선·제조 근로자', code, 'worker'
    if code.startswith('H-2'):
        return '외국인 조선·제조 근로자', code, 'dongpo_worker'
    if code.startswith(('F-6', 'F-1', 'F-5-2')):
        return '결혼이민·가사', code, 'marriage'
    if code.startswith(('D-2', 'D-4')):
        return '유학생', code, 'student'
    if code.startswith('F-3'):
        return '동반 가족', code, 'family'
    if code.startswith('E-6'):
        return '일반 직장(외국인)', code, 'e6'
    if code.startswith(('F-2', 'F-5', 'F-4', 'E-2')):
        return '일반 직장(외국인)', code, 'general'
    return '기타(구직·난민 등)', code, 'other'


# 체류자격 부류별 남성 비율: 법무부 통계월보(2026-10) 전국 체류자격(상위 코드)별 남녀(23_visa_sex_national)를
# 거제 등록외국인의 체류자격 구성(21_foreign_by_dong_visa)으로 가중 평균한다. 조선소 근로자·E-6만 가정(ASSUMED)
# 결과는 옥포1동 등록외국인 남성 비율 실측(679/1,049 = 64.7%)과 독립 비교한다(V9)
visa_sex_rows = rcsv(os.path.join(P_IN, '23_visa_sex_national.csv'))
VISA_MALE_SHARE = {r['코드']: int(r['남성']) / (int(r['남성']) + int(r['여성'])) for r in visa_sex_rows}


def visa_male_share(code):
    top = '-'.join(code.split('-')[:2])
    return VISA_MALE_SHARE.get(top, VISA_MALE_SHARE['기타'])


_sex_acc = defaultdict(lambda: [0.0, 0.0])
for r in foreign_dong_rows:
    _, _code, _cls = visa_job(r['체류자격'])
    n = int(r['인원'])
    _sex_acc[_cls][0] += n
    _sex_acc[_cls][1] += n * visa_male_share(_code)
SEX_MALE_BY_CLASS = {c: round(m / n, 3) for c, (n, m) in _sex_acc.items() if n}
SEX_MALE_BY_CLASS.update(ASSUMED['sex_male_by_visa_class'])
for _c in ('worker', 'dongpo_worker', 'expat', 'expat_family', 'marriage', 'family', 'student', 'e6', 'general', 'other'):
    SEX_MALE_BY_CLASS.setdefault(_c, VISA_MALE_SHARE['기타'])
# 체류자격별로 나올 수 있는 국적(거제 국적 분포에서 이 안에서만 뽑는다)
EPS_NATS = {'베트남', '인도네시아', '우즈베키스탄', '네팔', '스리랑카', '미얀마', '타이', '필리핀', '중국', '캄보디아', '방글라데시',
            '파키스탄', '몽골', '키르기즈', '티모르민주공화국', '타지키스탄', '라오스'}   # 고용허가제(E-9) 송출국
NAT_SETS = {
    'worker': EPS_NATS | {'인도', '카자흐스탄'},
    'dongpo': {'한국계중국인', '한국계러시아인', '우즈베키스탄', '카자흐스탄', '러시아(연방)', '키르기즈'},
    'expat': {'프랑스', '일본', '미국', '영국', '그리스', '이탈리아', '캐나다', '오스트레일리아', '노르웨이', '독일', '네덜란드', '덴마크',
              '스웨덴', '핀란드', '스페인', '벨기에', '싱가포르', '타이완', '튀르키예', '인도', '러시아(연방)', '크로아티아', '루마니아',
              '폴란드', '말레이시아', '우크라이나'},
    'english': {'미국', '캐나다', '영국', '오스트레일리아', '뉴질랜드', '남아프리카공화국', '아일랜드'},
    'marriage': {'베트남', '중국', '한국계중국인', '필리핀', '캄보디아', '타이', '일본', '우즈베키스탄', '몽골', '인도네시아', '네팔',
                 '러시아(연방)', '미국', '캐나다', '미얀마', '라오스', '카자흐스탄'},
    'e6': {'필리핀', '러시아(연방)', '우즈베키스탄', '카자흐스탄', '키르기즈', '몽골', '타이'},
}


def nat_set_for(cls, code):
    if code.startswith('E-9'):
        return EPS_NATS
    if cls == 'worker' or code in ('F-3-17', 'F-3-74'):
        return NAT_SETS['worker']
    if cls == 'dongpo_worker' or code.startswith(('F-4', 'F-5-6', 'F-5-7', 'F-5-14', 'F-3-19')):
        return NAT_SETS['dongpo']
    if cls in ('expat', 'expat_family'):
        return NAT_SETS['expat']
    if code.startswith(('E-2', 'F-3-12')):
        return NAT_SETS['english']
    if cls in ('marriage', 'e6'):
        return NAT_SETS[cls]
    if cls == 'other':
        return 'non_expat'
    return None   # 제한 없음


SHIP = {'조선소 직영', '조선소 협력사', '외국인 조선·제조 근로자'}
YARD = SHIP | {EXPAT_OCC}   # 낮에 조선소 안에서 일하는 사람(선주 감독관 포함)
VISIT_OCC = '가족·지인 방문'
# 매일 오갈 수 없는 먼 시도(부산·울산·경남 밖). 이곳 사람이 낮에만 옥포1동에 있으면 당일 통근이 아니라 출장
FAR_PROV = ('서울', '경기', '인천', '충청', '전라', '전북', '강원', '제주', '대전', '광주', '세종', '경상북도', '대구', '기타 시도')
STUDENT = {'초등학생': '초', '중학생': '중', '고등학생': '고'}


def sample_local_occupation(rng, age, sex, in_dong_job=False):
    """경남 실측 종사상지위(20_employment_gyeongnam.csv) + 거제 조선소 직영/협력 비율 결합."""
    if age <= 12:
        return '초등학생'
    if age <= 15:
        return '중학생'
    if age <= 18:
        return '고등학생' if rng.random() < 0.92 else '일반 직장'
    band = band_of(age)
    emp = EMP_GN.get((band, sex), {'임금근로': 0.6, '자영업': 0.2, '전업주부': 0.1, '학생': 0.0, '무직·은퇴': 0.1})
    st = pick(rng, emp)
    if st == '학생':
        return '대학생'
    if st == '자영업':
        return '자영업'
    if st == '전업주부':
        return '전업주부'
    if st == '무직·은퇴':
        return '은퇴' if age >= 58 else '구직·기타'
    # 임금근로: 옥포1동 안 일자리는 서비스·사무·상점 중심(제조업 89/4538 = 2%), 동 밖 일자리는 조선소 비중 높음
    if in_dong_job:
        return '일반 직장'
    ship_p = 0.62 if (sex == '남' and 22 <= age <= 59) else (0.35 if (sex == '남' and age <= 64) else 0.16 if sex == '여' and age <= 55 else 0.05)
    if rng.random() < ship_p:
        w = params['worker']
        return '조선소 직영' if rng.random() < w['direct'] / w['total'] else '조선소 협력사'
    return '일반 직장'


def industry_shift_minutes(rng, ind):
    """옥포1동 내 16개 산업별 현실 근무 구간(시작 분, 길이 분)."""
    w_len = int(round(WK_HOURS['임금근로'] / 5.0 * 60 + 55))  # 평균 ~540분(점심 포함 9시간)
    s_len = int(round(WK_HOURS['자영업'] / 5.5 * 60 + 60))
    if ind == '숙박 및 음식점업':
        kind = pick(rng, {'day': 0.44, 'eve': 0.41, 'night': 0.15})
        if kind == 'day':
            return rng.randint(560, 620), rng.randint(400, 450)      # 09:20~10:20 출근 ~ 16:30~17:30 교대
        if kind == 'eve':
            return rng.randint(990, 1060), rng.randint(390, 450)     # 16:30~17:40 출근 ~ 23:30~24:30 마감
        return rng.randint(1050, 1140), rng.randint(360, 450)        # 17:30~19:00 출근 ~ 심야 주점·숙박
    if ind == '도매 및 소매업':
        kind = pick(rng, {'open': 0.50, 'close': 0.42, 'late': 0.08})
        if kind == 'open':
            return rng.randint(530, 590), rng.randint(390, 440)      # 08:50~09:50 ~ 16:00~17:00
        if kind == 'close':
            return rng.randint(960, 1020), rng.randint(360, 430)     # 16:00~17:00 ~ 22:00~23:30
        return rng.randint(1200, 1320), rng.randint(360, 450)        # 편의점 야간
    if ind in ('사업시설 관리 사업 지원 및 임대 서비스업', '전문 과학 및 기술 서비스업', '건 설 업', '제 조 업', '운수 및 창고업'):
        return rng.randint(475, 535), w_len                          # 07:55~08:55 출근 ~ 17:00~18:00 퇴근
    if ind in ('교육 서비스업', '보건업 및 사회복지 서비스업', '금융 및 보험업'):
        return rng.randint(505, 555), w_len                          # 08:25~09:15 출근 ~ 17:25~18:15 퇴근
    return rng.randint(560, 640), rng.randint(460, 540)              # 미용·부동산·여가 등 09:20~10:40 출근


def pick_arrival_hour_weighted(rng, allowed_hours, extra_boost=None, mask=None):
    """직업별 가능한 시간대(allowed_hours) 안에서 상권 유동 실측 비율(COMM_HOUR_SHARE)에 비례해 도착 시각 선택.
    mask(0~1, 24칸): 근무 중인 시간(동 밖 근무면 0)·고른 업종이 문 닫은 시간(0)을 뺀다. 모두 막히면 mask 없이 고른다."""
    for m in (mask, None):
        ws = {}
        for h in allowed_hours:
            hm = h % 24
            b = (extra_boost or {}).get(hm, 1.0) * (m[hm] if m else 1.0)
            if b > 0:
                ws[hm] = max(COMM_HOUR_SHARE[hm] * b, 1e-4)
        if ws:
            h = pick(rng, ws)
            return h * 60 + rng.choice(range(0, 60, 5))
    return allowed_hours[0] % 24 * 60


def schedule_mask(span, leak=0.0, lunch=0.0, pad=0):
    """근무 구간(시작 분, 길이 분) 동안 상권에 나올 수 있는 정도. leak = 근무 중에도 잠깐 나올 수 있는 정도, lunch = 12시 점심."""
    m = [1.0] * 24
    if not span:
        return m
    a0, a1 = span[0] - pad, span[0] + span[1] + pad
    for h in range(24):
        if overlap_hour(a0, a1, h) >= 0.5:
            m[h] = leak
    if lunch and overlap_hour(a0, a1, 12) >= 0.5:
        m[12] = max(m[12], lunch)
    return m


def mask_mul(*ms):
    return [math.prod(m[h] for m in ms if m) for h in range(24)]


YARD_MODE_HOURS = {
    'morning': ([5, 6, 7], None), 'lunch': ([12], None),
    'after': ([17, 18, 19, 20, 21, 22], {17: 1.35, 18: 1.55, 19: 1.45, 20: 1.25}),
    'shift': ([0, 1, 2, 3, 4, 22, 23], None),
}


def arrival_times(rng, seg, occ, top_cat, ends=None, work_span=None, work_ind=None, is_for=False, wd_mask=None, we_mask=None):
    """(평일 도착 분, 주말 도착 분, 방학 도착 분). wd_mask·we_mask = 근무 시간 × 고른 업종 영업시간."""
    open_m = CAT_HOUR_MASK[top_cat]
    if occ in STUDENT:
        lv = STUDENT[occ]
        e_min = int(sum(ends.values()) / len(ends))
        e_hr = max(13, (e_min + 15) // 60)
        hi_hr = {'초': 18, '중': 19, '고': 21}[lv]
        wd_h = list(range(e_hr, hi_hr + 1))
        wd_t = max(e_min + 10, pick_arrival_hour_weighted(rng, wd_h, mask=open_m))
        we_t = pick_arrival_hour_weighted(rng, list(range(11, hi_hr + 1)), mask=open_m)
        va_t = pick_arrival_hour_weighted(rng, list(range(10, hi_hr + 1)), mask=open_m)
        return wd_t % 1440, we_t % 1440, va_t % 1440

    if occ in YARD:
        # 한화오션(08:00~17:00 기준, 현장 인터뷰 반영): 점심은 대부분 사내식당에서 해결해 외출 극소(2%), 퇴근 후 저녁(17~21시, 70%) 집중
        # 선주 감독관은 조선소 안 사무실에서 일하고 퇴근 뒤 외국인거리 이용(가정)
        modes = ASSUMED['expat_weekday_arrival_mode'] if occ == EXPAT_OCC else ASSUMED['shipyard_weekday_arrival_mode']
        ok = {k: v for k, v in modes.items() if v > 0 and any(open_m[h] for h in YARD_MODE_HOURS[k][0])}
        mode = pick(rng, ok or modes)
        if mode == 'lunch':
            wd_t = 12 * 60 + rng.choice([0, 5, 10, 15, 20, 25])
        else:
            hrs, boost = YARD_MODE_HOURS[mode]
            wd_t = pick_arrival_hour_weighted(rng, hrs, boost, mask=open_m)
        we_t = pick_arrival_hour_weighted(rng, list(range(9, 23)), {17: 1.3, 18: 1.4, 19: 1.4} if is_for else None, mask=we_mask)
        return wd_t, we_t, None

    if top_cat == 'pub':
        wd_t = pick_arrival_hour_weighted(rng, [17, 18, 19, 20, 21, 22, 23, 0, 1], {18: 1.3, 19: 1.5, 20: 1.4, 21: 1.3}, mask=wd_mask)
        we_t = pick_arrival_hour_weighted(rng, [17, 18, 19, 20, 21, 22, 23, 0, 1], {19: 1.4, 20: 1.5, 21: 1.3}, mask=we_mask)
        return wd_t, we_t, None

    if seg == 'okpo1_worker' and work_span:
        ws0, wlen = work_span
        if work_ind == '전문 과학 및 기술 서비스업':
            # 외부 설계동 한화오션 사내 이전·구내식당 식사 반영: 12시 점심 외출 실종, 퇴근길 위주
            cand = [max(0, (ws0 - 20) // 60), (ws0 + wlen) // 60 % 24, 18, 19]
            wd_t = pick_arrival_hour_weighted(rng, cand + [12], {12: ASSUMED['design_tech_lunch_boost'], 18: 1.45, 19: 1.25}, mask=wd_mask)
        else:
            # 일반 상권·서비스 사업체: 출근길·점심(11~13시)·퇴근 직후 중 상권 이용
            cand = [max(0, (ws0 - 20) // 60), 12, (ws0 + wlen) // 60 % 24]
            wd_t = pick_arrival_hour_weighted(rng, cand + [11, 13, 18], {12: 1.45, 18: 1.25}, mask=wd_mask)
        we_t = pick_arrival_hour_weighted(rng, list(range(9, 21)), mask=we_mask)
        return wd_t, we_t, None

    if is_for:
        # 타동·옥포 거주 외국인(비조선소·가족·유학생·일반직 등)도 저녁 시간대 옥포 국제시장·다국적식당·식자재마트 방문 비중이 높음
        wd_t = pick_arrival_hour_weighted(rng, list(range(8, 23)), {17: 1.45, 18: 1.85, 19: 2.0, 20: 1.9, 21: 1.6, 22: 1.3}, mask=wd_mask)
        we_t = pick_arrival_hour_weighted(rng, list(range(10, 23)), {16: 1.25, 17: 1.45, 18: 1.6, 19: 1.6, 20: 1.4}, mask=we_mask)
        return wd_t, we_t, None

    if occ in ('전업주부', '은퇴', '결혼이민·가사', '동반 가족', VISIT_OCC):
        wd_t = pick_arrival_hour_weighted(rng, list(range(6, 20)), {9: 1.2, 10: 1.3, 11: 1.3, 14: 1.2, 15: 1.2, 16: 1.2}, mask=wd_mask)
        we_t = pick_arrival_hour_weighted(rng, list(range(8, 20)), mask=we_mask)
        return wd_t, we_t, None

    if occ == '자영업':
        wd_t = pick_arrival_hour_weighted(rng, [7, 8, 11, 14, 15, 16, 21, 22], mask=wd_mask)
        we_t = pick_arrival_hour_weighted(rng, list(range(10, 22)), mask=we_mask)
        return wd_t, we_t, None

    if seg == 'tourist':
        wd_t = pick_arrival_hour_weighted(rng, list(range(9, 21)), {11: 1.2, 12: 1.3, 13: 1.2, 14: 1.2, 18: 1.2}, mask=wd_mask)
        we_t = pick_arrival_hour_weighted(rng, list(range(9, 22)), mask=we_mask)
        return wd_t, we_t, None

    # 일반 직장·대학생·구직·거제 타동 방문 등: 실측 상권 비율 반영(동 밖에서 일하는 시간은 wd_mask 로 빠짐)
    wd_t = pick_arrival_hour_weighted(rng, list(range(0, 24)), mask=wd_mask)
    we_t = pick_arrival_hour_weighted(rng, list(range(7, 23)), mask=we_mask)
    return wd_t, we_t, None


PURPOSE = {'meal': '식사', 'pub': '술자리', 'cafe': '카페·디저트', 'intl': '다국적·고향 음식', 'mart': '장보기', 'life': '쇼핑·생활 서비스'}

# 국민여행조사 거제 응답(378건) 가중 추출 준비
TRAVEL_WEIGHTS = {i: max(float(r['가중치']), 1.0) for i, r in enumerate(travel_rows)}


# ── 3. 후보 1명 생성 ────────────────────────────────────────────────────────
def make_candidate(rng, seg):
    nationality, visa_code, vcls = '한국', None, None
    work_ind = None
    lodging = None
    in_dong_work = False

    if seg == 'resident':
        p_okpo1_res = OKPO1_ACTUAL_10P / max(OKPO1_ACTUAL_10P + OKPO2_SCOPE_WEIGHT * OKPO2_ACTUAL_10P, 1.0)
        home = '옥포1동' if rng.random() < p_okpo1_res else '옥포2동'
        aw = age_w_okpo1 if home == '옥포1동' else age_w_okpo2
        sx = pick(rng, {'남': sum(v for a, v in aw['남'].items() if a >= 10),
                        '여': sum(v for a, v in aw['여'].items() if a >= 10)})
        age = pick(rng, {a: v for a, v in aw[sx].items() if a >= 10})
        in_cand = rng.random() < ASSUMED['okpo1_resident_in_dong_job_share']
        occ = sample_local_occupation(rng, age, sx, in_dong_job=in_cand)
        if occ in ('일반 직장', '자영업') and in_cand:
            in_dong_work = True
            work_ind = pick(rng, JOBS_OKPO1)
        lodging = '자가·전월세'

    elif seg == 'foreign_resident':
        p_okpo1_for = fd1['total'] / max(fd1['total'] + OKPO2_SCOPE_WEIGHT * fd2['total'], 1.0)
        home = '옥포1동' if rng.random() < p_okpo1_for else '옥포2동'
        # 체류자격 → 성별(부류별 성비) → 국적(체류자격에 맞는 국적만) 순서로 뽑는다. 예전엔 셋을 따로 뽑아 여성 용접공·남성 결혼이민이 많았다
        v_full = pick(rng, visa_okpo1 if home == '옥포1동' else visa_okpo2)
        occ, visa_code, vcls = visa_job(v_full)
        sx = '남' if rng.random() < SEX_MALE_BY_CLASS[vcls] else '여'
        nationality = pick_nationality(rng, home, vcls, visa_code)
        min_a = 25 if occ == EXPAT_OCC else (19 if occ in ('외국인 조선·제조 근로자', '결혼이민·가사', '일반 직장(외국인)') else 10)
        age = sample_foreign_age(rng, nationality, min_age=min_a)
        if occ == '유학생' and not 18 <= age <= 34:
            age = rng.randint(19, 29)
        if vcls == 'e6' and rng.random() < 0.80:
            in_dong_work = True                   # 호텔유흥(E-6-2): 옥포 외국인거리 주점·숙박업소 근무
            work_ind = '숙박 및 음식점업'
        elif occ == '일반 직장(외국인)' and rng.random() < 0.45:
            in_dong_work = True
            work_ind = pick(rng, JOBS_OKPO1)
        if occ in (EXPAT_OCC, EXPAT_FAM_OCC):
            lodging = '아파트·레지던스'
        else:
            lodging = '기숙사' if (occ in SHIP and rng.random() < params['foreign']['dorm_share']) else '자가·전월세'

    elif seg == 'okpo1_worker':
        home = pick(rng, other_dong_weights)
        work_ind = pick(rng, JOBS_OKPO1)
        in_dong_work = True
        # 옥포1동 사업체 근무자 성·연령: 숙박음식·도소매·보건교육은 여성 비중 높고, 사업시설·전문기술·건설은 남성 비중 높음
        fem_p = 0.64 if work_ind in ('숙박 및 음식점업', '도매 및 소매업', '보건업 및 사회복지 서비스업', '교육 서비스업') else 0.30
        sx = '여' if rng.random() < fem_p else '남'
        age = pick(rng, {a: v for a, v in age_w_okpo2[sx].items() if 19 <= a <= 68})
        emp_here = EMP_GN.get((band_of(age), sx), {'임금근로': 0.7, '자영업': 0.3})
        occ = '자영업' if rng.random() < emp_here['자영업'] / max(emp_here['임금근로'] + emp_here['자영업'], 0.05) else '일반 직장'

    elif seg == 'stayer':
        # 타시도(76%) + 경남 원거리 시군(24%) 출신으로 옥포 숙소(모텔·원룸·기숙사)에 머물며 조선·출장 근무 (협력사 파견 외국인 숙소 체류 포함)
        if rng.random() < 0.76:
            home, bd, sx = pick(rng, inflow_cells_prov)
        else:
            home, bd, sx = pick(rng, inflow_cells_gn)
        lo = 70 if bd == '70대이상' else (13 if bd == '10대' else int(bd[:2]))
        hi = 79 if bd == '70대이상' else int(bd[:2]) + 9
        age = rng.randint(lo, hi)
        for_st_p = 0.24 if (sx == '남' and 20 <= age <= 54) else (0.02 if (sx == '여' and 20 <= age <= 49) else 0.0)
        if rng.random() < for_st_p:
            v_full = pick_visa_given_sex(rng, {'제 조 업(E-9-1)': 50, '일반기능인력(E-7-3)': 32, '선박설비(D-9-3)': 18}, sx)
            occ, visa_code, vcls = visa_job(v_full)
            nationality = pick_nationality(rng, None, vcls, visa_code)
        elif age < 19 or age >= 70:
            occ = VISIT_OCC                       # 10대·70대 이상 시외 체류는 일보다 가족·지인 방문
        elif age < 20:
            occ = '대학생'
        elif sx == '남' and age <= 64 and rng.random() < 0.76:
            occ = '조선소 협력사' if rng.random() < 0.72 else '조선소 직영'
        else:
            occ = '일반 직장(업무 방문)'
            if rng.random() < 0.30:
                in_dong_work = True
                work_ind = pick(rng, JOBS_OKPO1)
        if occ == EXPAT_OCC:
            lodging = '호텔·레지던스'
        elif occ == VISIT_OCC:
            lodging = '가족·지인 집'
        else:
            lodging = '기숙사' if occ in SHIP and rng.random() < (0.62 if nationality != '한국' else 0.45) else '모텔·달방·원룸'

    elif seg == 'commuter':
        # 경남 인접 시군(통영·김해·진해 등 68%) + 부산·울산 등(32%) 당일 통근·업무 체류 (외국인 협력사 통근 포함)
        if rng.random() < 0.68:
            home, bd, sx = pick(rng, inflow_cells_gn)
        else:
            home, bd, sx = pick(rng, inflow_cells_prov)
        lo = 70 if bd == '70대이상' else (13 if bd == '10대' else int(bd[:2]))
        hi = 78 if bd == '70대이상' else int(bd[:2]) + 9
        age = rng.randint(lo, hi)
        far_home = home.startswith(FAR_PROV)
        if sx == '남' and 20 <= age <= 49 and rng.random() < 0.10:
            v_full = pick_visa_given_sex(rng, {'제 조 업(E-9-1)': 55, '일반기능인력(E-7-3)': 30, '방문취업(H-2)': 15}, sx)
            occ, visa_code, vcls = visa_job(v_full)
            nationality = pick_nationality(rng, None, vcls, visa_code)
        elif age < 19 or age >= 70:
            occ = VISIT_OCC                       # 10대·70대 이상 낮 시간 유입은 가족·지인·병원 방문
        elif rng.random() < 0.30 and age <= 68:
            occ = '일반 직장(업무 방문)'
            in_dong_work = True
            work_ind = pick(rng, JOBS_OKPO1)
        elif sx == '남' and age <= 64 and rng.random() < 0.55:
            w = params['worker']
            occ = '조선소 직영' if rng.random() < w['direct'] / w['total'] else '조선소 협력사'
        else:
            occ = '일반 직장(업무 방문)'
        if far_home and occ != VISIT_OCC:
            lodging = '거제 다른 동 숙소(출장)'    # 서울·경기 등에서 매일 오갈 수는 없음: 낮에만 옥포1동에 있는 출장 인력
        elif far_home:
            lodging = '가족·지인 집'

    elif seg == 'geoje_visitor':
        home = pick(rng, other_dong_weights)  # 외국인이면 아래에서 외국인 분포로 다시 뽑음
        # 상권 유동 성×연령(COMM_SA_10P)에서 성·연령을 뽑은 뒤, 아주동·옥포2동·장승포 등 인근 기숙사 거주 외국인(거제 타동 16,303명)의 저녁·주말 옥포('옥태원') 유입 반영
        cell = pick(rng, COMM_SA_10P)
        bd, sx = cell.split('|')
        for_p = 0.52 if (sx == '남' and bd in ('20대', '30대')) else (
            0.30 if (sx == '남' and bd == '40대') else (0.18 if (sx == '여' and bd in ('20대', '30대')) else 0.06))
        if rng.random() < for_p:
            home = pick(rng, foreign_home_weights)
            v_full = pick_visa_given_sex(rng, visa_by_dong[home], sx)
            occ, visa_code, vcls = visa_job(v_full)
            nationality = pick_nationality(rng, home, vcls, visa_code)
            lo = 70 if bd == '70대이상' else max(int(bd[:2]), 18)
            hi = 75 if bd == '70대이상' else int(bd[:2]) + 9
            age = rng.randint(lo, hi)
        else:
            lo = 70 if bd == '70대이상' else int(bd[:2])
            hi = 85 if bd == '70대이상' else lo + 9
            age = pick(rng, {a: age_w_okpo2[sx].get(a, 1.0) for a in range(lo, hi + 1)})
            occ = sample_local_occupation(rng, age, sx, in_dong_job=False)

    else:  # tourist — 2025 국민여행조사 거제 방문 378건 실측 행에서 가중 추출
        ti = pick(rng, TRAVEL_WEIGHTS)
        tr = travel_rows[ti]
        sx = tr['성별']
        bd = tr['연령대']
        lo = 70 if bd == '70대이상' else (15 if bd == '10대' else int(bd[:2]))
        hi = 82 if bd == '70대이상' else int(bd[:2]) + 9
        age = rng.randint(lo, hi)
        sido = tr['거주시도']
        if sido == '경남':
            home = pick(rng, {k[0]: v for k, v in inflow_cells_gn.items()})
        else:
            home = sido
        occ = '관광객'
        lodging = '관광숙박' if int(tr['숙박일수']) > 0 and rng.random() < 0.18 else None

    band = band_of(age)
    level = STUDENT.get(occ)
    grade = None
    ends = None
    if level:
        grade = max(1, min({'초': age - 6, '중': age - 12, '고': age - 15}[level], 6 if level == '초' else 3))
        ends = student_end(level, grade)
        in_dong_work = rng.random() < SCHOOL_IN_OKPO1[level]

    # 근무·등교 시간대 설정 (시작 분, 길이 분)
    work_span_wd = None
    work_span_we = None
    if level:
        e_avg = sum(ends.values()) / len(ends)
        work_span_wd = (500, max(180, int(e_avg - 500)))
    elif in_dong_work and work_ind:
        work_span_wd = industry_shift_minutes(rng, work_ind)
        we_p = (1.0 - WK5_SHARE['자영업']) if occ == '자영업' else (1.0 - WK5_SHARE['임금근로'])
        if rng.random() < we_p:
            work_span_we = work_span_wd
    elif occ in YARD:
        # 한화오션 거제사업장 기본 08:00~17:00(퇴근 직후 인접 옥포1동 10~15분 내 복귀) + 일부 잔업(18:00)
        st = rng.choice([455, 465, 475, 480, 495, 520])
        end_work = rng.choice([1020, 1020, 1030, 1045, 1065, 1090])
        work_span_wd = (st, end_work - st)
        if rng.random() < (1.0 - WK5_SHARE['임금근로']):
            work_span_we = (480, 480)
    elif occ in ('일반 직장', '일반 직장(업무 방문)', '일반 직장(외국인)'):
        w_len = int(round(WK_HOURS['임금근로'] / 5.0 * 60 + 55))
        work_span_wd = (rng.randint(480, 555), w_len)
        if rng.random() < (1.0 - WK5_SHARE['임금근로']):
            work_span_we = (540, 420)
    elif occ == '자영업':
        s_len = int(round(WK_HOURS['자영업'] / 5.5 * 60 + 60))
        work_span_wd = (rng.randint(540, 630), s_len)
        if rng.random() < (1.0 - WK5_SHARE['자영업']):
            work_span_we = work_span_wd
    elif occ in ('대학생', '유학생'):
        work_span_wd = (rng.randint(540, 660), rng.randint(240, 390))

    # 업종 선호 및 예산 (카드매출 `07` + 국민여행조사 `19` + 다국적 점포 공급 비중 `INTL_STORE_RATIO`)
    # 경남 밖 거주 여부: 시외유입 표의 경남 시군 이름(‘경남 기타’ 포함)이면 경남. 예전엔 이름 끝 글자로 판정해 ‘경남 기타’가 경남 밖이 됐다
    is_outside_gn = seg in ('stayer', 'commuter', 'tourist') and home not in GN_NAMES
    org_type = 'outside' if is_outside_gn else 'local'
    share, per_tx = card_pref(band, sx, org_type)
    share = dict(share)
    is_for = nationality != '한국'
    is_expat = occ in (EXPAT_OCC, EXPAT_FAM_OCC)
    intl_split = (0.05 if is_expat else ASSUMED['foreign_intl_meal_split']) if is_for else max(0.008, INTL_STORE_RATIO * 0.65)
    share['intl'] = share['meal'] * intl_split
    share['meal'] -= share['intl']
    if is_expat:
        # 선주 감독관·외국 기술자: 인터뷰의 '외국인 저소비·회식 축소'는 근로자 이야기라 적용하지 않음. 옛 외국인거리 펍·바 손님
        if occ == EXPAT_OCC:
            share['pub'] *= ASSUMED['expat_pub_pref_scale']
    elif is_for:
        # 현장 인터뷰 반영: 외국인 근로자는 회식·고단가 주점 소비가 극히 적고 식자재·편의점 장보기 및 다국적 식당 위주
        share['pub'] *= ASSUMED['foreign_pub_pref_scale']
        share['mart'] *= ASSUMED['foreign_mart_pref_scale']
    elif occ == '조선소 협력사':
        # 내·외국인 혼성 팀 구성 및 경기 체감으로 전통적인 저녁 단체 회식 감소
        share['pub'] *= ASSUMED['subcontract_pub_pref_scale']
    if seg == 'stayer' and not is_for:
        share['meal'] *= 1.25
        share['pub'] *= 1.15
        share['mart'] *= 0.85
    if level:
        share = {c: (v if c in STUDENT_CATS else 0.0) for c, v in share.items()}
    if age < 19:
        share['pub'] = 0.0
    s_tot = sum(share.values()) or 1.0
    mean_pref = {c: v / s_tot for c, v in share.items()}
    pref = dirichlet(rng, {c: v for c, v in mean_pref.items() if v > 0}, ASSUMED['pref_noise_concentration'])
    pref = {c: pref.get(c, 0.0) for c in CATS}

    top = pick(rng, {c: v for c, v in pref.items() if v > 0})

    # 근무 시간에는 상권에 나오지 않는다: 동 밖 근무자는 근무 시간을 빼고(근처 직장이면 12시 점심만 조금), 동 안 근무자는 자기 근무 시간을 뺀다(점심 12시는 허용)
    out_work = bool(work_span_wd) and seg == 'stayer' and not in_dong_work and rng.random() < 0.74   # 숙소형: 낮엔 조선소·현장 출근
    day_biz = seg == 'commuter' and not in_dong_work and rng.random() < 0.72                        # 주간 유입: 낮 동안 옥포1동 현장 업무
    sched_wd = sched_we = None
    if not level and occ not in YARD and work_span_wd:
        if in_dong_work:
            sched_wd = schedule_mask(work_span_wd, 0.0, lunch=1.0)
            sched_we = schedule_mask(work_span_we, 0.0, lunch=1.0) if work_span_we else None
        elif seg in ('resident', 'foreign_resident', 'geoje_visitor') or out_work or (seg == 'commuter' and not day_biz):
            leak = 0.3 if occ == '자영업' else (0.5 if occ in ('대학생', '유학생') else 0.0)
            sched_wd = schedule_mask(work_span_wd, leak, lunch=ASSUMED['lunch_out_from_outside_job'], pad=20)
            sched_we = schedule_mask(work_span_we, leak, pad=20) if work_span_we else None
    wd_mask = mask_mul(sched_wd, CAT_HOUR_MASK[top])
    we_mask = mask_mul(sched_we, CAT_HOUR_MASK[top])
    wd_t, we_t, va_t = arrival_times(rng, seg, occ, top, ends=ends, work_span=work_span_wd, work_ind=work_ind, is_for=is_for,
                                     wd_mask=wd_mask, we_mask=we_mask)

    # 체류 시간(상권 거리·가게)
    d_lo, d_hi = ASSUMED['dwell_min_by_cat'][top]
    dwell_wd = int(rng.uniform(d_lo, d_hi) // 5 * 5)
    if seg == 'tourist':
        dwell_wd = int(min(180, max(50, dwell_wd * 1.35)) // 5 * 5)
    dwell_we = int(min(dwell_wd * rng.uniform(1.05, 1.45), 240) // 5 * 5)

    # 1회 상한 및 예산 (카드 건당 금액 × 시간대 티켓 보정; 외국인 송금 56.5%·저소비 구조 반영; 관광객은 국민여행조사 반영)
    arr_hr = (wd_t // 60) % 24
    hr_ticket_factor = max(0.65, min(1.45, CARD_HOUR_TICKET[arr_hr] / max(CARD_MEAN_TICKET, 1)))
    if occ == EXPAT_OCC:
        b_scale = ASSUMED['expat_budget_scale']
    elif occ == EXPAT_FAM_OCC:
        b_scale = ASSUMED['expat_family_budget_scale']
    elif is_for:
        fb = ASSUMED['foreign_budget_scale']
        b_scale = fb['E-9·E-8·H-2'] if (visa_code and visa_code.startswith(('E-9', 'E-8', 'H-2'))) else (fb['조선소(E-7 등)'] if occ in SHIP else fb['그 외'])
    elif seg == 'tourist':
        b_scale = 1.15
    else:
        b_scale = 1.0
    noise = math.exp(rng.gauss(0, 0.28))
    caps = {}
    for c in CATS:
        if pref[c] <= 0:
            caps[c] = 0
            continue
        if level or age < 19:
            # 학생(학교 시정 자료가 없는 외국인 가족·방문 10대 포함)은 용돈 범위
            lo_b, hi_b = ASSUMED['student_budget'][level or ('초' if age <= 12 else '중' if age <= 15 else '고')]
            caps[c] = int(round(rng.uniform(lo_b, hi_b), -2))
            continue
        base = per_tx.get(c) or params['price'].get(c) or 12000
        # 유흥주점 카드 건당 금액(단체 결제 포함)이 개인 지출 비중을 왜곡하지 않도록 1인 부담분으로 보정
        if c == 'pub' and base > 48000:
            base = base * 0.52
        caps[c] = int(max(3000, round(base * noise * b_scale * (hr_ticket_factor if c in ('meal', 'pub') else 1.0), -2)))
    exp_cap = sum(pref[c] * caps[c] for c in CATS) or 10000
    # 1인 지출 배수: 같은 가게에서 이 사람이 내는 돈 ÷ 대표 메뉴 바구니(외국인 절약 b_scale·관광객·개인차). 시뮬이 가게 1인 가격에 곱한다
    spend_mult = round(min(2.5, max(0.35, b_scale * noise)), 3)
    if seg == 'tourist':
        tr_spend = float(tr['1인1일_거제상권지출_원'])
        budget = int(max(12000, min(120000, round(tr_spend if tr_spend >= 8000 else exp_cap * 1.45, -3))))
    elif level or age < 19:
        budget = int(max(3000, round(max(caps.values()) * rng.uniform(1.0, 1.35), -3)))
    else:
        # 외국인의 절약 성향은 위 b_scale(이민자체류실태 근거) 하나로만 반영한다(예산 배수 이중 적용 방지)
        budget = int(max(4000, round(exp_cap * rng.uniform(1.05, 1.65), -3)))

    # 상권 외출 확률 (집·직장 체류자와 상권 방문자의 구분 + 외부 설계동 사내 이전 반영)
    if seg in ('geoje_visitor', 'tourist'):
        p_wd, p_we = 1.0, 1.0
    elif seg == 'commuter':
        if work_ind == '전문 과학 및 기술 서비스업':
            p_wd, p_we = ASSUMED['design_tech_street_out_prob'], 0.20
        else:
            p_wd, p_we = (0.75 if not in_dong_work else 0.65), 0.35
    elif seg == 'okpo1_worker':
        if work_ind == '전문 과학 및 기술 서비스업':
            p_wd, p_we = ASSUMED['design_tech_street_out_prob'], (0.30 if work_span_we else 0.10)
        else:
            p_wd, p_we = 0.68, (0.55 if work_span_we else 0.15)
    elif seg == 'stayer':
        p_wd, p_we = (0.78 if is_for else 0.72), (0.86 if is_for else 0.80)
    elif seg == 'foreign_resident':
        p_wd, p_we = 0.76, 0.86
    else:  # resident
        if work_ind == '전문 과학 및 기술 서비스업':
            p_wd, p_we = 0.34, 0.56
        else:
            p_wd = 0.32 if age >= 70 else (0.44 if age >= 60 else (0.45 if level else 0.54))
            p_we = 0.36 if age >= 70 else (0.48 if age >= 60 else (0.55 if level else 0.60))

    # 24시간 동 체류 벡터 p_vec(0..23) 및 상권 거리 벡터 s_vec(0..23) 계산
    st_wd = dwell_wd + ASSUMED['street_extra_min']
    st_we = dwell_we + ASSUMED['street_extra_min']
    s_vec = [p_wd * overlap_hour(wd_t, wd_t + st_wd, h) for h in range(24)]
    p_vec = [0.0] * 24

    if seg in ('resident', 'foreign_resident'):
        # 동 밖 출근·등교 시간과 낮 타동/시외 외출을 뺀 시간 동안 옥포1동 안에 체류(인접 아주동 출퇴근 이동 ~15분, 상권 복귀 시간 포함)
        away_spans = []
        if work_span_wd and not in_dong_work:
            pad = 15 if occ in YARD else 22
            away_spans.append((work_span_wd[0] - pad, work_span_wd[0] + work_span_wd[1] + pad))
        elif not work_span_wd and rng.random() < 0.30:
            # 비취업 주민 일부의 주간·오후 타동·시외 외출(병원·고현 장보기·모임 등)
            a0 = rng.randint(600, 870)
            away_spans.append((a0, a0 + rng.randint(140, 260)))
        for h in range(24):
            aw = sum(overlap_hour(a0, a1, h) for a0, a1 in away_spans)
            p_vec[h] = max(s_vec[h], 1.0 - min(1.0, aw))
        home_wd = round(sum(p_vec) * 60 - (work_span_wd[1] if work_span_wd and in_dong_work else 0))
        home_wd = max(0, home_wd)
        work_in_wd = work_span_wd[1] if (work_span_wd and in_dong_work) else 0
    elif seg == 'stayer':
        # 옥포 내 숙소(모텔·원룸·기숙사) 야간 체류 + 주간 아주동 조선소/현장 출근(약 74%) 또는 동내 근무·휴식(26%)
        for h in range(24):
            if out_work:
                aw = overlap_hour(work_span_wd[0] - 25, work_span_wd[0] + work_span_wd[1] + 25, h)
                p_vec[h] = max(s_vec[h], 1.0 - aw)
            else:
                p_vec[h] = 1.0
        home_wd = round(sum(p_vec) * 60 - (work_span_wd[1] if work_span_wd and in_dong_work else 0))
        home_wd = max(0, home_wd)
        work_in_wd = work_span_wd[1] if (work_span_wd and in_dong_work) else 0
    elif seg == 'commuter':
        home_wd = 0
        # 당일 시외 통근·업무자: 옥포1동 사업체 근무(in_dong_work) 또는 옥포1동 현장·협력사 주간 업무 체류(72%), 나머지(28%)는 출퇴근길 상권 방문
        b_span = work_span_wd if work_span_wd else (rng.randint(465, 550), rng.randint(470, 545))
        work_in_wd = work_span_wd[1] if (work_span_wd and in_dong_work) else 0
        for h in range(24):
            wk_h = overlap_hour(b_span[0], b_span[0] + b_span[1], h) if (in_dong_work or day_biz) else 0.0
            p_vec[h] = min(1.0, wk_h + s_vec[h] * (0.25 if wk_h > 0 else 1.0))
    elif seg == 'okpo1_worker':
        home_wd = 0
        work_in_wd = work_span_wd[1] if (work_span_wd and in_dong_work) else 0
        for h in range(24):
            wk_h = overlap_hour(work_span_wd[0], work_span_wd[0] + work_span_wd[1], h) if (work_span_wd and in_dong_work) else 0.0
            p_vec[h] = min(1.0, wk_h + s_vec[h] * (0.35 if wk_h > 0 else 1.0))
    else:  # geoje_visitor, tourist
        home_wd = 0
        work_in_wd = 0
        if seg == 'tourist' and lodging == '관광숙박':
            for h in range(24):
                stay_n = 1.0 if (h >= 20 or h < 9) else 0.0
                p_vec[h] = max(stay_n, s_vec[h])
            home_wd = round(sum(p_vec) * 60)
        else:
            p_vec = list(s_vec)

    stay_wd = sum(p_vec) * 60.0
    # 주말 체류 분 계산
    if seg in ('resident', 'foreign_resident'):
        out_we = work_span_we[1] + 40 if (work_span_we and not in_dong_work) else (120 if rng.random() < 0.30 else 0)
        work_in_we = work_span_we[1] if (work_span_we and in_dong_work) else 0
        home_we = max(0, 1440 - out_we - work_in_we)
        stay_we = home_we + work_in_we
    elif seg == 'stayer':
        out_we = work_span_we[1] if work_span_we else 180
        home_we = 1440 - out_we
        work_in_we = 0
        stay_we = home_we
    elif seg == 'okpo1_worker':
        home_we = 0
        work_in_we = work_span_we[1] if work_span_we else 0
        stay_we = work_in_we + p_we * st_we * (0.35 if work_in_we else 1.0)
    else:
        home_we = 780 if (seg == 'tourist' and lodging == '관광숙박') else 0
        work_in_we = 0
        stay_we = max(home_we, p_we * st_we)

    # 동반 인원·아이 동반·교통수단
    child = False
    if seg == 'tourist':
        party = max(1, min(8, int(tr['동반인원'])))
        child = int(tr['만15세미만동반수']) > 0
        tr_raw = tr['주요교통수단']
        transport = '자가용' if tr_raw in ('자가용', '렌트카') else ('버스' if '버스' in tr_raw else ('택시' if tr_raw == '택시' else '도보'))
    else:
        child = (seg == 'resident' and ASSUMED['child_escort_age'][0] <= age <= ASSUMED['child_escort_age'][1]
                 and rng.random() < CHILD_RATE)
        if level or occ in ('대학생', '유학생'):
            party = pick(rng, {1: 0.18, 2: 0.42, 3: 0.27, 4: 0.13})
        elif top == 'pub':
            party = pick(rng, {1: 0.08, 2: 0.38, 3: 0.30, 4: 0.24})
        elif seg in ('resident', 'foreign_resident'):
            # 옥포1동 1인 세대 49.0% 반영
            party = 1 if rng.random() < SINGLE_HH_SHARE else pick(rng, {1: 0.20, 2: 0.50, 3: 0.20, 4: 0.10})
        else:
            party = pick(rng, {1: 0.42, 2: 0.36, 3: 0.14, 4: 0.08})
        if child:
            party += 1
        transport = pick(rng, {
            'resident': {'도보': 0.62, '버스': 0.14, '자가용': 0.19, '자전거·킥보드': 0.05},
            'foreign_resident': {'도보': 0.56, '버스': 0.22, '자전거·킥보드': 0.17, '택시': 0.05},
            'okpo1_worker': {'자가용': 0.52, '버스': 0.34, '도보': 0.10, '택시': 0.04},
            'stayer': {'도보': 0.42, '통근버스': 0.25, '자가용': 0.25, '택시': 0.08},
            'commuter': {'자가용': 0.50, '통근버스': 0.32, '버스': 0.15, '택시': 0.03},
            'geoje_visitor': {'자가용': 0.54, '버스': 0.34, '택시': 0.08, '도보': 0.04},
        }[seg])
        if level and transport == '자가용':
            transport = '도보' if seg == 'resident' else '버스'
        if age < 19 and transport in ('자가용', '택시'):
            transport = '도보' if seg in ('resident', 'foreign_resident') else '버스'   # 10대는 운전하지 않음(가족 차는 일행으로 봄)
        if lodging == '거제 다른 동 숙소(출장)':
            transport = pick(rng, {'자가용': 0.55, '택시': 0.25, '통근버스': 0.20})   # 먼 시도 출장자: 거제 숙소에서 차로
        elif is_expat:
            transport = pick(rng, {'택시': 0.40, '자가용': 0.35, '도보': 0.25})

    purpose = PURPOSE[top] if not (top == 'intl' and not is_for) else '다국적 음식'
    if top == 'mart' and (level or seg in ('stayer', 'commuter', 'tourist', 'okpo1_worker')):
        purpose = '편의점·간식'   # 학생·출장·근무자의 '장보기' 업종은 사실상 편의점
    if seg == 'tourist':
        purpose = '관광 겸 ' + purpose
    elif level:
        purpose = '하교 후 ' + purpose

    p_high = 0.15 if is_expat else (0.60 if (level or is_for or occ in ('대학생', '은퇴', '구직·기타')) else (0.20 if seg == 'tourist' else 0.35))
    sens = pick(rng, {'높음': p_high, '보통': 0.45, '낮음': max(0.55 - p_high, 0.05)})
    wait = int(max(3, rng.gauss({'tourist': 18}.get(seg, 11 if not is_for else 12) - (2 if age >= 60 else 0), 4)))
    crit = dict(ASSUMED['criteria_base_krei'])
    if sens == '높음':
        crit['가격'] += 0.12
    if seg == 'tourist':
        crit['분위기'] += 0.08
        crit['맛'] += 0.05
    if is_for:
        crit['언어·익숙함'] = 0.15
    if age >= 60:
        crit['접근성'] += 0.08
    crit = dirichlet(rng, crit, 28.0)
    korean = None
    if is_for:
        if is_expat:
            korean = pick(rng, {'상': 0.05, '중': 0.20, '하': 0.75})
        elif occ in ('결혼이민·가사', '일반 직장(외국인)'):
            korean = pick(rng, {'상': 0.58, '중': 0.32, '하': 0.10})
        else:
            korean = pick(rng, {'상': 0.14, '중': 0.46, '하': 0.40})

    return {
        'segment': seg, 'segment_ko': SEG_KO[seg],
        'sim_group': 'foreign' if is_for else SIM_GROUP[seg],
        'age': age, 'age_band': band, 'sex': sx, 'home_area': home,
        'nationality': nationality, 'visa': visa_code,
        'occupation_synthetic': occ, 'work_industry': work_ind, 'lodging_type_synthetic': lodging,
        'school_level': level, 'school_grade': grade,
        'school_end_by_weekday': {k: hhmm(v) for k, v in ends.items()} if ends else None,
        'korean_ability_synthetic': korean,
        'visit_purpose_synthetic': purpose, 'party_size_synthetic': party, 'with_child_synthetic': child,
        'transport_synthetic': transport,
        'weekday_arrival': hhmm(wd_t), 'weekend_arrival': hhmm(we_t),
        'vacation_arrival': hhmm(va_t) if va_t is not None else None,
        'weekday_arrival_min': wd_t, 'weekend_arrival_min': we_t,
        'weekday_dwell_minutes_synthetic': dwell_wd, 'weekend_dwell_minutes_synthetic': dwell_we,
        'visit_budget_krw_synthetic': budget, 'category_cap_krw_synthetic': caps, 'spend_multiplier_synthetic': spend_mult,
        'price_sensitivity_synthetic': sens, 'max_wait_minutes_synthetic': wait,
        'category_preference_weights_synthetic': pref,
        'decision_criteria_weights_synthetic': crit,
        'weekday_visit_prob_synthetic': round(p_wd, 4), 'weekend_visit_prob_synthetic': round(p_we, 4),
        'workplace_in_okpo1_synthetic': bool(in_dong_work) if (work_span_wd or level) else None,
        'weekday_home_minutes_synthetic': int(home_wd),
        'weekday_work_in_dong_minutes_synthetic': int(work_in_wd),
        'weekday_street_minutes_synthetic': int(st_wd),
        'weekday_stay_minutes_synthetic': round(stay_wd, 1),
        'weekend_home_minutes_synthetic': int(home_we),
        'weekend_work_in_dong_minutes_synthetic': int(work_in_we),
        'weekend_street_minutes_synthetic': int(st_we),
        'weekend_stay_minutes_synthetic': round(stay_we, 1),
        'summer_aug_weight': MONTHLY_PARK[7] if seg == 'tourist' else MONTHLY_COMM[7],
        'winter_feb_weight': MONTHLY_PARK[1] if seg == 'tourist' else MONTHLY_COMM[1],
        '_p_vec': p_vec, '_s_vec': s_vec, '_is_outside_gn': is_outside_gn,
    }


# ── 4. 후보 풀 생성 (90,000명) 및 다중 주변합 Raking 보정 ─────────────────────
rng = random.Random(SEED)
POOL_ALLOC = {
    'resident': 24000,
    'foreign_resident': 4000,
    'okpo1_worker': 11000,
    'stayer': 11000,
    'commuter': 11000,
    'geoje_visitor': 24000,
    'tourist': 5000,
}
assert sum(POOL_ALLOC.values()) == M_POOL

pool = []
for seg, cnt in POOL_ALLOC.items():
    for _ in range(cnt):
        pool.append(make_candidate(rng, seg))

# 초기 가중치: 각 구분의 물리적 사전 규모로 시작 (옥포1동 + 옥포2동 인접권 50%)
ACTIVE_RESIDENT_TARGET = (OKPO1_ACTUAL_10P + OKPO2_SCOPE_WEIGHT * OKPO2_ACTUAL_10P) - (OUTFLOW_OUTSIDE_GEOJE * 0.94)
ACTIVE_FOREIGN_RES_TARGET = (fd1['total'] + OKPO2_SCOPE_WEIGHT * fd2['total']) * 0.977 * ASSUMED['foreign_active_daily_share']

init_seg_tot = {
    'resident': ACTIVE_RESIDENT_TARGET,
    'foreign_resident': ACTIVE_FOREIGN_RES_TARGET,
    'okpo1_worker': 3500.0,
    'stayer': 3800.0,
    'commuter': 6000.0,
    'geoje_visitor': 18000.0,
    'tourist': TOURIST_DAILY_TARGET,
}
w = [init_seg_tot[p['segment']] / POOL_ALLOC[p['segment']] for p in pool]

# 목표 주변합 준비
# (a) C1: 옥포1·2동 주민 성×연령 — 시외유출(타지 대학·출장·타지 근무)은 주로 20~59세에서 발생하고 10대·60대 이상은 대부분 동네 상주
STAY_IN_GEOJE_BY_BAND = {
    '10대': 0.94, '20대': 0.62, '30대': 0.68, '40대': 0.71,
    '50대': 0.74, '60대': 0.85, '70대이상': 0.93,
}
res_sa_raw = Counter()
for sx in ('남', '여'):
    for a, v in age_w_scope[sx].items():
        if a >= 10:
            bd = band_of(a)
            res_sa_raw[f'{bd}|{sx}'] += v * STAY_IN_GEOJE_BY_BAND[bd]
res_sa_tot = sum(res_sa_raw.values())
res_sa_target = {k: ACTIVE_RESIDENT_TARGET * v / res_sa_tot for k, v in res_sa_raw.items()}

# (b) C2: 옥포1·2동 등록외국인 비자 대분류 비율
for_occ_target = Counter()
for r in visa_rows:
    c_scope = int(r['옥포1동']) + OKPO2_SCOPE_WEIGHT * int(r['옥포2동'])
    if c_scope > 0:
        occ_v = visa_job(r['체류자격'])[0]
        for_occ_target[occ_v] += c_scope
for_occ_tot = sum(for_occ_target.values())
for_occ_target = {k: ACTIVE_FOREIGN_RES_TARGET * v / for_occ_tot for k, v in for_occ_target.items()}

# (c) C6b: 동 생활인구 성×연령 동시 체류 인원 목표 (옥포1동 + OKPO2_SCOPE_WEIGHT × 옥포2동)
_life_sa_scope_raw = Counter()
for _r in rcsv(os.path.join(P_RAW, 'floating_population', 'gnhub_okpo_sexage.csv')):
    if _r['연도'] == '2026' and '생활인구' in _r['지표'] and _r['지역'] in ('옥포1동', '옥포2동'):
        _w_d = 1.0 if _r['지역'] == '옥포1동' else OKPO2_SCOPE_WEIGHT
        _age_k = '70대이상' if _r['연령'] == '70' else f"{_r['연령']}대"
        _life_sa_scope_raw[f"{_age_k}|{_r['성별']}"] += float(_r['값'] or 0) * _w_d
_life_sa_tot = sum(_life_sa_scope_raw.values()) or 1.0
LIFE_SA_SHARE_TARGET = {k: v / _life_sa_tot for k, v in _life_sa_scope_raw.items()}
LIFE_SA_TARGET = {k: T1_MEAN * v for k, v in LIFE_SA_SHARE_TARGET.items()}

# (d) C4/C5: 시외 유입 동시 체류 인원(3,416.74명): 타시도 vs 경남시군 비중 및 성×연령 비중
OUT_PROV_SIM_TOT = sum(inflow_cells_prov.values())
OUT_GN_SIM_TOT = sum(inflow_cells_gn.values())
OUT_SIM_SCALE = INFLOW_OUTSIDE_GEOJE / (OUT_PROV_SIM_TOT + OUT_GN_SIM_TOT)
OUT_PROV_TARGET = OUT_PROV_SIM_TOT * OUT_SIM_SCALE  # ~2,350명
OUT_GN_TARGET = OUT_GN_SIM_TOT * OUT_SIM_SCALE      # ~1,067명
OUT_SA_TARGET = Counter()
for ( _o, bd, sx), v in inflow_cells_prov.items():
    OUT_SA_TARGET[f'{bd}|{sx}'] += v * OUT_SIM_SCALE
for ( _o, bd, sx), v in inflow_cells_gn.items():
    OUT_SA_TARGET[f'{bd}|{sx}'] += v * OUT_SIM_SCALE

OUT_SEGS = {'stayer', 'commuter', 'tourist'}
PROV_SET = {k[0] for k in inflow_cells_prov}


C11_SEGS = {'stayer', 'commuter', 'geoje_visitor'}   # 주민(C1·C2)·동내 근무자(C3 일자리)·관광객(기념공원 입장객)은 인원 근거가 따로 있어 시간대로 흔들지 않음


def rake_weights(items, weights, n_iter=35, damp=0.65):
    """다중 주변합 반복 비례 맞춤(damped IPF)."""
    m = len(items)
    p_bar = [x['weekday_stay_minutes_synthetic'] / 1440.0 for x in items]
    s_bar = [sum(x['_s_vec']) / 24.0 for x in items]

    idx_res_sa = defaultdict(list)
    idx_for_occ = defaultdict(list)
    idx_job_ind = defaultdict(list)
    idx_out_prov = []
    idx_out_gn = []
    idx_out_sa = defaultdict(list)
    idx_life_sa = defaultdict(list)
    idx_tourist = []

    for i, x in enumerate(items):
        seg = x['segment']
        sa = f"{x['age_band']}|{x['sex']}"
        idx_life_sa[sa].append(i)
        if seg == 'resident':
            idx_res_sa[sa].append(i)
        elif seg == 'foreign_resident':
            idx_for_occ[x['occupation_synthetic']].append(i)
        elif seg == 'tourist':
            idx_tourist.append(i)
        if x['workplace_in_okpo1_synthetic'] and x['work_industry']:
            idx_job_ind[x['work_industry']].append(i)
        if seg in OUT_SEGS:
            idx_out_sa[sa].append(i)
            if x['home_area'] in PROV_SET or x['_is_outside_gn']:
                idx_out_prov.append(i)
            else:
                idx_out_gn.append(i)

    for _it in range(n_iter):
        # 1) C1: 옥포1동 내국인 주민 성×연령 고정
        for sa, tgt in res_sa_target.items():
            ids = idx_res_sa.get(sa, [])
            cur = sum(weights[i] for i in ids)
            if cur > 0:
                f = (tgt / cur) ** damp
                for i in ids:
                    weights[i] *= f

        # 2) C2: 옥포1동 등록외국인 체류자격 직업군 고정
        for occ_k, tgt in for_occ_target.items():
            ids = idx_for_occ.get(occ_k, [])
            cur = sum(weights[i] for i in ids)
            if cur > 0:
                f = (tgt / cur) ** damp
                for i in ids:
                    weights[i] *= f

        # 3) 관광객 일평균 방문 수(옥포 권역 평일 목표 ~1,500명/일, 주말 ~2,300명/일)
        cur_t = sum(weights[i] for i in idx_tourist)
        if cur_t > 0:
            f = (TOURIST_DAILY_TARGET / cur_t) ** damp
            for i in idx_tourist:
                weights[i] *= f

        # 4) C3: 옥포1동 내 16개 산업별 일자리(합 4,538개) — okpo1_worker 가중치로 부족분을 채우고 초과 시 전체 비례 조정
        for ind, tgt in JOBS_OKPO1.items():
            ids = idx_job_ind.get(ind, [])
            fixed = sum(weights[i] for i in ids if items[i]['segment'] != 'okpo1_worker')
            var_ids = [i for i in ids if items[i]['segment'] == 'okpo1_worker']
            cur_var = sum(weights[i] for i in var_ids)
            if fixed < tgt * 0.92 and cur_var > 0:
                f = ((tgt - fixed) / cur_var) ** damp
                for i in var_ids:
                    weights[i] *= f
            elif fixed + cur_var > 0:
                f_all = (tgt / (fixed + cur_var)) ** (damp * 0.7)
                for i in ids:
                    if items[i]['segment'] in ('okpo1_worker', 'commuter'):
                        weights[i] *= f_all

        # 5) C4 & C5: 시외 유입 동시 체류 인원(옥포1+2동 범위) 타시도/경남시군 비중 및 성×연령 비중
        #    관광객 동시체류 몫을 뺀 나머지를 stayer(57%)·commuter(43%)가 분담
        t_sim_now = sum(weights[i] * p_bar[i] for i in idx_tourist)
        rem_out_sim = max(500.0, INFLOW_OUTSIDE_GEOJE - t_sim_now)
        stayer_sim = sum(weights[i] * p_bar[i] for i in range(m) if items[i]['segment'] == 'stayer')
        comm_sim = sum(weights[i] * p_bar[i] for i in range(m) if items[i]['segment'] == 'commuter')
        if stayer_sim > 0:
            f_st = ((rem_out_sim * 0.57) / stayer_sim) ** (damp * 0.65)
            for i in range(m):
                if items[i]['segment'] == 'stayer':
                    weights[i] *= f_st
        if comm_sim > 0:
            f_cm = ((rem_out_sim * 0.43) / comm_sim) ** (damp * 0.65)
            for i in range(m):
                if items[i]['segment'] == 'commuter':
                    weights[i] *= f_cm

        for ids, tgt in ((idx_out_prov, OUT_PROV_TARGET), (idx_out_gn, OUT_GN_TARGET)):
            cur = sum(weights[i] * p_bar[i] for i in ids if items[i]['segment'] != 'tourist')
            t_fixed = sum(weights[i] * p_bar[i] for i in ids if items[i]['segment'] == 'tourist')
            if cur > 0:
                f = (max(tgt - t_fixed, 10.0) / cur) ** damp
                for i in ids:
                    if items[i]['segment'] != 'tourist':
                        weights[i] *= f

        for sa, tgt in OUT_SA_TARGET.items():
            ids = [i for i in idx_out_sa.get(sa, []) if items[i]['segment'] != 'tourist']
            t_fixed = sum(weights[i] * p_bar[i] for i in idx_out_sa.get(sa, []) if items[i]['segment'] == 'tourist')
            cur = sum(weights[i] * p_bar[i] for i in ids)
            if cur > 0:
                f = (max(tgt - t_fixed, 1.0) / cur) ** (damp * 0.8)
                for i in ids:
                    weights[i] *= f

        # 6) C11: 상권 거리 24시간 비율 보정 — 주민(C1·C2로 고정된 집단, 취업자 비율을 흔들지 않게) 밖의 모든 사람에게,
        #    상권에 있는 시간대의 배율을 그 시간 비중으로 가중 평균(기하)해 곱한다. 구분별 합계(C3 일자리·C4/C5 시외)는 다음 반복이 다시 맞춘다.
        #    예전엔 거제 타동 방문객만 움직였는데, 직장인이 근무 시간에 못 오게 하자 저녁이 넘쳐 그것만으로는 맞지 않았다
        cur_s = [0.0] * 24
        for i, x in enumerate(items):
            wi = weights[i]
            sv = x['_s_vec']
            for h in range(24):
                cur_s[h] += wi * sv[h]
        tot_s = sum(cur_s) or 1.0
        log_s = [math.log(max(COMM_HOUR_SHARE[h], 1e-6) / max(cur_s[h] / tot_s, 1e-6)) for h in range(24)]
        for i, x in enumerate(items):
            sv = x['_s_vec']
            ssum = sum(sv)
            if ssum > 0 and x['segment'] in C11_SEGS:
                weights[i] *= max(0.5, min(2.0, math.exp(damp * 0.6 * sum(sv[h] * log_s[h] for h in range(24)) / ssum)))

        # 7) C6: 옥포1동 24시간 동시 체류 인원 곡선 T1_HOURLY — 모양(시간대 배율, 체류 시간 가중 기하평균)과 평균(거제 타동 방문객 규모)
        cur_h = [0.0] * 24
        for i, x in enumerate(items):
            wi = weights[i]
            pv = x['_p_vec']
            for h in range(24):
                cur_h[h] += wi * pv[h]
        log_h = [math.log(T1_HOURLY[h] / max(cur_h[h], 1e-6)) for h in range(24)]
        for i, x in enumerate(items):
            pv = x['_p_vec']
            psum = sum(pv)
            if psum > 0:
                weights[i] *= max(0.7, min(1.4, math.exp(damp * 0.8 * sum(pv[h] * log_h[h] for h in range(24)) / psum)))
        non_gv_mean = sum(weights[i] * p_bar[i] for i in range(m) if items[i]['segment'] != 'geoje_visitor')
        gv_mean = sum(weights[i] * p_bar[i] for i in range(m) if items[i]['segment'] == 'geoje_visitor')
        gv_target_mean = max(350.0, T1_MEAN - non_gv_mean)
        if gv_mean > 0:
            g_scale = (gv_target_mean / gv_mean) ** damp
            for i, x in enumerate(items):
                if x['segment'] == 'geoje_visitor':
                    weights[i] *= g_scale

        # 8) C6c: 동 생활인구 성×연령은 C1·C4·C5·상권유동(COMM_SA_10P)에서 자연 수렴하므로 개별 직업군 성비를 왜곡하지 않음

    # 마지막 정규화: 전체 평균 동시 체류 인원을 정확히 T1_MEAN(8,893.67)에 고정(주민·시외유입은 유지하고 geoje_visitor 로 미세 마감)
    non_gv_mean = sum(weights[i] * p_bar[i] for i in range(m) if items[i]['segment'] != 'geoje_visitor')
    gv_mean = sum(weights[i] * p_bar[i] for i in range(m) if items[i]['segment'] == 'geoje_visitor')
    if gv_mean > 0 and T1_MEAN > non_gv_mean:
        f_final = (T1_MEAN - non_gv_mean) / gv_mean
        for i, x in enumerate(items):
            if x['segment'] == 'geoje_visitor':
                weights[i] *= f_final
    return weights


w = rake_weights(pool, w, n_iter=40, damp=0.65)

# ── 5. 실제 하루 유동인구 규모 N = round(Σw) 전원 1:1 체계 추출(Systematic PPS) ──
# 1 페르소나 봇 = 실제 사람 약 1.0명이 되도록 보정된 하루 총 순인원만큼 그대로 생성한다.
N = int(round(sum(w)))
order_idx = sorted(range(M_POOL), key=lambda i: (
    SEGMENTS.index(pool[i]['segment']), pool[i]['age_band'], pool[i]['sex'], pool[i]['weekday_arrival_min']))


def systematic_pps(indices, weights_all, k_select, rng_obj):
    tot_w = sum(weights_all[i] for i in indices)
    step = tot_w / k_select
    u = rng_obj.uniform(0.0, step)
    chosen = []
    acc = 0.0
    ptr = 0
    for j in range(k_select):
        thresh = u + j * step
        while ptr < len(indices) - 1 and acc + weights_all[indices[ptr]] < thresh:
            acc += weights_all[indices[ptr]]
            ptr += 1
        chosen.append(dict(pool[indices[ptr]]))
    return chosen, tot_w / k_select


people, w_base = systematic_pps(order_idx, w, N, rng)
w_10k = [w_base] * N

# 추출된 N명에 대해 미세 Raking(14회)을 적용해 이산화 오차까지 제거 (평균 가중치 ≈ 1.0 유지)
w_10k = rake_weights(people, w_10k, n_iter=14, damp=0.50)
perm = list(range(N))
rng.shuffle(perm)
people = [people[i] for i in perm]
w_10k = [w_10k[i] for i in perm]

# ── 6. 주말 가중치 및 카드 결제(C8~C10) 보정 ─────────────────────────────────
WE_SEG_MULT = {
    'resident': 1.0,                                    # 거주 인구는 동일(외출·근무 시간만 주말 일정으로 전환)
    'foreign_resident': 1.0,
    'okpo1_worker': 0.52,                               # 주말 영업 사업체 근무자만 출근
    'stayer': 0.88,                                     # 주말 일부 귀가·외출 반영
    'commuter': 0.42,                                   # 주말 통근 감소
    'geoje_visitor': WE_RATIO['local'] * 1.08,          # 주말 장보기·외식 방문
    'tourist': WE_RATIO['outside'],                     # 거제 외지인 주말/평일 비 1.539배
}
w_10k_we = [w_10k[i] * WE_SEG_MULT[people[i]['segment']] for i in range(N)]

# C8~C10: 카드 결제 보정 (공공데이터 2025 옥포1동 개인 성×연령 결제비중 + NH카드 하루 5,623.52건·시간대 비율·외지 비중 10.59%)
# ※ V6(경남빅데이터허브 NH카드 2026 성×연령 매출)는 보정에 전혀 쓰지 않고 교차 검증에만 사용한다.
card_okpo1_sa_amt = Counter()
for r in card_detail:
    if r['동'] == '옥포1동' and r['연령대'] != '기업' and CARD_CAT.get(r['업종중분류']):
        card_okpo1_sa_amt[f"{r['연령대']}|{r['성별']}"] += float(r['추정이용금액'])
card_okpo1_sa_amt['10대|남'] = sum(card_okpo1_sa_amt.values()) * 0.0020
card_okpo1_sa_amt['10대|여'] = sum(card_okpo1_sa_amt.values()) * 0.0015
card_okpo1_sa_tot = sum(card_okpo1_sa_amt.values()) or 1.0
TARGET_PORTAL_SA_AMT = {k: v / card_okpo1_sa_tot for k, v in card_okpo1_sa_amt.items()}

def eff_pref(p):
    """평일 도착 시각에 문 연 업종만 남긴 업종 선호(시뮬이 업종을 고르는 방식과 같음)."""
    h = (p['weekday_arrival_min'] // 60) % 24
    pr = p['category_preference_weights_synthetic']
    e = {c: pr[c] * CAT_HOUR_MASK[c][h] for c in CATS}
    t = sum(e.values())
    return {c: v / t for c, v in e.items()} if t > 0 else pr


def tx_spend(p):
    """결제 1건당 기대 지출(시뮬 단위): Σ 업종 선호(문 연 업종) × 업종 1인 가격 × 1인 지출 배수."""
    e = eff_pref(p)
    return p['spend_multiplier_synthetic'] * sum(e[c] * CAT_PRICE[c] for c in CATS)


raw_tx = []
for i, p in enumerate(people):
    exp_cap = sum(p['category_preference_weights_synthetic'][c] * max(p['category_cap_krw_synthetic'][c], 4000) for c in CATS) or 15000
    # 외국인 유입층은 거리에 나와도 송금·절약 구조로 유료 상점 결제 빈도가 낮음(무소비 산책·만남 비중 반영)
    for_tx_factor = ASSUMED['foreign_paid_tx_factor'] if p['nationality'] != '한국' else 1.0
    base_n = p['weekday_visit_prob_synthetic'] * for_tx_factor * min(2.0, max(0.35, p['visit_budget_krw_synthetic'] / max(exp_cap, 5000)))
    raw_tx.append(base_n)

# C9b(공공데이터 2025 옥포1동 성×연령 금액 비중) + C10(외지 건수 비중 10.59%) + C8(시간대 비율) 반복 보정
# 결제 시각 = 상권 도착 + 걸어서 약 5분(3D 시뮬이 첫 가게에 들어가 결제하는 시각과 같게). 예전엔 머무는 시간 중 아무 시각에
# 결제를 놓고 맞춰, 시뮬에서는 결제가 한 시간쯤 앞당겨졌다(평일 8시 +2.7%p, 9시 −2.1%p)
pay_hours = [((p['weekday_arrival_min'] + 5) // 60) % 24 for p in people]

for _ in range(8):
    # 성×연령 금액 비중(2025 공공데이터 카드매출)
    cur_sa_sp = Counter()
    for i, p in enumerate(people):
        cur_sa_sp[f"{p['age_band']}|{p['sex']}"] += w_10k[i] * raw_tx[i] * tx_spend(p)
    tot_sa_sp = sum(cur_sa_sp.values()) or 1.0
    for i, p in enumerate(people):
        k = f"{p['age_band']}|{p['sex']}"
        tgt_sh = TARGET_PORTAL_SA_AMT.get(k, 0.01)
        cur_sh = cur_sa_sp[k] / tot_sa_sp
        raw_tx[i] *= max(0.3, min(2.5, (tgt_sh / max(cur_sh, 1e-5)) ** 0.65))

    # C10: 외지 결제 건수 비중(10.59%)
    cur_out_tx = sum(w_10k[i] * raw_tx[i] for i, p in enumerate(people) if p['_is_outside_gn'])
    cur_loc_tx = sum(w_10k[i] * raw_tx[i] for i, p in enumerate(people) if not p['_is_outside_gn'])
    if cur_out_tx > 0 and cur_loc_tx > 0:
        out_mult = (OKPO1_OUTSIDE_TX_SHARE * cur_loc_tx) / ((1.0 - OKPO1_OUTSIDE_TX_SHARE) * cur_out_tx)
        out_mult = max(0.5, min(2.0, out_mult))
        for i, p in enumerate(people):
            if p['_is_outside_gn']:
                raw_tx[i] *= out_mult

    # C8: 시간대별 카드 건수 비율
    cur_ch = [0.0] * 24
    for i in range(N):
        cur_ch[pay_hours[i]] += w_10k[i] * raw_tx[i]
    tot_ch = sum(cur_ch) or 1.0
    for i in range(N):
        h = pay_hours[i]
        raw_tx[i] *= max(0.55, min(1.75, (CARD_HOUR_SHARE[h] / max(cur_ch[h] / tot_ch, 1e-5)) ** 0.55))

# 하루 총 카드 건수를 정확히 CARD_DAILY_TARGET(5,623.52건)에 맞춤
tot_raw_tx = sum(w_10k[i] * raw_tx[i] for i in range(N)) or 1.0
tx_scale = CARD_DAILY_TARGET / tot_raw_tx
raw_tx = [v * tx_scale for v in raw_tx]

# C9: 업종별 지출 금액 비중(카드매출 옥포1동 개인 기준, intl 은 점포 공급 비중 ~1.84% 유지) 미세 보정
card_cat_tot = sum(card_okpo1_cat.values()) or 1.0
TARGET_CAT_SHARE = {c: card_okpo1_cat[c] / card_cat_tot for c in ('meal', 'pub', 'cafe', 'mart', 'life')}
for _ in range(14):
    cur_spend = Counter()
    for i, p in enumerate(people):
        wt_spend = w_10k[i] * raw_tx[i] * p['spend_multiplier_synthetic']
        e = eff_pref(p)
        for c in CATS:
            cur_spend['meal' if c == 'intl' else c] += wt_spend * e[c] * CAT_PRICE[c]
    tot_sp = sum(cur_spend.values()) or 1.0
    factors = {c: (TARGET_CAT_SHARE[c] / max(cur_spend[c] / tot_sp, 1e-5)) ** 0.75 for c in TARGET_CAT_SHARE}
    factors['intl'] = factors['meal']
    for p in people:
        pr = p['category_preference_weights_synthetic']
        new_p = {c: pr[c] * factors[c] for c in CATS}
        s = sum(new_p.values()) or 1.0
        p['category_preference_weights_synthetic'] = {c: round(new_p[c] / s, 4) for c in CATS}

# ── 7. 최종 페르소나 레코드 조립 ─────────────────────────────────────────────
# 지도 범위(옥포1·2동) 총 결제량 배율: 카드·현금 구분 없이, 시뮬 1인 가격 단위 지출 합이 지도 범위 실제 일매출(약 4.30억 원)과 같도록 환산
# 시뮬 실현 단가 ÷ CAT_PRICE: tools/sim_persona_check.js 실측(2026-11-27) 업종별 0.80~1.04, 전체 0.95.
# CAT_PRICE 가 이미 가격대(tier) 가중 평균이라 시뮬은 거의 그 값으로 결제한다. 예전 0.825 가정은 결제 수를 약 15% 부풀려 매출이 넘쳤다
# (값이 바뀌면 validation_sim.json 의 realized_price_ratio 를 보고 고친다)
SIM_REALIZED_PRICE_RATIO = 0.95
# 외지 관광객(국민여행조사 거제 실측 일 38,364원·약 2.7~3곳)과 거제 타동 방문객(옆 동네 방문 1.5~2곳)의 다중 방문 보정
SEG_TOTAL_TX_MULT = {'tourist': 2.65, 'geoje_visitor': 1.45}
# 다중 방문 배수를 넣은 '뒤에' 전체를 지도 범위 실제 일매출에 맞춘다(구성 비율만 바뀌고 총 매출은 목표 그대로).
# 예전엔 목표에 맞춘 다음 배수를 곱해 매출이 목표보다 약 24.5% 넘쳤다
sim_unit_spend_at_card = sum(w_10k[i] * raw_tx[i] * SEG_TOTAL_TX_MULT.get(people[i]['segment'], 1.0) * tx_spend(people[i])
                             for i in range(N)) * SIM_REALIZED_PRICE_RATIO or 1.0
MAP_TX_SCALE = MAP_DAILY_SALES_TARGET_KRW / sim_unit_spend_at_card

for i, p in enumerate(people):
    p['persona_id'] = f'OP-P{i + 1:05d}'
    p['synthetic'] = True
    p['weekday_expansion_weight'] = round(w_10k[i], 4)
    p['weekend_expansion_weight'] = round(w_10k_we[i], 4)
    p['expected_card_tx_weekday_synthetic'] = round(raw_tx[i], 4)
    p['expected_total_tx_weekday_synthetic'] = round(raw_tx[i] * MAP_TX_SCALE * SEG_TOTAL_TX_MULT.get(p['segment'], 1.0), 4)
    p['payment_hour_weekday'] = pay_hours[i]
    extra = f", 한국어 {p['korean_ability_synthetic']}" if p['korean_ability_synthetic'] else ''
    kid = ', 아이 동반' if p['with_child_synthetic'] else ''
    ind_txt = f"({p['work_industry']})" if p['work_industry'] else ''
    p['description_synthetic'] = (
        f"{p['age']}세 {'남성' if p['sex'] == '남' else '여성'} {p['occupation_synthetic']}{ind_txt}"
        f" [{p['segment_ko']}, 거주: {p['home_area']}{', ' + p['nationality'] if p['nationality'] != '한국' else ''}{extra}]. "
        f"{ro(p['transport_synthetic'])} 이동해 {p['visit_purpose_synthetic']}{kid}. "
        f"평일 {p['weekday_arrival']}·주말 {p['weekend_arrival']}경 상권 방문, 1회 예산 약 {p['visit_budget_krw_synthetic']:,}원."
    )

ORDER = [
    'persona_id', 'synthetic', 'segment', 'segment_ko', 'sim_group',
    'age', 'age_band', 'sex', 'home_area', 'nationality', 'visa',
    'occupation_synthetic', 'work_industry', 'lodging_type_synthetic',
    'school_level', 'school_grade', 'school_end_by_weekday', 'korean_ability_synthetic',
    'visit_purpose_synthetic', 'party_size_synthetic', 'with_child_synthetic', 'transport_synthetic',
    'weekday_arrival', 'weekend_arrival', 'vacation_arrival', 'weekday_arrival_min', 'weekend_arrival_min',
    'weekday_dwell_minutes_synthetic', 'weekend_dwell_minutes_synthetic',
    'visit_budget_krw_synthetic', 'category_cap_krw_synthetic', 'spend_multiplier_synthetic',
    'expected_card_tx_weekday_synthetic', 'expected_total_tx_weekday_synthetic', 'payment_hour_weekday',
    'price_sensitivity_synthetic', 'max_wait_minutes_synthetic',
    'category_preference_weights_synthetic', 'decision_criteria_weights_synthetic',
    'weekday_visit_prob_synthetic', 'weekend_visit_prob_synthetic',
    'workplace_in_okpo1_synthetic',
    'weekday_home_minutes_synthetic', 'weekday_work_in_dong_minutes_synthetic',
    'weekday_street_minutes_synthetic', 'weekday_stay_minutes_synthetic',
    'weekend_home_minutes_synthetic', 'weekend_work_in_dong_minutes_synthetic',
    'weekend_street_minutes_synthetic', 'weekend_stay_minutes_synthetic',
    'summer_aug_weight', 'winter_feb_weight',
    'weekday_expansion_weight', 'weekend_expansion_weight', 'description_synthetic',
]

# ── 8. 보정 적합도(Calibration Fit) 및 독립 검증(Independent Validation V1~V10) ──
def shares(counter):
    t = sum(counter.values()) or 1.0
    return {k: round(v / t, 4) for k, v in counter.items()}


val = {'checks': [], 'calibration_checks': [], 'independent_checks': []}


def add_dist_check(kind, name, target, got, tol, note=''):
    keys = sorted(set(target) | set(got))
    diff = max(abs(target.get(k, 0.0) - got.get(k, 0.0)) for k in keys)
    item = {
        'name': name, 'kind': kind, 'max_abs_diff': round(diff, 4),
        'tolerance': tol, 'pass': diff <= tol, 'note': note,
        'target': {k: round(target.get(k, 0.0), 4) for k in keys},
        'generated': {k: round(got.get(k, 0.0), 4) for k in keys},
    }
    val['checks'].append(item)
    val['calibration_checks' if kind == 'calibration' else 'independent_checks'].append(item)


def add_range_check(kind, name, value, lo, hi, note=''):
    ok = lo <= value <= hi
    item = {
        'name': name, 'kind': kind, 'value': round(value, 4),
        'reference_range': [lo, hi], 'pass': ok, 'note': note,
    }
    val['checks'].append(item)
    val['calibration_checks' if kind == 'calibration' else 'independent_checks'].append(item)


# 시간대별 집계
tot_h = [0.0] * 24
street_h = [0.0] * 24
tx_h = [0.0] * 24
for p in people:
    wi = p['weekday_expansion_weight']
    for h in range(24):
        tot_h[h] += wi * p['_p_vec'][h]
        street_h[h] += wi * p['_s_vec'][h]
    tx_h[p['payment_hour_weekday']] += wi * p['expected_card_tx_weekday_synthetic']

# [보정 적합도 점검: C1 ~ C11]
mean_sim_got = sum(tot_h) / 24.0
add_range_check('calibration', f'C6a. 옥포1·2동 범위 그 시각 평균 체류 인원(목표 {round(T1_MEAN):,}명)',
                mean_sim_got, T1_MEAN * 0.99, T1_MEAN * 1.01, '경남빅데이터허브 2026년 1~9월 동 생활인구 시각평균(옥포1동 + 옥포2동×0.5)')
max_h_rel_err = max(abs(tot_h[h] - T1_HOURLY[h]) / T1_HOURLY[h] for h in range(24))
add_range_check('calibration', 'C6b. 옥포1·2동 24시간 체류 곡선 최대 상대오차',
                max_h_rel_err, 0.0, 0.08, '0~23시 시각별 생활인구 대비 상대오차')

life_sa_got = Counter()
for p in people:
    life_sa_got[f"{p['age_band']}|{p['sex']}"] += p['weekday_expansion_weight'] * (p['weekday_stay_minutes_synthetic'] / 1440.0)
add_dist_check('calibration', 'C6c. 옥포1·2동 생활인구 성×연령 비중',
               LIFE_SA_SHARE_TARGET, shares(life_sa_got), 0.03,
               'gnhub_okpo_sexage.csv 2026 동 생활인구(옥포1동 + 옥포2동×0.5)')

res_sa_w = Counter()
for p in people:
    if p['segment'] == 'resident':
        res_sa_w[f"{p['age_band']}|{p['sex']}"] += p['weekday_expansion_weight']
add_dist_check('calibration', 'C1. 옥포1·2동 내국인 주민 나이대×성별',
               shares(res_sa_target), shares(res_sa_w), 0.015, '옥포1·2동 실거주자 10세 이상')

jobs_got = Counter()
for p in people:
    if p['workplace_in_okpo1_synthetic'] and p['work_industry']:
        jobs_got[p['work_industry']] += p['weekday_expansion_weight']
add_range_check('calibration', f'C3a. 옥포1·2동 범위 사업체 취업자 수(목표 {TOTAL_JOBS_OKPO1:,}명)',
                sum(jobs_got.values()), TOTAL_JOBS_OKPO1 * 0.95, TOTAL_JOBS_OKPO1 * 1.05, '09_businesses_by_industry.csv')
add_dist_check('calibration', 'C3b. 옥포1·2동 내 16개 산업별 일자리 비중',
               shares(JOBS_OKPO1), shares(jobs_got), 0.02, '숙박음식·사업시설·전문기술·도소매 등')

out_sim_got = sum(p['weekday_expansion_weight'] * (p['weekday_stay_minutes_synthetic'] / 1440.0)
                  for p in people if p['segment'] in OUT_SEGS)
out_share_tgt = INFLOW_OUTSIDE_GEOJE / T1_MEAN
add_range_check('calibration', f'C4a. 거제 밖 거주자 동시 체류 비중(목표 {out_share_tgt:.1%})',
                out_sim_got / mean_sim_got, round(out_share_tgt - 0.03, 3), round(out_share_tgt + 0.03, 3), 'gnhub_okpo_inflow_origin.csv 2026(옥포1+2동 범위)')

out_prov_got = sum(p['weekday_expansion_weight'] * (p['weekday_stay_minutes_synthetic'] / 1440.0)
                   for p in people if p['segment'] in OUT_SEGS and (p['home_area'] in PROV_SET or p['_is_outside_gn']))
add_range_check('calibration', 'C4b. 거제 밖 체류 중 타시도 비중(목표 68.8%)',
                out_prov_got / max(out_sim_got, 1.0), 0.65, 0.72, '타시도(부산·경기·서울 등) vs 경남 시군(통영·김해 등)')

out_male_got = sum(p['weekday_expansion_weight'] * (p['weekday_stay_minutes_synthetic'] / 1440.0)
                   for p in people if p['segment'] in OUT_SEGS and p['sex'] == '남')
add_range_check('calibration', 'C5. 거제 밖 유입 남성 비율(목표 65.7%)',
                out_male_got / max(out_sim_got, 1.0), 0.627, 0.687, 'gnhub_okpo_inflow_origin.csv 2026')

street_sh_got = {f'{h:02d}시': street_h[h] / max(sum(street_h), 1.0) for h in range(24)}
street_sh_tgt = {f'{h:02d}시': COMM_HOUR_SHARE[h] for h in range(24)}
add_dist_check('calibration', 'C11. 상권 거리 체류 24시간 비율(44개월 평균 대비)',
               street_sh_tgt, street_sh_got, 0.015, 'gnhub_hourly.csv 상권 유동인구')

tx_tot_got = sum(tx_h)
add_range_check('calibration', 'C8a. 하루 카드 결제 건수 ÷ NH카드 실측(5,624건)',
                tx_tot_got / CARD_DAILY_TARGET, 0.95, 1.05, 'gnhub_hourly.csv 2026년 1~9월 일평균')
add_dist_check('calibration', 'C8b. 카드 결제 24시간 비율',
               {f'{h:02d}시': CARD_HOUR_SHARE[h] for h in range(24)},
               {f'{h:02d}시': tx_h[h] / max(tx_tot_got, 1.0) for h in range(24)}, 0.018, '12시 점심·18~19시 저녁 피크')

spend_cat_got = Counter()
for p in people:
    wt_sp = p['weekday_expansion_weight'] * p['expected_card_tx_weekday_synthetic'] * p['spend_multiplier_synthetic']
    e = eff_pref(p)
    for c in CATS:
        spend_cat_got['meal' if c == 'intl' else c] += wt_sp * e[c] * CAT_PRICE[c]
add_dist_check('calibration', 'C9. 업종별 지출 금액 비중(옥포1동 카드매출 대비)',
               TARGET_CAT_SHARE, shares(spend_cat_got), 0.03,
               '07_card_detail.csv 옥포1동 개인(다국적은 식사에 합산). 지출 = 결제 × 도착 시각에 연 업종의 1인 가격 × 지출 배수(시뮬과 같은 단위)')

tx_out_gn_got = sum(p['weekday_expansion_weight'] * p['expected_card_tx_weekday_synthetic'] for p in people if p['_is_outside_gn'])
add_range_check('calibration', 'C10. 경남 밖 거주자 카드 결제 건수 비중(목표 10.6%)',
                tx_out_gn_got / max(tx_tot_got, 1.0), 0.08, 0.13, '07_card_detail.csv 옥포1동 외지 비중 0.1059')

# [독립 검증: 보정에 전혀 쓰지 않은 외부·교차 지표 V1 ~ V10]
daily_unique_wd = sum(p['weekday_expansion_weight'] for p in people)
daily_unique_we = sum(p['weekend_expansion_weight'] for p in people)
add_range_check('independent', 'V1. 하루 다녀간 순인원 Σw vs 소상공인365 옥포1·2동 범위(~47,227명)',
                daily_unique_wd, 36000, 58000, '보정에 쓰지 않은 일 단위 순방문·체류 인원 규모 검증(옥포1동 29,264 + 옥포2동 35,925×0.5)')

peak_to_mean_street = max(street_h) / (sum(street_h) / 24.0)
add_range_check('independent', 'V2. 상권 거리 시간대 피크 ÷ 시간평균(실측 1.89)',
                peak_to_mean_street, 1.70, 2.10, '기존 v0.2.0(3.42) 과다 집중 해소 검증')

add_dist_check('independent', 'V3. 옥포1동 동 유동인구(2026) 24시간 모양 비교',
               {f'{h:02d}시': DONG_FLOW_SHARE_26[h] for h in range(24)}, street_sh_got, 0.015,
               '상권 유동(44개월)으로만 보정한 뒤 동 유동(2026)과 교차 비교')

sbiz_raw = targets_json['okpo1_daily_unique_benchmarks']['sbiz365_age_counts']
sbiz_tgt = shares(sbiz_raw)
age6_got = Counter()
for p in people:
    k = '60대이상' if p['age'] >= 60 else p['age_band']
    age6_got[k] += p['weekday_expansion_weight']
add_dist_check('independent', 'V4. 하루 방문자 연령대 구성 vs 소상공인365(2026-08)',
               sbiz_tgt, shares(age6_got), 0.065, 'sbiz365_okpo_dong.json VstAgeRnk 독립 비교')

street_sa_got = Counter()
for p in people:
    street_sa_got[f"{p['age_band']}|{p['sex']}"] += p['weekday_expansion_weight'] * sum(p['_s_vec'])
add_dist_check('independent', 'V5. 상권 거리 체류 성×연령 vs 상권 유동인구(2026)',
               COMM_SA_10P, shares(street_sa_got), 0.04, 'gnhub_okpo_sexage.csv 상권 유동 성연령 독립 비교')

spend_sa_got = Counter()
for p in people:
    spend_sa_got[f"{p['age_band']}|{p['sex']}"] += (
        p['weekday_expansion_weight'] * p['expected_card_tx_weekday_synthetic'] * tx_spend(p))
add_dist_check('independent', 'V6. 성×연령별 매출 비중 vs NH카드(2026, 다른 카드사·연도)',
               targets_json['okpo1_card_benchmarks']['nh_sex_age_amount_share_2026'], shares(spend_sa_got), 0.045,
               '공공데이터(2025)로만 보정한 뒤 경남빅데이터허브 NH카드(2026) 성연령 매출과 독립 비교')

outside_sido_spend = Counter()
for p in people:
    if p['_is_outside_gn']:
        sido_k = p['home_area'][:2] if len(p['home_area']) >= 2 else p['home_area']
        if '경기' in p['home_area']:
            sido_k = '경기'
        elif '부산' in p['home_area']:
            sido_k = '부산'
        elif '서울' in p['home_area']:
            sido_k = '서울'
        elif '울산' in p['home_area']:
            sido_k = '울산'
        elif '경상북도' in p['home_area'] or '경북' in p['home_area']:
            sido_k = '경북'
        elif '대구' in p['home_area']:
            sido_k = '대구'
        outside_sido_spend[sido_k] += p['weekday_expansion_weight'] * p['expected_card_tx_weekday_synthetic'] * tx_spend(p)
top1_sido = outside_sido_spend.most_common(1)[0][0] if outside_sido_spend else ''
busan_share_out = outside_sido_spend['부산'] / max(sum(outside_sido_spend.values()), 1.0)
add_range_check('independent', f'V7. 경남 밖 매출 1위 시도 일치({top1_sido}=부산) 및 부산 비중',
                busan_share_out if top1_sido == '부산' else 0.0, 0.25, 0.85,
                'NH카드 유입지별 매출 1위 부산 확인')

add_range_check('independent', 'V8. 하루 카드 결제 건수 ÷ 공공데이터 옥포1동 개인 카드 일평균(~6,286건)',
                tx_tot_got / OKPO1_CARD_PERSONAL_DAILY_REF, 0.80, 1.20,
                '07_card_detail.csv 옥포1동 개인 결제 건수(2개월 집계 일평균)와 교차 검증')

# V9·V10: 옥포1동 등록외국인 성별·국적 — 체류자격 → 성비(가정) → 국적(체류자격에 맞는 국적만) 순서로 뽑은 결과를 실측과 비교(보정에 안 씀)
fr_w = Counter(); fr_nat = Counter()
for p in people:
    if p['segment'] == 'foreign_resident' and p['home_area'] == '옥포1동':
        fr_w[p['sex']] += p['weekday_expansion_weight']
        fr_nat[p['nationality']] += p['weekday_expansion_weight']
add_range_check('independent', 'V9. 옥포1동 등록외국인 남성 비율 vs 실측(679/1,049 = 64.7%)',
                fr_w['남'] / max(sum(fr_w.values()), 1.0), fd1['male'] / fd1['total'] - 0.05, fd1['male'] / fd1['total'] + 0.05,
                '체류자격별 성비(법무부 전국 체류자격별 남녀, 조선소 근로자·E-6-2만 가정)로 만든 성별을 동 실측 성비와 독립 비교')
nat_top_tgt = {k: v / fd1['total'] for k, v in fd1['top'].items()}
nat_top_tgt['그 밖'] = 1.0 - sum(nat_top_tgt.values())
fr_tot = sum(fr_nat.values()) or 1.0
nat_top_got = {k: fr_nat[k] / fr_tot for k in fd1['top']}
nat_top_got['그 밖'] = 1.0 - sum(nat_top_got.values())
add_dist_check('independent', 'V10. 옥포1동 등록외국인 상위 5개국 비중 vs 실측(거제시 2026-10)', nat_top_tgt, nat_top_got, 0.04,
               '국적은 체류자격에 맞는 나라 안에서만 뽑으므로(예: E-9는 고용허가제 송출국) 동 실측 국적 비중이 유지되는지 확인')

# 내부 작업용 키 제거 및 정렬
clean_people = [{k: p[k] for k in ORDER} for p in people]

seg_counts = Counter(p['segment'] for p in clean_people)
seg_weighted_wd = Counter()
seg_weighted_we = Counter()
seg_sim_wd = Counter()
sim_group_street_wd = Counter()
sim_group_street_we = Counter()
for p in clean_people:
    seg = p['segment']
    seg_weighted_wd[seg] += p['weekday_expansion_weight']
    seg_weighted_we[seg] += p['weekend_expansion_weight']
    seg_sim_wd[seg] += p['weekday_expansion_weight'] * p['weekday_stay_minutes_synthetic'] / 1440.0
    sim_group_street_wd[p['sim_group']] += p['weekday_expansion_weight'] * p['weekday_visit_prob_synthetic']
    sim_group_street_we[p['sim_group']] += p['weekend_expansion_weight'] * p['weekend_visit_prob_synthetic']

out_geoje_persons = sum(p['weekday_expansion_weight'] for p in clean_people if p['segment'] in OUT_SEGS)
val['scale'] = {
    'definition': '다중 주변합 보정(raking): 옥포1동 24시간 동시 체류 인원(평균 8,894명, C6), 내·외국인 주민(C1·C2), 동내 일자리 4,538개(C3), 시외 체류 3,417명(C4·C5), 상권 시간 비율(C11)을 동시에 만족하도록 후보 5만 명에서 PPS 추출',
    'mean_simultaneous_weekday': round(mean_sim_got, 1),
    'daily_unique_weekday': round(daily_unique_wd),
    'daily_unique_weekend': round(daily_unique_we),
    'mean_expansion_weight_weekday': round(daily_unique_wd / N, 4),
    'simultaneous_by_segment_weekday': {SEG_KO[k]: round(seg_sim_wd[k], 1) for k in SEGMENTS},
    'unique_by_segment_weekday': {SEG_KO[k]: round(seg_weighted_wd[k]) for k in SEGMENTS},
    'unique_by_segment_weekend': {SEG_KO[k]: round(seg_weighted_we[k]) for k in SEGMENTS},
    'street_visitors_by_sim_group_weekday': {k: round(v) for k, v in sim_group_street_wd.items()},
    'street_visitors_by_sim_group_weekend': {k: round(v) for k, v in sim_group_street_we.items()},
    'daily_card_transactions_weekday': round(tx_tot_got),
    'daily_total_transactions_map_weekday': round(sum(p['weekday_expansion_weight'] * p['expected_total_tx_weekday_synthetic'] for p in people)),
    'map_daily_sales_target_krw': round(MAP_DAILY_SALES_TARGET_KRW),   # 허브 실측 기반 목표(시뮬 점검 S6 이 이 값과 견줌)
    'map_daily_sales_model_krw': round(sum(p['weekday_expansion_weight'] * p['expected_total_tx_weekday_synthetic'] * tx_spend(p) for p in people) * SIM_REALIZED_PRICE_RATIO),
    'sim_realized_price_ratio': SIM_REALIZED_PRICE_RATIO,
    'cat_price_krw': {c: round(CAT_PRICE[c]) for c in CATS},
    'map_tx_scale': round(MAP_TX_SCALE, 4),
    'seg_total_tx_mult': SEG_TOTAL_TX_MULT,
    'offline_total_mult': round(OFFLINE_TOTAL_MULT, 4),
    'hub_to_all_card': round(HUB_TO_ALL_CARD, 4),
    'map_dong_coverage': {k: round(v, 4) for k, v in MAP_DONG_COVERAGE.items()},
    'hourly_presence_weekday': {
        'dong_total': [round(x, 1) for x in tot_h],
        'dong_target_2026': [round(x, 1) for x in T1_HOURLY],
        'street': [round(x, 1) for x in street_h],
        'card_tx': [round(x, 1) for x in tx_h],
    },
    'nowcast_comparison': {
        'okpo1_daily_outside_geoje_persons': round(out_geoje_persons),
        'geoje_outside_inflow_daily_2026_cases': 93673,
        'share': round(out_geoje_persons / 93673.0, 4),
    },
}
# [참고 비교 R1] 보정·합격 판정에 쓰지 않음: 모델 속 외국인 1인당 하루 지출 ÷ 내국인 vs 조사에서 나온 국내 지출 몫
def _spend(p):
    return p['expected_card_tx_weekday_synthetic'] * tx_spend(p)
_kr = [_spend(p) for p in people if p['nationality'] == '한국' and p['age'] >= 19]
_fx = [_spend(p) for p in people if p['nationality'] != '한국' and p['age'] >= 19 and p['occupation_synthetic'] not in (EXPAT_OCC, EXPAT_FAM_OCC)]
_e9 = [_spend(p) for p in people if p['nationality'] != '한국' and str(p.get('visa') or '').startswith(('E-9', 'E-8', 'H-2'))]
_kr_m = sum(_kr) / max(len(_kr), 1)
_r_all = sum(_fx) / max(len(_fx), 1) / max(_kr_m, 1e-9)
_r_e9 = sum(_e9) / max(len(_e9), 1) / max(_kr_m, 1e-9) if _e9 else None
val['reference'] = [{
    'name': 'R1. 외국인(선주 감독관·가족 제외) 1인당 하루 상권 지출 ÷ 내국인(성인)',
    'all_foreign': round(_r_all, 3), 'all_foreign_range': list(R1_RANGE_ALL),
    'all_foreign_in_range': R1_RANGE_ALL[0] <= _r_all <= R1_RANGE_ALL[1],
    'e9_e8_h2': round(_r_e9, 3) if _e9 else None, 'e9_e8_h2_range': list(R1_RANGE_E9),
    'e9_e8_h2_in_range': bool(_e9) and R1_RANGE_E9[0] <= _r_e9 <= R1_RANGE_E9[1],
    'survey_hint': {
        'foreign_local_spend_share_of_income': round(FOREIGN_LOCAL_SPEND_SHARE, 3),
        'e9_remit_share_of_income': round(E9_REMIT_SHARE, 3),
        'kr_consume_propensity': round(KR_CONSUME_PROPENSITY, 3),
        'press_note': '거제 외국인은 번 돈의 약 1/3만 국내에서 씀(시사저널e 2025-09, 정성 서술)',
    },
    'note': '보정·합격 집계에 넣지 않는 참고 범위. 외국인과 내국인의 소득 차이, 기숙사·사내 소비 몫은 추정이라 범위를 넓게 둠',
}]

val['summary'] = {
    'version': VERSION,
    'n': len(clean_people),
    'all_pass': all(c['pass'] for c in val['checks']),
    'calibration_pass': f"{sum(c['pass'] for c in val['calibration_checks'])}/{len(val['calibration_checks'])}",
    'independent_pass': f"{sum(c['pass'] for c in val['independent_checks'])}/{len(val['independent_checks'])}",
    'weekday_simultaneous_mean': round(mean_sim_got, 1),
    'weekday_visitors_weighted': round(daily_unique_wd),
    'weekend_visitors_weighted': round(daily_unique_we),
    'note': '보정 항목(calibration)은 생성 규칙이 맞춘 목표이고, 독립 검증(independent, V1~V10)은 보정에 쓰지 않은 외부 통계와 비교한 시험 결과다.',
}

# ── 9. 파일 출력 ─────────────────────────────────────────────────────────────
os.makedirs(OUT, exist_ok=True)
SOURCES = [
    {'name': '거제시 면동별 연령분포·거주구분·생산가능·65세이상 인구 (2026-10-31)', 'use': '옥포1동 실거주 내국인(7,120명) 1세 단위 성×연령(C1), 아이 동반율', 'file': 'data/processed/okpo/01, 17, 18'},
    {'name': '거제시 체류자격별 외국인·외국인주민현황·거주외국인 통계 (2026-10)', 'use': '옥포1동 등록외국인(1,049명) 체류자격→직업(C2)·성비(V9), 동 상위 5개국 + 거제 국적 분포(20명 이상 국적 전부)·국적×5세 연령(V10)', 'file': 'data/processed/okpo/03, 17'},
    {'name': '거제시 산업별 사업체수 및 종사자수 (2024-12-31)', 'use': '옥포1동 내 16개 산업 일자리 4,538개(C3, 제조업 89·숙박음식 924·사업지원 975 등)', 'file': 'data/processed/okpo/09_businesses_by_industry.csv'},
    {'name': '경남빅데이터허브 유동·생활인구·주요상권·소비동향 (2023-01~2026-09, SKT·NH카드)', 'use': '옥포1동 24시간 생활인구 평균 8,894명(C6), 시외유입 3,417명 거주지×성연령(C4·C5), 상권 유동 24시간 비율(C11), 카드 결제 5,624건·시간대(C8), 독립검증(V2·V3·V5·V6·V7)', 'file': 'data/processed/okpo/14~17'},
    {'name': '거제시 빅데이터 지역현황 월보(2026-10) · 소상공인365(2026-08)', 'use': '독립 검증 V1(하루 다녀간 인원 29,067 / 29,264명) 및 V4(방문자 연령 구성)', 'file': 'data/processed/okpo/17_flow_targets.json'},
    {'name': '거제시 면동별 카드매출 현황 (2025-02-28)', 'use': '옥포1동 개인 업종×연령×성 금액 비중·건당 금액(C9), 외지 건수 비중 10.6%(C10), 독립검증(V8)', 'file': 'data/processed/okpo/04~07'},
    {'name': '문화체육관광부 2025 국민여행조사 원자료(SAV, 거제 방문 378건·경남 거주 표본)', 'use': '관광객 연령·성·출신지·동반인원·교통·식음료 지출, 경남 연령×성별 종사상지위·주5일비율·주당근로시간', 'file': 'data/processed/okpo/19, 20'},
    {'name': '한국관광공사 거제 요일별 방문자 · 옥포대첩기념공원 월별 입장객(2025)', 'use': '집단별 주말/평일 배율(외지인 1.54·현지인 0.91·외국인 1.01), 관광객 일평균 규모·계절성', 'file': 'data/processed/okpo/10, 16'},
    {'name': '양대 조선소 종사자(2025 한화오션 27,118명) · 한화오션 근무 기본틀', 'use': '조선소 직영/협력 비율, 08:00~17:00 근무 기본 시간대', 'file': 'data/processed/okpo_persona_params.json'},
    {'name': '소상공인 상가정보 옥포 점포 목록(2026-09)', 'use': '일반음식점 대비 다국적 식당 실제 점포 비중(9/488 = 1.84%) 반영', 'file': 'data/processed/okpo_stores.csv'},
    {'name': 'NEIS 학사일정·요일별 시간표 (2026, 옥포 권역 7개 초·중·고)', 'use': '학생 요일별 하교 교시·방학 기간·옥포1동 내 학교 비율', 'file': 'data/raw/geoje/school/'},
    {'name': '한국은행 2024 지급수단 이용행태 조사 · 농촌경제연구원 식품소비행태조사', 'use': '현금 결제 건수 비중(15.9%) 분리 표기, 외식 선택 기준 기본 가중치', 'file': 'data/processed/okpo/17_flow_targets.json'},
    {'name': '2025 이민자체류실태 및 고용조사 — 소득과 소비 (국가데이터처·법무부)', 'use': f'외국인 총소득 중 국내 지출(생활비+기타) {FOREIGN_LOCAL_SPEND_SHARE:.1%}, E-9 송금 {E9_REMIT_SHARE:.1%}·무상 거처 76.7% → 외국인 예산 배수 근거, R1 참고 비교', 'file': 'data/processed/okpo/22_foreign_spending_survey.csv'},
    {'name': '옥포1동 기술센터(대우조선 복합업무지원단지) 입주 점포', 'use': f"설계·엔지니어링 {TECH_CENTER['engineering_firms']}곳과 사내식당(웰리브) {TECH_CENTER['cafeteria']}곳이 한 건물 → 설계·기술직 점심 외출 축소 근거", 'file': 'data/processed/okpo_stores.csv (지번 옥포동 1991-9)'},
    {'name': '법무부 출입국외국인정책 통계월보 체류외국인 원본 통계표 (2026-10-31, 전국)', 'use': f'체류자격별 남녀 → 거제 체류자격 구성으로 가중한 부류별 남성 비율(선주 감독관 {SEX_MALE_BY_CLASS["expat"]:.1%}·결혼이민 {SEX_MALE_BY_CLASS["marriage"]:.1%}·동반 가족 {SEX_MALE_BY_CLASS["family"]:.1%} 등). 조선소 근로자·E-6-2는 가정', 'file': 'data/processed/okpo/23_visa_sex_national.csv'},
    {'name': '거제시 읍면동별 체류자격별 외국인 현황 (2026-10-31)', 'use': '타동에서 옥포로 오는 외국인의 사는 곳(동별 등록외국인 × 거리)·체류자격', 'file': 'data/processed/okpo/21_foreign_by_dong_visa.csv'},
    {'name': '머니투데이 「[르포]불꺼진 \'옥포 이태원\', 선주의 빈자리」(2017-04-03)', 'use': '선박설비(D-9-3) 선주 감독관·가족을 저소비 근로자와 나눠 외국인거리 펍·바 손님으로 둠(expat_pub_pref_scale)', 'file': 'docs/okpo-evidence.md'},
    {'name': '옥포 상인회 인터뷰 녹취 (2026-11-27)', 'use': '① 저녁·주말 외국인 유입 증가 및 저소비(무소비 산책·송금) ② 한화오션 외부 설계동 사내 이전 및 사내식당 식사로 인한 평일 점심 외출 실종 ③ 외국인 비중 증가·혼성 근무로 인한 저녁 회식(주점) 수요 축소 반영', 'file': 'docs/persona-plan.md'},
]

vacations = [e for e in events if '방학' in e['행사'] or '재량' in e['행사']]
rules = {
    'version': VERSION, 'generated': GEN_DATE, 'seed': SEED, 'n': N, 'candidate_pool': M_POOL,
    'script': 'tools/build_personas.py',
    'population_scope': '거제시 옥포1동(R-ONE 「거제옥포」 상권 중심)에 하루 동안 머물거나 방문하는 10세 이상 인구(내·외국인 주민, 동내 사업체 근무자, 시외 숙소형·통근형 유입, 거제 타동 방문객, 관광객)',
    'disclaimer': '가상 인물. 실제 개인 식별 정보가 아니며, 정책·창업 조건 비교용 시뮬레이션 입력이다.',
    'segments': {
        k: {
            'ko': SEG_KO[k], 'sim_group': SIM_GROUP[k],
            'count': seg_counts[k], 'share_of_personas': round(seg_counts[k] / N, 4),
            'weekday_unique_persons': round(seg_weighted_wd[k]),
            'weekday_simultaneous_persons': round(seg_sim_wd[k], 1),
        } for k in SEGMENTS
    },
    'categories': {c: {'ko': CAT_KO[c], 'card_industries': sorted(k for k, v in CARD_CAT.items() if v == c)} for c in CATS},
    'monthly_seasonality': {
        'months': list(range(1, 13)),
        'commercial_flow_weight': MONTHLY_COMM,
        'tourist_park_weight': MONTHLY_PARK,
    },
    'expansion': {
        'method': '후보 50,000명 생성 → 다중 주변합 반복 비례 맞춤(raking) → 도출된 하루 순유동 인원 N = round(Σw) 전원 1:1 체계 추출(PPS) → 미세 보정',
        'primary_target_simultaneous': T1_MEAN,
        'primary_target_src': '경남빅데이터허브 옥포1동 동 생활인구(시각 평균 인원, 2026년 1~9월, 10세 이상·등록외국인 포함)',
        'emergent_daily_unique_weekday': round(daily_unique_wd),
        'persona_count_1to1': N,
        'emergent_daily_unique_benchmark': '29,067명(거제시 2026-10 월보) · 29,264명(소상공인365 2026-08)',
        'weekend_multipliers_by_segment': {k: round(v, 4) for k, v in WE_SEG_MULT.items()},
    },
    'child_escort_rate': round(CHILD_RATE, 4),
    'intl_store_supply_share': round(INTL_STORE_RATIO, 4),
    'school': {'vacations': vacations},
    'evidence_grade_A_direct': [
        'age, sex, home_area (옥포1동 1세 인구, 시외유입 40개 거주지×성연령, 국민여행조사 거제 표본)',
        'nationality, visa (옥포1동 체류자격·국적, 거제 국적×5세 연령)',
        'work_industry 및 workplace_in_okpo1 합계 (옥포1동 16개 산업 종사자 4,538명)',
        '24시간 동 체류 인원 곡선(8,894명) 및 상권 거리 시간대 비율(44개월 평균)',
        '하루 카드 결제 건수(5,624건), 결제 시각 비율, 업종별 금액 비중·건당 금액, 외지 결제 비중(10.6%)',
        'summer_aug_weight, winter_feb_weight (월별 상권 유동·기념공원 입장객)',
    ],
    'assumed_fields': ASSUMED,
    'sex_male_by_visa_class_used': SEX_MALE_BY_CLASS,
    'assumed_field_sources': ASSUMED_SOURCES,
    'sources': SOURCES,
}

alloc_out = {
    'segment_counts': dict(seg_counts),
    'segment_weekday_unique_weighted': {k: round(seg_weighted_wd[k]) for k in SEGMENTS},
    'segment_weekday_simultaneous_weighted': {k: round(seg_sim_wd[k], 1) for k in SEGMENTS},
    'by_segment_age_sex': {
        seg: dict(sorted(Counter(f"{p['age_band']}|{p['sex']}" for p in clean_people if p['segment'] == seg).items()))
        for seg in SEGMENTS
    },
    'occupation': dict(Counter(p['occupation_synthetic'] for p in clean_people).most_common()),
    'work_industry_okpo1': dict(Counter(p['work_industry'] for p in clean_people if p['work_industry']).most_common()),
    'home_area_top25': dict(Counter(p['home_area'] for p in clean_people).most_common(25)),
    'nationality_non_korean': dict(Counter(p['nationality'] for p in clean_people if p['nationality'] != '한국').most_common()),
}


def dump(name, obj):
    with open(os.path.join(OUT, name), 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
        f.write('\n')


dump('generation_rules.json', rules)
dump('demographic_allocation.json', alloc_out)
dump('validation.json', val)
for old_f in ('personas_10000.json', 'personas_10000.jsonl', 'personas_10000.csv'):
    old_p = os.path.join(OUT, old_f)
    if os.path.exists(old_p):
        os.remove(old_p)

with open(os.path.join(OUT, 'personas.json'), 'w', encoding='utf-8') as f:
    json.dump({'metadata': {k: rules[k] for k in ('version', 'generated', 'seed', 'n', 'population_scope', 'disclaimer')},
               'personas': clean_people}, f, ensure_ascii=False)
with open(os.path.join(OUT, 'personas.jsonl'), 'w', encoding='utf-8') as f:
    for p in clean_people:
        f.write(json.dumps(p, ensure_ascii=False) + '\n')

flat_keys = []
CRIT_KEYS = ['가격', '맛', '접근성', '대기', '분위기', '언어·익숙함']
for k in ORDER:
    if k == 'category_preference_weights_synthetic':
        flat_keys += [f'pref_{c}_synthetic' for c in CATS]
    elif k == 'category_cap_krw_synthetic':
        flat_keys += [f'cap_{c}_krw_synthetic' for c in CATS]
    elif k == 'decision_criteria_weights_synthetic':
        flat_keys += [f'crit_{c}_synthetic' for c in CRIT_KEYS]
    elif k == 'school_end_by_weekday':
        flat_keys += [f'school_end_{d}' for d in WEEKDAYS]
    else:
        flat_keys.append(k)

with open(os.path.join(OUT, 'personas.csv'), 'w', encoding='utf-8-sig', newline='') as f:
    wr = csv.writer(f)
    wr.writerow(flat_keys)
    for p in clean_people:
        row = []
        for k in ORDER:
            v = p[k]
            if k == 'category_preference_weights_synthetic':
                row += [v[c] for c in CATS]
            elif k == 'category_cap_krw_synthetic':
                row += [v[c] for c in CATS]
            elif k == 'decision_criteria_weights_synthetic':
                row += [v.get(c, '') for c in CRIT_KEYS]
            elif k == 'school_end_by_weekday':
                row += [(v or {}).get(d, '') for d in WEEKDAYS]
            else:
                row.append('' if v is None else v)
        wr.writerow(row)

# 3D 웹 시뮬레이션(web/sim.js)용 1:1 전수 경량 번들 생성
SIM_GROUPS_ORDER = ['worker', 'foreign', 'resident', 'tourist']
WKEYS_ORDER = ['worker', 'resident', 'tourist', 'foreign.vn', 'foreign.halal', 'foreign.etc', 'foreign.expat']
# 선주 감독관·외국 기술자 세부 업종 선호(가정): 'foreign' 부류 값(쌀국수·편의점·휴대폰 높음, 호프·회 낮음)을 되돌려 양식·호프·바 쪽으로
SUB_PREFS_EXPAT = {'western': 2.0, 'burger': 1.3, 'hof': 3.0, 'yuheung': 4.0, 'hoe': 3.0, 'gogi': 1.5, 'cafe': 1.4, 'bakery': 1.3,
                   'viet': 0.35, 'halal': 0.3, 'bunsik': 0.6, 'conv': 0.6, 'phone': 0.4, 'grocery': 0.7}
MULTI_EXTRA = 0.28   # 다중 방문 성향(bit3)인 사람이 한 번 나올 때 두 번째 가게까지 들를 확률. 시뮬(sim.js)도 이 값을 번들에서 읽는다
GRP_IDX = {g: i for i, g in enumerate(SIM_GROUPS_ORDER)}
WKEY_IDX = {k: i for i, k in enumerate(WKEYS_ORDER)}
SEG_IDX = {s: i for i, s in enumerate(SEGMENTS)}
HALAL_NATS = {'인도네시아', '우즈베키스탄', '파키스탄', '방글라데시', '말레이시아', '타지키스탄', '키르기즈', '카자흐스탄',
              '튀니지', '모로코', '이집트', '예멘공화국', '투르크메니스탄'}
web_records = []
for p in clean_people:
    g_idx = GRP_IDX[p['sim_group']]
    s_idx = SEG_IDX[p['segment']]
    if p['sim_group'] == 'foreign':
        if p['occupation_synthetic'] in (EXPAT_OCC, EXPAT_FAM_OCC):
            wk_name = 'foreign.expat'
        else:
            wk_name = 'foreign.vn' if p['nationality'] == '베트남' else ('foreign.halal' if p['nationality'] in HALAL_NATS else 'foreign.etc')
    else:
        wk_name = p['sim_group']
    wk_idx = WKEY_IDX[wk_name]
    # flags: bit0=조선소 출퇴근 게이트 경유, bit1=원룸·단독·숙소 선호, bit2=동 밖(정류장·경계) 진입, bit3=다중 방문 성향(참고)
    f_ship = 1 if (p['occupation_synthetic'] in YARD and not p['workplace_in_okpo1_synthetic']) else 0
    f_house = 2 if ((p['sim_group'] == 'foreign' and wk_name != 'foreign.expat') or p['lodging_type_synthetic'] in ('기숙사', '모텔·달방·원룸')) else 0
    f_ext = 4 if p['segment'] in ('geoje_visitor', 'commuter', 'tourist', 'okpo1_worker') else 0
    wd_vp = p['weekday_visit_prob_synthetic']
    # 한 번 나올 때 들르는 평균 가게 수(천분율, 1000 상한 없음): 외출확률 × (stops_milli / 1000) = expected_total_tx × expansion_weight
    # 기존 pay_prob ≤ 1000 및 최대 2곳 제한에서 목표 상향 시 잘리던 문제를 해소
    avg_stops = 0.0 if wd_vp <= 0 else (p['expected_total_tx_weekday_synthetic'] * p['weekday_expansion_weight'] / wd_vp)
    f_multi = 8 if avg_stops >= 1.0 else 0
    flags = f_ship | f_house | f_ext | f_multi
    stops_milli = max(0, int(round(avg_stops * 1000)))
    cw = [max(0, int(round(p['category_preference_weights_synthetic'][c] * 100))) for c in CATS]
    if sum(cw) == 0:
        cw[0] = 100
    web_records.append([
        g_idx, s_idx,
        int(p['weekday_arrival_min']), int(p['weekend_arrival_min']),
        int(p['weekday_dwell_minutes_synthetic']), int(p['weekend_dwell_minutes_synthetic']),
        int(p['visit_budget_krw_synthetic']), int(p['max_wait_minutes_synthetic']),
        int(round(p['weekday_visit_prob_synthetic'] * 100)),
        int(round(p['weekend_visit_prob_synthetic'] * 100)),
        int(round(WE_SEG_MULT[p['segment']] * 100)),
        flags, cw, wk_idx, stops_milli,
        int(round(p['spend_multiplier_synthetic'] * 100)),   # 15: 1인 지출 배수(%) — 가게 1인 가격에 곱함
    ])

os.makedirs(os.path.dirname(WEB_DATA_OUT), exist_ok=True)
web_payload = {
    'version': VERSION,
    'generated': GEN_DATE,
    'n': N,
    'weekday_simultaneous_mean': round(mean_sim_got, 1),
    'daily_unique_weekday': round(daily_unique_wd),
    'daily_unique_weekend': round(daily_unique_we),
    'groups': SIM_GROUPS_ORDER,
    'wkeys': WKEYS_ORDER,
    'segments': SEGMENTS,
    'cats': CATS,
    'pay_mode': 'avg_stops',
    'pay_unit': 1000,
    # 부류(+국적) 키별 세부 업종 선호 배수(시뮬이 MENU.prefs 에 없는 키만 여기서 읽음). 'foreign' 부류 값에 한 번 더 곱한다. 가정
    'sub_prefs': {'foreign.expat': SUB_PREFS_EXPAT},
    'p': web_records,
}
with open(WEB_DATA_OUT, 'w', encoding='utf-8') as f:
    f.write('/* 자동 생성: tools/build_personas.py — 옥포 실규모 페르소나 1:1 번들 */\nwindow.PERSONAS = ')
    json.dump(web_payload, f, ensure_ascii=False, separators=(',', ':'))
    f.write(';\n')

# 화면에서 가상 시민을 눌렀을 때 보여 줄 속성 번들(같은 순서). personas.jsonl·위 번들을 다 쓴 뒤에 만든다
import sys as _sys
_sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import persona_profiles_web
persona_profiles_web.main()


def html_table(head, rows):
    h = ''.join(f'<th>{html.escape(str(x))}</th>' for x in head)
    b = ''.join('<tr>' + ''.join(f'<td>{html.escape(str(x))}</td>' for x in r) + '</tr>' for r in rows)
    return f'<table><thead><tr>{h}</tr></thead><tbody>{b}</tbody></table>'


seg_rows = [(SEG_KO[k], SIM_GROUP[k], f"{seg_counts[k]:,}", f"{seg_weighted_wd[k]:,.0f}", f"{seg_sim_wd[k]:,.1f}")
            for k in SEGMENTS]
cal_rows = [(c['name'], c.get('max_abs_diff', c.get('value')), c.get('tolerance', c.get('reference_range')),
             '통과' if c['pass'] else '점검필요', c.get('note', '')) for c in val['calibration_checks']]
ind_rows = [(c['name'], c.get('max_abs_diff', c.get('value')), c.get('tolerance', c.get('reference_range')),
             '통과' if c['pass'] else '불일치', c.get('note', '')) for c in val['independent_checks']]
sample_rows = [(p['persona_id'], p['description_synthetic']) for p in clean_people[:12]]

page = f"""<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>옥포 가상 시민 {N:,}명 (v{VERSION}) — 읽어보기</title>
<style>body{{font-family:system-ui,-apple-system,'Apple SD Gothic Neo',sans-serif;max-width:980px;margin:2rem auto;padding:0 1rem;line-height:1.6;color:#1f2933}}
table{{border-collapse:collapse;width:100%;margin:.6rem 0 1.4rem;font-size:.9rem}}th,td{{border-bottom:1px solid #d9dee3;padding:.38rem .5rem;text-align:left}}
th{{background:#f3f5f7}}.note{{background:#fff7e6;border-left:4px solid #f0a020;padding:.6rem .9rem}}code{{background:#f3f5f7;padding:0 .25rem}}</style></head><body>
<h1>옥포 가상 시민 {N:,}명 — 1:1 실규모 (v{VERSION})</h1>
<p class="note">가상 인물입니다. 실제 개인 기록이 아니며, 상권·정책 조건 비교 시뮬레이션용 합성 인구입니다. <code>_synthetic</code> 접미사 필드는 행동 가정 또는 모형 추정치입니다.</p>
<p>대상: {html.escape(rules['population_scope'])}<br>생성일 {GEN_DATE}, seed {SEED}, 재현 명령: <code>python3 -I tools/build_personas.py</code></p>
<h2>1. 다중 보정 결과 요약 (1 페르소나 = 실제 약 1.0명)</h2>
<p>옥포1동 그 시각 평균 체류 인원 <b>{mean_sim_got:,.1f}명</b>(실측 8,893.7명)에 맞춰 후보 5만 명을 다중 보정(raking)한 뒤, 도출된 하루 순유동 인원 그대로 <b>{N:,}개 페르소나(1:1 실규모)</b>를 생성했습니다(실측 비교치: 거제시 월보 29,067명 · 소상공인365 29,264명). 페르소나 1개는 실제 사람 약 <b>{daily_unique_wd / N:.2f}명</b>을 나타내며 <code>web/data/okpo_personas.js</code>를 통해 3D 시뮬레이션에서 전원이 1:1로 구동됩니다.</p>
{html_table(['구분', 'sim_group', '페르소나 수', '평일 순인원(Σw)', '평일 동시체류 평균'], seg_rows)}
<h2>2. 독립 검증 (보정에 쓰지 않은 외부 통계 V1~V10 비교: {val['summary']['independent_pass']})</h2>
{html_table(['검증 항목', '생성값/차이', '기준 범위', '결과', '비고'], ind_rows)}
<h2>3. 보정 적합도 (목표 주변합 C1~C11: {val['summary']['calibration_pass']})</h2>
{html_table(['보정 항목', '생성값/차이', '허용 범위', '결과', '근거'], cal_rows)}
<h2>4. 페르소나 예시 (상위 12명)</h2>
{html_table(['ID', '설명'], sample_rows)}
<h2>5. 사용한 데이터 출처</h2>
{html_table(['자료명', '반영 항목'], [(s['name'], s['use']) for s in SOURCES])}
</body></html>"""

with open(os.path.join(OUT, '읽어보기.html'), 'w', encoding='utf-8') as f:
    f.write(page)

print(f'=== {OUT} (v{VERSION}, N={N:,} 1:1 실규모) ===')
print(f'웹 번들: {WEB_DATA_OUT} ({os.path.getsize(WEB_DATA_OUT) / 1024:.0f} KB)')
print('보정 통과:', val['summary']['calibration_pass'], '| 독립 검증 통과:', val['summary']['independent_pass'])
_r1 = val['reference'][0]
print(f"[참고] R1 외국인 지출 ÷ 내국인: 전체 {_r1['all_foreign']} (범위 {_r1['all_foreign_range']}) · E-9 등 {_r1['e9_e8_h2']} (범위 {_r1['e9_e8_h2_range']})")
print('평일 동시체류 평균:', round(mean_sim_got, 1), '| 평일 순인원(Σw):', round(daily_unique_wd), '| 주말 순인원:', round(daily_unique_we))
for c in val['checks']:
    tag = 'OK' if c['pass'] else 'NG'
    print(f"[{tag}][{c['kind'][:3]}] {c['name']}: {c.get('max_abs_diff', c.get('value'))} (기준 {c.get('tolerance', c.get('reference_range'))})")
