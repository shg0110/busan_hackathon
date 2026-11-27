/* 녹지의 나무·관목, 버스 정류장 쉼터, 지도 밖 큰 곳 방향 이름표 — app.js 다음에 불러온다. (바닥 표시는 ground.js)
   자료: window.MAP_DATA(roads·greens·buildings·water·places, tools/map_build.py). 그릴 곳: window.__map.scene.
   좌표: x = 동쪽(m), z = 남쪽(m), y = 위.
   원칙(2026-11-27 사용자 '실제 자료가 아닌 거는 없애자'): 자료에 없는데 규칙·무작위로 놓던 물건은 지웠다.
     지운 것: 가로수 1,381, 가로등 550, 신호등 63, 볼라드 326, 도로명판 79, 전봇대 450·전선 352, 어린이보호구역 울타리 기둥 278·표지판,
              놀이기구(그네 19·미끄럼틀 20), 벤치 22·화분 21, 바다 이름 '옥포만'(물 자료에 이름 없음).
     남긴 것:
     - 버스 정류장 쉼터: OSM 정류장 실제 위치(SIM_DATA.stops). 쉼터 모양은 일반형이다.
     - 녹지(OSM 공원·숲·놀이터·덤불 면) 안의 나무·관목: 녹지를 나타내는 그림이다. 한 그루씩의 자리·모양·색(11월 말)은 실제가 아니다.
     - '한화오션 옥포조선소 방향' 이름표: OSM 지명이 지도 밖에 있어 가장자리에 방향으로 보인다.
   난수는 씨앗을 고정해 화면이 열 때마다 같게 나온다. */
(() => {
'use strict';
const M = window.__map, D = window.MAP_DATA;
if (!M || !M.scene || !D || !window.THREE) return;   // app.js 가 scene 을 내보내기 전 판에서는 아무것도 하지 않는다
const scene = M.scene;
const HX = D.meta.half[0], HZ = D.meta.half[1];

// ── 색·치수 ───────────────────────────────────────────
const C = {
  trunk: '#6b5440', leaf: ['#4e7c45', '#5b8a4f', '#68975a', '#77a465'],
  center: '#f2c94c', lane: '#ffffff', walk: '#e6e9ed', zebra: '#ffffff', curb: '#9aa2ac', edge: '#aeb5bf',
  parking: '#d3d8de', coneA: '#3e6a47', coneB: '#4e7b53', shrubA: '#5c8b50', shrubB: '#73a062',
};
const MAJOR = new Set(['trunk', 'primary', 'secondary', 'tertiary']);          // 가로수·인도·중앙선을 그리는 큰길
const VEHICLE_SKIP = new Set(['service', 'footway', 'path', 'steps', 'cycleway', 'pedestrian', 'track']);
const MAX_TREES = 6500;
const WALK_W = 2.5;            // 인도 폭(m)
const STREET_GAP = 10;         // 가로수 간격(m)
const JUNC_CLEAR = 15;         // 교차로 앞뒤로 선을 비우는 길이(m)

// ── 도우미 ───────────────────────────────────────────
function rng(seed) {           // mulberry32: 씨앗 고정 난수
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rand = rng(20261127);
const key = (p) => p[0].toFixed(1) + ',' + p[1].toFixed(1);
function polyArea(p) { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s / 2); }
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
  // 회전교차로: 처음과 끝이 같은 일방 고리. 원 안 차로에는 횡단보도·정지선을 그리지 않는다.
  const ring = !!r.ow && Math.hypot(r.p[0][0] - r.p[r.p.length - 1][0], r.p[0][1] - r.p[r.p.length - 1][1]) < 1;
  majors.push({ r, ri, w, js, ring });
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
function flat(pos, color, order, glow) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const nrm = new Float32Array(pos.length); for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, depthWrite: false, side: THREE.DoubleSide, emissive: glow || '#000000' }));
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

// ── 바닥 표시(인도·연석·중앙선·차선·주차장·골목 가장자리선·횡단보도·정지선)는 ground.js 로 옮겼다(2026-11-27, seohogyun-31).
//    횡단보도 자리는 ground.js 가 아래 spots.crosswalk 배열에 채운다([x, z, 길 폭]).
const stats = { centerM: 0, laneM: 0, crosswalks: 0, stopLines: 0 };
const spots = { crosswalk: [], bus: [] };   // 다른 파일(주차된 차 등)이 피할 자리: [x, z, 길 폭] / [x, z]

// ── 나무 자리 ─────────────────────────────────────────
// 모양: broad 둥근 활엽(잎 두 덩이), cone 원뿔 침엽(두 단), 관목은 따로(shrubs)
const trees = [];   // [x, z, 높이, 잎 반지름 비율, 종류, 모양]
// 가로수는 그리지 않는다(2026-11-27 사용자 '실제 자료가 아닌 거는 없애자'): 나무 한 그루씩의 위치 자료가 없다.
// 녹지(OSM 공원·숲·놀이터 면) 안을 채운 나무·관목은 녹지를 나타내는 그림으로 남긴다(한 그루씩의 자리는 실제가 아님, 범례에 밝힘).
// 녹지 안: 종류마다 [간격(m), 키 최소, 키 최대, 침엽 비율]
const GREEN = {
  wood: [8.5, 10, 14, 0.45], forest: [8.5, 10, 14, 0.45], park: [9, 8.5, 11.5, 0.15], garden: [9, 6.5, 9, 0.15],
  playground: [10, 7.5, 10.5, 0.1], meadow: [15, 7.5, 10.5, 0.2],
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
    if (g.k === 'playground' && polyArea(g.p) <= 800) {   // 놀이터는 가운데(놀이 공간, 31의 고무칩 바닥)를 비우고 나무는 가장자리 3m 띠에만. 800㎡ 넘는 곳은 공원 전체가 놀이터로 표시된 것이라 공원처럼
      let e = Infinity; for (let i = 0; i < g.p.length; i++) e = Math.min(e, segDist(px, pz, g.p[i], g.p[(i + 1) % g.p.length]));
      if (e > 3) continue;
    }
    const shape = rand() < coneP ? 'cone' : 'broad';
    const isWood = g.k === 'wood' || g.k === 'forest';
    (isWood ? greenTrees.wood : greenTrees.other).push([px, pz, h0 + rand() * (h1 - h0), shape === 'cone' ? (isWood ? 0.27 : 0.24) : (isWood ? 0.46 : 0.38), g.k, shape]);
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
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
function hideTreesNear(x, z, r) {
  const zero = ZERO, touched = new Set(); let n = 0;
  nearProp(x, z, 0);   // 격자에 새 항목 넣기
  const list = r > 4 ? treeRefs : [];
  if (r <= 4) { const cx = Math.floor(x / 4), cz = Math.floor(z / 4); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const a = PG.get(pgKey(cx + i, cz + j)); if (a) list.push(...a); } }
  for (const t of list) {
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
  const LEAF = C.leaf.map(h => new THREE.Color(h)), CONE = pal(C.coneA, C.coneB), SHRUB = pal(C.shrubA, C.shrubB);
  const broadIdx = [], coneIdx = [];
  trees.forEach((t, i) => (t[5] === 'cone' ? coneIdx : broadIdx).push(i));
  const broad = broadIdx.map(i => trees[i]), cone = coneIdx.map(i => trees[i]);
  const mk = (geo, color, n, flat) => { const m = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color, vertexColors: !!geo.attributes.color, flatShading: !!flat }), Math.max(1, n)); m.count = n; return m; };
  // 잎 덩이를 매끈한 공(플라스틱처럼 보임)이 아니게: 꼭짓점을 반지름 방향으로 ±amp 흔들고(같은 자리 꼭짓점은 같은 값이라 틈 없음), 면마다 밝기를 조금씩 다르게
  const hash = (x, y, z) => { const v = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453; return v - Math.floor(v); };
  const lumpy = (geo, amp, seed = 0) => {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + amp * (hash(+x.toFixed(3) + seed * 7.3, +y.toFixed(3), +z.toFixed(3) - seed * 3.1) * 2 - 1); p.setXYZ(i, x * k, y * k, z * k); }
    geo.computeVertexNormals(); return geo;
  };
  const mottle = (geo, amt, seed = 0) => {   // shade() 뒤에: 세 꼭짓점(한 면)마다 같은 무작위 배율
    const c = geo.attributes.color;
    for (let f = 0; f + 2 < c.count; f += 3) { const k = 1 + amt * (hash(f * 0.37, 1.3 + seed, 2.1) * 2 - 1); for (let j = 0; j < 3; j++) c.setXYZ(f + j, c.getX(f + j) * k, c.getY(f + j) * k, c.getZ(f + j) * k); }
    return geo;
  };
  // 높이에 따라 밝기를 바꾸는 꼭짓점 색: 아래 lo배 → 위 hi배(인스턴스 색과 곱해진다)
  const shade = (geo, lo, hi) => {
    const p = geo.attributes.position, n = p.count; geo.computeBoundingBox();
    const y0 = geo.boundingBox.min.y, y1 = geo.boundingBox.max.y, c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { const t = (p.getY(i) - y0) / ((y1 - y0) || 1), k = lo + (hi - lo) * Math.pow(t, 0.8); c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = k; }
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3)); return geo;
  };
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
    // 잎 세 덩이: 가운데 큰 덩이 + 양옆으로 비켜 난 덩이 둘(풍성하게, 공 하나로 보이지 않게)
    // 잎 덩이 모양은 세 가지(흔드는 씨앗이 다름)를 나무마다 돌려 쓴다 → 같은 공을 돌려 쓴 티가 덜 난다
    // 색은 11월 말(자료를 모은 때): 상록 위주에 일부만 물든다(장식).
    //   주황·빨강은 '가게 없는 층'·'문 닫은 가게' 색이라 단풍에도 쓰지 않는다
    const NV = 3, cnt = [0, 0, 0];
    broad.forEach((t, i) => cnt[i % NV]++);
    const leafs = [0, 1, 2].map(v => mk(mottle(shade(lumpy(new THREE.IcosahedronGeometry(1, 1), 0.15, v + 1), 0.62, 1.08), 0.09, v), '#ffffff', cnt[v] * 3, true));
    const at = [0, 0, 0];
    const GINKGO = ['#c4b452', '#cfbd5f', '#b9a84c'].map(h => new THREE.Color(h));
    const OLIVE = ['#8e9a4c', '#9c9a52'].map(h => new THREE.Color(h));
    const pick = (A) => A[Math.floor(rand() * A.length)].clone();
    broad.forEach(([x, z, h, rr], i) => {
      const v = i % NV, leaf = leafs[v], b = at[v]++ * 3;
      const r = h * rr, k = Math.floor(rand() * LEAF.length), green = LEAF[k].clone().lerp(LEAF[Math.min(LEAF.length - 1, k + 1)], rand() * 0.5);
      const u = rand();
      // 공원·숲: 초록 72% · 올리브 18% · 노랑 10%. 노랑은 초록빛 쪽으로 낮췄다(햇빛과 곱해지면 주황으로 보이고, '고른 거리' 노란 선과 섞였다)
      const base = u < 0.72 ? green : u < 0.9 ? pick(OLIVE) : pick(GINKGO);
      const turning = !base.equals(green);
      const sy = 0.82 + rand() * 0.22;
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      pos.set(x, h - r * sy, z); scl.set(r, r * sy, r); mtx.compose(pos, q, scl); leaf.setMatrixAt(b, mtx); leaf.setColorAt(b, base);
      const a0 = rand() * Math.PI * 2;
      for (let s2 = 1; s2 <= 2; s2++) {
        const a = a0 + s2 * (2.2 + rand() * 0.6), r2 = r * (0.6 + rand() * 0.14), up2 = s2 === 1 ? 0.18 : -0.12;
        pos.set(x + Math.cos(a) * r * 0.58, h - r * sy + r * up2, z + Math.sin(a) * r * 0.58); scl.set(r2, r2 * 0.9, r2);
        mtx.compose(pos, q, scl); leaf.setMatrixAt(b + s2, mtx);
        // 물드는 나무는 아래 덩이 하나를 덜 물든 색으로(한 그루 안에서도 바뀌는 중인 느낌)
        col.copy(base).multiplyScalar(s2 === 1 ? 1.06 : 0.92); if (turning && s2 === 2) col.lerp(green, 0.35);
        leaf.setColorAt(b + s2, col);
      }
      treeRefs[broadIdx[i]].parts.push([leaf, b], [leaf, b + 1], [leaf, b + 2]);
    });
    meshes.push(...leafs);
  }
  if (cone.length) {
    // 침엽: 원뿔 두 단(아래가 넓고 위가 좁게)
    const coneGeo = new THREE.ConeGeometry(1, 1, 8, 1).toNonIndexed(); coneGeo.translate(0, 0.5, 0); mottle(shade(coneGeo, 0.68, 1.05), 0.07);
    const needle = mk(coneGeo, '#ffffff', cone.length * 2, true);
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
    const bush = mk(mottle(shade(lumpy(new THREE.IcosahedronGeometry(1, 1), 0.16), 0.66, 1.06), 0.1), '#ffffff', shrubs.length, true);
    shrubs.forEach(([x, z, sz], i) => {
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      pos.set(x, sz * 0.38, z); scl.set(sz * 0.6, sz * 0.45, sz * 0.6); mtx.compose(pos, q, scl); bush.setMatrixAt(i, mtx);
      bush.setColorAt(i, col.copy(SHRUB[0]).lerp(SHRUB[1], rand()));
      treeRefs.push({ x, z, parts: [[bush, i]], shrub: true });   // 놀이기구·정류장 자리의 관목도 숨길 수 있게(소품 자리 다툼에는 안 셈)
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

// 나무·소품 자리 찾기: 4m 칸 격자(treeRefs 는 뒤에 붙기만 하므로 새로 붙은 것만 칸에 넣는다). 전엔 부를 때마다 7천 개를 다 훑었다
const PG = new Map(); let pgN = 0;
const pgKey = (cx, cz) => cx * 100003 + cz;
function nearProp(x, z, r) {
  for (; pgN < treeRefs.length; pgN++) { const t = treeRefs[pgN], k = pgKey(Math.floor(t.x / 4), Math.floor(t.z / 4)); let a = PG.get(k); if (!a) PG.set(k, a = []); a.push(t); }
  const hit = (t) => !t.shrub && (t.parts.length || t.prop) && Math.abs(t.x - x) < r && Math.abs(t.z - z) < r && Math.hypot(t.x - x, t.z - z) < r;
  if (r > 4) return treeRefs.some(hit);
  const cx = Math.floor(x / 4), cz = Math.floor(z / 4);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const a = PG.get(pgKey(cx + i, cz + j)); if (a && a.some(hit)) return true; }
  return false;
}

// 상자 여러 개를 한 덩어리로(정류장 쉼터). 상자마다 색을 꼭짓점 색으로 넣는다.
function boxPart(parts, w, h, d, x, y, z, rot, cx, cz, color) {
  const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); g.rotateY(rot); g.translate(cx, 0, cz);
  const c = new THREE.Color(color), n = g.attributes.position.count, cols = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3)); parts.push(g.toNonIndexed ? g.toNonIndexed() : g);
}
function addMerged(parts, name) {
  if (!parts.length || !THREE.BufferGeometryUtils) return null;
  const mesh = new THREE.Mesh(THREE.BufferGeometryUtils.mergeBufferGeometries(parts, false), new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.renderOrder = 10; mesh.name = name; scene.add(mesh); return mesh;
}
// 점에서 가장 가까운 차도 선분: {r, px, pz, nx, nz, side, rot} (rot: 길 방향이 상자 x 축이 되게)

// ── 버스 정류장 쉼터: SIM_DATA.stops(OSM 버스 정류장 실제 위치). sim 자료가 decor 뒤에 불러와지므로 load 뒤에 그린다 ──
function busStops() {
  const S = window.SIM_DATA && window.SIM_DATA.stops; if (!S || !S.length || !THREE.BufferGeometryUtils) return;
  const parts = [];
  const box = (...args) => boxPart(parts, ...args);
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
    stats.hiddenTrees = (stats.hiddenTrees || 0) + hideTreesNear(cx, cz, 4.5);
    spots.bus.push([+cx.toFixed(1), +cz.toFixed(1)]);   // 쉼터·표지 기둥과 겹치는 가로수는 숨긴다
    // 지붕·등판·기둥 2개·표지 기둥·표지판
    box(3.4, 0.12, 1.5, 0, 2.5, 0.1, rot, cx, cz, '#5b6573');
    box(3.2, 1.9, 0.06, 0, 1.25, 0.8, rot, cx, cz, '#cfe0ec');
    box(0.1, 2.5, 0.1, -1.55, 1.25, 0.8, rot, cx, cz, '#5b6573');
    box(0.1, 2.5, 0.1, 1.55, 1.25, 0.8, rot, cx, cz, '#5b6573');
    box(0.08, 2.9, 0.08, 2.3, 1.45, -0.4, rot, cx, cz, '#5b6573');
    box(0.55, 0.55, 0.06, 2.3, 2.75, -0.4, rot, cx, cz, '#2f3b4a');
  }
  addMerged(parts, 'decor-bus');
  stats.busStops = S.length;
  if (window.__decor) { window.__decor.busStops = S.length; window.__decor.hiddenTrees = stats.hiddenTrees || 0; }
  if (M.renderer) M.renderer.shadowMap.needsUpdate = true;
  M.need && M.need();
}
// ── 신호등: 공공데이터포털 표준데이터의 실제 자리에만 세운다(window.FACILITIES, seohogyun-31 이 만듦) ──
//   차량·보행 = 전국신호등표준데이터 좌표(signals), 보행 = 전국횡단보도표준데이터 '보행자신호등유무'가 있음인 횡단보도 양 끝(crosswalks)
// 자료에 방향이 없어서 기둥은 가장 가까운 차도 쪽을 보게 돌린다. 1.5m 안에 몰린 신호등은 한 기둥으로 묶는다.
// 차량 신호등: 6m 기둥 + 길 쪽 팔 + 가로형 3구. 보행 신호등: 3m 기둥 + 2구. 켜진 불(초록/빨강)은 그림이다
function nearVehicleRoad(x, z, maxD) {
  let best = null, bd = Infinity;
  for (const [ri, i] of RG.at(x, z)) {
    if (!vehicle[ri]) continue;
    const r = D.roads[ri], d = segDist(x, z, r.p[i], r.p[i + 1]);
    if (d < bd) { bd = d; best = [r, i]; }
  }
  if (!best || bd > maxD) return null;
  const [r, i] = best, a = r.p[i], b = r.p[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L, t = Math.max(0, Math.min(L, (x - a[0]) * dx + (z - a[1]) * dz));
  return { r, d: bd, px: a[0] + dx * t, pz: a[1] + dz * t, dx, dz };
}
function realSignals() {
  const F = window.FACILITIES;
  const S = Array.isArray(F && F.signals) ? F.signals.slice() : [];
  // 보행 신호등: 전국횡단보도표준데이터에서 '보행자신호등 있음'(ped)인 횡단보도의 양 끝. 31의 자료는 횡단보도를 차도 중심선에 맞춘 자리(x, z)와
  // 길 방향(dx, dz), 그려진 차도 폭(span)을 준다. 기둥은 점자블록(span/2 + 0.35~0.95m) 바로 뒤 span/2 + 1.3m 에, 등은 건너편을 본다.
  // 신호등 표준데이터에 4m 안 실제 보행 신호등이 있으면 그 끝은 건너뛴다(지금 옥포는 신호등 표준데이터에 0건)
  let fromCross = 0;
  for (const c of (F && Array.isArray(F.crosswalks) ? F.crosswalks : [])) {
    if (!c.ped || !inside(c.x, c.z, 2) || !(c.dx || c.dz)) continue;
    const half = (c.span > 0 ? c.span : 8) / 2 + 1.3, nx = -c.dz, nz = c.dx;
    for (const sg of [1, -1]) {
      const x = c.x + nx * half * sg, z = c.z + nz * half * sg;
      if (S.some(s => s.kind === 'ped' && Math.hypot(s.x - x, s.z - z) < 4)) continue;
      S.push({ x, z, kind: 'ped', cx: c.x, cz: c.z }); fromCross++;
    }
  }
  if (!S.length) return { car: 0, ped: 0, poles: 0, fromCross: 0 };
  const groups = [];
  for (const s of S) {
    if (!inside(s.x, s.z, 2)) continue;
    const g = groups.find(g => Math.hypot(g.x - s.x, g.z - s.z) < 1.5);
    if (g) g.items.push(s); else groups.push({ x: s.x, z: s.z, items: [s] });
  }
  const body = [], glow = [], POLE = '#4a5058', HOUSE = '#24282e';
  let car = 0, ped = 0, k = 0;
  for (const g of groups) {
    const nr = nearVehicleRoad(g.x, g.z, 15);
    const hasCar = g.items.some(s => s.kind === 'car'), hasPed = g.items.some(s => s.kind === 'ped');
    // 지역 축: +z 가 길 쪽(가장 가까운 차도 중심선을 향함). 차도가 없으면 돌리지 않음
    let rot = 0, toRoad = 0;
    const cw = g.items.find(s => s.cx !== undefined);   // 횡단보도에서 온 기둥은 그 횡단보도 가운데(건너편)를 보게
    if (cw) { const ax = cw.cx - g.x, az = cw.cz - g.z, L = Math.hypot(ax, az) || 1; rot = Math.atan2(ax / L, az / L); toRoad = Math.min(L, 6.5); }
    else if (nr) { const ax = nr.px - g.x, az = nr.pz - g.z, L = Math.hypot(ax, az) || 1; rot = Math.atan2(ax / L, az / L); toRoad = Math.min(L, 6.5); }
    const lit = (k++ % 2 === 0);   // 기둥마다 번갈아(차량 초록·보행 빨강 / 차량 빨강·보행 초록)
    const B = (w, h, d, x, y, z, col, arr = body) => { const geo = new THREE.BoxGeometry(w, h, d); geo.translate(x, y, z); geo.rotateY(rot); geo.translate(g.x, 0, g.z);
      const c = new THREE.Color(col), n = geo.attributes.position.count, cols = new Float32Array(n * 3); for (let i = 0; i < n; i++) cols.set([c.r, c.g, c.b], i * 3);
      geo.setAttribute('color', new THREE.BufferAttribute(cols, 3)); arr.push(geo.toNonIndexed()); };
    const H = hasCar ? 6.2 : 3.1;
    B(0.2, H, 0.2, 0, H / 2, 0, POLE);
    if (hasCar) {
      const arm = Math.max(1.2, toRoad - 0.5);
      B(0.13, 0.13, arm, 0, 6.0, arm / 2, POLE);
      const hz = arm - 0.65;   // 가로형 3구: 팔을 따라 길게 매달고(지역 z), 등은 다가오는 차 쪽(길 방향, 지역 ±x)을 본다
      B(0.34, 0.42, 1.3, 0, 5.82, hz, HOUSE);
      for (const [zk, on, off] of [[0.42, '#ff4d4f', '#4a2326'], [0, '#ffc53d', '#4a3d1c'], [-0.42, '#38d27a', '#1d3d2b']]) {
        const isOn = (zk === -0.42 && lit) || (zk === 0.42 && !lit);
        for (const f of [1, -1]) B(0.04, 0.26, 0.26, f * 0.19, 5.82, hz + zk, isOn ? on : off, glow);
      }
      car += g.items.filter(s => s.kind === 'car').length;
    }
    if (hasPed) {
      const y0 = hasCar ? 2.95 : 2.45;
      B(0.3, 0.72, 0.26, 0, y0, 0.24, HOUSE);                                          // 보행 2구
      for (const f of [1, -1]) { B(0.18, 0.22, 0.04, 0, y0 + 0.17, 0.24 + f * 0.15, lit ? '#4a2326' : '#ff4d4f', glow); B(0.18, 0.22, 0.04, 0, y0 - 0.17, 0.24 + f * 0.15, lit ? '#38d27a' : '#1d3d2b', glow); }
      ped += g.items.filter(s => s.kind === 'ped').length;
    }
    hideTreesNear(g.x, g.z, 1.5);
  }
  addMerged(body, 'decor-signal');
  if (glow.length && THREE.BufferGeometryUtils) {
    const m = new THREE.Mesh(THREE.BufferGeometryUtils.mergeBufferGeometries(glow, false), new THREE.MeshBasicMaterial({ vertexColors: true }));
    m.renderOrder = 10; m.name = 'decor-signal-light'; scene.add(m);
  }
  return { car, ped, poles: groups.length, fromCross };
}

// ── 지도 밖 큰 곳 방향 이름표(한화오션 옥포조선소 등, OSM 지명): 가운데에서 그쪽으로 그은 선이 지도 가장자리(안쪽 45m)와 만나는 곳에 '…방향'.
// 가상 손님의 큰 몫이 조선소 통근자라 어디서 오는지 보이게 한다. 이름과 방향은 OSM 자료 그대로다
// 어린이보호구역 시설 이름표: 전국어린이보호구역표준데이터의 시설 위치(FACILITIES.schoolZones). 지정 범위 자료가 없어 바닥·울타리·표지판은 그리지 않는다
function schoolLabels() {
  const Z = window.FACILITIES && window.FACILITIES.schoolZones, box = document.getElementById('labels');
  if (!Array.isArray(Z) || !Z.length || !M.labels || !box) return 0;
  let n = 0;
  for (const z of Z) {
    if (!inside(z.x, z.z, 2)) continue;
    const el = document.createElement('div'); el.className = 'lbl place kid';
    el.innerHTML = '<b>어린이보호구역</b>' + (M.esc ? M.esc(z.name) : String(z.name).replace(/[<&>"]/g, ''));
    box.appendChild(el); M.labels.push({ el, x: z.x, y: 2, z: z.z, pri: 2, kind: 'place', w: 0, h: 0 }); n++;   // pri 2: 첫 화면(멀리)에선 숨고 가까이 볼 때만(빈 층 표시와 다투지 않게)
  }
  return n;
}
function edgeLabels() {
  if (!M.labels) return 0;
  const box = document.getElementById('labels'); if (!box) return 0;
  let n = 0;
  for (const pl of D.places || []) {
    const px = pl.x !== undefined ? pl.x : pl.p && pl.p[0], pz = pl.z !== undefined ? pl.z : pl.p && pl.p[1];
    if (px === undefined || inside(px, pz, 0) || pl.k !== 'industrial') continue;
    const t = Math.min((HX - 45) / Math.abs(px || 1), (HZ - 45) / Math.abs(pz || 1));
    const el = document.createElement('div'); el.className = 'lbl place major edge'; el.textContent = pl.n + ' 방향';
    box.appendChild(el); M.labels.push({ el, x: px * t, y: 0, z: pz * t, pri: 8, kind: 'place', w: 0, h: 0 }); n++;
  }
  return n;
}

function afterLoad() {
  busStops();
  try { stats.signals = realSignals(); } catch (e) { console.warn('decor 신호등', e); }
  try { stats.areaLabels = edgeLabels(); stats.schoolLabels = schoolLabels(); } catch (e) { console.warn('decor 이름표', e); }
  if (window.__decor) { window.__decor.areaLabels = stats.areaLabels || 0; window.__decor.signals = stats.signals || null; window.__decor.schoolLabels = stats.schoolLabels || 0; }
  if (M.renderer) M.renderer.shadowMap.needsUpdate = true;
  M.need && M.need();
}
if (document.readyState === 'complete') afterLoad(); else addEventListener('load', afterLoad);

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
  spots, majorRoads: majors.length, oneway: majors.filter(m => m.r.ow).length, parking: stats.parking || 0, stalls: stats.stalls || 0,
};
})();
