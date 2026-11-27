"""화면 요약 카드에 쓸 공실률 숫자를 R-ONE 원자료에서 뽑아 web/data/<지역>_stats.js 로 쓴다.

숫자를 손으로 옮겨 적지 않으려고 만든다. 화면에 나오는 공실률은 모두 이 파일에서 온다.
입력: data/raw/reb/vacancy_dongnam.csv (tools/reb_fetch_busan.py ... 부산,울산,경남)
실행: python3 -I tools/web_stats.py okpo
"""
import csv, collections, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG = {
    'okpo': dict(name='경남>거제옥포', label='거제 옥포', compare=[('경남>거제고현', '같은 거제 고현'), ('경남', '경남 평균')]),
}
NAME = sys.argv[1]
cfg = CFG[NAME]
v = collections.defaultdict(dict)
for r in csv.DictReader(open(os.path.join(ROOT, 'data/raw/reb/vacancy_dongnam.csv'), encoding='utf-8-sig')):
    v[r['상권']][(r['상가유형'], r['분기'])] = round(float(r['공실률_%']), 1)
quarters = sorted({q for (_, q) in v[cfg['name']] if _ == '일반'})
latest = quarters[-1]
# 동남권 순위(일반 상가, 시·도 전체 줄 제외)
ranked = sorted(((d[('일반', latest)], s) for s, d in v.items() if ('일반', latest) in d and '>' in s), reverse=True)
rank = [s for _, s in ranked].index(cfg['name']) + 1
q = lambda d, k: d.get((k, latest))
d = v[cfg['name']]
out = dict(
    label=cfg['label'], quarter=f'{latest[:4]}년 {int(latest[4:])}분기', rank=rank, of=len(ranked), scope='동남권(부산·울산·경남)',
    general=q(d, '일반'), large=q(d, '중대형'), small=q(d, '소규모'),
    series=[dict(q=f'{x[2:4]}.{int(x[4:])}Q', v=d.get(('일반', x))) for x in quarters],
    compare=[dict(label=lb, general=v[k].get(('일반', latest)), series=[v[k].get(('일반', x)) for x in quarters]) for k, lb in cfg['compare']],
    top=[dict(name=s.replace('>', ' '), v=val) for val, s in ranked[:5]],
    source='한국부동산원 R-ONE 상업용부동산 임대동향조사',
)
os.makedirs(os.path.join(ROOT, 'web', 'data'), exist_ok=True)
dst = os.path.join(ROOT, 'web', 'data', f'{NAME}_stats.js')
with open(dst, 'w', encoding='utf-8') as f:
    f.write('/* 자동 생성: tools/web_stats.py — 손으로 고치지 말 것 */\nwindow.STATS = ')
    json.dump(out, f, ensure_ascii=False)
    f.write(';\n')
print(dst, out['general'], out['rank'], '/', out['of'], [c['general'] for c in out['compare']])
