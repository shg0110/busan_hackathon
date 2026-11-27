/* 층별 상가 현황: 건축물대장 층별 용도 × 상가정보 영업 중 가게(window.FLOORS, tools/okpo_floors.py).
   상가 층마다 벽에 색 띠를 두른다: 영업 중(가게 등록 있음) / 가게 등록 없음 / 확인 불가(사무실·종교시설 등 상가정보로 알 수 없음).
   '가게 등록 없음'은 실제 공실과 같지 않다 — 정보창과 카드에 그 차이를 적는다. */
(() => {
'use strict';
const F = window.FLOORS, M = window.__map;
if (!F || !M) return;
const { buildings: B, scene, need, esc } = M;
const STATE = {
  empty:   { ko: '가게 없는 층',  col: '#f0783a', cls: 'st-empty' },
  open:    { ko: '영업 중인 층',  col: '#4fa679', cls: 'st-open' },
  unknown: { ko: '확인 불가',     col: '#adb5bd', cls: 'st-unk' },
};
const CAT_KO = { food: '음식', shop: '소매', svc: '수리·개인', stay: '숙박', edu: '교육', leisure: '예술·스포츠', med: '의료', office: '사무·서비스', etc: '기타' };

// ── 층 띠 ─────────────────────────────────────────────
function signedArea(p) { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; }
// 빈 층(empty)과 나머지(open·unknown)를 다른 덩어리로: 기본은 빈 층만 보인다
const buf = { empty: { pos: [], nrm: [], col: [] }, rest: { pos: [], nrm: [], col: [] } };
const cc = {}; for (const k in STATE) cc[k] = new THREE.Color(STATE[k].col);
let bands = 0;
for (const key in F.b) {
  const bi = +key, b = B[bi], floors = F.b[key];
  if (!b || b.k === 'roof') continue;
  let p = b.p.slice(); if (signedArea(p) > 0) p.reverse();
  const fh = (b.h - 0.6) / b.lv, y00 = b.b || 0;
  for (const f of floors) {
    const c = cc[f.state]; if (!c || f.n > b.lv) continue;
    const { pos, nrm, col } = f.state === 'empty' ? buf.empty : buf.rest;
    const y0 = y00 + (f.n - 1) * fh + fh * 0.34, y1 = y00 + (f.n - 1) * fh + fh * 0.62;   // 층 가운데 얇은 띠(층고의 28%) — 두꺼우면 공사장 테이프처럼 보여서
    for (let i = 0; i < p.length; i++) {
      const a = p[i], q = p[(i + 1) % p.length];
      const dx = q[0] - a[0], dz = q[1] - a[1], l = Math.hypot(dx, dz); if (l < 0.3) continue;
      const nx = -dz / l, nz = dx / l, o = 0.12;
      const ax = a[0] + nx * o, az = a[1] + nz * o, bx = q[0] + nx * o, bz = q[1] + nz * o;
      pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y0, az, bx, y1, bz, ax, y1, az);
      for (let k = 0; k < 6; k++) { nrm.push(nx, 0, nz); col.push(c.r, c.g, c.b); }
    }
    bands++;
  }
}
function meshOf(B_) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(B_.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(B_.nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(B_.col, 3));
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
  m.receiveShadow = true; m.renderOrder = 11; scene.add(m); return m;
}
const bandMesh = meshOf(buf.empty), restMesh = meshOf(buf.rest);
restMesh.visible = false;

// ── 보기 설정 + 범례 ──────────────────────────────────
const layers = document.getElementById('layers');
const lab = document.createElement('label'); lab.className = 'tog';
lab.innerHTML = `<input type="checkbox" id="L-floors" checked><span><i class="sw" style="background:${STATE.empty.col}"></i>가게 없는 층</span>`;
const lab2 = document.createElement('label'); lab2.className = 'tog';
lab2.innerHTML = `<input type="checkbox" id="L-open"><span><i class="sw" style="background:${STATE.open.col}"></i>영업 중인 층</span>`;
layers.prepend(lab2); layers.prepend(lab);
document.getElementById('L-floors').onchange = (e) => { bandMesh.visible = e.target.checked; need(); };
document.getElementById('L-open').onchange = (e) => { restMesh.visible = e.target.checked; need(); };

// ── 요약 카드에 층별 숫자 ─────────────────────────────
const S = F.stats.inside && F.stats.inside.com_floors ? F.stats.inside : F.stats;
const box = document.createElement('div'); box.className = 'floor-sum';
box.innerHTML = `<p class="fs-title">층마다 세어 보면</p>
  <p class="fs-line">상권 안 상가 층 ${S.com_floors.toLocaleString('ko-KR')}개 중 <b>${S.empty_floors.toLocaleString('ko-KR')}개</b>에 가게가 없습니다
  <span class="fs-sub">면적으로는 ${S.empty_area_pct}%입니다.</span></p>
  <p class="fs-note">사무실이나 등록 안 된 가게도 “가게 없음”으로 잡혀서 공실률보다 높게 나옵니다. 건축물대장 층별개요와 2026년 9월 상가정보를 맞춰 셌습니다.</p>
  <p class="fs-key">지붕이 주황일수록 가게 없는 층이 많은 건물입니다. 지도 위 ①②③은 반경 70m 안에 가게 없는 층이 가장 많이 몰린 곳입니다.</p>
  <button class="tour btn-sub" id="tour-btn">빈 1층에 가게 열어 보기 <span id="tour-n"></span></button>`;
const src = document.querySelector('#card-body .src');
src.after(box);
if (window.__syncCard) window.__syncCard();

// ── 정보창: 층별 표 ───────────────────────────────────
M.infoExtra = (b, bi) => {
  const fl = F.b[String(bi)];
  if (!fl) return b.pnu ? '<p class="note">건축물대장에 층별 용도가 없는 건물입니다.</p>' : '';
  const rows = fl.slice().sort((a, c) => c.n - a.n).map(f => {
    const st = STATE[f.state];
    const badge = st ? `<span class="st ${st.cls}">${st.ko}${f.spread ? '(같은 업소로 추정)' : ''}</span>` : `<span class="st st-home">${f.state === 'home' ? '주거' : '기타'}</span>`;
    const uses = f.uses.map(u => esc(u)).join(', ');
    let shops = '';
    if (f.stores.length) {
      const names = f.stores.slice(0, 4).map(s => `${esc(s.n)} <span class="cat">${esc(s.cs || CAT_KO[s.c] || '')}</span>`).join('<br>');
      shops = `<div class="shops">${names}${f.stores.length > 4 ? `<br><span class="cat">외 ${f.stores.length - 4}곳</span>` : ''}${f.inferred ? '<br><span class="cat">층정보 없는 가게를 이 층으로 추정</span>' : ''}</div>`;
    }
    return `<tr><th>${f.n}층</th><td><div class="use">${uses}${f.area ? ` · ${Math.round(f.area)}㎡` : ''}</div>${badge}${shops}</td></tr>`;
  }).join('');
  const hasEmpty = fl.some(f => f.state === 'empty');
  const note = hasEmpty ? '<p class="note">"가게 없는 층"은 상가정보(2026년 9월)에 이 층 가게가 없다는 뜻입니다. 사무실·창고로 쓰거나 등록이 늦은 경우도 있어 실제 공실과 다를 수 있습니다.</p>' : '';
  return `<table class="floors">${rows}</table>${note}`;
};

// ── 가게 없는 1층 둘러보기: 상권 안, 넓은 순서로 하나씩 날아가 정보창(실험 포함)을 연다 ──
const tour = Object.keys(F.b).map(Number).filter(bi => B[bi] && B[bi].i && F.b[bi].some(f => f.n === 1 && f.state === 'empty'))
  .sort((a, c) => (F.b[c].find(f => f.n === 1).area || 0) - (F.b[a].find(f => f.n === 1).area || 0));
let tourAt = -1;
function flyTo(bi) {
  const b = B[bi]; let x = 0, z = 0; for (const p of b.p) { x += p[0]; z += p[1]; } x /= b.p.length; z /= b.p.length;
  const cam = M.camera, ctl = M.controls, t0 = performance.now(), dur = 700;
  const fromC = cam.position.clone(), fromT = ctl.target.clone();
  const toT = new THREE.Vector3(x, 0, z), toC = new THREE.Vector3(x + 70, 75 + b.h, z + 110);
  function f(now) {
    const k = Math.min(1, (now - t0) / dur), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    cam.position.lerpVectors(fromC, toC, e); ctl.target.lerpVectors(fromT, toT, e); ctl.update(); need();
    if (k < 1) requestAnimationFrame(f);
  }
  requestAnimationFrame(f);
  M.select(bi);
}
function nextTour() { if (!tour.length) return; tourAt = (tourAt + 1) % tour.length; flyTo(tour[tourAt]);
  document.getElementById('tour-n').textContent = `${tourAt + 1} / ${tour.length}`; }
document.getElementById('tour-n').textContent = `${tour.length}곳`;
// 빈 1층으로 날아간 뒤 정보창의 '이 빈 층에 가게 열어 보기'(#exp)가 보이게
document.getElementById('tour-btn').onclick = () => { nextTour(); setTimeout(() => { const e = document.getElementById('exp'); if (e) e.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, 750); };
need();
// ── 빈 층이 몰린 곳 한눈에 ─────────────────────────────
// ① 지붕: 위에서 보면 지붕이 가장 넓게 보이므로, 가게 없는 층이 있는 건물 지붕을 주황으로(1층 옅게 → 3층 이상 진하게)
// ② 몰린 곳: 반경 70m 안 '가게 없는 층' 합이 가장 큰 곳 3곳(서로 220m 이상 떨어짐)에 땅 위 고리 + 이름표. 상권(R-ONE 경계) 안 건물만
const ORANGE = new THREE.Color(STATE.empty.col).toArray();
const emptyN = {};   // 건물 번호 → 가게 없는 상가 층 수
for (const key in F.b) { const b = B[+key]; if (!b) continue; const n = F.b[key].filter(f => f.state === 'empty' && f.n <= b.lv).length; if (n) emptyN[+key] = n; }
const roofMap = new Map(Object.entries(emptyN).map(([bi, n]) => [+bi, { c: ORANGE, k: n >= 3 ? 0.82 : n === 2 ? 0.62 : 0.42 }]));
const ctr = (b) => { let x = 0, z = 0; for (const p of b.p) { x += p[0]; z += p[1]; } return [x / b.p.length, z / b.p.length]; };
const pts = Object.entries(emptyN).filter(([bi]) => B[+bi].i).map(([bi, n]) => { const [x, z] = ctr(B[+bi]); return { x, z, n }; });
const RAD = 70, hot = [];
const score = pts.map(p => { let s = 0, sx = 0, sz = 0; for (const q of pts) { if (Math.hypot(q.x - p.x, q.z - p.z) <= RAD) { s += q.n; sx += q.x * q.n; sz += q.z * q.n; } } return { s, x: sx / s, z: sz / s }; })
  .sort((a, b) => b.s - a.s);
for (const c of score) { if (hot.length >= 3) break; if (hot.every(h => Math.hypot(h.x - c.x, h.z - c.z) >= 220)) hot.push(c); }
for (const h of hot) { h.bld = new Set(pts.filter(q => Math.hypot(q.x - h.x, q.z - h.z) <= RAD).map(q => q)).size; }
const hotGroup = new THREE.Group(); scene.add(hotGroup);
hot.forEach((h, k) => {
  const ring = new THREE.Mesh(new THREE.RingGeometry(RAD - 2.2, RAD, 72), new THREE.MeshBasicMaterial({ color: STATE.empty.col, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.set(h.x, 0.12, h.z); ring.renderOrder = 9.5;
  const fill = new THREE.Mesh(new THREE.CircleGeometry(RAD - 2.2, 72), new THREE.MeshBasicMaterial({ color: STATE.empty.col, transparent: true, opacity: 0.1, depthWrite: false }));
  fill.rotation.x = -Math.PI / 2; fill.position.set(h.x, 0.1, h.z); fill.renderOrder = 9.4;
  hotGroup.add(ring, fill);
  const el = document.createElement('div'); el.className = 'lbl place hot'; el.innerHTML = `<b>${k + 1}</b>가게 없는 층 ${h.s}개`;
  document.getElementById('labels').appendChild(el);
  h.L = { el, x: h.x, y: 30, z: h.z, pri: 10, kind: 'place', w: 0, h: 0 }; M.labels.unshift(h.L);
});
hotGroup.children.forEach(m => { m.frustumCulled = false; });
let roofsOn = true;
function syncHot() {
  const on = document.getElementById('L-floors').checked, street = document.body.classList.contains('street-mode');
  if (on !== roofsOn) { roofsOn = on; M.setRoofs(on ? roofMap : null); }
  hotGroup.visible = on && !street;
  for (const h of hot) h.L.el.style.display = hotGroup.visible ? '' : 'none';
  need();
}
M.setRoofs(roofMap);
document.getElementById('L-floors').addEventListener('change', syncHot);
new MutationObserver(syncHot).observe(document.body, { attributes: true, attributeFilter: ['class'] });
syncHot();

window.__floors = { hot, emptyN, bands, mesh: bandMesh, rest: restMesh, stats: S, tour, nextTour };
})();
