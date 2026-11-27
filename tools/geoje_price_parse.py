"""거제시 「개인서비스품목 가격동향」 엑셀(거제시청 장바구니 물가정보 게시판 첨부)에서 동별 외식·서비스 가격을 뽑는다.
표 모양: 품목 줄(A:품목, B:업소명, C~J:동별 업소) → 가격 줄(A:(규격), B:가격, C~J:값) → 세부규격 줄.
동 열: C 고현동, D 장평동, E 옥포1동, F 장승포동, G 거제면, H 수양동, I 옥포2동, J 상문동. 동마다 업소 1곳이다.
실행: python3 -I tools/geoje_price_parse.py data/raw/geoje_price/geoje_price_20261126.xlsx > 결과.json  (표준 라이브러리만 씀)
"""
import json, re, sys, zipfile
import xml.etree.ElementTree as ET

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
DONG = {'C': '고현동', 'D': '장평동', 'E': '옥포1동', 'F': '장승포동', 'G': '거제면', 'H': '수양동', 'I': '옥포2동', 'J': '상문동'}


def rows_of(path):
    z = zipfile.ZipFile(path)
    ss = []
    if 'xl/sharedStrings.xml' in z.namelist():
        for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS):
            ss.append(''.join(t.text or '' for t in si.iter('{%s}t' % NS['m'])))
    sheets = sorted(n for n in z.namelist() if re.match(r'xl/worksheets/sheet\d+\.xml$', n))
    for sh in sheets:
        for r in ET.fromstring(z.read(sh)).iter('{%s}row' % NS['m']):
            row = {}
            for c in r.findall('m:c', NS):
                col = re.match(r'[A-Z]+', c.get('r')).group(0)
                v = c.find('m:v', NS)
                if v is None:
                    is_ = c.find('m:is', NS)
                    val = ''.join(t.text or '' for t in is_.iter('{%s}t' % NS['m'])) if is_ is not None else ''
                elif c.get('t') == 's':
                    val = ss[int(v.text)]
                else:
                    val = v.text
                row[col] = (val or '').strip()
            yield row


def parse(path):
    rows = list(rows_of(path)); out = {}; date = ''
    start = next(i for i, r in enumerate(rows) if '개인서비스' in r.get('A', ''))
    m = re.search(r'(\d{4})년\s*(\d+)월\s*(\d+)일', rows[start]['A'])
    if m:
        date = f'{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}'
    i = start + 1
    while i < len(rows) - 1:
        r, nx = rows[i], rows[i + 1]
        if re.sub(r'\s', '', r.get('B', '')) == '업소명' and re.sub(r'\s', '', nx.get('B', '')) == '가격':
            item = re.sub(r'\s+', '', r['A']); spec = nx.get('A', '').strip('() ')
            d = {}
            for col, dong in DONG.items():
                v = nx.get(col, '')
                try:
                    p = int(float(v))
                except ValueError:
                    p = 0
                d[dong] = {'store': r.get(col, ''), 'price': p if p > 0 else None}
            out[item] = {'spec': spec, 'dong': d}
            i += 2
        i += 1
    return {'date': date, 'items': out}


if __name__ == '__main__':
    print(json.dumps(parse(sys.argv[1]), ensure_ascii=False, indent=1))
