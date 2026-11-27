"""빈 점포 후보(인허가 폐업)를 3D 건물·층 판정(가게 없는 층)과 대조한다.
입력: data/processed/<이름>_closed_candidates.csv, web/data/<이름>_map.js(건물 윤곽), web/data/<이름>_floors.js(층 판정)
출력: data/processed/<이름>_closed_candidates_floorcheck.csv(후보마다 건물 번호·건물 이름·층 판정), 표준출력에 등급×판정 표
실행: python3 -I tools/okpo_candidates_floorcheck.py okpo
주의: 층 판정도 상가정보를 쓰므로, A등급(상가정보에 가게 없음)과 '가게 없는 층'이 겹치는 것은 완전히 독립된 검증이 아니다.
      더해지는 정보는 '그 자리에 가게가 있다가 폐업했다(인허가)'와 '그 층이 상가 용도다(건축물대장)'이다.
"""
import collections, csv, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAME = sys.argv[1] if len(sys.argv) > 1 else 'okpo'


def load_js(path):
    t = open(path, encoding='utf-8').read()
    return json.loads(t[t.index('{'):t.rindex('}') + 1])


def inside(p, poly):
    x, z = p; c = False
    for i in range(len(poly)):
        (x1, z1), (x2, z2) = poly[i], poly[i - 1]
        if (z1 > z) != (z2 > z) and x < (x2 - x1) * (z - z1) / (z2 - z1) + x1:
            c = not c
    return c


def main():
    M = load_js(os.path.join(ROOT, 'web/data', f'{NAME}_map.js')); me = M['meta']; B = M['buildings']
    F = load_js(os.path.join(ROOT, 'web/data', f'{NAME}_floors.js'))['b']
    src = os.path.join(ROOT, 'data/processed', f'{NAME}_closed_candidates.csv')
    rows = list(csv.DictReader(open(src, encoding='utf-8-sig')))
    out, tab = [], collections.Counter()
    for r in rows:
        x, z = (float(r['경도']) - me['lon0']) * me['kx'], -(float(r['위도']) - me['lat0']) * me['kz']
        hs = [i for i, b in enumerate(B) if inside((x, z), b['p'])]
        if not hs:
            st, bi, bn = '건물 윤곽 밖', '', ''
        else:
            bi = hs[0]; b = B[bi]; bn = b.get('dn') or b.get('n') or b.get('use') or ''
            fl = F.get(str(bi), []); want = r['층']
            hit = [f['state'] for f in fl if want and str(f['n']) == want]
            st = hit[0] if hit else ('층 모름' if fl else '층 자료 없음')
        tab[(r['빈점포등급'], st)] += 1
        out.append({'빈점포등급': r['빈점포등급'], '사업장명': r['사업장명'], '폐업일자': r['폐업일자'], '도로명주소': r['도로명주소'],
                    '층': r['층'], '건물번호': bi, '건물': bn, '층판정': st})
    dst = os.path.join(ROOT, 'data/processed', f'{NAME}_closed_candidates_floorcheck.csv')
    with open(dst, 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(out[0])); w.writeheader(); w.writerows(out)
    for k in sorted(tab):
        print(k[0], k[1], tab[k])
    print(os.path.relpath(dst, ROOT))


if __name__ == '__main__':
    main()
