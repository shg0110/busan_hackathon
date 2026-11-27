/* 옥포 빈 점포 지도 — 3D 바탕 지도.
   자료: window.MAP_DATA(tools/map_build.py), window.STATS(tools/web_stats.py)
   좌표: x = 동쪽(m), z = 남쪽(m), y = 위. 범위 중심이 원점.
   화면은 움직일 때만 다시 그린다(배터리·발열). ?bench=1 이면 6초 동안 돌면서 프레임 시간을 잰다. */
(() => {
'use strict';
const D = window.MAP_DATA, ST = window.STATS;
const Q = new URLSearchParams(location.search);
const BENCH = Q.has('bench');
THREE.ColorManagement.legacyMode = false;   // 적은 색 그대로 나오게(r147 기본값은 색을 한 번 더 밝힘)

// ── 색 ───────────────────────────────────────────────
const C = {
  ground: '#e6e2d9', water: '#9fc2e4', green: '#cddfbf', wood: '#b6cfa6', pitch: '#d3e4c3',
  road: '#ffffff', roadMinor: '#f9f8f5', ped: '#f3ede2', bridge: '#f2f2f2',
  walls: ['#fbfaf8', '#f6f5f2', '#f9f8f4', '#f3f2ee', '#fdfcfa', '#f5f3ef'],
  roof: '#cbc8c1', roofApt: '#c2bfb8',
  est: '#f2b48f',          // 층수 추정 건물 강조
  select: '#d9480f',
};

// ── 렌더러·장면 ─────────────────────────────────────────
const canvas = document.getElementById('c');
const SMALL = Math.min(innerWidth, innerHeight) < 720;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, SMALL ? 1.75 : 2));
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;      // 건물은 움직이지 않으니 그림자는 한 번만 계산
const scene = new THREE.Scene();
scene.background = new THREE.Color(C.ground);
const HX = D.meta.half[0], HZ = D.meta.half[1];
const R = Math.hypot(HX, HZ);
scene.fog = new THREE.Fog(C.ground, R * 1.15, R * 2.6);

const camera = new THREE.PerspectiveCamera(36, 1, 3, R * 6);
const controls = new THREE.OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.09;
controls.maxPolarAngle = Math.PI * 0.46; controls.minDistance = 35; controls.maxDistance = R * 2.2;
controls.screenSpacePanning = false;
// 지도 앱처럼: 끌기 = 옮기기, 오른쪽 끌기 = 돌리기 / 한 손가락 = 옮기기, 두 손가락 = 확대·돌리기
controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
controls.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
controls.listenToKeyEvents(window); controls.keyPanSpeed = 30;

// 처음 보는 자리: 상가 밀집지(건물 바닥 넓이 가중 중심) 남동쪽 위에서
const core = (() => {
  let sx = 0, sz = 0, sw = 0;
  for (const b of D.buildings) {
    if (b.k === 'apartments' || b.k === 'house') continue;
    const c = centroid(b.p), w = b.a;
    if (Math.abs(c[0]) > HX * 0.7 || Math.abs(c[1]) > HZ * 0.7) continue;
    sx += c[0] * w; sz += c[1] * w; sw += w;
  }
  return sw ? [sx / sw, sz / sw] : [0, 0];
})();
const HOME = {
  t: new THREE.Vector3(core[0], 0, core[1]),
  c: new THREE.Vector3(core[0] + R * 0.38, R * 0.52, core[1] + R * 0.62),
};
camera.position.copy(HOME.c); controls.target.copy(HOME.t);
if (Q.get('cam')) camera.position.fromArray(Q.get('cam').split(',').map(Number));
if (Q.get('t')) { const [tx, tz] = Q.get('t').split(',').map(Number); controls.target.set(tx, 0, tz); }
controls.update();

// 트랙패드 두 손가락 쓸기 = 옮기기(마우스 휠은 확대 그대로)
const _r = new THREE.Vector3(), _f = new THREE.Vector3();
function panBy(dx, dy) {
  const k = camera.position.distanceTo(controls.target) / canvas.clientHeight * 1.1;
  _r.setFromMatrixColumn(camera.matrixWorld, 0); _r.y = 0; _r.normalize();
  _f.subVectors(controls.target, camera.position); _f.y = 0; _f.normalize();
  const mv = _r.multiplyScalar(dx * k).add(_f.multiplyScalar(dy * k));
  camera.position.add(mv); controls.target.add(mv); clampTarget(); controls.update(); need();
}
canvas.addEventListener('wheel', (e) => {
  if (e.ctrlKey) return;
  const mouse = e.deltaX === 0 && Math.abs(e.wheelDeltaY || 0) >= 120 && (e.wheelDeltaY % 120 === 0);
  if (mouse) return;
  e.preventDefault(); e.stopImmediatePropagation(); panBy(e.deltaX, -e.deltaY);
}, { capture: true, passive: false });
// 지도 밖으로 멀리 나가지 않게
function clampTarget() {
  const t = controls.target, lx = HX * 0.95, lz = HZ * 0.95;
  const cx = Math.max(-lx, Math.min(lx, t.x)), cz = Math.max(-lz, Math.min(lz, t.z));
  if (cx !== t.x || cz !== t.z) { camera.position.x += cx - t.x; camera.position.z += cz - t.z; t.x = cx; t.z = cz; }
}
controls.addEventListener('change', () => { clampTarget(); need(); });

// ── 빛 ───────────────────────────────────────────────
scene.add(new THREE.HemisphereLight('#ffffff', '#a9a294', 0.5));
const sun = new THREE.DirectionalLight('#fff4e6', 1.15);
sun.position.set(-R * 0.5, R * 0.9, R * 0.35);
sun.castShadow = true;
sun.shadow.mapSize.set(SMALL ? 2048 : 4096, SMALL ? 2048 : 4096);
Object.assign(sun.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 10, far: R * 3 });
sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.5;
scene.add(sun);

// ── 기하 도우미 ─────────────────────────────────────────
function centroid(p) { let x = 0, z = 0; for (const q of p) { x += q[0]; z += q[1]; } return [x / p.length, z / p.length]; }
function signedArea(p) { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }
const merge = (arr) => THREE.BufferGeometryUtils.mergeBufferGeometries(arr, false);

// 평평한 다각형(땅 위 y 높이). 삼각분할은 three 의 ShapeUtils.
function flatGeo(polys, y) {
  const pos = [];
  for (const p of polys) {
    if (p.length < 3) continue;
    const v2 = p.map(q => new THREE.Vector2(q[0], q[1]));
    const tris = THREE.ShapeUtils.triangulateShape(v2, []);
    for (const t of tris) {
      const a = p[t[0]], b = p[t[1]], c = p[t[2]];
      // 위를 보게(법선 +y): (b-a)×(c-a) 의 y = dz1*dx2 - dx1*dz2 > 0
      const ny = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
      if (ny >= 0) pos.push(a[0], y, a[1], b[0], y, b[1], c[0], y, c[1]);
      else pos.push(a[0], y, a[1], c[0], y, c[1], b[0], y, b[1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
function flatMesh(polys, y, color, order) {
  const m = new THREE.Mesh(flatGeo(polys, y), new THREE.MeshLambertMaterial({ color, depthWrite: false }));
  m.renderOrder = order; m.receiveShadow = true; scene.add(m); return m;
}

// 도로: 선을 폭만큼 띠로(꺾이는 곳은 이음 각도 제한)
function ribbon(pts, w, y, out) {
  const h = w / 2, n = pts.length;
  const L = [], Rr = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let d1x = p[0] - a[0], d1z = p[1] - a[1], d2x = b[0] - p[0], d2z = b[1] - p[1];
    const l1 = Math.hypot(d1x, d1z) || 1, l2 = Math.hypot(d2x, d2z) || 1;
    d1x /= l1; d1z /= l1; d2x /= l2; d2z /= l2;
    if (i === 0) { d1x = d2x; d1z = d2z; } if (i === n - 1) { d2x = d1x; d2z = d1z; }
    let tx = d1x + d2x, tz = d1z + d2z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const nx = -tz, nz = tx;
    const cos = Math.max(0.35, nx * -d2z + nz * d2x);   // 이음 길이 제한(날카로운 꺾임에서 튀지 않게)
    const k = h / cos;
    L.push([p[0] + nx * k, p[1] + nz * k]); Rr.push([p[0] - nx * k, p[1] - nz * k]);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = L[i], b = Rr[i], c = L[i + 1], d = Rr[i + 1];
    out.push(a[0], y, a[1], c[0], y, c[1], b[0], y, b[1], b[0], y, b[1], c[0], y, c[1], d[0], y, d[1]);
  }
  // 끝을 둥글게 보이도록 작은 원판(교차로 이음새 메움)
  for (const p of [pts[0], pts[n - 1]]) {
    const seg = 8;
    for (let s = 0; s < seg; s++) {
      const a0 = s / seg * Math.PI * 2, a1 = (s + 1) / seg * Math.PI * 2;
      out.push(p[0], y, p[1], p[0] + Math.cos(a1) * h, y, p[1] + Math.sin(a1) * h, p[0] + Math.cos(a0) * h, y, p[1] + Math.sin(a0) * h);
    }
  }
}
function ribbonMesh(list, y, color, order) {
  const pos = [];
  for (const r of list) ribbon(r.p, r.w, y, pos);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  // 법선은 모두 위
  const nrm = new Float32Array(pos.length); for (let i = 1; i < nrm.length; i += 3) nrm[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color, depthWrite: false, side: THREE.DoubleSide }));
  m.renderOrder = order; m.receiveShadow = true; scene.add(m); return m;
}

// ── 땅·바다·녹지·도로 ─────────────────────────────────────
const ground = new THREE.Mesh(new THREE.PlaneGeometry(R * 8, R * 8), new THREE.MeshLambertMaterial({ color: C.ground, depthWrite: false }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; ground.renderOrder = 0; scene.add(ground);
flatMesh(D.greens.filter(g => g.k === 'wood' || g.k === 'forest' || g.k === 'scrub').map(g => g.p), 0, C.wood, 1);
flatMesh(D.greens.filter(g => !['wood', 'forest', 'scrub', 'pitch'].includes(g.k)).map(g => g.p), 0, C.green, 2);
flatMesh(D.greens.filter(g => g.k === 'pitch').map(g => g.p), 0, C.pitch, 3);
const waterMesh = flatMesh(D.water.map(w => w.p), 0, C.water, 4);
waterMesh.receiveShadow = false;
const MAJOR = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);
ribbonMesh(D.roads.filter(r => r.ped), 0, C.ped, 5);
ribbonMesh(D.roads.filter(r => !r.ped && !MAJOR.has(r.k)), 0, C.roadMinor, 6);
ribbonMesh(D.roads.filter(r => MAJOR.has(r.k)), 0, C.road, 7);

// ── 건물 ───────────────────────────────────────────────
// 모든 건물을 한 덩어리로 합친다. triOwner[삼각형 번호] = 건물 번호 → 누른 건물 찾기.
const B = D.buildings;
const bPos = [], bNrm = [], bCol = [], bUv = [], triOwner = [];
const ROOF_UV = [0.95, 0.15];   // 무늬의 흰 칸(지붕은 무늬 없이)
function floorTexture() {
  const S = 64, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
  g.fillStyle = '#e2e6eb'; g.fillRect(4, S * 0.18, S * 0.74, S * 0.52);    // 창(윗부분이 v 큰 쪽 → 캔버스 위쪽)
  g.fillStyle = '#d6dadf'; g.fillRect(4, S * 0.18, S * 0.74, 3);
  g.fillStyle = '#e4e1db'; g.fillRect(0, S - 5, S, 5);                     // 층 사이 슬래브(v=0 쪽)
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.encoding = THREE.sRGBEncoding;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return t;
}
const tmpC = new THREE.Color();
const wallCols = C.walls.map(h => new THREE.Color(h));
const roofCol = new THREE.Color(C.roof), roofApt = new THREE.Color(C.roofApt);
const bRange = [];   // 건물별 [시작 꼭짓점, 끝 꼭짓점]
function pushTri(a, b, c, n, col, owner) {
  bPos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
  for (let k = 0; k < 3; k++) { bNrm.push(n[0], n[1], n[2]); bCol.push(col.r, col.g, col.b); bUv.push(ROOF_UV[0], ROOF_UV[1]); }
  triOwner.push(owner);
}
B.forEach((b, bi) => {
  let p = b.p.slice();
  if (signedArea(p) > 0) p.reverse();          // 시계 방향으로 맞춤 → 바깥 법선 = (-dz, 0, dx)
  const y0 = b.b || 0, y1 = y0 + b.h;
  const start = bPos.length / 3;
  const wc = wallCols[b.c % wallCols.length];
  // 벽: 위로 갈수록 아주 조금 밝게(아래는 땅 반사로 어둡게 보이는 느낌)
  const wallTop = wc, wallBot = tmpC.copy(wc).multiplyScalar(0.94).clone();
  const fh = b.k === 'roof' ? 99 : (b.h - 0.6) / b.lv;   // 층고(지붕만 있는 구조물은 무늬 없음)
  const v1 = b.k === 'roof' ? 0.15 : (y1 - y0 - 0.6) / fh + 0.0;
  let run = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], c2 = p[(i + 1) % p.length];
    const dx = c2[0] - a[0], dz = c2[1] - a[1], l = Math.hypot(dx, dz);
    if (l < 0.05) continue;
    const n = [-dz / l, 0, dx / l];
    const A = [a[0], y0, a[1]], Bv = [c2[0], y0, c2[1]], Cv = [c2[0], y1, c2[1]], Dv = [a[0], y1, a[1]];
    bPos.push(...A, ...Bv, ...Cv, ...A, ...Cv, ...Dv);
    const u0 = run / 3.6, u1 = (run + l) / 3.6; run += l;     // 창 간격 3.6m
    // 벽 위 0.6m(난간)는 v 가 층 수를 넘어 흰 칸으로 가도록 그대로 둔다
    bUv.push(u0, 0, u1, 0, u1, v1 + 0.6 / fh, u0, 0, u1, v1 + 0.6 / fh, u0, v1 + 0.6 / fh);
    for (let k = 0; k < 6; k++) bNrm.push(...n);
    for (const cc of [wallBot, wallBot, wallTop, wallBot, wallTop, wallTop]) bCol.push(cc.r, cc.g, cc.b);
    triOwner.push(bi, bi);
  }
  // 지붕
  const v2 = p.map(q => new THREE.Vector2(q[0], q[1]));
  const rc = b.k === 'apartments' ? roofApt : roofCol;
  for (const t of THREE.ShapeUtils.triangulateShape(v2, [])) {
    const a = p[t[0]], c1 = p[t[1]], c2 = p[t[2]];
    const ny = (c1[1] - a[1]) * (c2[0] - a[0]) - (c1[0] - a[0]) * (c2[1] - a[1]);
    const A = [a[0], y1, a[1]], B1 = [c1[0], y1, c1[1]], B2 = [c2[0], y1, c2[1]];
    if (ny >= 0) pushTri(A, B1, B2, [0, 1, 0], rc, bi); else pushTri(A, B2, B1, [0, 1, 0], rc, bi);
  }
  bRange.push([start, bPos.length / 3]);
});
const bGeo = new THREE.BufferGeometry();
bGeo.setAttribute('position', new THREE.Float32BufferAttribute(bPos, 3));
bGeo.setAttribute('normal', new THREE.Float32BufferAttribute(bNrm, 3));
bGeo.setAttribute('uv', new THREE.Float32BufferAttribute(bUv, 2));
const colAttr = new THREE.Float32BufferAttribute(bCol, 3);
bGeo.setAttribute('color', colAttr);
const baseCol = Float32Array.from(bCol);
bGeo.computeBoundingSphere();
const bMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: floorTexture() });
const bMesh = new THREE.Mesh(bGeo, bMat);
bMesh.castShadow = true; bMesh.receiveShadow = true; bMesh.renderOrder = 10;
scene.add(bMesh);
// 지붕 윤곽선(위에서 볼 때 건물 경계가 또렷하게)
{
  const lp = [];
  for (const b of B) {
    const y = (b.b || 0) + b.h + 0.05;
    for (let i = 0; i < b.p.length; i++) { const a = b.p[i], c = b.p[(i + 1) % b.p.length]; lp.push(a[0], y, a[1], c[0], y, c[1]); }
  }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: '#b9b2a5', transparent: true, opacity: 0.55 }));
  lines.renderOrder = 11; scene.add(lines);
}

// 층수 추정 건물 강조 켜고 끄기
function paintEstimated(on) {
  const arr = colAttr.array, est = new THREE.Color(C.est);
  arr.set(baseCol);
  if (on) B.forEach((b, bi) => { if (!b.real) { const [s, e] = bRange[bi]; for (let v = s; v < e; v++) { arr[v * 3] = est.r; arr[v * 3 + 1] = est.g; arr[v * 3 + 2] = est.b; } } });
  colAttr.needsUpdate = true; need();
}

// 고른 건물: 같은 모양을 강조색으로 덧그림
let selMesh = null, selIdx = -1;
function select(bi) {
  if (selMesh) { scene.remove(selMesh); selMesh.geometry.dispose(); selMesh = null; }
  selIdx = bi;
  if (bi < 0) { info.hidden = true; need(); return; }
  const [s, e] = bRange[bi];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(bPos.slice(s * 3, e * 3), 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(bNrm.slice(s * 3, e * 3), 3));
  selMesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: C.select, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  selMesh.renderOrder = 12; scene.add(selMesh);
  showInfo(B[bi]); need();
}

// ── 건물 정보 ─────────────────────────────────────────
const info = document.getElementById('info');
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function showInfo(b) {
  document.getElementById('i-title').textContent = b.n || b.ko;
  const lvTag = b.real ? '<span class="tag ok">확인</span>' : '<span class="tag est">추정</span>';
  const rows = [
    ['종류', esc(b.ko)],
    ['층수', `지상 ${b.lv}층${lvTag}`],
    ['높이', `약 ${Math.round(b.h)}m`],
    ['바닥 넓이', `약 ${b.a.toLocaleString('ko-KR')}㎡`],
    ['자료', b.src === 'osm' ? 'OpenStreetMap' : 'Overture Maps(위성 인식)'],
  ];
  const note = b.real ? '' :
    '<p class="note">이 건물은 원자료에 층수가 없어 바닥 넓이로 짐작한 높이입니다.</p>';
  document.getElementById('i-body').innerHTML =
    `<dl class="rows">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>${note}`;
  info.hidden = false;
}
document.getElementById('i-close').onclick = () => select(-1);
addEventListener('keydown', (e) => { if (e.key === 'Escape') select(-1); });

// 누르기: 끌기와 구분(5px 넘게 움직이면 누르기 아님)
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let down = null;
canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) { down = null; return; }
  down = null;
  const r = canvas.getBoundingClientRect();
  ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObject(bMesh, false)[0];
  select(hit ? triOwner[hit.faceIndex] : -1);
});

// ── 지도 위 글자 ───────────────────────────────────────
const labelBox = document.getElementById('labels');
const labels = [];
const PLACE_PRI = { marketplace: 9, townhall: 8, park: 6, police: 5, library: 5, museum: 5, post_office: 4, hospital: 3, supermarket: 2, hotel: 2, bus_station: 6, ferry_terminal: 7, industrial: 7, harbour: 8 };
for (const p of D.places) {
  const el = document.createElement('div');
  const pri = PLACE_PRI[p.k] ?? 3;
  el.className = 'lbl place' + (pri >= 8 ? ' major' : '');
  el.textContent = p.n;
  labelBox.appendChild(el);
  labels.push({ el, x: p.x, y: 4, z: p.z, pri, kind: 'place', w: 0, h: 0 });
}
for (const r of D.road_labels) {
  const el = document.createElement('div');
  el.className = 'lbl road'; el.textContent = r.n;
  labelBox.appendChild(el);
  labels.push({ el, x: r.x, y: 1, z: r.z, pri: MAJOR.has(r.k) ? 4 : 1, kind: 'road', w: 0, h: 0 });
}
labels.sort((a, b) => b.pri - a.pri);
const show = { place: true, road: true };
const _v = new THREE.Vector3();
function placeLabels() {
  const W = canvas.clientWidth, H = canvas.clientHeight, taken = [];
  const dist = camera.position.distanceTo(controls.target);
  for (const L of labels) {
    const far = L.kind === 'road' ? (L.pri < 4 ? R * 0.9 : R * 3) : (L.pri <= 2 ? R * 0.5 : L.pri < 5 ? R * 0.9 : R * 3);
    if (!show[L.kind] || dist > far) { L.el.classList.add('off'); continue; }
    _v.set(L.x, L.y, L.z).project(camera);
    if (_v.z > 1 || _v.x < -1.1 || _v.x > 1.1 || _v.y < -1.1 || _v.y > 1.1) { L.el.classList.add('off'); continue; }
    if (!L.w) { L.el.classList.remove('off'); L.w = L.el.offsetWidth; L.h = L.el.offsetHeight; }
    const x = (_v.x + 1) / 2 * W - L.w / 2, y = (1 - _v.y) / 2 * H - L.h / 2;
    const box = [x - 4, y - 2, x + L.w + 4, y + L.h + 2];
    if (taken.some(t => box[0] < t[2] && box[2] > t[0] && box[1] < t[3] && box[3] > t[1])) { L.el.classList.add('off'); continue; }
    taken.push(box);
    L.el.classList.remove('off');
    L.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }
}

// ── 요약 카드 ─────────────────────────────────────────
function fillCard() {
  const $ = (id) => document.getElementById(id);
  $('s-label').textContent = ST.label;
  $('s-general').textContent = ST.general.toFixed(1);
  $('s-mini').textContent = `공실률 ${ST.general.toFixed(1)}% · ${ST.rank}위`;
  $('s-rank').textContent = `${ST.scope.split('(')[0]} ${ST.of}개 상권 중 ${ST.rank}위`;
  $('s-quarter').textContent = ST.quarter;
  $('s-large').textContent = ST.large.toFixed(1) + '%';
  $('s-before').textContent = ST.series[0].v.toFixed(1) + '%';
  $('s-src').textContent = `${ST.source}, ${ST.quarter}`;
  // 꺾은선: 옥포(강조색) + 비교 둘(회색 계열)
  const svg = $('s-chart'), W = 280, H = 96, pl = 26, pr = 34, pt = 8, pb = 18;
  const all = [...ST.series.map(s => s.v), ...ST.compare.flatMap(c => c.series)].filter(v => v != null);
  const lo = Math.floor(Math.min(...all) / 5) * 5, hi = Math.ceil(Math.max(...all) / 5) * 5;
  const n = ST.series.length;
  const X = (i) => pl + i * (W - pl - pr) / (n - 1), Y = (v) => pt + (hi - v) / (hi - lo) * (H - pt - pb);
  const path = (vals) => vals.map((v, i) => v == null ? '' : `${i && vals[i - 1] != null ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  const cols = ['#9aa0a8', '#c9ccd1'];
  let s = '';
  for (let v = lo; v <= hi; v += 10) s += `<line x1="${pl}" x2="${W - pr}" y1="${Y(v)}" y2="${Y(v)}" stroke="#eee" /><text x="${pl - 5}" y="${Y(v) + 3.5}" font-size="9.5" fill="#8a8d93" text-anchor="end">${v}</text>`;
  const ends = ST.compare.map((c, k) => ({ v: c.series[n - 1], y: Y(c.series[n - 1]) + 3.5, k })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 11) ends[i].y = ends[i - 1].y + 11;   // 끝 숫자끼리 11px 띄우기
  ST.compare.forEach((c, k) => { s += `<path d="${path(c.series)}" fill="none" stroke="${cols[k]}" stroke-width="1.8" stroke-linejoin="round"/>`; });
  for (const e of ends) if (e.v != null) s += `<text x="${X(n - 1) + 5}" y="${e.y}" font-size="9.5" fill="#8a8d93">${e.v.toFixed(1)}</text>`;
  const ov = ST.series.map(x => x.v);
  s += `<path d="${path(ov)}" fill="none" stroke="#d9480f" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>`;
  s += `<circle cx="${X(n - 1)}" cy="${Y(ov[n - 1])}" r="3.5" fill="#d9480f"/>`;
  s += `<text x="${X(n - 1) + 6}" y="${Y(ov[n - 1]) + 4}" font-size="10.5" font-weight="700" fill="#d9480f">${ov[n - 1].toFixed(1)}</text>`;
  s += `<text x="${X(0)}" y="${H - 4}" font-size="9.5" fill="#8a8d93" text-anchor="start">${ST.series[0].q.replace('Q', '분기').replace('.', '년 ')}</text>`;
  s += `<text x="${X(n - 1)}" y="${H - 4}" font-size="9.5" fill="#8a8d93" text-anchor="end">${ST.series[n - 1].q.replace('Q', '분기').replace('.', '년 ')}</text>`;
  svg.innerHTML = s;
  $('s-legend').innerHTML = `<span><i style="background:#d9480f"></i>${ST.label}</span>` +
    ST.compare.map((c, k) => `<span><i style="background:${cols[k]}"></i>${c.label}</span>`).join('');
}
fillCard();
const card = document.getElementById('card');
function syncCardHeight() { document.documentElement.style.setProperty('--card-h', card.offsetHeight + 'px'); }
document.getElementById('card-toggle').onclick = (e) => {
  const c = card.classList.toggle('collapsed');
  e.currentTarget.setAttribute('aria-expanded', String(!c)); e.currentTarget.title = c ? '펴기' : '접기';
  syncCardHeight();
};
if (SMALL) { card.classList.add('collapsed'); document.getElementById('card-toggle').setAttribute('aria-expanded', 'false'); }

// ── 보기 설정 ─────────────────────────────────────────
document.getElementById('L-est').onchange = (e) => paintEstimated(e.target.checked);
document.getElementById('L-names').onchange = (e) => { show.place = e.target.checked; need(); };
document.getElementById('L-roads').onchange = (e) => { show.road = e.target.checked; need(); };

// ── 조작 버튼 ─────────────────────────────────────────
function orbit(dAz, dPol) {
  const off = new THREE.Vector3().subVectors(camera.position, controls.target), sp = new THREE.Spherical().setFromVector3(off);
  sp.theta += dAz; sp.phi = Math.max(0.08, Math.min(controls.maxPolarAngle, sp.phi + dPol)); off.setFromSpherical(sp);
  camera.position.copy(controls.target).add(off); controls.update(); need();
}
document.getElementById('nav').onclick = (e) => {
  const n = e.target.closest('button')?.dataset.n; if (!n) return;
  if (n === 'l') orbit(Math.PI / 8, 0); if (n === 'r') orbit(-Math.PI / 8, 0);
  if (n === 'u') orbit(0, -0.18); if (n === 'd') orbit(0, 0.18);
  if (n === 'h') { camera.position.copy(HOME.c); controls.target.copy(HOME.t); controls.update(); need(); }
};

// ── 그리기 ───────────────────────────────────────────
let dirty = true;
function need() { dirty = true; }
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); syncCardHeight(); need();
}
addEventListener('resize', resize);
resize();

const bench = BENCH ? { t0: 0, frames: [] } : null;
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  if (bench) {
    if (!bench.t0) bench.t0 = now;
    orbit(0.006, 0); bench.frames.push(now - last);
    if (now - bench.t0 > 6000 && !window.__bench) {
      const f = bench.frames.slice(10).sort((a, b) => a - b);
      window.__bench = { frames: f.length, fps: +(1000 / (f.reduce((a, b) => a + b, 0) / f.length)).toFixed(1),
        p95ms: +f[Math.floor(f.length * 0.95)].toFixed(1), worstms: +f[f.length - 1].toFixed(1) };
    }
  }
  last = now;
  if (controls.update()) dirty = true;
  if (!dirty) return;
  dirty = false;
  renderer.render(scene, camera);
  placeLabels();
}
renderer.shadowMap.needsUpdate = true;
requestAnimationFrame(frame);
requestAnimationFrame(() => requestAnimationFrame(() => {
  document.getElementById('loading').classList.add('done');
  window.__ready = true;
}));

// 점검용(자동 시험이 읽음)
window.__map = { select, buildings: B, camera, controls, HOME, labels, need, orbit, get selected() { return selIdx; } };
})();
