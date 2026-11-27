"""tools/localdata_closed.py 자동 점검. 실제 인허가 파일 없이 가짜 행으로 돌린다.
실행: python3 -I tools/test_localdata_closed.py   (끝에 '모두 통과'가 나오면 된다)
"""
import csv, os, sys, tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from localdata_epsg5174 import from_wgs, to_wgs
import localdata_closed as L

IN_PT = (35.0995, 129.0300)    # 남포동 경계 안(광복로·BIFF 사이)
IN_PT2 = (35.1010, 129.0280)   # 경계 안(국제시장 쪽)
OUT_PT = (35.0985, 129.0400)   # 경계 밖(동쪽, 중앙대로 건너)


def xy(pt):
    x, y = from_wgs(*pt)
    la, lo = to_wgs(x, y)
    assert abs(la - pt[0]) < 1e-7 and abs(lo - pt[1]) < 1e-7, '좌표 역변환이 맞지 않음'
    return f'{x:.3f}', f'{y:.3f}'


def write(path, header, rows, enc):
    with open(path, 'w', encoding=enc, newline='') as f:
        w = csv.writer(f); w.writerow(header); w.writerows(rows)


def main():
    d = tempfile.mkdtemp()
    # 새 형식(utf-8, 도로명전체주소·좌표정보x(epsg5174), 날짜 YYYYMMDD)
    new_h = ['개방서비스명', '인허가일자', '영업상태명', '폐업일자', '소재지면적', '소재지전체주소', '도로명전체주소', '사업장명', '업태구분명',
             '좌표정보x(epsg5174)', '좌표정보y(epsg5174)']
    A = '부산광역시 중구 광복로 10'; B = '부산광역시 중구 광복로 20'; C = '부산광역시 중구 광복로 30'
    rows_new = [
        ['일반음식점', '20190101', '폐업', '20250310', '33', '', A + ', 2층 (광복동2가)', '빈가게A', '한식', *xy(IN_PT)],
        ['일반음식점', '20180101', '폐업', '20240715', '40', '', B + ', 1층 (광복동2가)', '바뀐가게C', '한식', *xy(IN_PT)],
        ['일반음식점', '20240801', '영업/정상', '', '40', '', B + ', 1층 (광복동2가)', '새가게', '한식', *xy(IN_PT)],
        ['일반음식점', '20170101', '폐업', '20250101', '20', '', C + ' (광복동2가)', '층모름B', '분식', *xy(IN_PT2)],
        ['일반음식점', '20230101', '영업/정상', '', '20', '', C + ', 3층 (광복동2가)', '옆가게', '분식', *xy(IN_PT2)],
        ['일반음식점', '20250501', '폐업', '20250510', '10', '', '부산광역시 중구 비프광장로 4 (남포동6가)', '열흘부스', '기타', *xy(IN_PT)],
        ['일반음식점', '20200101', '폐업', '20220101', '10', '', '부산광역시 중구 광복로 40', '옛폐업', '한식', *xy(IN_PT)],
        ['일반음식점', '20200101', '폐업', '20250101', '10', '', '부산광역시 중구 중앙대로 1', '경계밖', '한식', *xy(OUT_PT)],
        ['일반음식점', '20200101', '폐업', '20250101', '10', '', '부산광역시 서구 충무대로 1', '다른구', '한식', *xy(IN_PT)],
        ['일반음식점', '20200101', '폐업', '20250101', '10', '', '부산광역시 중구 광복로 50', '좌표없음', '한식', '', ''],
    ]
    write(os.path.join(d, 'new.csv'), new_h, rows_new, 'utf-8')
    # 옛 형식(cp949, 도로명주소·좌표정보(X), 날짜 YYYY-MM-DD) — 대구 때 받은 파일 모양
    old_h = ['인허가일자', '영업상태명', '폐업일자', '소재지면적', '지번주소', '도로명주소', '사업장명', '업태구분명', '좌표정보(X)', '좌표정보(Y)']
    rows_old = [
        ['2015-03-01', '폐업', '2024-11-30', '25', '부산광역시 중구 남포동2가 1', '부산광역시 중구 구덕로 99, 1층 (남포동2가)', '옛카페', '커피숍', *xy(IN_PT2)],
        ['2026-05-01', '폐업', '2026-05-03', '5', '부산광역시 중구 남포동6가 1', '부산광역시 중구 비프광장로 4 (남포동6가)', 'BIFF축제부스', '기타', *xy(IN_PT)],
    ]
    write(os.path.join(d, '휴게음식점_부산중구.csv'), old_h, rows_old, 'cp949')

    out_path = os.path.join(d, 'out.csv')
    out, cnt = L.main([os.path.join(d, 'new.csv'), os.path.join(d, '휴게음식점_부산중구.csv'), '--out', out_path])
    got = {o['사업장명']: o for o in out}

    checks = [
        (set(got) == {'빈가게A', '바뀐가게C', '층모름B', '옛카페'}, f'후보 목록이 다름: {sorted(got)}'),
        (got.get('빈가게A', {}).get('빈점포등급') == 'A_빈점포가능성높음', '같은 주소 영업 없음 → A'),
        (got.get('바뀐가게C', {}).get('빈점포등급') == 'C_다시채워짐', '같은 주소·같은 층 영업 → C'),
        (got.get('층모름B', {}).get('빈점포등급') == 'B_불확실', '층 모름·같은 건물 영업 → B'),
        (got.get('옛카페', {}).get('빈점포등급') == 'A_빈점포가능성높음', '옛 형식 cp949 파일도 읽음'),
        (got.get('옛카페', {}).get('구분') == '휴게음식점_부산중구', '개방서비스명 열이 없으면 파일 이름을 구분으로'),
        (got.get('빈가게A', {}).get('구분') == '일반음식점', '개방서비스명 열을 구분으로'),
        (got.get('빈가게A', {}).get('폐업일자') == '2025-03-10', 'YYYYMMDD 날짜를 고침'),
        (got.get('빈가게A', {}).get('층') == '2', '도로명주소에서 층을 뽑음'),
        (cnt['행사제외'] == 2, f'행사 부스 2곳 제외(기간 31일 이하, 이름에 축제): {cnt["행사제외"]}'),
        (cnt['좌표없음'] == 1, '좌표 없는 행은 셈만 함'),
        (cnt['대상구'] == 11, f'다른 구는 처음부터 뺌: {cnt["대상구"]}'),
        (abs(got['빈가게A']['위도'] - IN_PT[0]) < 1e-5 and abs(got['빈가게A']['경도'] - IN_PT[1]) < 1e-5, '위경도가 원래 점으로 돌아옴'),
        (os.path.exists(out_path) and next(csv.reader(open(out_path, encoding='utf-8-sig')))[0] == '빈점포등급', 'CSV 첫 열'),
    ]
    out2, cnt2 = L.main([os.path.join(d, 'new.csv'), '--gu', '부산광역시 서구', '--out', os.path.join(d, 'out2.csv')])
    checks.append(([o['사업장명'] for o in out2] == ['다른구'] and cnt2['대상구'] == 1, f'--gu로 지역을 바꿈: {[o["사업장명"] for o in out2]}'))
    out3, cnt3 = L.main([os.path.join(d, 'new.csv'), '--gu', '부산광역시 중', '--out', os.path.join(d, 'out3.csv')])
    checks.append((cnt3['대상구'] == 0, '시·군·구 이름 앞부분만 같은 것(중 → 중구)은 고르지 않음'))
    bad = [msg for ok, msg in checks if not ok]
    for msg in bad:
        print('실패:', msg)
    if bad:
        sys.exit(1)
    print('모두 통과', len(checks))


if __name__ == '__main__':
    main()
