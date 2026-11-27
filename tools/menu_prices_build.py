"""옥포 세부 업종별 대표 메뉴 가격표를 만든다 → data/processed/okpo_menu_prices.csv
열: 세부업종,메뉴,단위,가격_원,범위,지역,기준시점,출처,확인여부

가격 우선순위: ① 거제시 「개인서비스품목 가격동향」의 옥포1·2동 실제 업소 가격 → ② 한국소비자원 참가격 경남 → ③ 기사·메뉴판(data/processed/okpo_menu_prices_extra.csv, 손으로 채움)
① 행의 가격_원 = 옥포1동·옥포2동 값의 평균(한쪽만 있으면 그 값). 범위에 두 동의 업소·가격과 거제 8개 동 최소~최대를 적는다.
실행: python3 -I tools/menu_prices_build.py data/raw/geoje_price/geoje_price_20261126.xlsx
"""
import csv, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from geoje_price_parse import parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'data/processed/okpo_menu_prices.csv')
EXTRA = os.path.join(ROOT, 'data/processed/okpo_menu_prices_extra.csv')
COLS = ['세부업종', '메뉴', '단위', '가격_원', '범위', '지역', '기준시점', '출처', '확인여부']
GEOJE_SRC = '거제시 민생경제과 「거제시 개인서비스품목 가격동향」 첨부 xlsx(거제시청 장바구니 물가정보 게시판) https://www.geoje.go.kr/board/view.geoje?boardId=BBS_0000065&menuCd=DOM_000008901003002002&paging=ok&startPage=1&dataSid=306515765'

# (세부업종, 엑셀 품목명, 메뉴 이름, 단위)
MAP = [
    ('백반·한식', '김치찌개백반', '김치찌개백반', '1인분'),
    ('백반·한식', '된장찌개백반', '된장찌개백반', '1인분'),
    ('백반·한식', '비빔밥', '비빔밥', '1인분'),
    ('백반·한식', '칼국수', '칼국수', '1인분'),
    ('백반·한식', '냉면', '냉면', '1인분'),
    ('백반·한식', '갈비탕', '갈비탕', '1인분'),
    ('백반·한식', '삼계탕', '삼계탕', '1인분'),
    ('고깃집', '삼겹살(외식)', '삼겹살', '1인분 200g 정도'),
    ('고깃집', '돼지갈비(외식)', '돼지갈비', '1인분 200g 정도'),
    ('고깃집', '쇠고기(외식)', '쇠고기 등심', '1인분 200g 정도'),
    ('고깃집', '소주(외식)', '소주', '1병 360ml'),
    ('고깃집', '맥주(외식)', '병맥주', '1병 500ml'),
    ('중식', '자장면', '자장면', '1인분'),
    ('중식', '짬뽕', '짬뽕', '1인분'),
    ('중식', '탕수육', '탕수육', '소(小) 1접시'),
    ('분식', '김밥', '김밥', '기본 1줄'),
    ('분식', '라면(외식)', '라면', '1인분'),
    ('치킨', '치킨', '치킨', '1마리(배달업소 기준)'),
    ('치킨', '맥주(외식)', '병맥주', '1병 500ml'),
    ('경양식·피자·버거', '돈가스', '돈가스', '1인분'),
    ('경양식·피자·버거', '피자', '피자', '1판(배달업소 기준, 크기 표기 없음)'),
    ('경양식·피자·버거', '햄버거(외식)', '햄버거', '1인분(세트 여부 표기 없음)'),
    ('호프·요리주점', '소주(외식)', '소주', '1병 360ml'),
    ('호프·요리주점', '맥주(외식)', '병맥주', '1병 500ml'),
    ('카페', '커피(외식)', '커피', '1잔(종류 표기 없음)'),
    ('미용실', '이용료', '커트', '성인 1회'),
    ('미용실', '미용료', '파마', '성인 1회'),
    ('목욕탕', '목욕료', '목욕료', '성인 1회'),
    ('숙박', '모텔숙박료', '모텔 숙박', '1박'),
]
# 한국소비자원 참가격 지역별 외식비(행안부·국가데이터처, 잠정치), 경남 2026년 10월 — 세션 20 확인
CHAMGA = [('백반·한식', '김치찌개백반', 8885), ('고깃집', '삼겹살(200g 환산)', 20067), ('백반·한식', '냉면', 10808),
          ('백반·한식', '비빔밥', 9231), ('백반·한식', '칼국수', 8154), ('중식', '자장면', 6962), ('백반·한식', '삼계탕', 17231), ('분식', '김밥', 3731)]
CHAMGA_SRC = '한국소비자원 참가격 지역별 외식비(잠정치) https://www.price.go.kr/tprice/portal/servicepriceinfo/dineoutprice/dineOutPriceList.do — 원문 주의: 시도 간 비교가 적절하지 않을 수 있음'
# 거제 자료에 없는 메뉴: 행만 만들어 두고 extra 파일로 채운다
TODO = [('고깃집', '공깃밥', '1공기'), ('횟집·해산물', '광어회', '소'), ('횟집·해산물', '광어회', '중'), ('횟집·해산물', '매운탕', '1냄비'),
        ('횟집·해산물', '해물탕', '1냄비'), ('분식', '떡볶이', '1인분'), ('치킨', '생맥주', '500cc'), ('호프·요리주점', '생맥주', '500cc'),
        ('호프·요리주점', '대표 안주', '1접시'), ('유흥주점', '카드 결제 건당 금액', '1건'), ('노래방', '노래방 이용료', '1시간'),
        ('카페', '카페라떼', '1잔'), ('빵·떡', '빵', '1개'), ('베트남 음식', '쌀국수', '1인분'), ('베트남 음식', '분짜 또는 반미', '1인분'),
        ('할랄·중앙아시아', '나시고랭 또는 플로프', '1인분'), ('편의점', '도시락', '1개'), ('편의점', '컵라면', '1개'), ('편의점', '음료', '1병'),
        ('슈퍼·식료품', '카드 결제 건당 금액', '1건'), ('세탁소', '양복 드라이', '상하 1벌'), ('휴대폰', '카드 결제 건당 금액', '1건')]


def main():
    g = parse(sys.argv[1]); date = g['date']; rows = []
    for cat, item, menu, unit in MAP:
        v = g['items'].get(item)
        if not v:
            rows.append(dict(세부업종=cat, 메뉴=menu, 단위=unit, 가격_원='', 범위='', 지역='옥포', 기준시점=date, 출처=GEOJE_SRC, 확인여부='미확인(엑셀에 품목 없음)')); continue
        d = v['dong']; o1, o2 = d['옥포1동'], d['옥포2동']
        ps = [x['price'] for x in d.values() if x['price']]
        ok = [x['price'] for x in (o1, o2) if x['price']]
        price = round(sum(ok) / len(ok)) if ok else ''
        rng = (f"옥포1동 {o1['price'] or '-'}({o1['store']}) · 옥포2동 {o2['price'] or '-'}({o2['store']}) · "
               f"거제 {len(ps)}개 동 {min(ps)}~{max(ps)}")
        rows.append(dict(세부업종=cat, 메뉴=menu, 단위=unit, 가격_원=price, 범위=rng, 지역='옥포1·2동 평균(동마다 업소 1곳)',
                         기준시점=date, 출처=GEOJE_SRC, 확인여부='확인'))
    for cat, menu, p in CHAMGA:
        rows.append(dict(세부업종=cat, 메뉴=menu, 단위='1인분', 가격_원=p, 범위='', 지역='경남 평균(비교용)', 기준시점='2026-10',
                         출처=CHAMGA_SRC, 확인여부='확인(비교용)'))
    extra = {}
    if os.path.exists(EXTRA):
        for r in csv.DictReader(open(EXTRA, encoding='utf-8-sig')):
            extra.setdefault((r['세부업종'], r['메뉴'], r['단위']), []).append(r)
    for cat, menu, unit in TODO:
        got = extra.pop((cat, menu, unit), None)
        if got:
            rows += [{k: r.get(k, '') for k in COLS} for r in got]
        else:
            rows.append(dict(세부업종=cat, 메뉴=menu, 단위=unit, 가격_원='', 범위='', 지역='', 기준시점='', 출처='', 확인여부='미확인'))
    for rs in extra.values():  # TODO에 없는 추가 행도 그대로 넣는다
        rows += [{k: r.get(k, '') for k in COLS} for r in rs]
    with open(OUT, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=COLS); w.writeheader(); w.writerows(rows)
    n = lambda s: sum(1 for r in rows if r['확인여부'].startswith(s))
    print(f'{os.path.relpath(OUT, ROOT)}: {len(rows)}행 (확인 {n("확인")}, 미확인 {n("미확인")})')


if __name__ == '__main__':
    main()
