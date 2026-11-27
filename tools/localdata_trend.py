"""상권 경계 안 음식점·카페 인허가 기록으로 연도별 개업·폐업 수와 거리별 폐업 수를 센다.
입력: tools/localdata_fetch_api.py로 받은 CSV(일반·휴게음식점), 상권 경계 GeoJSON
출력: data/processed/<이름>_food_trend.csv(연도별), data/processed/<이름>_food_street.csv(거리별)
실행: python3 -I tools/localdata_trend.py data/raw/localdata/*_5370000.csv --boundary data/processed/okpo_rone_boundary.geojson --name okpo
행사 부스(이름·주소에 축제·행사 등, 또는 인허가~폐업 31일 이하)는 뺀다(localdata_closed.py와 같은 규칙).
"""
import argparse, collections, csv, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from localdata_epsg5174 import to_wgs
import localdata_closed as L

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STREETS = ['옥포대첩로', '옥포성안로', '옥포로']  # 앞에서부터 맞춘다(옥포로6길 등 '길'은 따로 묶음)


def street_of(road):
    m = re.search(r'거제시\s+(\S+?)(?:\s|,|$)', road or '')
    name = m.group(1) if m else ''
    for s in STREETS:
        if name == s:
            return s
        if name.startswith(s) and re.match(r'\d+길$', name[len(s):]):
            return s + ' 뒷길(○길)'
    return name or '(도로명 없음)'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('files', nargs='+')
    ap.add_argument('--boundary', required=True)
    ap.add_argument('--name', required=True)
    ap.add_argument('--gu', default='경상남도 거제시')
    a = ap.parse_args()
    ring = L.load_ring(a.boundary)
    opened, closed, kinds = collections.Counter(), collections.Counter(), collections.Counter()
    by_street = collections.defaultdict(collections.Counter)
    alive_now = 0
    for path in a.files:
        with L.open_text(path) as f:
            rd = csv.DictReader(f); m = L.colmap(rd.fieldnames)
            kind = os.path.basename(path).split('_')[0]
            for r in rd:
                if not L.in_gu(r, m, [a.gu]):
                    continue
                x, y = (r[m['x']] or '').strip(), (r[m['y']] or '').strip()
                if not x or not y:
                    continue
                lat, lon = to_wgs(x, y)
                if not L.inside(ring, lat, lon):
                    continue
                road = r.get(m.get('road'), '') or ''
                lic, clo = L.norm_date(r.get(m.get('licensed'), '')), L.norm_date(r[m['closed']])
                d = L.days(lic, clo) if lic and clo else None
                if L.EVENT.search(road + (r[m['name']] or '')) or (d is not None and d <= 31):
                    continue
                st = (r[m['status']] or '').strip()
                if lic:
                    opened[lic[:4]] += 1
                if st == '폐업' and clo:
                    closed[clo[:4]] += 1
                    if clo >= '2024-01-01':
                        by_street[street_of(road)]['폐업_2024이후'] += 1
                if st in L.OPEN:
                    alive_now += 1; by_street[street_of(road)]['지금_영업'] += 1
                kinds[kind] += 1
    years = sorted(set(opened) | set(closed))
    out1 = os.path.join(ROOT, 'data/processed', f'{a.name}_food_trend.csv')
    with open(out1, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f); w.writerow(['연도', '개업(인허가)', '폐업', '순증감'])
        for y in years:
            w.writerow([y, opened[y], closed[y], opened[y] - closed[y]])
    out2 = os.path.join(ROOT, 'data/processed', f'{a.name}_food_street.csv')
    with open(out2, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.writer(f); w.writerow(['거리', '지금_영업', '폐업_2024이후', '폐업/(영업+폐업)'])
        for s, c in sorted(by_street.items(), key=lambda kv: -(kv[1]['지금_영업'] + kv[1]['폐업_2024이후'])):
            tot = c['지금_영업'] + c['폐업_2024이후']
            w.writerow([s, c['지금_영업'], c['폐업_2024이후'], f"{c['폐업_2024이후'] / tot:.2f}" if tot else ''])
    print('경계 안(행사 제외)', dict(kinds), '지금 영업', alive_now)
    print('최근 연도', [(y, opened[y], closed[y]) for y in years if y >= '2015'])
    print(os.path.relpath(out1, ROOT), os.path.relpath(out2, ROOT))


if __name__ == '__main__':
    main()
