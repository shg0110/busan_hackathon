/* 거리 집중 화면(옥포).
   자료: window.STREETS(tools/okpo_street.py: 거리 중심선·길가 1층 칸), window.FLOORS, window.__sim.
   - 위 가운데 탭으로 거리를 고르면 카메라가 거리로 가고, 거리 밖 건물은 흐려진다.
   - 오른쪽 패널: 양쪽 1층 칸 띠(영업 중·가게 없음…), 이 거리를 지나간 가상 손님(시간대·부류), 빈 1층 자리 순위. */
(() => {
'use strict';
const ST = window.STREETS, M = window.__map, SIM = window.__sim;
if (!ST || !ST.length || !M) return;
const { buildings: B, scene, need, esc } = M;
const COL = { open: '#40a372', empty: '#f76707', unknown: '#adb5bd', home: '#dee2e6', other: '#e9ecef', nodata: '#f1f3f5' };
const KO = { open: '영업 중', empty: '가게 없음', unknown: '확인 불가', home: '주거', other: '기타(주차·공공 등)', nodata: '층별 자료 없음' };

// ── 탭 ───────────────────────────────────────────────
const tabs = document.createElement('nav'); tabs.id = 'tabs'; tabs.setAttribute('aria-label', '보기 범위');
tabs.innerHTML = `<button data-id="" aria-pressed="false">상권 전체</button>` + ST.map(s => `<button data-id="${s.id}" aria-pressed="false">${esc(s.ko.split(' (')[0])}</button>`).join('');
document.body.appendChild(tabs);
const panel = document.createElement('aside'); panel.id = 'street'; panel.hidden = true; panel.setAttribute('aria-live', 'polite');
document.body.appendChild(panel);

// 거리 띠(땅 위 옅은 노란 길)
let band = null;
function drawBand(p) {
  if (band) { scene.remove(band); band.geometry.dispose(); band = null; }
  if (!p) return;
  const pos = [];
  for (let i = 0; i < p.length - 1; i++) {
    const [ax, az] = p[i], [bx, bz] = p[i + 1], dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1, nx = -dz / l * 9, nz = dx / l * 9;
    pos.push(ax + nx, 0, az + nz, bx + nx, 0, bz + nz, ax - nx, 0, az - nz, ax - nx, 0, az - nz, bx + nx, 0, bz + nz, bx - nx, 0, bz - nz);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  band = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: '#ffe066', transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide }));
  band.renderOrder = 8; scene.add(band);
}
function fly(toT, toC, dur = 900) {
  const cam = M.camera, ctl = M.controls, t0 = performance.now(), fC = cam.position.clone(), fT = ctl.target.clone();
  (function f(now) { const k = Math.min(1, (now - t0) / dur), e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    cam.position.lerpVectors(fC, toC, e); ctl.target.lerpVectors(fT, toT, e); ctl.update(); need(); if (k < 1) requestAnimationFrame(f); })(t0);
}
function flyStreet(s) {
  const p = s.p, a = p[0], b = p[p.length - 1], mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz) || 1, nx = -dz / l, nz = dx / l;
  const side = nz > 0 ? 1 : -1;   // 남쪽에서 북쪽을 보게(화면 위가 북쪽 쪽)
  const D = Math.max(200, s.len * 0.68);
  fly(new THREE.Vector3(mx, 0, mz), new THREE.Vector3(mx + nx * side * D * 0.9, D * 0.72, mz + nz * side * D * 0.9));
}
function flyBuilding(bi) {
  const b = B[bi]; let x = 0, z = 0; for (const q of b.p) { x += q[0]; z += q[1]; } x /= b.p.length; z /= b.p.length;
  fly(new THREE.Vector3(x, 0, z), new THREE.Vector3(x + 60, 55 + b.h, z + 95), 700); M.select(bi);
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
      r += `<rect x="${X(x.s0).toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="${FH - 0.8}" fill="${COL[st] || '#eee'}" data-b="${x.b}"><title>${esc(tip)}</title></rect>`;
    }
    return r;
  };
  const lab = (sd) => { const o = s.slots.find(x => x.side === sd && x.odd != null); return o ? (o.odd ? '홀수 번지' : '짝수 번지') : ''; };
  return `<svg class="strip" viewBox="0 0 ${W} ${H}" role="img" aria-label="거리 양쪽 건물 층별 입면도">
    <text x="2" y="9" class="t">${lab('L')} 쪽 ↑ 위층</text>
    ${s.slots.filter(x => x.side === 'L').map(x => cell(x, 'L')).join('')}
    <line x1="${pad}" x2="${W - pad}" y1="${mid}" y2="${mid}" stroke="#ffe066" stroke-width="9" stroke-linecap="round"/>
    <text x="${W / 2}" y="${mid + 3}" class="t" text-anchor="middle">${esc(s.ko.split(' (')[0])} ${L}m</text>
    ${s.slots.filter(x => x.side === 'R').map(x => cell(x, 'R')).join('')}
    <text x="2" y="${H - 2}" class="t">${lab('R')} 쪽 ↓ 위층</text></svg>`;
}
function render(s) {
  const c = s.count, w = s.whole;
  panel.innerHTML = `
    <div class="st-head"><h2>${esc(s.ko)}</h2><button class="icon-btn" id="st-close" aria-label="상권 전체로" title="상권 전체로"><svg viewBox="0 0 20 20"><path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button></div>
    <p class="st-note">${esc(s.note)}</p>
    <div class="st-kpi">
      <div><b>${s.len}m</b><span>길이</span></div>
      <div><b>${s.slots.length}채</b><span>길가 건물</span></div>
      <div><b class="em">${w.empty}개</b><span>가게 없는 상가 층</span></div>
      <div><b class="em">${w.empty_area_pct ?? '–'}%</b><span>면적 기준</span></div>
    </div>
    <p class="st-sub">길 양쪽 건물, 층마다 <span class="lgd">${['open', 'empty', 'unknown', 'home', 'other', 'nodata'].map(k => `<i style="background:${COL[k]}"></i>${KO[k]}`).join(' ')}</span></p>
    ${strip(s)}
    <p class="st-tip">상가 층 ${w.floors}개 중 영업 ${w.open} · 가게 없음 ${w.empty} · 확인 불가 ${w.unknown}. 1층만 보면 가게 없음 ${c.empty}곳. 칸을 누르면 그 건물로 갑니다. 판정: 건축물대장 층별개요 × 상가정보(2026-09). 길 양쪽은 건물번호 홀짝으로 확인(${s.sideCheck.known}곳 중 ${Math.max(s.sideCheck.agree, s.sideCheck.known - s.sideCheck.agree)}곳 일치).</p>
    <p class="st-sub">이 거리를 지나간 가상 손님 <span class="lgd" id="fl-lg"></span></p>
    <div id="st-flow"><p class="exp-wait">계산 중…</p></div>
    <p class="st-sub">가게 없는 층 자리 순위</p>
    <div class="st-rank">
      <select id="rk-cat" aria-label="업종"><option value="intl">가성비 다국적 식당</option><option value="pub">옛날식 호프·주점</option><option value="meal">백반·한식</option><option value="cafe">카페</option><option value="mart">편의점·식료품</option><option value="life">생활 서비스</option></select>
      <button class="btn-primary" id="rk-run">${new Set(s.slots.filter(x => x.fl.some(f => f[1] === 'empty')).map(x => x.b)).size}개 건물에 열어 보기</button>
    </div>
    <div id="rk-out"></div>`;
  document.getElementById('st-close').onclick = () => choose('');
  panel.querySelectorAll('rect[data-b]').forEach(r => { r.onclick = () => flyBuilding(+r.dataset.b); r.onkeydown = (e) => { if (e.key === 'Enter') flyBuilding(+r.dataset.b); }; });
  document.getElementById('rk-run').onclick = () => rank(s);
  if (!w.empty) document.getElementById('rk-run').disabled = true;
  setTimeout(() => flow(s), 60);
}
function flow(s) {
  if (!SIM) { document.getElementById('st-flow').innerHTML = ''; return; }
  const key = s.id;
  if (!flowCache[key]) {
    const set = SIM.nodesNear(s.p, 14);
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
    <div class="exp-hours"><div>${bars(f.wd.hour, '#1c64f2')}</div><div>${bars(f.we.hour, '#7048e8')}</div><div class="ax"><span>0시</span><span>12시</span><span>23시</span></div></div>
    <div class="exp-mix"><b>평일</b> ${mix(f.wd.grp, f.wd.tot)}</div><div class="exp-mix"><b>주말</b> ${mix(f.we.grp, f.we.tot)}</div>
    <p class="st-tip">가상 인물이 이 길(중심선 14m 안)을 지나간 횟수입니다. 실제 유동인구가 아닙니다. 사람 수·교대 시간은 '자료와 가정 보기'(아래 패널)를 따릅니다.</p>`;
}
function rank(s) {
  const cat = document.getElementById('rk-cat').value, cfg = SIM.CFG.cats[cat];
  // 건물마다 가장 낮은 빈 층 하나(같은 건물 위층은 위치가 같아 결과도 같음)
  const slots = s.slots.map(x => { const f = x.fl.filter(f => f[1] === 'empty').sort((a, c) => a[0] - c[0])[0]; return f ? { ...x, floor: f[0], area: f[2] } : null; }).filter(Boolean);
  const out = document.getElementById('rk-out'), btn = document.getElementById('rk-run');
  btn.disabled = true; const res = []; let i = 0; const t0 = performance.now();
  out.innerHTML = `<div class="prog"><i style="width:0%"></i></div><p class="exp-wait" id="rk-p">0 / ${slots.length}</p>`;
  function next() {
    if (cur !== s) return;
    if (i >= slots.length) {
      SIM.restore(); btn.disabled = false;
      res.sort((a, b) => (b.r.wd + b.r.we) - (a.r.wd + a.r.we));
      out.innerHTML = `<table class="exp-cmp rk"><tr><th>순위</th><th>자리</th><th>평일</th><th>주말</th><th>평일 매출</th></tr>${res.map((x, k) => `<tr data-b="${x.b}"><td>${k + 1}</td><td>${x.floor}층 · ${x.side === 'L' ? '왼쪽' : '오른쪽'} ${Math.round(x.s)}m${x.area ? ` · ${Math.round(x.area)}㎡` : ''}</td><td>${Math.round(x.r.wd)}명</td><td>${Math.round(x.r.we)}명</td><td>${SIM.won(x.r.wdWon)}</td></tr>`).join('')}</table>
        <p class="exp-foot">${esc(document.getElementById('rk-cat').selectedOptions[0].textContent)} · 1인 ${SIM.won(cfg.price)} · 건물마다 가장 낮은 빈 층, 평일·주말 2번씩 평균(사람 1:1), 2층 이상은 눈에 덜 띄는 것(가정)을 반영 · 계산 ${((performance.now() - t0) / 1000).toFixed(1)}초. 행을 누르면 그 건물로 가서 자세히 실험할 수 있습니다. 가상 인물로 자리끼리 비교한 값입니다.</p>`;
      out.querySelectorAll('tr[data-b]').forEach(tr => tr.onclick = () => flyBuilding(+tr.dataset.b));
      need(); return;
    }
    const x = slots[i++];
    res.push({ ...x, r: SIM.trySlot(x.b, x.floor, cat, cfg.price, cfg.seats, 2) });
    out.querySelector('.prog i').style.width = (100 * i / slots.length) + '%'; document.getElementById('rk-p').textContent = `${i} / ${slots.length}`;
    setTimeout(next, 0);
  }
  setTimeout(next, 30);
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
      const y0 = y00 + (f[0] - 1) * fh + 0.15, y1 = y00 + f[0] * fh - 0.15;
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
  sBands = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true })); sBands.renderOrder = 11; scene.add(sBands);
}
function streetUI(on) {
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
function choose(id) {
  const s = ST.find(x => x.id === id) || null; cur = s;
  tabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === (s ? s.id : ''))));
  document.body.classList.toggle('street-mode', !!s);
  streetUI(!!s); streetBands(s);
  if (!s) {
    panel.hidden = true; drawBand(null); M.tint(null); M.select(-1);
    M.camera.position.copy(M.HOME.c); M.controls.target.copy(M.HOME.t); M.controls.update(); need(); return;
  }
  M.select(-1);
  M.tint(new Set(s.slots.map(x => x.b)));
  drawBand(s.p); flyStreet(s); panel.hidden = false; render(s); need();
}
tabs.onclick = (e) => { const b = e.target.closest('button'); if (b) choose(b.dataset.id); };
const q = new URLSearchParams(location.search).get('street');
choose(q === null ? 'light' : q);   // 기본: 거제시 공식 구간 '빛의 거리'
window.__street = { choose, get cur() { return cur; }, flowCache };
})();
