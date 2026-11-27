#!/usr/bin/env python3
"""국토교통부 GIS건물통합정보(AL_D010, 브이월드) zip 에서 지역 범위 건물만 잘라 data/raw/vworld/<지역>.json 저장.

- zip 을 풀지 않고 안에서 바로 읽는다(경남 파일은 풀면 3.2GB). shp 는 처음부터 한 번, dbf 는 고른 레코드만 번호 순서대로.
- 경남 zip 에는 shp 가 두 벌(이름, 이름(2)) 들어 있어 둘 다 읽는다.
- 좌표계 EPSG:5186(GRS80 중부원점 TM) → 위경도. 변환식은 대구 dongseongno-3d/tools/vworld_buildings.py 에서 가져옴(상가정보 주소 861곳 대조 오차 중앙값 6.5m로 검증).
실행: python3 -I tools/vworld_crop.py okpo ~/Downloads/download-2/AL_D010_48_20261109.zip

항목(국토부 AL_D010 정의):
  A2 고유번호(PNU)  A4 법정동명  A5 지번  A9 용도명  A11 구조명  A12 건축면적  A13 사용승인일
  A14 연면적  A16 높이(m)  A24 건물명  A25 동명  A26 지상층수  A27 지하층수
"""
import json, math, os, struct, sys, zipfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from map_regions import bbox as region_bbox

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAME, ZIP = sys.argv[1], os.path.expanduser(sys.argv[2])
S, W, N, E = region_bbox(NAME)
OUT = os.path.join(ROOT, "data", "raw", "vworld", f"{NAME}.json")

# ── GRS80 횡메르카토르(정·역변환, Snyder) ───────────────────
a, f = 6378137.0, 1 / 298.257222101
e2 = f * (2 - f); ep2 = e2 / (1 - e2)
LAT0, LON0, K0, FE, FN = math.radians(38), math.radians(127), 1.0, 200000.0, 600000.0
def M(phi):
    return a * ((1 - e2 / 4 - 3 * e2**2 / 64 - 5 * e2**3 / 256) * phi
                - (3 * e2 / 8 + 3 * e2**2 / 32 + 45 * e2**3 / 1024) * math.sin(2 * phi)
                + (15 * e2**2 / 256 + 45 * e2**3 / 1024) * math.sin(4 * phi)
                - (35 * e2**3 / 3072) * math.sin(6 * phi))
M0 = M(LAT0)
def fwd(lat, lon):
    phi, lam = math.radians(lat), math.radians(lon)
    Nn = a / math.sqrt(1 - e2 * math.sin(phi)**2); T = math.tan(phi)**2; C = ep2 * math.cos(phi)**2
    A = (lam - LON0) * math.cos(phi)
    x = FE + K0 * Nn * (A + (1 - T + C) * A**3 / 6 + (5 - 18 * T + T * T + 72 * C - 58 * ep2) * A**5 / 120)
    y = FN + K0 * (M(phi) - M0 + Nn * math.tan(phi) * (A * A / 2 + (5 - T + 9 * C + 4 * C * C) * A**4 / 24
                                                       + (61 - 58 * T + T * T + 600 * C - 330 * ep2) * A**6 / 720))
    return x, y
def inv(x, y):
    m = M0 + (y - FN) / K0
    mu = m / (a * (1 - e2 / 4 - 3 * e2**2 / 64 - 5 * e2**3 / 256))
    e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))
    p1 = (mu + (3 * e1 / 2 - 27 * e1**3 / 32) * math.sin(2 * mu) + (21 * e1**2 / 16 - 55 * e1**4 / 32) * math.sin(4 * mu)
          + (151 * e1**3 / 96) * math.sin(6 * mu) + (1097 * e1**4 / 512) * math.sin(8 * mu))
    N1 = a / math.sqrt(1 - e2 * math.sin(p1)**2); T1 = math.tan(p1)**2; C1 = ep2 * math.cos(p1)**2
    R1 = a * (1 - e2) / (1 - e2 * math.sin(p1)**2)**1.5; D = (x - FE) / (N1 * K0)
    lat = p1 - (N1 * math.tan(p1) / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D**4 / 24
                                          + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D**6 / 720)
    lon = LON0 + (D - (1 + 2 * T1 + C1) * D**3 / 6
                  + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D**5 / 120) / math.cos(p1)
    return math.degrees(lat), math.degrees(lon)

# 변환 자기 검증(왕복 오차 1cm 미만)
_x, _y = fwd(34.892, 128.692); _la, _lo = inv(_x, _y)
assert abs(_la - 34.892) < 1e-7 and abs(_lo - 128.692) < 1e-7, (_la, _lo)


cs = [fwd(la, lo) for la in (S, N) for lo in (W, E)]
X0, X1 = min(c[0] for c in cs) - 20, max(c[0] for c in cs) + 20
Y0, Y1 = min(c[1] for c in cs) - 20, max(c[1] for c in cs) + 20


def read_shp(fh):
    keep = {}
    fh.read(100); i = 0
    while True:
        h = fh.read(8)
        if len(h) < 8:
            break
        _, clen = struct.unpack(">ii", h); body = fh.read(clen * 2)
        st = struct.unpack("<i", body[:4])[0]
        if st in (5, 15, 25):
            bx0, by0, bx1, by1 = struct.unpack("<4d", body[4:36])
            if bx1 >= X0 and bx0 <= X1 and by1 >= Y0 and by0 <= Y1:
                npart, npt = struct.unpack("<2i", body[36:44])
                parts = list(struct.unpack(f"<{npart}i", body[44:44 + 4 * npart])) + [npt]
                off = 44 + 4 * npart
                pts = struct.unpack(f"<{2 * npt}d", body[off:off + 16 * npt])
                keep[i] = [[(pts[2 * k], pts[2 * k + 1]) for k in range(parts[j], parts[j + 1])] for j in range(npart)]
        i += 1
    return keep


def read_dbf(fh, wanted):
    hd = fh.read(32); nrec, hlen, rlen = struct.unpack("<IHH", hd[4:12]); fields = []; pos = 32
    while True:
        d = fh.read(32); pos += 32
        if d[0] == 0x0D:
            break
        fields.append((d[:11].split(b"\0")[0].decode(), d[16]))
    # pos = 지금까지 읽은 바이트(머리 32 + 항목 32바이트씩 + 끝 표시가 든 32바이트). 자료 시작은 hlen.
    recs = {}
    for i in sorted(wanted):
        target = hlen + i * rlen
        fh.read(target - pos) if target > pos else None   # 앞으로만 넘김(압축 안에서도 됨)
        r = fh.read(rlen); pos = target + rlen; p = 1; v = {}
        for name, ln in fields:
            v[name] = r[p:p + ln].replace(b"\0", b" ").decode("cp949", "replace").strip(); p += ln
        recs[i] = v
    return recs


def num(s):
    try: return float(s)
    except ValueError: return 0.0


def signed_area(r):
    return sum(r[k][0] * r[k + 1][1] - r[k + 1][0] * r[k][1] for k in range(len(r) - 1)) / 2


out = []
with zipfile.ZipFile(ZIP) as z:
    for shp_name in sorted(n for n in z.namelist() if n.endswith(".shp")):
        with z.open(shp_name) as fh:
            keep = read_shp(fh)
        with z.open(shp_name[:-4] + ".dbf") as fh:
            recs = read_dbf(fh, keep)
        print(shp_name, "범위 안", len(keep))
        for i, rings in keep.items():
            v = recs[i]
            outers = [r for r in rings if signed_area(r) < 0] or rings[:1]   # ESRI: 바깥 링은 시계 방향
            for r in outers:
                out.append(dict(
                    pnu=v["A2"], dong=v["A4"], jibun=v["A5"], use=v["A9"], struct=v["A11"],
                    barea=num(v["A12"]), farea=num(v["A14"]), h=num(v["A16"]),
                    lv=int(num(v["A26"])), blv=int(num(v["A27"])), name=v["A24"], dn=v["A25"],
                    appr=v["A13"], ring=[[round(la, 7), round(lo, 7)] for la, lo in (inv(x, y) for x, y in r)]))

os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(dict(source=os.path.basename(ZIP), buildings=out), open(OUT, "w", encoding="utf-8"), ensure_ascii=False)
from collections import Counter
print("원자료", os.path.basename(ZIP), "범위 안 건물", len(out))
print("층수 있음", sum(o["lv"] > 0 for o in out), "높이 있음", sum(o["h"] > 0 for o in out),
      "이름 있음", sum(bool(o["name"]) for o in out), "최고층", max(o["lv"] for o in out))
print("용도", Counter(o["use"] for o in out).most_common(12))
print("저장", OUT, os.path.getsize(OUT) // 1024, "KB")
