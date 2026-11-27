"""NEIS 교육정보 개방포털에서 옥포 구역 근처 학교의 학사일정(방학·개학)과 요일별 교시 수를 받는다.

- 결과: data/raw/geoje/school/
    schools.csv            학교 목록
    schedule_events.csv    방학·개학·방학식·종업식·졸업식 같은 행사일
    periods_by_weekday.csv 학교·학년별 요일당 최대 교시 수 (기준 주의 실제 시간표)
실행: python3 -I tools/neis_fetch_okpo_schools.py
"""
import os, csv, json, time, datetime, urllib.request, urllib.parse

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'raw', 'geoje', 'school')
BASE = 'https://open.neis.go.kr/hub/'
OFFICE = 'S10'  # 경상남도교육청
SCHOOLS = {  # 학교코드: (이름, 급, 메모)
    '9111029': ('옥포초등학교', '초', '옥포1동, 구역 안'),
    '9111024': ('아주초등학교', '초', '아주동, 구역 인접'),
    '9111010': ('국산초등학교', '초', '연초면 국산, 구역 북쪽'),
    '9111053': ('옥포중학교', '중', '옥포동'),
    '9111052': ('옥포성지중학교', '중', '거제대로 3699'),
    '9010079': ('거제고등학교', '고', '아주동'),
    '9010323': ('거제옥포고등학교', '고', '연초면 국산'),
}
TIMETABLE = {'초': 'elsTimetable', '중': 'misTimetable', '고': 'hisTimetable'}
KEEP = ('방학', '개학', '종업', '졸업', '재량휴업')
YEAR = '2026'


def get(service, **q):
    """(전체 건수, 행 목록)을 돌려준다."""
    params = {'Type': 'json', 'pIndex': 1, 'pSize': 5, 'ATPT_OFCDC_SC_CODE': OFFICE, **q}
    url = BASE + service + '?' + urllib.parse.urlencode(params)
    for attempt in range(4):
        try:
            d = json.loads(urllib.request.urlopen(url, timeout=30).read().decode('utf-8'))
            break
        except OSError:
            time.sleep(2 ** attempt)
    else:
        raise SystemExit(f'실패: {url}')
    time.sleep(0.05)
    if service not in d:
        return 0, []  # INFO-200: 데이터 없음
    return d[service][0]['head'][0]['list_total_count'], d[service][1]['row']


def schedule_rows(code, start, end):
    """기간을 5건 이하가 될 때까지 반으로 나눠 학사일정 전부를 모은다."""
    total, rows = get('SchoolSchedule', SD_SCHUL_CODE=code,
                      AA_FROM_YMD=start.strftime('%Y%m%d'), AA_TO_YMD=end.strftime('%Y%m%d'))
    if total <= len(rows):
        return rows
    if start == end:  # 하루에 6건 이상이면 앞 5건만 (방학 판단에는 충분)
        return rows
    mid = start + (end - start) // 2
    return schedule_rows(code, start, mid) + schedule_rows(code, mid + datetime.timedelta(1), end)


def write(name, header, rows):
    with open(os.path.join(OUT, name), 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)
    print(f'{name}: {len(rows)}행')


def schedule():
    out = []
    for code, (nm, lv, _) in SCHOOLS.items():
        rows = schedule_rows(code, datetime.date(int(YEAR), 1, 1), datetime.date(int(YEAR), 12, 31))
        # 방학은 날마다 행이 있으므로 이름별로 첫날·마지막날만 남긴다
        span = {}
        for r in rows:
            ev = r['EVENT_NM'].strip()
            if any(k in ev for k in KEEP):
                a = span.setdefault(ev, [r['AA_YMD'], r['AA_YMD'], 0])
                a[0], a[1], a[2] = min(a[0], r['AA_YMD']), max(a[1], r['AA_YMD']), a[2] + 1
        for ev, (s, e, n) in sorted(span.items(), key=lambda kv: kv[1][0]):
            out.append((nm, lv, ev, s, e, n))
        print(f'  {nm}: 일정 {len(rows)}건')
    write('schedule_events.csv', ['학교', '급', '행사', '시작일', '종료일', '일수'], out)


def periods():
    # 학기 중인 최근 주(월~금)의 1반 시간표로 학년·요일별 마지막 교시를 센다
    today = datetime.date(2026, 11, 23)  # 2학기 중 월요일
    days = [today + datetime.timedelta(d) for d in range(5)]
    out = []
    for code, (nm, lv, _) in SCHOOLS.items():
        grades = range(1, 7) if lv == '초' else range(1, 4)
        for g in grades:
            for d in days:
                total, _ = get(TIMETABLE[lv], SD_SCHUL_CODE=code, ALL_TI_YMD=d.strftime('%Y%m%d'),
                               GRADE=g, CLASS_NM='1')
                # 1반 하루 시간표는 교시당 1행 → 전체 건수 = 그날 교시 수
                out.append((nm, lv, g, d.isoformat(), '월화수목금'[d.weekday()], total or ''))
        print(f'  {nm}: 시간표 완료')
    write('periods_by_weekday.csv', ['학교', '급', '학년', '날짜', '요일', '마지막교시'], out)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    write('schools.csv', ['학교코드', '학교', '급', '위치메모'], [(c, *v) for c, v in SCHOOLS.items()])
    schedule()
    periods()
    with open(os.path.join(OUT, 'SOURCE.txt'), 'w', encoding='utf-8') as f:
        f.write('출처: NEIS 교육정보 개방포털 (https://open.neis.go.kr) 학교기본정보·학사일정·시간표 API\n'
                f'받은 날짜: {datetime.date.today()}\n')
