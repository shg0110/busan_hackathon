/* 바닥층: 도로 포장·인도·연석·중앙선·차선·횡단보도·정지선·주차장·골목 가장자리선 — decor.js 다음에 불러온다.
   (decor.js 에 있던 바닥 표시를 옮겨 와 색 위계를 다시 잡았다. 2026-11-27, seohogyun-31)
   자료: window.MAP_DATA(roads·parking·buildings, tools/map_build.py). 그릴 곳: window.__map.scene.
   좌표: x = 동쪽(m), z = 남쪽(m), y = 위.

   색 위계(멀리서도 길 그물이 읽히게): 땅(아주 밝음) > 인도(따뜻한 보도블록) > 골목(밝은 회색 포장) > 큰길(아스팔트) > 연석(가장 진함).
   흰 차선·횡단보도는 아스팔트 위에서 또렷하게, 노란 중앙선은 큰길 양방향에만.

   주의(장식과 실제 구분):
     - 도로 면·폭은 OSM 길과 등급별 폭(tools/map_build.py)이다. 실제 차도 경계선 자료가 아니다.
     - 횡단보도·정지선: 큰길끼리 만나는 곳에만 그렸다. 실제 횡단보도 위치는 확인하지 않았다(OSM에 옥포 횡단보도 점이 없다).
     - 중앙선·차선: OSM 일방(ow)·차로 수(ln)를 따른다. 일방통행은 중앙선 없음, 차로 수가 없는 길은 점선 없음.
     - 주차장 면은 OSM 실제 위치, 그 안의 주차 칸 선은 장식이다.
   그리기 순서(renderOrder): 인도 3.5 · 주차장 4.5 · 길 포장 7.1~7.6 · 선 8 · 횡단보도·정지선 8.9 · (ea 거리 띠·빈 층 고리 9.3~9.7) · 건물 10.
   높이(y)는 모두 0.06 아래(ea 의 땅 위 표시가 0.07~0.12).
   app.js 연결점(#52·#55): __map.roads(옛 길 띠 3겹)는 숨기고, __map.ground(땅)·greens(숲·공원·운동장)·water(바다) 색만 바꾼다. */
(() => {
'use strict';
const M = window.__map, D = window.MAP_DATA;
if (!M || !M.scene || !D || !window.THREE) return;
const scene = M.scene;

// ── 색·치수 ───────────────────────────────────────────
const G = {
  // 화면 빛(하늘빛 0.64 + 햇빛 0.56)이 위를 보는 면을 약 1.2배 밝게 하므로, 보이는 색보다 한 단계 진하게 적는다
  // 11-27 평가(0e): 첫 화면에서 안개·빛에 큰길이 밝게 떠 인도와 경계가 안 읽혀, 큰길을 한 단계 더 진하게·인도를 조금 회색으로(차도·인도·땅 세 단계)
  ground: '#f1efea',                             // 땅: 아주 밝은 따뜻한 회색(건물 흰 지붕과 구분, 인도보다 밝게)
  major: '#767c86', majorEdge: '#5f656d',      // 큰길 아스팔트, 가장자리(연석 쪽 어두운 띠)
  link: '#959ba3',                               // 큰길 연결로
  minor: '#a2a7af', minorEdge: '#848a92',        // 골목(주거 도로). 위에서 볼 때 땅색과 구분되도록 한 단계 진하게(ea 점검표 ③)
  service: '#b6bbc1',                            // 건물 앞 진입로·주차 통로
  foot: '#e4ded3',                               // 보행로·계단(보도블록)
  walk: '#d8d4cc', curb: '#a3a7ad',              // 인도(따뜻한 보도블록), 연석(15cm 솟은 화강석 회색, 옆면 그늘로 경계가 보임)
  center: '#f2c230', lane: '#ffffff', zebra: '#fbfbf8',
  parking: '#9da2a9', stall: '#f4f4f2',
  edge: '#848b94',                               // 골목 가장자리선
  // 녹지·물 바닥(app.js 가 그림, #55 연결점으로 색만 바꿈): 차분한 잎(#4e7c45~#77a465, decor.js)과 같은 계열로 채도를 낮춤
  // 잔디(green)는 11월 말답게 아주 조금 누렇게(seohogyun-20 #86 나무 계절감과 맞춤). 인조잔디(pitch)·숲 바닥(wood)은 그대로
  wood: '#a8bc95', green: '#c4cca4', pitch: '#b9cda3', water: '#9cbfdc',
};
const MAJOR = new Set(['trunk', 'primary', 'secondary', 'tertiary']);
const LINK = new Set(['trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);
const FOOT = new Set(['footway', 'path', 'steps', 'pedestrian', 'cycleway', 'track']);
const VEHICLE_SKIP = new Set(['service', 'footway', 'path', 'steps', 'cycleway', 'pedestrian', 'track']);
const WALK_W = 2.5;            // 인도 폭(m)
const JUNC_CLEAR = 15;         // 교차로 앞뒤로 중앙선·차선을 비우는 길이(m)

// ── 지형(terrain.js, seohogyun-31): 켜져 있으면 모든 바닥 층을 땅 높이에 붙인다. 꺼져 있으면 아래는 모두 그대로(높이 0) ──
const TON = !!window.TERRAIN_ON, TH = (typeof window.heightAt === 'function') ? window.heightAt : () => 0;
const LIFT = 0.2;   // 지형 면 위로 띄우는 높이. 0.05 였을 때 8m 로 나눈 차도 면이 6m 지형 격자의 오목한 곳에서 땅 밑으로 들어가 보도블록이 차도를 가로질러 보였다(11-27)
// 삼각형을 가장 긴 변의 가운데에서 둘로 나누기를 되풀이해 모든 변이 maxE 이하가 되게(감는 방향 유지). 6m 지형 격자 위에서 긴 삼각형이 땅을 뚫거나 뜨지 않게
function densify(pos, maxE) {
  const out = [], st = [];
  for (let i = 0; i < pos.length; i += 9) st.push([pos[i], pos[i + 1], pos[i + 2], pos[i + 3], pos[i + 4], pos[i + 5], pos[i + 6], pos[i + 7], pos[i + 8]]);
  const m2 = maxE * maxE;
  while (st.length) {
    const t = st.pop(), d = (a, b) => (t[a] - t[b]) ** 2 + (t[a + 2] - t[b + 2]) ** 2;
    const e0 = d(0, 3), e1 = d(3, 6), e2 = d(6, 0), mx = Math.max(e0, e1, e2);
    if (mx <= m2) { out.push(...t); continue; }
    const A = t.slice(0, 3), B = t.slice(3, 6), C = t.slice(6, 9), mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
    if (mx === e0) { const M2 = mid(A, B); st.push([...A, ...M2, ...C], [...M2, ...B, ...C]); }
    else if (mx === e1) { const M2 = mid(B, C); st.push([...A, ...B, ...M2], [...A, ...M2, ...C]); }
    else { const M2 = mid(C, A); st.push([...A, ...B, ...M2], [...M2, ...B, ...C]); }
  }
  return out;
}
// 땅 기울기에서 법선(바닥 층도 비탈에서 지형과 같은 빛을 받게)
function terrainNormal(x, z) { const e = 3, gx = (TH(x + e, z) - TH(x - e, z)) / (2 * e), gz = (TH(x, z + e) - TH(x, z - e)) / (2 * e), l = Math.hypot(gx, 1, gz); return [-gx / l, 1 / l, -gz / l]; }

// ── 도우미(decor.js 와 같은 것, 검증된 그대로 복사) ─────────────
const key = (p) => p[0].toFixed(1) + ',' + p[1].toFixed(1);
function inPoly(x, z, p) {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i], b = p[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
function segDist(x, z, a, b) {
  const dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
  let t = l2 ? ((x - a[0]) * dx + (z - a[1]) * dz) / l2 : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
}
// 선분 격자: 많은 점에서 가까운 선분을 찾을 때(바다 깊이·가로수 보호판). 모든 선분을 훑던 것을 cell(m) 칸으로 나눠 주변 칸만 본다
function segGrid(segs, cell) {
  const map = new Map(), K = (i, j) => i * 100003 + j;
  segs.forEach((sg, idx) => {
    const [a, b] = sg, i0 = Math.floor(Math.min(a[0], b[0]) / cell), i1 = Math.floor(Math.max(a[0], b[0]) / cell), j0 = Math.floor(Math.min(a[1], b[1]) / cell), j1 = Math.floor(Math.max(a[1], b[1]) / cell);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = K(i, j); let l = map.get(k); if (!l) map.set(k, l = []); l.push(idx); }
  });
  return {
    near(x, z, maxR) {   // maxR 안에서 가장 가까운 선분(없으면 d = maxR, s = null)
      const r = Math.ceil(maxR / cell), ci = Math.floor(x / cell), cj = Math.floor(z / cell); let bd = maxR, best = null;
      for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
        const l = map.get(K(i, j)); if (!l) continue;
        for (const idx of l) { const sg = segs[idx], d = segDist(x, z, sg[0], sg[1]); if (d < bd) { bd = d; best = sg; } }
      }
      return { d: bd, s: best };
    },
  };
}
// 한 줄(z)에서 다각형 경계를 지나는 x 들(정렬). 같은 줄의 많은 점을 안쪽 판정할 때 inPoly 를 점마다 돌리지 않으려고
function rowCross(p, z) {
  const xs = [];
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const a = p[i], b = p[j]; if ((a[1] > z) !== (b[1] > z)) xs.push((b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]); }
  return xs.sort((u, v) => u - v);
}
const inRow = (xs, x) => { let c = 0; for (const v of xs) { if (v > x) break; c++; } return (c & 1) === 1; };
function bbox(p, pad) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const q of p) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < z0) z0 = q[1]; if (q[1] > z1) z1 = q[1]; }
  return [x0 - pad, z0 - pad, x1 + pad, z1 + pad];
}
function grid(cell) {
  const m = new Map();
  return {
    add(b, v) {
      for (let i = Math.floor(b[0] / cell); i <= Math.floor(b[2] / cell); i++)
        for (let j = Math.floor(b[1] / cell); j <= Math.floor(b[3] / cell); j++) {
          const k = i + ':' + j; let a = m.get(k); if (!a) m.set(k, a = []); a.push(v);
        }
    },
    at(x, z) { return m.get(Math.floor(x / cell) + ':' + Math.floor(z / cell)) || []; },
  };
}
const BG = grid(20);
D.buildings.forEach((b, i) => BG.add(bbox(b.p, 4), i));
function nearBuilding(x, z, r) {
  for (const i of BG.at(x, z)) {
    const p = D.buildings[i].p;
    if (inPoly(x, z, p)) return true;
    for (let k = 0; k < p.length; k++) if (segDist(x, z, p[k], p[(k + 1) % p.length]) < r) return true;
  }
  return false;
}
// 교차로: 한 점에서 뻗어 나가는 차도 가닥이 3개 이상
const vehicle = D.roads.map(r => !r.ped && !VEHICLE_SKIP.has(r.k));
const arms = new Map();
D.roads.forEach((r, ri) => {
  if (!vehicle[ri]) return;
  const big = MAJOR.has(r.k);
  r.p.forEach((p, i) => {
    const n = (i === 0 || i === r.p.length - 1) ? 1 : 2, k = key(p);
    const a = arms.get(k) || [0, 0]; a[0] += n; if (big) a[1] += n; arms.set(k, a);
  });
});
const isJunction = (p) => { const a = arms.get(key(p)); return !!a && a[0] >= 3; };
const majorAt = (p) => { const a = arms.get(key(p)); return a ? a[1] : 0; };
function walker(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = cum[cum.length - 1];
  return {
    L, cum,
    at(s) {
      let i = 1; while (i < cum.length - 1 && cum[i] < s) i++;
      const a = pts[i - 1], b = pts[i], l = (cum[i] - cum[i - 1]) || 1, t = Math.max(0, Math.min(1, (s - cum[i - 1]) / l));
      const dx = (b[0] - a[0]) / l, dz = (b[1] - a[1]) / l;
      return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, dx, dz, nx: -dz, nz: dx };
    },
  };
}
const majors = [];
D.roads.forEach((r, ri) => {
  if (!MAJOR.has(r.k) || r.p.length < 2) return;
  const w = walker(r.p), js = [];
  r.p.forEach((p, i) => { if (isJunction(p)) js.push({ s: w.cum[i], p, major: majorAt(p) }); });
  const ring = !!r.ow && Math.hypot(r.p[0][0] - r.p[r.p.length - 1][0], r.p[0][1] - r.p[r.p.length - 1][1]) < 1;
  majors.push({ r, ri, w, js, ring });
});
function stripe(m, off, wd, s0, s1, y, out) {
  const step = 4; let prev = null;
  for (let s = s0; s <= s1 + 1e-6; s = Math.min(s1, s + step)) {
    const q = m.w.at(s);
    const cx = q.x + q.nx * off, cz = q.z + q.nz * off, h = wd / 2;
    const cur = [cx + q.nx * h, cz + q.nz * h, cx - q.nx * h, cz - q.nz * h];
    if (prev) out.push(prev[0], y, prev[1], cur[0], y, cur[1], prev[2], y, prev[3], prev[2], y, prev[3], cur[0], y, cur[1], cur[2], y, cur[3]);
    prev = cur; if (s >= s1) break;
  }
}
// 길을 따라 솟은 띠(연석): 윗면 + 양 옆면. 삼각형마다 감는 방향을 바깥 법선에 맞춰 앞면만 그려도 되게 한다
function raised(m, off, wd, H, s0, s1, pos, nrm, step = 6) {
  const tri = (a, b, c, n) => {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * n[0] + cy * n[1] + cz * n[2] < 0) { const t = b; b = c; c = t; }
    pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); nrm.push(n[0], n[1], n[2], n[0], n[1], n[2], n[0], n[1], n[2]);
  };
  const quad = (a, b, c, d, n) => { tri(a, b, c, n); tri(a, c, d, n); };
  // 표본: 시작·끝, 길 선의 꼭짓점(꺾이는 곳은 꼭 지킴), 그 사이는 step 간격(전엔 3m 고정이라 연석 삼각형이 8.8만 개, 20 측정)
  const S = [s0, s1]; for (const c of m.w.cum) if (c > s0 + 0.3 && c < s1 - 0.3) S.push(c);
  S.sort((a, b) => a - b);
  const samples = [];
  for (let k = 0; k < S.length; k++) { samples.push(S[k]); if (k < S.length - 1) { const g = S[k + 1] - S[k], n = Math.ceil(g / step); for (let t = 1; t < n; t++) samples.push(S[k] + g * t / n); } }
  let prev = null;
  for (const s of samples) {
    const q = m.w.at(Math.min(s, m.w.L)), cx = q.x + q.nx * off, cz = q.z + q.nz * off, h = wd / 2;
    const cur = { i: [cx - q.nx * h, cz - q.nz * h], o: [cx + q.nx * h, cz + q.nz * h], nx: q.nx, nz: q.nz };
    cur.hi = TH(cur.i[0], cur.i[1]) + (TON ? LIFT : 0); cur.ho = TH(cur.o[0], cur.o[1]) + (TON ? LIFT : 0);   // 지형이 꺼져 있으면 0
    if (prev) {
      const dn = TON ? 0.3 : 0;
      quad([prev.i[0], prev.hi + H, prev.i[1]], [cur.i[0], cur.hi + H, cur.i[1]], [cur.o[0], cur.ho + H, cur.o[1]], [prev.o[0], prev.ho + H, prev.o[1]], [0, 1, 0]);
      quad([prev.i[0], prev.hi - dn, prev.i[1]], [cur.i[0], cur.hi - dn, cur.i[1]], [cur.i[0], cur.hi + H, cur.i[1]], [prev.i[0], prev.hi + H, prev.i[1]], [-cur.nx, 0, -cur.nz]);
      quad([prev.o[0], prev.ho - dn, prev.o[1]], [cur.o[0], cur.ho - dn, cur.o[1]], [cur.o[0], cur.ho + H, cur.o[1]], [prev.o[0], prev.ho + H, prev.o[1]], [cur.nx, 0, cur.nz]);
    }
    prev = cur;
  }
}
// 띠(꺾임 이음 각도 제한) + caps=true 면 양 끝에 둥근 원판(교차로 이음새 메움, app.js ribbon 과 같은 방식)
function ribbon(pts, w, y, out, caps) {
  const h = w / 2, n = pts.length, Lft = [], Rgt = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let d1x = p[0] - a[0], d1z = p[1] - a[1], d2x = b[0] - p[0], d2z = b[1] - p[1];
    const l1 = Math.hypot(d1x, d1z) || 1, l2 = Math.hypot(d2x, d2z) || 1;
    d1x /= l1; d1z /= l1; d2x /= l2; d2z /= l2;
    if (i === 0) { d1x = d2x; d1z = d2z; } if (i === n - 1) { d2x = d1x; d2z = d1z; }
    let tx = d1x + d2x, tz = d1z + d2z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const nx = -tz, nz = tx, cos = Math.max(0.35, nx * -d2z + nz * d2x), k = h / cos;
    Lft.push([p[0] + nx * k, p[1] + nz * k]); Rgt.push([p[0] - nx * k, p[1] - nz * k]);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = Lft[i], b = Rgt[i], c = Lft[i + 1], d = Rgt[i + 1];
    out.push(a[0], y, a[1], c[0], y, c[1], b[0], y, b[1], b[0], y, b[1], c[0], y, c[1], d[0], y, d[1]);
  }
  if (!caps) return;
  for (const p of [pts[0], pts[n - 1]]) {
    const seg = 10;
    for (let s = 0; s < seg; s++) {
      const a0 = s / seg * Math.PI * 2, a1 = (s + 1) / seg * Math.PI * 2;
      out.push(p[0], y, p[1], p[0] + Math.cos(a1) * h, y, p[1] + Math.sin(a1) * h, p[0] + Math.cos(a0) * h, y, p[1] + Math.sin(a0) * h);
    }
  }
}
// ── 질감: 캔버스로 만든 아주 옅은 무늬(색을 곱하므로 바탕은 거의 흰색). 2의 거듭제곱 크기라 밉맵이 생겨 멀리서 반짝이지 않는다 ──
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function canvasTex(size, draw, metersPerTile) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.encoding = THREE.sRGBEncoding;
  if (M.renderer && M.renderer.capabilities) t.anisotropy = Math.min(8, M.renderer.capabilities.getMaxAnisotropy());
  t.userData.m = metersPerTile; return t;
}
// 사람 눈높이에서 보이도록 대비를 충분히 준다. 멀리서는 밉맵이 평균색으로 뭉개므로 반짝이거나 얼룩지지 않는다(ea 점검표 ①)
// 화소 잡음: 256² 잡음 타일을 한 번만 만들고, 질감마다 곱하기 합성으로 깐다(화소마다 계산하던 것보다 약 7배 적음, 합성은 GPU)
// 곱하기 투명도 a 면 밝기 = 1 - a·u(u 는 0~1 고른 난수), 평균 1 - a/2 → amp 는 a/2 쯤
let noiseTile = null;
function pixelNoise(g, n, r, amp) {
  if (!noiseTile) {
    noiseTile = document.createElement('canvas'); noiseTile.width = noiseTile.height = 256;
    const ng = noiseTile.getContext('2d'), im = ng.createImageData(256, 256), d = im.data, rr = rng(97);
    for (let i = 0; i < d.length; i += 4) { const v = 255 - rr() * 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    ng.putImageData(im, 0, 0);
  }
  g.save(); g.globalCompositeOperation = 'multiply'; g.globalAlpha = Math.min(1, amp * 2);
  const ox = Math.floor(r() * 256), oy = Math.floor(r() * 256);   // 질감마다 잡음 위치를 다르게
  for (let y = -oy; y < n; y += 256) for (let x = -ox; x < n; x += 256) g.drawImage(noiseTile, x, y);
  g.restore();
}
const TEX = {
  // 아스팔트(512화소 = 10m, 한 화소 약 2cm): 화소 잡음 + 골재 알갱이 + 옅은 얼룩 + 실금
  asphalt: canvasTex(512, (g, n) => {
    const r = rng(7); g.fillStyle = '#efefef'; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 10; i++) { const x = r() * n, y = r() * n, rad = 60 + r() * 120, a = 0.015 + r() * 0.02;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, `rgba(0,0,0,${a})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, n, n); }
    // 땜질 자국(어두운 네모 2개)은 10m 마다 똑같이 되풀이되어 위에서 격자처럼 보여 뺐다(11-27 캡처)
    g.strokeStyle = 'rgba(30,30,30,0.32)'; g.lineWidth = 1;
    for (let i = 0; i < 7; i++) {   // 실금: 짧게 꺾이는 선
      let x = r() * n, y = r() * n, a = r() * Math.PI * 2; g.beginPath(); g.moveTo(x, y);
      for (let k = 0, m = 6 + r() * 10; k < m; k++) { a += (r() - 0.5) * 1.2; x += Math.cos(a) * 9; y += Math.sin(a) * 9; g.lineTo(x, y); }
      g.stroke();
    }
    for (let i = 0; i < 9000; i++) { const v = r() < 0.45 ? 255 : 90; g.fillStyle = `rgba(${v},${v},${v},${0.12 + r() * 0.2})`; const s = 1 + r() * 1.6; g.fillRect(r() * n, r() * n, s, s); }
    pixelNoise(g, n, r, 0.07);
  }, 10),
  // 보도블록(256화소 = 2m): 20×20cm 블록을 어긋나게, 줄눈 2화소(약 1.6cm) 진하게, 블록마다 밝기·잔무늬
  paver: canvasTex(256, (g, n) => {
    const r = rng(11), cell = n / 10; g.fillStyle = '#b9b2a6'; g.fillRect(0, 0, n, n);
    for (let j = 0; j < 10; j++) for (let i = -1; i < 11; i++) {
      const x = i * cell + (j % 2 ? cell / 2 : 0), y = j * cell, v = 232 + Math.floor(r() * 20);
      g.fillStyle = `rgb(${v},${v - 3},${v - 8})`; g.fillRect(x + 1, y + 1, cell - 2, cell - 2);
    }
    pixelNoise(g, n, r, 0.05);
  }, 2),
  // 공사장 흙(256화소 = 24m): 흙 얼룩 + 바퀴 자국
  dirt: canvasTex(256, (g, n) => {
    const r = rng(23); g.fillStyle = '#f4efe6'; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 26; i++) { const x = r() * n, y = r() * n, rad = 14 + r() * 40, a = 0.03 + r() * 0.05;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, `rgba(100,85,65,${a})`); gr.addColorStop(1, 'rgba(100,85,65,0)'); g.fillStyle = gr; g.fillRect(0, 0, n, n); }
    g.strokeStyle = 'rgba(90,70,45,0.14)'; g.lineWidth = 2;
    for (let i = 0; i < 4; i++) { const y0 = r() * n, c = (r() - 0.5) * n; g.beginPath(); g.moveTo(-10, y0); g.quadraticCurveTo(n / 2, y0 + c, n + 10, y0 + (r() - 0.5) * 40); g.stroke(); }
    pixelNoise(g, n, r, 0.06);
  }, 24),
  // 농지 고랑(128화소 = 6m, 1.2m 마다 이랑)
  furrow: canvasTex(128, (g, n) => {
    g.fillStyle = '#f6f4ea'; g.fillRect(0, 0, n, n); g.fillStyle = 'rgba(100,110,60,0.16)';
    for (let x = 0; x < n; x += n / 5) g.fillRect(x, 0, n / 12, n);
    pixelNoise(g, n, rng(29), 0.05);
  }, 6),
  // 물결(512화소 = 30m): 옅은 밝은 물결선과 어두운 골. 가까이서만 보이고 멀리서는 밉맵이 평균색으로 뭉갠다
  ripple: canvasTex(512, (g, n) => {
    const r = rng(53); g.fillStyle = '#f2f3f5'; g.fillRect(0, 0, n, n);
    for (let i = 0; i < 70; i++) {
      const y0 = r() * n, len = 40 + r() * 140, x0 = r() * n, amp = 2 + r() * 4, ph = r() * 6.28, light = r() < 0.55;
      g.strokeStyle = light ? `rgba(255,255,255,${0.35 + r() * 0.35})` : `rgba(20,40,70,${0.05 + r() * 0.06})`; g.lineWidth = light ? 1.2 : 2;
      g.beginPath(); for (let x = 0; x <= len; x += 4) { const y = y0 + Math.sin(x / 18 + ph) * amp; if (x === 0) g.moveTo(x0 + x, y); else g.lineTo(x0 + x, y); } g.stroke();
      if (x0 + len > n) { g.beginPath(); for (let x = 0; x <= len; x += 4) { const y = y0 + Math.sin(x / 18 + ph) * amp; if (x === 0) g.moveTo(x0 + x - n, y); else g.lineTo(x0 + x - n, y); } g.stroke(); }
    }
  }, 30),
  // 조선소 콘크리트 판(256화소 = 16m, 4m 마다 줄눈)
  slab: canvasTex(256, (g, n) => {
    const r = rng(31); g.fillStyle = '#f3f3f2'; g.fillRect(0, 0, n, n);
    g.fillStyle = '#d4d6d9'; for (let k = 0; k < 4; k++) { g.fillRect(k * 64, 0, 2, n); g.fillRect(0, k * 64, n, 2); }   // 4m 줄눈(판마다 밝기 차이는 체크무늬로 보여 뺌)
    pixelNoise(g, n, r, 0.04);
  }, 16),
};
// 모든 삼각형을 위(+y)를 보게 감는다. DoubleSide 재질은 뒤집혀 감긴 면의 법선을 아래로 돌려 빛을 덜 받으므로(화살표가 회색으로 보이던 원인)
function faceUp(pos, uv) {
  for (let i = 0; i < pos.length; i += 9) {
    const ax = pos[i], az = pos[i + 2], bx = pos[i + 3], bz = pos[i + 5], cx = pos[i + 6], cz = pos[i + 8];
    if ((bz - az) * (cx - ax) - (bx - ax) * (cz - az) >= 0) continue;
    for (let k = 0; k < 3; k++) { const t = pos[i + 3 + k]; pos[i + 3 + k] = pos[i + 6 + k]; pos[i + 6 + k] = t; }
    if (uv) { const j = i / 9 * 6; for (let k = 0; k < 2; k++) { const t = uv[j + 2 + k]; uv[j + 2 + k] = uv[j + 4 + k]; uv[j + 4 + k] = t; } }
  }
}
const made = [];
const NO_DENSIFY = new Set(['water']);
const ZERO_BASE = new Set(['water', 'foam']);   // 바다는 높이 0 이라 잘게 나눌 필요 없음
const ROADLIKE = new Set(['surf-concrete', 'surf-pavers', 'surf-dirt', 'foot', 'service', 'minor-edge', 'minor', 'link', 'major-edge', 'major', 'walk', 'corner', 'alley-edge']);   // 길 띠는 8m 로(삼각형 수 줄이기)
function flat(pos, color, order, glow, name, tex) {
  if (!pos.length) return null;
  faceUp(pos);
  const nrm = new Float32Array(TON ? 0 : pos.length);
  if (TON) {   // 6m 이하로 나눈 뒤 꼭짓점마다 땅 높이를 더하고, 법선은 땅 기울기
    if (!NO_DENSIFY.has(name)) pos = densify(pos, ROADLIKE.has(name) ? 8 : 6);
    const n2 = new Float32Array(pos.length);
    const zb = ZERO_BASE.has(name);   // 물·물거품은 바다 높이 0 에 고정(해안 바다 격자점은 지형이 음수라 따라가면 물이 꺼진다)
    for (let i = 0; i < pos.length; i += 3) { const x = pos[i], z = pos[i + 2]; pos[i + 1] += (zb ? 0 : TH(x, z)) + LIFT; const n = zb ? [0, 1, 0] : terrainNormal(x, z); n2[i] = n[0]; n2[i + 1] = n[1]; n2[i + 2] = n[2]; }
    var nrmT = n2;
  } else for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(TON ? nrmT : nrm, 3));
  if (tex) {   // 땅 좌표(x, z)를 그대로 질감 좌표로: 길이 이어져도 무늬가 끊기지 않는다
    const uv = new Float32Array(pos.length / 3 * 2), k = 1 / tex.userData.m;
    for (let i = 0, j = 0; i < pos.length; i += 3, j += 2) { uv[j] = pos[i] * k; uv[j + 1] = pos[i + 2] * k; }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, depthWrite: false, side: THREE.DoubleSide, emissive: glow || '#000000', map: tex || null,
    polygonOffset: TON, polygonOffsetFactor: -2, polygonOffsetUnits: -8 }));   // 지형 면(깊이 씀)보다 앞에 그려지게
  m.renderOrder = order; m.receiveShadow = true; m.name = 'ground-' + (name || order); scene.add(m); made.push(m); return m;
}

// 한 방향 차로 수: OSM 차로 수(lanes)가 있는 길만(큰길 9개). 없으면 1(차선 없이 중앙선만)
// 11-27 사용자 "실제 자료가 아닌 거는 없애자": 폭으로 추정하던 차로 수는 뺐다
function lanesPerDir(r) { const ln = r.ln || 0; if (!ln) return 1; return r.ow ? ln : Math.max(1, Math.floor(ln / 2)); }
// 실제 횡단보도(공공데이터포털 전국횡단보도표준데이터, tools/okpo_facilities_build.py): 큰길 위 것은 길을 따른 거리 s 를 구해 둔다(중앙선·차선 끊기, 보도턱 낮춤 자리 연석 끊기)
const CW = ((window.FACILITIES || {}).crosswalks || []);
const cwOn = new Map();   // 길 번호 → [{ s, w, ramp }]
function sAlong(m, x, z) {   // 점을 길 선에 내렸을 때 길 시작에서의 거리
  let best = null;
  for (let i = 0; i < m.r.p.length - 1; i++) {
    const a = m.r.p[i], b = m.r.p[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], l2 = dx * dx + dz * dz;
    const t = l2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / l2)) : 0, d = Math.hypot(x - a[0] - t * dx, z - a[1] - t * dz);
    if (!best || d < best.d) best = { d, s: m.w.cum[i] + t * Math.sqrt(l2) };
  }
  return best;
}
for (const m of majors) for (const c of CW) if (c.ri === m.ri) { const q = sAlong(m, c.x, c.z); if (q && q.d < 1) { let l = cwOn.get(m.ri); if (!l) cwOn.set(m.ri, l = []); l.push({ s: q.s, w: c.w || 4, ramp: !!c.ramp }); } }
// extra: 더 비울 구간 [[a, b]..]
function openSpans(m, clear, extra) {
  const cuts = m.js.map(j => [j.s - clear, j.s + clear]).concat(extra || []).sort((a, b) => a[0] - b[0]);
  const spans = []; let s = 0;
  for (const [a, b] of cuts) { if (a > s) spans.push([s, a]); s = Math.max(s, b); }
  if (s < m.w.L) spans.push([s, m.w.L]);
  return spans.filter(([a, b]) => b - a > 3);
}
// 길 선이 25° 넘게 꺾이는 꼭짓점(길을 따른 거리). 옆으로 띄운 선(차선·중앙선)이 이런 곳에서 뒤로 접혀 갈고리처럼 보였다(11-27 거제대로 캡처)
function sharpAt(m) {
  if (m._sharp) return m._sharp;
  const p = m.r.p, out = [], c25 = Math.cos(25 * Math.PI / 180);
  for (let i = 1; i < p.length - 1; i++) {
    const ax = p[i][0] - p[i - 1][0], az = p[i][1] - p[i - 1][1], bx = p[i + 1][0] - p[i][0], bz = p[i + 1][1] - p[i][1];
    if ((ax * bx + az * bz) / ((Math.hypot(ax, az) * Math.hypot(bx, bz)) || 1) < c25) out.push(m.w.cum[i]);
  }
  return (m._sharp = out);
}
// [a, b] 에서 급한 꺾임 앞뒤 pad m 를 뺀 구간들
function cutSharp(m, a, b, pad) {
  const out = []; let s0 = a;
  for (const s of sharpAt(m)) { if (s + pad <= s0 || s - pad >= b) continue; if (s - pad > s0) out.push([s0, s - pad]); s0 = Math.max(s0, s + pad); }
  if (b > s0) out.push([s0, b]);
  return out.filter(([x, y]) => y - x > 1);
}
// 차도 선분 격자: 점이 '다른' 차도 위(그 길 가운데선에서 폭/2 + 0.3m 안)인지. 중앙분리 도로(거제대로처럼 같은 이름 일방 두 가닥)는 가닥 사이가 6~15m 라
// 폭 12m 로 그리면 서로 겹치고, 안쪽 연석이 반대편 차도 위에 솟았다
const vehSegs = []; D.roads.forEach((r, ri) => { if (vehicle[ri] && !r.br && r.p.length > 1) for (let i = 0; i < r.p.length - 1; i++) vehSegs.push([r.p[i], r.p[i + 1], r.w, ri]); });
const vehGrid = (() => {
  const cell = 20, map = new Map(), K = (i, j) => i * 100003 + j;
  vehSegs.forEach((sg, idx) => { const [a, b] = sg; for (let i = Math.floor(Math.min(a[0], b[0]) / cell); i <= Math.floor(Math.max(a[0], b[0]) / cell); i++) for (let j = Math.floor(Math.min(a[1], b[1]) / cell); j <= Math.floor(Math.max(a[1], b[1]) / cell); j++) { const k = K(i, j); let l = map.get(k); if (!l) map.set(k, l = []); l.push(idx); } });
  return (x, z, ri, ri2) => { const ci = Math.floor(x / cell), cj = Math.floor(z / cell);
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) { const l = map.get(K(i, j)); if (!l) continue;
      for (const idx of l) { const sg = vehSegs[idx]; if (sg[3] !== ri && sg[3] !== ri2 && segDist(x, z, sg[0], sg[1]) < sg[2] / 2 + 0.3) return true; } }
    return false; };
})();
// 연석을 그릴 구간에서 다른 차도 위에 들어가는 곳을 뺀다(2m 간격으로 봄)
function freeOfRoads(m, off, a, b) {
  const out = []; let st = null;
  for (let s = a; ; s = Math.min(b, s + 2)) {
    const q = m.w.at(s), ok = !vehGrid(q.x + q.nx * off, q.z + q.nz * off, m.ri);
    if (ok && st === null) st = s;
    if ((!ok || s >= b) && st !== null) { const e = ok ? b : s - 1; if (e - st > 2) out.push([st, e]); st = null; }
    if (s >= b) break;
  }
  return out;
}
const stats = { centerM: 0, laneM: 0, edgeM: 0, parking: 0 };

// ── 지형 면(지형이 켜졌을 때만): 바탕을 6m 격자 지형 메시로(깊이를 써서 언덕이 뒤를 가림) ──
// 넓은 면(토지 이용·숲·잔디·인조잔디·놀이터·주차장)은 메시로 잘게 나누면 삼각형이 100만 개를 넘어(11-27 측정), 지형 면에 입히는 그림(2048화소, 약 0.9m/화소)으로 굽는다.
// app.js 녹지 메시는 숨긴다(ea 합의). 칠하기는 paintQ 에 순서와 함께 모았다가 맨 끝에 순서대로 칠한다
const paintQ = [];
let landTex = null, LC = null, toPx = null;
if (TON && window.TERRAIN) {
  const T = window.TERRAIN, nx = T.nx, nz = T.nz, W = (nx - 1) * T.cell, Hh = (nz - 1) * T.cell, N = 2048;
  const cv = document.createElement('canvas'); cv.width = cv.height = N; LC = cv.getContext('2d');
  LC.fillStyle = G.ground; LC.fillRect(0, 0, N, N);
  toPx = (x, z) => [(x - T.x0) / W * N, (z - T.z0) / Hh * N];
  landTex = new THREE.CanvasTexture(cv); landTex.encoding = THREE.sRGBEncoding;   // app.js 가 색 관리를 켜 두어(legacyMode false) 메시 색도 sRGB 로 읽히므로 같게
  if (M.renderer && M.renderer.capabilities) landTex.anisotropy = Math.min(8, M.renderer.capabilities.getMaxAnisotropy());
  const P = new Float32Array(nx * nz * 3), UV = new Float32Array(nx * nz * 2), idx = [];
  for (let jj = 0; jj < nz; jj++) for (let ii = 0; ii < nx; ii++) {
    const k = jj * nx + ii, x = T.x0 + ii * T.cell, z = T.z0 + jj * T.cell;
    P[k * 3] = x; P[k * 3 + 1] = TH(x, z); P[k * 3 + 2] = z; UV[k * 2] = ii / (nx - 1); UV[k * 2 + 1] = 1 - jj / (nz - 1);
  }
  // 바다 칸(네 꼭짓점이 모두 물 다각형 안)은 위에 물이 덮여 보이지 않으므로 만들지 않는다(삼각형 줄이기). 높이 0 인 땅이 비지 않게 높이가 아니라 다각형으로 판정
  const seaV = new Uint8Array(nx * nz);
  for (let jj = 0; jj < nz; jj++) { const z = T.z0 + jj * T.cell, rows = D.water.map(w => rowCross(w.p, z)); for (let ii = 0; ii < nx; ii++) if (rows.some(xs => inRow(xs, T.x0 + ii * T.cell))) seaV[jj * nx + ii] = 1; }
  for (let jj = 0; jj < nz - 1; jj++) for (let ii = 0; ii < nx - 1; ii++) { const a = jj * nx + ii, b = a + 1, c = a + nx, d = c + 1; if (seaV[a] && seaV[b] && seaV[c] && seaV[d]) continue; idx.push(a, c, b, b, c, d); }   // 위(+y)를 보게
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.BufferAttribute(UV, 2)); g.setIndex(idx); g.computeVertexNormals();
  const tm = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: '#ffffff', map: landTex }));
  tm.renderOrder = 0; tm.receiveShadow = true; tm.name = 'ground-terrain'; scene.add(tm); made.push(tm);
  // 녹지(app.js 와 같은 묶음): 숲·관목 → wood, 인조잔디 → pitch, 나머지 → green
  for (const gr of D.greens || []) {
    if (!gr.p || gr.p.length < 3) continue;
    const k = ['wood', 'forest', 'scrub'].includes(gr.k) ? 'wood' : gr.k === 'pitch' ? 'pitch' : 'green';
    paintQ.push([{ wood: 1, green: 2, pitch: 3 }[k], gr.p, G[k], null]);
  }
  if (M.greens) for (const k of ['wood', 'green', 'pitch']) if (M.greens[k]) M.greens[k].visible = false;
}
// 넓은 면 칠하기(지형이 켜졌을 때). texKey 가 있으면 그 질감 무늬를 실제 크기로 곱해 겹친다
function paintArea(p, color, texKey) {
  LC.beginPath(); p.forEach((q, i) => { const [a, b] = toPx(q[0], q[1]); if (i) LC.lineTo(a, b); else LC.moveTo(a, b); }); LC.closePath();
  LC.fillStyle = color; LC.fill();
  const tx = texKey && TEX[texKey];
  if (tx) {
    const pat = LC.createPattern(tx.image, 'repeat'), s = tx.userData.m * (LC.canvas.width / ((window.TERRAIN.nx - 1) * window.TERRAIN.cell)) / tx.image.width;
    pat.setTransform(new DOMMatrix().scaleSelf(s, s));
    LC.save(); LC.clip(); LC.globalCompositeOperation = 'multiply'; LC.fillStyle = pat; LC.fillRect(0, 0, LC.canvas.width, LC.canvas.height); LC.restore();
  }
}

// ── 토지 이용(OSM, tools/map_ground.py): 빈 땅을 쓰임새로 옅게 구분. 녹지(1~3) 아래 순서 0.5 ──
// OSM 공사장 면은 이름 태그만 있고 지번·시작일이 없다. 그 안에 국토부·Overture 건물이 서 있어 실제와 다를 수 있으니 흙색은 아주 옅게만 칠한다.
// 공사장(힐스테이트 거제 시그니처 등)은 흙, 조선소(한화오션 옥포조선소)는 콘크리트 판, 농지는 고랑, 아파트 단지는 조금 회색, 학교 부지는 옅은 베이지
// 빛이 따뜻한 색의 채도를 키워 모래처럼 보이므로(11-27 캡처) 채도를 아주 낮게 적는다
const LANDUSE = {
  residential: ['#e8e5df', null], commercial: ['#ede2dd', null], retail: ['#ede2dd', null], marketplace: ['#ecdcd5', null],
  industrial: ['#dfe1e4', 'slab'], shipyard: ['#dfe1e4', 'slab'], construction: ['#e8e4dc', 'dirt'], farmland: ['#e0e4c9', 'furrow'],
  cemetery: ['#d9e2cf', null], school: ['#ece6dc', null], university: ['#ece6dc', null], college: ['#ece6dc', null], fuel: ['#dcdde0', null],
};
{
  const LU = ((window.GROUND_DATA || {}).landuse || []), by = {};
  // 넓은 것부터 깔아 작은 것(학교·주유소)이 위에 오게: 종류마다 순서를 조금씩 올린다
  const ORDER = ['residential', 'commercial', 'retail', 'farmland', 'cemetery', 'construction', 'industrial', 'shipyard', 'marketplace', 'school', 'university', 'college', 'fuel'];
  for (const l of LU) {
    if (!LANDUSE[l.k] || l.p.length < 3) continue;
    const out = by[l.k] || (by[l.k] = []);
    const v2 = l.p.map(q => new THREE.Vector2(q[0], q[1]));
    for (const t of THREE.ShapeUtils.triangulateShape(v2, [])) { const a = l.p[t[0]], b = l.p[t[1]], c = l.p[t[2]]; out.push(a[0], 0, a[1], b[0], 0, b[1], c[0], 0, c[1]); }
  }
  let n = 0;
  if (TON && LC) { for (const l of LU) if (LANDUSE[l.k] && l.p.length >= 3) paintQ.push([0.5 + ORDER.indexOf(l.k) * 0.02, l.p, LANDUSE[l.k][0], LANDUSE[l.k][1]]); }
  else for (const k of ORDER) if (by[k]) { const [col, tx] = LANDUSE[k]; flat(by[k], col, 0.5 + ORDER.indexOf(k) * 0.02, null, 'land-' + k, tx ? TEX[tx] : null); n++; }
  stats.landuse = LU.length;
}

// ── 놀이터 바닥: 녹지(초록, 순서 2) 위에 고무칩 포장색(국내 놀이터 바닥), 순서 2.5 ──
{
  const pos = [];
  for (const g of D.greens || []) {
    if (g.k !== 'playground' || !g.p || g.p.length < 3) continue;
    // 800㎡ 넘는 것은 공원 전체를 놀이터로 표시한 것이라(1,509㎡ 한 곳) 통째로 갈색이 되어 흙밭처럼 보인다 → 녹지로 둔다
    let ar = 0; for (let i = 0; i < g.p.length; i++) { const a = g.p[i], b = g.p[(i + 1) % g.p.length]; ar += a[0] * b[1] - b[0] * a[1]; }
    if (Math.abs(ar) / 2 > 800) continue;
    if (TON && LC) { paintQ.push([2.5, g.p, '#c4927d', 'dirt']); continue; }
    const v2 = g.p.map(q => new THREE.Vector2(q[0], q[1]));
    for (const t of THREE.ShapeUtils.triangulateShape(v2, [])) { const a = g.p[t[0]], b = g.p[t[1]], c = g.p[t[2]]; pos.push(a[0], 0.001, a[1], b[0], 0.001, b[1], c[0], 0.001, c[1]); }
  }
  flat(pos, '#c4927d', 2.5, null, 'playground', TEX.dirt);
  stats.playgrounds = (D.greens || []).filter(g => g.k === 'playground').length;
}

// ── 도로 포장: 등급마다 다른 회색. 큰길은 가장자리 0.6m 를 한 톤 어둡게(연석 쪽 그늘) ──
{
  const foot = [], service = [], minorEdge = [], minor = [], link = [], majorEdge = [], major = [];
  const concrete = [], pavers = [], dirt = [];   // OSM surface 가 아스팔트가 아닌 길(roadcal.js 가 단 r.surf): 콘크리트·보도블록·흙
  const SURF = { concrete: concrete, 'concrete:plates': concrete, paving_stones: pavers, sett: pavers, dirt: dirt, ground: dirt, gravel: dirt, unpaved: dirt };
  for (const r of D.roads) {
    if (r.br || r.p.length < 2) continue;
    if (r.surf && SURF[r.surf]) { ribbon(r.p, r.w, 0, SURF[r.surf], true); continue; }
    if (r.ped || FOOT.has(r.k)) { ribbon(r.p, r.w, 0, foot, true); continue; }
    if (r.k === 'service') { ribbon(r.p, r.w, 0, service, true); continue; }
    if (MAJOR.has(r.k)) { ribbon(r.p, r.w, 0, majorEdge, true); ribbon(r.p, r.w - 1.2, 0, major, true); continue; }
    if (LINK.has(r.k)) { ribbon(r.p, r.w, 0, link, true); continue; }
    ribbon(r.p, r.w + 0.6, 0, minorEdge, true); ribbon(r.p, r.w, 0, minor, true);   // 골목: 0.3m 테두리로 블록과 경계
  }
  flat(foot, G.foot, 7.1, null, 'foot', TEX.paver);
  flat(service, G.service, 7.2, null, 'service', TEX.asphalt);
  flat(minorEdge, G.minorEdge, 7.3, null, 'minor-edge');
  flat(minor, G.minor, 7.4, null, 'minor', TEX.asphalt);
  flat(link, G.link, 7.45, null, 'link', TEX.asphalt);
  flat(majorEdge, G.majorEdge, 7.5, null, 'major-edge');
  flat(major, G.major, 7.6, null, 'major', TEX.asphalt);
  flat(concrete, '#c9cacb', 7.25, null, 'surf-concrete', TEX.slab);
  flat(pavers, G.foot, 7.25, null, 'surf-pavers', TEX.paver);
  flat(dirt, '#cdbfa6', 7.25, null, 'surf-dirt', TEX.dirt);
  stats.surfRoads = D.roads.filter(r => r.surf && SURF[r.surf]).length;
}

// ── 인도: 큰길 전체 폭 + 양쪽 2.5m 를 길 아래 순서로 깔면 길이 가운데를 덮어 양쪽 띠만 남는다 ──
{
  const pos = [];
  for (const m of majors) if (!m.r.br && m.r.sw !== false) ribbon(m.r.p, m.r.w + WALK_W * 2, 0, pos, true);   // r.sw: roadcal.js 가 단 인도 있음 표시(사람 걷는 자리와 같은 기준)
  flat(pos, G.walk, 3.5, null, 'walk', TEX.paver);   // 녹지(1~3) 위, 물(4)·길 아래
}

// ── 연석·중앙선·차선 ─────────────────────────────────────
{
  const center = [], lane = [], curb = { pos: [], nrm: [] };
  for (const m of majors) {
    const w = m.r.w, ow = !!m.r.ow, ln = m.r.ln || 0;
    const cwCut = (cwOn.get(m.ri) || []).map(c => [c.s - c.w / 2 - 2, c.s + c.w / 2 + 2]);   // 횡단보도 위와 앞뒤 2m 는 중앙선·차선 없음
    for (const [a, b] of openSpans(m, JUNC_CLEAR, cwCut)) {
      if (!ow) for (const [c0, c1] of cutSharp(m, a, b, 3)) { stripe(m, 0, 0.3, c0, c1, 0.03, center); stats.centerM += c1 - c0; }
      // 교차로 쪽 끝 18m 는 실선(진로변경 제한선), 그 사이는 3m 칠하고 5m 비우는 점선
      const SOLID = 18, sa = a > 0.5 ? Math.min(b, a + SOLID) : a, sb = b < m.w.L - 0.5 ? Math.max(sa, b - SOLID) : b;
      const sharp = sharpAt(m);
      const dash = (off) => {
        if (sa > a) for (const [c0, c1] of cutSharp(m, a, sa, 3)) { stripe(m, off, 0.15, c0, c1, 0.03, lane); stats.laneM += c1 - c0; }
        for (let s = sa; s + 3 <= sb; s += 8) { if (sharp.some(v => v > s - 3 && v < s + 6)) continue; stripe(m, off, 0.15, s, s + 3, 0.03, lane); stats.laneM += 3; }
        if (b > sb) for (const [c0, c1] of cutSharp(m, sb, b, 3)) { stripe(m, off, 0.15, c0, c1, 0.03, lane); stats.laneM += c1 - c0; }
      };
      const per = lanesPerDir(m.r);
      if (ow) for (let k = 1; k < per; k++) dash(-w / 2 + k * w / per);
      else for (let k = 1; k < per; k++) for (const sgn of [1, -1]) dash(sgn * k * (w / 2) / per);
    }
    // 연석: 차도 가장자리 바로 바깥 0.2m 폭, 15cm 솟은 상자(사람 눈높이에서 길 가장자리가 입체로 보이게). 교차로 앞뒤 8m 는 비움(교차로 입구. 큰길끼리 만나는 모서리는 아래에서 곡선으로 이음)
    const rampCut = (cwOn.get(m.ri) || []).filter(c => c.ramp).map(c => [c.s - c.w / 2, c.s + c.w / 2]);   // 보도턱낮춤여부 = Y 인 횡단보도 폭만큼 연석 없음
    if (!m.r.br) for (const [a, b] of openSpans(m, 8, rampCut)) for (const sgn of [1, -1]) for (const [c0, c1] of freeOfRoads(m, sgn * (w / 2 + 0.1), a, b)) { raised(m, sgn * (w / 2 + 0.1), 0.2, 0.15, c0, c1, curb.pos, curb.nrm); stats.curbM = (stats.curbM || 0) + (c1 - c0); }
  }
  // ── 교차로 모서리: 큰길끼리 만나는 모서리에서, 끊긴 연석(교차점에서 8m)을 곡선으로 잇고 곡선과 모서리 사이 쐐기는 아스팔트로 ──
  // 예전엔 인도 모서리가 직각이고 연석이 모서리를 돌지 않았다(11-27 근접 캡처). 곡선은 두 길 가장자리선이 만나는 점을 조절점으로 한 2차 베지어
  {
    const CUT = 8, arms = new Map(), wedge = [];
    for (const m of majors) if (!m.r.br && !m.ring) for (const j of m.js) {
      if (majorAt(j.p) < 3) continue;
      const k = key(j.p); let list = arms.get(k); if (!list) arms.set(k, list = []);
      for (const dir of [-1, 1]) {
        const s2 = j.s + dir * CUT; if (s2 < 0.5 || s2 > m.w.L - 0.5) continue;
        const q = m.w.at(s2), dx = q.x - j.p[0], dz = q.z - j.p[1], l = Math.hypot(dx, dz) || 1;
        list.push({ p: j.p, u: [dx / l, dz / l], h: m.r.w / 2, ri: m.ri });
      }
    }
    const cr = (a, b) => a[0] * b[1] - a[1] * b[0];
    const bez = (A, C, B, n) => { const out = []; for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; out.push([u * u * A[0] + 2 * u * t * C[0] + t * t * B[0], u * u * A[1] + 2 * u * t * C[1] + t * t * B[1]]); } return out; };
    let nc = 0;
    for (const list of arms.values()) {
      if (list.length < 2) continue;
      list.sort((a, b) => Math.atan2(a.u[1], a.u[0]) - Math.atan2(b.u[1], b.u[0]));
      for (let i = 0; i < list.length; i++) {
        const A = list[i], B = list[(i + 1) % list.length];
        let d = Math.atan2(B.u[1], B.u[0]) - Math.atan2(A.u[1], A.u[0]); if (d <= 0) d += Math.PI * 2;
        if (d < 0.35 || d > 2.97) continue;                                  // 20° 보다 좁거나 거의 일직선이면 모서리가 아님
        const nA = [-A.u[1], A.u[0]], nB = [-B.u[1], B.u[0]];
        const sA = (nA[0] * B.u[0] + nA[1] * B.u[1]) > 0 ? 1 : -1, sB = (nB[0] * A.u[0] + nB[1] * A.u[1]) > 0 ? 1 : -1;
        const line = (X, n, sg, h) => [X.p[0] + n[0] * sg * h, X.p[1] + n[1] * sg * h];
        const meet = (hA, hB) => {   // 두 가장자리선(가장자리에서 hA·hB 바깥)이 만나는 점과 각 선 위 거리
          const oA = line(A, nA, sA, hA), oB = line(B, nB, sB, hB), dd = [oB[0] - oA[0], oB[1] - oA[1]], den = cr(A.u, B.u);
          if (Math.abs(den) < 1e-6) return null;
          const t = cr(dd, B.u) / den, s2 = cr(dd, A.u) / den;
          return { C: [oA[0] + A.u[0] * t, oA[1] + A.u[1] * t], t, s: s2, oA, oB };
        };
        const e = meet(A.h, B.h), c = meet(A.h + 0.1, B.h + 0.1);
        if (!e || !c || e.t <= 0 || e.s <= 0 || e.t >= CUT - 0.3 || e.s >= CUT - 0.3) continue;
        // 모서리가 두 팔 말고 다른 차도 위면(중앙분리 도로의 반대 가닥 등) 그리지 않는다: 차도 한가운데 둥근 연석이 생겼다(11-27 거제대로)
        if (vehGrid(e.C[0], e.C[1], A.ri, B.ri)) continue;
        // 아스팔트 쐐기: 모서리점 C 에서 곡선까지 부채꼴
        const EA = [e.oA[0] + A.u[0] * CUT, e.oA[1] + A.u[1] * CUT], EB = [e.oB[0] + B.u[0] * CUT, e.oB[1] + B.u[1] * CUT];
        const crv = bez(EA, e.C, EB, 10);
        for (let k = 0; k < crv.length - 1; k++) wedge.push(e.C[0], 0, e.C[1], crv[k][0], 0, crv[k][1], crv[k + 1][0], 0, crv[k + 1][1]);
        // 곡선 연석(가운데선이 가장자리에서 0.1m 바깥)
        const CA = [c.oA[0] + A.u[0] * CUT, c.oA[1] + A.u[1] * CUT], CB = [c.oB[0] + B.u[0] * CUT, c.oB[1] + B.u[1] * CUT];
        const pts = bez(CA, c.C, CB, 12), w2 = walker(pts);
        raised({ w: w2 }, 0, 0.2, 0.15, 0, w2.L, curb.pos, curb.nrm, 0.5);
        nc++;
      }
    }
    flat(wedge, G.major, 7.58, null, 'corner', TEX.asphalt);
    stats.corners = nc;
  }
  {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(curb.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(curb.nrm, 3));
    const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: G.curb }));   // 깊이를 쓰는 입체라 앞면만, 순서는 바닥 표시(8.9) 다음
    mesh.renderOrder = 9.05; mesh.receiveShadow = true; mesh.castShadow = true; mesh.name = 'ground-curb'; scene.add(mesh); made.push(mesh);
  }
  flat(center, G.center, 8, '#2a2208', 'center');
  flat(lane, G.lane, 8, '#202020', 'lane');
}

// ── 주차장(OSM 실제 위치): 아스팔트 면만. 흰 테두리·주차 칸은 규칙으로 그린 것이라 지웠다(11-27 "실제 자료가 아닌 거는 없애자") ──
if (D.parking && D.parking.length) {
  const fill = [];
  const tri = (p, y, out) => {
    const v2 = p.map(q => new THREE.Vector2(q[0], q[1]));
    // 위를 보게 감는다(법선 +y). 반대로 감기면 DoubleSide 재질이 아래를 향한 면으로 빛을 받아 어둡게 나온다(decor.js 시절 주차장이 진했던 까닭)
    for (const t of THREE.ShapeUtils.triangulateShape(v2, [])) {
      const a = p[t[0]], b = p[t[1]], c = p[t[2]];
      const ny = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
      if (ny >= 0) out.push(a[0], y, a[1], b[0], y, b[1], c[0], y, c[1]); else out.push(a[0], y, a[1], c[0], y, c[1], b[0], y, b[1]);
    }
  };
  for (const pk of D.parking) if (pk.p.length >= 3) tri(pk.p, 0, fill);
  if (TON && LC) for (const pk of D.parking) { if (pk.p.length >= 3) paintQ.push([4.5, pk.p, G.parking, 'asphalt']); }
  else flat(fill, G.parking, 4.5, null, 'parking', TEX.asphalt);
  stats.parking = D.parking.length;
}

// ── 골목 가장자리선: 주거 도로 양쪽 0.2m, 교차로 앞뒤 3m 는 비움 ──
{
  const edge = [];
  D.roads.forEach((r, ri) => {
    if (!vehicle[ri] || MAJOR.has(r.k) || r.k !== 'residential' || r.br || r.p.length < 2) return;
    const w = walker(r.p), js = [];
    r.p.forEach((p, i) => { if (isJunction(p)) js.push({ s: w.cum[i] }); });
    const m = { r, w, js };
    for (const [a, b] of openSpans(m, 3)) for (const sgn of [1, -1]) { stripe(m, sgn * (r.w / 2 - 0.1), 0.2, a, b, 0.02, edge); stats.edgeM += b - a; }
  });
  flat(edge, G.edge, 8, null, 'alley-edge');
}

// ── 횡단보도(실제 자료): 공공데이터포털 전국횡단보도표준데이터(거제시, 기준일 2026-07-20) 중 좌표에 한 건뿐이고 차도 가장자리 3m 안인 것(개수는 FACILITIES.meta) ──
// 같은 좌표에 여러 건이 묶인 기록(지번 주소로 잡은 좌표로 보임)·차도에서 먼 기록은 자리를 알 수 없어 그리지 않는다(이유는 data/processed/okpo_crosswalks.csv).
// 줄무늬: 0.5m 막대·0.5m 틈을 길을 건너는 방향으로 늘어놓고, 막대 길이(길 방향)는 자료의 횡단보도폭. 건너는 길이는 그려진 차도 폭(자료의 횡단보도연장은 csv 에 남김)
// 점자블록은 자료에 '있음'인 곳만 양 끝 인도 쪽에. 정지선·화살표·신호등 자리는 자료에 없어 그리지 않는다
{
  const pos = [], tac = [], y = 0.03;
  const rect = (cx, cz, ax, az, nx, nz, hl, hw, yy, out) => {   // 가운데·길 방향 a·길 건너는 방향 n, 반길이 hl(a 쪽)·반폭 hw(n 쪽)
    const P = (u, v) => [cx + ax * u + nx * v, cz + az * u + nz * v], A = P(-hl, -hw), B = P(hl, -hw), C = P(hl, hw), D = P(-hl, hw);
    out.push(A[0], yy, A[1], B[0], yy, B[1], C[0], yy, C[1], A[0], yy, A[1], C[0], yy, C[1], D[0], yy, D[1]);
  };
  for (const c of CW) {
    // 건너는 길이는 지금 그려진 차도 폭(roadcal.js 가 바꿨으면 그 폭). seohogyun-20 보행 신호등도 c.span 을 쓰므로 여기서 맞춰 둔다
    if (D.roads[c.ri] && D.roads[c.ri].w) c.span = D.roads[c.ri].w;
    const ax = c.dx, az = c.dz, nx = -az, nz = ax, half = (c.span || 12) / 2 - 0.3, hl = (c.w || 4) / 2;
    for (let o = -half + 0.25; o <= half - 0.25 + 1e-6; o += 1.0) rect(c.x + nx * o, c.z + nz * o, ax, az, nx, nz, hl, 0.25, y, pos);
    if (c.tactile) for (const sg of [1, -1]) { const o = sg * ((c.span || 12) / 2 + 0.65); rect(c.x + nx * o, c.z + nz * o, ax, az, nx, nz, hl, 0.3, 0.028, tac); }
  }
  flat(pos, G.zebra, 8.9, '#3c3c3c', 'zebra');
  const dots = canvasTex(64, (g, n) => {   // 점형 점자블록: 노란 판에 돋은 점 4×4
    g.fillStyle = '#f2c94c'; g.fillRect(0, 0, n, n); g.fillStyle = 'rgba(160,110,0,0.55)';
    for (let yy = 0; yy < 4; yy++) for (let xx = 0; xx < 4; xx++) { g.beginPath(); g.arc(xx * 16 + 8, yy * 16 + 8, 4, 0, Math.PI * 2); g.fill(); }
  }, 0.3);
  flat(tac, '#ffffff', 8.9, null, 'tactile', dots);
  TEX.dots = dots;   // 정류장 점자블록도 같은 질감
  stats.crosswalks = CW.length; stats.tactile = CW.filter(c => c.tactile).length;
}

// ── 바다: 해안에서 멀어질수록 진해지는 색(격자에 꼭짓점 색), 해안 물거품 띠, 부두 안벽 ──
// app.js 의 물 메시는 숨기고(ea 허락, #55) 같은 모양을 바탕으로 다시 깐 뒤, 그 위에 깊이 색을 투명도로 얹는다.
{
  const HX = D.meta.half[0], HZ = D.meta.half[1];
  const onFrame = (a, b) => (Math.abs(Math.abs(a[0]) - HX) < 2 && Math.abs(Math.abs(b[0]) - HX) < 2) || (Math.abs(Math.abs(a[1]) - HZ) < 2 && Math.abs(Math.abs(b[1]) - HZ) < 2);
  const coast = [];                                   // 해안선 선분(지도 테두리에 걸친 변은 뺌)
  for (const wv of D.water) for (let i = 0; i < wv.p.length; i++) { const a = wv.p[i], b = wv.p[(i + 1) % wv.p.length]; if (!onFrame(a, b)) coast.push([a, b]); }
  // 바탕: 같은 모양 그대로
  const base = [];
  for (const wv of D.water) {
    const v2 = wv.p.map(q => new THREE.Vector2(q[0], q[1]));
    for (const t of THREE.ShapeUtils.triangulateShape(v2, [])) {
      const a = wv.p[t[0]], b = wv.p[t[1]], c = wv.p[t[2]], ny = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
      if (ny >= 0) base.push(a[0], 0, a[1], b[0], 0, b[1], c[0], 0, c[1]); else base.push(a[0], 0, a[1], c[0], 0, c[1], b[0], 0, b[1]);
    }
  }
  const bm = flat(base, G.water, 4, null, 'water', TEX.ripple); if (bm) bm.receiveShadow = false;
  // 깊이: 8m 격자, 칸 꼭짓점마다 해안까지 거리 → 투명도(해안 0, 140m 이상 0.42). 해안 근처는 투명이라 격자 계단이 안 보인다
  if (coast.length) {
    const cell = 8, pos = [], col = [];
    const xs = D.water.flatMap(w => w.p.map(q => q[0])), zs = D.water.flatMap(w => w.p.map(q => q[1]));
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    const deep = new THREE.Color('#3f78a8');
    const cg = segGrid(coast, 35);   // 140m 넘으면 같은 값이라 그 안만 찾는다
    const alpha = (x, z) => { const t = Math.min(1, cg.near(x, z, 140).d / 140); return 0.42 * t * t * (3 - 2 * t); };
    const memo = new Map(), A = (x, z) => { const k = x + ',' + z; let v = memo.get(k); if (v === undefined) memo.set(k, v = alpha(x, z)); return v; };
    for (let z = z0; z < z1; z += cell) { const cz = z + cell / 2, rows = D.water.map(w => rowCross(w.p, cz));
    for (let x = x0; x < x1; x += cell) {
      const cx = x + cell / 2;
      if (!rows.some(xs => inRow(xs, cx))) continue;
      const q = [[x, z], [x + cell, z], [x + cell, z + cell], [x, z + cell]];
      for (const i of [0, 2, 1, 0, 3, 2]) { const [px, pz] = q[i]; pos.push(px, 0.004 + (TON ? LIFT : 0), pz); col.push(deep.r, deep.g, deep.b, A(px, pz)); }
    } }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));   // [0,2,1]·[0,3,2] 순서라 이미 위(+y)를 본다
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    const nrm = new Float32Array(pos.length); for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1; g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    // 빛을 받는 재질이라 밤(ea #63 하루 빛)에는 함께 어두워진다
    const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: TON, polygonOffsetFactor: -2, polygonOffsetUnits: -8 }));
    mesh.renderOrder = 4.1; mesh.name = 'ground-water-depth'; scene.add(mesh); made.push(mesh);
    stats.waterCells = pos.length / 18;
  }
  // 물거품(물 쪽 1.8m, 반투명 흰색)과 안벽(뭍 쪽 1.2m 콘크리트): 해안선 선분마다 양쪽으로 띠
  {
    const foam = [], quay = [];
    const band = (a, b, off, wd, y, out) => {
      const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1, nx = -dz / L, nz = dx / L;
      const o0 = off - wd / 2, o1 = off + wd / 2;
      const p = (pt, o) => [pt[0] + nx * o, pt[1] + nz * o];
      const A0 = p(a, o0), A1 = p(a, o1), B0 = p(b, o0), B1 = p(b, o1);
      out.push(A0[0], y, A0[1], B0[0], y, B0[1], A1[0], y, A1[1], A1[0], y, A1[1], B0[0], y, B0[1], B1[0], y, B1[1]);
    };
    for (const [a, b] of coast) {
      // 선분 왼쪽(+법선)이 물인지 보고 방향을 정한다
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2, dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
      const wet = D.water.some(w => inPoly(mx - dz / L * 3, mz + dx / L * 3, w.p)) ? 1 : -1;
      band(a, b, wet * 0.9, 1.8, 0.008, foam);
      band(a, b, -wet * 0.6, 1.2, 0.006, quay);
    }
    flat(quay, '#c7c2b8', 4.2, null, 'quay');
    const fm = flat(foam, '#ffffff', 4.3, null, 'foam'); if (fm) { fm.material.transparent = true; fm.material.opacity = 0.55; fm.receiveShadow = false; }
    stats.coastM = Math.round(coast.reduce((t, [a, b]) => t + Math.hypot(b[0] - a[0], b[1] - a[1]), 0));
  }
  if (M.water) M.water.visible = false;
}

let edgeFollow = null;
// ── 지도 가장자리 흐리기(바닥): 자료가 끝나는 곳에서 안쪽 160m 까지 땅색으로 부드럽게 덮는다 ──
// 같은 식을 ea 의 건물에도 쓴다(__map.edgeFade 가 있으면 그것, 없으면 같은 식: smoothstep(0, 160, 가장자리까지 거리)).
{
  const HX = D.meta.half[0], HZ = D.meta.half[1], BAND = 160;
  const fade = (typeof M.edgeFade === 'function') ? M.edgeFade : (x, z) => { const d = Math.min(HX - Math.abs(x), HZ - Math.abs(z)); const t = Math.max(0, Math.min(1, d / BAND)); return t * t * (3 - 2 * t); };
  const c = new THREE.Color(G.ground), pos = [], col = [], step = TON ? 12 : 20;   // 지형이 켜지면 언덕을 따라가게 잘게
  const push = (x, z) => { pos.push(x, 0.05 + (TON ? TH(x, z) + LIFT : 0), z); col.push(1, 1, 1, 1 - fade(x, z)); };   // 색은 재질 쪽(배경색을 따라감)
  const quad = (xa, za, xb, zb) => { push(xa, za); push(xb, za); push(xb, zb); push(xa, za); push(xb, zb); push(xa, zb); };
  for (let x = -HX; x < HX; x += step) for (let z = -HZ; z < HZ; z += step) {
    const xb = Math.min(HX, x + step), zb = Math.min(HZ, z + step);
    if (Math.min(HX - Math.max(Math.abs(x), Math.abs(xb)), HZ - Math.max(Math.abs(z), Math.abs(zb))) > BAND) continue;   // 안쪽 칸은 건너뜀
    quad(x, z, xb, zb);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: c, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
    polygonOffset: TON, polygonOffsetFactor: -2, polygonOffsetUnits: -8 }));
  mesh.renderOrder = 8.95; mesh.name = 'ground-edge-fade'; scene.add(mesh); made.push(mesh);
  // 하루 빛(ea #63): 밤에는 배경·안개가 어두워지므로 이 띠도 배경색을 따라가야 지도 끝에 흰 띠가 남지 않는다
  // 그릴 때마다 배경색을 복사한다(map-light 는 밤 정도가 0.02 넘게 바뀔 때만 와서 노을 구간의 배경 변화를 다 따라가지 못함)
  const follow = () => { const bg = M.scene.background; if (bg && bg.isColor) mesh.material.color.copy(bg); };
  mesh.onBeforeRender = follow;
  edgeFollow = follow;
}

// 횡단보도·어린이보호구역 자리는 이제 없다. decor.js(신호등·볼라드·울타리)는 빈 배열이면 아무것도 세우지 않는다
window.__decor = window.__decor || {}; window.__decor.spots = window.__decor.spots || {};
window.__decor.spots.crosswalk = []; window.__decor.spots.crosswalkMinor = []; window.__decor.spots.school = [];

// app.js 의 옛 길 띠(보행로·골목·큰길 3겹)는 이 파일 포장으로 바꾼다. 땅 색도 바닥 위계에 맞춘다.
if (Array.isArray(M.roads)) for (const r of M.roads) if (r) r.visible = false;
// 빈 땅(바탕 평면)에는 질감을 넣지 않는다: 11-27 흙·콘크리트 잡음을 넣어 보니 따뜻한 바탕색·햇빛과 겹쳐 해안 빈 땅이 모래사장처럼 보였다
if (M.ground && M.ground.material) M.ground.material.color.set(G.ground);
if (M.scene.background && M.scene.background.isColor) M.scene.background.set(G.ground);
if (M.scene.fog) M.scene.fog.color.set(G.ground);
if (edgeFollow) edgeFollow();   // 낮 기준 배경을 정한 다음 한 번 맞춘다(밤이면 ea 가 바꾼 뒤 map-light 로 다시 맞춤)

// ── 닳은 페인트: 노면 표시(중앙선·차선·횡단보도)에 닳음 무늬를 투명도로 입혀 군데군데 아스팔트가 비치게 ──
// 바퀴가 지나는 자리가 더 닳는 것까지는 넣지 않았다(무늬는 3m 마다 되풀이). 투명 재질이 되어 투명 패스로 가지만, 그 뒤에 그리는 ea 띠(9.3~9.7)·흐름(9.5)도 투명이라 순서가 같다
{
  const worn = canvasTex(256, (g, n) => {
    const r = rng(61); g.fillStyle = '#ffffff'; g.fillRect(0, 0, n, n);
    // 처음 값(긁힘 1,800개·진하기 0.3~0.8)은 중간 높이에서 횡단보도가 얼룩덜룩 더러워 보여 크게 낮췄다(11-27 캡처)
    for (let i = 0; i < 18; i++) { const x = r() * n, y = r() * n, rad = 8 + r() * 24, a = 0.12 + r() * 0.18;   // 닳아 옅어진 자리
      const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, `rgba(0,0,0,${a})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, n, n); }
    for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(0,0,0,${0.15 + r() * 0.25})`; const s2 = 1 + r() * 1.5; g.fillRect(r() * n, r() * n, s2, s2); }   // 잔 긁힘
  }, 3);
  worn.encoding = THREE.LinearEncoding;   // 투명도로만 쓰므로 색 변환 없이
  let nw = 0;
  for (const nm of ['center', 'lane', 'zebra']) {
    const mesh = made.find(o => o.name === 'ground-' + nm); if (!mesh) continue;
    const P = mesh.geometry.attributes.position.array, uv = new Float32Array(P.length / 3 * 2), k = 1 / worn.userData.m;
    for (let i = 0, j = 0; i < P.length; i += 3, j += 2) { uv[j] = P[i] * k; uv[j + 1] = P[i + 2] * k; }
    mesh.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    mesh.material.alphaMap = worn; mesh.material.transparent = true; mesh.material.needsUpdate = true; nw++;
  }
  stats.wornMeshes = nw;
}

// ── 밤(ea 하루 빛 'map-light', document): 가로등을 받은 포장이 은은하게 빛나 멀리서도 도로망이 읽히게, 바다가 새까맣지 않게, 해안선이 보이게 ──
{
  const byName = (n) => made.find(m => m.name === 'ground-' + n);
  const GLOW = [   // [메시 이름, 밤 최대 발광색]: 큰길이 가장 밝고 골목·인도는 옅게
    // 가까이서 흙길처럼 보이지 않게 채도를 낮춘 회갈색(가로등 웅덩이는 decor.js 가 따로 더한다)
    ['major', '#4a463f'], ['major-edge', '#3f3b35'], ['link', '#423e38'], ['minor', '#38352f'], ['minor-edge', '#2f2c27'],
    ['service', '#2f2c27'], ['walk', '#3c3832'], ['foot', '#2f2c27'], ['parking', '#2f2c27'],
    ['water', '#1f3557'], ['water-depth', '#000000'], ['foam', '#7f95b3'], ['quay', '#4b5260'],
  ].map(([n, c]) => [byName(n), new THREE.Color(c)]).filter(([m]) => m);
  const base = new Map(GLOW.map(([m]) => [m, m.material.emissive.clone()]));
  const apply = (night) => {
    const k = Math.max(0, Math.min(1, night || 0));
    for (const [m, c] of GLOW) m.material.emissive.copy(base.get(m)).lerp(c, k);
    const fm = byName('foam'); if (fm) fm.material.opacity = 0.55 + 0.3 * k;
    M.need && M.need();
  };
  document.addEventListener('map-light', (e) => apply(e.detail && e.detail.night));
  apply(M.night || 0);
}
if (M.greens) for (const k of ['wood', 'green', 'pitch']) { const g = M.greens[k]; if (g && g.material) g.material.color.set(G[k]); }   // 지형이 켜지면 위에서 새로 그린 green-* 가 대신 보인
if (M.water && M.water.material) M.water.material.color.set(G.water);

// 버스 정류장 노면 상자·가로수 보호판은 규칙으로 놓은 것이라 지웠다(11-27 "실제 자료가 아닌 거는 없애자")

// ── 정류장 점자블록(실제 자료: OSM 정류장 tactile_paving=yes, seohogyun-20 이 load 뒤 window.__decor.spots.busTactile = [{ x, z, ri }]) ──
// 점자블록이 '있다'는 것만 자료다. 크기·모양은 일반형(정류장 쪽 연석 바로 뒤 인도에 길 방향 2m × 0.6m 점형 블록)으로 그린다
function busTactile() {
  const B = (window.__decor && window.__decor.spots && window.__decor.spots.busTactile) || [];
  if (!B.length || !TEX.dots) return;
  const pos = []; let n = 0;
  for (const b of B) {
    let best = null;
    const look = (i, r) => { for (let k = 0; k < r.p.length - 1; k++) { const d = segDist(b.x, b.z, r.p[k], r.p[k + 1]); if (!best || d < best.d) best = { d, a: r.p[k], c: r.p[k + 1], r }; } };
    if (b.ri != null && D.roads[b.ri]) look(b.ri, D.roads[b.ri]); else D.roads.forEach((r, i) => { if (vehicle[i] && r.p.length > 1) look(i, r); });
    if (!best || best.d > best.r.w / 2 + 8) continue;
    const dx = best.c[0] - best.a[0], dz = best.c[1] - best.a[1], L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L;
    const t = Math.max(0, Math.min(L, (b.x - best.a[0]) * ux + (b.z - best.a[1]) * uz)), px = best.a[0] + ux * t, pz = best.a[1] + uz * t;
    let nx = -uz, nz = ux; if ((b.x - px) * nx + (b.z - pz) * nz < 0) { nx = -nx; nz = -nz; }   // 정류장 쪽
    const off = best.r.w / 2 + 0.5, cx = px + nx * off, cz = pz + nz * off, y = 0.028;
    const P = (u, v) => [cx + ux * u + nx * v, cz + uz * u + nz * v], A = P(-1, -0.3), B2 = P(1, -0.3), C = P(1, 0.3), E = P(-1, 0.3);
    pos.push(A[0], y, A[1], B2[0], y, B2[1], C[0], y, C[1], A[0], y, A[1], C[0], y, C[1], E[0], y, E[1]); n++;
  }
  const m = flat(pos, '#ffffff', 8.9, null, 'bus-tactile', TEX.dots);
  if (m && M.groundPhotoOn && M.groundPhotoOn()) m.visible = false;   // 사진 바닥이면 숨김(사진에 이미 있음)
  if (window.__ground) window.__ground.busTactile = n;
  M.need && M.need();
}
if (document.readyState === 'complete') setTimeout(busTactile, 0); else addEventListener('load', () => setTimeout(busTactile, 0));   // decor.js 의 load 처리 다음

// ── 사진 바닥(정사영상, seohogyun-20 이 만드는 data/okpo_ortho.js → window.ORTHO = { img, src, year }): ?ground=photo 또는 __map.setGroundPhoto(true) ──
// 지형 면 그림을 사진으로 바꾸고, 사진에 이미 있는 길·인도·연석·노면 표시·물거품은 숨긴다(사진과 OSM 선이 어긋나 겹쳐 보이지 않게). 건물·이름표·흐름 띠는 그대로.
// 사진은 지형 격자 범위(x0 ~ x0+(nx-1)·cell, z0 ~ …)에 꽉 차고 위쪽이 북쪽이어야 한다. 자료가 없으면 아무것도 하지 않고 false
{
  // 물(바다 바탕·깊이 색)은 남긴다: 지형 면에 바다 칸이 없어(#131) 숨기면 바다가 비어 보였다
  const KEEP = new Set(['ground-terrain', 'ground-edge-fade', 'ground-water', 'ground-water-depth']);
  let photoTex = null, photoOn = false;
  const tm = made.find(m => m.name === 'ground-terrain');
  const apply = (on) => {
    for (const m of made) if (!KEEP.has(m.name)) m.visible = !on;
    tm.material.map = on ? photoTex : landTex; tm.material.needsUpdate = true;
    if (M.water) M.water.visible = false;
    photoOn = on; if (window.__ground) window.__ground.photo = on;
    if (M.renderer) M.renderer.shadowMap.needsUpdate = true; M.need && M.need();
    document.dispatchEvent(new CustomEvent('ground-photo', { detail: { on } }));
  };
  M.setGroundPhoto = (on) => {
    const O = window.ORTHO;
    if (!tm || !O || !O.img) return false;
    if (!on) { if (photoOn) apply(false); return true; }
    if (photoTex) { apply(true); return true; }
    new THREE.TextureLoader().load(O.img, (t) => {
      t.encoding = THREE.sRGBEncoding;
      if (M.renderer && M.renderer.capabilities) t.anisotropy = Math.min(8, M.renderer.capabilities.getMaxAnisotropy());
      photoTex = t; apply(true);
    }, undefined, () => console.warn('사진 바닥: 정사영상을 불러오지 못함', O.img));
    return true;
  };
  M.groundPhotoOn = () => photoOn;
  if (/[?&]ground=photo/.test(location.search)) M.setGroundPhoto(true);
}

// 지형 그림에 넓은 면을 순서대로 칠한다(토지 이용 0.5~ → 숲 1 → 잔디 2 → 놀이터 2.5 → 인조잔디 3 → 주차장 4.5)
if (TON && LC) { paintQ.sort((a, b) => a[0] - b[0]); for (const [, p, col, tk] of paintQ) paintArea(p, col, tk); stats.painted = paintQ.length; }
// 음영 기복(실제 땅 높이에서): 위에서 보면 해가 비탈을 약하게만 비춰 언덕이 잘 안 읽혀, 북서쪽 빛 기준 기복 음영을 지형 그림에 옅게 곱한다.
// 512² 로 계산해 늘려 깐다(부드러운 기복만, 길·건물 경계는 건드리지 않음). 세기 HS_K 는 해 그림자와 겹쳐 두 번 그늘지지 않게 옅게
const HS_K = 0.35;
if (TON && LC && window.TERRAIN) {
  const T = window.TERRAIN, N = 512, W = (T.nx - 1) * T.cell, Hh = (T.nz - 1) * T.cell, e = Math.max(W, Hh) / N;
  const cv = document.createElement('canvas'); cv.width = cv.height = N; const g = cv.getContext('2d'), im = g.createImageData(N, N), d = im.data;
  const lx = -0.6, lz = -0.6, ly = 0.53;   // 북서(위 왼쪽)에서 비추는 빛
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = T.x0 + (i + 0.5) / N * W, z = T.z0 + (j + 0.5) / N * Hh;
    const gx = (TH(x + e, z) - TH(x - e, z)) / (2 * e), gz = (TH(x, z + e) - TH(x, z - e)) / (2 * e), l = Math.hypot(gx, 1, gz);
    const sh = Math.max(0, (-gx * lx + ly - gz * lz) / l) / Math.hypot(lx, ly, lz);   // 0~1, 평지 ≈ 0.53/0.98
    const flatSh = ly / Math.hypot(lx, ly, lz), v = Math.max(0, Math.min(1, 1 + (sh - flatSh) * 1.6));   // 평지는 1(그대로), 빛 등진 비탈은 어둡게, 빛 받는 비탈은 1 위(잘림)
    const k = (j * N + i) * 4; d[k] = d[k + 1] = d[k + 2] = Math.round(255 * v); d[k + 3] = 255;
  }
  g.putImageData(im, 0, 0);
  LC.save(); LC.globalCompositeOperation = 'multiply'; LC.globalAlpha = HS_K; LC.imageSmoothingEnabled = true; LC.drawImage(cv, 0, 0, LC.canvas.width, LC.canvas.height); LC.restore();
}
if (TON && LC) landTex.needsUpdate = true;
if (M.renderer) M.renderer.shadowMap.needsUpdate = true;
M.need && M.need();

// 점검용(자동 시험이 읽음)
window.__ground = {
  meshes: made.length, majorRoads: majors.length, hidOld: Array.isArray(M.roads) ? M.roads.filter(r => r && !r.visible).length : 0,
  centerM: Math.round(stats.centerM), laneM: Math.round(stats.laneM), edgeM: Math.round(stats.edgeM), curbM: Math.round(stats.curbM || 0),
  crosswalks: stats.crosswalks || 0, tactile: stats.tactile || 0, rampCuts: [...cwOn.values()].flat().filter(c => c.ramp).length, onMajor: [...cwOn.values()].flat().length,
  parking: stats.parking, landuse: stats.landuse || 0, playgrounds: stats.playgrounds || 0, corners: stats.corners || 0,
  wornMeshes: stats.wornMeshes || 0, waterCells: stats.waterCells || 0, coastM: stats.coastM || 0, surfRoads: stats.surfRoads || 0,
  terrain: TON, groundTris: made.reduce((t, m) => t + (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3, 0) | 0,
};
})();
