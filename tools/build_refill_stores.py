"""부산시 「1만원 임대료 빈 점포 다시채움 프로젝트」 1·2차 점포 목록을 CSV로 옮긴다.
입력(원본 그대로 보관): data/raw/busan_refill/20261127/
  - 1차_임차인모집공고.hwp  : 공고 제2026-188호 [붙임2] 프로젝트 점포 리스트(30개소)
  - 2차_민생100_페이지.html : busan.go.kr/minsaeng100/sub0202 「프로젝트 점포 리스트(46개소)」
출력: data/processed/refill_stores.csv  (보증금·월임대료 단위: 만원)
실행: pip install olefile  →  python3 -I tools/build_refill_stores.py
"""
import csv, html, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from refill_hwp2txt import text as hwp_text

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, 'data/raw/busan_refill/20261127')
OUT = os.path.join(ROOT, 'data/processed/refill_stores.csv')
URL1 = 'https://www.busan.go.kr/wcc/wcnotice/1753958 (첨부 hwp 붙임2)'
URL2 = 'https://www.busan.go.kr/minsaeng100/sub0202'
FLOOR = '미기재'
FLOOR_NOTE = '층은 표에 없음. 보도자료(2026-09-11) 사업 조건은 "1층 입지, 월 임대료 2백만원 이하"'


def lines_of(s):
    return [l.strip() for l in s.split('\n') if l.strip()]


def area(s):
    m = re.match(r'^([\d.]+)\s*㎡', s)
    return m and m.group(1)


def round1():
    L = lines_of(hwp_text(os.path.join(RAW, '1차_임차인모집공고.hwp')))
    i = max(k for k, l in enumerate(L) if '사업 점포 30개소' in l)
    rows, zone, n, prev_addr = [], '', 0, ''
    while i < len(L):
        l = L[i]
        if l.startswith('※ 상기'):
            break
        if l.startswith('☆'):
            zone = re.sub(r'\s*\(\d+개소\).*', '', l.lstrip('☆ ').strip()); i += 1; continue
        if l == str(n + 1):
            n += 1; j = i + 1; addr = []
            while not area(L[j]):
                addr.append(L[j]); j += 1
            note = []
            if not addr:
                addr = [prev_addr]; note.append('원문 주소 칸이 윗줄과 병합돼 있어 윗줄 주소를 씀(2차 목록에서 같은 주소 확인)')
            extra = [a for a in addr[1:] if not a.startswith('(서동')]
            note += extra
            a1 = addr[0] + ''.join(' ' + a for a in addr[1:] if a.startswith('(서동'))
            prev_addr = addr[0]
            rows.append({'차수': '1차', '상권': zone, '점포명또는번호': str(n), '주소': a1, '층': FLOOR,
                         '면적_㎡': area(L[j]), '前업종': L[j + 1],
                         '보증금': int(L[j + 2].replace(',', '')) // 10, '월임대료': int(L[j + 3].replace(',', '')) // 10,
                         '비고': note, '출처링크': URL1})
            i = j + 4; continue
        i += 1
    return rows


def round2():
    t = open(os.path.join(RAW, '2차_민생100_페이지.html'), encoding='utf-8').read()
    t = re.sub(r'<script.*?</script>|<style.*?</style>', '', t, flags=re.S)
    L = lines_of(html.unescape(re.sub(r'<[^>]+>', '\n', t)))
    i = L.index('프로젝트 점포 리스트(46개소)')
    rows, zone, n = [], '', 0
    while i < len(L) and not L[i].startswith('자주묻는'):
        l = L[i]
        m = re.match(r'^(.*?)\s*:\s*번호, 주소', l)
        if m:
            zone = re.sub(r'\s*\(\d+개소\).*', '', m.group(1)).replace('금정구 ', ''); i += 1; continue
        if l == str(n + 1) and zone:
            n += 1; j = i + 1; addr = []
            while not area(L[j]):
                addr.append(L[j]); j += 1
            note = [a for a in addr[1:] if a.startswith('*')]
            a1 = ' '.join(a for a in addr if not a.startswith('*'))
            dep, rent = re.match(r'([\d,]+)만원\s*/\s*([\d,]+)만원', L[j + 2]).groups()
            rows.append({'차수': '2차', '상권': zone, '점포명또는번호': str(n), '주소': a1, '층': FLOOR,
                         '면적_㎡': area(L[j]), '前업종': L[j + 1],
                         '보증금': int(dep.replace(',', '')), '월임대료': int(rent.replace(',', '')),
                         '비고': note, '출처링크': URL2})
            i = j + 3; continue
        i += 1
    return rows


ZONE = {'금정구 서동미로시장': '서동미로시장', '하단자율상권': '하단 자율상권', '유엔남구대학로 자율상권': '유엔남구대학로 자율상권'}


def key(r):
    return (re.sub(r'[\s,]|\(.*?\)', '', r['주소']), r['면적_㎡'])


def main():
    r1, r2 = round1(), round2()
    for r in r1 + r2:
        r['상권'] = ZONE.get(r['상권'], r['상권'])
    assert len(r1) == 30 and len(r2) == 46, (len(r1), len(r2))
    # 주소·면적이 같은 점포가 여러 칸일 수 있어 한 칸씩 짝을 짓는다(1차 봉래시장 19·20번).
    left = [key(r) for r in r2]; again = 0
    for r in r1:
        if key(r) in left:
            left.remove(key(r)); again += 1; r['비고'].append('2차 목록에 다시 나옴(1차에 채워지지 않은 것으로 보임)')
        else:
            r['비고'].append('2차 목록에 없음(입점·철회 여부 미확인)')
    left1 = [key(r) for r in r1]
    for r in r2:
        if key(r) in left1:
            left1.remove(key(r))
        else:
            r['비고'].append('2차에 새로 나온 점포')
    cols = ['차수', '상권', '점포명또는번호', '주소', '층', '면적_㎡', '보증금', '월임대료', '비고', '출처링크']
    with open(OUT, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction='ignore'); w.writeheader()
        for r in r1 + r2:
            r = dict(r); r['비고'] = ' / '.join(['前업종 ' + r['前업종']] + r['비고'] + [FLOOR_NOTE])
            w.writerow(r)
    print('1차', len(r1), '2차', len(r2), '1차 중 2차에 다시 나온 점포', again, '빠진 점포', len(r1) - again)


if __name__ == '__main__':
    main()
