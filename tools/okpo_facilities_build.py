"""공공데이터포털 표준데이터 CSV(사용자가 받음)에서 옥포 지도 범위 안 횡단보도·어린이보호구역을 뽑는다.

원자료(cp949 CSV)
  - 전국횡단보도표준데이터       https://www.data.go.kr/data/15028201/standard.do  (전국 파일이 50,000행에서 잘렸지만 거제시 2,174행은 다 들어 있음)
  - 전국어린이보호구역표준데이터 https://www.data.go.kr/data/15012891/standard.do
  - 전국신호등표준데이터는 거제시 311행 중 지도 범위 안이 0건이라 쓰지 않는다(seohogyun-ea 확인)
횡단보도 처리
  - 시군구명 = 거제시, 위경도 → 지도 미터 좌표(web/data/<지역>_map.js meta)
  - 그리는 것: 그 좌표에 기록이 한 건뿐이고, 차도 가장자리에서 3m 안인 것. 가장 가까운 차도 중심선에 맞춰 길 방향을 정한다
  - 그리지 않는 것: 같은 좌표에 여러 건이 묶인 기록(최대 22건이 한 점, 교차로가 아닌 블록 가운데에도 있음 → 지번 주소로 잡은 좌표로 보임),
    차도에서 3m 넘게 떨어진 기록, 차도에 맞춘 자리가 먼저 그린 것과 2m 안에서 겹치는 기록. 이유는 CSV status 칸에 남긴다
어린이보호구역 처리
  - 시설 위치(정문 아님)·보호구역도로폭 등급만 있고 지정 범위(어느 길 몇 m)는 없다 → 바닥에 칠하지 않고 시설 정보만 넣는다
  - 거제시·경상남도가 같은 시설을 겹쳐 올린 것과 같은 좌표의 학교·병설유치원은 30m 안으로 묶어 한 곳으로(이름은 names 에 모두), 기준일이 늦은 쪽 값을 남긴다
결과
  - data/processed/<지역>_crosswalks.csv, data/processed/<지역>_school_zones.csv
  - web/data/<지역>_facilities.js   window.FACILITIES = { crosswalks, schoolZones, meta }
실행: python3 -I tools/okpo_facilities_build.py <횡단보도 CSV> <어린이보호구역 CSV> [okpo]
"""
import collections, csv, json, math, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CW_SRC, SZ_SRC = sys.argv[1], sys.argv[2]
NAME = sys.argv[3] if len(sys.argv) > 3 else 'okpo'
FOOT = {'footway', 'path', 'steps', 'pedestrian', 'cycleway', 'track'}
YN = lambda v: (v or '').strip().upper() == 'Y'


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def load_map():
    t = open(os.path.join(ROOT, 'web', 'data', f'{NAME}_map.js'), encoding='utf-8').read()
    return json.loads(t[t.index('{'):t.rindex('}') + 1])


def main():
    M = load_map(); meta = M['meta']; hx, hz = meta['half']
    xz = lambda la, lo: ((lo - meta['lon0']) * meta['kx'], -(la - meta['lat0']) * meta['kz'])
    segs = [(r['p'][i], r['p'][i + 1], r['w'], ri) for ri, r in enumerate(M['roads'])
            if not r.get('ped') and r['k'] not in FOOT for i in range(len(r['p']) - 1)]

    def snap(x, z):   # 가장 가까운 차도(가장자리 기준 거리)
        best = None
        for a, b, w, ri in segs:
            dx, dz = b[0] - a[0], b[1] - a[1]; l2 = dx * dx + dz * dz
            tt = max(0.0, min(1.0, ((x - a[0]) * dx + (z - a[1]) * dz) / l2)) if l2 else 0.0
            px, pz = a[0] + tt * dx, a[1] + tt * dz; gap = math.hypot(x - px, z - pz) - w / 2
            if best is None or gap < best[0]:
                L = math.sqrt(l2) or 1; best = (gap, px, pz, dx / L, dz / L, w, ri)
        return best

    # ── 횡단보도 ──
    rows = [r for r in csv.DictReader(open(CW_SRC, encoding='cp949', errors='replace')) if (r.get('시군구명') or '').strip() == '거제시']
    pts = []
    for r in rows:
        la, lo = num(r.get('위도')), num(r.get('경도'))
        if la is None or lo is None:
            continue
        x, z = xz(la, lo)
        if abs(x) <= hx and abs(z) <= hz:
            pts.append((round(la, 6), round(lo, 6), x, z, r))
    same = collections.Counter((la, lo) for la, lo, *_ in pts)
    cw_rows, cw = [], []
    for la, lo, x, z, r in pts:
        gap, px, pz, dx, dz, rw, ri = snap(x, z)
        rec = {'id': r.get('횡단보도관리번호', ''), 'road': r.get('도로명', ''), 'addr': r.get('소재지지번주소', ''), 'lat': la, 'lon': lo,
               'x': round(x, 1), 'z': round(z, 1), 'gap_m': round(max(0.0, gap), 1), 'same_coord': same[(la, lo)],
               'w': num(r.get('횡단보도폭')), 'len': num(r.get('횡단보도연장')), 'lanes': num(r.get('차로수')),
               'ped': YN(r.get('보행자신호등유무')), 'raised': YN(r.get('고원식적용여부')), 'tactile': YN(r.get('점자블록유무')),
               'ramp': YN(r.get('보도턱낮춤여부')), 'island': YN(r.get('교통섬유무')), 'date': r.get('데이터기준일자', '')}
        if same[(la, lo)] > 1:
            rec['status'] = f"안 그림: 같은 좌표에 {same[(la, lo)]}건(지번 주소로 잡은 좌표로 보임)"
        elif gap > 3:
            rec['status'] = '안 그림: 차도 가장자리에서 3m 넘게 떨어짐'
        elif any(math.hypot(c['x'] - px, c['z'] - pz) < 2 for c in cw):
            rec['status'] = '안 그림: 차도에 맞춘 자리가 다른 기록과 2m 안에서 겹침(한 번만 그림)'
        else:
            rec['status'] = '그림'
            cw.append({'x': round(px, 1), 'z': round(pz, 1), 'dx': round(dx, 4), 'dz': round(dz, 4), 'ri': ri, 'span': rw,
                       'w': rec['w'] or 4, 'len': rec['len'], 'lanes': rec['lanes'], 'ped': rec['ped'], 'raised': rec['raised'],
                       'tactile': rec['tactile'], 'ramp': rec['ramp'], 'id': rec['id']})
        cw_rows.append(rec)
    # ── 어린이보호구역 ──
    zs = []
    for r in csv.DictReader(open(SZ_SRC, encoding='cp949', errors='replace')):
        la, lo = num(r.get('위도')), num(r.get('경도'))
        if la is None or lo is None:
            continue
        x, z = xz(la, lo)
        if abs(x) > hx or abs(z) > hz:
            continue
        zs.append({'name': (r.get('대상시설명') or '').strip(), 'kind': r.get('시설종류', ''), 'x': round(x, 1), 'z': round(z, 1),
                   'roadW': r.get('보호구역도로폭', ''), 'designated': r.get('어린이보호구역지정여부', ''), 'cctv': r.get('CCTV설치대수', ''),
                   'org': r.get('제공기관명', ''), 'date': r.get('데이터기준일자', '')})
    uniq = []   # 위치(30m 안)로 묶는다: 기관마다 이름이 조금씩 다르고(예: 거제국제외국인학교·거제외국인학교), 학교와 병설유치원이 같은 좌표
    for z0 in sorted(zs, key=lambda v: v['date'], reverse=True):
        u = next((u for u in uniq if math.hypot(u['x'] - z0['x'], u['z'] - z0['z']) < 30), None)
        if u is None:
            uniq.append({**z0, 'names': [z0['name']]})
        elif z0['name'] not in u['names']:
            u['names'].append(z0['name'])
    # ── 쓰기 ──
    pdir = os.path.join(ROOT, 'data', 'processed'); os.makedirs(pdir, exist_ok=True)
    for fn, data in ((f'{NAME}_crosswalks.csv', cw_rows), (f'{NAME}_school_zones.csv', zs)):
        with open(os.path.join(pdir, fn), 'w', newline='', encoding='utf-8') as f:
            w = csv.DictWriter(f, fieldnames=list(data[0].keys())); w.writeheader(); w.writerows(data)
    st = collections.Counter(r['status'].split(':')[0] + (':' + r['status'].split(':')[1].split('(')[0].split('에 ')[0] if ':' in r['status'] else '') for r in cw_rows)
    fac = {'crosswalks': cw, 'schoolZones': uniq,
           'meta': {'crosswalks': {'src': '전국횡단보도표준데이터(공공데이터포털, 경상남도 거제시 제공)', 'date': max(r['date'] for r in cw_rows),
                                   'inMap': len(cw_rows), 'n': len(cw), 'skippedSameCoord': sum(1 for r in cw_rows if r['same_coord'] > 1),
                                   'skippedFar': sum(1 for r in cw_rows if '3m 넘게' in r['status']), 'skippedOverlap': sum(1 for r in cw_rows if '2m 안에서 겹침' in r['status'])},
                    'schoolZones': {'src': '전국어린이보호구역표준데이터(공공데이터포털)', 'date': max(z['date'] for z in uniq) if uniq else '',
                                    'n': len(uniq), 'rows': len(zs), 'note': '시설 위치만 있고 지정 범위가 없어 바닥에 칠하지 않음'}}}
    with open(os.path.join(ROOT, 'web', 'data', f'{NAME}_facilities.js'), 'w', encoding='utf-8') as f:
        f.write('/* 자동 생성: tools/okpo_facilities_build.py. 공공데이터포털 표준데이터(횡단보도·어린이보호구역), 손으로 고치지 말 것 */\nwindow.FACILITIES = ')
        json.dump(fac, f, ensure_ascii=False, separators=(',', ':')); f.write(';\n')
    m = fac['meta']
    print('횡단보도: 거제시', len(rows), '지도 안', m['crosswalks']['inMap'], '그림', m['crosswalks']['n'], '안 그림(같은 좌표)', m['crosswalks']['skippedSameCoord'],
          '안 그림(3m 넘음)', m['crosswalks']['skippedFar'], '안 그림(겹침)', m['crosswalks']['skippedOverlap'], '기준일', m['crosswalks']['date'],
          '| 보행신호', sum(c['ped'] for c in cw), '점자블록', sum(c['tactile'] for c in cw), '보도턱낮춤', sum(c['ramp'] for c in cw), '고원식', sum(c['raised'] for c in cw))
    print('어린이보호구역: 지도 안 행', len(zs), '곳', len(uniq), [('·'.join(u['names']), u['x'], u['z'], u['roadW'], u['date']) for u in uniq])


if __name__ == '__main__':
    main()
