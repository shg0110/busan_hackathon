/* 거리 디테일(아기자기하고 실제처럼): 간판·진열창, '임대 문의' 현수막, 옥상 물탱크·옥탑방, 주차된 차.
   - 간판: 상가정보 가게(window.SIM_DATA.shops) 위치에서 가장 가까운 건물 면, 그 가게 층에. 1층 가게는 유리 진열창도
   - 임대 현수막: 층 판정이 '가게 없는 층'인 층의 길 쪽 면에(노란 바탕 빨간 글씨 — 실제 거리의 빈 점포 표시)
   - 옥상 물탱크·옥탑방: 다가구·상가 3층 이상 건물의 일부(이름 해시로 정해 늘 같은 자리) — 장식이며 실측 아님
   - 주차된 차: 큰길·골목 가장자리, 교차로 근처는 비움 — 장식이며 실측 아님
   모두 InstancedMesh(한 번에 그리기)라 프레임에 거의 부담이 없다. */
(() => {
'use strict';
const M = window.__map, D = window.MAP_DATA, SD = window.SIM_DATA, F = window.FLOORS;
if (!M || !D) return;
const { buildings: B, scene, need, renderer } = M;
const hash = (s) => { let h = 2166136261; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967296; };
const signedArea = (p) => { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
const ring = (b) => { const p = b.p.slice(); if (signedArea(p) > 0) p.reverse(); return p; };   // 바깥 법선 = (-dz, 0, dx)
const floorH = (b) => (b.h - 0.6) / Math.max(1, b.lv);
const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3(), col = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
const group = new THREE.Group(); group.name = 'details'; scene.add(group);

// 건물 면 가운데 가장 가까운 면(점 x,z 기준)
function nearestEdge(b, x, z) {
  const p = ring(b); let best = null;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], c = p[(i + 1) % p.length], dx = c[0] - a[0], dz = c[1] - a[1], L2 = dx * dx + dz * dz; if (L2 < 1) continue;
    const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2)), px = a[0] + dx * t, pz = a[1] + dz * t, d = Math.hypot(x - px, z - pz);
    if (!best || d < best.d) { const L = Math.sqrt(L2); best = { d, a, c, L, t, ux: dx / L, uz: dz / L, nx: -dz / L, nz: dx / L }; }
  }
  return best;
}
// 길(차도) 쪽을 보는 면: 건물 가운데에서 가장 가까운 도로 점 방향과 법선이 가장 맞는 면
const roadSegs = [];
for (const r of D.roads) if (!r.ped) for (let i = 0; i < r.p.length - 1; i++) roadSegs.push([r.p[i][0], r.p[i][1], r.p[i + 1][0], r.p[i + 1][1], r]);
function streetEdge(b) {
  let cx = 0, cz = 0; for (const v of b.p) { cx += v[0]; cz += v[1]; } cx /= b.p.length; cz /= b.p.length;
  let bd = 1e18, rx = cx, rz = cz;
  for (const [ax, az, bx, bz] of roadSegs) {
    if (Math.abs(ax - cx) > 80 && Math.abs(bx - cx) > 80) continue;
    const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((cx - ax) * dx + (cz - az) * dz) / L2));
    const px = ax + dx * t, pz = az + dz * t, d = (px - cx) ** 2 + (pz - cz) ** 2; if (d < bd) { bd = d; rx = px; rz = pz; }
  }
  return nearestEdge(b, rx, rz);
}
// 면에 붙는 판(가로 w, 세로 h, 면에서 off 만큼 바깥, 높이 y, 면 위 위치 t)
function placeOnEdge(e, t, w, h, y, off) {
  const x = e.a[0] + (e.c[0] - e.a[0]) * t + e.nx * off, z = e.a[1] + (e.c[1] - e.a[1]) * t + e.nz * off;
  q.setFromAxisAngle(up, Math.atan2(e.nx, e.nz));   // 판의 앞(+z)이 바깥을 보게
  pos.set(x, y, z); scl.set(w, h, 1); mtx.compose(pos, q, scl); return mtx;
}
function canvasTex(draw, W = 256, H = 96) { const c = document.createElement('canvas'); c.width = W; c.height = H; draw(c.getContext('2d'), W, H);
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; return t; }
const plane = new THREE.PlaneGeometry(1, 1);

// ── 간판 + 진열창 ─────────────────────────────────────────
const SIGN_COLS = ['#1971c2', '#2b8a3e', '#5f3dc4', '#c2255c', '#343a40', '#0c8599', '#1864ab', '#e9ecef', '#495057', '#087f5b', '#862e9c', '#364fc7'];
const signTex = canvasTex((g, W, H) => {   // 회색 바탕에 흰 글자 줄(색을 곱하면 '색 간판 + 밝은 글자'처럼 보임)
  g.fillStyle = '#d0d0d0'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#ffffff'; const y = H * 0.36; for (let i = 0; i < 4; i++) g.fillRect(W * (0.12 + i * 0.2), y, W * 0.15, H * 0.28);
  g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, H - 6, W, 6);
});
const shops = (SD && SD.shops || []).filter(s => s.b >= 0 && B[s.b]);
const slots = new Map();   // 같은 건물·면·층에 가게가 여럿이면 면을 따라 나눠 단다
const signs = [], glass = [];
for (const s of shops) {
  const b = B[s.b], f = Math.max(1, Math.min(b.lv, s.f || 1)), e = nearestEdge(b, s.x, s.z); if (!e || e.L < 2.5) continue;
  const key = s.b + ':' + f + ':' + e.a[0].toFixed(1) + ',' + e.a[1].toFixed(1);
  const k = slots.get(key) || 0; slots.set(key, k + 1);
  signs.push({ s, b, f, e, k, key });
}
const signMesh = new THREE.InstancedMesh(plane, new THREE.MeshLambertMaterial({ map: signTex, side: THREE.DoubleSide }), signs.length);
const glassMesh = new THREE.InstancedMesh(plane, new THREE.MeshLambertMaterial({ color: '#6f8ea8', side: THREE.DoubleSide }), signs.length);
let ng = 0;
signs.forEach((g, i) => {
  const n = slots.get(g.key), seg = 1 / n, t = seg * (g.k + 0.5), w = Math.min(g.e.L * seg * 0.88, 5.2), fh = floorH(g.b);
  const y = (g.b.b || 0) + (g.f === 1 ? Math.min(fh, 4) - 0.55 : (g.f - 1) * fh + fh * 0.55);
  signMesh.setMatrixAt(i, placeOnEdge(g.e, t, w, g.f === 1 ? 1.1 : 0.85, y, 0.18));
  signMesh.setColorAt(i, col.set(SIGN_COLS[Math.floor(hash(g.s.n) * SIGN_COLS.length)]));
  if (g.f === 1) { glassMesh.setMatrixAt(ng++, placeOnEdge(g.e, t, w, Math.min(fh, 4) - 1.25, (g.b.b || 0) + (Math.min(fh, 4) - 1.25) / 2 + 0.15, 0.09)); }
});
glassMesh.count = ng;
signMesh.instanceColor && (signMesh.instanceColor.needsUpdate = true);
for (const m of [signMesh, glassMesh]) { m.renderOrder = 11.5; group.add(m); }

// ── '임대 문의' 현수막: 가게 없는 층의 길 쪽 면 ───────────────
const rentTex = canvasTex((g, W, H) => {
  g.fillStyle = '#ffe14d'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#d6262b'; g.font = `900 ${H * 0.56}px -apple-system, "Apple SD Gothic Neo", "Noto Sans KR", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('임대 문의', W / 2, H * 0.54);
  g.strokeStyle = '#d6262b'; g.lineWidth = 6; g.strokeRect(6, 6, W - 12, H - 12);
}, 256, 88);
const rents = [];
if (F) for (const k in F.b) {
  const b = B[+k]; if (!b || b.k === 'roof') continue;
  const empties = F.b[k].filter(f => f.state === 'empty' && f.n <= b.lv); if (!empties.length) continue;
  const e = streetEdge(b); if (!e || e.L < 3) continue;
  for (const f of empties) rents.push({ b, e, f: f.n });
}
const rentMesh = new THREE.InstancedMesh(plane, new THREE.MeshBasicMaterial({ map: rentTex, side: THREE.DoubleSide }), rents.length);
rents.forEach((r, i) => {
  const fh = floorH(r.b), w = Math.min(r.e.L * 0.7, 4.6), h = Math.min(w * 0.34, fh * 0.55);
  rentMesh.setMatrixAt(i, placeOnEdge(r.e, 0.5, w, h, (r.b.b || 0) + (r.f - 1) * fh + fh * 0.52, 0.2));
});
rentMesh.renderOrder = 11.6; group.add(rentMesh);

// ── 옥상: 물탱크·옥탑방 ────────────────────────────────────
const tanks = [], rooms = [];
B.forEach((b, i) => {
  if (!(b.k === 'house' || b.k === 'retail' || b.k === 'yes' || b.k === 'hotel') || b.lv < 3 || b.a < 45 || b.b) return;
  const h1 = hash(b.id + 't'), h2 = hash(b.id + 'r'), p = ring(b);
  let cx = 0, cz = 0; for (const v of p) { cx += v[0]; cz += v[1]; } cx /= p.length; cz /= p.length;
  // 지붕 안쪽 한 모서리 쪽(가운데에서 가장 먼 꼭짓점 방향으로 40%)
  const far = p.reduce((m, v) => (Math.hypot(v[0] - cx, v[1] - cz) > Math.hypot(m[0] - cx, m[1] - cz) ? v : m), p[0]);
  if (h1 < 0.5) tanks.push({ x: cx + (far[0] - cx) * 0.42, z: cz + (far[1] - cz) * 0.42, y: b.h, r: 0.75 + h1 * 0.5 });
  if (b.k === 'house' && b.a > 70 && h2 < 0.32) rooms.push({ x: cx - (far[0] - cx) * 0.25, z: cz - (far[1] - cz) * 0.25, y: b.h, w: 3 + h2 * 4, d: 2.6 + h2 * 3, rot: Math.atan2(p[1][1] - p[0][1], p[1][0] - p[0][0]), b });
});
const tankGeo = new THREE.CylinderGeometry(1, 1, 1, 14); tankGeo.translate(0, 0.5, 0);
const tankMesh = new THREE.InstancedMesh(tankGeo, new THREE.MeshLambertMaterial({ color: '#4a8fd8' }), tanks.length);
tanks.forEach((t, i) => { pos.set(t.x, t.y, t.z); scl.set(t.r, 1.3 + t.r * 0.6, t.r); q.identity(); mtx.compose(pos, q, scl); tankMesh.setMatrixAt(i, mtx); });
const boxGeo = new THREE.BoxGeometry(1, 1, 1); boxGeo.translate(0, 0.5, 0);
const roomMesh = new THREE.InstancedMesh(boxGeo, new THREE.MeshLambertMaterial({ color: '#ffffff' }), rooms.length);
rooms.forEach((r, i) => { pos.set(r.x, r.y, r.z); scl.set(r.w, 2.5, r.d); q.setFromAxisAngle(up, -r.rot); mtx.compose(pos, q, scl); roomMesh.setMatrixAt(i, mtx);
  roomMesh.setColorAt(i, col.set(['#e9e2d6', '#d9c7b8', '#eceff2', '#e4d6c8'][Math.floor(hash(r.b.id) * 4)])); });
if (roomMesh.instanceColor) roomMesh.instanceColor.needsUpdate = true;
for (const m of [tankMesh, roomMesh]) { m.castShadow = true; m.receiveShadow = true; m.renderOrder = 10; group.add(m); }

// ── 주차된 차 ────────────────────────────────────────────
// 건물과 겹치지 않게: 건물 격자
const GR = 25, grid = new Map();
B.forEach((b, i) => { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const v of b.p) { x0 = Math.min(x0, v[0]); x1 = Math.max(x1, v[0]); z0 = Math.min(z0, v[1]); z1 = Math.max(z1, v[1]); }
  for (let gx = Math.floor(x0 / GR); gx <= Math.floor(x1 / GR); gx++) for (let gz = Math.floor(z0 / GR); gz <= Math.floor(z1 / GR); gz++) { const k = gx + ',' + gz; (grid.get(k) || grid.set(k, []).get(k)).push(i); } });
function inside(x, z, p) { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const [xi, zi] = p[i], [xj, zj] = p[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi + 1e-12) + xi) c = !c; } return c; }
const onBuilding = (x, z) => (grid.get(Math.floor(x / GR) + ',' + Math.floor(z / GR)) || []).some(i => inside(x, z, B[i].p));
// 교차로 근처(끝점 공유) 12m 는 비움
const ends = new Map(); for (const r of D.roads) for (const v of [r.p[0], r.p[r.p.length - 1]]) { const k = v[0].toFixed(0) + ',' + v[1].toFixed(0); ends.set(k, (ends.get(k) || 0) + 1); }
const CAR_COLS = [['#f1f3f5', 35], ['#ced4da', 20], ['#2b2f33', 15], ['#868e96', 10], ['#2c4a7a', 7], ['#d8cbb3', 5], ['#4f6f52', 4], ['#7a4b4b', 4]];
const carCol = (u) => { let s = 0; for (const [c, w] of CAR_COLS) { s += w; if (u * 100 < s) return c; } return CAR_COLS[0][0]; };
const cars = [];
const CAR_ROADS = new Set(['primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street']);
for (const r of D.roads) {
  if (!CAR_ROADS.has(r.k) || r.w < 6 || r.br) continue;
  const big = r.w >= 10;
  for (let i = 0; i < r.p.length - 1; i++) {
    const [ax, az] = r.p[i], [bx, bz] = r.p[i + 1], dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz); if (L < 14) continue;
    const ux = dx / L, uz = dz / L, nx = -uz, nz = ux;
    for (const side of big ? [1, -1] : [1]) {
      let s = 8 + hash(r.n + i + side) * 6;
      while (s < L - 8) {
        const u = hash(`${ax}|${az}|${s}|${side}`);
        if (u < 0.62) {   // 비어 있는 칸도 있게
          const off = r.w / 2 - 1.15, x = ax + ux * s + nx * off * side, z = az + uz * s + nz * off * side;
          if (!onBuilding(x, z)) cars.push({ x, z, a: Math.atan2(ux, uz), c: carCol(hash(u + 'c')) });
        }
        s += 6.2 + hash(`${s}${i}`) * 3;
      }
    }
  }
  if (cars.length > 1400) break;
}
const body = new THREE.InstancedMesh(boxGeo, new THREE.MeshLambertMaterial({ color: '#ffffff' }), cars.length);
const cabin = new THREE.InstancedMesh(boxGeo, new THREE.MeshLambertMaterial({ color: '#ffffff' }), cars.length);
const glassC = new THREE.Color('#5d6f80');
cars.forEach((c, i) => {
  q.setFromAxisAngle(up, c.a);
  pos.set(c.x, 0.28, c.z); scl.set(1.75, 0.72, 4.3); mtx.compose(pos, q, scl); body.setMatrixAt(i, mtx); body.setColorAt(i, col.set(c.c));
  pos.set(c.x, 0.98, c.z); scl.set(1.55, 0.6, 2.3); mtx.compose(pos, q, scl); cabin.setMatrixAt(i, mtx); cabin.setColorAt(i, col.set(c.c).lerp(glassC, 0.55));
});
for (const m of [body, cabin]) { if (m.instanceColor) m.instanceColor.needsUpdate = true; m.castShadow = true; m.renderOrder = 10; group.add(m); }

// 반복 그리기 묶음은 원래 모양(원점의 1m 판) 기준으로 화면 밖 판정을 해서, 원점이 안 보이면 통째로 사라진다 → 끈다
group.children.forEach(m => { m.frustumCulled = false; });
renderer.shadowMap.needsUpdate = true;
// 보기 설정
const layers = document.getElementById('layers');
const lab = document.createElement('label'); lab.className = 'tog';
lab.innerHTML = '<input type="checkbox" id="L-detail" checked><span>간판·차·옥상</span>';
layers.appendChild(lab);
document.getElementById('L-detail').onchange = (e) => { group.visible = e.target.checked; renderer.shadowMap.needsUpdate = true; need(); };
need();
window.__details = { signs: signs.length, rents: rents.length, tanks: tanks.length, rooms: rooms.length, cars: cars.length };
})();
