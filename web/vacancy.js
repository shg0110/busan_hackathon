/* 인허가 폐업 기록으로 찾은 빈 점포 후보(추정 위치) — window.VACANCY(tools/web_vacancy.py).
   진한 빨강 = A(같은 주소에 영업 가게 없음) + 우리 층 판정도 '가게 없는 층', 빨강 = A, 회색 = B(불확실).
   핀을 누르면 그 건물 정보창이 열리고 폐업 기록이 함께 나온다. */
(() => {
'use strict';
const V = window.VACANCY, M = window.__map;
if (!V || !V.length || !M) return;
const { buildings: B, scene, need, esc, camera } = M;
const COL = { strong: '#c92a2a', A: '#f03e3e', B: '#868e96' };
const n = V.length;
const stemG = new THREE.CylinderGeometry(0.22, 0.22, 1, 6); stemG.translate(0, 0.5, 0);
const headG = new THREE.SphereGeometry(1, 16, 12);
const stem = new THREE.InstancedMesh(stemG, new THREE.MeshLambertMaterial({ color: '#495057' }), n);
const head = new THREE.InstancedMesh(headG, new THREE.MeshLambertMaterial({ color: '#ffffff' }), n);
const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
V.forEach((v, i) => {
  const b = B[v.b], top = Math.max(10, (b ? b.h : 6) + 5), r = v.strong ? 2.2 : v.g === 'A' ? 1.8 : 1.3;
  p.set(v.x, 0, v.z); s.set(1, top, 1); mtx.compose(p, q, s); stem.setMatrixAt(i, mtx);
  p.set(v.x, top + r * 0.8, v.z); s.set(r, r, r); mtx.compose(p, q, s); head.setMatrixAt(i, mtx);
  head.setColorAt(i, c.set(v.strong ? COL.strong : COL[v.g]));
  v.top = top + r * 0.8;
});
head.instanceColor.needsUpdate = true;
for (const m of [stem, head]) { m.renderOrder = 12; m.castShadow = false; m.frustumCulled = false; scene.add(m); }

// 강한 후보에 이름표
const box = document.getElementById('labels');
for (const v of V.filter(v => v.strong)) {
  const el = document.createElement('div'); el.className = 'lbl place vac'; el.textContent = `${v.n}, ${v.closed.slice(2, 4)}년 ${+v.closed.slice(5, 7)}월 폐업`;
  box.appendChild(el); M.labels.unshift({ el, x: v.x, y: v.top + 4, z: v.z, pri: 9, kind: 'place', w: 0, h: 0 });
}

// 누르기: 핀 머리
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); let down = null;
const canvas = document.getElementById('c');
canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!head.visible || !down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return;
  const r = canvas.getBoundingClientRect(); ndc.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = ray.intersectObject(head, false)[0];
  if (hit) setTimeout(() => M.select(V[hit.instanceId].b), 0);   // 건물 누르기 처리 뒤에 덮어쓴다
});

// 정보창: 이 건물의 폐업 기록
const byB = {}; for (const v of V) (byB[v.b] || (byB[v.b] = [])).push(v);
const prev = M.infoExtra;
M.infoExtra = (b, bi) => {
  const base = prev ? prev(b, bi) : '', list = byB[bi];
  if (!list) return base;
  const rows = list.map(v => `<li><span class="vg ${v.strong ? 'strong' : v.g}">${v.strong ? 'A·가게 없는 층' : v.g}</span> <b>${esc(v.n)}</b> ${esc(v.kind || '')}<br><span class="vm">${esc(v.floor ? v.floor + '층 · ' : '')}${v.area ? Math.round(+v.area) + '㎡ · ' : ''}${esc(v.opened.slice(0, 4))}년 열고 ${esc(v.closed)} 폐업 · ${esc(v.state || '')}</span></li>`).join('');
  return `<div class="vac-box"><p class="exp-title">인허가 폐업 기록 <span class="vm">추정 위치</span></p><ul>${rows}</ul>
    <p class="vm">행정안전부 인허가(일반·휴게음식점) 2024년 이후 폐업. A = 같은 주소에 지금 영업 가게 없음, B = 불확실.</p></div>` + base;
};

// 보기 설정
const layers = document.getElementById('layers');
const lab = document.createElement('label'); lab.className = 'tog';
lab.innerHTML = `<input type="checkbox" id="L-vac" checked><span><i class="sw" style="background:${COL.strong}"></i>문 닫은 가게 ${V.length}곳</span>`;
layers.insertBefore(lab, layers.children[1] || null);
document.getElementById('L-vac').onchange = (e) => {
  stem.visible = head.visible = e.target.checked;
  for (const L of M.labels) if (L.el.classList.contains('vac')) L.el.style.visibility = e.target.checked ? '' : 'hidden';
  need();
};
need();
window.__vacancy = { V, head };
})();
