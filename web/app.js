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
  // 땅은 아주 밝게, 도로는 중간 회색: 길 그물이 또렷해야 블록이 읽힌다
  ground: '#eef0f2', water: '#8fb9e2', green: '#cde4b8', wood: '#b6d4a0', pitch: '#c8e2b2',
  road: '#b9bfc8', roadMinor: '#ccd1d8', ped: '#e3e6ea', bridge: '#c2c8d0',
  // 대구처럼 옅은 회색 건물(순백이면 지붕·벽이 날아가 윤곽이 흐림). 건물마다 아주 조금씩 다르게
  // 아주 옅게 따뜻한 회색·차가운 회색을 섞어 단조롭지 않게
  walls: ['#f3f2ef', '#eceff3', '#f4f3f1', '#e9edf1', '#f1efeb', '#edf0f3'],
  roof: '#d0d4da', roofApt: '#c8cdd4',
  est: '#f1dcc8',          // 층수 추정 건물 강조(은은하게)
  select: '#fcc419',
};

// ── 렌더러·장면 ─────────────────────────────────────────
const canvas = document.getElementById('c');
const SMALL = Math.min(innerWidth, innerHeight) < 720;
// 요약 카드(기록지)는 3D 와 상관없으니 렌더러보다 먼저 채운다 — 3D 를 못 그려도 숫자·접기 단추는 된다(seohogyun-20 제안)
fillCard();
const card = document.getElementById('card');
function syncCardHeight() { document.documentElement.style.setProperty('--card-h', card.offsetHeight + 'px'); }
window.__syncCard = syncCardHeight;
document.getElementById('card-toggle').onclick = (e) => {
  const c = card.classList.toggle('collapsed');
  e.currentTarget.setAttribute('aria-expanded', String(!c)); e.currentTarget.title = c ? '펴기' : '접기';
  syncCardHeight();
};
if (SMALL) { card.classList.add('collapsed'); document.getElementById('card-toggle').setAttribute('aria-expanded', 'false'); }
// 렌더러: WebGL 이 꺼져 있거나 막혀 있으면 여기서 예외가 난다. 그때는 3D 를 만들지 않고 멈추되, 까닭을 남겨
// shell.js 가 20초를 기다리지 않고 바로 안내를 띄우게 한다(window.__glFail, document 'map-fail' 이벤트)
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); }
catch (e) { window.__glFail = String((e && e.message) || e); document.dispatchEvent(new CustomEvent('map-fail', { detail: { reason: window.__glFail } })); return; }
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
// 위 가운데 도움말: 처음 끌거나 누르면 사라진다(지명을 가리지 않게)
canvas.addEventListener('pointerdown', () => { const h = document.getElementById('hint'); if (h) h.classList.add('gone'); }, { once: true });

// ── 빛 ───────────────────────────────────────────────
// 빛: 위를 향한 면(지붕·땅)이 정한 색 그대로 나오도록(합이 약 1). 너무 세면 지붕·땅이 하얗게 잘린다
// 하늘빛을 높이고 햇빛을 줄여 등진 벽도 밝은 회색, 해를 받는 벽은 더 밝게(면마다 차이). 해는 살짝 따뜻하게, 땅 반사는 살짝 푸르게
const hemi = new THREE.HemisphereLight('#ffffff', '#a3adba', 0.64); scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff3e3', 0.56);
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
const ground = new THREE.Mesh(new THREE.PlaneGeometry(R * 9.6, R * 9.6), new THREE.MeshLambertMaterial({ color: C.ground, depthWrite: false }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; ground.renderOrder = 0; scene.add(ground);
// 녹지 바닥 3가지(숲·공원·운동장). 바닥층(ground.js)이 색을 맞추도록 __map.greens 로 내보냄
const greenMeshes = { wood: flatMesh(D.greens.filter(g => g.k === 'wood' || g.k === 'forest' || g.k === 'scrub').map(g => g.p), 0, C.wood, 1),
  green: flatMesh(D.greens.filter(g => !['wood', 'forest', 'scrub', 'pitch'].includes(g.k)).map(g => g.p), 0, C.green, 2),
  pitch: flatMesh(D.greens.filter(g => g.k === 'pitch').map(g => g.p), 0, C.pitch, 3) };
const waterMesh = flatMesh(D.water.map(w => w.p), 0, C.water, 4);
waterMesh.receiveShadow = false;
const MAJOR = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link']);
// 도로 3겹(보행로·골목·큰길). 다른 파일(바닥층 ground.js)이 길을 새로 그리면 __map.roads 를 숨긴다
const roadMeshes = [ribbonMesh(D.roads.filter(r => r.ped), 0, C.ped, 5),
  ribbonMesh(D.roads.filter(r => !r.ped && !MAJOR.has(r.k)), 0, C.roadMinor, 6),
  ribbonMesh(D.roads.filter(r => MAJOR.has(r.k)), 0, C.road, 7)];
// 지도 가장자리 흐리기: 자료가 끝나는 곳에서 0, 안쪽 160m 부터 1(바닥층 ground.js 도 같은 함수를 씀)
const EDGE_IN = 160, HALF = D.meta.half || [R, R];
function edgeFade(x, z) { const d = Math.min(HALF[0] - Math.abs(x), HALF[1] - Math.abs(z)), k = Math.max(0, Math.min(1, d / EDGE_IN)); return k * k * (3 - 2 * k); }
// 위경도 → 지도 좌표(m). tools/map_build.py xz() 와 같은 식
const xz = (lat, lon) => [(lon - D.meta.lon0) * D.meta.kx, -(lat - D.meta.lat0) * D.meta.kz];
// R-ONE 상권 경계: 지도에서 흔한 경계 표시처럼 진한 회색 점선(주황은 '가게 없는 층' 색이라 쓰지 않음).
// 가까이 볼수록 가늘게(정류장·노면 표시를 덮지 않게), 바닥 표시(8.9)보다 먼저 그려 노면 표시가 위에 오게
let bndMesh = null, bndK = 0;
function drawBoundary(k) {
  if (!D.boundary) return;
  if (bndMesh) { scene.remove(bndMesh); bndMesh.geometry.dispose(); }
  const ring = D.boundary.concat([D.boundary[0]]), pos = [], DASH = 9, GAP = 6, w = 2.4 * k;
  let carry = 0, on = true;
  for (let i = 0; i < ring.length - 1; i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[i + 1], L = Math.hypot(bx - ax, bz - az); if (L < 0.01) continue;
    let d = 0;
    while (d < L) {
      const left = (on ? DASH : GAP) - carry, e = Math.min(L, d + left);
      if (on) ribbon([[ax + (bx - ax) * d / L, az + (bz - az) * d / L], [ax + (bx - ax) * e / L, az + (bz - az) * e / L]], w, 0.04, pos);
      carry += e - d; d = e;
      if (carry >= (on ? DASH : GAP) - 1e-6) { carry = 0; on = !on; }
    }
  }
  if (TON) for (let i = 0; i < pos.length; i += 3) pos[i + 1] += Math.max(0, hAt(pos[i], pos[i + 2])) + GL;   // 바다 위(해안 옆 음수 높이)는 물 높이 0
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  bndMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: '#3d434a', depthWrite: false, side: THREE.DoubleSide, transparent: true, opacity: k < 0.3 ? 0.5 : 0.75 }));
  bndMesh.renderOrder = 8.8; bndMesh.frustumCulled = false; scene.add(bndMesh); need && need();
}
// 아주 가까이(150m 안)서는 더 가늘게(0.4m) — 0.84m 폭 9m 조각이 길 위에 누운 통나무처럼 보였음
function boundaryK() { const d = camera.position.distanceTo(controls.target); return d < 150 ? 0.17 : d < 250 ? 0.35 : d < 550 ? 0.7 : 1.5; }

// ── 건물 ───────────────────────────────────────────────
// 모든 건물을 한 덩어리로 합친다. triOwner[삼각형 번호] = 건물 번호 → 누른 건물 찾기.
const B = D.buildings;
// 지형(seohogyun-31 terrain.js, 기본 꺼짐·?terrain=1): 건물 바닥을 발자국 아래 가장 낮은 땅 높이로 올린다(b.b0 = 원래 값).
// b.b 를 쓰는 층 띠·층 단면·거리 층 띠·간판은 따로 고치지 않아도 따라온다. 땅에 붙는 선·이름표·사람은 hAt 을 더한다
const TON = !!window.TERRAIN_ON, hAt = TON && window.heightAt ? window.heightAt : () => 0;
// 지형을 켜면 바닥층(ground.js)이 땅 위 0.2m 에 깔리므로(LIFT, #111) 땅에 얹는 띠·그늘·고리는 그보다 위로(GL 만큼 더 띄움)
const GL = TON ? 0.25 : 0;
for (const b of B) { b.b0 = b.b || 0; if (TON && window.heightRange) b.b = b.b0 + window.heightRange(b.p).min; }
const bPos = [], bNrm = [], bCol = [], bUv = [], triOwner = [];
const ROOF_UV = [0.95, 0.15];   // 무늬의 흰 칸(지붕은 무늬 없이)
// 창 무늬는 창 8칸 × 층 8칸 묶음 한 장(repeat 1/8). 낮 무늬와 밤 불빛 무늬가 같은 칸 배치를 써야 창 위치가 맞는다
const WN = 8, WS = 96;   // 칸 하나 96px(가까이 볼 때 흐릿하지 않게)
function cellTexture(draw) {
  const cv = document.createElement('canvas'); cv.width = cv.height = WN * WS;
  const g = cv.getContext('2d');
  for (let i = 0; i < WN; i++) for (let j = 0; j < WN; j++) { g.save(); g.translate(i * WS, j * WS); draw(g, WS, i, j); g.restore(); }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.encoding = THREE.sRGBEncoding; t.repeat.set(1 / WN, 1 / WN);
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  return t;
}
function floorTexture() {
  return cellTexture((g, S) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
    // 창: 유리처럼 위는 조금 진하고 아래로 밝게(하늘 반사), 위 틀은 진하게
    const gr = g.createLinearGradient(0, S * 0.22, 0, S * 0.68); gr.addColorStop(0, '#c6d1dd'); gr.addColorStop(1, '#dfe6ee');
    g.fillStyle = gr; g.fillRect(6, S * 0.22, S * 0.68, S * 0.46);   // 창(윗부분이 v 큰 쪽 → 캔버스 위쪽)
    g.fillStyle = '#b4bfcb'; g.fillRect(6, S * 0.22, S * 0.68, 2);
    g.fillStyle = '#f2f3f5'; g.fillRect(0, S - 4, S, 4);                     // 층 사이 슬래브(v=0 쪽)
  });
}
// 건물 종류별 창 무늬(같은 칸 배치): 1 = 상가·사무·숙박·공공(큰 유리창), 2 = 아파트(넓은 창 + 발코니 난간), 3 = 상가 1층 가게 앞면(통유리)
function glass(g, x, y, w, h, c0, c1) { const gr = g.createLinearGradient(0, y, 0, y + h); gr.addColorStop(0, c0); gr.addColorStop(1, c1); g.fillStyle = gr; g.fillRect(x, y, w, h); }
const winTexB = cellTexture((g, S) => {   // 큰 유리창(가운데 창살)
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
  glass(g, 4, S * 0.16, S - 8, S * 0.62, '#9fb1c4', '#d3dde8');
  g.fillStyle = '#8d99a6'; g.fillRect(4, S * 0.16, S - 8, 2); g.fillRect(S / 2 - 1, S * 0.16, 2, S * 0.62);
  g.fillStyle = '#eef0f3'; g.fillRect(0, S - 5, S, 5);
});
const winTexC = cellTexture((g, S) => {   // 아파트: 넓은 창 + 발코니 난간
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, S, S);
  glass(g, 6, S * 0.22, S - 12, S * 0.5, '#b9c6d4', '#e0e7ef');
  g.fillStyle = '#c9cfd6'; g.fillRect(2, S * 0.56, S - 4, S * 0.16);   // 난간
  g.fillStyle = '#aeb6bf'; g.fillRect(2, S * 0.56, S - 4, 2);
  g.fillStyle = '#f2f3f5'; g.fillRect(0, S - 4, S, 4);
});
const shopTex = cellTexture((g, S) => {   // 1층 가게 앞면: 통유리 + 위 차양 띠
  g.fillStyle = '#e9e7e3'; g.fillRect(0, 0, S, S);
  glass(g, 3, S * 0.2, S - 6, S * 0.66, '#5f7184', '#93a4b5');
  g.fillStyle = '#4a525b'; g.fillRect(0, S * 0.08, S, S * 0.12);   // 차양·간판 받침
  g.fillStyle = '#7d8790'; g.fillRect(S / 2 - 1, S * 0.2, 2, S * 0.66);
});
// 밤에 불 켜진 창: 칸마다 정해진 확률로 따뜻한 전등색(나머지는 검정 = 빛 없음). 무늬 칸이 아닌 벽·지붕은 검정
function litTexture(p = 0.46, rect = [7 / 64, 0.24, 0.66, 0.42], cols = ['#ffd38a', '#ffe2b0', '#fff2d8', '#ffc66e', '#e9f0ff']) {
  return cellTexture((g, S, i, j) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
    const h = ((i * 73856093) ^ (j * 19349663)) >>> 0, u = (h % 1000) / 1000;
    if (u < p) { g.fillStyle = cols[h % cols.length]; g.fillRect(rect[0] * S, rect[1] * S, rect[2] * S, rect[3] * S); }
  });
}
const tmpC = new THREE.Color();
const wallCols = C.walls.map(h => new THREE.Color(h));
const roofCol = new THREE.Color(C.roof), roofApt = new THREE.Color(C.roofApt);
// 지붕은 땅(#eef0f2)보다 한 톤 진하게 — 같으면 위에서 볼 때 건물 윤곽이 땅에 묻힌다
const roofCols = ['#c9ced5', '#d1cdc6', '#c6ccd3', '#cfcbc5', '#cbd0d6', '#d3d0ca'].map(h => new THREE.Color(h));
// 용도별 재질(채도 낮게): 다가구·단독 = 붉은 벽돌톤, 상가(근린생활) = 베이지·회색 타일, 아파트 = 흰색, 숙박 = 크림, 공공·사무 = 차가운 회색
const pal = (a) => a.map(h => new THREE.Color(h));
const WALL_BY = {
  house: pal(['#cfa792', '#c79c87', '#d6b4a0', '#bf9481', '#d2b9a6', '#c8a38f', '#d9c2ae']),
  apartments: pal(['#f3f1ec', '#eef0f3', '#f1eee8']),
  // 상가 건물: 옅은 타일·석재 + 일부는 진한 화강석·갈색 타일(옥포 상가 거리처럼 건물마다 다르게)
  retail: pal(['#ece8e1', '#e3e6ea', '#eee6da', '#dde2e8', '#e8e1d5', '#e6e8eb', '#e4dccf', '#d8cfc3', '#cfd4da', '#e2d6c4', '#c9c3bb', '#d6ccbe']),
  hotel: pal(['#efe4dd', '#ebe4ee', '#f1e8dc', '#e9e6f0']),
  office: pal(['#e1e6ec', '#dce3ea', '#e6e9ee']), public: pal(['#e1e6ec', '#dce3ea', '#e6e9ee']),
  school: pal(['#efe6da', '#e8e1d6']), hospital: pal(['#eef0f3', '#e6ecf1']),
  industrial: pal(['#d9dde2', '#cfd6dc']), warehouse: pal(['#d9dde2', '#cfd6dc']), garage: pal(['#d9dde2']),
};
// 다가구 옥상은 초록 방수 페인트가 흔하다(일부는 회색)
const ROOF_HOUSE = pal(['#8db59f', '#97bca9', '#86ae98', '#c9cdd2', '#9fc1ae', '#c3c8cd']);
function wallOf(b) { const L = WALL_BY[b.k]; return L ? L[b.c % L.length] : wallCols[b.c % wallCols.length]; }
function roofOf(b) { if (b.k === 'house') return ROOF_HOUSE[(b.c * 7 + b.lv) % ROOF_HOUSE.length]; return b.k === 'apartments' ? roofApt : roofCols[b.c % roofCols.length]; }
const bRange = [];   // 건물별 [시작 꼭짓점, 끝 꼭짓점]
const bWst = [], bOffV = [];   // 건물별 창 종류(0 주택 기본, 1 큰 유리창, 2 아파트) + 1층 가게면 4 더함, 무늬 시작 층(offV)
const STYLE_OF = { apartments: 2, retail: 1, hotel: 1, office: 1, public: 1, school: 1, hospital: 1 };
const FL = window.FLOORS && window.FLOORS.b;
const roofRange = [];   // 건물별 지붕 꼭짓점 [시작, 끝] — 지붕만 다른 색으로 칠할 때(빈 층 많은 건물 등)
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
  const wc = wallOf(b), wcTop = wc.clone().multiplyScalar(1.07);   // 맨 위 0.45m 는 한 톤 밝게(옥상 난간처럼)
  // 벽: 아래 3m 는 바닥 그늘(땅에 붙어 보이게), 그 위는 고른 색
  const wallBot = tmpC.copy(wc).multiplyScalar(0.78).clone();
  const fh = b.k === 'roof' ? 99 : (b.h - 0.6) / b.lv;   // 층고(지붕만 있는 구조물은 무늬 없음)
  const v1 = b.k === 'roof' ? 0.15 : (y1 - y0 - 0.6) / fh + 0.0;
  let run = 0;
  const offU = (b.c * 3 + bi * 7) % WN, offV = (bi * 5 + b.c) % WN;
  { const fl = FL && FL[String(bi)], f1 = fl && fl.find(f => f.n === 1), com = fl && fl.some(f => f.com);
    let st = STYLE_OF[b.k] ?? (com ? 1 : 0); if (f1 && f1.com) st += 4; bWst.push(st); bOffV.push(offV); }
  for (let i = 0; i < p.length; i++) {
    const a = p[i], c2 = p[(i + 1) % p.length];
    const dx = c2[0] - a[0], dz = c2[1] - a[1], l = Math.hypot(dx, dz);
    if (l < 0.05) continue;
    const n = [-dz / l, 0, dx / l];
    const A = [a[0], y0, a[1]], Bv = [c2[0], y0, c2[1]], Cv = [c2[0], y1, c2[1]], Dv = [a[0], y1, a[1]];
    const u0 = run / 3.6 + offU, u1 = (run + l) / 3.6 + offU; run += l;     // 창 간격 3.6m(건물마다 시작 칸을 옮김)
    const vTop = v1 + 0.6 / fh;                               // 벽 위 0.6m(난간)는 v 가 층 수를 넘어 흰 칸
    const yAO = Math.min(y1, y0 + 3), vAO = (yAO - y0) / fh;
    const E2 = [c2[0], yAO, c2[1]], F2 = [a[0], yAO, a[1]];
    bPos.push(...A, ...Bv, ...E2, ...A, ...E2, ...F2);         // 아래 띠(그늘)
    bUv.push(u0, offV, u1, offV, u1, vAO + offV, u0, offV, u1, vAO + offV, u0, vAO + offV);
    for (let k = 0; k < 6; k++) bNrm.push(...n);
    for (const cc of [wallBot, wallBot, wc, wallBot, wc, wc]) bCol.push(cc.r, cc.g, cc.b);
    triOwner.push(bi, bi);
    if (y1 > yAO + 0.01) {
      const yCap = b.h > 4 ? Math.max(yAO, y1 - 0.45) : y1, vCap = (yCap - y0) / fh;
      const G2 = [c2[0], yCap, c2[1]], H2 = [a[0], yCap, a[1]];
      bPos.push(...F2, ...E2, ...G2, ...F2, ...G2, ...H2);
      bUv.push(u0, vAO + offV, u1, vAO + offV, u1, vCap + offV, u0, vAO + offV, u1, vCap + offV, u0, vCap + offV);
      for (let k = 0; k < 6; k++) { bNrm.push(...n); bCol.push(wc.r, wc.g, wc.b); }
      triOwner.push(bi, bi);
      if (yCap < y1 - 0.01) {   // 난간 띠
        bPos.push(...H2, ...G2, ...Cv, ...H2, ...Cv, ...Dv);
        for (let k = 0; k < 6; k++) { bNrm.push(...n); bCol.push(wcTop.r, wcTop.g, wcTop.b); bUv.push(ROOF_UV[0], ROOF_UV[1]); }
        triOwner.push(bi, bi);
      }
    }
  }
  // 지붕
  const v2 = p.map(q => new THREE.Vector2(q[0], q[1]));
  const rc = roofOf(b), roofStart = bPos.length / 3;
  for (const t of THREE.ShapeUtils.triangulateShape(v2, [])) {
    const a = p[t[0]], c1 = p[t[1]], c2 = p[t[2]];
    const ny = (c1[1] - a[1]) * (c2[0] - a[0]) - (c1[0] - a[0]) * (c2[1] - a[1]);
    const A = [a[0], y1, a[1]], B1 = [c1[0], y1, c1[1]], B2 = [c2[0], y1, c2[1]];
    if (ny >= 0) pushTri(A, B1, B2, [0, 1, 0], rc, bi); else pushTri(A, B2, B1, [0, 1, 0], rc, bi);
  }
  roofRange.push([roofStart, bPos.length / 3]);
  bRange.push([start, bPos.length / 3]);
});
// 건물 윤곽선: 지붕 테두리 + 꺾이는 모서리(25° 넘게 꺾이는 곳)의 세로선. 흰 벽끼리 붙어 있어도 건물이 하나하나 읽히게
const edgePos = [];
B.forEach((b) => {
  const p = b.p, n = p.length, y0 = b.b || 0, y1 = y0 + b.h;
  for (let i = 0; i < n; i++) {
    const a = p[i], c = p[(i + 1) % n], z = p[(i + n - 1) % n];
    edgePos.push(a[0], y1 + 0.03, a[1], c[0], y1 + 0.03, c[1]);
    const ux = a[0] - z[0], uz = a[1] - z[1], vx = c[0] - a[0], vz = c[1] - a[1], lu = Math.hypot(ux, uz), lv = Math.hypot(vx, vz);
    if (lu > 0.5 && lv > 0.5 && (ux * vx + uz * vz) / (lu * lv) < 0.906) edgePos.push(a[0], y0, a[1], a[0], y1, a[1]);
  }
});
const edgeGeo = new THREE.BufferGeometry(); edgeGeo.setAttribute('position', new THREE.Float32BufferAttribute(edgePos, 3));
{ const lc = new THREE.Color('#6b7480'), bg = new THREE.Color('#f1efea'), ec = new Float32Array(edgePos.length);
  for (let i = 0; i < edgePos.length; i += 3) { const f = edgeFade(edgePos[i], edgePos[i + 2]); ec[i] = bg.r + (lc.r - bg.r) * f; ec[i + 1] = bg.g + (lc.g - bg.g) * f; ec[i + 2] = bg.b + (lc.b - bg.b) * f; }
  edgeGeo.setAttribute('color', new THREE.Float32BufferAttribute(ec, 3)); }
const edgeMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.32 });
const edgeLines = new THREE.LineSegments(edgeGeo, edgeMat); edgeLines.renderOrder = 8; edgeLines.frustumCulled = false; scene.add(edgeLines);
const bGeo = new THREE.BufferGeometry();
bGeo.setAttribute('position', new THREE.Float32BufferAttribute(bPos, 3));
bGeo.setAttribute('normal', new THREE.Float32BufferAttribute(bNrm, 3));
bGeo.setAttribute('uv', new THREE.Float32BufferAttribute(bUv, 2));
const colAttr = new THREE.Float32BufferAttribute(bCol, 3);
bGeo.setAttribute('color', colAttr);
// 가장자리 건물은 땅색 쪽으로 섞어 칼로 자른 듯 끝나지 않게(바닥 흐리기와 같은 함수)
{ const fadeTo = new THREE.Color('#f1efea');
  B.forEach((b, bi) => { let cx = 0, cz = 0; for (const p of b.p) { cx += p[0]; cz += p[1]; } const f = edgeFade(cx / b.p.length, cz / b.p.length);
    if (f >= 0.999) return; const k = (1 - f) * 0.9, [s0, e0] = bRange[bi];
    for (let v = s0; v < e0; v++) { bCol[v * 3] = bCol[v * 3] * (1 - k) + fadeTo.r * k; bCol[v * 3 + 1] = bCol[v * 3 + 1] * (1 - k) + fadeTo.g * k; bCol[v * 3 + 2] = bCol[v * 3 + 2] * (1 - k) + fadeTo.b * k; } });
  colAttr.array.set(bCol); }
const baseCol = Float32Array.from(bCol);
// 밤에도 '가게 없는 층' 주황 지붕이 보이게: 칠한 지붕 꼭짓점만 glow=1 → 밤 정도만큼 스스로 빛남(셰이더에 한 줄 추가)
const glowAttr = new THREE.Float32BufferAttribute(new Float32Array(bCol.length / 3), 1);
bGeo.setAttribute('glow', glowAttr);
{ const nV = bCol.length / 3, wst = new Float32Array(nV), bid = new Float32Array(nV), woff = new Float32Array(nV);
  bRange.forEach(([s0, e0], bi) => { for (let v = s0; v < e0; v++) { wst[v] = bWst[bi]; bid[v] = bi; woff[v] = bOffV[bi]; } });
  bGeo.setAttribute('wst', new THREE.BufferAttribute(wst, 1)); bGeo.setAttribute('bid', new THREE.BufferAttribute(bid, 1)); bGeo.setAttribute('woff', new THREE.BufferAttribute(woff, 1)); }
// 밤에 '가게 없는 층'은 창 불이 꺼지게: 건물마다 빈 층 비트(1층 = 1)를 1줄 데이터 텍스처로(셰이더가 건물 번호로 읽음)
const emptyTex = (() => { const W = 4096, d = new Float32Array(W);
  if (FL) for (const k in FL) { const bi = +k; if (bi >= W) continue; let m = 0; for (const f of FL[k]) if (f.state === 'empty' && f.n >= 1 && f.n <= 24) m |= 1 << (f.n - 1); d[bi] = m; }
  const t = new THREE.DataTexture(d, W, 1, THREE.RedFormat, THREE.FloatType); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t; })();
bGeo.computeBoundingSphere();
// 창 무늬는 가까이 볼 때만(멀리서는 작은 건물이 빽빽해 무늬가 잡음처럼 보인다 → 깨끗한 덩어리로)
const winTex = floorTexture();
const litTex = litTexture();
const litB = litTexture(0.32, [4 / 64, 0.18, 0.88, 0.58], ['#eef4ff', '#fff6e6', '#e3ecff']);   // 사무·상가: 하얀 형광등, 덜 켜짐
const litC = litTexture(0.58, [6 / 64, 0.24, 0.8, 0.32]);                                  // 아파트: 따뜻한 전등, 많이 켜짐
const litShop = litTexture(0.85, [3 / 64, 0.22, 0.9, 0.62], ['#fff4d6', '#ffe9b8', '#ffffff']);   // 1층 가게: 대부분 켜짐
const bMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: null, emissive: '#ffffff', emissiveMap: litTex, emissiveIntensity: 0 });
const uRoofGlow = { value: 0 }, uOfficeK = { value: 1 }, uShopK = { value: 1 };   // 시각별: 사무실 불(저녁 7~8시에 대부분 꺼짐), 1층 가게 불(밤 10시 넘어 닫음)
const GL2 = renderer.capabilities.isWebGL2;
// 건물 셰이더에 더하는 것: 밤 주황 지붕 빛남(glow), 건물 종류별 창 무늬·1층 가게 앞면(wst), 밤에 빈 층 불 끄기(bid·woff → emptyTex)
bMat.onBeforeCompile = (sh) => {
  Object.assign(sh.uniforms, { uRoofGlow, uOfficeK, uShopK, uWinB: { value: winTexB }, uWinC: { value: winTexC }, uShop: { value: shopTex },
    uLitB: { value: litB }, uLitC: { value: litC }, uLitShop: { value: litShop }, uEmpty: { value: emptyTex } });
  sh.vertexShader = 'attribute float glow, wst, bid, woff;\nvarying float vGlow, vWst, vBid, vWoff;\nvarying vec2 vRaw;\n' +
    sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vGlow = glow; vWst = wst; vBid = bid; vWoff = woff; vRaw = uv;');
  const pick = (a, b, c, d) => `(isShop ? ${d} : (st < 0.5 ? ${a} : (st < 1.5 ? ${b} : ${c})))`;
  const head = 'uniform float uRoofGlow, uOfficeK, uShopK;\nuniform sampler2D uWinB, uWinC, uShop, uLitB, uLitC, uLitShop, uEmpty;\nvarying float vGlow, vWst, vBid, vWoff;\nvarying vec2 vRaw;\n';
  const pre = `float st = mod(vWst, 4.0); float flf = floor(vRaw.y - vWoff); bool isShop = vWst > 3.5 && flf < 0.5 && flf > -0.5;`;
  sh.fragmentShader = head + sh.fragmentShader
    .replace('#include <map_fragment>', `${pre}
#ifdef USE_MAP
  vec4 sampledDiffuseColor = ${pick('texture2D(map, vUv)', 'texture2D(uWinB, vUv)', 'texture2D(uWinC, vUv)', 'texture2D(uShop, vUv)')};
  diffuseColor *= sampledDiffuseColor;
#endif`)
    .replace('#include <emissivemap_fragment>', `#ifdef USE_EMISSIVEMAP
  vec4 emissiveColor = ${pick('texture2D(emissiveMap, vUv)', 'texture2D(uLitB, vUv)', 'texture2D(uLitC, vUv)', 'texture2D(uLitShop, vUv)')};
  ${GL2 ? `int fi = int(flf); int msk = int(texelFetch(uEmpty, ivec2(int(vBid + 0.5), 0), 0).r + 0.5);
  if (fi >= 0 && fi < 24 && ((msk >> fi) & 1) == 1) emissiveColor.rgb *= 0.0;` : ''}
  emissiveColor.rgb *= isShop ? uShopK : (st > 0.5 && st < 1.5 ? uOfficeK : 1.0);
  totalEmissiveRadiance *= emissiveColor.rgb;
#endif
  totalEmissiveRadiance += vColor.rgb * vGlow * uRoofGlow;`);
};
const WIN_NEAR = 330;
function syncWindows() {
  const want = camera.position.distanceTo(controls.target) < WIN_NEAR ? winTex : null;
  if (bMat.map !== want) { bMat.map = want; bMat.needsUpdate = true; }
}
const bMesh = new THREE.Mesh(bGeo, bMat);
bMesh.castShadow = true; bMesh.receiveShadow = true; bMesh.renderOrder = 10;
scene.add(bMesh);
// 접지 그늘: 건물 밑동 둘레에 바깥으로 옅어지는 어두운 띠(골목이 깊어 보이고 건물이 땅에 붙어 보이게)
{
  const pos = [], col = [], W0 = 0.3, OUT = 3.6;
  for (const b of B) {
    if (b.k === 'roof' || (b.b0 || 0) > 0) continue;   // 원래 공중에 뜬 구조물만 뺌(지형으로 올린 건물은 그늘 그림)
    let p = b.p.slice(); if (signedArea(p) > 0) p.reverse();
    for (let i = 0; i < p.length; i++) {
      const a = p[i], c = p[(i + 1) % p.length], dx = c[0] - a[0], dz = c[1] - a[1], l = Math.hypot(dx, dz); if (l < 0.3) continue;
      const nx = -dz / l * OUT, nz = dx / l * OUT, y = 0.04 + GL;   // 지형 켜면 조금 더 띄움(지형 메시 삼각형과 계산 높이가 몇 cm 달라 얼룩지지 않게)
      // 안쪽(벽 밑) 알파 W0 → 바깥 0. 지형이 켜져 있으면 8m 이하 조각마다 땅 높이
      const ns = TON ? Math.max(1, Math.ceil(l / 8)) : 1;
      for (let k = 0; k < ns; k++) {
        const p0 = [a[0] + dx * k / ns, a[1] + dz * k / ns], p1 = [a[0] + dx * (k + 1) / ns, a[1] + dz * (k + 1) / ns];
        const ya = y + hAt(p0[0], p0[1]), yc = y + hAt(p1[0], p1[1]), yc2 = y + hAt(p1[0] + nx, p1[1] + nz), ya2 = y + hAt(p0[0] + nx, p0[1] + nz);
        pos.push(p0[0], ya, p0[1], p1[0], yc, p1[1], p1[0] + nx, yc2, p1[1] + nz, p0[0], ya, p0[1], p1[0] + nx, yc2, p1[1] + nz, p0[0] + nx, ya2, p0[1] + nz);
        for (const al of [W0, W0, 0, W0, 0, 0]) col.push(0.12, 0.14, 0.18, al);
      }
    }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  const ao = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  ao.renderOrder = 9.4; scene.add(ao);
}
// 지붕 윤곽선(위에서 볼 때 건물 경계가 또렷하게)
{
  const lp = [];
  for (const b of B) {
    const y = (b.b || 0) + b.h + 0.05;
    for (let i = 0; i < b.p.length; i++) { const a = b.p[i], c = b.p[(i + 1) % b.p.length]; lp.push(a[0], y, a[1], c[0], y, c[1]); }
  }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: '#9aa2ac', transparent: true, opacity: 0.55 }));
  lines.renderOrder = 11; scene.add(lines);
}

// 거리 집중: keep(건물 번호 Set) 밖 건물은 땅 색 쪽으로 흐리게. null 이면 원래대로
let keepSet = null, estOn = false, tintK = 0.45, roofOver = null;
function tint(keep, k = 0.45) { keepSet = keep; tintK = k; edgeMat.opacity = keep ? 0.16 : 0.32; paintEstimated(estOn); }   // 거리 보기에선 윤곽선도 흐리게
// 지붕 색 덮어쓰기: Map(건물 번호 → [r,g,b] 와 섞는 비율 k). null 이면 원래 지붕. 거리 밖 흐리게보다 먼저 칠한다
function setRoofs(map) { roofOver = map; paintEstimated(estOn); }
// 층수 추정 건물 강조 켜고 끄기
function paintEstimated(on) {
  estOn = on;
  const arr = colAttr.array, est = new THREE.Color(C.est);
  arr.set(baseCol);
  const ga = glowAttr.array; ga.fill(0);
  if (roofOver) for (const [bi, o] of roofOver) { const [s0, e0] = roofRange[bi];
    for (let v = s0; v < e0; v++) { ga[v] = 1; for (let k = 0; k < 3; k++) arr[v * 3 + k] = arr[v * 3 + k] * (1 - o.k) + o.c[k] * o.k; } }
  glowAttr.needsUpdate = true;
  if (keepSet) {
    const g = [0.9, 0.91, 0.925];   // 거리 밖 건물: 옅은 회색 쪽으로 조금만(하얗게 날리지 않게)
    B.forEach((b, bi) => { if (keepSet.has(bi)) return; const [s0, e0] = bRange[bi];
      for (let v = s0; v < e0; v++) for (let k = 0; k < 3; k++) arr[v * 3 + k] = arr[v * 3 + k] * (1 - tintK) + g[k] * tintK; });
  }
  if (on) B.forEach((b, bi) => { if (!b.real) { const [s, e] = bRange[bi]; for (let v = s; v < e; v++) { arr[v * 3] = est.r; arr[v * 3 + 1] = est.g; arr[v * 3 + 2] = est.b; } } });
  colAttr.needsUpdate = true; need();
}

// 층 단면을 볼 때 그 건물 벽을 잠시 치운다(꼭짓점을 땅 밑으로). -1 이면 되돌림
let hiddenB = -1, hiddenPos = null;
function hideBuilding(bi) {
  const pa = bGeo.attributes.position;
  if (hiddenB >= 0) { const [s0] = bRange[hiddenB]; pa.array.set(hiddenPos, s0 * 3); hiddenB = -1; hiddenPos = null; pa.needsUpdate = true; }
  if (bi >= 0) { const [s0, e0] = bRange[bi]; hiddenPos = pa.array.slice(s0 * 3, e0 * 3); for (let v = s0; v < e0; v++) pa.array[v * 3 + 1] = -500; hiddenB = bi; pa.needsUpdate = true; }
  need();
}
// 고른 건물: 같은 모양을 강조색으로 덧그림
let selMesh = null, selIdx = -1;
function select(bi) {
  if (selMesh) { scene.remove(selMesh); selMesh.geometry.dispose(); selMesh.children.forEach(c => c.geometry.dispose()); selMesh = null; }
  selIdx = bi;
  if (bi < 0) { info.hidden = true; hideBuilding(-1); document.dispatchEvent(new CustomEvent('building-select', { detail: { bi: -1 } })); need(); return; }
  const [s, e] = bRange[bi];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(bPos.slice(s * 3, e * 3), 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(bNrm.slice(s * 3, e * 3), 3));
  // 고른 건물: 노랑 반투명 + 진한 윤곽(주황 '가게 없는 층'과 헷갈리지 않게)
  selMesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: C.select, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  selMesh.renderOrder = 13;
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), new THREE.LineBasicMaterial({ color: '#212529' }));
  edges.renderOrder = 14; selMesh.add(edges);
  scene.add(selMesh);
  showInfo(B[bi]); need();
  document.dispatchEvent(new CustomEvent('building-select', { detail: { bi } }));   // 층 단면(floors.js) 등이 따라 그리게
  if (typeof setHover === 'function') setHover(-1);   // 누른 뒤엔 말풍선을 닫는다(벽이 치워져 뒤 건물 말풍선이 뜨지 않게)
  requestAnimationFrame(() => keepVisible(bi));   // 정보창이 열린 뒤 그 폭을 재서
}
// 고른 건물이 정보창(오른쪽 패널·폰 아래 시트)에 가려지거나 화면 밖이면, 보이는 영역 가운데로 부드럽게 옮긴다
const _kp = new THREE.Vector3(), _kr = new THREE.Vector3(), _ku = new THREE.Vector3();
function keepVisible(bi) {
  const b = B[bi]; if (!b) return;
  let cx = 0, cz = 0; for (const p of b.p) { cx += p[0]; cz += p[1]; } cx /= b.p.length; cz /= b.p.length;
  const cr = canvas.getBoundingClientRect(), ir = info.hidden ? null : info.getBoundingClientRect();
  let L = cr.left, Rt = cr.right, T = cr.top, Bt = cr.bottom;
  if (ir && ir.width) { if (ir.left > cr.left + cr.width * 0.4) Rt = Math.min(Rt, ir.left); else if (ir.top > cr.top + cr.height * 0.3) Bt = Math.min(Bt, ir.top); }
  _kp.set(cx, (b.b || 0) + b.h * 0.5, cz).project(camera);
  const sx = cr.left + (_kp.x + 1) / 2 * cr.width, sy = cr.top + (1 - _kp.y) / 2 * cr.height, pad = 60;
  if (sx > L + pad && sx < Rt - pad && sy > T + pad && sy < Bt - pad) return;
  const dx = sx - (L + Rt) / 2, dy = sy - (T + Bt) / 2, dist = camera.position.distanceTo(controls.target);
  const wpp = 2 * dist * Math.tan(camera.fov * Math.PI / 360) / cr.height;   // 화면 1px 당 m(대략)
  camera.matrixWorld.extractBasis(_kr, _ku, _kp); _kr.y = 0; _kr.normalize(); _ku.set(-_kp.x, 0, -_kp.z).normalize();   // 땅 위 오른쪽·앞쪽
  const move = _kr.multiplyScalar(dx * wpp).add(_ku.multiplyScalar(-dy * wpp * 1.4));
  const t0 = performance.now(), fC = camera.position.clone(), fT = controls.target.clone();
  (function f(now) { const k = Math.min(1, (now - t0) / 600), e = 1 - Math.pow(1 - k, 3);
    camera.position.copy(fC).addScaledVector(move, e); controls.target.copy(fT).addScaledVector(move, e); controls.update(); need(); if (k < 1) requestAnimationFrame(f); })(t0);
}

// ── 건물 정보 ─────────────────────────────────────────
const info = document.getElementById('info');
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function showInfo(b) {
  document.getElementById('i-title').textContent = b.n || (b.jibun ? b.jibun.replace('거제시 ', '') : b.ko);
  const lvTag = b.real ? '<span class="tag ok">확인</span>' : '<span class="tag est">추정</span>';
  const SRC = { vworld: '국토교통부 GIS건물통합정보', osm: 'OpenStreetMap', ml: 'Overture Maps(위성 인식)' };
  const rows = [
    ['용도', esc(b.ko)],
    ['층수', `지상 ${b.lv}층${lvTag}`],
    b.appr ? ['사용승인', esc(b.appr.slice(0, 4)) + '년'] : null,
    ['바닥 넓이', `약 ${b.a.toLocaleString('ko-KR')}㎡`],
    ['자료', SRC[b.src] || b.src],
  ].filter(Boolean);
  const note = b.real ? '' :
    '<p class="note">이 건물은 원자료에 층수가 없어 바닥 넓이로 짐작한 높이입니다.</p>';
  const extra = window.__map && window.__map.infoExtra ? window.__map.infoExtra(b, selIdx) : '';
  document.getElementById('i-body').innerHTML =
    extra + `<dl class="rows">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>${note}`;
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

// 마우스를 올린 건물: 흰 윤곽 + 말풍선(이름 · 상가 층 · 가게 없는 층). 0.06초에 한 번만 찾음, 끄는 중에는 안 함
const tip = document.createElement('div'); tip.className = 'map-tip'; tip.hidden = true; document.body.appendChild(tip);
let hovB = -1, hovLine = null, hovPend = false, hovEv = null, dragging = false;
canvas.addEventListener('pointerdown', () => { dragging = true; tip.hidden = true; });
window.addEventListener('pointerup', () => { dragging = false; });
canvas.addEventListener('pointerleave', () => setHover(-1));
canvas.addEventListener('pointermove', (e) => {
  hovEv = e; if (dragging || e.pointerType === 'touch' || hovPend) return; hovPend = true;
  setTimeout(() => { hovPend = false; const ev = hovEv; const r = canvas.getBoundingClientRect();
    ndc.set((ev.clientX - r.left) / r.width * 2 - 1, -(ev.clientY - r.top) / r.height * 2 + 1); ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(bMesh, false)[0]; setHover(hit ? triOwner[hit.faceIndex] : -1, ev); }, 60);
});
function floorSummary(bi) {
  const fl = FL && FL[String(bi)]; if (!fl) return '층별 자료 없음';
  const com = fl.filter(f => f.com).length, emp = fl.filter(f => f.state === 'empty').length;
  return com ? `상가 층 ${com}개 · <b class="${emp ? 'emp' : ''}">가게 없는 층 ${emp}개</b>` : '상가 층 없음';
}
function setHover(bi, ev) {
  if (bi !== hovB) {
    if (hovLine) { scene.remove(hovLine); hovLine.geometry.dispose(); hovLine = null; }
    hovB = bi;
    if (bi >= 0 && bi !== selIdx) {
      const [s0, e0] = bRange[bi], g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(bPos.slice(s0 * 3, e0 * 3), 3));
      hovLine = new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.95, depthTest: false }));
      hovLine.renderOrder = 15; g.dispose(); scene.add(hovLine);
    }
    canvas.style.cursor = bi >= 0 ? 'pointer' : '';
    need();
  }
  if (bi < 0 || !ev || bi === selIdx) { tip.hidden = true; return; }   // 이미 고른 건물은 정보창이 열려 있으니 말풍선 없음
  const b = B[bi], fl = FL && FL[String(bi)];
  // 이름: 지도 이름 → 건축물대장 건물명 → 지번 → (대장에 없는 OSM 건물) 종류
  const nm = b.n || b.dn || (b.jibun ? b.jibun.replace('거제시 ', '') : b.ko === '건물' ? '이름 없는 건물' : b.ko);
  // 둘째 줄: 건축물대장 값만(주용도 · 층수 · 사용승인 연도). 대장에 없는 건물은 그렇다고 적는다(추정 층수는 보이지 않음)
  const meta = b.jibun ? [b.use && b.use.replace(/^제[12]종/, ''), b.lvsrc && b.lv + '층', b.appr && b.appr.slice(0, 4) + '년 사용승인'].filter(Boolean).join(' · ')
    : '건축물대장에서 찾지 못한 건물(지도 자료 OSM)';
  tip.innerHTML = `<strong>${esc(nm)}</strong><span class="tm">${esc(meta)}</span>${fl ? `<span>${floorSummary(bi)}</span>` : ''}<em>${fl ? '누르면 층별로 보기' : '누르면 건물 정보 보기'}</em>`;
  tip.hidden = false;
  // 오른쪽 정보창(#info)이나 화면 끝에 걸리면 커서 왼쪽으로 뒤집어 띄움
  const tw = tip.offsetWidth, th = tip.offsetHeight, ir = info.hidden ? null : info.getBoundingClientRect();
  const limit = ir && ir.width && ir.left > innerWidth * 0.4 ? ir.left - 8 : innerWidth - 8;
  let tx = ev.clientX + 14, ty = ev.clientY + 16; if (tx + tw > limit) tx = ev.clientX - tw - 14; if (ty + th > innerHeight - 8) ty = ev.clientY - th - 12;
  tip.style.transform = `translate(${Math.round(tx)}px, ${Math.round(ty)}px)`;
}

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
  labels.push({ el, x: r.x, y: 1, z: r.z, a: r.a, pri: MAJOR.has(r.k) ? 4 : 1, kind: 'road', w: 0, h: 0 });
}
if (D.boundary) {
  const top = D.boundary.reduce((m, p) => p[1] < m[1] ? p : m, D.boundary[0]);
  const el = document.createElement('div'); el.className = 'lbl place zone'; el.textContent = 'R-ONE이 정한 거제옥포 상권';
  labelBox.appendChild(el); labels.push({ el, x: top[0], y: 2, z: top[1] - 25, pri: 10, kind: 'place', w: 0, h: 0 });
}
labels.sort((a, b) => b.pri - a.pri);
const show = { place: true, road: true };
const _v = new THREE.Vector3(), _w = new THREE.Vector3();
const COVER = ['#info', '#sim', '#nav', '#tabs', '#street', '#card', '#layers', '#rail', '#hint', '#scale', '#credit'];   // 축척 막대·출처 줄 밑 이름표도 숨김(seohogyun-20 지적)
// 패널 자리는 그리기 루프 밖(0.4초마다, 화면이 다 그려진 뒤)에서 재 둔다 — 루프 안에서 재면 브라우저가 배치를 한 번 더 계산해 끊길 수 있다
let coverCache = [];
function measureCover() {
  const W = canvas.clientWidth, H = canvas.clientHeight, cr = canvas.getBoundingClientRect(), out = [];
  for (const sel of COVER) {
    const el = document.querySelector(sel); if (!el || el.hidden) continue;   // position:fixed 는 offsetParent 가 없으므로 크기로 판단
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const b = [r.left - cr.left, r.top - cr.top, r.right - cr.left, r.bottom - cr.top];
    if (b[2] <= 0 || b[0] >= W || b[3] <= 0 || b[1] >= H) continue;
    if ((b[2] - b[0]) * (b[3] - b[1]) > 0.8 * W * H) continue;   // 화면을 거의 다 덮는 것(폰 펼친 시트 등)은 무시
    out.push(b);
  }
  const changed = JSON.stringify(out) !== JSON.stringify(coverCache);
  coverCache = out;
  if (changed) need();
}
setInterval(measureCover, 400);
function coverBoxes() { return coverCache.map(b => b.slice()); }
let labN = -1;
function placeLabels() {
  // 다른 파일이 나중에 넣은 이름표도 우선순위(pri 큰 것 먼저)대로 자리를 잡게: 목록이 바뀔 때만 다시 정렬(같은 pri 는 순서 유지)
  if (labels.length !== labN) { labels.sort((a, b) => b.pri - a.pri); labN = labels.length; }
  const W = canvas.clientWidth, H = canvas.clientHeight, taken = coverBoxes();
  const dist = camera.position.distanceTo(controls.target);
  for (const L of labels) {
    // 멀리(카메라 700m 넘게, 상권 전체 보기)서는 큰길(pri ≥ 4)·큰 지명(pri ≥ 8)과 ①②③·폐업·거리 이름표만 — 빈 층 주황이 이름표에 묻히지 않게(seohogyun-20 제안 C)
    const far = L.kind === 'road' ? (L.pri < 4 ? 700 : R * 3) : (L.pri <= 2 ? R * 0.5 : L.pri < 8 ? 700 : R * 3);
    if (!show[L.kind] || dist > far) { L.el.classList.add('off'); continue; }
    _v.set(L.x, L.y + (L.abs ? 0 : Math.max(0, hAt(L.x, L.z))), L.z).project(camera);   // 바다 위 이름표는 물 높이 0 아래로 내리지 않음   // 땅 기준 이름표는 지형 높이를 더함(abs 는 이미 절대 높이)
    if (_v.z > 1 || _v.x < -1.1 || _v.x > 1.1 || _v.y < -1.1 || _v.y > 1.1) { L.el.classList.add('off'); continue; }
    if (!L.w) { L.el.classList.remove('off'); L.w = L.el.offsetWidth; L.h = L.el.offsetHeight; }
    const x = (_v.x + 1) / 2 * W - L.w / 2, y = (1 - _v.y) / 2 * H - L.h / 2;
    const box = [x - 4, y - 2, x + L.w + 4, y + L.h + 2];
    if (box[0] < 0 || box[1] < 0 || box[2] > W || box[3] > H) { L.el.classList.add('off'); continue; }   // 화면 끝에 걸려 잘리는 이름표
    const hits = (bx) => taken.some(t => bx[0] < t[2] && bx[2] > t[0] && bx[1] < t[3] && bx[3] > t[1]);
    // nudge 이름표(층 단면 등)는 겹치면 숨기지 않고 아래로 한 칸씩 내려 자리를 찾는다(최대 6번)
    let dy = 0; if (L.nudge) { for (let k = 0; k < 6 && hits([box[0], box[1] + dy, box[2], box[3] + dy]); k++) dy += L.h + 3; }
    const bx2 = [box[0], box[1] + dy, box[2], box[3] + dy];
    if (hits(bx2)) { L.el.classList.add('off'); continue; }
    taken.push(bx2);
    L.el.classList.remove('off');
    let rot = 0;
    if (L.kind === 'road') {   // 길 방향을 화면에 투영해 글자를 그 방향으로(거꾸로 서지 않게 ±90° 안으로)
      _w.set(L.x + Math.cos(L.a) * 8, L.y, L.z + Math.sin(L.a) * 8).project(camera);
      rot = Math.atan2(-(_w.y - _v.y) * H, (_w.x - _v.x) * W) * 180 / Math.PI;
      if (rot > 90) rot -= 180; else if (rot < -90) rot += 180;
    }
    L.el.style.transform = `translate(${x.toFixed(1)}px, ${(y + dy).toFixed(1)}px)` + (rot ? ` rotate(${rot.toFixed(1)}deg)` : '');
  }
}

// ── 요약 카드 ─────────────────────────────────────────
function fillCard() {
  const $ = (id) => document.getElementById(id);
  $('s-label').textContent = ST.label;
  $('s-general').textContent = ST.general.toFixed(1);
  $('s-mini').textContent = `공실률 ${ST.general.toFixed(1)}% · ${ST.rank}위`;
  $('s-rank').textContent = `${(ST.scope.match(/\((.+)\)/) || [0, ST.scope])[1]} ${ST.of}개 상권 중 ${ST.rank}위`;
  $('s-quarter').textContent = ST.quarter;
  $('s-large').textContent = ST.large.toFixed(1) + '%';
  $('s-before').textContent = ST.series[0].v.toFixed(1) + '%';
  $('s-src').textContent = `${ST.source}, ${ST.quarter}`;
  // 꺾은선: 옥포(강조색) + 비교 둘(회색 계열)
  const svg = $('s-chart'), W = 280, H = 80, pl = 26, pr = 34, pt = 6, pb = 16;
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
// ── 하루 빛: 재생 시각(sim-time)에 맞춰 해·하늘·안개 색과 밤 창 불빛을 바꾼다 ─────────────
// 일출 07:10·일몰 17:15, 시민박명 06:43~17:42(옥포 2026-11-27, 계산값). 해 방향은 고정(그림자를 다시 계산하면 멈칫해서)
// 하늘: 카메라를 따라다니는 큰 공 안쪽에 위(천정)→지평선 그라데이션. 지평선 색 = 안개·배경색이라 땅과 이음새가 없다
const skyU = { top: { value: new THREE.Color('#c9dcf0') }, hor: { value: new THREE.Color('#f1efea') } };
const sky = new THREE.Mesh(new THREE.SphereGeometry(R * 5, 32, 16), new THREE.ShaderMaterial({
  uniforms: skyU, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: 'uniform vec3 top; uniform vec3 hor; varying vec3 vD; void main(){ float h = clamp(vD.y, 0.0, 1.0); gl_FragColor = linearToOutputTexel(vec4(mix(hor, top, pow(smoothstep(0.0, 0.42, h), 0.75)), 1.0)); }' }));   // 다른 재질처럼 화면 색 공간으로 바꿔야 지평선 이음새가 없다
sky.renderOrder = -10; sky.frustumCulled = false; sky.onBeforeRender = () => sky.position.copy(camera.position); scene.add(sky);
// 밤하늘 별(위쪽 반구, 밤 정도만큼 보임)
const stars = (() => { const n = 700, p = new Float32Array(n * 3); let seed = 7; const r = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < n; i++) { const u = r() * Math.PI * 2, y = 0.08 + r() * 0.92, k = Math.sqrt(1 - y * y); p.set([Math.cos(u) * k * R * 4.8, y * R * 4.8, Math.sin(u) * k * R * 4.8], i * 3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const m = new THREE.Points(g, new THREE.PointsMaterial({ color: '#dfe7ff', size: 1.6 * renderer.getPixelRatio(), sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false }));
  m.renderOrder = -9; m.frustumCulled = false; m.onBeforeRender = () => m.position.copy(camera.position); scene.add(m); return m; })();
const LK = (o) => ({ zen: new THREE.Color(o.zen || '#c9dcf0'), bg: o.bg && new THREE.Color(o.bg), sky: new THREE.Color(o.sky), gnd: new THREE.Color(o.gnd), hI: o.hI, sunC: new THREE.Color(o.sunC), sunI: o.sunI, lit: o.lit });
const DAY = LK({ zen: '#9cc0e8', bg: null, sky: '#ffffff', gnd: '#a3adba', hI: 0.64, sunC: '#fff3e3', sunI: 0.56, lit: 0 });
const LKEY = [
  [300, LK({ zen: '#0b1020', bg: '#1e2433', sky: '#5d6f96', gnd: '#262b38', hI: 0.4, sunC: '#a9bde3', sunI: 0.1, lit: 1 })],    // 05:00 밤
  [403, LK({ zen: '#1a2240', bg: '#2b3146', sky: '#6b789c', gnd: '#2c3140', hI: 0.42, sunC: '#b7c3e0', sunI: 0.12, lit: 0.9 })], // 06:43 새벽빛 시작
  [430, LK({ zen: '#8f9fc8', bg: '#cfc4cf', sky: '#e3dbe8', gnd: '#8a8698', hI: 0.52, sunC: '#ffc79a', sunI: 0.34, lit: 0.25 })], // 07:10 해 뜸
  [480, DAY], [995, DAY],                                                                                         // 08:00 ~ 16:35 낮
  [1035, LK({ zen: '#93a6d4', bg: '#f0e5d8', sky: '#fff0dc', gnd: '#9d9590', hI: 0.58, sunC: '#ffd2a6', sunI: 0.5, lit: 0.15 })], // 17:15 해 짐(노을, 은은하게)
  [1062, LK({ zen: '#232a4a', bg: '#4b4f6b', sky: '#8a8fb8', gnd: '#3d3f52', hI: 0.44, sunC: '#ff9a6b', sunI: 0.14, lit: 0.7 })], // 17:42 땅거미
  [1100, LK({ zen: '#0b1020', bg: '#1e2433', sky: '#5d6f96', gnd: '#262b38', hI: 0.4, sunC: '#a9bde3', sunI: 0.1, lit: 1 })],    // 18:20 밤
  [1560, LK({ zen: '#0b1020', bg: '#1e2433', sky: '#5d6f96', gnd: '#262b38', hI: 0.4, sunC: '#a9bde3', sunI: 0.1, lit: 1 })],
];
let dayBg = null, lastBg = null, nightNow = -1;
const _c = new THREE.Color();
function dayLight(t) {
  // 바닥층(ground.js)이 낮 배경색을 바꾸면 그 색을 낮 기준으로 삼는다
  if (!dayBg || (scene.background && lastBg && !scene.background.equals(lastBg))) dayBg = scene.background.clone();
  let i = 0; while (i < LKEY.length - 2 && LKEY[i + 1][0] <= t) i++;
  const [t0, A0] = LKEY[i], [t1, A1] = LKEY[i + 1], k = Math.max(0, Math.min(1, (t - t0) / (t1 - t0 || 1)));
  const e = k * k * (3 - 2 * k), bgA = A0.bg || dayBg, bgB = A1.bg || dayBg;
  hemi.color.copy(A0.sky).lerp(A1.sky, e); hemi.groundColor.copy(A0.gnd).lerp(A1.gnd, e); hemi.intensity = A0.hI + (A1.hI - A0.hI) * e;
  sun.color.copy(A0.sunC).lerp(A1.sunC, e); sun.intensity = A0.sunI + (A1.sunI - A0.sunI) * e;
  _c.copy(bgA).lerp(bgB, e); scene.background.copy(_c); if (scene.fog) scene.fog.color.copy(_c); lastBg = scene.background.clone();
  skyU.hor.value.copy(_c); skyU.top.value.copy(A0.zen).lerp(A1.zen, e);
  const lit = A0.lit + (A1.lit - A0.lit) * e;
  bMat.emissiveIntensity = lit * 0.95; uRoofGlow.value = lit * 0.6;
  // 사무·상가 위층 불: 18:30까지 그대로 → 20:00 에 25% / 1층 가게: 22:00 까지 → 23:30 에 15%(일부 술집·편의점만)
  const ramp = (a, b, lo) => t <= a ? 1 : t >= b ? lo : 1 - (1 - lo) * (t - a) / (b - a);
  uOfficeK.value = t < 600 ? 0.3 : ramp(1110, 1200, 0.25); uShopK.value = t < 600 ? 0.2 : ramp(1320, 1410, 0.15); stars.material.opacity = Math.max(0, lit - 0.4) / 0.6 * 0.85;
  document.body.classList.toggle('night', lit >= 0.5);   // 이름표 등 화면 글자가 어두운 배경용 모양으로 바뀔 수 있게(app.css)
  if (Math.abs(lit - nightNow) > 0.02) { nightNow = lit; document.dispatchEvent(new CustomEvent('map-light', { detail: { night: lit } })); }   // 가로등·간판 등이 따라 켜지게
  need();
}
document.addEventListener('sim-time', (e) => dayLight(e.detail.t));

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
  if (TON) { const h = hAt(controls.target.x, controls.target.z), d = h - controls.target.y; if (Math.abs(d) > 0.05) { controls.target.y += d * 0.15; camera.position.y += d * 0.15; dirty = true; } }
  if (controls.update()) dirty = true;
  if (!dirty) return;
  dirty = false;
  syncWindows();
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
window.__map = { select, hideBuilding, get selMesh() { return selMesh; }, buildings: B, signedArea, camera, controls, HOME, labels, need, orbit, scene, renderer, R, esc, tint, setRoofs,
  roads: roadMeshes, ground, greens: greenMeshes, water: waterMesh, xz, meta: D.meta, dayLight, edgeFade, hAt, TON, GL, get night() { return Math.max(0, nightNow); },
  get selected() { return selIdx; }, infoExtra: null };
function syncFog() { if (!scene.fog) return; const h = camera.position.y, k = 1 + Math.max(0, Math.min(1, (420 - h) / 380)) * 0.9; scene.fog.near = R * 1.15 * k; scene.fog.far = R * 2.6 * k; }
controls.addEventListener('change', syncFog); syncFog();
bndK = boundaryK(); drawBoundary(bndK);
controls.addEventListener('change', () => { const k = boundaryK(); if (k !== bndK) { bndK = k; drawBoundary(k); } });
document.dispatchEvent(new Event('map-ready'));
})();
