/* 가게 간판: 상가정보(2026-09) 영업 중 가게마다 그 가게 건물·층의 가장 가까운 면에 간판, 1층 가게는 유리 진열창도.
   자리(건물·층)는 자료, 간판 색은 가게 이름으로 정한 표현이다. InstancedMesh(한 번에 그리기).
   실제 자료가 아닌 장식(임대 현수막·물탱크·옥탑방·주차된 차)은 사용자 지시로 지웠다(2026-11-27). */
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

// '임대 문의' 현수막·옥상 물탱크·옥탑방·주차된 차는 지웠다(사용자 지시 2026-11-27: 실제 자료가 아닌 것은 없앤다).
// 현수막은 실제로 붙어 있는지 모르는 것을 그렸고, 물탱크·옥탑방·차는 이름 해시·규칙으로 놓은 장식이었다.
// 반복 그리기 묶음은 원래 모양(원점의 1m 판) 기준으로 화면 밖 판정을 해서, 원점이 안 보이면 통째로 사라진다 → 끈다
group.children.forEach(m => { m.frustumCulled = false; });
renderer.shadowMap.needsUpdate = true;
// 보기 설정
const layers = document.getElementById('layers');
const lab = document.createElement('label'); lab.className = 'tog';
lab.innerHTML = '<input type="checkbox" id="L-detail" checked><span>가게 간판</span>';
layers.appendChild(lab);
document.getElementById('L-detail').onchange = (e) => { group.visible = e.target.checked; renderer.shadowMap.needsUpdate = true; need(); };
need();
window.__details = { signs: signs.length, rents: 0, tanks: 0, rooms: 0, cars: 0 };
})();
