import sys, math, json
from PIL import Image
img = Image.open(sys.argv[1]).convert('RGBA'); W, H = img.size; px = img.load()
x0, y0, x1, y1 = map(float, open(sys.argv[2]).read().strip().split(','))
green = lambda p: p[3] > 100 and p[1] > 150 and p[0] < 120 and p[2] < 120
# 상권 안쪽(이름 글자 근처)에서 채우기 시작해 초록 선에 막히는 영역을 구한다
seed = (100, 140)
inside = set(); stack = [seed]
while stack:
    x, y = stack.pop()
    if (x, y) in inside or not (0 <= x < W and 0 <= y < H) or green(px[x, y]): continue
    inside.add((x, y)); stack += [(x+1, y), (x-1, y), (x, y+1), (x, y-1)]
touch_edge = any(x in (0, W-1) or y in (0, H-1) for x, y in inside)
def ll(x, y):
    mx = x0 + (x + .5) / W * (x1 - x0); my = y1 - (y + .5) / H * (y1 - y0)
    lon = mx / 20037508.34 * 180; lat = math.degrees(2 * math.atan(math.exp(my / 6378137)) - math.pi / 2)
    return round(lon, 6), round(lat, 6)
# 바깥 테두리 칸(안쪽 칸 중 이웃이 선인 칸)을 각도 순으로 늘어놓는다
cx = sum(x for x, _ in inside) / len(inside); cy = sum(y for _, y in inside) / len(inside)
# 무어 이웃 따라가기로 테두리를 시계 방향 차례대로 얻는다
start = min(inside, key=lambda p: (p[1], p[0]))
N8 = [(1,0),(1,1),(0,1),(-1,1),(-1,0),(-1,-1),(0,-1),(1,-1)]
edge = [start]; cur = start; d = 6
for _ in range(20000):
    for k in range(8):
        nd = (d + 6 + k) % 8; nx, ny = cur[0] + N8[nd][0], cur[1] + N8[nd][1]
        if (nx, ny) in inside:
            cur = (nx, ny); d = nd; break
    if cur == start: break
    edge.append(cur)
step = max(1, len(edge) // 200)
ring = [ll(*p) for p in edge[::step]]; ring.append(ring[0])
area_px = len(inside); c = math.cos(math.radians(35.1)); mpp = (x1 - x0) / W * c; mppy = (y1 - y0) / H * c
print(json.dumps({'touch_edge': touch_edge, 'pixels': area_px, 'area_m2_approx': round(area_px * mpp * mppy), 'm_per_px': [round(mpp, 1), round(mppy, 1)],
                  'center': ll(cx, cy), 'bbox': [min(p[0] for p in ring), min(p[1] for p in ring), max(p[0] for p in ring), max(p[1] for p in ring)]}, ensure_ascii=False))
json.dump({'type': 'Feature', 'properties': {'name': '남포동', 'source': 'R-ONE 통계지도 상권구획도(kab_commercial2022) 그림에서 추적한 근사 경계, 오차 약 ±10m'},
           'geometry': {'type': 'Polygon', 'coordinates': [ring]}}, open(sys.argv[3], 'w'), ensure_ascii=False)

from PIL import ImageDraw
im = img.copy(); dr = ImageDraw.Draw(im); dr.line(edge[::step] + [edge[0]], fill=(255, 0, 0, 255), width=1)
im.resize((768, 768), Image.NEAREST).save(sys.argv[3].replace('.geojson', '_check.png'))
