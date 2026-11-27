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
// 밤(재생 시각이 해 진 뒤)에는 조명 없는 재질로 바꿔 제 색이 그대로 보이게
const nightMat = new THREE.MeshBasicMaterial({ vertexColors: true }), dayMats = [bandMesh.material, restMesh.material];
document.addEventListener('map-light', (e) => { const n = e.detail.night >= 0.5; bandMesh.material = n ? nightMat : dayMats[0]; restMesh.material = n ? nightMat : dayMats[1]; need(); });
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
  // 고리·속은 땅에 바로 그린다(지형이 켜지면 꼭짓점마다 땅 높이 — 평평한 원판이면 비탈에 묻히거나 뜸)
  const drape = (g) => { g.rotateX(-Math.PI / 2); g.translate(h.x, 0, h.z); const pa = g.attributes.position; for (let i = 0; i < pa.count; i++) pa.setY(i, pa.getY(i) + M.hAt(pa.getX(i), pa.getZ(i))); return g; };
  const ring = new THREE.Mesh(drape(new THREE.RingGeometry(RAD - 2.2, RAD, 96)), new THREE.MeshBasicMaterial({ color: STATE.empty.col, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }));
  ring.position.y = 0.12; ring.renderOrder = 9.5;
  const fill = new THREE.Mesh(drape(new THREE.CircleGeometry(RAD - 2.2, 48, 0, Math.PI * 2)), new THREE.MeshBasicMaterial({ color: STATE.empty.col, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide }));
  fill.position.y = 0.1; fill.renderOrder = 9.4;
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

// ── 고른 건물 층 단면 ─────────────────────────────────
// 건물을 고르면 그 건물 벽을 잠시 치우고, 층마다 블록(층고의 78%)을 쌓아 층 상태 색으로 칠하고 층 이름표를 단다.
// 색: 영업 초록·가게 없음 주황·확인 불가 회색·주거 옅은 파랑·기타 베이지·자료 없음 흰색 반투명. 상태는 건축물대장 층별개요 × 상가정보(2026-09)
const CUT_COL = { open: '#4fa679', empty: '#f0783a', unknown: '#8d959e', home: '#c3d3e4', other: '#e3d7c1', nodata: '#ffffff' };
let cutGroup = null, cutLabels = [];
function clearCut() {
  if (cutGroup) { scene.remove(cutGroup); cutGroup.traverse(o => { if (o.geometry) o.geometry.dispose(); }); cutGroup = null; }
  for (const L of cutLabels) { L.el.remove(); const i = M.labels.indexOf(L); if (i >= 0) M.labels.splice(i, 1); } cutLabels = [];
  M.hideBuilding(-1);
}
function floorText(f) {
  if (!f) return '층별 자료 없음';
  if (f.state === 'open') { const st = f.stores || []; return st.length ? `${st[0].n}${st.length > 1 ? ` 외 ${st.length - 1}곳` : ''}` : '영업 중(위·아래층 가게가 함께 씀)'; }
  if (f.state === 'empty') return `가게 없음${f.area ? ` · ${Math.round(f.area)}㎡` : ''}`;
  if (f.state === 'unknown') return `확인 불가(${(f.uses && f.uses[0] || '').replace(/^제\d종/, '')})`;
  if (f.state === 'home') return '주거';
  return (f.uses && f.uses[0]) || '기타';
}
document.addEventListener('building-select', (e) => {
  clearCut();
  const bi = e.detail.bi, b = B[bi], fl = bi >= 0 && F.b[String(bi)];
  if (!b || !fl || b.k === 'roof' || b.lv < 1) return;
  M.hideBuilding(bi);
  if (M.selMesh) { M.selMesh.material.opacity = 0.12; M.selMesh.material.color.set('#ffffff'); }
  const p = b.p.slice(); if (signedArea(p) > 0) p.reverse();
  const shape = new THREE.Shape(p.map(q => new THREE.Vector2(q[0], -q[1])));
  const fh = (b.h - 0.6) / b.lv, y00 = b.b || 0, byN = {}; for (const f of fl) byN[f.n] = f;
  cutGroup = new THREE.Group();
  // 이름표 자리: 건물 가운데에서 카메라 왼쪽으로 건물 반지름 + 3m(오른쪽엔 정보창이 열려 있음)
  let cx = 0, cz = 0, rad = 0; for (const q of p) { cx += q[0]; cz += q[1]; } cx /= p.length; cz /= p.length; for (const q of p) rad = Math.max(rad, Math.hypot(q[0] - cx, q[1] - cz));
  const right = new THREE.Vector3().setFromMatrixColumn(M.camera.matrixWorld, 0); right.y = 0; right.normalize();
  const off = rad * 0.7 + 2, lx = cx - right.x * off, lz = cz - right.z * off;   // 건물 왼쪽 가장자리 바로 옆
  // 같은 내용이 이어지는 층은 이름표 하나로(예: '4~15층 주거') — 층마다 달면 높은 건물에서 이름표끼리 겹쳐 다 숨는다
  const runs = [];
  for (let n = 1; n <= b.lv; n++) { const f = byN[n], st = f ? (CUT_COL[f.state] ? f.state : 'other') : 'nodata', tx = floorText(f), last = runs[runs.length - 1];
    if (last && last.st === st && last.tx === tx && st !== 'open' && st !== 'empty') last.n1 = n; else runs.push({ n0: n, n1: n, st, tx }); }
  for (const r of runs) {
    const el = document.createElement('div'); el.className = 'lbl place flr fl-' + r.st; el.innerHTML = `<b>${r.n0 === r.n1 ? r.n0 : r.n0 + '~' + r.n1}층</b> ${esc(r.tx)}`;
    document.getElementById('labels').appendChild(el);
    const L = { el, x: lx, y: y00 + ((r.n0 + r.n1) / 2 - 0.5) * fh, z: lz, pri: 13, kind: 'place', w: 0, h: 0, nudge: true, abs: true };   // y 가 이미 건물 바닥(b.b, 지형 포함) 기준 M.labels.unshift(L); cutLabels.push(L);
  }
  for (let n = 1; n <= b.lv; n++) {
    const f = byN[n], st = f ? (CUT_COL[f.state] ? f.state : 'other') : 'nodata';
    const g = new THREE.ExtrudeGeometry(shape, { depth: fh * 0.78, bevelEnabled: false }); g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ color: CUT_COL[st], transparent: st === 'nodata', opacity: st === 'nodata' ? 0.5 : 1 }));
    m.position.y = y00 + (n - 1) * fh + fh * 0.11; m.castShadow = false; m.receiveShadow = true; m.renderOrder = 12; cutGroup.add(m);
  }
  cutGroup.children.forEach(o => { o.frustumCulled = false; }); scene.add(cutGroup); need();
});

window.__floors = { hot, emptyN, bands, mesh: bandMesh, rest: restMesh, stats: S, tour, nextTour };
})();
