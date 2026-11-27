/* 나무와 도로 표시(중앙선·차선·인도·횡단보도·정지선·골목 가장자리선·버스 정류장 쉼터) — app.js 다음에 불러온다.
   자료: window.MAP_DATA(roads·greens·buildings·water, tools/map_build.py). 그릴 곳: window.__map.scene.
   좌표: x = 동쪽(m), z = 남쪽(m), y = 위.
   주의: 나무·차선·횡단보도는 실제 위치가 아니라 보기 좋게 놓은 장식이다.
     - 가로수: OSM에 옥포 가로수 점 자료가 없어 큰길 양쪽에 12m 간격으로 놓았다.
     - 공원 나무: 녹지 다각형 안을 격자로 채웠다(종류마다 간격이 다름).
     - 횡단보도·정지선: 큰길끼리 만나는 곳에만 그렸다. 실제 횡단보도 위치는 확인하지 않았다.
     - 나무 모양(활엽·침엽·관목)과 비율도 가정이다. 버스 정류장 쉼터만 OSM 정류장 실제 위치(SIM_DATA.stops)다.
   난수는 씨앗을 고정해 화면이 열 때마다 같게 나온다. */
(() => {
'use strict';
const M = window.__map, D = window.MAP_DATA;
if (!M || !M.scene || !D || !window.THREE) return;   // app.js 가 scene 을 내보내기 전 판에서는 아무것도 하지 않는다
const scene = M.scene;
const HX = D.meta.half[0], HZ = D.meta.half[1];

// ── 색·치수 ───────────────────────────────────────────
const C = {
  trunk: '#7a5c3e', leafA: '#5f9e4f', leafB: '#7bb661',
  center: '#f2c94c', lane: '#ffffff', walk: '#f3f4f6', zebra: '#ffffff', curb: '#b9bfc8', edge: '#c4c9d1',
  coneA: '#3f7a4a', coneB: '#54905a', shrubA: '#6aa85a', shrubB: '#88c06c',
};
const MAJOR = new Set(['trunk', 'primary', 'secondary', 'tertiary']);          // 가로수·인도·중앙선을 그리는 큰길
const VEHICLE_SKIP = new Set(['service', 'footway', 'path', 'steps', 'cycleway', 'pedestrian', 'track']);
const MAX_TREES = 4000;
const WALK_W = 2.5;            // 인도 폭(m)
const STREET_GAP = 12;         // 가로수 간격(m)
const JUNC_CLEAR = 15;         // 교차로 앞뒤로 선을 비우는 길이(m)

// ── 도우미 ───────────────────────────────────────────
function rng(seed) {           // mulberry32: 씨앗 고정 난수
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rand = rng(20261127);
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
function bbox(p, pad) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const q of p) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < z0) z0 = q[1]; if (q[1] > z1) z1 = q[1]; }
  return [x0 - pad, z0 - pad, x1 + pad, z1 + pad];
}
// 격자 색인: 칸마다 항목 번호를 모아 두고, 점 근처 칸만 본다
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

// ── 건물·도로·물 색인 ───────────────────────────────────
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
const RG = grid(20);
D.roads.forEach((r, ri) => {
  for (let i = 0; i < r.p.length - 1; i++) RG.add(bbox([r.p[i], r.p[i + 1]], r.w / 2 + 4), [ri, i]);
});
function nearRoad(x, z, extra, skip) {
  for (const [ri, i] of RG.at(x, z)) {
    if (ri === skip) continue;
    const r = D.roads[ri];
    if (segDist(x, z, r.p[i], r.p[i + 1]) < r.w / 2 + extra) return true;
  }
  return false;
}
const inWater = (x, z) => D.water.some(w => inPoly(x, z, w.p));
const inside = (x, z, m) => Math.abs(x) < HX - m && Math.abs(z) < HZ - m;

// ── 교차로 찾기: 한 점에서 뻗어 나가는 길 가닥(차가 다니는 길)이 3개 이상이면 교차로 ──────────
// 길 끝점이면 1가닥, 길 중간 점이면 2가닥. 같은 길이 OSM에서 둘로 나뉜 곳(2가닥)은 교차로가 아니다.
const vehicle = D.roads.map(r => !r.ped && !VEHICLE_SKIP.has(r.k));
const arms = new Map();        // 점 → [전체 가닥, 큰길 가닥]
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

// 선 위의 거리(s)마다 위치·방향을 구하는 도우미
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
// 큰길마다 교차로 위치(선 위 거리)
const majors = [];
D.roads.forEach((r, ri) => {
  if (!MAJOR.has(r.k) || r.p.length < 2) return;
  const w = walker(r.p);
  const js = [];
  r.p.forEach((p, i) => { if (isJunction(p)) js.push({ s: w.cum[i], p, major: majorAt(p) }); });
  majors.push({ r, ri, w, js });
});

// ── 납작한 띠 만들기 ───────────────────────────────────
// 선 pts 를 왼쪽으로 off 만큼 옮긴 자리에 폭 wd 의 띠. s 구간 [s0,s1] 만.
function stripe(m, off, wd, s0, s1, y, out) {
  const step = 4;
  let prev = null;
  for (let s = s0; s <= s1 + 1e-6; s = Math.min(s1, s + step)) {
    const q = m.w.at(s);
    const cx = q.x + q.nx * off, cz = q.z + q.nz * off, h = wd / 2;
    const cur = [cx + q.nx * h, cz + q.nz * h, cx - q.nx * h, cz - q.nz * h];
    if (prev) out.push(prev[0], y, prev[1], cur[0], y, cur[1], prev[2], y, prev[3], prev[2], y, prev[3], cur[0], y, cur[1], cur[2], y, cur[3]);
    prev = cur;
    if (s >= s1) break;
  }
}
// 길 전체 폭(+인도) 띠: 꺾이는 곳은 이음 각도 제한(app.js 의 ribbon 과 같은 방식)
function ribbon(pts, w, y, out) {
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
}
function flat(pos, color, order) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const nrm = new Float32Array(pos.length); for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, depthWrite: false, side: THREE.DoubleSide }));
  m.renderOrder = order; m.receiveShadow = true; m.name = 'decor'; scene.add(m); return m;
}
// 교차로 앞뒤를 뺀 구간들
function openSpans(m, clear) {
  const cuts = m.js.map(j => [j.s - clear, j.s + clear]).sort((a, b) => a[0] - b[0]);
  const spans = []; let s = 0;
  for (const [a, b] of cuts) { if (a > s) spans.push([s, a]); s = Math.max(s, b); }
  if (s < m.w.L) spans.push([s, m.w.L]);
  return spans.filter(([a, b]) => b - a > 3);
}

// ── 인도: 큰길 전체 폭 + 양쪽 2.5m 를 길 아래 순서로 깔면 길이 가운데를 덮어 양쪽 띠만 남는다 ──
{
  const pos = [];
  for (const m of majors) if (!m.r.br) ribbon(m.r.p, m.r.w + WALK_W * 2, 0, pos);
  // 순서 3.5: 녹지(1~3) 위, 물(4)·길(5~7) 아래 → 바다 쪽으로 넘치지 않고, 만나는 길이 인도를 덮는다
  flat(pos, C.walk, 3.5);
}

// ── 중앙선·차선 ─────────────────────────────────────────
const stats = { centerM: 0, laneM: 0, crosswalks: 0, stopLines: 0 };
{
  const center = [], lane = [];
  for (const m of majors) {
    const w = m.r.w;
    for (const [a, b] of openSpans(m, JUNC_CLEAR)) {
      stripe(m, 0, 0.3, a, b, 0.03, center); stats.centerM += b - a;
      // 4차로 이상(폭 14m 이상)이면 방향마다 흰 점선: 3m 칠하고 5m 비움
      if (w >= 14) {
        const per = Math.max(2, Math.round(w / 2 / 3.3));       // 한 방향 차로 수
        for (let k = 1; k < per; k++) for (const sgn of [1, -1]) {
          const off = sgn * k * (w / 2) / per;
          for (let s = a; s + 3 <= b; s += 8) { stripe(m, off, 0.15, s, s + 3, 0.03, lane); stats.laneM += 3; }
        }
      }
    }
  }
  // 연석: 길 가장자리 양쪽 0.3m 진한 회색 선(길과 인도 경계가 또렷하게), 교차로 앞뒤 8m 는 비움
  const curb = [];
  for (const m of majors) if (!m.r.br) for (const [a, b] of openSpans(m, 8)) for (const sgn of [1, -1]) stripe(m, sgn * (m.r.w / 2 - 0.15), 0.3, a, b, 0.02, curb);
  flat(curb, C.curb, 8);
  flat(center, C.center, 8);
  if (lane.length) flat(lane, C.lane, 8);
}

// ── 골목 가장자리선: 큰길이 아닌 차도(골목) 양쪽 0.2m 진한 회색, 교차로 앞뒤 3m 는 비움 ──
{
  const edge = [];
  D.roads.forEach((r, ri) => {
    if (!vehicle[ri] || MAJOR.has(r.k) || r.k !== 'residential' || r.br || r.p.length < 2) return;
    const w = walker(r.p), js = [];
    r.p.forEach((p, i) => { if (isJunction(p)) js.push({ s: w.cum[i] }); });
    const m = { r, w, js };
    for (const [a, b] of openSpans(m, 3)) for (const sgn of [1, -1]) { stripe(m, sgn * (r.w / 2 - 0.1), 0.2, a, b, 0.02, edge); stats.edgeM = (stats.edgeM || 0) + (b - a); }
  });
  if (edge.length) flat(edge, C.edge, 8);
}

// ── 횡단보도·정지선: 큰길끼리 만나는 교차로에서, 교차로 앞 10m 자리에 길을 가로지르는 흰 줄 ──
// 정지선은 교차로로 들어오는 쪽 차로(우측 통행)에만, 횡단보도 바로 바깥에 0.45m.
{
  const pos = [], stop = [], done = new Set();
  for (const m of majors) for (const j of m.js) {
    if (j.major < 3) continue;
    for (const dir of [-1, 1]) {
      const s = j.s + dir * 10;
      if (s < 2 || s > m.w.L - 2) continue;
      const q = m.w.at(s), k = Math.round(q.x / 6) + ':' + Math.round(q.z / 6);
      if (done.has(k)) continue; done.add(k);
      // 줄 하나 = 길 방향 4m × 가로 0.5m, 0.5m 간격으로 길 폭만큼
      const half = m.r.w / 2 - 0.5;
      for (let o = -half; o <= half; o += 1.0) stripe(m, o, 0.5, s - 2, s + 2, 0.03, pos);
      stats.crosswalks++;
      // 선의 오른쪽 법선 = 진행 방향 오른쪽. 교차로로 들어오는 차는 -dir 방향으로 달리므로 그 오른쪽은 -dir 쪽
      const ss = s + dir * 3.5;
      if (ss > 0.5 && ss < m.w.L - 0.5) { stripe(m, -dir * m.r.w / 4, m.r.w / 2 - 0.4, ss - 0.225, ss + 0.225, 0.03, stop); stats.stopLines++; }
    }
  }
  if (pos.length) flat(pos, C.zebra, 9);
  if (stop.length) flat(stop, C.zebra, 9);
}

// ── 나무 자리 ─────────────────────────────────────────
// 모양: broad 둥근 활엽(잎 두 덩이), cone 원뿔 침엽(두 단), 관목은 따로(shrubs)
const trees = [];   // [x, z, 높이, 잎 반지름 비율, 종류, 모양]
// 가로수: 큰길 양쪽, 길 가장자리에서 1.5m 바깥(인도 안). 활엽만.
for (const m of majors) {
  if (m.r.br) continue;
  const off = m.r.w / 2 + 1.5;
  for (let s = STREET_GAP / 2; s < m.w.L; s += STREET_GAP) {
    if (m.js.some(j => Math.abs(j.s - s) < 12)) continue;                 // 교차로 가까이는 비움
    const q = m.w.at(s);
    for (const sgn of [1, -1]) {
      const x = q.x + q.nx * off * sgn, z = q.z + q.nz * off * sgn;
      if (!inside(x, z, 5) || inWater(x, z) || nearBuilding(x, z, 1.8) || nearRoad(x, z, 1.0, m.ri)) continue;
      trees.push([x, z, 6 + rand() * 1.5, 0.34, 'street', 'broad']);
    }
  }
}
// 녹지 안: 종류마다 [간격(m), 키 최소, 키 최대, 침엽 비율]
const GREEN = {
  wood: [8, 7, 10, 0.55], forest: [8, 7, 10, 0.55], park: [12, 6.5, 9, 0.15], garden: [12, 5, 7, 0.15],
  playground: [13, 6, 8, 0.1], meadow: [20, 6, 8, 0.2],
};
const greenTrees = { wood: [], other: [] };
for (const g of D.greens) {
  const spec = GREEN[g.k]; if (!spec) continue;           // pitch(운동장)·grass 는 비워 둔다, scrub 은 관목으로
  const [gap, h0, h1, coneP] = spec, b = bbox(g.p, 0);
  const off = rand() * gap;
  for (let x = b[0] + off; x < b[2]; x += gap) for (let z = b[1] + off; z < b[3]; z += gap) {
    const px = x + (rand() - 0.5) * gap * 0.7, pz = z + (rand() - 0.5) * gap * 0.7;
    if (!inPoly(px, pz, g.p) || !inside(px, pz, 5) || inWater(px, pz)) continue;
    if (nearBuilding(px, pz, 2.2) || nearRoad(px, pz, 1.5, -1)) continue;
    const shape = rand() < coneP ? 'cone' : 'broad';
    (g.k === 'wood' || g.k === 'forest' ? greenTrees.wood : greenTrees.other).push([px, pz, h0 + rand() * (h1 - h0), shape === 'cone' ? 0.24 : 0.38, g.k, shape]);
  }
}
// 4,000그루를 넘으면 숲부터 고르게 솎는다
trees.push(...greenTrees.other);
let wood = greenTrees.wood;
const room = MAX_TREES - trees.length;
if (wood.length > room) { const keep = Math.max(0, room) / wood.length; wood = wood.filter(() => rand() < keep).slice(0, Math.max(0, room)); }
trees.push(...wood);
if (trees.length > MAX_TREES) trees.length = MAX_TREES;

// 관목: 공원·정원·놀이터 가장자리 안쪽 1.3m 에 3.5m 간격, 덤불(scrub)은 안을 5m 격자로
const shrubs = [];   // [x, z, 크기]
const MAX_SHRUBS = 3000;
for (const g of D.greens) {
  if (shrubs.length >= MAX_SHRUBS) break;
  if (['park', 'garden', 'playground'].includes(g.k)) {
    const p = g.p;
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 2) continue;
      const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
      for (let s = 1.5; s < L - 1; s += 3.5) {
        let x = a[0] + dx * s - dz * 1.3, z = a[1] + dz * s + dx * 1.3;
        if (!inPoly(x, z, p)) { x = a[0] + dx * s + dz * 1.3; z = a[1] + dz * s - dx * 1.3; }   // 안쪽이 반대편이면 뒤집기
        if (!inPoly(x, z, p) || nearBuilding(x, z, 1.2) || nearRoad(x, z, 0.8, -1) || !inside(x, z, 5)) continue;
        shrubs.push([x, z, 1.0 + rand() * 0.9]);
      }
    }
  } else if (g.k === 'scrub') {
    const b = bbox(g.p, 0);
    for (let x = b[0]; x < b[2]; x += 5) for (let z = b[1]; z < b[3]; z += 5) {
      const px = x + (rand() - 0.5) * 3, pz = z + (rand() - 0.5) * 3;
      if (!inPoly(px, pz, g.p) || nearBuilding(px, pz, 1.2) || nearRoad(px, pz, 0.8, -1) || inWater(px, pz)) continue;
      shrubs.push([px, pz, 1.4 + rand() * 1.2]);
    }
  }
}
if (shrubs.length > MAX_SHRUBS) shrubs.length = MAX_SHRUBS;

// ── 나무 그리기 ─────────────────────────────────────────
const treeRefs = [];   // 나무마다 {x, z, parts: [[InstancedMesh, 번호]..]} — 나중에 버스 정류장 자리의 나무를 숨길 때 쓴다
function hideTreesNear(x, z, r) {
  const zero = new THREE.Matrix4().makeScale(0, 0, 0), touched = new Set(); let n = 0;
  for (const t of treeRefs) {
    if (Math.hypot(t.x - x, t.z - z) > r || !t.parts.length) continue;
    for (const [m, i] of t.parts) { m.setMatrixAt(i, zero); touched.add(m); }
    t.parts = []; n++;
  }
  for (const m of touched) m.instanceMatrix.needsUpdate = true;
  return n;
}
// InstancedMesh 4개: 줄기, 활엽 잎(나무마다 두 덩이), 침엽 잎(두 단 원뿔), 관목
{
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  const pal = (a, b) => [new THREE.Color(a), new THREE.Color(b)];
  const BROAD = pal(C.leafA, C.leafB), CONE = pal(C.coneA, C.coneB), SHRUB = pal(C.shrubA, C.shrubB);
  const broadIdx = [], coneIdx = [];
  trees.forEach((t, i) => (t[5] === 'cone' ? coneIdx : broadIdx).push(i));
  const broad = broadIdx.map(i => trees[i]), cone = coneIdx.map(i => trees[i]);
  const mk = (geo, color, n) => { const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color }), Math.max(1, n)); m.count = n; return m; };
  const meshes = [];
  trees.forEach(t => treeRefs.push({ x: t[0], z: t[1], parts: [] }));
  if (trees.length) {
    const trunkGeo = new THREE.CylinderGeometry(0.16, 0.24, 1, 6, 1); trunkGeo.translate(0, 0.5, 0);
    const trunk = mk(trunkGeo, C.trunk, trees.length);
    trees.forEach(([x, z, h, rr, , shape], i) => {
      const th = shape === 'cone' ? h * 0.3 : h * 0.45, tw = shape === 'cone' ? 1.1 : 1;
      pos.set(x, 0, z); scl.set(tw, th, tw); q.identity(); mtx.compose(pos, q, scl); trunk.setMatrixAt(i, mtx);
      treeRefs[i].parts.push([trunk, i]);
    });
    meshes.push(trunk);
  }
  if (broad.length) {
    // 잎 두 덩이: 큰 덩이 + 옆으로 비켜 난 작은 덩이(모양이 공 하나로 보이지 않게)
    const leaf = mk(new THREE.IcosahedronGeometry(1, 1), '#ffffff', broad.length * 2);
    broad.forEach(([x, z, h, rr], i) => {
      const r = h * rr, base = col.copy(BROAD[0]).lerp(BROAD[1], rand()).clone();
      const sy = 0.85 + rand() * 0.25;
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      pos.set(x, h - r * sy, z); scl.set(r, r * sy, r); mtx.compose(pos, q, scl); leaf.setMatrixAt(i * 2, mtx); leaf.setColorAt(i * 2, base);
      const a = rand() * Math.PI * 2, r2 = r * (0.55 + rand() * 0.15);
      pos.set(x + Math.cos(a) * r * 0.55, h - r * sy * 1.05 + r * 0.1, z + Math.sin(a) * r * 0.55); scl.set(r2, r2 * 0.9, r2);
      mtx.compose(pos, q, scl); leaf.setMatrixAt(i * 2 + 1, mtx); leaf.setColorAt(i * 2 + 1, col.copy(base).multiplyScalar(0.93));
      treeRefs[broadIdx[i]].parts.push([leaf, i * 2], [leaf, i * 2 + 1]);
    });
    meshes.push(leaf);
  }
  if (cone.length) {
    // 침엽: 원뿔 두 단(아래가 넓고 위가 좁게)
    const coneGeo = new THREE.ConeGeometry(1, 1, 8, 1); coneGeo.translate(0, 0.5, 0);
    const needle = mk(coneGeo, '#ffffff', cone.length * 2);
    cone.forEach(([x, z, h, rr], i) => {
      const r = h * rr, c = col.copy(CONE[0]).lerp(CONE[1], rand()).clone();
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      pos.set(x, h * 0.22, z); scl.set(r, h * 0.55, r); mtx.compose(pos, q, scl); needle.setMatrixAt(i * 2, mtx); needle.setColorAt(i * 2, c);
      pos.set(x, h * 0.5, z); scl.set(r * 0.72, h * 0.5, r * 0.72); mtx.compose(pos, q, scl); needle.setMatrixAt(i * 2 + 1, mtx); needle.setColorAt(i * 2 + 1, c);
      treeRefs[coneIdx[i]].parts.push([needle, i * 2], [needle, i * 2 + 1]);
    });
    meshes.push(needle);
  }
  if (shrubs.length) {
    const bush = mk(new THREE.IcosahedronGeometry(1, 1), '#ffffff', shrubs.length);
    shrubs.forEach(([x, z, sz], i) => {
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      pos.set(x, sz * 0.38, z); scl.set(sz * 0.6, sz * 0.45, sz * 0.6); mtx.compose(pos, q, scl); bush.setMatrixAt(i, mtx);
      bush.setColorAt(i, col.copy(SHRUB[0]).lerp(SHRUB[1], rand()));
    });
    meshes.push(bush);
  }
  for (const m of meshes) {
    m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.castShadow = true; m.receiveShadow = false; m.renderOrder = 10; m.name = 'decor-trees';
    m.computeBoundingSphere && m.computeBoundingSphere();
    scene.add(m);
  }
  stats.broad = broad.length; stats.cone = cone.length; stats.shrubs = shrubs.length;
}

// ── 버스 정류장 쉼터: SIM_DATA.stops(OSM 버스 정류장 실제 위치). sim 자료가 decor 뒤에 불러와지므로 load 뒤에 그린다 ──
function busStops() {
  const S = window.SIM_DATA && window.SIM_DATA.stops; if (!S || !S.length || !THREE.BufferGeometryUtils) return;
  const parts = [];
  const box = (w, h, d, x, y, z, rot, cx, cz, color) => {
    const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); g.rotateY(rot); g.translate(cx, 0, cz);
    const c = new THREE.Color(color), n = g.attributes.position.count, cols = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3)); parts.push(g.toNonIndexed ? g.toNonIndexed() : g);
  };
  for (const st of S) {
    // 가장 가까운 차도 선분의 방향으로 돌리고, 정류장 점이 있는 쪽 길 가장자리 바깥 1.2m 에 둔다
    let best = null, bd = Infinity;
    for (const [ri, i] of RG.at(st.x, st.z)) {
      if (!vehicle[ri]) continue;
      const r = D.roads[ri], d = segDist(st.x, st.z, r.p[i], r.p[i + 1]);
      if (d < bd) { bd = d; best = [r, i]; }
    }
    let rot = 0, cx = st.x, cz = st.z;
    if (best && bd < 25) {
      const [r, i] = best, a = r.p[i], b = r.p[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L;
      const t = Math.max(0, Math.min(L, (st.x - a[0]) * dx + (st.z - a[1]) * dz));
      const px = a[0] + dx * t, pz = a[1] + dz * t, nx = -dz, nz = dx;
      const side = ((st.x - px) * nx + (st.z - pz) * nz) >= 0 ? 1 : -1;
      const off = r.w / 2 + 1.2;
      cx = px + nx * off * side; cz = pz + nz * off * side;
      rot = -Math.atan2(dz, dx);
      if (side < 0) rot += Math.PI;   // 쉼터 등판이 길 반대쪽(인도 안쪽)으로 가게
    }
    stats.hiddenTrees = (stats.hiddenTrees || 0) + hideTreesNear(cx, cz, 4.5);   // 쉼터·표지 기둥과 겹치는 가로수는 숨긴다
    // 지붕·등판·기둥 2개·표지 기둥·표지판
    box(3.4, 0.12, 1.5, 0, 2.5, 0.1, rot, cx, cz, '#5b6573');
    box(3.2, 1.9, 0.06, 0, 1.25, 0.8, rot, cx, cz, '#cfe0ec');
    box(0.1, 2.5, 0.1, -1.55, 1.25, 0.8, rot, cx, cz, '#5b6573');
    box(0.1, 2.5, 0.1, 1.55, 1.25, 0.8, rot, cx, cz, '#5b6573');
    box(0.08, 2.9, 0.08, 2.3, 1.45, -0.4, rot, cx, cz, '#5b6573');
    box(0.55, 0.55, 0.06, 2.3, 2.75, -0.4, rot, cx, cz, '#2f3b4a');
  }
  const geo = THREE.BufferGeometryUtils.mergeBufferGeometries(parts, false);
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.renderOrder = 10; mesh.name = 'decor-bus';
  scene.add(mesh);
  stats.busStops = S.length;
  if (window.__decor) { window.__decor.busStops = S.length; window.__decor.hiddenTrees = stats.hiddenTrees || 0; }
  if (M.renderer) M.renderer.shadowMap.needsUpdate = true;
  M.need && M.need();
}
if (document.readyState === 'complete') busStops(); else addEventListener('load', busStops);

// 그림자는 한 번만 계산하는 설정이라(app.js) 나무를 넣었으니 다시 계산하게 한다
if (M.renderer) M.renderer.shadowMap.needsUpdate = true;
M.need && M.need();

// 점검용(자동 시험이 읽음)
window.__decor = {
  trees: trees.length,
  street: trees.filter(t => t[4] === 'street').length,
  green: trees.filter(t => t[4] !== 'street').length,
  broad: stats.broad || 0, cone: stats.cone || 0, shrubs: stats.shrubs || 0,
  centerM: Math.round(stats.centerM), laneM: Math.round(stats.laneM), edgeM: Math.round(stats.edgeM || 0),
  crosswalks: stats.crosswalks, stopLines: stats.stopLines, busStops: stats.busStops || 0,
  majorRoads: majors.length,
};
})();
