/* 나무·가로등·벤치·화분·버스 정류장 쉼터 — app.js 다음에 불러온다. (바닥 표시는 ground.js)
   자료: window.MAP_DATA(roads·greens·buildings·water, tools/map_build.py). 그릴 곳: window.__map.scene.
   좌표: x = 동쪽(m), z = 남쪽(m), y = 위.
   주의: 나무·차선·횡단보도는 실제 위치가 아니라 보기 좋게 놓은 장식이다.
     - 가로수: OSM에 옥포 가로수 점 자료가 없어 큰길 양쪽에 12m 간격으로 놓았다.
     - 공원 나무: 녹지 다각형 안을 격자로 채웠다(종류마다 간격이 다름).
     - 횡단보도·정지선: 큰길끼리 만나는 곳에만 그렸다. 실제 횡단보도 위치는 확인하지 않았다.
     - 중앙선·차선: OSM 일방(ow)·차로 수(ln)를 따른다. 일방통행은 중앙선 없음, 차로 수가 없는 길은 점선 없음.
     - 주차장 바닥·테두리는 OSM 실제 위치, 그 안의 주차 칸 선은 장식이다.
     - 나무 모양(활엽·침엽·관목)과 비율도 가정이다. 버스 정류장 쉼터만 OSM 정류장 실제 위치(SIM_DATA.stops)다.
     - 가로등(큰길 양쪽 30m)·벤치·화분(빛의 거리·옥포성안로 14m)은 장식이다. 실제 위치 자료가 없다.
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
  lampPole: '#3d434b', lampHead: '#f4f1e6', benchWood: '#a47b55', benchLeg: '#4a5260', planter: '#cfc9bf',
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
// 가로수: 큰길 양쪽, 길 가장자리에서 1.5m 바깥(인도 안). 활엽만.
for (const m of majors) {
  if (m.r.br) continue;
  const off = m.r.w / 2 + 1.5;
  for (let s = STREET_GAP / 2; s < m.w.L; s += STREET_GAP) {
    if (m.js.some(j => Math.abs(j.s - s) < 11)) continue;                 // 교차로 가까이는 비움
    const q = m.w.at(s);
    for (const sgn of [1, -1]) {
      const x = q.x + q.nx * off * sgn, z = q.z + q.nz * off * sgn;
      if (!inside(x, z, 5) || inWater(x, z) || nearBuilding(x, z, 1.8) || nearRoad(x, z, 1.0, m.ri)) continue;
      trees.push([x, z, (6 + rand() * 1.5) * 1.3, 0.34, 'street', 'broad']);
    }
  }
}
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
  const lumpy = (geo, amp) => {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + amp * (hash(+x.toFixed(3), +y.toFixed(3), +z.toFixed(3)) * 2 - 1); p.setXYZ(i, x * k, y * k, z * k); }
    geo.computeVertexNormals(); return geo;
  };
  const mottle = (geo, amt) => {   // shade() 뒤에: 세 꼭짓점(한 면)마다 같은 무작위 배율
    const c = geo.attributes.color;
    for (let f = 0; f + 2 < c.count; f += 3) { const k = 1 + amt * (hash(f * 0.37, 1.3, 2.1) * 2 - 1); for (let j = 0; j < 3; j++) c.setXYZ(f + j, c.getX(f + j) * k, c.getY(f + j) * k, c.getZ(f + j) * k); }
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
    // 색은 4단계 초록 중 하나를 고르고, 옆 덩이는 조금 밝거나 어둡게
    const leaf = mk(mottle(shade(lumpy(new THREE.IcosahedronGeometry(1, 1), 0.14), 0.62, 1.08), 0.09), '#ffffff', broad.length * 3, true);
    broad.forEach(([x, z, h, rr], i) => {
      const r = h * rr, k = Math.floor(rand() * LEAF.length), base = LEAF[k].clone().lerp(LEAF[Math.min(LEAF.length - 1, k + 1)], rand() * 0.5);
      const sy = 0.82 + rand() * 0.22;
      q.setFromAxisAngle(up, rand() * Math.PI * 2);
      pos.set(x, h - r * sy, z); scl.set(r, r * sy, r); mtx.compose(pos, q, scl); leaf.setMatrixAt(i * 3, mtx); leaf.setColorAt(i * 3, base);
      const a0 = rand() * Math.PI * 2;
      for (let s2 = 1; s2 <= 2; s2++) {
        const a = a0 + s2 * (2.2 + rand() * 0.6), r2 = r * (0.6 + rand() * 0.14), up2 = s2 === 1 ? 0.18 : -0.12;
        pos.set(x + Math.cos(a) * r * 0.58, h - r * sy + r * up2, z + Math.sin(a) * r * 0.58); scl.set(r2, r2 * 0.9, r2);
        mtx.compose(pos, q, scl); leaf.setMatrixAt(i * 3 + s2, mtx);
        leaf.setColorAt(i * 3 + s2, col.copy(base).multiplyScalar(s2 === 1 ? 1.06 : 0.92));
      }
      treeRefs[broadIdx[i]].parts.push([leaf, i * 3], [leaf, i * 3 + 1], [leaf, i * 3 + 2]);
    });
    meshes.push(leaf);
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

// ── 가로등: 큰길 양쪽 30m 간격, 인도 쪽(길 가장자리 + 0.7m), 팔은 길 쪽으로. 위치는 장식(실제 가로등 자료 없음) ──
// 가로수가 5m·15m·25m…(10m 간격)에 서므로 가로등은 10m·40m·70m…에 세워 늘 나무와 나무 한가운데(5m 떨어짐)에 오게 한다.
// 나무·소품 자리 찾기: 4m 칸 격자(treeRefs 는 뒤에 붙기만 하므로 새로 붙은 것만 칸에 넣는다). 전엔 부를 때마다 7천 개를 다 훑었다
const PG = new Map(); let pgN = 0;
const pgKey = (cx, cz) => cx * 100003 + cz;
function nearProp(x, z, r) {
  for (; pgN < treeRefs.length; pgN++) { const t = treeRefs[pgN], k = pgKey(Math.floor(t.x / 4), Math.floor(t.z / 4)); let a = PG.get(k); if (!a) PG.set(k, a = []); a.push(t); }
  const hit = (t) => (t.parts.length || t.prop) && Math.abs(t.x - x) < r && Math.abs(t.z - z) < r && Math.hypot(t.x - x, t.z - z) < r;
  if (r > 4) return treeRefs.some(hit);
  const cx = Math.floor(x / 4), cz = Math.floor(z / 4);
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { const a = PG.get(pgKey(cx + i, cz + j)); if (a && a.some(hit)) return true; }
  return false;
}
{
  const L = [];   // [x, z, 각도]
  for (const m of majors) {
    if (m.r.br || m.ring) continue;
    const off = m.r.w / 2 + 0.7;
    for (let s = 10; s < m.w.L - 5; s += 30) {
      if (m.js.some(j => Math.abs(j.s - s) < 9)) continue;
      const q = m.w.at(s);
      for (const sgn of [1, -1]) {
        const x = q.x + q.nx * off * sgn, z = q.z + q.nz * off * sgn;
        if (!inside(x, z, 5) || inWater(x, z) || nearBuilding(x, z, 0.8) || nearRoad(x, z, 0.3, m.ri) || nearProp(x, z, 3.5)) continue;
        const dx = -sgn * q.nx, dz = -sgn * q.nz;              // 길 쪽 방향
        L.push([x, z, Math.atan2(-dz, dx)]);
      }
    }
  }
  if (L.length) {
    const poleGeo = new THREE.CylinderGeometry(0.07, 0.1, 1, 6, 1); poleGeo.translate(0, 0.5, 0);
    const armGeo = new THREE.BoxGeometry(1.4, 0.08, 0.08); armGeo.translate(0.7, 0, 0);
    const headGeo = new THREE.SphereGeometry(0.24, 10, 6); headGeo.scale(1.3, 0.55, 1);
    const pole = new THREE.InstancedMesh(poleGeo, new THREE.MeshLambertMaterial({ color: C.lampPole }), L.length);
    const arm = new THREE.InstancedMesh(armGeo, new THREE.MeshLambertMaterial({ color: C.lampPole }), L.length);
    const head = new THREE.InstancedMesh(headGeo, new THREE.MeshLambertMaterial({ color: C.lampHead, emissive: '#6e6a58' }), L.length);
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    L.forEach(([x, z, a], i) => {
      q.setFromAxisAngle(up, a);
      pos.set(x, 0, z); scl.set(1, 6, 1); mtx.compose(pos, q, scl); pole.setMatrixAt(i, mtx);
      pos.set(x, 5.95, z); scl.set(1, 1, 1); mtx.compose(pos, q, scl); arm.setMatrixAt(i, mtx);
      pos.set(x + Math.cos(a) * 1.35, 5.85, z - Math.sin(a) * 1.35); mtx.compose(pos, q, scl); head.setMatrixAt(i, mtx);
      treeRefs.push({ x, z, parts: [[pole, i], [arm, i], [head, i]] });
    });
    for (const m of [pole, arm, head]) { m.instanceMatrix.needsUpdate = true; m.castShadow = m !== head; m.renderOrder = 10; m.name = 'decor-lamps'; m.computeBoundingSphere && m.computeBoundingSphere(); scene.add(m); }
    // 밤(app.js 'map-light', night 0~1): 등 머리가 따뜻한 빛으로 켜지고, 바닥에 옅은 빛 웅덩이(반지름 6m, 더하기 섞기)
    const pc = document.createElement('canvas'); pc.width = pc.height = 64; const pg = pc.getContext('2d'), gr = pg.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); pg.fillStyle = gr; pg.fillRect(0, 0, 64, 64);
    const poolGeo = new THREE.PlaneGeometry(12, 12); poolGeo.rotateX(-Math.PI / 2);
    const poolMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(pc), color: '#ffc46b', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
    const pool = new THREE.InstancedMesh(poolGeo, poolMat, L.length); pool.renderOrder = 7; pool.name = 'decor-lamp-pool'; pool.visible = false; pool.frustumCulled = false; scene.add(pool);
    const dayE = new THREE.Color('#6e6a58'), nightE = new THREE.Color('#ffd98c'), hm = new THREE.Matrix4(), hp = new THREE.Vector3(), hq = new THREE.Quaternion(), hs = new THREE.Vector3(), zero = new THREE.Matrix4().makeScale(0, 0, 0);
    document.addEventListener('map-light', (e) => {
      const n = Math.max(0, Math.min(1, e.detail.night || 0));
      head.material.emissive.copy(dayE).lerp(nightE, n);
      pool.visible = n > 0.05; poolMat.opacity = n * 0.5;
      if (pool.visible) {   // 등이 숨겨졌으면(정류장 등과 겹쳐서) 빛 웅덩이도 숨긴다
        for (let i = 0; i < L.length; i++) { head.getMatrixAt(i, hm); hm.decompose(hp, hq, hs);
          if (hs.x < 0.01) pool.setMatrixAt(i, zero); else { hm.makeTranslation(hp.x, 0.13, hp.z); pool.setMatrixAt(i, hm); } }
        pool.instanceMatrix.needsUpdate = true;
      }
      M.need && M.need();
    });
  }
  stats.lamps = L.length;
}

// 상자 여러 개를 한 덩어리로(쉼터·벤치·화분). 상자마다 색을 꼭짓점 색으로 넣는다.
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
function nearestRoad(x, z, maxD) {
  let best = null, bd = Infinity;
  for (const [ri, i] of RG.at(x, z)) {
    if (!vehicle[ri]) continue;
    const r = D.roads[ri], d = segDist(x, z, r.p[i], r.p[i + 1]);
    if (d < bd) { bd = d; best = [r, i]; }
  }
  if (!best || bd > maxD) return null;
  const [r, i] = best, a = r.p[i], b = r.p[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const dx = (b[0] - a[0]) / L, dz = (b[1] - a[1]) / L, t = Math.max(0, Math.min(L, (x - a[0]) * dx + (z - a[1]) * dz));
  const px = a[0] + dx * t, pz = a[1] + dz * t, nx = -dz, nz = dx;
  return { r, px, pz, nx, nz, side: ((x - px) * nx + (z - pz) * nz) >= 0 ? 1 : -1, rot: -Math.atan2(dz, dx) };
}

// ── 벤치·화분: 빛의 거리·옥포성안로 보행로에 14m 간격으로 번갈아(장식). 거리 자료(STREETS)가 decor 뒤에 불러와지므로 load 뒤에 ──
function streetProps() {
  const ST = window.STREETS; if (!ST) return;
  const parts = [], bush = [];
  let benches = 0, planters = 0;
  for (const st of ST) {
    if (!['light', 'seongan'].includes(st.id) || !st.p || st.p.length < 2) continue;
    const w = walker(st.p);
    let k = 0;
    for (let s = 7; s < w.L - 7; s += 14, k++) {
      const q = w.at(s), nr = nearestRoad(q.x, q.z, 12); if (!nr) continue;
      for (const sgn of [1, -1]) {
        const off = nr.r.w / 2 + 1.1;
        const x = nr.px + nr.nx * off * sgn, z = nr.pz + nr.nz * off * sgn;
        if (!inside(x, z, 5) || nearBuilding(x, z, 0.7) || inWater(x, z) || nearRoad(x, z, 0.45, -1) || nearProp(x, z, 2.2)) continue;
        const rot = nr.rot, back = 0.22 * sgn;   // 상자 z 축 = 길의 법선 방향 → 등받이는 길 반대쪽
        if ((k + (sgn > 0 ? 0 : 1)) % 2 === 0) {
          boxPart(parts, 1.6, 0.07, 0.42, 0, 0.45, 0, rot, x, z, C.benchWood);
          boxPart(parts, 1.6, 0.36, 0.05, 0, 0.72, back, rot, x, z, C.benchWood);
          for (const lx of [-0.68, 0.68]) boxPart(parts, 0.06, 0.45, 0.42, lx, 0.225, 0, rot, x, z, C.benchLeg);
          benches++;
        } else {
          boxPart(parts, 1.1, 0.55, 1.1, 0, 0.275, 0, rot, x, z, C.planter);
          bush.push([x, z]);
          planters++;
        }
        treeRefs.push({ x, z, parts: [], prop: true });   // 다음 소품과 겹치지 않게 자리만 기록
      }
    }
  }
  addMerged(parts, 'decor-street');
  if (bush.length) {
    const g = new THREE.IcosahedronGeometry(1, 1), m = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ color: '#ffffff' }), bush.length);
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3(), col = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
    bush.forEach(([x, z], i) => {
      q.setFromAxisAngle(up, rand() * 6.28); pos.set(x, 0.85, z); scl.set(0.55, 0.42, 0.55); mtx.compose(pos, q, scl); m.setMatrixAt(i, mtx);
      m.setColorAt(i, col.copy(new THREE.Color(C.leaf[1 + (i % 3)])));
    });
    m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; m.castShadow = true; m.renderOrder = 10; m.name = 'decor-street';
    m.computeBoundingSphere && m.computeBoundingSphere(); scene.add(m);
  }
  stats.benches = benches; stats.planters = planters;
  if (window.__decor) { window.__decor.benches = benches; window.__decor.planters = planters; }
}

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
// ── 거리에 세운 것들(2026-11-27 '최고 수준으로' 지시): 신호등·도로명판·전봇대와 전선·어린이보호구역 울타리·바다 이름 ──
// 위치 근거: 신호등 = 횡단보도 자리(ground.js), 도로명판 = OSM 길 이름이 있는 큰길 교차로, 전봇대 = 이름 있는 골목(30m 간격, 장식),
// 어린이보호구역 = ground.js 가 내보낸 학교 앞 구간. 신호등·전봇대·울타리의 정확한 위치는 실제와 다를 수 있다.
const textTex = (draw, W, H) => { const c = document.createElement('canvas'); c.width = W; c.height = H; draw(c.getContext('2d'), W, H);
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; return t; };
const FONT = '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
// 글자판 모음: keys 마다 cw×ch 칸을 그려 한 장으로. uv(key) = [u0, v0, u1, v1]
function atlas(keys, cw, ch, draw) {
  const cols = keys.length > 8 ? 2 : 1, rows = Math.ceil(keys.length / cols), W = cw * cols, H = ch * rows, at = new Map();
  const tex = textTex((g) => keys.forEach((k, i) => { const c = i % cols, r = Math.floor(i / cols); g.save(); g.translate(c * cw, r * ch); draw(g, k, cw, ch); g.restore();
    const e = 1.5; at.set(k, [(c * cw + e) / W, 1 - ((r + 1) * ch - e) / H, ((c + 1) * cw - e) / W, 1 - (r * ch + e) / H]); }), W, H);
  return { tex, uv: (k) => at.get(k) };
}
// 판 목록 [{ x, y, z, a(앞면이 보는 방향 각도), w, h, uv, both(뒷면도 같은 글자) }] → 한 덩어리
function plateMesh(list, tex, name, gap) {
  if (!list.length || !THREE.BufferGeometryUtils) return null;
  const geos = [];
  for (const p of list) for (const back of (p.both ? [0, 1] : [0])) {
    const g = new THREE.PlaneGeometry(p.w, p.h), uv = g.attributes.uv, [u0, v0, u1, v1] = p.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    const a = p.a + (back ? Math.PI : 0);
    g.rotateY(a); g.translate(p.x + Math.sin(a) * gap, p.y, p.z + Math.cos(a) * gap); geos.push(g);
  }
  const m = new THREE.Mesh(THREE.BufferGeometryUtils.mergeBufferGeometries(geos, false), new THREE.MeshLambertMaterial({ map: tex }));
  m.renderOrder = 10; m.name = name; scene.add(m); return m;
}

// 신호등: 횡단보도마다 하나. 오른쪽 인도(길 가장자리 + 0.9m)에 기둥, 팔이 길 위로 나가 가로형 차량 신호등, 기둥 중간에 보행 신호등
function trafficLights() {
  const CW = (window.__decor && window.__decor.spots && window.__decor.spots.crosswalk) || spots.crosswalk;
  if (!CW || !CW.length) return 0;
  const body = [], glow = [];
  let n = 0;
  for (const cw of CW) {
    const [x, z, w0] = cw, nr = nearestRoad(x, z, 8); if (!nr) continue;
    const half = (w0 || nr.r.w) / 2, side = 1;
    const px = nr.px + nr.nx * (half + 1.3) * side, pz = nr.pz + nr.nz * (half + 1.3) * side;   // 점자블록(가장자리 0.35~0.95m, ground.js) 뒤
    if (!inside(px, pz, 4) || nearBuilding(px, pz, 0.4)) continue;
    hideTreesNear(px, pz, 2.6);
    const rot = nr.rot, arm = Math.min(half + 1.3, 6.5), toRoad = -side;   // 상자 z 축 = 길의 +법선 → 길 쪽은 -side
    boxPart(body, 0.2, 6.2, 0.2, 0, 3.1, 0, rot, px, pz, '#4a5058');                       // 기둥
    boxPart(body, 0.13, 0.13, arm, 0, 6.0, toRoad * arm / 2, rot, px, pz, '#4a5058');      // 팔
    const hz = toRoad * (arm - 0.5);
    boxPart(body, 0.34, 0.42, 1.3, 0, 5.82, hz, rot, px, pz, '#24282e');                    // 차량 신호등 몸통(가로형)
    const carGo = n % 2 === 0;   // 한 번에 불 하나만: 차가 갈 때 사람은 빨강, 차가 설 때 사람은 초록
    for (const [k, on, off] of [[-0.42, !carGo ? '#ff4d4f' : '#4a2326', '#4a2326'], [0, '#4a3d1c', '#4a3d1c'], [0.42, carGo ? '#38d27a' : '#1d3d2b', '#1d3d2b']])
      for (const f of [1, -1]) boxPart(glow, 0.04, 0.26, 0.26, f * 0.19, 5.82, hz + k, rot, px, pz, on);
    boxPart(body, 0.3, 0.72, 0.26, 0, 2.95, toRoad * 0.24, rot, px, pz, '#24282e');         // 보행 신호등
    for (const f of [1, -1]) { boxPart(glow, 0.04, 0.22, 0.18, f * 0.16, 3.12, toRoad * 0.24, rot, px, pz, carGo ? '#ff4d4f' : '#4a2326'); boxPart(glow, 0.04, 0.22, 0.18, f * 0.16, 2.8, toRoad * 0.24, rot, px, pz, carGo ? '#1d3d2b' : '#38d27a'); }
    treeRefs.push({ x: px, z: pz, parts: [], prop: true });
    (stats.lightAt = stats.lightAt || []).push([Math.round(px), Math.round(pz)]);
    n++;
  }
  addMerged(body, 'decor-signal');
  if (glow.length && THREE.BufferGeometryUtils) {
    const m = new THREE.Mesh(THREE.BufferGeometryUtils.mergeBufferGeometries(glow, false), new THREE.MeshBasicMaterial({ vertexColors: true }));
    m.renderOrder = 10; m.name = 'decor-signal-light'; scene.add(m);
  }
  return n;
}

// 볼라드: 횡단보도 양끝, 점자블록(길 가장자리 0.35~0.95m) 바로 뒤 1.25m, 길 방향으로 -2.1·-0.9·0.9·2.1m(가운데는 신호등)(장식)
function bollards() {
  const CW = (window.__decor && window.__decor.spots && window.__decor.spots.crosswalk) || spots.crosswalk;
  if (!CW || !CW.length) return 0;
  const P = [];
  for (const [x, z, w0] of CW) {
    const nr = nearestRoad(x, z, 8); if (!nr) continue;
    const half = (w0 || nr.r.w) / 2, dx = nr.nz, dz = -nr.nx;
    for (const side of [1, -1]) for (const t of [-2.1, -0.9, 0.9, 2.1]) {
      const bx = nr.px + nr.nx * (half + 1.25) * side + dx * t, bz = nr.pz + nr.nz * (half + 1.25) * side + dz * t;
      if (!inside(bx, bz, 3) || nearBuilding(bx, bz, 0.15) || nearRoad(bx, bz, 0.05, -1) || nearProp(bx, bz, 0.5)) continue;
      P.push([bx, bz]);
    }
  }
  if (!P.length) return 0;
  const geo = new THREE.CylinderGeometry(0.09, 0.11, 0.8, 10, 8); geo.translate(0, 0.4, 0);
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) { const y = pos.getY(i), band = y > 0.55 && y < 0.67, c = band ? [1.0, 0.78, 0.1] : [0.6 + y * 0.12, 0.62 + y * 0.12, 0.64 + y * 0.12]; col.set(c, i * 3); }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }), P.length), mtx = new THREE.Matrix4();
  P.forEach(([x, z], i) => { mtx.makeTranslation(x, 0, z); mesh.setMatrixAt(i, mtx); hideTreesNear(x, z, 0.7); });
  mesh.instanceMatrix.needsUpdate = true; mesh.castShadow = true; mesh.renderOrder = 10; mesh.name = 'decor-bollard'; mesh.computeBoundingSphere && mesh.computeBoundingSphere(); scene.add(mesh);
  return P.length;
}

// 도로명판: 이름 있는 큰길이 다른 길과 만나는 곳, 교차로 7m 앞 오른쪽 인도에 남색 판(실제 도로명판처럼 흰 글씨). 25m 안에는 하나만
function roadSigns() {
  const placed = [], parts = [], plates = [];
  for (const m of majors) {
    if (!m.r.n || m.ring) continue;
    for (const j of m.js) {
      for (const dir of [-1, 1]) {
        const s = j.s + dir * 7; if (s < 1 || s > m.w.L - 1) continue;
        const q = m.w.at(s), side = -dir, off = m.r.w / 2 + 1.1;
        const x = q.x + q.nx * off * side, z = q.z + q.nz * off * side;
        if (!inside(x, z, 4) || placed.some(p => Math.hypot(p[0] - x, p[1] - z) < 25) || nearBuilding(x, z, 0.5) || nearRoad(x, z, 0.3, m.ri) || nearProp(x, z, 1.4)) continue;
        placed.push([x, z]);
        const rot = -Math.atan2(q.dz, q.dx);
        boxPart(parts, 0.09, 3.7, 0.09, 0, 1.85, 0, rot, x, z, '#5b636d');              // 기둥
        const sx = x - q.nx * side * 0.95, sz = z - q.nz * side * 0.95;                 // 판은 기둥에서 길 쪽으로 뻗는다(기둥이 글자를 가리지 않게)
        boxPart(parts, 0.05, 0.52, 2.04, 0, 3.4, 0, rot, sx, sz, '#1d4e9a');            // 판 몸통(남색, 두께 5cm)
        plates.push({ x: sx, y: 3.4, z: sz, a: Math.atan2(q.dx, q.dz), w: 2.0, h: 0.5, name: m.r.n, both: true });
        hideTreesNear(x, z, 1.6);
        treeRefs.push({ x, z, parts: [], prop: true });
      }
    }
  }
  addMerged(parts, 'decor-roadsign-pole');
  stats.signAt = plates.map(p => [Math.round(p.x), Math.round(p.z), p.name]);
  const names = [...new Set(plates.map(p => p.name))];
  if (names.length) {
    const A = atlas(names, 512, 128, (g, name, W, H) => {
      g.fillStyle = '#1d4e9a'; g.fillRect(0, 0, W, H); g.strokeStyle = '#fff'; g.lineWidth = 5; g.strokeRect(8, 8, W - 16, H - 16);
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle'; let fs = 66; g.font = `700 ${fs}px ${FONT}`;
      while (g.measureText(name).width > W - 56 && fs > 28) { fs -= 4; g.font = `700 ${fs}px ${FONT}`; }
      g.fillText(name, W / 2, H / 2 + 3); });
    plates.forEach(p => { p.uv = A.uv(p.name); });
    plateMesh(plates, A.tex, 'decor-roadsign', 0.027);
  }
  return plates.length;
}

// 전봇대와 전선: 이름 있는 골목(residential)을 따라 한쪽 길가에 30m 간격(장식). 전선은 멀리서 보면 거슬리니 카메라가 멀어지면 흐려진다
function utilityPoles() {
  const P = [];   // [x, z, nx, nz]
  const W = [];   // [i, j] 이웃 전봇대 번호
  D.roads.forEach((r, ri) => {
    if (r.k !== 'residential' || !r.n || r.br || r.ped || r.p.length < 2) return;
    const w = walker(r.p); if (w.L < 45) return;
    let prev = -1;
    for (let s = 8; s < w.L - 4; s += 30) {
      const q = w.at(s), off = r.w / 2 + 0.35, x = q.x + q.nx * off, z = q.z + q.nz * off;
      if (!inside(x, z, 5) || inWater(x, z) || nearBuilding(x, z, 0.25) || nearRoad(x, z, 0.15, ri) || nearProp(x, z, 1.3)) { prev = -1; continue; }
      P.push([x, z, q.nx, q.nz]); const i = P.length - 1;
      if (prev >= 0 && Math.hypot(P[prev][0] - x, P[prev][1] - z) < 40) W.push([prev, i]);
      prev = i;
      treeRefs.push({ x, z, parts: [], prop: true });
    }
  });
  if (!P.length) return [0, 0];
  const poleGeo = new THREE.CylinderGeometry(0.13, 0.18, 1, 8, 1); poleGeo.translate(0, 0.5, 0);
  const armGeo = new THREE.BoxGeometry(1.8, 0.12, 0.12);
  const pole = new THREE.InstancedMesh(poleGeo, new THREE.MeshLambertMaterial({ color: '#9a9c98' }), P.length);
  const arm = new THREE.InstancedMesh(armGeo, new THREE.MeshLambertMaterial({ color: '#6f7378' }), P.length);
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  P.forEach(([x, z, nx, nz], i) => {
    q.identity(); pos.set(x, 0, z); scl.set(1, 9, 1); mtx.compose(pos, q, scl); pole.setMatrixAt(i, mtx);
    q.setFromAxisAngle(up, -Math.atan2(nz, nx)); pos.set(x, 8.5, z); scl.set(1, 1, 1); mtx.compose(pos, q, scl); arm.setMatrixAt(i, mtx);   // 팔은 길을 가로질러
  });
  for (const m of [pole, arm]) { m.instanceMatrix.needsUpdate = true; m.castShadow = true; m.renderOrder = 10; m.name = 'decor-pole'; m.computeBoundingSphere && m.computeBoundingSphere(); scene.add(m); }
  // 전선: 팔 양 끝과 가운데 세 가닥, 가운데가 처지게(5토막)
  const lp = [];
  for (const [a, b] of W) {
    const A = P[a], B = P[b];
    for (const k of [-0.8, 0, 0.8]) {
      const ax = A[0] + A[2] * k, az = A[1] + A[3] * k, bx = B[0] + B[2] * k, bz = B[1] + B[3] * k, L = Math.hypot(bx - ax, bz - az), sag = 0.012 * L;
      let px = ax, py = 8.56, pz = az;
      for (let t = 1; t <= 5; t++) { const u = t / 5, nxp = ax + (bx - ax) * u, nzp = az + (bz - az) * u, nyp = 8.56 - sag * 4 * u * (1 - u);
        lp.push(px, py, pz, nxp, nyp, nzp); px = nxp; py = nyp; pz = nzp; }
    }
  }
  if (lp.length) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
    const mat = new THREE.LineBasicMaterial({ color: '#3f454c', transparent: true, opacity: 0.6, depthWrite: false });
    const lines = new THREE.LineSegments(g, mat); lines.renderOrder = 10.5; lines.name = 'decor-wire';
    lines.onBeforeRender = (r, s, cam) => { const d = cam.position.distanceTo(M.controls.target); mat.opacity = Math.max(0, Math.min(0.6, 0.6 * (1 - (d - 220) / 380))); };
    scene.add(lines);
  }
  return [P.length, W.length];
}

// 어린이보호구역: ground.js 가 내보낸 학교 앞 구간(길 중심선 p, 길폭 w)의 양쪽 길 가장자리에 노란 울타리, 구간 양끝에 표지판
function schoolZones() {
  const Z = window.__decor && window.__decor.spots && window.__decor.spots.school;   // ground.js(seohogyun-31)가 채움: [{ p: 붉은 포장 중심선, w: 길폭 }]
  if (!Array.isArray(Z) || !Z.length) return 0;
  const parts = [], signs = [];
  let posts = 0;
  for (const zn of Z) {
    const pts = zn.p || zn.line || zn; if (!Array.isArray(pts) || pts.length < 2 || !Array.isArray(pts[0])) continue;
    const w = walker(pts), half = (zn.w || 8) / 2;
    for (const side of [1, -1]) {
      let prev = null;
      for (let s = 0; s <= w.L; s += 2) {
        const q = w.at(s), x = q.x + q.nx * (half + 0.5) * side, z = q.z + q.nz * (half + 0.5) * side;
        const ok = inside(x, z, 3) && !nearBuilding(x, z, 0.2) && !nearRoad(x, z, -0.2, -1);
        if (!ok) { prev = null; continue; }
        boxPart(parts, 0.08, 1.0, 0.08, 0, 0.5, 0, 0, x, z, '#f2b705'); posts++;
        if (prev) {
          const dx = x - prev[0], dz = z - prev[1], L = Math.hypot(dx, dz), r = -Math.atan2(dz, dx), mx = (x + prev[0]) / 2, mz = (z + prev[1]) / 2;
          boxPart(parts, L, 0.07, 0.05, 0, 0.95, 0, r, mx, mz, '#f2b705'); boxPart(parts, L, 0.05, 0.04, 0, 0.55, 0, r, mx, mz, '#f2b705');
        }
        prev = [x, z];
      }
    }
    for (const s of [0, w.L]) {
      const q = w.at(s), x = q.x + q.nx * (half + 0.8), z = q.z + q.nz * (half + 0.8);
      if (nearBuilding(x, z, 0.3)) continue;
      const rot = -Math.atan2(q.dz, q.dx);
      boxPart(parts, 0.08, 3.1, 0.08, 0, 1.55, 0, rot, x, z, '#5b636d');
      boxPart(parts, 0.04, 1.0, 1.0, 0, 2.7, 0, rot, x, z, '#e0b400');
      signs.push({ x, y: 2.7, z, a: Math.atan2(q.dx, q.dz), w: 0.98, h: 0.98, both: true });
      hideTreesNear(x, z, 1.4);
    }
  }
  addMerged(parts, 'decor-school');
  if (signs.length) {
    const A = atlas(['school'], 256, 256, (g, k, W, H) => { g.fillStyle = '#ffd400'; g.fillRect(0, 0, W, H); g.strokeStyle = '#d6262b'; g.lineWidth = 14; g.strokeRect(10, 10, W - 20, H - 20);
      g.fillStyle = '#1a1a1a'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `800 54px ${FONT}`; g.fillText('어린이', W / 2, H * 0.36); g.fillText('보호구역', W / 2, H * 0.68); });
    signs.forEach(s => { s.uv = A.uv('school'); });
    plateMesh(signs, A.tex, 'decor-school-sign', 0.022);
  }
  return posts;
}

// 바다 이름: 가장 큰 물 면 안쪽, 가운데에 가장 가까운 점에 '옥포만'(지도 이름표와 같은 자리 다툼 규칙을 따른다)
function areaLabels() {
  if (!M.labels || !D.water || !D.water.length) return 0;
  const box = document.getElementById('labels'); if (!box) return 0;
  const area = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s / 2); };
  const sea = D.water.slice().sort((a, b) => area(b.p) - area(a.p))[0].p, bb = bbox(sea, 0);
  let cx = 0, cz = 0; for (const q of sea) { cx += q[0]; cz += q[1]; } cx /= sea.length; cz /= sea.length;
  const cand = [];
  for (let x = bb[0]; x <= bb[2]; x += 20) for (let z = bb[1]; z <= bb[3]; z += 20) cand.push([x, z, Math.hypot(x - cx, z - cz)]);
  cand.sort((a, b) => a[2] - b[2]);
  let best = null;
  for (const [x, z] of cand) {
    if (!inside(x, z, 60) || !inPoly(x, z, sea)) continue;
    let ok = true; for (let i = 0; i < sea.length && ok; i++) if (segDist(x, z, sea[i], sea[(i + 1) % sea.length]) < 60) ok = false;   // 해안선에서 60m 넘게 떨어진 바다 위
    if (ok) { best = { x, z }; break; }
  }
  if (!best) return 0;
  const el = document.createElement('div'); el.className = 'lbl place water'; el.textContent = '옥포만';
  box.appendChild(el); M.labels.push({ el, x: best.x, y: 0, z: best.z, pri: 9, kind: 'place', w: 0, h: 0 });
  return 1;
}

function afterLoad() {
  busStops(); streetProps();
  const T0 = performance.now(), ms = {}, tm = (k, f) => { const t = performance.now(), r = f(); ms[k] = Math.round(performance.now() - t); return r; };
  try {
    stats.lights = tm('lights', trafficLights); stats.bollards = tm('bollards', bollards); stats.signs = tm('signs', roadSigns);
    const [poles, wires] = tm('poles', utilityPoles); stats.poles = poles; stats.wires = wires;
    stats.school = tm('school', schoolZones); stats.areaLabels = tm('area', areaLabels);
  } catch (e) { console.warn('decor 소품', e); }
  // 보이는 가로수 자리(정류장·신호등 등 때문에 숨긴 것 빼고): ground.js(seohogyun-31)가 load 다음 차례에 읽어 나무 보호판을 깐다
  spots.streetTree = [];
  trees.forEach((t, i) => { if (t[4] === 'street' && treeRefs[i] && treeRefs[i].parts.length) spots.streetTree.push([Math.round(t[0] * 10) / 10, Math.round(t[1] * 10) / 10]); });
  if (window.__decor) Object.assign(window.__decor, { lights: stats.lights || 0, signs: stats.signs || 0, poles: stats.poles || 0, wires: stats.wires || 0, schoolPosts: stats.school || 0, bollards: stats.bollards || 0, areaLabels: stats.areaLabels || 0, lightAt: stats.lightAt || [], signAt: stats.signAt || [], ms: Object.assign(ms, { all: Math.round(performance.now() - T0) }) });
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
  crosswalks: stats.crosswalks, stopLines: stats.stopLines, busStops: stats.busStops || 0, lamps: stats.lamps || 0,
  spots, majorRoads: majors.length, oneway: majors.filter(m => m.r.ow).length, parking: stats.parking || 0, stalls: stats.stalls || 0,
};
})();
