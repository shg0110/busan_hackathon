/* 거리 집중 화면(옥포).
   자료: window.STREETS(tools/okpo_street.py: 거리 중심선·길가 1층 칸), window.FLOORS, window.__sim.
   - 위 가운데 탭으로 거리를 고르면 카메라가 거리로 가고, 거리 밖 건물은 흐려진다.
   - 오른쪽 패널: 양쪽 1층 칸 띠(영업 중·가게 없음…), 이 거리를 지나간 가상 손님(시간대·부류), 빈 1층 자리 순위. */
(() => {
'use strict';
const ST = window.STREETS, M = window.__map, SIM = window.__sim;
if (!ST || !ST.length || !M) return;
const { buildings: B, scene, need, esc } = M;
// 층 그림 색: 상가 층 3가지(영업·가게 없음·확인 불가)는 진하게, 상가가 아닌 층(주거·기타)은 서로 다른 옅은 색, 자료 없음은 흰 칸 + 테두리
const COL = { open: '#4fa679', empty: '#f0783a', unknown: '#8d959e', home: '#c3d3e4', other: '#e3d7c1', nodata: '#ffffff' };
const KO = { open: '영업 중', empty: '가게 없음', unknown: '확인 불가', home: '주거', other: '기타(주차·공공 등)', nodata: '층별 자료 없음' };
// 범례는 한 줄에 들어가게 짧게, 뜻은 title 과 '어떻게 셌나요'에
const KO_LG = { ...KO, other: '기타', nodata: '자료 없음' };
const TIP_LG = { other: '주차장·공공시설처럼 상가도 집도 아닌 층', nodata: '건축물대장에 층별 쓰임 자료가 없는 층', unknown: '사무실·의원·학원 등 가게 여부를 상가정보로 가릴 수 없는 층' };

// ── 탭 ───────────────────────────────────────────────
const tabs = document.createElement('nav'); tabs.id = 'tabs'; tabs.setAttribute('aria-label', '보기 범위');
tabs.innerHTML = `<button data-id="" aria-pressed="false"><span>상권 전체</span><small>옥포1·2동 일대</small></button>` +
  ST.map(s => `<button data-id="${s.id}" aria-pressed="false"><span>${esc(s.ko.split(' (')[0])}</span><small>${s.len.toLocaleString('ko-KR')}m, 건물 ${s.slots.length}채</small></button>`).join('');
(document.getElementById('r-where') || document.body).appendChild(tabs);
const panel = document.createElement('aside'); panel.id = 'street'; panel.hidden = true; panel.setAttribute('aria-live', 'polite');
(document.getElementById('r-now') || document.body).appendChild(panel);
// 구간 설명(맨 아래 '구간:' 줄). 빛의 거리는 거제시가 정한 공식 구간
const FROM = { light: '거제시가 정한 「빛의 거리」 "옥포(국민은행~수협 일원)", 거제저널 2024-11-22, 오마이뉴스 2025-12-09' };

// 거리 띠(땅 위 옅은 노란 길)
let band = null;
// 거리 강조: 노면 전체 노랑 띠(길 폭) + 양쪽 가장자리선 + 시작·끝 표지 + 거리 이름표 + 길가 건물 윤곽선
const END_NAMES = { light: ['KB국민은행', '수협'] };   // 빛의 거리 공식 구간 "국민은행~수협"(거제저널 2024-11-22)
let streetLabels = [], rankLabels = [];   // rankLabels: 자리 순위 번호(지도 건물 위)
function smooth(p) {
  let q = p.map(v => v.slice());
  for (let k = 0; k < 3; k++) { const r = [q[0]]; for (let i = 0; i < q.length - 1; i++) { const [ax, az] = q[i], [bx, bz] = q[i + 1];
    r.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]); } r.push(q[q.length - 1]); q = r; }
  return q;
}
// 거리 선을 실제 도로에 붙인다: 가게 위치로 만든 중심선은 도로와 조금 어긋나고 휘므로,
// 4m 간격 점마다 18m 안에서 방향이 비슷한(±30°) 차도 선분 위 가장 가까운 점으로 옮긴다(주차장 통로·보행로 제외). 못 찾으면 원래 점
const ROADSEG = (() => {
  const out = [], RD = (window.MAP_DATA && window.MAP_DATA.roads) || [];
  for (const r of RD) { if (r.ped || r.k === 'service' || r.k === 'footway' || r.k === 'path' || r.k === 'steps') continue;
    for (let i = 0; i < r.p.length - 1; i++) out.push([r.p[i][0], r.p[i][1], r.p[i + 1][0], r.p[i + 1][1], r.w || 6, r.n || '']); }
  return out;
})();
// 가장 가까운 선분 위 점(방향 ±30° 안, 거리 maxD 안). name 을 주면 그 이름 도로만
function nearestOnRoad(x, z, dx, dz, maxD, name) {
  let best = null, bd = maxD;
  for (const [x0, z0, x1, z1, w, n] of ROADSEG) {
    if (name && n !== name) continue;
    const sx = x1 - x0, sz = z1 - z0, L = Math.hypot(sx, sz); if (L < 0.5) continue;
    if (Math.abs((sx * dx + sz * dz) / L) < 0.866) continue;   // 방향이 30° 넘게 다르면 다른 길
    const t = Math.max(0, Math.min(1, ((x - x0) * sx + (z - z0) * sz) / (L * L))), px = x0 + sx * t, pz = z0 + sz * t, d = Math.hypot(x - px, z - pz);
    if (d < bd) { bd = d; best = [px, pz, w]; }
  }
  return best;
}
function resample(q, step) {
  const out = [q[0].slice()]; let carry = 0;
  for (let i = 0; i < q.length - 1; i++) {
    const [ax, az] = q[i], [bx, bz] = q[i + 1], L = Math.hypot(bx - ax, bz - az); let d = step - carry;
    while (d <= L) { const t = d / L; out.push([ax + (bx - ax) * t, az + (bz - az) * t]); d += step; }
    carry = L - (d - step);
  }
  out.push(q[q.length - 1].slice()); return out;
}
// 1순위: 거리 이름과 같은 이름의 도로(40m 안) — 가게 몇 곳이 길에서 떨어져 있어 중심선이 휘어도 실제 도로로 돌아온다
// 2순위: 이름 없는 차도(18m 안). 둘 다 없으면 원래 점
function snapToRoad(q, name) {
  const P = resample(q, 4), res = [], widths = [];
  for (let i = 0; i < P.length; i++) {
    const a = P[Math.max(0, i - 2)], b = P[Math.min(P.length - 1, i + 2)], dl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, dx = (b[0] - a[0]) / dl, dz = (b[1] - a[1]) / dl;
    const best = nearestOnRoad(P[i][0], P[i][1], dx, dz, 40, name) || nearestOnRoad(P[i][0], P[i][1], dx, dz, 18, null);
    if (best) { res.push([best[0], best[1]]); widths.push(best[2]); } else res.push(null);
  }
  // 도로에 못 붙은 점: 대부분이 붙었으면 빼서(앞뒤 붙은 점끼리 곧게 이어짐) 도로 밖으로 꺾이지 않게, 거의 못 붙었으면 원래 점
  const hitR = widths.length / P.length;
  for (let i = 0; i < res.length; i++) if (!res[i] && hitR < 0.5) res[i] = P[i];
  for (let i = res.length - 1; i >= 0; i--) if (!res[i]) res.splice(i, 1);
  // 교차로에서 옆 도로로 튀었다 돌아오며 뒤로 가는 점은 뺀다(가장자리선이 꼬이지 않게): 바로 앞 진행 방향과 반대(내적<0)이거나 1.5m 안
  const fw = [res[0]];
  for (let i = 1; i < res.length; i++) {
    const p = res[i], a = fw[fw.length - 1], b = fw.length > 1 ? fw[fw.length - 2] : null, vx = p[0] - a[0], vz = p[1] - a[1];
    if (Math.hypot(vx, vz) < 1.5) continue;
    if (b && vx * (a[0] - b[0]) + vz * (a[1] - b[1]) < 0) continue;
    fw.push(p);
  }
  // 도로 꺾임을 살리되 들쭉날쭉한 것만 가볍게(이동평균 5점)
  const sm = fw.map((_, i) => { let x = 0, z = 0, n = 0; for (let k = -2; k <= 2; k++) { const r = fw[i + k]; if (r) { x += r[0]; z += r[1]; n++; } } return [x / n, z / n]; });
  widths.sort((a, b) => a - b);
  return { q: sm, w: widths.length ? widths[Math.floor(widths.length / 2)] : 12, hit: hitR };
}
// 지형이 켜지면 선을 8m 이하 조각으로 나눈다(꼭짓점마다 땅 높이를 얹으므로 긴 조각은 볼록한 비탈에서 땅 밑으로 들어감)
function densify(q, step = 8) {
  if (!M.TON) return q; const o = [q[0]];
  for (let i = 0; i < q.length - 1; i++) { const [ax, az] = q[i], [bx, bz] = q[i + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 1; k <= n; k++) o.push([ax + (bx - ax) * k / n, az + (bz - az) * k / n]); }
  return o;
}
function laneStrip(q, half, off, y, out) {   // 선을 따라 [off-half, off+half] 너비의 띠
  q = densify(q);
  for (let i = 0; i < q.length - 1; i++) {
    const [ax, az] = q[i], [bx, bz] = q[i + 1], dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l;
    const a0 = off - half, a1 = off + half;
    out.push(ax + nx * a1, y, az + nz * a1, bx + nx * a1, y, bz + nz * a1, ax + nx * a0, y, az + nz * a0,
             ax + nx * a0, y, az + nz * a0, bx + nx * a1, y, bz + nz * a1, bx + nx * a0, y, bz + nz * a0);
  }
}
function meshOf(pos, color, opacity, order) {
  if (M.TON) for (let i = 0; i < pos.length; i += 3) pos[i + 1] += M.hAt(pos[i], pos[i + 2]) + M.GL;   // 지형 켜지면 꼭짓점마다 땅 높이 + 바닥층 위
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide }));
  m.renderOrder = order; return m;
}
function addLabel(text, cls, x, y, z) {
  const el = document.createElement('div'); el.className = 'lbl place ' + cls; el.textContent = text;
  document.getElementById('labels').appendChild(el);
  const L = { el, x, y, z, pri: 11, kind: 'place', w: 0, h: 0 }; M.labels.unshift(L); streetLabels.push(L);
}
function clearRank() { for (const L of rankLabels) { L.el.remove(); const i = M.labels.indexOf(L); if (i >= 0) M.labels.splice(i, 1); } rankLabels = []; }
// 순위 번호를 건물 지붕 위에(표의 순위와 같은 숫자, '비슷함'이면 같은 번호). 누르면 그 건물로
function rankLabel(x) { const b = B[x.b]; if (!b) return; let cx = 0, cz = 0; for (const q of b.p) { cx += q[0]; cz += q[1]; } cx /= b.p.length; cz /= b.p.length;
  const el = document.createElement('div'); el.className = 'lbl place rk-n'; el.textContent = x.tag || x.grp + '위'; el.title = x.tip || `${x.floor}층 · 평일 하루 ${Math.round(x.r.wd)}명`; el.onclick = () => flyBuilding(x.b);
  document.getElementById('labels').appendChild(el);
  const L = { el, x: cx, y: (b.b || 0) + b.h + 4, z: cz, pri: 14, kind: 'place', w: 0, h: 0, abs: true, nudge: true }; M.labels.unshift(L); rankLabels.push(L); }   // nudge: 붙은 건물끼리 번호가 겹치면 숨기지 않고 아래로 비킴
// 순위 건물이 모두 화면에 들어오게 카메라를 맞춤(가운데 = 건물들 평균, 거리 = 가장 먼 건물까지에 비례, flyBuilding 과 같은 방향)
function fitRank(res) { const P = res.map(x => B[x.b]).filter(Boolean).map(b => { let x = 0, z = 0; for (const q of b.p) { x += q[0]; z += q[1]; } return [x / b.p.length, z / b.p.length, (b.b || 0) + b.h]; });
  if (!P.length) return; const cx = P.reduce((a, p) => a + p[0], 0) / P.length, cz = P.reduce((a, p) => a + p[1], 0) / P.length;
  const R = Math.max(40, ...P.map(p => Math.hypot(p[0] - cx, p[1] - cz))), k = R / 42, g = M.hAt(cx, cz);
  fly(new THREE.Vector3(cx, g, cz), new THREE.Vector3(cx + 60 * k, g + 80 * k, cz + 95 * k), 800); }
function clearLabels() {
  for (const L of streetLabels) { L.el.remove(); const i = M.labels.indexOf(L); if (i >= 0) M.labels.splice(i, 1); }
  streetLabels = [];
}
function drawBand(s) {
  if (band) { scene.remove(band); band.traverse(o => o.geometry && o.geometry.dispose()); band = null; }
  clearLabels();
  if (!s) return;
  const rn = (s.ko.match(/\(([^)]+)\)/) || [0, s.ko])[1].trim();   // '빛의 거리 (옥포대첩로)' → 옥포대첩로
  const sn = snapToRoad(smooth(s.p), rn), q = sn.q, half = Math.max(4.5, Math.min(9, sn.w / 2 + 1.5));   // 도로 폭 + 양쪽 인도 조금
  s.snapHit = sn.hit; s.pRoad = q;
  band = new THREE.Group();
  const fill = [], edge = [];
  // 노면은 아주 옅게만(아스팔트·횡단보도가 보이게 — 진하게 덮으면 흙길처럼 탁해짐), 구간은 양쪽 노란 선으로 또렷하게
  const glow = [];
  laneStrip(q, half, 0, 0.07, fill);                                                   // 노면(실제 도로 폭)
  laneStrip(q, 1.1, half - 0.9, 0.08, glow); laneStrip(q, 1.1, -half + 0.9, 0.08, glow);   // 선 안쪽 번짐
  laneStrip(q, 0.55, half + 0.1, 0.09, edge); laneStrip(q, 0.55, -half - 0.1, 0.09, edge);   // 양쪽 가장자리선
  band.add(meshOf(fill, '#ffe066', 0.12, 9.3), meshOf(glow, '#ffd43b', 0.3, 9.35), meshOf(edge, '#fcc419', 1, 9.65));
  // 시작·끝 표지: 원판 + 이름표
  const ends = [q[0], q[q.length - 1]], names = END_NAMES[s.id];
  const mid = q[Math.floor(q.length / 2)];
  ends.forEach((e, k) => {
    const disc = new THREE.Mesh(new THREE.CircleGeometry(4.2, 28), new THREE.MeshBasicMaterial({ color: '#212529', depthWrite: false }));
    disc.rotation.x = -Math.PI / 2; disc.position.set(e[0], 0.1 + M.GL + M.hAt(e[0], e[1]), e[1]); disc.renderOrder = 9.7; band.add(disc);
    const ring = new THREE.Mesh(new THREE.RingGeometry(4.2, 5.4, 28), new THREE.MeshBasicMaterial({ color: '#ffd43b', depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(e[0], 0.11 + M.GL + M.hAt(e[0], e[1]), e[1]); ring.renderOrder = 9.7; band.add(ring);
    const dir = (() => { const dx = e[0] - mid[0], dz = e[1] - mid[1]; return Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? '동쪽' : '서쪽') : (dz > 0 ? '남쪽' : '북쪽'); })();
    addLabel(names ? `${k ? '끝' : '시작'} · ${names[k]}` : `${dir} 끝`, 'street-end', e[0], 3, e[1]);
  });
  addLabel(`${s.ko.split(' (')[0]} · ${s.len}m`, 'street-name', mid[0], 18, mid[1]);
  // 길가 건물 윤곽선
  const lp = [];
  for (const x of s.slots) { const b = B[x.b]; if (!b) continue; const y1 = (b.b || 0) + b.h + 0.08;
    for (let i = 0; i < b.p.length; i++) { const a = b.p[i], c = b.p[(i + 1) % b.p.length]; lp.push(a[0], y1, a[1], c[0], y1, c[1], a[0], y1, a[1], a[0], (b.b || 0) + 0.1, a[1]); } }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  const lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: '#3b3f45', transparent: true, opacity: 0.7 })); lines.renderOrder = 12;
  band.add(lines);
  band.children.forEach(m => { m.frustumCulled = false; });
  scene.add(band);
}
// 카메라 옮기기. 목표 둘레의 구면 좌표(거리·높이각·방위)로 섞어 곡선으로 날아간다(직선 섞기는 가까워질 때 화면이 쏠림).
// 새 비행이 시작되면 앞 비행은 멈춘다(flyTok). onEnd(완료 true/끊김 false)
let flyTok = 0;
const ease3 = (k) => k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
function fly(toT, toC, dur = 900, onEnd) {
  const cam = M.camera, ctl = M.controls, t0 = performance.now(), fT = ctl.target.clone(), tok = ++flyTok;
  const s0 = new THREE.Spherical().setFromVector3(cam.position.clone().sub(fT)), s1 = new THREE.Spherical().setFromVector3(toC.clone().sub(toT));
  let dth = s1.theta - s0.theta; dth = Math.atan2(Math.sin(dth), Math.cos(dth));   // 짧은 쪽으로 돌기
  const sp = new THREE.Spherical(), tt = new THREE.Vector3();
  (function f(now) {
    if (tok !== flyTok) { onEnd && onEnd(false); return; }
    const k = Math.min(1, (now - t0) / dur), e = dur > 1500 ? ease3(k) : (k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
    tt.lerpVectors(fT, toT, e);
    sp.set(s0.radius * Math.pow(s1.radius / s0.radius, e), s0.phi + (s1.phi - s0.phi) * e, s0.theta + dth * e);
    cam.position.setFromSpherical(sp).add(tt); ctl.target.copy(tt); ctl.update(); need();
    if (k < 1) requestAnimationFrame(f); else onEnd && onEnd(true);
  })(t0);
}
function streetPose(s) {
  const p = s.p, a = p[0], b = p[p.length - 1], mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l;
  const side = nz > 0 ? 1 : -1;   // 남쪽에서 북쪽을 보게(화면 위가 북쪽 쪽)
  const D = Math.max(200, s.len * 0.68), g = M.hAt(mx, mz);
  return { t: new THREE.Vector3(mx, g, mz), c: new THREE.Vector3(mx + nx * side * D * 0.9, g + D * 0.72, mz + nz * side * D * 0.9) };
}
function flyStreet(s, dur, onEnd) { const P = streetPose(s); fly(P.t, P.c, dur, onEnd); }
function flyBuilding(bi) {
  const b = B[bi]; let x = 0, z = 0; for (const q of b.p) { x += q[0]; z += q[1]; } x /= b.p.length; z /= b.p.length;
  const g = M.hAt(x, z); fly(new THREE.Vector3(x, g, z), new THREE.Vector3(x + 60, g + 55 + b.h, z + 95), 700); M.select(bi);
}

// ── 패널 ─────────────────────────────────────────────
let cur = null, flowCache = {};
// 거리 입면도: 길 양쪽 건물을 층수만큼 쌓아 층마다 상태 색(건물 전체를 본다)
function strip(s) {
  const W = 300, pad = 2, L = s.len, X = (v) => pad + v / L * (W - pad * 2), FH = 6;
  const maxLv = Math.min(10, Math.max(3, ...s.slots.map(x => Math.min(10, x.lv || 1))));
  const half = maxLv * FH + 4, mid = half + 16, H = mid + half + 14;
  const cell = (x, side) => {
    const w = Math.max(2, X(x.s1) - X(x.s0) - 1), lv = Math.min(10, x.lv || 1), byN = {};
    for (const f of x.fl) byN[f[0]] = f;
    let r = '';
    for (let n = 1; n <= lv; n++) {
      const f = byN[n], st = f ? f[1] : (n === 1 ? x.st : 'nodata');
      const y = side === 'L' ? mid - 8 - n * FH : mid + 8 + (n - 1) * FH;
      const tip = `${n}층 · ${KO[st] || ''}${f && f[3] ? ' · ' + f[3] : ''}${f && f[4].length ? ' · ' + f[4].join(', ') : ''}`;
      r += `<rect x="${X(x.s0).toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="${FH - 0.8}" fill="${COL[st] || '#eee'}"${st === 'nodata' || !COL[st] ? ' stroke="#adb5bd" stroke-width="0.5"' : ''} data-b="${x.b}"><title>${esc(tip)}</title></rect>`;
    }
    return r;
  };
  const lab = (sd) => { const oddL = s.sideCheck.oddLeft; return (sd === 'L') === oddL ? '홀수 번지' : '짝수 번지'; };
  return `<svg class="strip" viewBox="0 0 ${W} ${H}" role="img" aria-label="거리 양쪽 건물 층별 입면도">
    <text x="2" y="9" class="t">${lab('L')} 쪽 ↑ 위층</text>
    ${s.slots.filter(x => x.side === 'L').map(x => cell(x, 'L')).join('')}
    <line x1="${pad}" x2="${W - pad}" y1="${mid}" y2="${mid}" stroke="#ffe066" stroke-width="9" stroke-linecap="round"/>
    <text x="${W / 2}" y="${mid + 3}" class="t" text-anchor="middle">${esc(s.ko.split(' (')[0])} ${L}m</text>
    ${s.slots.filter(x => x.side === 'R').map(x => cell(x, 'R')).join('')}
    <text x="2" y="${H - 2}" class="t">${lab('R')} 쪽 ↓ 위층</text></svg>`;
}
const nEmptyB = (s) => new Set(s.slots.filter(x => x.fl.some(f => f[1] === 'empty')).map(x => x.b)).size;
function render(s) {
  const c = s.count, w = s.whole;
  panel.innerHTML = `
    <div class="st-head"><h2>${esc(s.ko)}</h2><button class="icon-btn" id="st-close" aria-label="상권 전체로" title="상권 전체로"><svg viewBox="0 0 20 20"><path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button></div>
    <p class="st-line"><b>${s.len.toLocaleString('ko-KR')}m</b> 거리에 길가 건물 <b>${s.slots.length}채</b>.<br>상가 층 ${w.floors}개 가운데 <mark>${w.empty}개</mark>에 가게가 없습니다.${w.empty_area_pct != null ? ` 면적으로는 ${w.empty_area_pct}%입니다.` : ''}</p>
    <p class="st-sub">길 양쪽 건물을 층마다 <span class="lgd">${['open', 'empty', 'unknown', 'home', 'other', 'nodata'].map(k => `<span class="lg-it"${TIP_LG[k] ? ` title="${TIP_LG[k]}"` : ''}><i style="background:${COL[k]}${k === 'nodata' ? ';box-shadow:inset 0 0 0 1px #adb5bd' : ''}"></i>${KO_LG[k]}</span>`).join(' ')}</span></p>
    ${strip(s)}
    <p class="st-tip">칸을 누르면 그 건물로 갑니다. ${c.empty < w.empty ? `1층만 보면 빈 곳은 ${c.empty}곳뿐이라, 위층까지 봐야 실제 모습이 보입니다.` : `1층만 보면 빈 곳은 ${c.empty}곳입니다.`}</p>
    <details class="st-how"><summary>어떻게 셌나요</summary><p>건축물대장 층별개요로 층마다 쓰임을 알아내고, 2026년 9월 상가정보에 그 층 가게가 있는지 맞춰 봤습니다. 상가 층 ${w.floors}개 중 영업 ${w.open}, 가게 없음 ${w.empty}, 확인 불가 ${w.unknown}입니다. ‘확인 불가’는 사무실·의원·학원처럼 가게인지 상가정보로 가릴 수 없는 층, ‘기타’는 주차장·공공시설처럼 상가도 집도 아닌 층, ‘자료 없음’은 건축물대장에 층별 쓰임 자료가 없는 층입니다. 길 왼쪽·오른쪽은 주소 건물번호 홀짝으로 나눴습니다(위치로 나눈 것과 ${s.sideCheck.known}곳 중 ${s.sideCheck.agree}곳 같음${s.sideCheck.fixed ? `, 다른 ${s.sideCheck.fixed}곳은 주소를 따름` : ''}).</p></details>
    <p class="st-sub">이 거리를 지나간 가상 손님 <span class="lgd" id="fl-lg"></span></p>
    <div id="st-flow"><p class="exp-wait">계산 중…</p></div>
    <p class="st-sub">어느 빈 층에 열면 손님이 많을까</p>
    <div class="st-rank">
      <select id="rk-cat" aria-label="업종">${SIM.subOptions ? SIM.subOptions('viet') : ''}</select>
      <div class="rk-hours"><label>여는 시각<select id="rk-open"></select></label><label>닫는 시각<select id="rk-close"></select></label></div>
      <button class="btn-primary btn-main" id="rk-run">빈 층이 있는 ${nEmptyB(s)}채에 가게 열어 보기</button>
    </div>
    <div id="rk-out"></div>
    <p class="st-from">구간: ${esc(FROM[s.id] || s.note)}</p>`;
  document.getElementById('st-close').onclick = () => choose('');
  panel.querySelectorAll('rect[data-b]').forEach(r => { r.onclick = () => flyBuilding(+r.dataset.b); r.onkeydown = (e) => { if (e.key === 'Enter') flyBuilding(+r.dataset.b); }; });
  // 건물마다 가장 낮은 빈 층 하나(같은 건물 위층은 위치가 같아 결과도 같음)
  document.getElementById('rk-run').onclick = () => rank(s, s.slots.map(x => { const f = x.fl.filter(f => f[1] === 'empty').sort((a, c) => a[0] - c[0])[0]; return f ? { ...x, floor: f[0], area: f[2] } : null; }).filter(Boolean), '건물마다 가장 낮은 빈 층');
  // 주 버튼에 고른 업종을 넣어 누르기 전에 무엇을 하는지 알 수 있게: '빈 층이 있는 7채에 베트남 음식점 열어 보기'
  const sel = document.getElementById('rk-cat'), runLabel = () => { const sb = SIM && SIM.SUB[sel.value];
    document.getElementById('rk-run').textContent = `${nEmptyB(s)}채의 빈 층에 열어 보기`; };   // 업종은 바로 위 선택 칸에 보임(버튼은 한 줄로)
  // 내 가게 영업시간: 업종을 바꾸면 그 업종 값으로 채우고, 직접 바꿔서 순위를 낼 수 있게
  const rkH = () => { if (SIM && SIM.fillHours) SIM.fillHours(document.getElementById('rk-open'), document.getElementById('rk-close'), sel.value); };
  sel.addEventListener('change', runLabel); sel.addEventListener('change', rkH); runLabel(); rkH();
  if (!w.empty) document.getElementById('rk-run').disabled = true;
  setTimeout(() => flow(s), 60);
}
function flow(s) {
  if (!SIM) { document.getElementById('st-flow').innerHTML = ''; return; }
  const key = s.id + ':' + SIM.cfgVer;   // 시간 정하기를 바꾸면 다시 계산
  if (!flowCache[key]) {
    const set = SIM.nodesNear(s.pRoad || s.p, 14);   // 실제 도로에 붙인 선(drawBand 에서 만듦) 기준
    flowCache[key] = { wd: SIM.flowDay(false, set), we: SIM.flowDay(true, set) };
    SIM.restore();
  }
  if (cur !== s) return;
  const f = flowCache[key], G = SIM.GROUPS, cfg = SIM.CFG.groups;
  const mx = Math.max(1, ...f.wd.hour, ...f.we.hour);
  const bars = (h, col) => h.map((v, i) => `<i style="height:${Math.round(100 * v / mx)}%;background:${col}" title="${i}시 ${Math.round(v)}명"></i>`).join('');
  const mix = (o, tot) => G.filter(g => o[g] > 0.5).map(g => `<span><i style="background:${cfg[g].col}"></i>${cfg[g].ko} ${Math.round(100 * o[g] / (tot || 1))}%</span>`).join('');
  document.getElementById('fl-lg').innerHTML = '<i style="background:#1c64f2"></i>평일 <i style="background:#7048e8"></i>주말';
  document.getElementById('st-flow').innerHTML = `
    <div class="st-kpi two"><div><b>${Math.round(f.wd.tot).toLocaleString('ko-KR')}명</b><span>평일 하루</span></div><div><b>${Math.round(f.we.tot).toLocaleString('ko-KR')}명</b><span>주말 하루</span></div></div>
    <div class="exp-hours"><div>${bars(f.wd.hour, '#1c64f2')}</div><div>${bars(f.we.hour, '#7048e8')}</div><div class="ax"><span>0시</span><span>6시</span><span>12시</span><span>18시</span><span>23시</span></div></div>
    <p class="exp-nb">${SIM.peakTxt ? SIM.peakTxt(f.wd.hour, '평일') + ' · ' + SIM.peakTxt(f.we.hour, '주말') : ''}</p>
    <div class="exp-mix"><b>평일</b> ${mix(f.wd.grp, f.wd.tot)}</div><div class="exp-mix"><b>주말</b> ${mix(f.we.grp, f.we.tot)}</div>
    <p class="st-tip">가상 인물이 이 길(중심선 14m 안)을 지나간 횟수입니다. 실제 유동인구가 아닙니다. 사람 수·교대 시간은 '자료와 가정 보기'(재생 막대를 펼치면 보입니다)를 따릅니다.</p>`;
}
// 자리 순위: owner = 이 계산을 시작한 화면(거리 또는 빈 1층 목록 LIST). 다른 화면으로 바뀌면(cur !== owner) 멈춘다.
// slots = [{ b, floor, area, where?(자리 설명, 없으면 거리 왼쪽·오른쪽 위치), side, s }], pick = 각주에 쓸 '어느 자리를 골랐나'
function rank(s, slots, pick) {
  const sub = document.getElementById('rk-cat').value, cfg = SIM.SUB[sub];   // 세부 업종 기본값(대표 메뉴 1인 지출·자리)
  const hrs = SIM.readHours(document.getElementById('rk-open'), document.getElementById('rk-close'));   // 내 가게 영업시간
  const out = document.getElementById('rk-out'), btn = document.getElementById('rk-run');
  btn.disabled = true; const res = []; let i = 0; const t0 = performance.now(); clearRank(); need();
  out.innerHTML = `<p class="exp-wait">빈 층이 있는 ${slots.length}채에 차례로 가게를 열어 하루씩 돌려 보는 중입니다(평일·주말 3번씩).</p><div class="prog"><i style="width:0%"></i></div><p class="exp-wait" id="rk-p">0 / ${slots.length}</p>`;
  out.scrollIntoView({ behavior: 'smooth', block: 'start' });   // 결과 자리가 기록지 아래 화면 밖이라 누른 사람이 진행을 못 봤음
  function next() {
    if (cur !== s) return;
    if (i >= slots.length) {
      SIM.restore(); btn.disabled = false;
      res.sort((a, b) => (b.r.wd + b.r.we) - (a.r.wd + a.r.we));
      // 시드별 (평일+주말) 범위가 묶음 첫 자리의 범위와 겹치면 같은 순위로 묶는다('비슷함') — 돌릴 때마다 생기는 차이 안이면 순서를 매기지 않음
      const tot = (x) => x.r.wdRuns.map((v, k) => v + x.r.weRuns[k]);
      let lead = null, grp = 0;
      res.forEach((x, k) => { const t = tot(x); x.lo = Math.min(...t); x.hi = Math.max(...t);
        if (!lead || x.hi < lead.lo) { lead = x; grp = k + 1; lead.n = 0; } x.grp = grp; lead.n++; x.lead = lead; });
      const rng = (a) => `<br><small class="th-u">${Math.round(Math.min(...a))}~${Math.round(Math.max(...a))}</small>`;
      out.innerHTML = `<table class="exp-cmp rk"><tr><th>순위</th><th>자리</th><th>평일<br><small class="th-u">하루</small></th><th>주말<br><small class="th-u">하루</small></th><th>평일 매출<br><small class="th-u">하루</small></th></tr>${res.map((x, k) => `<tr data-b="${x.b}"><td>${x.grp}${x.lead.n > 1 ? '<br><small class="th-u">비슷함</small>' : ''}</td><td>${x.where ? esc(x.where) : `${x.floor}층 · ${x.side === 'L' ? '왼쪽' : '오른쪽'} ${Math.round(x.s)}m`}${x.area ? ` · <span class="nw">${Math.round(x.area)}㎡</span>` : ''}</td><td>${Math.round(x.r.wd)}명${rng(x.r.wdRuns)}</td><td>${Math.round(x.r.we)}명${rng(x.r.weRuns)}</td><td>${SIM.won(x.r.wdWon)}</td></tr>`).join('')}</table>
        <p class="exp-nb">${SIM.demandTxt ? SIM.demandTxt(sub, hrs) : ''} 지도 건물 위 번호가 이 순위입니다.</p>
        <p class="exp-foot">${esc(document.getElementById('rk-cat').selectedOptions[0].textContent)} · 영업 ${SIM.hoursTxt(hrs)} · 1인 ${SIM.wonX(cfg.basket)}(대표 메뉴 기준) · ${esc(pick)}, 평일·주말 3번씩 평균과 범위(사람 1:1), 범위가 겹치면 같은 순위('비슷함'), 2층 이상은 덜 고르고 앞을 지나는 사람이 많을수록 더 고르는 것(가정 β=${SIM.passby.beta})을 반영 · 계산 ${((performance.now() - t0) / 1000).toFixed(1)}초. 행을 누르면 그 건물로 가서 자세히 실험할 수 있습니다. 가상 인물로 자리끼리 비교한 값입니다.</p>`;
      out.querySelectorAll('tr[data-b]').forEach(tr => tr.onclick = () => flyBuilding(+tr.dataset.b));
      res.slice().reverse().forEach(rankLabel); fitRank(res);   // 거꾸로 넣어야(unshift) 1위가 먼저 자리를 잡음
      out.scrollIntoView({ behavior: 'smooth', block: 'start' });   // 끝나면 결과 맨 위로, 지도엔 순위 번호
      need(); return;
    }
    const x = slots[i++];
    res.push({ ...x, r: SIM.trySlot(x.b, x.floor, sub, cfg.basket, cfg.seats, 3, hrs) });
    out.querySelector('.prog i').style.width = (100 * i / slots.length) + '%'; document.getElementById('rk-p').textContent = `${i} / ${slots.length}`;
    setTimeout(next, 0);
  }
  setTimeout(next, 30);
}

// ── 빈 1층 자리 목록(상권 전체) ───────────────────────────
// 상권 전체 카드의 '빈 1층에 가게 열어 보기'를 누르면 이 패널에 상권(R-ONE 경계) 안 가게 없는 1층 목록을 연다.
// 예전엔 누를 때마다 넓은 순으로 한 곳씩 날아가기만 해서(1 / 271…) 후보 전체를 보거나 고를 수 없었다.
// 정렬 값 '앞을 지나는 사람'은 sim.js 가 처음에 한 번 계산해 둔 길 흐름(frontFlow, 평일)이라 즉시 나온다.
// 하루 시뮬은 무거우므로(271곳이면 하루 1,600번 넘게) 목록 위 10곳만 '순위 내기'로 돌린다.
const LIST = { id: '__list' };   // cur 에 넣어 다른 화면으로 바뀌면 순위 계산이 멈추게
const LS = { sort: 'flow', st: '', area: 0, upper: false, n: 30, sel: [] };   // sel: 열어 볼 자리로 고른 건물 번호(최대 SEL_MAX, 고른 순서)
const SEL_MAX = 10;
const ON_ST = new Map(); for (const s of ST) for (const x of s.slots) if (!ON_ST.has(x.b)) ON_ST.set(x.b, s);
// 이름: 건물 이름이 '제1호'·'2동'처럼 번호뿐이면 찾기 어려우니 지번을 먼저
const bNameOf = (b) => { const nm = [b.n, b.dn].find(v => v && !/^제?\s*\d+\s*(호|동)?$/.test(v)); return nm || (b.jibun ? b.jibun.replace('거제시 ', '') : b.n || (b.ko === '건물' ? '이름 없는 건물' : b.ko || '건물')); };
let CAND = null;
// 후보: 상권 경계 안 건물(B[].i) 중 가게 없는 1층(위층 포함이면 건물마다 가장 낮은 빈 층)
function candidates() {
  if (CAND) return CAND;
  const F = window.FLOORS, P = SIM && SIM._pass, out = [];
  const keys = Object.keys((F && F.b) || {}).map(Number).filter(bi => B[bi] && B[bi].i);
  for (const bi of (window.__floors && window.__floors.sameLot ? window.__floors.sameLot(keys) : keys)) {   // 같은 지번 그림 여럿 → 한 곳
    const k = String(bi), b = B[bi];
    const emp = F.b[k].filter(f => f.state === 'empty').sort((a, c) => a.n - c.n); if (!emp.length) continue;
    let x = 0, z = 0; for (const q of b.p) { x += q[0]; z += q[1]; } x /= b.p.length; z /= b.p.length;
    const st = ON_ST.get(bi);
    out.push({ b: bi, floor: emp[0].n, area: emp[0].area || 0, x, z, first: emp[0].n === 1, nEmpty: emp.length,
      flow: P && P.PASSF[0] ? P.frontFlow(0, x, z) : null, st, name: bNameOf(b) });
  }
  return (CAND = out);
}
function sameNear(sub, x, z, R = 250) { let n = 0; for (const s of SIM._shops()) if (!s.virtual && s.sub === sub && Math.hypot(s.x - x, s.z - z) <= R) n++; return n; }
function listNow() {
  const t = M.controls.target, sub = document.getElementById('rk-cat')?.value;
  let L = candidates().filter(c => (LS.upper || c.first) && (!LS.st || (c.st && c.st.id === LS.st)) && c.area >= LS.area);
  for (const c of L) { c.same = sub ? sameNear(sub, c.x, c.z) : null; c.d = Math.hypot(c.x - t.x, c.z - t.z); }
  const by = { flow: (a, b) => (b.flow || 0) - (a.flow || 0), area: (a, b) => b.area - a.area, near: (a, b) => a.d - b.d }[LS.sort];
  return L.sort(by);
}
// 지도 번호: 지금 목록 위 10곳(순위를 내면 rank 결과 번호로 바뀜)
// 지도 번호: 고른 자리가 있으면 그 자리만(목록 번호), 없으면 목록 위 10곳
function listLabels(L) {
  clearRank();
  const no = new Map(L.map((c, k) => [c.b, k + 1])), pick = LS.sel.length ? L.filter(c => LS.sel.includes(c.b)) : L.slice(0, 10);
  pick.slice().reverse().forEach(c => { const k = no.get(c.b); rankLabel({ b: c.b, grp: k, floor: c.floor, r: null, tag: `${k}`, tip: `${c.floor}층 · ${c.name}` }); });
  need();
}
// 고른 자리 수에 맞춰 체크 칸 잠금·버튼 문구·설명을 바꾼다(목록을 다시 그리지 않고)
function selSync() {
  const n = LS.sel.length, subKo = (SIM.SUB[document.getElementById('rk-cat').value] || {}).ko || '';
  document.querySelectorAll('#ls-t input[data-sel]').forEach(i => { i.checked = LS.sel.includes(+i.dataset.sel); i.disabled = !i.checked && n >= SEL_MAX; });
  document.getElementById('rk-why').innerHTML = n
    ? `고른 <b>${n}곳</b>(최대 ${SEL_MAX}곳)에 ${esc(subKo)} 가게를 열어 평일·주말 하루씩 돌려 보고, 가상 손님이 많은 순으로 매깁니다. <button type="button" class="link" id="ls-clear">고른 것 지우기</button>`
    : `목록 왼쪽 네모를 눌러 열어 볼 자리를 최대 ${SEL_MAX}곳까지 고르세요.`;
  const c = document.getElementById('ls-clear'); if (c) c.onclick = () => { LS.sel = []; listTable(); };
  const btn = document.getElementById('rk-run'); btn.disabled = !n; btn.textContent = n ? `고른 ${n}곳에 열어 손님 순위 보기` : '열어 볼 자리를 고르세요';
}
// 숫자 이름에 마우스를 올리면 뜨는 도움말(단위·범위)
const TIP_FLOW = '평일 하루, 가상 시민이 이 건물 앞 길(40m 안 가장 붐비는 곳)을 지나간 횟수. 실제 유동인구가 아닙니다.';
function listTable() {
  const L = listNow(), sub = document.getElementById('rk-cat').value, subKo = SIM.SUB[sub] ? SIM.SUB[sub].ko : '';
  const firstN = candidates().filter(c => c.first).length;
  panel.querySelector('h2').textContent = LS.upper ? '빈 층 자리 목록' : '빈 1층 자리 목록';
  document.getElementById('ls-n').innerHTML = `${LS.upper ? '빈 층이 있는 건물' : '가게 없는 1층'} <b>${L.length}곳</b>${L.length !== (LS.upper ? candidates().length : firstN) ? ` (조건에 맞는 곳)` : ''} · ${{ flow: '앞을 지나는 사람 많은 순', area: '넓은 순', near: '지금 보는 곳에서 가까운 순' }[LS.sort]}`;
  // 표 머리글은 짧게, 기준(평일 하루·250m 안)은 머리글 옆 작은 '?'에 마우스를 올리면 보이게
  const tipSame = esc(`고른 업종(${subKo})의 기존 가게가 이 건물에서 250m 안에 몇 곳 있는지. 경쟁 가게 수이며 빈 곳 수가 아닙니다.`);
  const rows = L.slice(0, LS.n).map((c, k) => `<tr data-b="${c.b}"><td><label class="ls-ck" title="열어 볼 자리로 고르기"><input type="checkbox" data-sel="${c.b}" aria-label="${k + 1}번 고르기"><span>${k + 1}</span></label></td><td>${c.floor}층 · ${esc(c.name)}${c.st ? `<br><small class="th-u">${esc(c.st.ko.split(' (')[0])}</small>` : ''}</td><td>${c.area ? `${Math.round(c.area)}㎡` : '-'}</td><td>${c.flow != null ? Math.round(c.flow).toLocaleString('ko-KR') + '명' : '-'}</td><td>${c.same != null ? c.same + '곳' : '-'}</td></tr>`).join('');
  document.getElementById('ls-t').innerHTML = `<tr><th></th><th>자리</th><th>면적</th><th><span class="ls-tip" tabindex="0" data-tip="${TIP_FLOW}">앞을 지나는 사람</span></th><th><span class="ls-tip" tabindex="0" data-tip="${tipSame}">근처 같은 업종</span></th></tr>${rows}`;
  document.getElementById('ls-t').querySelectorAll('tr[data-b]').forEach(tr => tr.onclick = (e) => { if (!e.target.closest('.ls-ck')) flyBuilding(+tr.dataset.b); });   // 체크 칸은 고르기만(날아가지 않음)
  document.getElementById('ls-t').querySelectorAll('input[data-sel]').forEach(i => i.onchange = () => { const b = +i.dataset.sel;
    LS.sel = i.checked ? (LS.sel.length < SEL_MAX && !LS.sel.includes(b) ? [...LS.sel, b] : LS.sel) : LS.sel.filter(x => x !== b);
    selSync(); listLabels(L); });
  const more = document.getElementById('ls-more'); more.hidden = L.length <= LS.n; more.textContent = `더 보기 (${L.length - LS.n}곳 더)`;
  selSync();
  document.getElementById('rk-out').innerHTML = '';
  listLabels(L);
  return L;
}
function openList() {
  if (!SIM || !window.FLOORS) return;
  cur = LIST; clearRank(); drawBand(null); M.tint(null); M.select(-1);
  tabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === '')));
  document.body.classList.remove('street-mode'); document.body.classList.add('list-mode');
  panel.innerHTML = `
    <div class="st-head"><h2>빈 1층 자리 목록</h2><button class="icon-btn" id="st-close" aria-label="목록 닫기" title="목록 닫기"><svg viewBox="0 0 20 20"><path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button></div>
    <p class="st-line">상권 안에서 가게가 없는 1층을 모았습니다. 줄을 누르면 그 건물로 가고, 왼쪽 네모로 최대 10곳을 골라 한꺼번에 열어 볼 수 있습니다.</p>
    <div class="ls-f">
      <label>정렬<select id="ls-sort"><option value="flow">앞을 지나는 사람 많은 순</option><option value="area">넓은 순</option><option value="near">지금 보는 곳에서 가까운 순</option></select></label>
      <label>거리<select id="ls-st"><option value="">상권 전체</option>${ST.map(s => `<option value="${s.id}">${esc(s.ko.split(' (')[0])}</option>`).join('')}</select></label>
      <label>면적<select id="ls-area"><option value="0">모두</option><option value="33">33㎡(10평) 이상</option><option value="66">66㎡(20평) 이상</option><option value="99">99㎡(30평) 이상</option><option value="165">165㎡(50평) 이상</option></select></label>
      <label class="ls-up"><input type="checkbox" id="ls-up"><span>위층도 넣기 <small>건물마다 가장 낮은 빈 층</small></span></label>
    </div>
    <p class="st-tip" id="ls-n"></p>
    <table class="exp-cmp rk ls" id="ls-t"></table>
    <button type="button" class="btn-sub" id="ls-more" hidden></button>
    <details class="st-how"><summary>어떻게 셌나요</summary><p>‘가게 없는 1층’은 건축물대장 층별개요의 상가 층 가운데 2026년 9월 상가정보에 그 층 가게가 없는 곳입니다. 사무실·창고로 쓰거나 등록이 늦은 가게도 들어 있을 수 있습니다. 면적은 그 층 면적입니다. ‘앞을 지나는 사람’은 가상 시민이 <b>평일 하루</b> 이 건물 앞 길(가장 가까운 길 지점에서 20m 더, 최대 40m 안의 가장 붐비는 곳)을 지나간 횟수로, 실제 유동인구가 아닙니다. ‘근처 같은 업종’은 아래에서 고른 업종의 기존 가게가 <b>250m 안</b>에 몇 곳 있는지(경쟁 가게 수)입니다. 지도 위 번호는 목록 번호입니다(고른 자리가 있으면 고른 자리만, 없으면 목록 위 10곳).</p></details>
    <div class="st-rank">
      <select id="rk-cat" aria-label="업종">${SIM.subOptions ? SIM.subOptions('viet') : ''}</select>
      <div class="rk-hours"><label>여는 시각<select id="rk-open"></select></label><label>닫는 시각<select id="rk-close"></select></label></div>
      <p class="rk-why" id="rk-why"></p>
      <button class="btn-primary btn-main" id="rk-run"></button>
    </div>
    <div id="rk-out"></div>`;
  panel.hidden = false;
  const $ = (id) => document.getElementById(id), sel = $('rk-cat');
  $('st-close').onclick = () => choose('');
  $('ls-sort').value = LS.sort; $('ls-st').value = LS.st; $('ls-area').value = String(LS.area); $('ls-up').checked = LS.upper;
  const re = () => { LS.n = 30; listTable(); };
  $('ls-sort').onchange = (e) => { LS.sort = e.target.value; re(); };
  $('ls-st').onchange = (e) => { LS.st = e.target.value; re(); };
  $('ls-area').onchange = (e) => { LS.area = +e.target.value; re(); };
  $('ls-up').onchange = (e) => { LS.upper = e.target.checked; re(); };
  $('ls-more').onclick = () => { LS.n += 30; listTable(); };
  const rkH = () => { if (SIM.fillHours) SIM.fillHours($('rk-open'), $('rk-close'), sel.value); };
  sel.addEventListener('change', () => { rkH(); listTable(); }); rkH();
  // 고른 자리(거르기로 목록에서 안 보여도 고른 것은 그대로)만 돌린다
  $('rk-run').onclick = () => { const C = new Map(candidates().map(c => [c.b, c])), L = LS.sel.map(b => C.get(b)).filter(Boolean);
    if (L.length) rank(LIST, L.map(c => ({ b: c.b, floor: c.floor, area: c.area, where: `${c.floor}층 · ${c.name}` })), `목록에서 고른 ${L.length}곳`); };
  listTable();
  panel.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

// 거리 모드: 거리 건물에만 층 띠(가게 없음 + 영업 중), 카드·재생 패널 접기, 도움말 숨김
let sBands = null, saved = null;
function streetBands(s) {
  if (sBands) { scene.remove(sBands); sBands.geometry.dispose(); sBands = null; }
  if (!s || !window.FLOORS) return;
  const pos = [], nrm = [], col = [], C2 = { open: new THREE.Color(COL.open), empty: new THREE.Color(COL.empty), unknown: new THREE.Color(COL.unknown) };
  for (const x of s.slots) {
    const b = B[x.b]; if (!b || b.k === 'roof') continue;
    let p = b.p.slice(); let a2 = 0; for (let i = 0; i < p.length; i++) { const u = p[i], v = p[(i + 1) % p.length]; a2 += u[0] * v[1] - v[0] * u[1]; } if (a2 > 0) p.reverse();
    const fh = (b.h - 0.6) / b.lv, y00 = b.b || 0;
    for (const f of x.fl) {
      const c = C2[f[1]]; if (!c || f[0] > b.lv) continue;
      const y0 = y00 + (f[0] - 1) * fh + fh * 0.34, y1 = y00 + (f[0] - 1) * fh + fh * 0.62;   // floors.js 와 같은 얇은 띠
      for (let i = 0; i < p.length; i++) {
        const a = p[i], q = p[(i + 1) % p.length], dx = q[0] - a[0], dz = q[1] - a[1], l = Math.hypot(dx, dz); if (l < 0.3) continue;
        const nx = -dz / l, nz = dx / l, o = 0.14, ax = a[0] + nx * o, az = a[1] + nz * o, bx = q[0] + nx * o, bz = q[1] + nz * o;
        pos.push(ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y0, az, bx, y1, bz, ax, y1, az);
        for (let k = 0; k < 6; k++) { nrm.push(nx, 0, nz); col.push(c.r, c.g, c.b); }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  sBands = new THREE.Mesh(g, (M.night >= 0.5 ? new THREE.MeshBasicMaterial({ vertexColors: true }) : new THREE.MeshLambertMaterial({ vertexColors: true }))); sBands.renderOrder = 11; scene.add(sBands);
}
function streetUI(on) {
  // 거리 보기에서는 길가 건물 층을 늘 모두 보여 주므로 층 칩을 잠그고, 그 이유를 칩 안에 짧게 보이게 쓴다
  for (const id of ['L-floors', 'L-open']) {
    const l = document.getElementById(id)?.closest('label'); if (!l) continue;
    let n = l.querySelector('.tog-note');
    if (on && !n) { n = document.createElement('small'); n.className = 'tog-note'; n.textContent = '거리 보기에서는 늘 켜져 있습니다'; l.appendChild(n); }
    if (!on && n) n.remove();
  }
  const card = document.getElementById('card'), sim = document.getElementById('sim'), F = window.__floors;
  if (on && !saved) {
    saved = { card: card.classList.contains('collapsed'), sim: sim && sim.classList.contains('folded'), bands: F ? F.mesh.visible : true, rest: F ? F.rest.visible : false };
    card.classList.add('collapsed'); if (sim) sim.classList.add('folded'); if (F) { F.mesh.visible = false; F.rest.visible = false; }
    if (window.__syncCard) window.__syncCard();
  } else if (!on && saved) {
    card.classList.toggle('collapsed', saved.card); if (sim) sim.classList.toggle('folded', !!saved.sim);
    if (F) { F.mesh.visible = saved.bands; F.rest.visible = saved.rest; }
    saved = null; if (window.__syncCard) window.__syncCard();
  }
}
function choose(id, noFly) {
  const s = ST.find(x => x.id === id) || null; cur = s; clearRank(); document.body.classList.remove('list-mode');
  tabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === (s ? s.id : ''))));
  document.body.classList.toggle('street-mode', !!s);
  streetUI(!!s); streetBands(s);
  if (!s) {
    panel.hidden = true; drawBand(null); M.tint(null); M.select(-1);
    M.camera.position.copy(M.HOME.c); M.controls.target.copy(M.HOME.t); M.controls.update(); need(); return;
  }
  M.select(-1);
  M.tint(new Set(s.slots.map(x => x.b)), 0.62);   // 거리 밖 건물은 더 흐리게
  drawBand(s); if (!noFly) flyStreet(s); panel.hidden = false; render(s); need();
}
tabs.onclick = (e) => { const b = e.target.closest('button'); if (b) choose(b.dataset.id); };
const QS = new URLSearchParams(location.search), q = QS.get('street');
// ── 첫 화면 연출: 상권 전체를 비스듬히 내려다보다가 기본 거리('빛의 거리')로 3.4초 동안 내려앉는다.
// 주소에 보기 설정(street·cam·t·#해시)이 있거나 움직임 줄이기 설정이면 건너뜀. ?intro=1 강제, ?intro=0 끔.
// 지도를 누르거나 휠·키를 쓰면 그 자리에서 멈추고 바로 조작. 끝나면 window.__introDone = true + 'intro-done' 이벤트(세션 20 요청)
const introOn = QS.get('intro') === '1' || (QS.get('intro') !== '0' && q === null && !QS.has('cam') && !QS.has('t') && !location.hash
  && !matchMedia('(prefers-reduced-motion: reduce)').matches);
function introDone() { if (window.__introDone) return; window.__introDone = true; document.dispatchEvent(new CustomEvent('intro-done')); }
const first = q === null ? 'light' : q;   // 기본: 거제시 공식 구간 '빛의 거리'
choose(first, introOn);
if (!introOn) introDone();
else {
  const s0 = ST.find(x => x.id === first);
  // 시작 자리: 상권 전체 보기(HOME)에서 서쪽으로 40° 돌리고 조금 더 멀리 — 바다(옥포만)와 상권이 한눈에
  const t0 = M.HOME.t.clone(), off = M.HOME.c.clone().sub(t0).applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.7).multiplyScalar(1.15);
  M.camera.position.copy(t0).add(off); M.controls.target.copy(t0); M.controls.update(); need();
  const cvs = document.getElementById('c'), stop = () => { flyTok++; };   // 사용자가 손대면 비행 멈춤(그 자리에서 조작)
  const opts = { capture: true, passive: true };
  const off2 = () => { cvs.removeEventListener('pointerdown', stop, opts); cvs.removeEventListener('wheel', stop, opts); removeEventListener('keydown', stop, opts); };
  cvs.addEventListener('pointerdown', stop, opts); cvs.addEventListener('wheel', stop, opts); addEventListener('keydown', stop, opts);
  const go = () => { if (!window.__ready) { requestAnimationFrame(go); return; }
    // 로딩 가림막이 걷히는 0.3초 + 잠깐 전체를 보여 준 뒤 출발
    const tok = flyTok; setTimeout(() => { if (tok !== flyTok) { off2(); introDone(); return; }
      flyStreet(s0, 3400, () => { off2(); introDone(); }); }, 700); };
  go();
}
// 밤에는 거리 층 띠도 제 색 그대로(floors.js 와 같게)
document.addEventListener('map-light', (e) => { if (!sBands) return; const n = e.detail.night >= 0.5, basic = sBands.material.isMeshBasicMaterial;
  if (n !== basic) { sBands.material.dispose(); sBands.material = n ? new THREE.MeshBasicMaterial({ vertexColors: true }) : new THREE.MeshLambertMaterial({ vertexColors: true }); need(); } });
document.addEventListener('sim-config', () => { if (cur && SIM) flow(cur); });
window.__street = { choose, openList, get cur() { return cur === LIST ? null : cur; }, get listOpen() { return cur === LIST; }, flowCache };   // 밖(shell.js 주소·저장 이름)에는 목록을 '상권 전체'로
})();
