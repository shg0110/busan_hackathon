"""지방행정 인허가 좌표(EPSG:5174, Bessel 중부원점 TM 보정) → WGS84 위경도.
상가정보 같은 주소 861곳과 비교해 오차 중앙값 6.5m, 90%가 39m 안이었다.
"""
import math

_A = 6377397.155
_F = 1 / 299.1528128
_E2 = 2 * _F - _F * _F


def tm_inv(x, y):
    """EPSG:5174 평면 좌표 → Bessel 위경도(라디안)."""
    a, e2 = _A, _E2
    ep2 = e2 / (1 - e2)
    lat0 = math.radians(38); lon0 = math.radians(127.0028902777778); k0 = 1; FE = 200000; FN = 500000

    def M(p):
        return a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * p
                    - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * math.sin(2 * p)
                    + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * math.sin(4 * p)
                    - (35 * e2 ** 3 / 3072) * math.sin(6 * p))
    m = M(lat0) + (y - FN) / k0
    mu = m / (a * (1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256))
    e1 = (1 - math.sqrt(1 - e2)) / (1 + math.sqrt(1 - e2))
    p1 = (mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * math.sin(2 * mu) + (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * math.sin(4 * mu)
          + (151 * e1 ** 3 / 96) * math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * math.sin(8 * mu))
    C1 = ep2 * math.cos(p1) ** 2; T1 = math.tan(p1) ** 2
    N1 = a / math.sqrt(1 - e2 * math.sin(p1) ** 2); R1 = a * (1 - e2) / (1 - e2 * math.sin(p1) ** 2) ** 1.5
    D = (x - FE) / (N1 * k0)
    lat = p1 - (N1 * math.tan(p1) / R1) * (D * D / 2 - (5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4 / 24
                                          + (61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6 / 720)
    lon = lon0 + (D - (1 + 2 * T1 + C1) * D ** 3 / 6 + (5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5 / 120) / math.cos(p1)
    return lat, lon


def bessel2wgs(lat, lon):
    """Bessel 위경도(라디안) → WGS84 위경도(도). towgs84 7변수."""
    a, e2 = _A, _E2
    N = a / math.sqrt(1 - e2 * math.sin(lat) ** 2)
    X = N * math.cos(lat) * math.cos(lon); Y = N * math.cos(lat) * math.sin(lon); Z = N * (1 - e2) * math.sin(lat)
    tx, ty, tz = -115.80, 474.99, 674.11; s = math.radians(1 / 3600)
    rx, ry, rz = 1.16 * s, -2.31 * s, -1.63 * s; ds = 6.43e-6
    X2 = tx + (1 + ds) * (X - rz * Y + ry * Z); Y2 = ty + (1 + ds) * (rz * X + Y - rx * Z); Z2 = tz + (1 + ds) * (-ry * X + rx * Y + Z)
    a2 = 6378137.0; f2 = 1 / 298.257223563; e22 = 2 * f2 - f2 * f2
    p = math.hypot(X2, Y2); lat2 = math.atan2(Z2, p * (1 - e22))
    for _ in range(6):
        N2 = a2 / math.sqrt(1 - e22 * math.sin(lat2) ** 2); lat2 = math.atan2(Z2 + e22 * N2 * math.sin(lat2), p)
    return math.degrees(lat2), math.degrees(math.atan2(Y2, X2))


def to_wgs(x, y):
    """EPSG:5174 (x, y) → (위도, 경도)."""
    return bessel2wgs(*tm_inv(float(x), float(y)))


def from_wgs(lat, lon):
    """(위도, 경도) → EPSG:5174 (x, y). to_wgs를 거꾸로 푸는 뉴턴 반복(점검용)."""
    x, y = 200000.0 + (lon - 127.0028902777778) * 91000, 500000.0 + (lat - 38) * 111000
    for _ in range(20):
        la, lo = to_wgs(x, y); h = 1.0
        la_x, lo_x = to_wgs(x + h, y); la_y, lo_y = to_wgs(x, y + h)
        j11, j12, j21, j22 = (la_x - la) / h, (la_y - la) / h, (lo_x - lo) / h, (lo_y - lo) / h
        det = j11 * j22 - j12 * j21; dla, dlo = lat - la, lon - lo
        x += (j22 * dla - j12 * dlo) / det; y += (-j21 * dla + j11 * dlo) / det
    return x, y
