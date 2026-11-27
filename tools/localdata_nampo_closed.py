"""남포동 상권 경계 안의 인허가 폐업 기록으로 빈 점포 후보를 뽑고 등급을 매긴다.
대구 동성로 작업(extract_closed.py + merge_candidates.py)을 부산 남포동용으로 옮겼다.

입력
  - 행정안전부 지방행정 인허가 CSV 여러 개(일반음식점·휴게음식점 등). 전국 파일이든 지역 파일이든 된다.
    cp949·utf-8 모두 읽는다. 옛 열 이름(도로명주소·좌표정보(X))과 새 열 이름(도로명전체주소·좌표정보x(epsg5174)) 모두 받는다.
  - 남포동 상권 경계: data/processed/nampo_rone_boundary.geojson (R-ONE 상권구획도에서 추적한 근사 경계)
  - 선택: --shops 소상공인시장진흥공단 상가(상권)정보 부산 CSV. 지금 영업 중인 가게와 맞춰 보는 데 쓴다.
출력: data/processed/nampo_closed_candidates.csv
실행: python3 -I tools/localdata_nampo_closed.py data/raw/localdata/*.csv [--since 2024-01-01] [--shops 파일] [--out 파일]

등급(대구와 같은 기준)
  A_빈점포가능성높음 : 같은 주소에 지금 영업 중인 가게가 하나도 없다
  B_불확실           : 같은 건물에 영업 가게가 있으나 층을 모른다
  C_다시채워짐       : 같은 주소·같은 층에 영업 가게가 있다
행사 부스는 뺀다: 이름·주소에 축제·행사 같은 말이 있거나, 인허가부터 폐업까지 31일 이하인 곳.
"""
import argparse, collections, csv, datetime, io, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from localdata_epsg5174 import to_wgs

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BOUNDARY = os.path.join(ROOT, 'data/processed/nampo_rone_boundary.geojson')
GU = '부산광역시 중구'

ALIAS = {
    'status': ['영업상태명'],
    'closed': ['폐업일자'],
    'licensed': ['인허가일자'],
    'name': ['사업장명'],
    'biz': ['업태구분명'],
    'area': ['소재지면적'],
    'road': ['도로명전체주소', '도로명주소'],
    'jibun': ['소재지전체주소', '지번주소'],
    'x': ['좌표정보x(epsg5174)', '좌표정보X(EPSG5174)', '좌표정보(X)', '좌표정보(x)', '좌표정보x'],
    'y': ['좌표정보y(epsg5174)', '좌표정보Y(EPSG5174)', '좌표정보(Y)', '좌표정보(y)', '좌표정보y'],
    'service': ['개방서비스명'],
}
EVENT = re.compile(r'일원|축제|행사|페스티벌|페스타|박람회|야시장|임시')
OPEN = ('영업/정상', '영업', '정상')
RANK = {'이 주소에 영업 가게 없음': 'A_빈점포가능성높음',
        '같은 건물 다른 가게 영업 중(층 불명)': 'B_불확실',
        '같은 층 영업 중': 'C_다시채워짐'}
FIELDS = ['빈점포등급', '구분', '사업장명', '업태', '인허가일자', '폐업일자', '도로명주소', '지번주소', '층', '면적_m2',
          '위도', '경도', '현재상태_추정', '원본파일']


def open_text(path):
    """앞부분으로 인코딩을 정해 한 줄씩 읽는 파일을 돌려준다(전국 파일은 200만 행이 넘는다)."""
    head = open(path, 'rb').read(1 << 16)
    head = head[:head.rfind(b'\n') + 1] or head
    try:
        head.decode('utf-8-sig'); enc = 'utf-8-sig'
    except UnicodeDecodeError:
        enc = 'cp949'
    return io.open(path, encoding=enc, errors='replace', newline='')


def colmap(header):
    m = {}
    for k, names in ALIAS.items():
        for n in names:
            if n in header:
                m[k] = n; break
    miss = [k for k in ('status', 'closed', 'name', 'x', 'y') if k not in m]
    if miss:
        raise SystemExit(f'필요한 열이 없다: {miss}. 열 목록: {header[:40]}')
    return m


def norm_date(s):
    s = (s or '').strip().replace('.', '-').replace('/', '-')
    if re.fullmatch(r'\d{8}', s):
        s = f'{s[:4]}-{s[4:6]}-{s[6:]}'
    return s[:10]


def days(a, b):
    try:
        return (datetime.date.fromisoformat(b) - datetime.date.fromisoformat(a)).days
    except ValueError:
        return None


def base(addr):
    return re.sub(r'\s+', ' ', (addr or '').split('(')[0].split(',')[0]).strip()


def floor(addr):
    m = re.search(r'(지하\s*)?(\d+(?:,\d+)*)\s*층', addr or '')
    return (('B' if m.group(1) else '') + m.group(2)) if m else ''


def load_ring(path):
    g = json.load(open(path, encoding='utf-8'))
    geom = g['geometry'] if g.get('type') == 'Feature' else g
    return geom['coordinates'][0]  # [[경도, 위도], ...]


def inside(ring, lat, lon):
    c = False
    for i in range(len(ring)):
        (x1, y1), (x2, y2) = ring[i], ring[i - 1]
        if (y1 > lat) != (y2 > lat) and lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1:
            c = not c
    return c


def in_gu(r, m):
    return any(re.sub(r'\s+', ' ', r.get(m[k], '') or '').startswith(GU) for k in ('road', 'jibun') if k in m)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('files', nargs='+')
    ap.add_argument('--since', default='2024-01-01')
    ap.add_argument('--shops')
    ap.add_argument('--boundary', default=BOUNDARY)
    ap.add_argument('--out', default=os.path.join(ROOT, 'data/processed/nampo_closed_candidates.csv'))
    a = ap.parse_args(argv)
    ring = load_ring(a.boundary)

    rows, openset, cnt = [], collections.defaultdict(set), collections.Counter()
    for path in a.files:
        with open_text(path) as f:
            rd = csv.DictReader(f); m = colmap(rd.fieldnames)
            for r in rd:
                cnt['전체'] += 1
                if not in_gu(r, m):
                    continue
                cnt['부산중구'] += 1
                road, jibun = r.get(m.get('road'), '') or '', r.get(m.get('jibun'), '') or ''
                st = (r[m['status']] or '').strip()
                if st in OPEN:
                    openset[base(road or jibun)].add(floor(road))
                rows.append((path, m, r, st, road, jibun))
    if a.shops:
        with open_text(a.shops) as f:
            for r in csv.DictReader(f):
                if r.get('시도명') == '부산광역시' and r.get('시군구명') == '중구':
                    openset[base(r.get('도로명주소', ''))].add(r.get('층정보', ''))

    out = []
    for path, m, r, st, road, jibun in rows:
        x, y = (r[m['x']] or '').strip(), (r[m['y']] or '').strip()
        if not x or not y:
            cnt['좌표없음'] += 1; continue
        lat, lon = to_wgs(x, y)
        if not inside(ring, lat, lon):
            continue
        cnt['경계안_' + st] += 1
        closed, lic = norm_date(r[m['closed']]), norm_date(r.get(m.get('licensed'), ''))
        if st != '폐업' or not closed or closed < a.since:
            continue
        name = r[m['name']] or ''
        d = days(lic, closed) if lic else None
        if EVENT.search(road + name) or (d is not None and d <= 31):
            cnt['행사제외'] += 1; continue
        fl = floor(road); now = openset.get(base(road or jibun), set())
        fls = set(fl.split(',')) if fl else set()
        nowfl = {p for n in now for p in str(n).split(',') if p}
        state = '같은 층 영업 중' if fls and fls & nowfl else ('같은 건물 다른 가게 영업 중(층 불명)' if now else '이 주소에 영업 가게 없음')
        kind = (r.get(m.get('service'), '') or '').strip() or os.path.splitext(os.path.basename(path))[0]
        out.append({'빈점포등급': RANK[state], '구분': kind, '사업장명': name, '업태': r.get(m.get('biz'), '') or '',
                    '인허가일자': lic, '폐업일자': closed, '도로명주소': road, '지번주소': jibun.strip(), '층': fl,
                    '면적_m2': r.get(m.get('area'), '') or '', '위도': round(lat, 6), '경도': round(lon, 6),
                    '현재상태_추정': state, '원본파일': os.path.basename(path)})
    out.sort(key=lambda o: (o['빈점포등급'], o['폐업일자']))
    os.makedirs(os.path.dirname(a.out) or '.', exist_ok=True)
    with open(a.out, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=FIELDS); w.writeheader(); w.writerows(out)
    print(dict(sorted(cnt.items())))
    print(f'{a.since} 이후 폐업 후보', len(out), dict(collections.Counter(o['빈점포등급'] for o in out)))
    print('연도', dict(sorted(collections.Counter(o['폐업일자'][:4] for o in out).items())))
    return out, cnt


if __name__ == '__main__':
    main()
