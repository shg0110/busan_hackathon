"""도로 폭·차로 수 보정: 공공데이터포털 '전국횡단보도표준데이터'(data/processed/<지역>_crosswalks.csv, tools/okpo_facilities_build.py)의
도로명별 '횡단보도연장'(길을 건너는 길이 ≈ 차도 폭)과 '차로수'로, OSM 등급별 기본값(tertiary 는 모두 12m)이던 큰길 폭을 바꾼다.

규칙
  - 대상: tertiary 이상 큰길 중 이름이 같은 횡단보도 기록이 3건 이상인 것
  - 폭 = 그 도로명 기록의 연장 중앙값(6~22m 로 제한). 차로 수 = OSM lanes 가 없을 때만 기록의 최빈값
  - OSM lanes 가 적힌 가닥은 폭을 차로 수 × 3m 아래로 줄이지 않는다(그 가닥의 실제 차로 수가 들어가게)
  - 중앙분리 도로(같은 이름의 일방 가닥이 둘 이상, 예: 거제대로): 횡단보도가 두 가닥을 함께 건넌다고 보고 폭·차로 수를 반으로(폭 최소 6m)
    — 기록에 가닥 구분이 없어 내린 판단이다. 두 가닥 가운데선 사이가 6~15m 인 것과 맞는다
  - 결과는 okpo_map.js 를 바꾸지 않고 web/data/<지역>_roadcal.js 로 따로 둔다. web/roadcal.js 가 불러온 직후 MAP_DATA 에 덮어쓴다(?roadcal=0 이면 안 씀)
실행: python3 -I tools/road_calibrate.py okpo
"""
import collections, csv, json, os, statistics, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAME = sys.argv[1] if len(sys.argv) > 1 else 'okpo'
MAJOR = {'trunk', 'primary', 'secondary', 'tertiary'}


def main():
    t = open(os.path.join(ROOT, 'web', 'data', f'{NAME}_map.js'), encoding='utf-8').read()
    M = json.loads(t[t.index('{'):t.rindex('}') + 1])
    rec = collections.defaultdict(list)
    for r in csv.DictReader(open(os.path.join(ROOT, 'data', 'processed', f'{NAME}_crosswalks.csv'), encoding='utf-8')):
        try:
            rec[r['road'].strip()].append((float(r['len']), int(float(r['lanes']))))
        except (ValueError, KeyError):
            pass
    oneway_n = collections.Counter(r.get('n') for r in M['roads'] if r['k'] in MAJOR and r.get('ow'))
    out, rows = {}, []
    for i, r in enumerate(M['roads']):
        nm = r.get('n') or ''
        if r['k'] not in MAJOR or len(rec.get(nm, [])) < 3:
            continue
        lens = [l for l, _ in rec[nm] if l > 0]; lanes = [n for _, n in rec[nm] if n > 0]
        if not lens:
            continue
        w = statistics.median(lens); ln = collections.Counter(lanes).most_common(1)[0][0] if lanes else 0
        twin = bool(r.get('ow')) and oneway_n[nm] >= 2
        if twin:
            w, ln = w / 2, max(1, round(ln / 2))
        new_ln = r.get('ln') or ln
        if r.get('ln'):   # OSM lanes 가 적힌 가닥은 그 차로 수가 들어갈 폭(차로당 3m) 아래로 줄이지 않는다
            w = max(w, r['ln'] * 3.0)
        w = round(max(6.0, min(22.0, w)), 1)
        out[i] = [w, new_ln]
        rows.append((nm, r['w'], w, r.get('ln') or 0, new_ln, twin, len(rec[nm])))
    res = {'src': '전국횡단보도표준데이터(공공데이터포털, 거제시 2026-07-20) 도로명별 횡단보도연장 중앙값·차로수 최빈값, tools/road_calibrate.py',
           'roads': out}
    dst = os.path.join(ROOT, 'web', 'data', f'{NAME}_roadcal.js')
    with open(dst, 'w', encoding='utf-8') as f:
        f.write('/* 자동 생성: tools/road_calibrate.py. 손으로 고치지 말 것 */\nwindow.ROADCAL = '); json.dump(res, f, ensure_ascii=False, separators=(',', ':')); f.write(';\n')
    summ = collections.OrderedDict()
    for nm, w0, w, l0, l1, twin, n in rows:
        summ.setdefault((nm, w0, w, l0, l1, twin, n), 0); summ[(nm, w0, w, l0, l1, twin, n)] += 1
    for (nm, w0, w, l0, l1, twin, n), k in summ.items():
        print(f'{nm}: 가닥 {k}, 폭 {w0}→{w}m, 차로 {l0}→{l1}{" (분리 도로, 반으로)" if twin else ""}, 기록 {n}건')
    print('보정한 큰길 가닥', len(out), '/', sum(1 for r in M['roads'] if r['k'] in MAJOR))


if __name__ == '__main__':
    main()
